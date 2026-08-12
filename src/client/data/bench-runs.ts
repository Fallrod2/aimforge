/**
 * Accès aux passes de bench. Le client parle directement à Postgres via
 * Supabase : il n'y a plus d'API intermédiaire, c'est la RLS qui isole les
 * utilisateurs (`auth.uid() = user_id`, cf. `supabase/migrations/`).
 *
 * Deux conséquences structurantes de la disparition du serveur :
 *
 * 1. **Les énergies sont calculées ici**, avant l'écriture, par la lib pure
 *    (`computeBenchRun`) — la même fonction que l'aperçu live du tracker.
 * 2. **Il n'y a pas de transaction.** Une passe s'écrit en deux insertions
 *    (`bench_runs` puis `scenario_scores`) et rien ne les lie côté client. Si
 *    la seconde échoue, la première laisserait une passe vide, affichée dans
 *    l'historique avec un overall figé et zéro scénario. On compense donc :
 *    la passe orpheline est supprimée avant de remonter l'erreur. C'est
 *    l'unique raison pour laquelle l'écriture est découpée derrière un port
 *    (`BenchRunStore`) — ce chemin d'échec doit être testable sans base.
 */

import {
  type BenchmarkId,
  computeBenchRun,
  currentBenchmark,
  scenarioNames,
  type TierId,
} from "../../lib/energy";
import { supabase } from "../supabase/client";
import { DataError, queryError } from "./errors";
import {
  type BenchRunRow,
  type ScenarioScoreRow,
  toBenchRunDetail,
  toBenchRunSummaries,
} from "./mapping";
import { currentUserId } from "./session";
import type { BenchRunDetail, BenchRunSummary, BenchSource, SaveBenchRunInput } from "./types";

/**
 * La colonne du benchmark s'appelle encore `season`.
 *
 * La migration `0017` a ajouté `benchmark_id` et un trigger qui garde les deux
 * colonnes identiques, précisément pour que le client déployé continue de
 * fonctionner pendant la bascule ; `0018` supprimera `season` **après** le
 * déploiement de ce code (expand/contract). Tant que ce n'est pas fait, on lit
 * et on écrit `season` — le champ métier, lui, s'appelle `benchmarkId` partout
 * ailleurs, et la traduction vit dans `mapping.ts` et dans `supabaseStore`.
 */
const RUN_COLUMNS = "id, date, tier, overall, rank, complete, source, season";
const SCORE_COLUMNS = "scenario, score, energy";

const RUN_NOT_FOUND = "Passe introuvable : elle a peut-être été supprimée.";
const SCORES_FAILED = "Les scores n'ont pas pu être enregistrés.";

/* ------------------------------------------------------------------ */
/* Écriture : port, compensation, implémentation Supabase              */
/* ------------------------------------------------------------------ */

/** Ce qu'une passe a besoin de savoir écrire. Une seule implémentation réelle. */
export interface BenchRunStore {
  /** Insère la passe et rend la ligne créée (identifiant et date de la base). */
  insertRun(run: {
    readonly tier: string;
    readonly date: string | undefined;
    readonly overall: number;
    readonly rank: string | null;
    readonly complete: boolean;
    readonly source: BenchSource;
    /** Benchmark estampillé à l'écriture ; jamais déduit à la lecture. */
    readonly benchmarkId: BenchmarkId;
  }): Promise<BenchRunRow>;
  /** Insère les scores d'une passe, en un seul lot. */
  insertScores(runId: number, scores: readonly ScenarioScoreRow[]): Promise<void>;
  /** Compensation : supprime une passe dont les scores n'ont pas pu s'écrire. */
  deleteRun(runId: number): Promise<void>;
}

/**
 * Enregistre une passe dans le magasin donné.
 *
 * Exportée (plutôt que fermée sur le magasin Supabase) pour que la
 * compensation soit vérifiable par un faux magasin, sans base ni DOM.
 */
export async function saveBenchRunTo(
  store: BenchRunStore,
  input: SaveBenchRunInput,
): Promise<BenchRunDetail> {
  const { tier, scores } = input;
  const known = scenarioNames(tier);

  for (const name of Object.keys(scores)) {
    if (!known.has(name)) {
      throw new DataError(`Scénario inconnu pour le palier ${tier} : « ${name} ».`);
    }
  }

  const computed = computeBenchRun(tier, scores);

  if (computed.scores.length === 0) {
    throw new DataError("Aucun score à enregistrer.");
  }

  const run = await store.insertRun({
    tier,
    date: input.date === undefined ? undefined : new Date(input.date).toISOString(),
    overall: computed.overall,
    rank: computed.rank,
    complete: computed.complete,
    // Une passe dont personne n'a dit d'où elle vient a été tapée à la main :
    // c'est le seul défaut qui ne surestime pas ce qu'on sait de la donnée.
    source: input.source ?? "manual",
    // Le benchmark n'est pas un choix de l'appelant : on enregistre ce qui est
    // joué aujourd'hui, avec les seuils qui ont servi à calculer les énergies
    // trois lignes plus haut (SPEC §5 quinquies).
    benchmarkId: currentBenchmark(),
  });

  try {
    await store.insertScores(run.id, computed.scores);
  } catch (cause) {
    // La passe est déjà en base et n'a aucun scénario : la laisser serait pire
    // que l'échec lui-même (une ligne d'historique définitivement vide).
    const why = cause instanceof DataError ? cause.message : SCORES_FAILED;

    try {
      await store.deleteRun(run.id);
    } catch {
      throw new DataError(
        `${why} La passe ${run.id} n'a pas pu être annulée : supprime-la depuis l'historique.`,
        cause,
      );
    }
    // La compensation a réussi : le dire, sinon l'utilisateur ressaisit ses 18
    // scores en craignant d'avoir laissé une passe à moitié écrite derrière lui.
    throw new DataError(`${why} Rien n'a été gardé.`, cause);
  }

  return toBenchRunDetail(run, computed.scores);
}

/** Le magasin réel : deux tables Supabase, sans transaction (cf. en-tête). */
function supabaseStore(userId: string): BenchRunStore {
  return {
    async insertRun(run) {
      const { data, error } = await supabase
        .from("bench_runs")
        .insert({
          user_id: userId,
          tier: run.tier,
          // Colonne `default now()` : on n'envoie la date que si elle est imposée.
          ...(run.date === undefined ? {} : { date: run.date }),
          overall: run.overall,
          rank: run.rank,
          complete: run.complete,
          source: run.source,
          // Le seul endroit où le champ métier redevient le nom de la colonne.
          season: run.benchmarkId,
        })
        .select(RUN_COLUMNS)
        .single();

      if (error !== null || data === null) {
        throw queryError(error, "La passe n'a pas pu être enregistrée.");
      }
      return data;
    },

    async insertScores(runId, scores) {
      const { error } = await supabase.from("scenario_scores").insert(
        scores.map((score) => ({
          run_id: runId,
          scenario: score.scenario,
          score: score.score,
          energy: score.energy,
        })),
      );

      if (error !== null) {
        throw queryError(error, SCORES_FAILED);
      }
    },

    async deleteRun(runId) {
      const { error } = await supabase.from("bench_runs").delete().eq("id", runId);

      if (error !== null) throw queryError(error, "Annulation impossible.");
    },
  };
}

/**
 * Enregistre une passe : énergies calculées ici, puis `bench_runs` et
 * `scenario_scores` (18 lignes au plus, en un lot).
 */
export async function saveBenchRun(input: SaveBenchRunInput): Promise<BenchRunDetail> {
  return saveBenchRunTo(supabaseStore(await currentUserId()), input);
}

/* ------------------------------------------------------------------ */
/* Lecture et suppression                                              */
/* ------------------------------------------------------------------ */

/**
 * Les passes de l'utilisateur, de la plus récente à la plus ancienne.
 *
 * Le filtre `user_id` est redondant avec la RLS : il est là pour que la
 * requête emprunte l'index `(user_id, date desc)` plutôt que de faire filtrer
 * la policy après coup.
 */
export async function listBenchRuns(tier?: TierId): Promise<readonly BenchRunSummary[]> {
  const userId = await currentUserId();
  const query = supabase
    .from("bench_runs")
    .select(RUN_COLUMNS)
    .eq("user_id", userId)
    .order("date", { ascending: false })
    .order("id", { ascending: false });

  const { data, error } = await (tier === undefined ? query : query.eq("tier", tier));

  if (error !== null || data === null) {
    throw queryError(error, "L'historique n'a pas pu être chargé.");
  }
  return toBenchRunSummaries(data);
}

/**
 * Le détail d'une passe : la ligne et ses scores, en deux requêtes menées de
 * front. Une passe qui n'est pas à l'utilisateur est invisible (RLS) : elle
 * répond donc « introuvable », comme une passe supprimée.
 */
export async function getBenchRunDetail(id: number): Promise<BenchRunDetail> {
  const [run, scores] = await Promise.all([
    supabase.from("bench_runs").select(RUN_COLUMNS).eq("id", id).maybeSingle(),
    supabase.from("scenario_scores").select(SCORE_COLUMNS).eq("run_id", id),
  ]);

  if (run.error !== null) throw queryError(run.error, "Le détail n'a pas pu être chargé.");
  if (run.data === null) throw new DataError(RUN_NOT_FOUND);
  if (scores.error !== null) throw queryError(scores.error, "Les scores n'ont pas pu être lus.");

  return toBenchRunDetail(run.data, scores.data ?? []);
}

/** Supprime une passe. Les `scenario_scores` partent en cascade (contrainte FK). */
export async function deleteBenchRun(id: number): Promise<void> {
  const { data, error } = await supabase.from("bench_runs").delete().eq("id", id).select("id");

  if (error !== null) throw queryError(error, "La suppression a échoué.");
  // Zéro ligne touchée : soit la passe n'existe plus, soit elle est à
  // quelqu'un d'autre — la RLS ne distingue pas les deux, l'UI non plus.
  if (data === null || data.length === 0) throw new DataError(RUN_NOT_FOUND);
}
