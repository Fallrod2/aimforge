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
 * `registerEnergyFormula`) ne sont volontairement **pas** réexportés ici : le
 * code applicatif n'a aucune raison de déposer un benchmark ou une formule.
 *
 * `setCurrentBenchmark`, lui, l'est — sous le nom `syncCurrentBenchmark`, qui
 * dit à quoi il sert : aligner le benchmark courant sur le benchmark **actif**
 * de l'utilisateur (`profiles.active_benchmark`, DECISIONS.md D6). Sans lui,
 * tout ce qui parle du présent sans nommer de benchmark — saisie du tracker,
 * aperçu live, rails d'énergie, libellés de scénarios — resterait sur le
 * benchmark par défaut pendant que l'écran en affiche un autre. Il n'a que deux
 * appelants légitimes : le provider de benchmark actif au boot, et le sélecteur.
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
  setCurrentBenchmark as syncCurrentBenchmark,
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
export { type PartialEnergy, partialEnergy } from "./partial.js";
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
