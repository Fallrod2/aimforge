/**
 * L'accès à `public.ai_settings` depuis les fonctions serverless (SPEC §5 ter).
 *
 * Deux chemins, et la différence entre les deux n'est pas un détail
 * d'implémentation — c'est la sécurité de la fonctionnalité :
 *
 * - **lecture de la clé** (`loadAiSettingsWith`) : sous **service role**, et
 *   nulle part ailleurs. Les privilèges de colonne de la migration 0008
 *   interdisent à `authenticated` de lire `api_key` ; ce chemin est donc le
 *   seul qui existe, et il n'est emprunté que par `api/coach` et
 *   `api/routine`, pour appeler le fournisseur au nom de son propriétaire ;
 * - **écriture et lecture publique** (`api/ai-settings`) : sous le **JWT de
 *   l'utilisateur**. C'est la RLS et les privilèges de colonne qui font la
 *   police, pas la prudence de notre code. Une fonction qui se tromperait
 *   d'identifiant se ferait refuser par la base.
 *
 * Le piège que ce module évite, et qui ne se voit qu'à l'exécution : par
 * défaut, PostgREST rend la ligne écrite (`return=representation`), donc
 * **relit toutes les colonnes** — dont `api_key`, dont la lecture est refusée
 * (42501). Toute écriture ici nomme donc explicitement les colonnes qu'elle
 * relit, et `api_key` n'en fait jamais partie.
 *
 * Le préfixe `_` sort ce fichier du routage Vercel : il est importé, jamais
 * appelé en HTTP.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import type { Database } from "../../src/client/supabase/database-types.js";
import {
  AiSettingsUnavailableError,
  type LoadAiSettings,
  type StoredAiSettings,
} from "../../src/server/ai/index.js";
import type { AiSettingsInput } from "../../src/shared/ai-settings-contract.js";

/** Les colonnes que le navigateur a le droit de relire. `api_key` n'y est pas. */
export const PUBLIC_COLUMNS = "provider, model, base_url, updated_at";

/**
 * La ligne, revalidée à la frontière. Postgres garantit les types, pas le fait
 * que la colonne existe encore sous ce nom après une migration future.
 */
const rowSchema = z.object({
  provider: z.string(),
  model: z.string(),
  base_url: z.string().nullable(),
  updated_at: z.string(),
});

const secretRowSchema = rowSchema.extend({ api_key: z.string().min(1) });

export type PublicRow = z.infer<typeof rowSchema>;

const UNAVAILABLE = "réglages IA illisibles";

/* ------------------------------------------------------------------ */
/* Lecture de la clé (service role)                                    */
/* ------------------------------------------------------------------ */

/**
 * La lecture que `resolveModelFor` attend.
 *
 * Elle **lève** quand la base répond mal, au lieu de rendre `null` : rendre
 * `null` ferait basculer silencieusement l'utilisateur sur la clé de la
 * plateforme et sur son quota, alors qu'il a demandé le contraire.
 */
export function loadAiSettingsWith(client: SupabaseClient): LoadAiSettings {
  return async (userId: string): Promise<StoredAiSettings | null> => {
    const { data, error } = await client
      .from("ai_settings")
      .select(`${PUBLIC_COLUMNS}, api_key`)
      .eq("user_id", userId)
      .maybeSingle();

    if (error !== null) throw new AiSettingsUnavailableError(error.message);
    if (data === null) return null;

    const parsed = secretRowSchema.safeParse(data);

    if (!parsed.success) throw new AiSettingsUnavailableError(UNAVAILABLE);
    return parsed.data;
  };
}

/* ------------------------------------------------------------------ */
/* Lecture et écriture publiques (JWT de l'utilisateur)                */
/* ------------------------------------------------------------------ */

export type UserClient = SupabaseClient<Database>;

export type StoreResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly reason: string };

/** Les réglages de l'utilisateur, sans la clé (qu'on ne saurait pas relire). */
export async function readSettings(
  client: UserClient,
  userId: string,
): Promise<StoreResult<PublicRow | null>> {
  const { data, error } = await client
    .from("ai_settings")
    .select(PUBLIC_COLUMNS)
    .eq("user_id", userId)
    .maybeSingle();

  if (error !== null) return { ok: false, reason: error.message };
  if (data === null) return { ok: true, value: null };

  const parsed = rowSchema.safeParse(data);

  if (!parsed.success) return { ok: false, reason: UNAVAILABLE };
  return { ok: true, value: parsed.data };
}

/** Les colonnes qu'une écriture pose. `updated_at` est au trigger, pas à nous. */
function writable(input: AiSettingsInput) {
  return {
    provider: input.provider,
    model: input.model,
    base_url: input.base_url ?? null,
    api_key: input.api_key,
  };
}

/**
 * Enregistre (ou remplace) la configuration de l'utilisateur.
 *
 * **Modifier d'abord, insérer ensuite** — et non un `upsert`, bien que la clé
 * primaire s'y prête. La raison est un détail de PostgREST qui a une vraie
 * conséquence : son `upsert` traduit en `on conflict do update set …` **toutes
 * les colonnes du corps, `user_id` compris**. Or `user_id` n'est volontairement
 * pas modifiable (migration 0008 : le propriétaire d'une ligne ne change
 * jamais), donc l'`upsert` échoue en 42501 — vérifié en réel, pas déduit.
 *
 * Deux requêtes plutôt qu'une, donc, et elles disent la même chose que le
 * verrou : on peut poser sa configuration, la remplacer, la retirer — jamais
 * la donner à quelqu'un d'autre.
 *
 * `updated_at` n'est écrit dans aucune des deux : le trigger de la migration
 * 0008 le pose, et le client n'a de toute façon pas le privilège de colonne.
 */
export async function saveSettings(
  client: UserClient,
  userId: string,
  input: AiSettingsInput,
): Promise<StoreResult<PublicRow>> {
  const updated = await client
    .from("ai_settings")
    .update(writable(input))
    .eq("user_id", userId)
    // Relecture explicite : `select()` sans argument relirait `api_key`, que
    // les privilèges de colonne interdisent — l'écriture entière échouerait.
    .select(PUBLIC_COLUMNS)
    .maybeSingle();

  if (updated.error !== null) return { ok: false, reason: updated.error.message };
  if (updated.data !== null) return validated(updated.data);

  const inserted = await client
    .from("ai_settings")
    .insert({ user_id: userId, ...writable(input) })
    .select(PUBLIC_COLUMNS)
    .single();

  if (inserted.error !== null) {
    // Deux enregistrements simultanés : l'autre a créé la ligne entre nos deux
    // requêtes. La modification qui échouait il y a un instant réussit
    // maintenant — c'est le même geste, pas une erreur à montrer.
    if (inserted.error.code === "23505") {
      const retried = await client
        .from("ai_settings")
        .update(writable(input))
        .eq("user_id", userId)
        .select(PUBLIC_COLUMNS)
        .single();

      if (retried.error !== null) return { ok: false, reason: retried.error.message };
      return validated(retried.data);
    }
    return { ok: false, reason: inserted.error.message };
  }
  return validated(inserted.data);
}

function validated(row: unknown): StoreResult<PublicRow> {
  const parsed = rowSchema.safeParse(row);

  if (!parsed.success) return { ok: false, reason: UNAVAILABLE };
  return { ok: true, value: parsed.data };
}

/**
 * Retire la configuration. Idempotent : supprimer ce qui n'existe pas est un
 * succès — c'est l'état demandé qui compte, pas le nombre de lignes touchées.
 */
export async function deleteSettings(
  client: UserClient,
  userId: string,
): Promise<StoreResult<null>> {
  const { error } = await client.from("ai_settings").delete().eq("user_id", userId);

  if (error !== null) return { ok: false, reason: error.message };
  return { ok: true, value: null };
}
