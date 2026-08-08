/**
 * L'identité de l'appelant, côté données.
 *
 * La RLS filtre déjà tout par `auth.uid()` : ce `user_id` ne sert donc pas à
 * sécuriser, il sert à écrire (la colonne est `not null`) et à faire emprunter
 * aux lectures l'index `(user_id, date desc)` plutôt qu'un filtre de policy
 * appliqué après coup.
 */

import { supabase } from "../supabase/client";
import { DataError, NO_SESSION_MESSAGE } from "./errors";

/** L'identifiant de l'utilisateur connecté. Lève si la session est tombée. */
export async function currentUserId(): Promise<string> {
  const { data, error } = await supabase.auth.getSession();

  if (error !== null) throw new DataError(NO_SESSION_MESSAGE, error);

  const userId = data.session?.user.id;

  if (userId === undefined) throw new DataError(NO_SESSION_MESSAGE);
  return userId;
}
