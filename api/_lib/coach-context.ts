/**
 * Le contexte que le coach lit en base : le profil du joueur et ses benchs,
 * résumés à la forme que les prompts attendent.
 *
 * Il vit ici plutôt que dans `api/coach.ts` depuis que **deux** fonctions en
 * ont besoin : le debrief (`api/coach.ts`) et le chat (`api/coach-chat.ts`,
 * SPEC §5 ter bis). Deux copies auraient dérivé, et la dérive se serait vue à
 * l'endroit le plus coûteux — le palier retenu, qui décide de la liste des
 * scénarios que le modèle a le droit de citer.
 *
 * Le bench se lit d'une seule façon, et ce n'est pas du confort :
 * `loadBenchTiers` rend **la dernière passe de chaque palier mesuré**. Tous les
 * prompts du coach la lisent depuis qu'un joueur ayant terminé Novice et
 * Intermediate puis commencé une passe Advanced s'est entendu répondre que ses
 * deux paliers terminés n'existaient pas : la lecture ne rapportait alors que
 * la passe la plus récente, et elle les masquait.
 *
 * Deux règles portées ici, et elles valent pour tous les appelants :
 *
 * 1. **la lecture passe par le client de l'appelant**, jamais par la service
 *    key. La RLS s'applique donc exactement comme dans le navigateur ;
 * 2. **une lecture qui échoue rend `null`**. Le profil et le bench sont du
 *    *contexte*, pas des prérequis : les faire échouer annulerait une requête
 *    dont le quota est déjà consommé, pour un debrief qui aurait juste été un
 *    peu moins précis.
 *
 * Le préfixe `_` sort ce fichier du routage Vercel : il est importé, jamais
 * appelé en HTTP.
 */

import type { createClient } from "@supabase/supabase-js";
import type { Database } from "../../src/client/supabase/database-types.js";
import {
  type BenchmarkId,
  DEFAULT_BENCHMARK_ID,
  firstTierFor,
  type TierId,
  tierIdsFor,
  toBenchmarkId,
} from "../../src/lib/energy/index.js";
import {
  type BenchRunForCoach,
  type ScenarioScoreForCoach,
  summarizeTierBench,
} from "../../src/server/coach/bench.js";
import type { CoachBenchTiers, CoachProfile } from "../../src/server/coach/prompt.js";
import { DEFAULT_GAME, toGameId } from "../../src/shared/game-vocab.js";

/** Le client Supabase monté avec le JWT de l'appelant. */
export type CoachUserClient = ReturnType<typeof createClient<Database>>;

/**
 * Palier retenu quand le joueur n'a aucune passe : le plus bas de **son**
 * benchmark actif.
 *
 * Mieux vaut la liste du premier palier qu'aucune liste — sans elle, le modèle
 * n'a plus de noms à citer et se remet à en inventer. Il est lu dans le registre
 * plutôt qu'écrit en dur : « novice » est un palier de Voltaic, pas une
 * constante du domaine (DECISIONS.md D5).
 *
 * C'est une fonction depuis que le benchmark actif est une préférence de
 * l'utilisateur (D6) : une constante de module aurait figé le repli sur le
 * premier palier du benchmark par défaut, donc proposé au joueur le catalogue
 * d'un barème qu'il ne joue pas.
 *
 * Elle est exportée parce que cinq points d'entrée (`api/coach`,
 * `api/coach-chat`, `api/coach-thread`, `api/routine`, l'analyse de match)
 * doivent choisir le même repli : deux copies décideraient un jour de deux
 * catalogues différents.
 */
export function defaultTierFor(benchmarkId: BenchmarkId): TierId {
  return firstTierFor(benchmarkId);
}

/**
 * Les préférences du profil que le contexte serveur lit : le vocabulaire et le
 * barème (migration `0019`, DECISIONS.md D6 et D7).
 *
 * Elles voyagent avec le profil parce qu'elles viennent de la même ligne et de
 * la même lecture. Elles n'entrent pas dans le bloc `<profil>` du prompt : ce
 * ne sont pas des données que le joueur a écrites, ce sont des réglages qui
 * décident de la façon dont le prompt est rédigé.
 */
export const DEFAULT_PREFERENCES = {
  game: DEFAULT_GAME,
  activeBenchmark: DEFAULT_BENCHMARK_ID,
} as const;

/**
 * Le benchmark de la passe, ou `null` si le registre ne le connaît pas.
 *
 * Le bench est du *contexte* : un benchmark inconnu le fait disparaître du
 * prompt (comme un palier inconnu), il ne fait pas échouer un debrief dont le
 * quota est déjà consommé. Ce qu'on refuse, c'est de résumer une passe avec les
 * seuils d'un autre benchmark.
 */
function toKnownBenchmark(value: string): BenchmarkId | null {
  try {
    return toBenchmarkId(value);
  } catch {
    return null;
  }
}

/**
 * Le profil du joueur, préférences comprises.
 *
 * `null` quand la lecture échoue — comme partout ici, le profil est du contexte.
 * L'appelant retombe alors sur `DEFAULT_PREFERENCES` : un debrief rédigé dans le
 * vocabulaire par défaut vaut mieux qu'un debrief annulé après consommation du
 * quota.
 *
 * Le benchmark actif est validé par le registre et retombe sur le défaut s'il
 * lui est inconnu. Le raisonnement n'est pas celui du benchmark d'une passe
 * (qui décide de la relecture de chiffres enregistrés, et où un repli
 * fabriquerait des valeurs fausses) : ici il ne décide que du barème dont on
 * parle et des paliers qu'on lit.
 */
export async function loadProfile(
  client: CoachUserClient,
  userId: string,
): Promise<CoachProfile | null> {
  const { data, error } = await client
    .from("profiles")
    .select("pseudo, rang_valorant, peak, main_agent, objectif, notes_maps, game, active_benchmark")
    .eq("user_id", userId)
    .maybeSingle();

  if (error !== null || data === null) return null;
  return {
    pseudo: data.pseudo,
    rangValorant: data.rang_valorant,
    peak: data.peak,
    mainAgent: data.main_agent,
    objectif: data.objectif,
    notesMaps: data.notes_maps,
    game: toGameId(data.game),
    activeBenchmark: toKnownBenchmark(data.active_benchmark) ?? DEFAULT_BENCHMARK_ID,
  };
}

/** Les préférences d'un profil, ou celles par défaut s'il n'a pas pu être lu. */
export function preferencesOf(profile: CoachProfile | null): {
  readonly game: CoachProfile["game"];
  readonly activeBenchmark: BenchmarkId;
} {
  return profile === null
    ? DEFAULT_PREFERENCES
    : { game: profile.game, activeBenchmark: profile.activeBenchmark };
}

/** Une passe et ses scores, telle que la base les rend. */
export interface BenchRunWithScores {
  readonly run: BenchRunForCoach;
  readonly scores: readonly ScenarioScoreForCoach[];
}

/** Les dernières passes du joueur, une par palier mesuré. */
export interface LatestBenchRuns {
  /** Du palier le plus bas au plus haut ; seuls ceux qui ont une passe. */
  readonly runs: readonly BenchRunWithScores[];
  /** Le palier de la passe la plus récente ; `null` sans aucune passe. */
  readonly latestTier: TierId | null;
}

/** Une passe retenue, avec de quoi départager deux passes du même jour. */
interface DatedRun extends BenchRunWithScores {
  readonly id: number;
}

/**
 * La dernière passe d'un palier donné, scores compris.
 *
 * Une requête par palier plutôt qu'une fenêtre de N passes triée en mémoire :
 * un joueur qui enchaîne les passes Advanced ferait sortir sa passe Novice de
 * la fenêtre, et le palier terminé disparaîtrait à nouveau du contexte — ce qui
 * est exactement le défaut qu'on corrige.
 *
 * Comme partout dans ce module, une lecture en échec rend `null` : le bench est
 * du contexte, et un palier illisible en fait perdre un, pas tous.
 */
async function loadTierRun(
  client: CoachUserClient,
  userId: string,
  activeBenchmark: BenchmarkId,
  tier: TierId,
): Promise<DatedRun | null> {
  const { data: run, error } = await client
    .from("bench_runs")
    .select("id, date, tier, overall, rank, complete, benchmark_id")
    // Le filtre par benchmark n'est pas un confort : sans lui, une passe d'un
    // autre barème pourrait être la plus récente d'un palier, et le coach
    // commenterait des énergies qui ne se comparent pas à celles du barème que
    // le joueur travaille aujourd'hui (DECISIONS.md D6).
    .eq("benchmark_id", activeBenchmark)
    .eq("user_id", userId)
    .eq("tier", tier)
    .order("date", { ascending: false })
    .order("id", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error !== null || run === null) return null;

  // La colonne est `benchmark_id` (migration 0017) ; le champ métier est
  // `benchmarkId` partout ailleurs. Revalidé même après le filtre : la requête
  // dit ce qu'on a demandé, le registre dit ce qu'on sait relire.
  const benchmarkId = toKnownBenchmark(run.benchmark_id);

  if (benchmarkId === null) return null;

  const { data: scores } = await client
    .from("scenario_scores")
    .select("scenario, score")
    .eq("run_id", run.id);

  return {
    id: run.id,
    run: {
      tier,
      benchmarkId,
      date: run.date,
      overall: run.overall,
      rank: run.rank,
      complete: run.complete,
    },
    scores: scores ?? [],
  };
}

/**
 * La dernière passe de **chaque** palier mesuré du benchmark actif, dans l'ordre
 * de ce benchmark.
 *
 * Les paliers itérés sont ceux du benchmark actif et non ceux du benchmark par
 * défaut : un autre barème peut en avoir d'autres, ou moins (DECISIONS.md D5).
 *
 * Les lectures partent ensemble : elles ne dépendent pas les unes des autres.
 */
export async function loadLatestBenchRuns(
  client: CoachUserClient,
  userId: string,
  activeBenchmark: BenchmarkId,
): Promise<LatestBenchRuns> {
  const loaded = await Promise.all(
    tierIdsFor(activeBenchmark).map((tier) => loadTierRun(client, userId, activeBenchmark, tier)),
  );
  const found = loaded.flatMap((entry) => (entry === null ? [] : [entry]));
  // « La plus récente » se départage comme la lecture d'avant : date, puis id.
  // Deux passes enregistrées le même jour doivent quand même s'ordonner.
  const latest = found.reduce<DatedRun | null>(
    (best, entry) =>
      best === null ||
      entry.run.date > best.run.date ||
      (entry.run.date === best.run.date && entry.id > best.id)
        ? entry
        : best,
    null,
  );

  return {
    runs: found.map((entry) => ({ run: entry.run, scores: entry.scores })),
    latestTier: latest?.run.tier ?? null,
  };
}

/**
 * Le bench servi aux prompts : la dernière passe de chaque palier, résumée.
 *
 * C'est le seul chargeur de bench du coach depuis qu'un joueur a demandé
 * « vérifie mon bench » et s'est entendu répondre que ses paliers Novice et
 * Intermediate n'existaient pas — ils existaient, mais une passe Advanced plus
 * récente était la seule que la lecture rapportait.
 */
export async function loadBenchTiers(
  client: CoachUserClient,
  userId: string,
  activeBenchmark: BenchmarkId,
): Promise<CoachBenchTiers> {
  const { runs, latestTier } = await loadLatestBenchRuns(client, userId, activeBenchmark);

  return {
    tiers: runs.map((entry) => summarizeTierBench(entry.run, entry.scores)),
    latestTier,
  };
}
