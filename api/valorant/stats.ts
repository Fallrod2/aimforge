/**
 * `GET /api/valorant/stats` — les agrégats de profil du compte Riot principal
 * (SPEC §5 sexies, V1).
 *
 * Cette fonction **n'apporte aucune donnée nouvelle** : elle ne parle à aucune
 * source, ne consomme aucun quota, n'écrit rien. C'est une projection de ce que
 * l'appelant a déjà en base — ses `imported_matches` — en winrate, K/D, HS% et
 * ADR par période, par agent, par map, plus la série temporelle.
 *
 * Pourquoi la faire côté serveur, alors, plutôt que dans le navigateur ?
 *
 * 1. **Le calcul est la donnée.** Le coach (V4) et la routine (V5) liront les
 *    mêmes chiffres pour les citer ; s'ils venaient du navigateur, il suffirait
 *    de les changer en chemin pour faire dire au modèle ce qu'on veut, et le
 *    contrôle de citations vérifierait des chiffres inventés contre eux-mêmes.
 * 2. **Un seul agrégateur.** `src/server/valorant/aggregates.ts` est un module
 *    pur et testé ; deux implémentations, une par côté, finiraient par diverger
 *    sur le premier cas limite venu (un match sans ADR, une partie non datée).
 *
 * Les lectures passent par le JWT de l'appelant, donc sous RLS : la fonction ne
 * peut pas voir plus que ce que le navigateur verrait, elle en fait seulement
 * une meilleure lecture.
 */

import {
  type MatchSummary,
  matchSummarySchema,
} from "../../src/client/data/linked-accounts-contract.js";
import { aggregateValorant } from "../../src/server/valorant/aggregates.js";
import {
  type ValorantStatsResponse,
  valorantStatsResponseSchema,
} from "../../src/shared/valorant-contract.js";
import { authenticate, fail, json } from "../_lib/request.js";

/** Aucun appel sortant : quelques lectures et un calcul en mémoire. */
export const maxDuration = 15;

/**
 * Plafond de matchs pris en compte.
 *
 * Dix matchs entrent par rafraîchissement ; il en faut donc beaucoup de
 * sessions pour approcher ce chiffre, et au-delà, les fenêtres 7 et 30 jours —
 * celles qu'on regarde — sont de toute façon servies par les plus récents. Le
 * tri est explicite (du plus récent au plus ancien) pour que la troncature
 * coupe l'ancien, jamais le récent.
 */
const MATCH_CAP = 200;

const READ_FAILED = "Tes statistiques n'ont pas pu être lues. Réessaie dans un instant.";

export async function GET(request: Request): Promise<Response> {
  const auth = await authenticate(request);

  if (!auth.ok) return auth.response;

  // Le compte principal, avec le même repli que l'UI (`primaryAccount`) : le
  // marqué principal, sinon le plus ancien. Un profil sans compte Riot lié
  // n'est pas une erreur — c'est un profil vide, et l'écran le dira.
  const account = await auth.client
    .from("linked_accounts")
    .select("id")
    .eq("provider", "riot")
    .order("is_primary", { ascending: false })
    .order("id", { ascending: true })
    .limit(1)
    .maybeSingle();

  if (account.error !== null) {
    console.error("[valorant] lecture du compte principal en échec", account.error);
    return fail(READ_FAILED, 500);
  }

  const accountId = account.data?.id ?? null;
  const matches: MatchSummary[] = [];

  if (accountId !== null) {
    const rows = await auth.client
      .from("imported_matches")
      .select("payload")
      .eq("linked_account_id", accountId)
      .order("played_at", { ascending: false, nullsFirst: false })
      .order("id", { ascending: false })
      .limit(MATCH_CAP);

    if (rows.error !== null) {
      console.error("[valorant] lecture des matchs importés en échec", rows.error);
      return fail(READ_FAILED, 500);
    }

    // Chaque ligne est validée par le schéma qui l'a écrite : une entrée hors
    // contrat (import d'une version antérieure) est écartée plutôt que de
    // fausser une moyenne avec des champs absents.
    for (const row of rows.data ?? []) {
      const parsed = matchSummarySchema.safeParse(row.payload);

      if (parsed.success) matches.push(parsed.data);
    }
  }

  const response: ValorantStatsResponse = {
    accountId,
    matchCount: matches.length,
    stats: aggregateValorant(matches),
  };
  const validated = valorantStatsResponseSchema.safeParse(response);

  if (!validated.success) {
    // Le contrat est la seule chose que le client sait lire : servir une forme
    // approximative ferait échouer la validation côté navigateur, plus loin et
    // avec moins de contexte qu'ici.
    console.error("[valorant] agrégats hors contrat", validated.error);
    return fail(READ_FAILED, 500);
  }
  return json(validated.data, 200);
}
