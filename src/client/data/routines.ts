/**
 * Lecture, marquage et suppression des routines (`public.routines`).
 *
 * L'**écriture** n'est pas ici : c'est la fonction serverless `api/routine` qui
 * insère la routine, juste après l'avoir validée — mais avec le JWT de
 * l'utilisateur, donc sous la même RLS que ce module. Le client ne pourrait pas
 * écrire lui-même sans faire confiance à ce qu'il a reçu du modèle.
 *
 * `contenu` est une colonne `jsonb` : Postgres n'en garantit que la syntaxe.
 * Elle est donc revalidée à la lecture avec le schéma du contrat
 * (`src/shared/routine-contract.ts`) — le même que la fonction applique à la
 * sortie du modèle. Une ligne qui n'y entre pas est une dérive de données : on
 * la signale, on ne devine pas ce qu'elle voulait dire.
 *
 * Le seul champ que le navigateur écrit est `done` : cocher « faite » est une
 * décision du joueur, pas du modèle.
 */

import { type StoredRoutine, storedRoutineSchema } from "../../shared/routine-contract";
import { supabase } from "../supabase/client";
import { DataError, queryError } from "./errors";
import { currentUserId } from "./session";

const COLUMNS = "id, date, duree_minutes, focus, contenu, done";

const NOT_FOUND = "Routine introuvable : elle a peut-être déjà été supprimée.";

/** La forme des colonnes lues, avant validation. */
interface RoutineRow {
  readonly id: number;
  readonly date: string;
  readonly duree_minutes: number;
  readonly focus: string | null;
  readonly contenu: unknown;
  readonly done: boolean;
}

function toRoutine(row: RoutineRow): StoredRoutine {
  const time = Date.parse(row.date);
  const content = (row.contenu ?? {}) as Record<string, unknown>;
  const parsed = storedRoutineSchema.safeParse({
    ...content,
    id: row.id,
    date: Number.isNaN(time) ? row.date : new Date(time).toISOString(),
    duree_minutes: row.duree_minutes,
    focus: row.focus,
    done: row.done,
  });

  if (!parsed.success) {
    throw new DataError(
      `Routine ${row.id} illisible : son contenu ne correspond plus au format attendu.`,
      parsed.error,
    );
  }
  return parsed.data;
}

/**
 * Les routines de l'utilisateur, de la plus récente à la plus ancienne.
 *
 * Le filtre `user_id` est redondant avec la RLS : il est là pour que la requête
 * emprunte l'index `(user_id, date desc)`.
 */
export async function listRoutines(limit = 30): Promise<readonly StoredRoutine[]> {
  const userId = await currentUserId();
  const { data, error } = await supabase
    .from("routines")
    .select(COLUMNS)
    .eq("user_id", userId)
    .order("date", { ascending: false })
    .order("id", { ascending: false })
    .limit(limit);

  if (error !== null || data === null) {
    throw queryError(error, "Les routines n'ont pas pu être chargées.");
  }
  return data.map(toRoutine);
}

/**
 * Marque une routine faite (ou pas). Zéro ligne touchée = elle n'existe plus
 * (ou n'est pas à nous).
 */
export async function setRoutineDone(id: number, done: boolean): Promise<StoredRoutine> {
  const { data, error } = await supabase
    .from("routines")
    .update({ done })
    .eq("id", id)
    .select(COLUMNS);

  if (error !== null) throw queryError(error, "La routine n'a pas pu être mise à jour.");

  const row = data?.[0];

  if (row === undefined) throw new DataError(NOT_FOUND);
  return toRoutine(row);
}

/** Supprime une routine. Zéro ligne touchée = elle n'existe plus. */
export async function deleteRoutine(id: number): Promise<void> {
  const { data, error } = await supabase.from("routines").delete().eq("id", id).select("id");

  if (error !== null) throw queryError(error, "La suppression a échoué.");
  if (data === null || data.length === 0) throw new DataError(NOT_FOUND);
}
