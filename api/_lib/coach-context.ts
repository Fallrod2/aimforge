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
import { type SeasonId, TIER_IDS, type TierId, toSeasonId } from "../../src/lib/energy/index.js";
import {
  type BenchRunForCoach,
  type ScenarioScoreForCoach,
  summarizeTierBench,
} from "../../src/server/coach/bench.js";
import type { CoachBenchTiers, CoachProfile } from "../../src/server/coach/prompt.js";

/** Le client Supabase monté avec le JWT de l'appelant. */
export type CoachUserClient = ReturnType<typeof createClient<Database>>;

/**
 * Palier retenu quand le joueur n'a aucune passe : le premier du benchmark.
 *
 * Mieux vaut la liste du palier Novice qu'aucune liste — sans elle, le modèle
 * n'a plus de noms à citer et se remet à en inventer.
 */
export const DEFAULT_TIER: TierId = "novice";

/**
 * La saison de la passe, ou `null` si le registre ne la connaît pas.
 *
 * Le bench est du *contexte* : une saison inconnue le fait disparaître du
 * prompt (comme un palier inconnu), elle ne fait pas échouer un debrief dont le
 * quota est déjà consommé. Ce qu'on refuse, c'est de résumer une passe avec les
 * seuils d'une autre saison.
 */
function toSeason(value: string): SeasonId | null {
  try {
    return toSeasonId(value);
  } catch {
    return null;
  }
}

export async function loadProfile(
  client: CoachUserClient,
  userId: string,
): Promise<CoachProfile | null> {
  const { data, error } = await client
    .from("profiles")
    .select("pseudo, rang_valorant, peak, main_agent, objectif, notes_maps")
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
  };
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
  tier: TierId,
): Promise<DatedRun | null> {
  const { data: run, error } = await client
    .from("bench_runs")
    .select("id, date, tier, overall, rank, complete, season")
    .eq("user_id", userId)
    .eq("tier", tier)
    .order("date", { ascending: false })
    .order("id", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error !== null || run === null) return null;

  const season = toSeason(run.season);

  if (season === null) return null;

  const { data: scores } = await client
    .from("scenario_scores")
    .select("scenario, score")
    .eq("run_id", run.id);

  return {
    id: run.id,
    run: {
      tier,
      season,
      date: run.date,
      overall: run.overall,
      rank: run.rank,
      complete: run.complete,
    },
    scores: scores ?? [],
  };
}

/**
 * La dernière passe de **chaque** palier mesuré, dans l'ordre du benchmark.
 *
 * Les trois lectures partent ensemble : elles ne dépendent pas les unes des
 * autres, et le contexte du coach est déjà chargé en parallèle du profil.
 */
export async function loadLatestBenchRuns(
  client: CoachUserClient,
  userId: string,
): Promise<LatestBenchRuns> {
  const loaded = await Promise.all(TIER_IDS.map((tier) => loadTierRun(client, userId, tier)));
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
): Promise<CoachBenchTiers> {
  const { runs, latestTier } = await loadLatestBenchRuns(client, userId);

  return {
    tiers: runs.map((entry) => summarizeTierBench(entry.run, entry.scores)),
    latestTier,
  };
}
