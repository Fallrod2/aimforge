/**
 * Le contexte que le coach lit en base : le profil du joueur et son dernier
 * bench, résumés à la forme que les prompts attendent.
 *
 * Il vit ici plutôt que dans `api/coach.ts` depuis que **deux** fonctions en
 * ont besoin : le debrief (`api/coach.ts`) et le chat (`api/coach-chat.ts`,
 * SPEC §5 ter bis). Deux copies auraient dérivé, et la dérive se serait vue à
 * l'endroit le plus coûteux — le palier retenu, qui décide de la liste des
 * scénarios que le modèle a le droit de citer.
 *
 * Deux règles portées ici, et elles valent pour les deux appelants :
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
import { summarizeBench } from "../../src/server/coach/bench.js";
import type { CoachBenchSummary, CoachProfile } from "../../src/server/coach/prompt.js";

/** Le client Supabase monté avec le JWT de l'appelant. */
export type CoachUserClient = ReturnType<typeof createClient<Database>>;

/**
 * Palier retenu quand le joueur n'a aucune passe : le premier du benchmark.
 *
 * Mieux vaut la liste du palier Novice qu'aucune liste — sans elle, le modèle
 * n'a plus de noms à citer et se remet à en inventer.
 */
export const DEFAULT_TIER: TierId = "novice";

function toTierId(value: string): TierId | null {
  return TIER_IDS.find((id) => id === value) ?? null;
}

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

export async function loadBench(
  client: CoachUserClient,
  userId: string,
): Promise<CoachBenchSummary | null> {
  const { data: run, error } = await client
    .from("bench_runs")
    .select("id, date, tier, overall, rank, complete, season")
    .eq("user_id", userId)
    .order("date", { ascending: false })
    .order("id", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error !== null || run === null) return null;

  const tier = toTierId(run.tier);
  const season = toSeason(run.season);

  if (tier === null || season === null) return null;

  const { data: scores } = await client
    .from("scenario_scores")
    .select("scenario, score")
    .eq("run_id", run.id);

  return summarizeBench(
    {
      tier,
      season,
      date: run.date,
      overall: run.overall,
      rank: run.rank,
      complete: run.complete,
    },
    scores ?? [],
  );
}
