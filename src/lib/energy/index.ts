/**
 * Moteur d'énergie Voltaic S5 — lib pure (aucune dépendance, aucun I/O).
 * Source de vérité : voltaic-s5-data.json.
 */

export {
  type ComputedBenchRun,
  type ComputedScenarioScore,
  type ComputedSubcategory,
  computeBenchRun,
  computeSubcategories,
  scenarioNames,
} from "./compute";
export {
  getScenario,
  getSubcategory,
  getTier,
  listScenarios,
  listSubcategories,
  META,
  TIER_IDS,
  TIERS,
} from "./data";
export {
  findRank,
  isComplete,
  overallEnergy,
  rankFor,
  SUBCATEGORY_COUNT,
  scenarioEnergy,
  subcategoryEnergy,
} from "./energy";
export {
  type Category,
  EnergyError,
  type Rank,
  type Scenario,
  type ScoreMap,
  type Subcategory,
  type Tier,
  type TierId,
  type VoltaicData,
  type VoltaicMeta,
} from "./types";
