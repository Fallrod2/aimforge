/**
 * Le détail d'une partie, côté client (SPEC §5 sexies, V1).
 *
 * Un seul appel, et rien autour : ni cache mémoire, ni état partagé. Le cache
 * qui compte est en base (`match_details`, migration 0013) et il est à vie —
 * une partie terminée n'aura jamais un autre scoreboard. Un second cache dans
 * l'onglet n'économiserait qu'un aller-retour local et ferait vivre deux
 * vérités.
 *
 * Aucune UI ici : les écrans de match sont V2.
 */

import {
  type MatchDetailResponse,
  matchDetailResponseSchema,
} from "../../shared/valorant-contract";
import { callValorant } from "./valorant-call";

const MATCH_PATH = "/api/valorant/match";

/**
 * Le détail d'un match importé.
 *
 * La partie doit être dans les matchs importés de l'appelant : sinon la
 * fonction répond 404, et `ValorantError.notFound` le dit à l'écran. La réponse
 * porte `cached`, qui distingue une lecture de cache d'un appel réel à la
 * source — utile pour expliquer une attente, jamais pour décider quoi afficher.
 */
export async function getMatchDetail(matchId: string): Promise<MatchDetailResponse> {
  return callValorant(MATCH_PATH, matchDetailResponseSchema, { match_id: matchId });
}

/**
 * Les types du contrat, resservis ici : les vues n'importent que la couche
 * données (`src/client/data`), jamais `src/shared` directement — c'est la règle
 * du module `index.ts`, et elle vaut aussi pour les types.
 */
export type {
  MatchDetail,
  MatchDetailResponse,
  RoundOutcome,
  ScoreboardEntry,
  Side,
  SidePerformance,
  Team,
} from "../../shared/valorant-contract";
