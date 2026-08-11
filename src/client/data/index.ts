/**
 * Couche données du client : Supabase et rien d'autre.
 *
 * Les vues n'importent que ce module ; elles ne connaissent ni PostgREST, ni
 * les noms de colonnes, ni la forme des erreurs Supabase.
 */

export {
  AdminError,
  getAdminSettings,
  getAdminUsage,
  isPlatformAdmin,
  saveAdminSettings,
} from "./admin";
export {
  AiSettingsError,
  deleteAiSettings,
  getAiSettings,
  pollChatGptLink,
  saveAiSettings,
  startChatGptLink,
  testAiSettings,
} from "./ai-settings";
export {
  deleteBenchRun,
  getBenchRunDetail,
  listBenchRuns,
  saveBenchRun,
} from "./bench-runs";
export { listCoachMessages } from "./coach-messages";
export { clearThread, lastUndebriefedMatch, listThreadMessages } from "./coach-thread";
export { debriefedMatches, deleteDebrief, listDebriefs } from "./debriefs";
export { DataError } from "./errors";
export {
  accountsOf,
  displayName,
  importKovaaksScores,
  LinkedAccountError,
  linkKovaaksAccount,
  linkRiotAccount,
  listImportedMatches,
  listLinkedAccounts,
  primaryAccount,
  refreshRiotAccount,
  setPrimaryAccount,
  unlinkAccount,
} from "./linked-accounts";
export type {
  KovaaksImportResponse,
  LinkedAccount,
  MatchSummary,
  MissingScenario,
  MmrSummary,
  Provider,
  RefreshResponse,
} from "./linked-accounts-contract";
export { formatRiotId, parseRiotId, type RiotId } from "./linked-accounts-mapping";
export { getProfile, updateProfile } from "./profile";
export { deleteRoutine, listRoutines, setRoutineDone } from "./routines";
export type {
  BenchRunDetail,
  BenchRunSummary,
  BenchSource,
  Profile,
  SaveBenchRunInput,
  ScenarioScore,
  SubcategoryEnergy,
} from "./types";
export { ValorantError } from "./valorant-call";
export type {
  MatchDetail,
  MatchDetailResponse,
  RoundOutcome,
  ScoreboardEntry,
  Side,
  SidePerformance,
  Team,
} from "./valorant-match";
export { analyzeMatch, getMatchDetail } from "./valorant-match";
export type {
  StatBreakdown,
  StatPeriods,
  StatTotals,
  TrendPoint,
  ValorantStats,
  ValorantStatsResponse,
} from "./valorant-stats";
export { getValorantStats } from "./valorant-stats";
