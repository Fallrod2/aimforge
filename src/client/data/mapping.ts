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
 *
 * Depuis le verrou multi-benchmarks (SPEC §5 quinquies), c'est aussi ici que la
 * colonne `benchmark_id` devient un `BenchmarkId` **validé** : tout ce qui est dérivé
 * à la lecture (les 9 sous-catégories, l'ordre des scénarios) l'est avec les
 * seuils du benchmark de la passe, jamais avec ceux du benchmark courant. Un
 * benchmark absent du registre lève (`EnergyError`) : un repli silencieux sur le
 * courant afficherait des énergies fausses sans le dire.
 *
 * La colonne lue est `benchmark_id` (migration `0017`). L'ancienne colonne
 * `season` existe encore et un trigger la garde synchrone, le temps que `0018`
 * la supprime (expand/contract) : ce module ne la lit plus, et le champ métier
 * s'appelle `benchmarkId` partout — la traduction se fait ici, une fois, plutôt
 * que d'être répétée dans chaque vue.
 */

import {
  type BenchmarkId,
  computeSubcategoriesFor,
  listScenariosFor,
  type TierId,
  toBenchmarkId,
  toTierId,
} from "../../lib/energy";
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
  /** Le benchmark de la passe ; le champ métier correspondant est `benchmarkId`. */
  readonly benchmark_id: string;
}

/** Les colonnes de `scenario_scores` lues avec une passe. */
export interface ScenarioScoreRow {
  readonly scenario: string;
  readonly score: number;
  readonly energy: number;
}

/**
 * Le palier de la passe, validé **contre son benchmark** (DECISIONS.md D5) :
 * « novice » n'est pas un palier dans l'absolu, c'en est un dans Voltaic S5.
 *
 * La validation vient du registre, l'erreur reste une `DataError` : c'est la
 * convention de ce module (« Provenance inconnue en base », « Date illisible en
 * base »), et l'écran affiche `error.message` tel quel.
 */
function benchTierId(benchmarkId: BenchmarkId, value: string): TierId {
  try {
    return toTierId(benchmarkId, value);
  } catch (cause) {
    throw new DataError(`Palier inconnu en base : « ${value} ».`, cause);
  }
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
  // `toBenchmarkId` lève une `EnergyError` sur un benchmark inconnu du registre.
  // C'est voulu : mieux vaut une passe qui refuse de s'afficher qu'une passe
  // affichée avec les seuils d'un autre benchmark. Il est résolu en premier :
  // le palier se valide contre lui.
  const benchmarkId = toBenchmarkId(row.benchmark_id);

  return {
    id: row.id,
    date: toIsoDate(row.date),
    tier: benchTierId(benchmarkId, row.tier),
    benchmarkId,
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
function sortScenarios(
  benchmarkId: BenchmarkId,
  tier: TierId,
  scores: readonly ScenarioScore[],
): readonly ScenarioScore[] {
  const order = new Map(
    listScenariosFor(benchmarkId, tier).map((scenario, index) => [scenario.name, index]),
  );
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
 * 2 scénarios, moteur d'énergie) car la base ne les stocke pas — d'où
 * l'obligation de les dériver avec les seuils de `summary.benchmarkId`.
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
    scores: sortScenarios(summary.benchmarkId, summary.tier, scores),
    subcategories: computeSubcategoriesFor(summary.benchmarkId, summary.tier, scoreMap),
  };
}
