/**
 * `POST /api/valorant/match` — le détail d'une partie déjà importée
 * (SPEC §5 sexies, V1).
 *
 * `api/valorant/refresh` rapporte des **résumés** : dix lignes d'historique par
 * rafraîchissement. Cette fonction-ci rapporte ce qu'on regarde quand on
 * **ouvre** une de ces lignes — scoreboard des dix joueurs, déroulé des rounds,
 * performance par côté. C'est un appel de plus à une source non officielle, il
 * ne part donc que lorsque quelqu'un le demande vraiment, et il ne part
 * **qu'une fois par partie**.
 *
 * Quatre décisions, dans l'ordre où la fonction les applique :
 *
 * 1. **Le match doit être à l'appelant.** Il est cherché dans ses
 *    `imported_matches`, sous RLS : un match qui n'est pas à lui est
 *    indiscernable d'un match inexistant (404). Sans cette étape, l'identifiant
 *    d'une partie — qui circule — suffirait à faire payer un appel à la
 *    plateforme pour la partie de n'importe qui.
 * 2. **Le cache passe avant tout appel sortant.** Une partie terminée n'aura
 *    jamais un autre scoreboard : une ligne dans `match_details` est définitive,
 *    et un second clic ne coûte plus rien.
 * 3. **Pas de compteur quotidien, et surtout aucun compteur détourné.** Le
 *    frein est structurel : l'ensemble des matchs atteignables est celui que
 *    l'utilisateur a déjà importé (dix par rafraîchissement, eux-mêmes bornés
 *    par `import_usage`), et chacun ne peut être cherché qu'une seule fois dans
 *    sa vie. Le pire cas se compte donc en dizaines d'appels par compte, jamais
 *    en boucle. Ajouter un `kind` à `increment_import_usage` demanderait une
 *    migration pour mesurer une pression qui ne peut pas exister ; réutiliser
 *    le compteur KovaaK's ou celui des liaisons ferait mentir les deux — un
 *    quota qui ne dit plus ce qu'il compte ne protège plus rien.
 * 4. **On stocke un résumé structuré, jamais la réponse brute** — même règle
 *    que pour l'historique, et validé par le contrat avant d'entrer en base.
 *
 * La signature est `export async function POST(request: Request)` : c'est la
 * forme sur laquelle le runtime Node de Vercel bascule en gestionnaires Web
 * (voir `api/_lib/request.ts`).
 */

import { parseMatchDetail } from "../../src/server/valorant/detail.js";
import {
  type MatchDetail,
  type MatchDetailResponse,
  matchDetailRequestSchema,
  matchDetailSchema,
} from "../../src/shared/valorant-contract.js";
import {
  DEFAULT_REGION,
  fetchMatchDetail,
  HenrikError,
  hasKey,
  NOT_CONFIGURED,
} from "../_lib/henrikdev.js";
import { loadPlatformSettings } from "../_lib/platform-settings.js";
import { authenticate, fail, json, readBody } from "../_lib/request.js";
import { serviceClient } from "../_lib/service.js";

/** Un seul appel sortant, puis une écriture. */
export const maxDuration = 20;

const INVALID_BODY = "Identifiant de match attendu.";

/**
 * La même phrase pour « ce match n'existe pas » et « ce match n'est pas à toi ».
 * La RLS ne distingue pas les deux, l'utilisateur n'a pas à le faire non plus.
 */
const UNKNOWN_MATCH = "Cette partie n'est pas dans tes matchs importés.";

const MALFORMED = "La source de données Valorant a renvoyé un détail de partie illisible.";

export async function POST(request: Request): Promise<Response> {
  const auth = await authenticate(request);

  if (!auth.ok) return auth.response;

  const body = await readBody(request, matchDetailRequestSchema, INVALID_BODY);

  if (!body.ok) return body.response;

  const matchId = body.value.match_id;

  // 1. Possession. La lecture est sous RLS : elle ne rend que les matchs de
  //    l'appelant. Le plus récemment importé fait foi quand deux comptes liés
  //    du même utilisateur ont joué la partie ensemble — les deux perspectives
  //    sont légitimes, il en faut une, et celle-là est stable.
  const owned = await auth.client
    .from("imported_matches")
    .select("linked_account_id")
    .eq("match_id", matchId)
    .order("id", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (owned.error !== null) {
    console.error("[valorant] lecture du match importé en échec", owned.error);
    return fail("Le match n'a pas pu être lu. Réessaie dans un instant.", 500);
  }
  if (owned.data === null) return fail(UNKNOWN_MATCH, 404);

  // 2. Cache. Il passe avant la vérification de configuration : un détail déjà
  //    en base reste consultable même si la clé vient d'être retirée.
  const stored = await auth.client
    .from("match_details")
    .select("payload")
    .eq("match_id", matchId)
    .maybeSingle();

  if (stored.error !== null) {
    // Le cache est en peine : ce n'est pas une raison de refuser la partie, on
    // continue vers la source. Le pire cas est un appel de plus.
    console.error("[valorant] lecture du détail en cache en échec", stored.error);
  } else if (stored.data !== null) {
    const cached = matchDetailSchema.safeParse(stored.data.payload);

    // Une ligne écrite par une version antérieure du résumé est écartée plutôt
    // que servie à moitié : on la recalcule, et l'insertion la remplacera le
    // jour où le cache sera purgé.
    if (cached.success) {
      return json({ cached: true, detail: cached.data } satisfies MatchDetailResponse, 200);
    }
    console.warn("[valorant] détail en cache hors contrat, ignoré");
  }

  // 3. Le compte lié qui a importé ce match : c'est lui qui donne la région
  //    d'appel et le PUUID dont le détail est calculé.
  const found = await auth.client
    .from("linked_accounts")
    .select("riot_puuid, riot_region")
    .eq("id", owned.data.linked_account_id)
    .maybeSingle();

  if (found.error !== null) {
    console.error("[valorant] lecture du compte lié en échec", found.error);
    return fail("Le compte lié n'a pas pu être lu. Réessaie dans un instant.", 500);
  }

  const puuid = found.data?.riot_puuid ?? null;

  if (puuid === null) {
    return fail("Ce compte lié n'a pas d'identifiant Riot : délie-le et relie-le.", 409);
  }

  const service = serviceClient();
  const platform = await loadPlatformSettings(service);

  if (!hasKey(platform.henrikdevKey)) return fail(NOT_CONFIGURED, 503);

  const region = found.data?.riot_region ?? DEFAULT_REGION;

  let detail: MatchDetail;

  try {
    const raw = await fetchMatchDetail(platform.henrikdevKey, region, matchId);
    const summarized = parseMatchDetail(raw, puuid);

    // `null` : la réponse n'a pas la forme attendue, ou le joueur n'y figure
    // pas — ce qui, pour un match tiré de *son* historique, est une incohérence
    // de la source et non une erreur de l'utilisateur.
    if (summarized === null) return fail(MALFORMED, 502);

    const validated = matchDetailSchema.safeParse(summarized);

    if (!validated.success) {
      console.error("[valorant] détail hors contrat après résumé", validated.error);
      return fail(MALFORMED, 502);
    }
    detail = validated.data;
  } catch (cause) {
    if (cause instanceof HenrikError) {
      console.error("[valorant] détail de match en échec", cause);
      return fail(cause.message, cause.status);
    }
    console.error("[valorant] échec inattendu sur le détail de match", cause);
    return fail("Le détail de la partie n'a pas pu être chargé. Réessaie dans un instant.", 500);
  }

  // 4. Mise en cache. `ignoreDuplicates` traduit l'absence de policy `update` :
  //    deux clics simultanés ne laissent qu'une ligne, et la première gagne.
  const { error } = await auth.client
    .from("match_details")
    .upsert(
      { user_id: auth.userId, match_id: matchId, payload: detail },
      { onConflict: "user_id,match_id", ignoreDuplicates: true },
    );

  if (error !== null) {
    // Le détail n'a pas pu être gardé, mais il a été lu : autant le rendre. Le
    // prochain appel repassera par la source, ce qui est exactement le
    // comportement voulu tant que le cache est en peine.
    console.error("[valorant] mise en cache du détail en échec", error);
  }

  return json({ cached: false, detail } satisfies MatchDetailResponse, 200);
}
