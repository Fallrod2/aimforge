/**
 * Lecture et suppression des debriefs du coach (`public.debriefs`).
 *
 * L'**écriture** n'est pas ici : c'est la fonction serverless `api/coach` qui
 * insère le debrief, juste après l'avoir validé — mais avec le JWT de
 * l'utilisateur, donc sous la même RLS que ce module. Le client ne pourrait
 * pas écrire lui-même sans faire confiance à ce qu'il a reçu du modèle.
 *
 * `points_forts` et `axes` sont des colonnes `jsonb` : Postgres n'en garantit
 * que la syntaxe. Elles sont donc revalidées à la lecture avec le schéma du
 * contrat (`src/shared/coach-contract.ts`) — le même que la fonction applique
 * à la sortie du modèle. Une ligne qui n'y entre pas est une dérive de
 * données : on la signale, on ne devine pas ce qu'elle voulait dire.
 */

import { type StoredDebrief, storedDebriefSchema } from "../../shared/coach-contract";
import { supabase } from "../supabase/client";
import { DataError, queryError } from "./errors";
import { currentUserId } from "./session";

const COLUMNS = "id, date, resume, points_forts, axes, focus";

const NOT_FOUND = "Debrief introuvable : il a peut-être déjà été supprimé.";

/** La forme des colonnes lues, avant validation. */
interface DebriefRow {
  readonly id: number;
  readonly date: string;
  readonly resume: string;
  readonly points_forts: unknown;
  readonly axes: unknown;
  readonly focus: string | null;
}

function toDebrief(row: DebriefRow): StoredDebrief {
  const time = Date.parse(row.date);
  const parsed = storedDebriefSchema.safeParse({
    id: row.id,
    date: Number.isNaN(time) ? row.date : new Date(time).toISOString(),
    resume: row.resume,
    points_forts: row.points_forts,
    axes: row.axes,
    focus: row.focus,
  });

  if (!parsed.success) {
    throw new DataError(
      `Debrief ${row.id} illisible : son contenu ne correspond plus au format attendu.`,
      parsed.error,
    );
  }
  return parsed.data;
}

/**
 * Les debriefs de l'utilisateur, du plus récent au plus ancien.
 *
 * Le filtre `user_id` est redondant avec la RLS : il est là pour que la
 * requête emprunte l'index `(user_id, date desc)`.
 */
export async function listDebriefs(limit = 30): Promise<readonly StoredDebrief[]> {
  const userId = await currentUserId();
  const { data, error } = await supabase
    .from("debriefs")
    .select(COLUMNS)
    .eq("user_id", userId)
    .order("date", { ascending: false })
    .order("id", { ascending: false })
    .limit(limit);

  if (error !== null || data === null) {
    throw queryError(error, "Les debriefs n'ont pas pu être chargés.");
  }
  return data.map(toDebrief);
}

/** Supprime un debrief. Zéro ligne touchée = il n'existe plus (ou n'est pas à nous). */
export async function deleteDebrief(id: number): Promise<void> {
  const { data, error } = await supabase.from("debriefs").delete().eq("id", id).select("id");

  if (error !== null) throw queryError(error, "La suppression a échoué.");
  if (data === null || data.length === 0) throw new DataError(NOT_FOUND);
}
