/**
 * `POST /api/valorant/refresh` — rang courant et derniers matchs d'un compte
 * Riot lié (SPEC §5 bis, §7-P3b).
 *
 * Trois décisions structurent cette fonction :
 *
 * 1. **Le cache est en base, pas en mémoire.** Une fonction serverless démarre
 *    à froid ; un cache d'instance ne protégerait pas la source contre dix
 *    ouvertures du dashboard depuis dix onglets. `last_refreshed_at` est donc
 *    la seule horloge qui compte, et elle survit au processus.
 * 2. **On stocke des résumés, jamais la réponse brute.** `imported_matches`
 *    garde la map, l'agent, le KDA, l'ADR, le HS%, les rounds et le résultat —
 *    ce dont le coach a besoin, et ce qui doit survivre à un changement de
 *    fournisseur. Un blob complet coûterait cent fois la place pour une donnée
 *    qu'on ne saurait plus relire dans six mois.
 * 3. **Un match importé ne se réécrit pas.** La table n'a pas de policy
 *    `update` : une partie jouée ne change plus, et l'insertion ignore
 *    simplement les doublons. Le rafraîchissement est donc idempotent.
 *
 * Une exception depuis la migration 0007 : la **datation** du rafraîchissement
 * (`last_refreshed_at`, `riot_mmr`) passe par le client de service. Ces deux
 * colonnes ne sont plus écrivables par `authenticated`, et c'est le point même
 * du durcissement : tant que le navigateur pouvait écrire `last_refreshed_at`,
 * le cache décrit au point 1 n'était pas un cache mais une suggestion — il
 * suffisait de remettre la colonne à `null` en boucle pour rappeler la source
 * autant de fois qu'on voulait. Tout le reste (lectures, matchs importés)
 * continue de passer par le JWT de l'appelant, donc sous RLS.
 */

import {
  MATCH_HISTORY_SIZE,
  type MatchSummary,
  type MmrSummary,
  matchSummarySchema,
  mmrSummarySchema,
  REFRESH_CACHE_MS,
  type RefreshResponse,
  refreshRequestSchema,
} from "../../src/client/data/linked-accounts-contract.js";
import { summarizeMatches, summarizeMmr } from "../../src/server/valorant/summary.js";
import {
  DEFAULT_REGION,
  fetchCompetitiveMatches,
  fetchMmr,
  HenrikError,
  isConfigured,
  NOT_CONFIGURED,
} from "../_lib/henrikdev.js";
import { authenticate, fail, json, readBody, type UserClient } from "../_lib/request.js";
import { serviceClient } from "../_lib/service.js";

/** Deux appels à une source non officielle, puis deux écritures. */
export const maxDuration = 30;

const INVALID_BODY = "Identifiant de compte lié attendu.";

const UNKNOWN_ACCOUNT = "Ce compte lié n'existe pas (ou plus).";

/* ------------------------------------------------------------------ */
/* Lectures                                                            */
/* ------------------------------------------------------------------ */

/** Les matchs déjà importés pour ce compte, du plus récent au plus ancien. */
async function storedMatches(
  client: UserClient,
  linkedAccountId: number,
): Promise<readonly MatchSummary[]> {
  const { data } = await client
    .from("imported_matches")
    .select("payload")
    .eq("linked_account_id", linkedAccountId)
    .order("played_at", { ascending: false, nullsFirst: false })
    .order("id", { ascending: false })
    .limit(MATCH_HISTORY_SIZE);

  const matches: MatchSummary[] = [];

  for (const row of data ?? []) {
    const parsed = matchSummarySchema.safeParse(row.payload);

    if (parsed.success) matches.push(parsed.data);
  }
  return matches;
}

/** Le rafraîchissement précédent est-il encore assez frais pour être resservi ? */
function isFresh(lastRefreshedAt: string | null): boolean {
  if (lastRefreshedAt === null) return false;

  const time = Date.parse(lastRefreshedAt);

  return !Number.isNaN(time) && Date.now() - time < REFRESH_CACHE_MS;
}

/* ------------------------------------------------------------------ */
/* Handler                                                             */
/* ------------------------------------------------------------------ */

export async function POST(request: Request): Promise<Response> {
  const auth = await authenticate(request);

  if (!auth.ok) return auth.response;

  const body = await readBody(request, refreshRequestSchema, INVALID_BODY);

  if (!body.ok) return body.response;

  // 1. Le compte visé, lu sous RLS : un compte qui n'est pas à l'appelant est
  //    invisible, donc « introuvable » — l'UI n'a pas à distinguer les deux.
  const found = await auth.client
    .from("linked_accounts")
    .select("id, provider, riot_puuid, riot_region, last_refreshed_at, riot_mmr")
    .eq("id", body.value.linkedAccountId)
    .maybeSingle();

  if (found.error !== null) {
    console.error("[valorant] lecture du compte lié en échec", found.error);
    return fail("Le compte lié n'a pas pu être lu. Réessaie dans un instant.", 500);
  }

  const account = found.data;

  if (account === null) return fail(UNKNOWN_ACCOUNT, 404);
  if (account.provider !== "riot") {
    return fail("Ce compte n'est pas un compte Riot : rien à rafraîchir ici.", 400);
  }

  const puuid = account.riot_puuid;

  if (puuid === null) {
    return fail("Ce compte lié n'a pas d'identifiant Riot : délie-le et relie-le.", 409);
  }

  // 2. Cache. Il passe avant la vérification de configuration : un compte
  //    rafraîchi il y a deux minutes reste consultable même si la clé vient
  //    d'être retirée de l'environnement.
  if (isFresh(account.last_refreshed_at)) {
    const cached: RefreshResponse = {
      cached: true,
      mmr: mmrSummarySchema.safeParse(account.riot_mmr).data ?? null,
      matches: [...(await storedMatches(auth.client, account.id))],
    };

    return json(cached, 200);
  }

  if (!isConfigured()) return fail(NOT_CONFIGURED, 503);

  // 3. Rang et historique, menés de front : ni l'un ni l'autre ne dépend de
  //    l'autre, et l'utilisateur attend devant un bouton.
  const region = account.riot_region ?? DEFAULT_REGION;

  let mmr: MmrSummary;
  let matches: readonly MatchSummary[];

  try {
    const [rawMmr, rawMatches] = await Promise.all([
      fetchMmr(region, puuid),
      fetchCompetitiveMatches(region, puuid, MATCH_HISTORY_SIZE),
    ]);

    mmr = summarizeMmr(rawMmr);
    matches = summarizeMatches(rawMatches, puuid);
  } catch (cause) {
    if (cause instanceof HenrikError) {
      console.error("[valorant] rafraîchissement en échec", cause);
      return fail(cause.message, cause.status);
    }
    console.error("[valorant] échec inattendu au rafraîchissement", cause);
    return fail("Le rafraîchissement a échoué. Réessaie dans un instant.", 500);
  }

  // 4. Persistance des matchs. `ignoreDuplicates` traduit l'absence de policy
  //    `update` : ce qui est déjà là reste tel quel.
  if (matches.length > 0) {
    const { error } = await auth.client.from("imported_matches").upsert(
      matches.map((match) => ({
        user_id: auth.userId,
        linked_account_id: account.id,
        match_id: match.matchId,
        played_at: match.playedAt,
        payload: match,
      })),
      { onConflict: "linked_account_id,match_id", ignoreDuplicates: true },
    );

    if (error !== null) {
      // Les matchs n'ont pas pu être gardés, mais ils ont été lus : autant les
      // rendre. Ne pas dater le rafraîchissement fera réessayer au prochain
      // appel, ce qui est exactement ce qu'on veut.
      console.error("[valorant] enregistrement des matchs importés en échec", error);
      return json({ cached: false, mmr, matches: [...matches] } satisfies RefreshResponse, 200);
    }
  }

  // 5. Datation du rafraîchissement et rang du moment. C'est cette écriture
  //    qui arme le cache : elle vient en dernier, une fois tout le reste sûr.
  //
  //    Le client de service, parce que ces colonnes sont réservées au serveur.
  //    Le `.eq("user_id")` est redondant avec le `.eq("id")` — la ligne vient
  //    d'être lue sous RLS, elle est donc à l'appelant — mais il borne le rayon
  //    d'action de la RLS contournée à un seul utilisateur, celui que
  //    `getUser()` a vérifié. Une écriture qui se tromperait de ligne ne
  //    pourrait toucher que les siennes.
  const service = serviceClient();

  if (service === null) {
    // Le cache n'est pas armé : le prochain appel rappellera la source. C'est
    // une dégradation, pas une panne — la réponse, elle, est complète.
    console.error("[valorant] SUPABASE_SERVICE_ROLE_KEY absente : rafraîchissement non daté");
  } else {
    const stamped = await service
      .from("linked_accounts")
      .update({ last_refreshed_at: new Date().toISOString(), riot_mmr: mmr })
      .eq("id", account.id)
      .eq("user_id", auth.userId);

    if (stamped.error !== null) {
      console.error("[valorant] datation du rafraîchissement en échec", stamped.error);
    }
  }

  const response: RefreshResponse = { cached: false, mmr, matches: [...matches] };

  return json(response, 200);
}
