/**
 * Lecture et mise à jour du profil joueur (`public.profiles`).
 *
 * La ligne n'est jamais créée par le client : le trigger `on_auth_user_created`
 * la pose à l'inscription, et la RLS n'accorde volontairement que `select` et
 * `update` (aucune policy `insert`). Un profil manquant est donc une anomalie
 * de compte, pas un cas normal à rattraper par un `upsert` — on le dit plutôt
 * que de l'inventer.
 *
 * Les noms de colonnes (`rang_valorant`, `notes_maps`…) restent à la frontière :
 * l'UI ne manipule que le type `Profile` en camelCase. Ils ne bougent pas avec
 * la couche jeu (DECISIONS.md D7) — `rang_valorant` porte le rang d'un joueur
 * de CS2 comme celui d'un joueur de Valorant, seuls les mots affichés changent
 * (`src/shared/game-vocab.ts`).
 *
 * Deux préférences de la migration `0019` s'ajoutent aux six champs libres, et
 * elles ne s'écrivent pas de la même façon :
 *
 * - **`game`** est un champ du formulaire : il part avec l'enregistrement ;
 * - **`active_benchmark`** est piloté par le sélecteur de benchmark, qui écrit
 *   seul (`setActiveBenchmark`). Le formulaire ne le renvoie pas — sinon un
 *   profil ouvert avant un changement de benchmark le remettrait à sa valeur
 *   d'alors en enregistrant un pseudo.
 */

import { z } from "zod";
import { type BenchmarkId, DEFAULT_BENCHMARK_ID, toBenchmarkId } from "../../lib/energy";
import { GAME_IDS, type GameId } from "../../shared/game-vocab";
import { supabase } from "../supabase/client";
import { DataError, queryError } from "./errors";
import { currentUserId } from "./session";
import type { Profile, ProfileInput } from "./types";

const COLUMNS =
  "pseudo, rang_valorant, peak, main_agent, objectif, notes_maps, game, active_benchmark";

const MISSING_PROFILE =
  "Profil introuvable pour ce compte. Déconnecte-toi et reconnecte-toi ; s'il manque toujours, le compte n'a pas de ligne de profil.";

/** La forme des colonnes lues, avant passage en camelCase. */
interface ProfileRow {
  readonly pseudo: string | null;
  readonly rang_valorant: string | null;
  readonly peak: string | null;
  readonly main_agent: string | null;
  readonly objectif: string | null;
  readonly notes_maps: string | null;
  readonly game: string;
  readonly active_benchmark: string;
}

/**
 * Le jeu, validé par l'union fermée partagée avec le serveur et avec le `check`
 * de la colonne. Une valeur hors liste ne décide que de mots : on retombe sur
 * le défaut plutôt que d'empêcher le profil de s'afficher.
 */
const gameSchema = z.enum(GAME_IDS).catch("valorant");

export function toGame(value: unknown): GameId {
  return gameSchema.parse(value);
}

/**
 * Le benchmark actif, validé par le registre.
 *
 * Un benchmark inconnu en base **ne fait pas échouer le profil** : contrairement
 * au benchmark d'une passe (qui décide de la relecture de chiffres enregistrés,
 * et où un repli fabriquerait des valeurs fausses), celui-ci n'est qu'une
 * préférence d'affichage et de saisie. On retombe donc sur le défaut, en le
 * disant dans la console — la trace importe : c'est le seul indice qu'un
 * benchmark a disparu du registre alors qu'un profil le désignait encore.
 */
export function toActiveBenchmark(value: string): BenchmarkId {
  try {
    return toBenchmarkId(value);
  } catch {
    console.warn(
      `[profil] benchmark actif inconnu du registre : « ${value} » — repli sur ${DEFAULT_BENCHMARK_ID}.`,
    );
    return DEFAULT_BENCHMARK_ID;
  }
}

export function toProfile(row: ProfileRow): Profile {
  return {
    pseudo: row.pseudo,
    rangValorant: row.rang_valorant,
    peak: row.peak,
    mainAgent: row.main_agent,
    objectif: row.objectif,
    notesMaps: row.notes_maps,
    game: toGame(row.game),
    activeBenchmark: toActiveBenchmark(row.active_benchmark),
  };
}

export async function getProfile(): Promise<Profile> {
  const userId = await currentUserId();
  const { data, error } = await supabase
    .from("profiles")
    .select(COLUMNS)
    .eq("user_id", userId)
    .maybeSingle();

  if (error !== null) throw queryError(error, "Le profil n'a pas pu être chargé.");
  if (data === null) throw new DataError(MISSING_PROFILE);
  return toProfile(data);
}

/**
 * Le benchmark actif seul.
 *
 * Le provider l'ouvre à chaque session, avant tout écran : lui faire relire les
 * six champs libres du profil pour une colonne serait payer un profil entier
 * pour une préférence.
 */
export async function getActiveBenchmark(): Promise<BenchmarkId> {
  const userId = await currentUserId();
  const { data, error } = await supabase
    .from("profiles")
    .select("active_benchmark")
    .eq("user_id", userId)
    .maybeSingle();

  if (error !== null) throw queryError(error, "Le benchmark actif n'a pas pu être lu.");
  if (data === null) throw new DataError(MISSING_PROFILE);
  return toActiveBenchmark(data.active_benchmark);
}

/**
 * Écrit le benchmark actif et rend la valeur relue.
 *
 * Écriture ciblée sur une colonne : elle ne passe pas par `updateProfile`, dont
 * le contrat est de **remplacer** les champs libres. Un sélecteur de benchmark
 * qui effacerait les notes de maps parce qu'un formulaire n'était pas chargé
 * serait un piège.
 */
export async function setActiveBenchmark(benchmarkId: BenchmarkId): Promise<BenchmarkId> {
  const userId = await currentUserId();
  const { data, error } = await supabase
    .from("profiles")
    .update({ active_benchmark: benchmarkId, updated_at: new Date().toISOString() })
    .eq("user_id", userId)
    .select("active_benchmark")
    .maybeSingle();

  if (error !== null) throw queryError(error, "Le benchmark n'a pas pu être changé.");
  if (data === null) throw new DataError(MISSING_PROFILE);
  return toActiveBenchmark(data.active_benchmark);
}

/**
 * Écrit le profil et rend la ligne relue.
 *
 * Remplacement complet (et non fusion) des champs du formulaire : celui-ci
 * envoie ses six champs libres et le jeu à chaque enregistrement, un champ vidé
 * à l'écran doit s'effacer en base. `active_benchmark` n'en fait pas partie
 * (cf. l'en-tête). `updated_at` est posé ici — la table n'a pas de trigger
 * `moddatetime`.
 */
export async function updateProfile(profile: ProfileInput): Promise<Profile> {
  const userId = await currentUserId();
  const { data, error } = await supabase
    .from("profiles")
    .update({
      pseudo: profile.pseudo,
      rang_valorant: profile.rangValorant,
      peak: profile.peak,
      main_agent: profile.mainAgent,
      objectif: profile.objectif,
      notes_maps: profile.notesMaps,
      game: profile.game,
      updated_at: new Date().toISOString(),
    })
    .eq("user_id", userId)
    .select(COLUMNS)
    .maybeSingle();

  if (error !== null) throw queryError(error, "Le profil n'a pas pu être enregistré.");
  if (data === null) throw new DataError(MISSING_PROFILE);
  return toProfile(data);
}
