/**
 * Vues dérivées du moteur d'énergie pour l'UI : couleur de rang, graduations
 * de jauge, prochaine cible. Tout vient de `src/lib/energy` (donc de
 * voltaic-s5-data.json) : aucun seuil ni aucune couleur de rang en dur.
 *
 * Ce qui décrit **une passe enregistrée** (jauge d'un détail d'historique,
 * pastille du dashboard) existe en variante qualifiée par saison : l'échelle
 * d'une jauge est `maxEnergy`, et les graduations sont les rangs — deux
 * grandeurs qui appartiennent à la saison de la passe, pas à la saison
 * courante (SPEC §5 quinquies). Les fonctions historiques restent la porte du
 * tracker, qui parle par définition du présent.
 *
 * Une exception de nommage, assumée : la convention du projet suffixe `For`
 * les variantes qualifiées par saison, mais `rankColorFor` porte déjà ce
 * suffixe pour le palier. Sa variante s'appelle donc `rankColorForSeason`.
 */

import {
  currentSeason,
  findRank,
  findRankFor,
  getScenario,
  getTier,
  getTierFor,
  type Rank,
  type SeasonId,
  type TierId,
} from "../lib/energy";

/** Une graduation de jauge : un rang overall, à sa position sur l'échelle. */
export interface RankTick {
  readonly name: string;
  readonly color: string;
  /** Position sur la jauge, dans `[0, 1]`. */
  readonly fraction: number;
  readonly reached: boolean;
}

/** Le prochain palier d'énergie à viser sur un scénario. */
export interface NextTarget {
  /** Libellé de l'ancre visée (ex. « Silver III »). */
  readonly label: string;
  /** Score à atteindre pour cette ancre. */
  readonly threshold: number;
  /** Points de score manquants. */
  readonly missing: number;
}

/** Le prochain rang overall à atteindre dans le palier. */
export interface NextRank {
  readonly rank: Rank;
  /** Énergie overall manquante. */
  readonly missing: number;
}

/** Couleur officielle du rang atteint à cette énergie, aux seuils de `season`. */
export function rankColorForSeason(season: SeasonId, tier: TierId, energy: number): string | null {
  return findRankFor(season, tier, energy)?.color ?? null;
}

/** Couleur officielle du rang atteint à cette énergie, ou `null` en dessous. */
export function rankColorFor(tier: TierId, energy: number): string | null {
  return findRank(tier, energy)?.color ?? null;
}

/** Position d'une énergie sur la jauge du palier de `season`, bornée à `[0, 1]`. */
export function railFractionFor(season: SeasonId, tier: TierId, energy: number): number {
  const { maxEnergy } = getTierFor(season, tier);

  return Math.min(1, Math.max(0, energy / maxEnergy));
}

/** Position d'une énergie sur la jauge du palier, bornée à `[0, 1]`. */
export function railFraction(tier: TierId, energy: number): number {
  return railFractionFor(currentSeason(), tier, energy);
}

/** Les rangs du palier de `season` placés sur la jauge, à leur couleur officielle. */
export function rankTicksFor(season: SeasonId, tier: TierId, energy: number): readonly RankTick[] {
  return getTierFor(season, tier).overallRanks.map((rank) => ({
    name: rank.name,
    color: rank.color,
    fraction: railFractionFor(season, tier, rank.minEnergy),
    reached: energy >= rank.minEnergy,
  }));
}

/** Les 4 rangs du palier placés sur la jauge, avec leur couleur officielle. */
export function rankTicks(tier: TierId, energy: number): readonly RankTick[] {
  return rankTicksFor(currentSeason(), tier, energy);
}

/**
 * La prochaine ancre d'énergie franchissable sur ce scénario.
 * `null` au-delà de la dernière ancre (l'énergie est plafonnée).
 */
export function nextTarget(tier: TierId, scenarioName: string, score: number): NextTarget | null {
  const { anchorLabels } = getTier(tier);
  const { thresholds } = getScenario(tier, scenarioName);

  for (const [index, threshold] of thresholds.entries()) {
    const label = anchorLabels[index];

    if (label !== undefined && score < threshold) {
      return { label, threshold, missing: threshold - score };
    }
  }
  return null;
}

/** Le prochain rang overall du palier, ou `null` si le dernier est atteint. */
export function nextRank(tier: TierId, overall: number): NextRank | null {
  for (const rank of getTier(tier).overallRanks) {
    if (overall < rank.minEnergy) {
      return { rank, missing: rank.minEnergy - overall };
    }
  }
  return null;
}
