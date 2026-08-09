/**
 * Contrat du panneau d'administration (SPEC §5 quater) : la forme des échanges
 * entre l'écran d'administration et `api/admin/*`.
 *
 * Un seul module pour les deux côtés, comme les contrats du coach et des
 * réglages IA : la fonction valide ce qu'elle reçoit avec ces schémas, l'écran
 * valide ce qu'il reçoit avec les mêmes. Deux copies dériveraient, et la dérive
 * ne se verrait qu'en production — sur un quota à moitié enregistré.
 *
 * Ce que ce module ne contient **jamais** : les clés. Ni celle du fournisseur
 * IA de la plateforme, ni celle de HenrikDev. Aucune forme de sortie ne les
 * porte — seulement `hasAiKey` / `hasHenrikKey` et **d'où** la clé effective
 * vient (base ou environnement). C'est la traduction en TypeScript des
 * privilèges de colonne de la migration 0009, et les deux doivent rester
 * d'accord : l'admin pose les clés, il ne les relit pas.
 *
 * Module pur : Zod et rien d'autre.
 */

import { z } from "zod";
import {
  MAX_API_KEY_LENGTH,
  MAX_BASE_URL_LENGTH,
  MAX_MODEL_LENGTH,
  providerSchema,
  providerSpec,
} from "./ai-settings-contract.js";

/* ------------------------------------------------------------------ */
/* Bornes                                                              */
/* ------------------------------------------------------------------ */

/**
 * Bornes des quotas journaliers, identiques à celles de la migration 0009.
 *
 * `0` est permis, et ce n'est pas un oubli : c'est la façon de fermer une
 * fonctionnalité (le coach, les imports) sans redéployer quoi que ce soit.
 * Le plafond haut n'existe que pour arrêter l'absurde — un zéro glissé dans un
 * champ, une valeur collée par erreur.
 */
export const QUOTA_MIN = 0;
export const QUOTA_MAX = 1000;

/** Même rôle pour le plafond global journalier d'appels IA plateforme. */
export const GLOBAL_LIMIT_MIN = 0;
export const GLOBAL_LIMIT_MAX = 100_000;

/** Profondeur du tableau d'usage, en jours (aujourd'hui compris). */
export const USAGE_WINDOW_DAYS = 14;

/* ------------------------------------------------------------------ */
/* Ce que l'écran envoie                                               */
/* ------------------------------------------------------------------ */

/**
 * La configuration IA de la plateforme, envoyée **en bloc**.
 *
 * Fournisseur, modèle et URL de base forment un tout cohérent : enregistrer un
 * fournisseur sans son modèle, ou changer de fournisseur en gardant l'URL de
 * base du précédent, produirait un appel qui échoue sans que personne sache
 * pourquoi. La contrainte de la base (0009) dit la même chose ; ce schéma la
 * fait respecter avant d'y arriver, avec un message lisible.
 *
 * `api_key` est **facultative**, et c'est la seule subtilité : l'omettre veut
 * dire « garde celle qui est déjà enregistrée » — l'admin peut donc changer de
 * modèle sans avoir à recoller une clé qu'il ne peut pas relire.
 */
export const adminAiConfigSchema = z
  .object({
    provider: providerSchema,
    model: z.string().trim().min(1).max(MAX_MODEL_LENGTH),
    base_url: z.string().trim().max(MAX_BASE_URL_LENGTH).nullable().optional(),
    /** Absente = on garde la clé déjà enregistrée. Voir l'en-tête du schéma. */
    api_key: z.string().trim().min(1).max(MAX_API_KEY_LENGTH).optional(),
  })
  .superRefine((value, ctx) => {
    const spec = providerSpec(value.provider);

    // Un fournisseur à liaison de compte (ChatGPT abonnement) est personnel :
    // il s'autorise depuis le compte d'une personne, pas depuis un écran
    // d'administration. Le refuser ici évite une configuration plateforme
    // impossible à honorer — et qui n'échouerait qu'au premier debrief.
    if (spec.auth === "account_link") {
      ctx.addIssue({
        code: "custom",
        path: ["provider"],
        message:
          "Ce fournisseur se lie à un compte personnel : la plateforme ne peut pas le servir.",
      });
    }

    const needsBaseUrl = spec.needsBaseUrl;
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

export type AdminAiConfigInput = z.infer<typeof adminAiConfigSchema>;

const quotaSchema = z.number().int().min(QUOTA_MIN).max(QUOTA_MAX);

export const adminLimitsSchema = z.object({
  coachDaily: quotaSchema,
  routineDaily: quotaSchema,
  kovaaksImportDaily: quotaSchema,
  riotLinkDaily: quotaSchema,
});

export type AdminLimits = z.infer<typeof adminLimitsSchema>;

/**
 * Le corps de `POST /api/admin/settings` : un enregistrement **partiel**.
 *
 * Trois valeurs possibles par bloc, et les trois disent une chose différente :
 *
 * - **absent** : ne touche pas à ce réglage. C'est ce qui permet à l'écran
 *   d'enregistrer un bloc à la fois, sans avoir à renvoyer — donc à connaître —
 *   les autres ;
 * - **`null`** : efface ce réglage. Pour les clés et la config IA, effacer veut
 *   dire « retombe sur la variable d'environnement » ; pour le plafond global,
 *   « plus de plafond » ;
 * - **une valeur** : remplace.
 *
 * Un corps entièrement vide est refusé : il ne veut rien dire, et l'accepter
 * ferait passer un bug de l'écran pour un enregistrement réussi.
 */
export const adminSettingsSaveSchema = z
  .object({
    ai: adminAiConfigSchema.nullable().optional(),
    henrikdevApiKey: z.string().trim().min(1).max(MAX_API_KEY_LENGTH).nullable().optional(),
    limits: adminLimitsSchema.optional(),
    aiGlobalDailyLimit: z
      .number()
      .int()
      .min(GLOBAL_LIMIT_MIN)
      .max(GLOBAL_LIMIT_MAX)
      .nullable()
      .optional(),
  })
  .refine(
    (value) =>
      value.ai !== undefined ||
      value.henrikdevApiKey !== undefined ||
      value.limits !== undefined ||
      value.aiGlobalDailyLimit !== undefined,
    { message: "Rien à enregistrer." },
  );

export type AdminSettingsSave = z.infer<typeof adminSettingsSaveSchema>;

/* ------------------------------------------------------------------ */
/* Ce que les fonctions rendent                                        */
/* ------------------------------------------------------------------ */

/**
 * D'où vient la clé réellement utilisée :
 *
 * - `database` : posée dans le panneau, elle prend le pas sur l'environnement ;
 * - `environment` : rien en base, la variable Vercel d'avant fait le travail ;
 * - `none` : ni l'une ni l'autre — la fonctionnalité est hors service, et
 *   l'écran doit le dire au lieu de laisser croire qu'elle marche.
 */
export const keySourceSchema = z.enum(["database", "environment", "none"]);

export type KeySource = z.infer<typeof keySourceSchema>;

/** La configuration IA telle qu'elle est **enregistrée** — jamais la clé. */
export const adminAiSettingsSchema = z.object({
  provider: providerSchema,
  model: z.string().min(1),
  baseUrl: z.string().min(1).nullable(),
});

export type AdminAiSettings = z.infer<typeof adminAiSettingsSchema>;

export const adminSettingsSchema = z.object({
  /** `null` : rien en base, la plateforme tourne sur l'environnement. */
  ai: adminAiSettingsSchema.nullable(),
  hasAiKey: z.boolean(),
  aiKeySource: keySourceSchema,
  hasHenrikKey: z.boolean(),
  henrikKeySource: keySourceSchema,
  limits: adminLimitsSchema,
  aiGlobalDailyLimit: z.number().int().nullable(),
  /**
   * Horodatage ISO 8601 du dernier enregistrement, ou `null` quand la ligne de
   * configuration n'a pas pu être lue — auquel cas tout ce qui précède est la
   * valeur de repli, et l'écran doit le dire plutôt que d'inventer une date.
   */
  updatedAt: z.string().min(1).nullable(),
});

export type AdminSettings = z.infer<typeof adminSettingsSchema>;

export const adminSettingsResponseSchema = z.object({ settings: adminSettingsSchema });

export type AdminSettingsResponse = z.infer<typeof adminSettingsResponseSchema>;

/* ------------------------------------------------------------------ */
/* Usage                                                               */
/* ------------------------------------------------------------------ */

/**
 * Une journée de consommation, en heure UTC — la même horloge que les
 * compteurs (`ai_usage.day`, `import_usage.day`).
 *
 * Le partage plateforme / perso se lit sur deux colonnes plutôt que sur une
 * seule : `coachPlatform` vient du compteur de quota, qui n'est incrémenté que
 * sur la clé de la plateforme (SPEC §5 ter) ; `debriefsStored` compte les
 * debriefs réellement produits. La différence est la part payée par les
 * utilisateurs sur leur propre clé — **minorée** par ce qu'ils ont supprimé
 * depuis, et l'écran le dit.
 */
export const adminUsageDaySchema = z.object({
  /** `YYYY-MM-DD`, UTC. */
  day: z.string().min(1),
  coachPlatform: z.number().int(),
  routinePlatform: z.number().int(),
  kovaaksImports: z.number().int(),
  riotLinks: z.number().int(),
  debriefsStored: z.number().int(),
  routinesStored: z.number().int(),
  /** Utilisateurs distincts ayant consommé quelque chose ce jour-là. */
  activeUsers: z.number().int(),
});

export type AdminUsageDay = z.infer<typeof adminUsageDaySchema>;

export const adminUsageSchema = z.object({
  today: adminUsageDaySchema,
  /** La fenêtre complète, du plus ancien au plus récent, jours vides compris. */
  days: z.array(adminUsageDaySchema),
  /** Cumul sur la fenêtre ; `activeUsers` y est le nombre d'utilisateurs distincts. */
  totals: adminUsageDaySchema,
  /** Le plafond en vigueur, pour situer le compteur du jour. `null` = aucun. */
  aiGlobalDailyLimit: z.number().int().nullable(),
  /** Combien d'utilisateurs ont apporté leur propre clé (SPEC §5 ter). */
  personalConfigs: z.number().int(),
});

export type AdminUsage = z.infer<typeof adminUsageSchema>;

export const adminUsageResponseSchema = z.object({ usage: adminUsageSchema });

export type AdminUsageResponse = z.infer<typeof adminUsageResponseSchema>;

/** La réponse d'erreur des fonctions d'administration, comme partout ailleurs. */
export const adminErrorSchema = z.object({ error: z.string().min(1) });
