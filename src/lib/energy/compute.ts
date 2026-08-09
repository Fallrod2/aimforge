/**
 * Orchestration du moteur d'énergie pour une passe de bench.
 *
 * Aucun calcul n'est refait ici : tout vient de `./energy`. Ce module vit dans
 * la lib pure (et non côté client) parce qu'il n'a ni I/O ni dépendance : la
 * saisie live du tracker et l'écriture en base appellent la **même** fonction,
 * donc l'aperçu ne peut pas diverger de ce qui est enregistré.
 */

import { listScenarios, listSubcategories } from "./data.js";
import { isComplete, overallEnergy, rankFor, scenarioEnergy, subcategoryEnergy } from "./energy.js";
import type { ScoreMap, TierId } from "./types.js";

export interface ComputedScenarioScore {
  readonly scenario: string;
  readonly score: number;
  readonly energy: number;
}

export interface ComputedSubcategory {
  readonly name: string;
  readonly energy: number;
}

export interface ComputedBenchRun {
  /** Uniquement les scénarios renseignés, dans l'ordre du tableur Voltaic. */
  readonly scores: readonly ComputedScenarioScore[];
  /** Les 9 sous-catégories, y compris celles à 0. */
  readonly subcategories: readonly ComputedSubcategory[];
  readonly overall: number;
  readonly rank: string | null;
  readonly complete: boolean;
}

/** Le nom des 18 scénarios d'un palier, pour valider une saisie. */
export function scenarioNames(tier: TierId): ReadonlySet<string> {
  return new Set(listScenarios(tier).map((scenario) => scenario.name));
}

/** Les 9 sous-catégories d'un palier et leur énergie pour des scores donnés. */
export function computeSubcategories(
  tier: TierId,
  scores: ScoreMap,
): readonly ComputedSubcategory[] {
  return listSubcategories(tier).map((subcategory) => ({
    name: subcategory.name,
    energy: subcategoryEnergy(tier, subcategory.name, scores),
  }));
}

/** Calcule énergies, overall, rang et badge « Complete » d'une passe. */
export function computeBenchRun(tier: TierId, scores: ScoreMap): ComputedBenchRun {
  const computedScores: ComputedScenarioScore[] = [];

  for (const scenario of listScenarios(tier)) {
    const score = scores[scenario.name];

    if (score === undefined) continue;
    computedScores.push({
      scenario: scenario.name,
      score,
      energy: scenarioEnergy(tier, scenario.name, score),
    });
  }

  const subcategories = computeSubcategories(tier, scores);
  const overall = overallEnergy(subcategories.map((subcategory) => subcategory.energy));
  const rank = rankFor(tier, overall);

  return {
    scores: computedScores,
    subcategories,
    overall,
    rank,
    // Le badge n'a de sens qu'au rang atteint : sans rang, pas de « Complete ».
    complete: rank !== null && isComplete(tier, rank, scores),
  };
}
