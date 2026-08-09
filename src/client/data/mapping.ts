/**
 * Traduction des lignes Postgres en types d'UI. Module **pur** : ni Supabase,
 * ni React, ni `window` — c'est le seul endroit où une ligne brute peut
 * devenir un `BenchRunSummary`, et il est testable seul.
 *
 * Deux écarts entre la base et l'UI sont traités ici, et nulle part ailleurs :
 *
 * - `bench_runs.tier` est un `text` côté Postgres (la contrainte `check` le
 *   restreint aux trois paliers, mais le type généré ne le sait pas) alors que
 *   l'UI attend un `TierId`. Une valeur hors des trois est une dérive de
 *   schéma, pas une saisie : on lève, on ne devine pas et on ne masque pas ;
 * - `date` est un `timestamptz` que PostgREST rend en `+00:00`. On le
 *   normalise en ISO `Z`, forme sur laquelle l'UI trie lexicographiquement
 *   (`buildSeries`) et que le reste du code a toujours connue.
 */

import { computeSubcategories, listScenarios, TIER_IDS, type TierId } from "../../lib/energy";
import { DataError } from "./errors";
import {
  BENCH_SOURCES,
  type BenchRunDetail,
  type BenchRunSummary,
  type BenchSource,
  type ScenarioScore,
} from "./types";

/** Les colonnes de `bench_runs` que la liste et le détail lisent. */
export interface BenchRunRow {
  readonly id: number;
  readonly date: string;
  readonly tier: string;
  readonly overall: number;
  readonly rank: string | null;
  readonly complete: boolean;
  readonly source: string;
}

/** Les colonnes de `scenario_scores` lues avec une passe. */
export interface ScenarioScoreRow {
  readonly scenario: string;
  readonly score: number;
  readonly energy: number;
}

function toTierId(value: string): TierId {
  const tier = TIER_IDS.find((id) => id === value);

  if (tier === undefined) {
    throw new DataError(`Palier inconnu en base : « ${value} ».`);
  }
  return tier;
}

function toBenchSource(value: string): BenchSource {
  const source = BENCH_SOURCES.find((id) => id === value);

  if (source === undefined) {
    throw new DataError(`Provenance inconnue en base : « ${value} ».`);
  }
  return source;
}

function toIsoDate(value: string): string {
  const time = Date.parse(value);

  if (Number.isNaN(time)) {
    throw new DataError(`Date illisible en base : « ${value} ».`);
  }
  return new Date(time).toISOString();
}

/** Une ligne `bench_runs` → la passe telle que l'affiche l'historique. */
export function toBenchRunSummary(row: BenchRunRow): BenchRunSummary {
  return {
    id: row.id,
    date: toIsoDate(row.date),
    tier: toTierId(row.tier),
    overall: row.overall,
    rank: row.rank,
    complete: row.complete,
    source: toBenchSource(row.source),
  };
}

export function toBenchRunSummaries(rows: readonly BenchRunRow[]): readonly BenchRunSummary[] {
  return rows.map(toBenchRunSummary);
}

/**
 * Les scores dans l'ordre du tableur Voltaic. Postgres ne garantit aucun ordre
 * de retour, et l'UI affiche ces lignes telles quelles : sans ce tri, deux
 * lectures de la même passe pourraient s'afficher différemment. Un scénario
 * inconnu du palier (dérive de données) ferme la marche plutôt que d'être
 * escamoté.
 */
function sortScenarios(tier: TierId, scores: readonly ScenarioScore[]): readonly ScenarioScore[] {
  const order = new Map(listScenarios(tier).map((scenario, index) => [scenario.name, index]));
  const rank = (name: string): number => order.get(name) ?? Number.MAX_SAFE_INTEGER;

  return [...scores].sort(
    (a, b) => rank(a.scenario) - rank(b.scenario) || a.scenario.localeCompare(b.scenario),
  );
}

/**
 * Une passe et ses scores → le détail affiché.
 *
 * Les énergies par scénario sont celles **figées en base** au moment de la
 * saisie ; les énergies par sous-catégorie sont dérivées à la lecture (max des
 * 2 scénarios, moteur d'énergie) car la base ne les stocke pas.
 */
export function toBenchRunDetail(
  row: BenchRunRow,
  scoreRows: readonly ScenarioScoreRow[],
): BenchRunDetail {
  const summary = toBenchRunSummary(row);
  const scores: readonly ScenarioScore[] = scoreRows.map((score) => ({
    scenario: score.scenario,
    score: score.score,
    energy: score.energy,
  }));
  const scoreMap = Object.fromEntries(scores.map((score) => [score.scenario, score.score]));

  return {
    ...summary,
    scores: sortScenarios(summary.tier, scores),
    subcategories: computeSubcategories(summary.tier, scoreMap),
  };
}
