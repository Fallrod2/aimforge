/**
 * Les **records personnels** par scénario (SPEC V4-A §4.3) : le meilleur score
 * jamais enregistré sur un scénario, dans un palier et un benchmark donnés.
 *
 * Pourquoi une requête et pas une lecture de l'historique déjà chargé : le
 * tracker ne charge pas l'historique (il ne lit que le palier de la dernière
 * passe), et l'historique ne charge les scores que des passes dépliées. Un
 * record se calcule sur *toutes* les passes ; le faire côté base coûte une
 * requête, le faire côté client coûterait le téléchargement de l'historique
 * complet à chaque ouverture du tracker.
 *
 * La qualification passe par la **jointure** `scenario_scores → bench_runs`
 * (DECISIONS.md D3) : c'est la passe qui porte le palier et le benchmark, et
 * un scénario homonyme entre deux benchmarks est désambiguïsé par là. Aucune
 * colonne dupliquée sur `scenario_scores`.
 *
 * Le filtre `user_id` est redondant avec la RLS — c'est elle qui isole — mais il
 * fait emprunter l'index `(user_id, date desc)` à la requête au lieu de laisser
 * la policy filtrer après coup, comme dans `bench-runs.ts`.
 *
 * Les records sont chargés **une fois par palier**, jamais par frappe : ce qui
 * bouge pendant la saisie, c'est la comparaison, pas le record.
 */

import type { BenchmarkId, TierId } from "../../lib/energy";
import { supabase } from "../supabase/client";
import { queryError } from "./errors";
import { currentUserId } from "./session";

/** Le meilleur score de chaque scénario, indexé par nom de scénario. */
export type PersonalBests = ReadonlyMap<string, number>;

/** Ce qu'il faut d'une ligne de score pour en tirer un record. */
export interface ScoredScenario {
  readonly scenario: string;
  readonly score: number;
}

/**
 * Le meilleur score par scénario. Fonction pure, testée seule.
 *
 * Un score illisible (dérive de données) est ignoré plutôt que comparé : `NaN`
 * fausserait toute comparaison qui le touche, et un record affiché « NaN »
 * serait pire que pas de record du tout.
 */
export function bestByScenario(rows: readonly ScoredScenario[]): PersonalBests {
  const best = new Map<string, number>();

  for (const row of rows) {
    if (!Number.isFinite(row.score)) continue;

    const current = best.get(row.scenario);

    if (current === undefined || row.score > current) best.set(row.scenario, row.score);
  }
  return best;
}

/**
 * Les records personnels de l'utilisateur sur un palier d'un benchmark.
 *
 * Un échec n'a pas à casser la saisie : l'appelant (le tracker) traite
 * l'absence de records comme un écran sans records. On lève quand même une
 * `DataError` propre — c'est à l'appelant de décider d'être silencieux, pas à
 * la couche de données de masquer une panne.
 */
export async function listPersonalBests(
  benchmarkId: BenchmarkId,
  tier: TierId,
): Promise<PersonalBests> {
  const userId = await currentUserId();
  const { data, error } = await supabase
    .from("scenario_scores")
    // `!inner` : sans lui, PostgREST rendrait aussi les scores dont la passe ne
    // satisfait pas le filtre, avec un parent nul — c'est-à-dire les scores de
    // tous les paliers.
    .select("scenario, score, bench_runs!inner(user_id, tier, benchmark_id)")
    .eq("bench_runs.user_id", userId)
    .eq("bench_runs.tier", tier)
    .eq("bench_runs.benchmark_id", benchmarkId);

  if (error !== null || data === null) {
    throw queryError(error, "Les records personnels n'ont pas pu être lus.");
  }
  return bestByScenario(data);
}
