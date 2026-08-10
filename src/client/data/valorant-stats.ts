/**
 * Les agrégats de profil Valorant, côté client (SPEC §5 sexies, V1).
 *
 * Une lecture, et une seule question tranchée : **pourquoi passer par une
 * fonction alors que les matchs sont lisibles depuis le navigateur sous RLS ?**
 * Parce que ces chiffres sont ceux que le coach (V4) et la routine (V5) citent.
 * Ils doivent être calculés au même endroit que celui où ils seront vérifiés,
 * par le même module pur — sinon le contrôle de citations comparerait des
 * chiffres du navigateur à des chiffres du navigateur.
 *
 * Aucune UI ici : le tracker v2 est V2.
 */

import {
  type ValorantStatsResponse,
  valorantStatsResponseSchema,
} from "../../shared/valorant-contract";
import { callValorant } from "./valorant-call";

const STATS_PATH = "/api/valorant/stats";

/**
 * Les agrégats du compte Riot principal de l'utilisateur.
 *
 * Un profil sans compte Riot lié n'est pas une erreur : la réponse revient avec
 * `accountId: null`, `matchCount: 0` et des compteurs vides — l'écran a de quoi
 * afficher un état vide sans traiter un cas d'échec de plus.
 */
export async function getValorantStats(): Promise<ValorantStatsResponse> {
  return callValorant(STATS_PATH, valorantStatsResponseSchema);
}

/** Les types du contrat, resservis par la couche données (voir `valorant-match.ts`). */
export type {
  StatBreakdown,
  StatPeriods,
  StatTotals,
  TrendPoint,
  ValorantStats,
  ValorantStatsResponse,
} from "../../shared/valorant-contract";
