/**
 * Orchestration du moteur d'énergie pour une passe de bench.
 *
 * Aucun calcul n'est refait ici : tout vient de la **formule du benchmark**,
 * résolue par `formulas.ts`. Ce module vit dans la lib pure (et non côté
 * client) parce qu'il n'a ni I/O ni dépendance : la saisie live du tracker et
 * l'écriture en base appellent la **même** fonction, donc l'aperçu ne peut pas
 * diverger de ce qui est enregistré.
 *
 * Chaque fonction existe en deux formes (SPEC §5 quinquies) :
 *
 * - `…For(benchmarkId, …)` — **la lecture d'une passe enregistrée**, résolue
 *   avec les seuils *et la formule* du benchmark de cette passe ;
 * - la forme historique sans benchmark — la saisie et l'aperçu, qui parlent du
 *   présent et résolvent donc le benchmark actif.
 *
 * Les variantes qualifiées passent par `withBenchmark` plutôt que par une
 * seconde implémentation : la formule reste le seul endroit où une énergie se
 * calcule.
 */

import { activeBenchmark, type BenchmarkId, withBenchmark } from "./benchmarks.js";
import { listScenarios, listScenariosFor, listSubcategories } from "./data.js";
import { type EnergyFormula, formulaFor } from "./formulas.js";
import type { Rank, ScoreMap, TierId } from "./types.js";

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
  /** Uniquement les scénarios renseignés, dans l'ordre du tableur du benchmark. */
  readonly scores: readonly ComputedScenarioScore[];
  /** Toutes les sous-catégories du palier, y compris celles à 0. */
  readonly subcategories: readonly ComputedSubcategory[];
  readonly overall: number;
  readonly rank: string | null;
  readonly complete: boolean;
}

/**
 * La formule du benchmark actif.
 *
 * C'est le point de branchement : les fonctions non qualifiées la résolvent au
 * moment du calcul, et `withBenchmark` fait que les variantes `…For` la
 * résolvent sur le benchmark de la passe. Un seul endroit décide donc *avec
 * quoi* on calcule, et c'est le même que celui qui décide *avec quels seuils*.
 */
function activeFormula(): EnergyFormula {
  return formulaFor(activeBenchmark());
}

/**
 * Le rang overall atteint (objet complet, couleur incluse) aux seuils de
 * `benchmarkId`, ou `null`.
 *
 * Les rangs et *leurs couleurs* appartiennent au benchmark : afficher une passe
 * S5 avec la palette d'un autre serait déjà une réinterprétation.
 */
export function findRankFor(benchmarkId: BenchmarkId, tier: TierId, overall: number): Rank | null {
  return withBenchmark(benchmarkId, () => activeFormula().findRank(tier, overall));
}

/** Le nom des scénarios d'un palier d'un benchmark donné. */
export function scenarioNamesFor(benchmarkId: BenchmarkId, tier: TierId): ReadonlySet<string> {
  return new Set(listScenariosFor(benchmarkId, tier).map((scenario) => scenario.name));
}

/** Le nom des scénarios d'un palier, pour valider une saisie. */
export function scenarioNames(tier: TierId): ReadonlySet<string> {
  return scenarioNamesFor(activeBenchmark(), tier);
}

/** Les sous-catégories d'un palier et leur énergie, aux seuils de `benchmarkId`. */
export function computeSubcategoriesFor(
  benchmarkId: BenchmarkId,
  tier: TierId,
  scores: ScoreMap,
): readonly ComputedSubcategory[] {
  return withBenchmark(benchmarkId, () => computeSubcategories(tier, scores));
}

/** Les sous-catégories d'un palier et leur énergie pour des scores donnés. */
export function computeSubcategories(
  tier: TierId,
  scores: ScoreMap,
): readonly ComputedSubcategory[] {
  const formula = activeFormula();

  return listSubcategories(tier).map((subcategory) => ({
    name: subcategory.name,
    energy: formula.subcategoryEnergy(tier, subcategory.name, scores),
  }));
}

/** Énergies, overall, rang et badge « Complete » aux seuils de `benchmarkId`. */
export function computeBenchRunFor(
  benchmarkId: BenchmarkId,
  tier: TierId,
  scores: ScoreMap,
): ComputedBenchRun {
  return withBenchmark(benchmarkId, () => computeBenchRun(tier, scores));
}

/** Calcule énergies, overall, rang et badge « Complete » d'une passe. */
export function computeBenchRun(tier: TierId, scores: ScoreMap): ComputedBenchRun {
  const formula = activeFormula();
  const computedScores: ComputedScenarioScore[] = [];

  for (const scenario of listScenarios(tier)) {
    const score = scores[scenario.name];

    if (score === undefined) continue;
    computedScores.push({
      scenario: scenario.name,
      score,
      energy: formula.scenarioEnergy(tier, scenario.name, score),
    });
  }

  const subcategories = computeSubcategories(tier, scores);
  const overall = formula.overallEnergy(subcategories.map((subcategory) => subcategory.energy));
  const rank = formula.rankFor(tier, overall);

  return {
    scores: computedScores,
    subcategories,
    overall,
    rank,
    // Le badge n'a de sens qu'au rang atteint : sans rang, pas de « Complete ».
    complete: rank !== null && formula.isComplete(tier, rank, scores),
  };
}
