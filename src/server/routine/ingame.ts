/**
 * Ce que la routine sait des parties Valorant : le peu de chiffres qui
 * changent une séance d'entraînement (SPEC §5 sexies, V5).
 *
 * Module **pur**, et volontairement mince : il ne recalcule rien. Les compteurs
 * viennent de `aggregateValorant` — le même agrégateur que `api/valorant/stats`
 * et que l'écran de tendances. C'est la condition pour que les chiffres cités
 * par le modèle soient **les chiffres affichés à côté** : deux moyennes
 * calculées à deux endroits finiraient par se contredire, et la vérification de
 * citations vérifierait alors une donnée contre une autre.
 *
 * ## Deux fenêtres, et elles ne disent pas la même chose
 *
 * - **14 jours** décide s'il y a matière (`./gating.ts`) : c'est une question
 *   d'activité récente ;
 * - **30 jours** fournit les moyennes : c'est une question de masse. Un HS%
 *   moyen sur cinq parties saute de trois points sur une soirée ; sur un mois,
 *   il décrit une habitude — et c'est une habitude qu'une routine corrige.
 *
 * Le sous-ensemble de 30 jours est passé **entier** à l'agrégateur : les maps
 * sont donc ventilées sur la même période que les moyennes, et non sur tout
 * l'historique. Une map jouée l'hiver dernier n'a rien à faire dans « tes deux
 * pires maps du moment ».
 *
 * Aucun filtre de mode ici : `api/valorant/refresh` n'importe que du
 * compétitif, exactement comme le documente `../valorant/aggregates.ts`.
 */

import type { MatchSummary } from "../../client/data/linked-accounts-contract.js";
import { aggregateValorant, MONTH_WINDOW_DAYS, within } from "../valorant/aggregates.js";

/** Fenêtre des moyennes in-game, en jours. */
export const ROUTINE_INGAME_WINDOW_DAYS = MONTH_WINDOW_DAYS;

/**
 * Parties minimales sur une map pour qu'elle compte comme « pire map ».
 *
 * En dessous, un 0 % de winrate ne veut dire qu'une chose : deux défaites. Ce
 * n'est pas une faiblesse de map, c'est du bruit — et envoyer le joueur
 * retravailler Icebox sur cette base serait une prescription inventée.
 */
export const MIN_MAP_MATCHES = 3;

/** Nombre maximal de pires maps retenues. */
export const WORST_MAP_COUNT = 3;

/** Une map et ce qu'elle rapporte. */
export interface RoutineMapRecord {
  readonly map: string;
  readonly matches: number;
  /** Pourcentage de victoires ; jamais `null` ici (les maps sans verdict sont écartées). */
  readonly winrate: number;
}

/** Les stats in-game telles que le prompt et les citations les voient. */
export interface RoutineIngame {
  /** Fenêtre des moyennes, en jours — le prompt l'annonce au modèle. */
  readonly windowDays: number;
  readonly matches: number;
  readonly winrate: number | null;
  readonly headshotPercent: number | null;
  readonly adr: number | null;
  readonly kd: number | null;
  /** De la pire à la moins pire ; vide quand aucune map n'a assez de parties. */
  readonly worstMaps: readonly RoutineMapRecord[];
}

/**
 * Les stats in-game de la fenêtre, prêtes pour le prompt.
 *
 * @param now L'instant de référence de la fenêtre glissante.
 */
export function summarizeIngameForRoutine(
  matches: readonly MatchSummary[],
  now: Date = new Date(),
): RoutineIngame {
  const recent = within(matches, ROUTINE_INGAME_WINDOW_DAYS, now);
  const stats = aggregateValorant(recent, { now });
  const totals = stats.periods.all;

  const worstMaps = stats.byMap
    .flatMap((entry) =>
      entry.totals.matches >= MIN_MAP_MATCHES && entry.totals.winrate !== null
        ? [{ map: entry.key, matches: entry.totals.matches, winrate: entry.totals.winrate }]
        : [],
    )
    // Tri stable : à winrate égal, l'ordre de l'agrégateur (le plus joué
    // d'abord) est conservé — la map la plus jouée est la plus utile à citer.
    .sort((left, right) => left.winrate - right.winrate)
    .slice(0, WORST_MAP_COUNT);

  return {
    windowDays: ROUTINE_INGAME_WINDOW_DAYS,
    matches: totals.matches,
    winrate: totals.winrate,
    headshotPercent: totals.headshotPercent,
    adr: totals.adr,
    kd: totals.kd,
    worstMaps,
  };
}
