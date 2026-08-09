import { getScenario, getSubcategory, getTier } from "./data.js";
import {
  EnergyError,
  type Rank,
  type Scenario,
  type ScoreMap,
  type Tier,
  type TierId,
} from "./types.js";

/** Nombre de sous-catégories d'un bench Voltaic (3 catégories × 3). */
export const SUBCATEGORY_COUNT = 9;

function assertScore(score: number, scenarioName: string): void {
  if (!Number.isFinite(score) || score < 0) {
    throw new EnergyError(`Score invalide pour "${scenarioName}": ${score} (attendu: réel ≥ 0)`);
  }
}

function assertEnergy(energy: number, label: string): void {
  if (!Number.isFinite(energy) || energy < 0) {
    throw new EnergyError(`Énergie invalide (${label}): ${energy} (attendu: réel ≥ 0)`);
  }
}

/**
 * Interpolation linéaire par morceaux sur les ancres
 * `[(0, 0), (thresholds[i], anchorEnergies[i])…]`, plafonnée à `maxEnergy`.
 */
function interpolate(tier: Tier, scenario: Scenario, score: number): number {
  let previousScore = 0;
  let previousEnergy = 0;

  for (let i = 0; i < scenario.thresholds.length; i++) {
    const threshold = scenario.thresholds[i];
    const anchorEnergy = tier.anchorEnergies[i];

    if (threshold === undefined || anchorEnergy === undefined) {
      throw new EnergyError(`Données incohérentes: "${scenario.name}" n'a pas d'ancre ${i}`);
    }
    if (score < threshold) {
      const ratio = (score - previousScore) / (threshold - previousScore);
      return previousEnergy + ratio * (anchorEnergy - previousEnergy);
    }
    previousScore = threshold;
    previousEnergy = anchorEnergy;
  }

  // Au-delà de la dernière ancre : plafond du palier.
  return tier.maxEnergy;
}

/** Énergie d'un scénario pour un score donné. */
export function scenarioEnergy(tierId: TierId, scenarioName: string, score: number): number {
  const tier = getTier(tierId);
  const scenario = getScenario(tierId, scenarioName);

  assertScore(score, scenarioName);
  return interpolate(tier, scenario, score);
}

/**
 * Énergie d'une sous-catégorie : max de ses 2 scénarios.
 * Un scénario absent de `scores` est considéré non joué (score 0).
 */
export function subcategoryEnergy(
  tierId: TierId,
  subcategoryName: string,
  scores: ScoreMap,
): number {
  const tier = getTier(tierId);
  const subcategory = getSubcategory(tierId, subcategoryName);

  let best = 0;
  for (const scenario of subcategory.scenarios) {
    const score = scores[scenario.name] ?? 0;
    assertScore(score, scenario.name);
    best = Math.max(best, interpolate(tier, scenario, score));
  }
  return best;
}

/**
 * Overall : moyenne harmonique des 9 sous-catégories.
 * Vaut 0 si l'une d'elles vaut 0 (bench incomplet).
 */
export function overallEnergy(subcategoryEnergies: readonly number[]): number {
  if (subcategoryEnergies.length !== SUBCATEGORY_COUNT) {
    throw new EnergyError(
      `Overall: attendu ${SUBCATEGORY_COUNT} sous-catégories, reçu ${subcategoryEnergies.length}`,
    );
  }

  let sumOfInverses = 0;
  let lowest = Number.POSITIVE_INFINITY;
  let highest = 0;

  for (const [index, energy] of subcategoryEnergies.entries()) {
    assertEnergy(energy, `sous-catégorie ${index}`);
    if (energy === 0) return 0;
    lowest = Math.min(lowest, energy);
    highest = Math.max(highest, energy);
    sumOfInverses += 1 / energy;
  }

  // La moyenne harmonique est mathématiquement dans [min, max], mais
  // l'accumulation des inverses en flottant peut en sortir de quelques ulps
  // (9 × 500 → 499.99999999999994). Un joueur pile aux seuils d'un rang y
  // perdrait ce rang : on rétablit la borne exacte, sans tolérance arbitraire.
  const harmonicMean = SUBCATEGORY_COUNT / sumOfInverses;

  return Math.min(highest, Math.max(lowest, harmonicMean));
}

/** Le rang overall atteint (objet complet, couleur incluse), ou `null`. */
export function findRank(tierId: TierId, overall: number): Rank | null {
  const tier = getTier(tierId);

  assertEnergy(overall, "overall");

  let reached: Rank | null = null;
  for (const rank of tier.overallRanks) {
    if (overall >= rank.minEnergy) reached = rank;
  }
  return reached;
}

/** Nom du rang overall atteint, ou `null` sous le premier rang du palier. */
export function rankFor(tierId: TierId, overall: number): string | null {
  return findRank(tierId, overall)?.name ?? null;
}

/**
 * Badge « Complete » : les 18 scénarios atteignent individuellement le seuil
 * du rang (`rankName` doit être un libellé d'ancre du palier).
 */
export function isComplete(tierId: TierId, rankName: string, scores: ScoreMap): boolean {
  const tier = getTier(tierId);
  const anchorIndex = tier.anchorLabels.indexOf(rankName);

  if (anchorIndex < 0) {
    throw new EnergyError(`Rang inconnu: "${rankName}" (palier ${tierId})`);
  }

  for (const category of tier.categories) {
    for (const subcategory of category.subcategories) {
      for (const scenario of subcategory.scenarios) {
        const required = scenario.thresholds[anchorIndex];

        if (required === undefined) {
          throw new EnergyError(
            `Données incohérentes: "${scenario.name}" n'a pas de seuil ${anchorIndex}`,
          );
        }
        const score = scores[scenario.name] ?? 0;
        assertScore(score, scenario.name);
        if (score < required) return false;
      }
    }
  }
  return true;
}
