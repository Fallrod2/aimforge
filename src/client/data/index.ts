/**
 * Couche données du client : Supabase et rien d'autre.
 *
 * Les vues n'importent que ce module ; elles ne connaissent ni PostgREST, ni
 * les noms de colonnes, ni la forme des erreurs Supabase.
 */

export {
  deleteBenchRun,
  getBenchRunDetail,
  listBenchRuns,
  saveBenchRun,
} from "./bench-runs";
export { deleteDebrief, listDebriefs } from "./debriefs";
export { DataError } from "./errors";
export { getProfile, updateProfile } from "./profile";
export type {
  BenchRunDetail,
  BenchRunSummary,
  Profile,
  SaveBenchRunInput,
  ScenarioScore,
  SubcategoryEnergy,
} from "./types";
