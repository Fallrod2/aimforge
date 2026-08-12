/**
 * Moteur d'énergie multi-benchmarks — lib pure (aucune dépendance, aucun I/O).
 * Source de vérité des seuils Voltaic : `voltaic-s5-data.json`, servi par le
 * registre de benchmarks (`benchmarks.ts`, SPEC §5 quinquies, DECISIONS.md D4).
 *
 * Deux surfaces :
 *
 * - les fonctions **sans benchmark** parlent du benchmark courant — c'est la
 *   saisie, l'aperçu live, tout ce qui se rapporte au présent ;
 * - les fonctions **`…For(benchmarkId, …)`** parlent d'un benchmark nommé —
 *   c'est la relecture d'une passe enregistrée, qui doit garder ses seuils et
 *   sa formule d'origine.
 *
 * Les crochets de test des registres (`registerBenchmark`,
 * `setCurrentBenchmark`, `registerEnergyFormula`) ne sont volontairement
 * **pas** réexportés ici : le code applicatif n'a aucune raison de déposer un
 * benchmark ou une formule, ni de changer le benchmark courant à chaud.
 */

export {
  type AimTrainer,
  type BenchmarkDefinition,
  type BenchmarkId,
  type BenchmarkNaming,
  type BenchmarkStatus,
  currentBenchmark,
  DEFAULT_BENCHMARK_ID,
  getBenchmark,
  type KovaaksImport,
  listBenchmarkIds,
  listBenchmarks,
  toBenchmarkId,
} from "./benchmarks.js";
export {
  type ComputedBenchRun,
  type ComputedScenarioScore,
  type ComputedSubcategory,
  computeBenchRun,
  computeBenchRunFor,
  computeSubcategories,
  computeSubcategoriesFor,
  findRankFor,
  scenarioNames,
  scenarioNamesFor,
} from "./compute.js";
export {
  firstTierFor,
  getScenario,
  getScenarioFor,
  getSubcategory,
  getSubcategoryFor,
  getTier,
  getTierFor,
  listScenarios,
  listScenariosFor,
  listSubcategories,
  listSubcategoriesFor,
  listTiersFor,
  META,
  TIERS,
  tierIdsFor,
  toTierId,
} from "./data.js";
export {
  findRank,
  isComplete,
  overallEnergy,
  rankFor,
  SUBCATEGORY_COUNT,
  scenarioEnergy,
  subcategoryEnergy,
} from "./energy.js";
export { type EnergyFormula, formulaFor, getEnergyFormula, VOLTAIC_ANCHORS } from "./formulas.js";
export { normalizedScenarioKey, scenarioDisplayName, scenarioMarkerRegex } from "./naming.js";
export {
  type BenchmarkData,
  type BenchmarkMeta,
  type Category,
  EnergyError,
  type EnergyFormulaId,
  type Rank,
  type Scenario,
  type ScoreMap,
  type Subcategory,
  type Tier,
  type TierId,
} from "./types.js";
