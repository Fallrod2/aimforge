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
 * l'UI ne manipule que le type `Profile` en camelCase.
 */

import { supabase } from "../supabase/client";
import { DataError, queryError } from "./errors";
import { currentUserId } from "./session";
import type { Profile } from "./types";

const COLUMNS = "pseudo, rang_valorant, peak, main_agent, objectif, notes_maps";

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
}

function toProfile(row: ProfileRow): Profile {
  return {
    pseudo: row.pseudo,
    rangValorant: row.rang_valorant,
    peak: row.peak,
    mainAgent: row.main_agent,
    objectif: row.objectif,
    notesMaps: row.notes_maps,
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
 * Écrit le profil et rend la ligne relue.
 *
 * Remplacement complet (et non fusion) : le formulaire envoie ses six champs
 * à chaque enregistrement, un champ vidé à l'écran doit s'effacer en base.
 * `updated_at` est posé ici — la table n'a pas de trigger `moddatetime`.
 */
export async function updateProfile(profile: Profile): Promise<Profile> {
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
      updated_at: new Date().toISOString(),
    })
    .eq("user_id", userId)
    .select(COLUMNS)
    .maybeSingle();

  if (error !== null) throw queryError(error, "Le profil n'a pas pu être enregistré.");
  if (data === null) throw new DataError(MISSING_PROFILE);
  return toProfile(data);
}
