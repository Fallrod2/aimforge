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

/** Ce que le fournisseur demande à l'utilisateur pour l'autoriser. */
export type ProviderAuth =
  /** Une clé d'API, collée dans un champ. Le cas de tout le monde, sauf un. */
  | "key"
  /**
   * Une **liaison de compte** : aucune clé à coller, l'utilisateur autorise
   * AimForge chez le fournisseur et le serveur garde des jetons qu'il
   * rafraîchit seul. C'est le cas de ChatGPT (abonnement) — voir plus bas.
   */
  | "account_link";

interface ProviderBase {
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
  /**
   * Marqué expérimental : l'écran doit afficher le badge **et**
   * l'avertissement. Ce n'est pas une nuance esthétique — c'est la seule chose
   * qui prévient l'utilisateur que sa configuration peut cesser de marcher
   * sans que rien n'ait changé chez nous.
   */
  readonly experimental?: string;
}

/** Un fournisseur qui s'autorise par une clé : l'écran demande un champ. */
export interface KeyProviderSpec extends ProviderBase {
  readonly auth: "key";
  /** Ce que l'écran doit demander : « clé d'API », ou autre chose. */
  readonly keyLabel: string;
  readonly keyHint: string;
}

/** Un fournisseur qui s'autorise par liaison : l'écran demande un bouton. */
export interface LinkProviderSpec extends ProviderBase {
  readonly auth: "account_link";
  /** Ce que l'écran explique **avant** le clic sur « Lier ». */
  readonly linkHint: string;
}

/**
 * Les deux formes sont un type somme, et non un objet aux champs facultatifs :
 * un fournisseur à liaison n'a pas de « libellé de clé », et le compilateur
 * doit le savoir. C'est ce qui a empêché l'écran de redemander une clé à
 * ChatGPT (abonnement) après son passage en liaison de compte.
 */
export type ProviderSpec = KeyProviderSpec | LinkProviderSpec;

/**
 * Le modèle Anthropic de la plateforme, et le défaut proposé à qui apporte sa
 * propre clé Anthropic : le même que `api/coach.ts` et `api/routine.ts`
 * utilisent aujourd'hui, pour que « ma clé » ne change rien d'autre que qui
 * paie.
 */
export const DEFAULT_ANTHROPIC_MODEL = "claude-sonnet-4-6";

/**
 * Les modèles que le back-end Codex sert à un abonnement ChatGPT.
 *
 * Ce n'est **pas** le catalogue de l'API d'OpenAI, et c'est toute la raison
 * d'être de cette constante : le back-end refuse par un 400 tout modèle qui
 * n'appartient pas à la famille Codex (« The 'gpt-5' model is not supported
 * when using Codex with a ChatGPT account. »). Proposer `gpt-5` en défaut,
 * comme on le faisait, garantissait un premier appel refusé à qui venait de
 * lier son compte.
 *
 * Il n'existe pas de point d'entrée fiable qui liste ces modèles : la liste est
 * relevée sur le client officiel (reprise de `codex-constants.ts` du projet
 * engram, 07/2026). Elle vieillira — d'où le champ resté libre à l'écran. Ce
 * qu'elle garantit, c'est que la valeur **proposée** est servie aujourd'hui.
 */
export const CODEX_MODELS = ["gpt-5.5", "gpt-5.6-sol", "gpt-5.6-terra", "gpt-5.6-luna"] as const;

/** Le modèle proposé à qui vient de lier son abonnement ChatGPT. */
export const DEFAULT_CODEX_MODEL = "gpt-5.5";

export const PROVIDERS: readonly ProviderSpec[] = [
  {
    id: "anthropic",
    label: "Anthropic",
    hint: "Le même moteur que la version par défaut, mais sur ta clé.",
    defaultModel: DEFAULT_ANTHROPIC_MODEL,
    models: [DEFAULT_ANTHROPIC_MODEL, "claude-sonnet-5", "claude-opus-5", "claude-haiku-4-5"],
    needsBaseUrl: false,
    auth: "key",
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
    auth: "key",
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
    auth: "key",
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
    auth: "key",
    keyLabel: "Clé d'API",
    keyHint: "Depuis console.mistral.ai.",
  },
  {
    id: "chatgpt_subscription",
    label: "ChatGPT (abonnement)",
    hint: "Utilise ton abonnement ChatGPT plutôt qu'une clé d'API facturée à l'usage.",
    defaultModel: DEFAULT_CODEX_MODEL,
    models: CODEX_MODELS,
    needsBaseUrl: false,
    auth: "account_link",
    linkHint:
      "Aucune clé à coller : tu autorises AimForge depuis ton compte ChatGPT (le même flux que le Codex CLI d'OpenAI, par code à saisir). Les jetons restent côté serveur, ne sont jamais réaffichés, et sont rafraîchis tout seuls.",
    experimental:
      "Ce chemin n'est pas une API publique : il dépend de la tolérance d'OpenAI et peut cesser de fonctionner du jour au lendemain, sans que rien ne change ici. Les limites de ton abonnement s'appliquent, la liaison peut être révoquée à tout moment côté OpenAI — il faudra alors relier ton compte.",
  },
];

export function providerSpec(id: ProviderId): ProviderSpec {
  const found = PROVIDERS.find((spec) => spec.id === id);

  // `PROVIDERS` couvre `PROVIDER_IDS` — le repli n'existe que pour le
  // compilateur, qui ne sait pas lire cette promesse.
  if (found === undefined) throw new Error(`fournisseur inconnu: ${id}`);
  return found;
}

/**
 * Les fournisseurs qui s'autorisent par une clé collée.
 *
 * C'est la liste que la **plateforme** peut servir (SPEC §5 quater) : une
 * liaison de compte appartient à une personne, et l'administration n'a pas de
 * compte ChatGPT à lier au nom de tout le monde. Proposer le choix aurait
 * produit une configuration plateforme impossible à honorer.
 */
export const KEY_PROVIDERS: readonly KeyProviderSpec[] = PROVIDERS.filter(
  (spec): spec is KeyProviderSpec => spec.auth === "key",
);

/** Ce fournisseur passe-t-il par une liaison de compte plutôt qu'une clé ? */
export function isLinkProvider(id: ProviderId): boolean {
  return providerSpec(id).auth === "account_link";
}

/* ------------------------------------------------------------------ */
/* Ce que le navigateur envoie                                         */
/* ------------------------------------------------------------------ */

/** Bornes de saisie : elles arrêtent l'absurde, pas l'utilisateur. */
export const MAX_MODEL_LENGTH = 200;
export const MAX_BASE_URL_LENGTH = 500;
export const MAX_API_KEY_LENGTH = 4000;

/** Longueur maximale du jeton opaque de liaison (voir `codex-handle.ts`). */
export const MAX_LINK_HANDLE_LENGTH = 4000;

/**
 * La cohérence `base_url` ↔ fournisseur, posée une fois.
 *
 * Elle suit la contrainte de la base (migration 0008) : obligatoire pour
 * `openai_compatible`, interdite ailleurs. La refuser ici plutôt que de
 * l'ignorer évite le pire des cas — une URL saisie, acceptée, et jamais
 * utilisée.
 */
function checkBaseUrlScope(
  value: { readonly provider: ProviderId; readonly base_url?: string | null },
  ctx: z.RefinementCtx,
): void {
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
}

/**
 * Une configuration proposée : celle qu'on teste, ou celle qu'on enregistre.
 *
 * `api_key` est **facultative dans la forme, obligatoire dans les faits** — et
 * la nuance est tout l'objet de la liaison de compte :
 *
 * - fournisseur à clé : elle est exigée, comme avant ;
 * - fournisseur à liaison (ChatGPT abonnement) : elle est **refusée**. Le
 *   navigateur n'a aucune clé à envoyer, et les jetons de la liaison ne
 *   traversent jamais le réseau dans ce sens. Un client qui en enverrait une
 *   se ferait refuser plutôt que d'écraser silencieusement la liaison.
 */
export const aiSettingsInputSchema = z
  .object({
    provider: providerSchema,
    model: z.string().trim().min(1).max(MAX_MODEL_LENGTH),
    base_url: z.string().trim().max(MAX_BASE_URL_LENGTH).nullable().optional(),
    api_key: z.string().trim().min(1).max(MAX_API_KEY_LENGTH).optional(),
  })
  .superRefine((value, ctx) => {
    checkBaseUrlScope(value, ctx);

    const linked = isLinkProvider(value.provider);

    if (!linked && value.api_key === undefined) {
      ctx.addIssue({ code: "custom", path: ["api_key"], message: "Une clé est requise." });
    }
    if (linked && value.api_key !== undefined) {
      ctx.addIssue({
        code: "custom",
        path: ["api_key"],
        message: "Ce fournisseur se lie par autorisation de compte : il n'y a pas de clé à poser.",
      });
    }
  });

export type AiSettingsInput = z.infer<typeof aiSettingsInputSchema>;

/**
 * La ligne de `public.ai_settings` telle que le serveur la **relit**, avec son
 * secret.
 *
 * Différente de l'entrée ci-dessus, et pour une raison qui n'est pas
 * cosmétique : en base, `api_key` est toujours présente et non vide (contrainte
 * de la migration 0008) — y compris pour ChatGPT (abonnement), où elle porte le
 * **groupe de jetons de la liaison** et non une clé :
 *
 * ```json
 * { "access_token": "…", "refresh_token": "…",
 *   "expires_at": "2026-08-09T12:34:56.000Z", "account_id": "…" }
 * ```
 *
 * `expires_at` est un horodatage ISO 8601 (expiration du jeton d'accès),
 * `account_id` est facultatif (claim `chatgpt_account_id` de l'`id_token`).
 * Cette forme ne sort **jamais** d'ici : elle est écrite par le flux de
 * liaison, relue par les fonctions serverless sous service role, et jamais
 * rendue au navigateur. Son schéma vit côté serveur
 * (`src/server/ai/codex-tokens.ts`) pour ne pas voyager dans le bundle client.
 */
export const storedAiSettingsSchema = z
  .object({
    provider: providerSchema,
    model: z.string().trim().min(1).max(MAX_MODEL_LENGTH),
    base_url: z.string().trim().max(MAX_BASE_URL_LENGTH).nullable().optional(),
    api_key: z.string().min(1),
  })
  .superRefine(checkBaseUrlScope);

export type StoredAiSettingsInput = z.infer<typeof storedAiSettingsSchema>;

/**
 * Le corps de `POST /api/ai-settings`.
 *
 * Quatre gestes, et deux d'entre eux n'existent que pour la liaison de compte :
 * `link_start` demande un code à OpenAI, `link_poll` attend que l'utilisateur
 * ait autorisé. Aucun des deux ne porte de secret — ni à l'aller (le jeton
 * opaque ne contient que l'identifiant de la demande), ni au retour.
 */
export const aiSettingsRequestSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("test"), settings: aiSettingsInputSchema }),
  z.object({ action: z.literal("save"), settings: aiSettingsInputSchema }),
  z.object({ action: z.literal("link_start") }),
  z.object({
    action: z.literal("link_poll"),
    handle: z.string().min(1).max(MAX_LINK_HANDLE_LENGTH),
  }),
]);

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

/* ------------------------------------------------------------------ */
/* Liaison de compte (ChatGPT abonnement)                              */
/* ------------------------------------------------------------------ */

/**
 * Ce que `link_start` rend : de quoi afficher la marche à suivre, et rien
 * d'autre.
 *
 * `handle` est un jeton **opaque** signé côté serveur : il porte l'identifiant
 * de la demande d'autorisation (et l'identité de son demandeur), pas un
 * secret. Il fait l'aller-retour par le navigateur parce que `link_start` et
 * `link_poll` peuvent tomber sur deux instances serverless différentes — il n'y
 * a pas de mémoire partagée entre elles, et on ne crée pas de table pour un
 * état qui vit quinze minutes.
 */
export const aiLinkStartSchema = z.object({
  /** Le code que l'utilisateur recopie sur la page d'OpenAI. */
  userCode: z.string().min(1),
  /** La page à ouvrir pour autoriser. */
  verificationUri: z.string().min(1),
  /** Durée de validité de la demande, en secondes. */
  expiresIn: z.number().int().positive(),
  /** À renvoyer tel quel dans `link_poll`. */
  handle: z.string().min(1),
});

export type AiLinkStart = z.infer<typeof aiLinkStartSchema>;

export const aiLinkStartResponseSchema = z.object({ link: aiLinkStartSchema });

export type AiLinkStartResponse = z.infer<typeof aiLinkStartResponseSchema>;

/**
 * L'état d'une liaison en cours.
 *
 * - `pending` : l'utilisateur n'a pas encore autorisé — on continue d'attendre ;
 * - `linked` : c'est fait, les jetons sont enregistrés (jamais rendus) ;
 * - `expired` : la demande a passé son délai, ou le jeton opaque n'est plus
 *   lisible — il faut recommencer ;
 * - `denied` : OpenAI a refusé (autorisation refusée, ou échange impossible).
 */
export const aiLinkStatusSchema = z.enum(["pending", "linked", "expired", "denied"]);

export type AiLinkStatus = z.infer<typeof aiLinkStatusSchema>;

/**
 * Ce que `link_poll` rend. `settings` n'est renseigné qu'au moment où la
 * liaison aboutit : l'écran bascule alors sur la configuration réellement
 * enregistrée, sans avoir à la redemander.
 */
export const aiLinkPollResponseSchema = z.object({
  status: aiLinkStatusSchema,
  settings: aiSettingsSchema.nullable(),
});

export type AiLinkPollResponse = z.infer<typeof aiLinkPollResponseSchema>;

/** La réponse d'erreur de `api/ai-settings`, comme partout ailleurs. */
export const aiSettingsErrorSchema = z.object({ error: z.string().min(1) });
