/**
 * Résolution du fournisseur d'un utilisateur (SPEC §5 ter) : quelle
 * configuration sert cet appel, et **qui paie**.
 *
 * C'est le seul endroit du projet où se décide la règle de quota, et elle tient
 * en une phrase : le quota AimForge (5 debriefs + 5 routines par jour) mesure
 * la consommation de **notre** clé. Quand l'utilisateur apporte la sienne, il
 * n'y a plus rien à mesurer — le compteur n'est pas remis à zéro, il n'est
 * simplement pas appelé. `incrementUsage` n'est donc jamais invoqué sur une
 * résolution `user` : c'est cette absence d'appel, et rien d'autre, qui « lève
 * le quota ».
 *
 * Le module est **pur** : il reçoit une fonction de lecture, pas un client
 * Supabase. La règle se teste ainsi sans base, y compris ses cas tordus — une
 * ligne de réglages illisible, une base muette — qui sont précisément ceux
 * qu'on ne peut pas provoquer en production.
 */

import {
  type AiSettings,
  aiSettingsInputSchema,
  DEFAULT_ANTHROPIC_MODEL,
  providerSchema,
} from "../../shared/ai-settings-contract.js";
import type { ProviderConfig } from "./port.js";

/** La ligne `public.ai_settings`, telle que la base la rend. */
export interface StoredAiSettings {
  readonly provider: string;
  readonly model: string;
  readonly base_url: string | null;
  readonly api_key: string;
  readonly updated_at: string;
}

/**
 * La lecture des réglages d'un utilisateur. Rend `null` quand il n'y en a pas
 * — et **lève** quand la base n'a pas pu répondre.
 *
 * La distinction n'est pas un détail de style : confondre « pas de réglages »
 * et « base injoignable » ferait basculer silencieusement l'utilisateur sur la
 * clé de la plateforme et sur son quota, alors qu'il a demandé le contraire.
 * Un incident de lecture doit se voir.
 */
export type LoadAiSettings = (userId: string) => Promise<StoredAiSettings | null>;

/** La lecture des réglages a échoué : on ne devine pas, on le dit. */
export class AiSettingsUnavailableError extends Error {
  override readonly name = "AiSettingsUnavailableError";
}

export type Resolution =
  | { readonly ok: true; readonly config: ProviderConfig }
  /**
   * Aucune configuration utilisable : `reason` est déjà rédigé pour l'écran, et
   * `status` dit **à qui appartient le problème**, comme `modelErrorStatus` le
   * fait pour les échecs d'appel. 503 : la plateforme n'est pas configurée,
   * l'utilisateur ne peut rien y faire. 409 : sa propre configuration est
   * illisible, et lui seul peut la corriger.
   */
  | { readonly ok: false; readonly reason: string; readonly status: 409 | 503 };

const NOT_CONFIGURED = "IA non configurée";

const INVALID_SETTINGS =
  "Ta configuration IA personnelle est illisible (fournisseur ou modèle inattendu). Ouvre Réglages IA pour la corriger ou la supprimer.";

/**
 * La configuration à utiliser pour cet utilisateur.
 *
 * @param load Lecture de `public.ai_settings`, sous **service role** : la clé
 *   n'est lisible par personne d'autre (privilèges de colonne, migration 0008).
 * @param platformKey `ANTHROPIC_API_KEY`, ou une chaîne vide si elle n'est pas
 *   posée dans l'environnement de la fonction.
 */
export async function resolveModelFor(
  load: LoadAiSettings,
  userId: string,
  platformKey: string,
): Promise<Resolution> {
  const stored = await load(userId);

  if (stored === null) {
    if (platformKey.trim() === "") return { ok: false, reason: NOT_CONFIGURED, status: 503 };
    return {
      ok: true,
      config: {
        source: "platform",
        provider: "anthropic",
        model: DEFAULT_ANTHROPIC_MODEL,
        baseUrl: null,
        apiKey: platformKey,
      },
    };
  }

  // Revalidé avec le schéma qui l'a écrit : la contrainte `check` de la base
  // garantit la liste des fournisseurs, pas la cohérence `base_url` ↔
  // fournisseur telle que les adaptateurs l'attendent. Une ligne hors contrat
  // (écrite à la main, ou par une version antérieure) est signalée, pas devinée.
  const parsed = aiSettingsInputSchema.safeParse({
    provider: stored.provider,
    model: stored.model,
    base_url: stored.base_url,
    api_key: stored.api_key,
  });

  if (!parsed.success) return { ok: false, reason: INVALID_SETTINGS, status: 409 };

  return {
    ok: true,
    config: {
      source: "user",
      provider: parsed.data.provider,
      model: parsed.data.model,
      baseUrl: parsed.data.base_url ?? null,
      apiKey: parsed.data.api_key,
    },
  };
}

/**
 * La vue publique d'une ligne de réglages : tout, sauf la clé.
 *
 * Rend `null` sur une ligne hors contrat plutôt que de la présenter à moitié :
 * un écran qui afficherait un fournisseur inconnu proposerait des gestes qui
 * n'aboutiraient pas.
 */
export function toPublicSettings(stored: Omit<StoredAiSettings, "api_key">): AiSettings | null {
  const provider = providerSchema.safeParse(stored.provider);
  const time = Date.parse(stored.updated_at);

  if (!provider.success || Number.isNaN(time)) return null;

  return {
    provider: provider.data,
    model: stored.model,
    baseUrl: stored.base_url,
    updatedAt: new Date(time).toISOString(),
    // Une ligne existe ⇒ `api_key` est non nulle et non vide (contraintes de
    // la table). Le booléen est donc exact sans jamais lire la colonne.
    hasKey: true,
  };
}
