/**
 * Orchestration du moteur d'énergie pour une passe de bench.
 * Aucun calcul n'est refait ici : tout vient de `src/lib/energy`.
 */

import {
  isComplete,
  listScenarios,
  listSubcategories,
  overallEnergy,
  rankFor,
  type ScoreMap,
  scenarioEnergy,
  subcategoryEnergy,
  type TierId,
} from "../../lib/energy";

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

  const subcategories = listSubcategories(tier).map((subcategory) => ({
    name: subcategory.name,
    energy: subcategoryEnergy(tier, subcategory.name, scores),
  }));

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
