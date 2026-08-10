/**
 * Moteur d'énergie Voltaic — lib pure (aucune dépendance, aucun I/O).
 * Source de vérité : `voltaic-s5-data.json`, servi par le registre de saisons
 * (`seasons.ts`, SPEC §5 quinquies).
 *
 * Deux surfaces :
 *
 * - les fonctions **sans saison** parlent de la saison courante — c'est la
 *   saisie, l'aperçu live, tout ce qui se rapporte au présent ;
 * - les fonctions **`…For(season, …)`** parlent d'une saison nommée — c'est la
 *   relecture d'une passe enregistrée, qui doit garder ses seuils d'origine.
 *
 * Les crochets de test du registre (`registerSeason`, `setCurrentSeason`) ne
 * sont volontairement **pas** réexportés ici : le code applicatif n'a aucune
 * raison de déposer une saison ni de changer la saison courante à chaud.
 */

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
  TIER_IDS,
  TIERS,
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
export {
  CURRENT_SEASON,
  currentSeason,
  getSeason,
  type KovaaksSeason,
  listSeasons,
  type SeasonDefinition,
  type SeasonId,
  toSeasonId,
} from "./seasons.js";
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
} from "./types.js";
