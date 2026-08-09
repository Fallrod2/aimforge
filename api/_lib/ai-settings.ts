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
import {
  type AiSettingsInput,
  type ProviderId,
  providerSpec,
} from "../../src/shared/ai-settings-contract.js";

/** Le seul fournisseur qui se lie au lieu de se coller. */
const CHATGPT_PROVIDER: ProviderId = "chatgpt_subscription";

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

/**
 * Les colonnes qu'une écriture pose. `updated_at` est au trigger, pas à nous.
 *
 * `api_key` est **obligatoire** : une écriture qui pose un fournisseur sans
 * poser son secret laisserait la ligne dans un état que rien ne décrit — le
 * fournisseur de l'un, la clé de l'autre. C'est exactement le défaut que le
 * correctif ci-dessous supprime, et le type le rend maintenant impossible à
 * réécrire par distraction.
 */
interface Writable {
  readonly provider: string;
  readonly model: string;
  readonly base_url: string | null;
  readonly api_key: string;
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
 *
 * **Le fournisseur à liaison ne passe pas par ici**, et c'est la règle qui
 * ferme la faille : sans cette porte, un simple `POST action=save` avec
 * `provider: "chatgpt_subscription"` modifiait le fournisseur d'une ligne
 * existante **sans toucher à son secret**. La clé Anthropic de l'utilisateur se
 * retrouvait étiquetée « abonnement ChatGPT », l'écran affichait « Compte lié »
 * alors qu'aucune autorisation n'avait eu lieu, et la clé partait chez OpenAI
 * au premier debrief. Une ligne ne peut donc arriver sur ce fournisseur que par
 * `linkChatGptSettings`, qui apporte les jetons avec elle.
 *
 * Rend `null` quand il n'y avait rien à écrire — cas unique après ce
 * verrouillage : régler le modèle d'une liaison qui n'existe pas (ou plus).
 * L'appelant en fait un refus rédigé (« lie d'abord ton compte ») plutôt qu'une
 * écriture silencieusement fausse.
 */
export async function saveSettings(
  client: UserClient,
  userId: string,
  input: AiSettingsInput,
): Promise<StoreResult<PublicRow | null>> {
  if (input.provider === CHATGPT_PROVIDER) return updateLinkedModel(client, userId, input.model);

  // Le contrat exige la clé de tout fournisseur qui n'est pas à liaison
  // (`aiSettingsInputSchema`) : ce repli n'existe que pour le compilateur, et
  // ne rien écrire vaut mieux qu'écrire une ligne sans secret.
  if (input.api_key === undefined) return { ok: true, value: null };

  return writeRow(client, userId, {
    provider: input.provider,
    model: input.model,
    base_url: input.base_url ?? null,
    api_key: input.api_key,
  });
}

/**
 * Le seul réglage qu'on puisse changer sur une liaison : son modèle.
 *
 * La condition « la ligne est déjà liée » n'est pas vérifiée par une lecture
 * préalable mais **portée par la requête elle-même** (`provider = …`) : entre
 * un `select` et un `update`, la ligne peut avoir changé de fournisseur, et le
 * contrôle aurait porté sur un état périmé. Ici, zéro ligne modifiée signifie
 * « il n'y a pas de liaison à régler », et la réponse est un refus.
 *
 * Seule `model` est écrite : ni `provider` (la ligne y est déjà), ni `api_key`
 * (l'écran ne l'a jamais eue), ni `base_url` (interdite sur ce fournisseur par
 * la contrainte de la migration 0008).
 */
async function updateLinkedModel(
  client: UserClient,
  userId: string,
  model: string,
): Promise<StoreResult<PublicRow | null>> {
  const { data, error } = await client
    .from("ai_settings")
    .update({ model })
    .eq("user_id", userId)
    .eq("provider", CHATGPT_PROVIDER)
    .select(PUBLIC_COLUMNS)
    .maybeSingle();

  if (error !== null) return { ok: false, reason: error.message };
  if (data === null) return { ok: true, value: null };
  return validated(data);
}

/**
 * Pose (ou remplace) la configuration ChatGPT (abonnement) au terme d'une
 * liaison réussie : le groupe de jetons prend la place de la clé.
 *
 * Deux conséquences assumées, et l'écran les annonce avant le clic :
 *
 * - lier **remplace** la configuration IA précédente. La table ne garde qu'une
 *   ligne par personne, et de toute façon la clé du fournisseur d'avant
 *   n'était plus relisible — il aurait fallu la recoller pour y revenir ;
 * - l'écriture passe par le **JWT de l'utilisateur**, pas par la clé de
 *   service : poser son propre secret est précisément ce que les privilèges de
 *   colonne autorisent (migration 0008). La clé de service n'entre en jeu que
 *   pour *relire* les jetons et les rafraîchir.
 *
 * Le modèle déjà choisi est conservé quand la ligne était déjà sur ce
 * fournisseur : relier après une expiration ne doit pas défaire un réglage.
 */
export async function linkChatGptSettings(
  client: UserClient,
  userId: string,
  bundle: string,
): Promise<StoreResult<PublicRow | null>> {
  const existing = await readSettings(client, userId);

  if (!existing.ok) return existing;

  const previous = existing.value;
  const model =
    previous !== null && previous.provider === CHATGPT_PROVIDER
      ? previous.model
      : providerSpec(CHATGPT_PROVIDER).defaultModel;

  return writeRow(client, userId, {
    provider: CHATGPT_PROVIDER,
    model,
    base_url: null,
    api_key: bundle,
  });
}

async function writeRow(
  client: UserClient,
  userId: string,
  row: Writable,
): Promise<StoreResult<PublicRow | null>> {
  const updated = await client
    .from("ai_settings")
    .update(row)
    .eq("user_id", userId)
    // Relecture explicite : `select()` sans argument relirait `api_key`, que
    // les privilèges de colonne interdisent — l'écriture entière échouerait.
    .select(PUBLIC_COLUMNS)
    .maybeSingle();

  if (updated.error !== null) return { ok: false, reason: updated.error.message };
  if (updated.data !== null) return validated(updated.data);

  // Rien à modifier : il n'y a pas encore de ligne, on la crée. Le secret est
  // là — le type l'exige — donc la contrainte `not null` de la table est tenue.
  const inserted = await client
    .from("ai_settings")
    .insert({ user_id: userId, ...row })
    .select(PUBLIC_COLUMNS)
    .single();

  if (inserted.error !== null) {
    // Deux enregistrements simultanés : l'autre a créé la ligne entre nos deux
    // requêtes. La modification qui échouait il y a un instant réussit
    // maintenant — c'est le même geste, pas une erreur à montrer.
    if (inserted.error.code === "23505") {
      const retried = await client
        .from("ai_settings")
        .update(row)
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

/**
 * La réécriture des jetons rafraîchis, **sous service role** — la seule
 * écriture de ce module qui ne passe pas par le JWT de son propriétaire.
 *
 * Pourquoi c'est sûr malgré le contournement de la RLS, et c'est la même raison
 * que pour `linked_accounts` (voir `api/_lib/service.ts`) : `userId` vient de
 * `getUser(token)`, donc d'une vérification de signature faite par Supabase
 * Auth, jamais du corps de la requête. La clause `provider` en plus est une
 * ceinture : si la configuration a changé de fournisseur entre la lecture et le
 * rafraîchissement, l'écriture ne touche rien plutôt que d'écraser une clé.
 *
 * Elle ne relit aucune colonne (pas de `select()`) : il n'y a rien à en
 * rapporter, et une relecture ferait revenir le secret sur le réseau.
 */
export function persistChatGptTokensWith(
  client: SupabaseClient,
  userId: string,
): (bundle: string) => Promise<void> {
  return async (bundle: string): Promise<void> => {
    const { error } = await client
      .from("ai_settings")
      .update({ api_key: bundle })
      .eq("user_id", userId)
      .eq("provider", CHATGPT_PROVIDER);

    if (error !== null) throw new Error(error.message);
  };
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
