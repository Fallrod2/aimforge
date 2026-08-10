/**
 * Orchestration du moteur d'énergie pour une passe de bench.
 *
 * Aucun calcul n'est refait ici : tout vient de `./energy`. Ce module vit dans
 * la lib pure (et non côté client) parce qu'il n'a ni I/O ni dépendance : la
 * saisie live du tracker et l'écriture en base appellent la **même** fonction,
 * donc l'aperçu ne peut pas diverger de ce qui est enregistré.
 *
 * Chaque fonction existe en deux formes (SPEC §5 quinquies) :
 *
 * - `…For(season, …)` — **la lecture d'une passe enregistrée**, résolue avec
 *   les seuils de la saison de cette passe ;
 * - la forme historique sans saison — la saisie et l'aperçu, qui parlent du
 *   présent et résolvent donc la saison active.
 *
 * Les variantes qualifiées passent par `withSeason` plutôt que par une seconde
 * implémentation : `energy.ts` reste le seul endroit où une énergie se calcule.
 */

import {
  listScenarios,
  listScenariosFor,
  listSubcategories,
  listSubcategoriesFor,
} from "./data.js";
import {
  findRank,
  isComplete,
  overallEnergy,
  rankFor,
  scenarioEnergy,
  subcategoryEnergy,
} from "./energy.js";
import { activeSeason, type SeasonId, withSeason } from "./seasons.js";
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
  /** Uniquement les scénarios renseignés, dans l'ordre du tableur Voltaic. */
  readonly scores: readonly ComputedScenarioScore[];
  /** Les 9 sous-catégories, y compris celles à 0. */
  readonly subcategories: readonly ComputedSubcategory[];
  readonly overall: number;
  readonly rank: string | null;
  readonly complete: boolean;
}

/**
 * Le rang overall atteint (objet complet, couleur incluse) aux seuils de
 * `season`, ou `null`.
 *
 * Les rangs et *leurs couleurs* appartiennent à la saison : afficher une passe
 * S5 avec la palette S6 serait déjà une réinterprétation.
 */
export function findRankFor(season: SeasonId, tier: TierId, overall: number): Rank | null {
  return withSeason(season, () => findRank(tier, overall));
}

/** Le nom des 18 scénarios d'un palier d'une saison donnée. */
export function scenarioNamesFor(season: SeasonId, tier: TierId): ReadonlySet<string> {
  return new Set(listScenariosFor(season, tier).map((scenario) => scenario.name));
}

/** Le nom des 18 scénarios d'un palier, pour valider une saisie. */
export function scenarioNames(tier: TierId): ReadonlySet<string> {
  return scenarioNamesFor(activeSeason(), tier);
}

/** Les 9 sous-catégories d'un palier et leur énergie, aux seuils de `season`. */
export function computeSubcategoriesFor(
  season: SeasonId,
  tier: TierId,
  scores: ScoreMap,
): readonly ComputedSubcategory[] {
  return withSeason(season, () =>
    listSubcategoriesFor(season, tier).map((subcategory) => ({
      name: subcategory.name,
      energy: subcategoryEnergy(tier, subcategory.name, scores),
    })),
  );
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

/** Énergies, overall, rang et badge « Complete » aux seuils de `season`. */
export function computeBenchRunFor(
  season: SeasonId,
  tier: TierId,
  scores: ScoreMap,
): ComputedBenchRun {
  return withSeason(season, () => computeBenchRun(tier, scores));
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
