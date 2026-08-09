/**
 * Contrat des réglages IA par utilisateur (SPEC §5 ter) : la forme des
 * échanges entre le navigateur et `api/ai-settings`, et la liste des
 * fournisseurs que le projet sait piloter.
 *
 * Un seul module pour les deux côtés, comme le contrat du coach : la fonction
 * valide ce qu'elle reçoit avec ces schémas, l'écran valide ce qu'il reçoit
 * avec les mêmes. Deux copies dériveraient, et la dérive ne se verrait qu'en
 * production, sur un réglage à moitié enregistré.
 *
 * Ce que ce module ne contient **jamais** : la clé. Aucune de ces formes ne
 * porte `api_key` en sortie — seulement `hasKey`. C'est la traduction en
 * TypeScript du verrou posé en base (migration 0008), et les deux doivent
 * rester d'accord.
 *
 * Module pur : Zod et rien d'autre.
 */

import { z } from "zod";

/* ------------------------------------------------------------------ */
/* Fournisseurs                                                        */
/* ------------------------------------------------------------------ */

export const PROVIDER_IDS = [
  "anthropic",
  "openrouter",
  "openai_compatible",
  "mistral",
  "chatgpt_subscription",
] as const;

export type ProviderId = (typeof PROVIDER_IDS)[number];

export const providerSchema = z.enum(PROVIDER_IDS);

export interface ProviderSpec {
  readonly id: ProviderId;
  readonly label: string;
  /** Une phrase pour choisir : à qui ce fournisseur s'adresse. */
  readonly hint: string;
  /** Le modèle proposé par défaut quand on sélectionne ce fournisseur. */
  readonly defaultModel: string;
  /**
   * Quelques identifiants de modèle, **à titre indicatif**. La liste réelle
   * vit chez le fournisseur et change plus vite que ce fichier : le champ
   * reste libre, ces valeurs ne sont qu'une aide à la frappe.
   */
  readonly models: readonly string[];
  /** Le fournisseur exige-t-il une URL de base ? */
  readonly needsBaseUrl: boolean;
  /** Ce que l'écran doit demander : « clé d'API », ou autre chose. */
  readonly keyLabel: string;
  readonly keyHint: string;
  /**
   * Marqué expérimental : l'écran doit afficher le badge **et**
   * l'avertissement. Ce n'est pas une nuance esthétique — c'est la seule chose
   * qui prévient l'utilisateur que sa configuration peut cesser de marcher
   * sans que rien n'ait changé chez nous.
   */
  readonly experimental?: string;
}

/**
 * Le modèle Anthropic de la plateforme, et le défaut proposé à qui apporte sa
 * propre clé Anthropic : le même que `api/coach.ts` et `api/routine.ts`
 * utilisent aujourd'hui, pour que « ma clé » ne change rien d'autre que qui
 * paie.
 */
export const DEFAULT_ANTHROPIC_MODEL = "claude-sonnet-4-6";

export const PROVIDERS: readonly ProviderSpec[] = [
  {
    id: "anthropic",
    label: "Anthropic",
    hint: "Le même moteur que la version par défaut, mais sur ta clé.",
    defaultModel: DEFAULT_ANTHROPIC_MODEL,
    models: [DEFAULT_ANTHROPIC_MODEL, "claude-sonnet-5", "claude-opus-5", "claude-haiku-4-5"],
    needsBaseUrl: false,
    keyLabel: "Clé d'API",
    keyHint: "Depuis console.anthropic.com, format « sk-ant-… ».",
  },
  {
    id: "openrouter",
    label: "OpenRouter",
    hint: "Une clé, des centaines de modèles de tous les éditeurs.",
    defaultModel: "anthropic/claude-sonnet-4.5",
    models: [
      "anthropic/claude-sonnet-4.5",
      "openai/gpt-4.1",
      "google/gemini-2.5-pro",
      "deepseek/deepseek-chat",
    ],
    needsBaseUrl: false,
    keyLabel: "Clé d'API",
    keyHint: "Depuis openrouter.ai/keys, format « sk-or-… ».",
  },
  {
    id: "openai_compatible",
    label: "OpenAI-compatible",
    hint: "OpenAI, vLLM, Ollama distant, LM Studio… tout ce qui parle /chat/completions.",
    defaultModel: "gpt-4.1",
    models: ["gpt-4.1", "gpt-4o", "gpt-4o-mini"],
    needsBaseUrl: true,
    keyLabel: "Clé d'API",
    keyHint: "La clé attendue par ce serveur. Un serveur sans clé accepte n'importe quoi.",
  },
  {
    id: "mistral",
    label: "Mistral",
    hint: "L'API de Mistral AI, en direct.",
    defaultModel: "mistral-large-latest",
    models: ["mistral-large-latest", "mistral-medium-latest", "mistral-small-latest"],
    needsBaseUrl: false,
    keyLabel: "Clé d'API",
    keyHint: "Depuis console.mistral.ai.",
  },
  {
    id: "chatgpt_subscription",
    label: "ChatGPT (abonnement)",
    hint: "Utilise ton abonnement ChatGPT plutôt qu'une clé d'API facturée à l'usage.",
    defaultModel: "gpt-5",
    models: ["gpt-5", "gpt-5-codex"],
    needsBaseUrl: false,
    keyLabel: "Jeton d'accès ChatGPT",
    keyHint:
      "Ce n'est pas une clé d'API : c'est le jeton d'accès de ta session ChatGPT, à récupérer sur chatgpt.com/api/auth/session (champ « accessToken »).",
    experimental:
      "Ce chemin n'est pas une API publique : il dépend de la tolérance d'OpenAI et peut cesser de fonctionner du jour au lendemain, sans que rien ne change ici. Les limites de ton abonnement s'appliquent, et le jeton expire régulièrement — il faudra le reposer.",
  },
];

export function providerSpec(id: ProviderId): ProviderSpec {
  const found = PROVIDERS.find((spec) => spec.id === id);

  // `PROVIDERS` couvre `PROVIDER_IDS` — le repli n'existe que pour le
  // compilateur, qui ne sait pas lire cette promesse.
  if (found === undefined) throw new Error(`fournisseur inconnu: ${id}`);
  return found;
}

/* ------------------------------------------------------------------ */
/* Ce que le navigateur envoie                                         */
/* ------------------------------------------------------------------ */

/** Bornes de saisie : elles arrêtent l'absurde, pas l'utilisateur. */
export const MAX_MODEL_LENGTH = 200;
export const MAX_BASE_URL_LENGTH = 500;
export const MAX_API_KEY_LENGTH = 4000;

/**
 * Une configuration proposée : celle qu'on teste, ou celle qu'on enregistre.
 *
 * `base_url` suit la contrainte posée en base (migration 0008) : obligatoire
 * pour `openai_compatible`, interdite ailleurs. La refuser ici plutôt que de
 * l'ignorer évite le pire des cas — une URL saisie, acceptée, et jamais
 * utilisée.
 */
export const aiSettingsInputSchema = z
  .object({
    provider: providerSchema,
    model: z.string().trim().min(1).max(MAX_MODEL_LENGTH),
    base_url: z.string().trim().max(MAX_BASE_URL_LENGTH).nullable().optional(),
    api_key: z.string().trim().min(1).max(MAX_API_KEY_LENGTH),
  })
  .superRefine((value, ctx) => {
    const needsBaseUrl = providerSpec(value.provider).needsBaseUrl;
    const given = value.base_url ?? "";

    if (needsBaseUrl && given === "") {
      ctx.addIssue({
        code: "custom",
        path: ["base_url"],
        message: "Une URL de base est requise pour un serveur OpenAI-compatible.",
      });
    }
    if (!needsBaseUrl && given !== "") {
      ctx.addIssue({
        code: "custom",
        path: ["base_url"],
        message: "Ce fournisseur a son propre point d'entrée : ne renseigne pas d'URL de base.",
      });
    }
  });

export type AiSettingsInput = z.infer<typeof aiSettingsInputSchema>;

/** Le corps de `POST /api/ai-settings` : tester, ou enregistrer. */
export const aiSettingsRequestSchema = z.object({
  action: z.enum(["test", "save"]),
  settings: aiSettingsInputSchema,
});

export type AiSettingsRequest = z.infer<typeof aiSettingsRequestSchema>;

/* ------------------------------------------------------------------ */
/* Ce que la fonction rend                                             */
/* ------------------------------------------------------------------ */

/**
 * La configuration telle qu'elle est **rendue** : jamais la clé, seulement le
 * fait qu'il y en ait une. Cette omission est le contrat.
 */
export const aiSettingsSchema = z.object({
  provider: providerSchema,
  model: z.string().min(1),
  baseUrl: z.string().min(1).nullable(),
  /** Horodatage ISO 8601 du dernier enregistrement. */
  updatedAt: z.string().min(1),
  /** Une clé est-elle en place ? Sa valeur, elle, ne sort jamais d'ici. */
  hasKey: z.boolean(),
});

export type AiSettings = z.infer<typeof aiSettingsSchema>;

/** `GET`, `POST action=save` et `DELETE` rendent tous la même chose. */
export const aiSettingsResponseSchema = z.object({
  settings: aiSettingsSchema.nullable(),
});

export type AiSettingsResponse = z.infer<typeof aiSettingsResponseSchema>;

/**
 * Le verdict d'un test de connexion.
 *
 * Un test raté n'est pas une panne de notre fonction : elle a fait son travail
 * — appeler le fournisseur et rapporter. D'où un 200 avec `ok: false` plutôt
 * qu'un code d'erreur HTTP, qui aurait mélangé « ta clé est refusée » avec
 * « notre service est cassé ».
 */
export const aiTestResponseSchema = z.object({
  ok: z.boolean(),
  message: z.string().min(1),
});

export type AiTestResponse = z.infer<typeof aiTestResponseSchema>;

/** La réponse d'erreur de `api/ai-settings`, comme partout ailleurs. */
export const aiSettingsErrorSchema = z.object({ error: z.string().min(1) });
