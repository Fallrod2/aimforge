/**
 * Ce que la plateforme sert quand personne n'a apporté sa propre
 * configuration : quel fournisseur d'IA, quelle clé HenrikDev, quels quotas,
 * quel plafond global (SPEC §5 quater).
 *
 * Module **pur** : il reçoit une ligne (ou `null`) et un environnement, il rend
 * une décision. Aucun client Supabase, aucun `process.env` — c'est
 * `api/_lib/platform-settings.ts` qui va chercher la ligne et lit
 * l'environnement, ici on ne fait que trancher. La règle la plus importante du
 * fichier se teste donc sans base : **rien ne doit casser quand la table est
 * vide, absente ou illisible**. C'est exactement le cas qu'on ne peut pas
 * provoquer en production, et celui qui décide si la mise en service du
 * panneau d'administration est un non-événement ou une panne.
 *
 * Le repli est **champ par champ** : la clé HenrikDev peut venir de la base
 * pendant que la clé IA vient de l'environnement, et les quatre quotas peuvent
 * rester à leurs valeurs d'avant pendant que le plafond global est posé. Un
 * réglage non configuré ne tire aucun autre réglage avec lui.
 *
 * Une exception, et elle est délibérée : **la clé IA et son fournisseur
 * voyagent ensemble**. Quand la clé vient de l'environnement
 * (`ANTHROPIC_API_KEY`), le fournisseur qui l'accompagne est Anthropic, même si
 * la base nomme quelqu'un d'autre. Servir une clé Anthropic à Mistral ne
 * produirait pas un repli, mais un échec à chaque appel — et un échec dont
 * personne ne saurait dire d'où il vient.
 */

import {
  KOVAAKS_IMPORT_DAILY_LIMIT,
  RIOT_LINK_DAILY_LIMIT,
} from "../../client/data/linked-accounts-contract.js";
import type {
  AdminAiSettings,
  AdminLimits,
  AdminSettings,
  KeySource,
} from "../../shared/admin-contract.js";
import {
  DEFAULT_ANTHROPIC_MODEL,
  providerSchema,
  providerSpec,
} from "../../shared/ai-settings-contract.js";
import { COACH_DAILY_QUOTA } from "../../shared/coach-contract.js";
import { ROUTINE_DAILY_QUOTA } from "../../shared/routine-contract.js";
import type { PlatformAiConfig } from "../ai/resolve.js";

/**
 * La ligne `public.platform_settings`, telle que la base la rend.
 *
 * Toutes les colonnes de configuration sont nullables : « non configuré » est
 * un état normal du produit, pas une anomalie de données.
 */
export interface PlatformSettingsRow {
  readonly ai_provider: string | null;
  readonly ai_model: string | null;
  readonly ai_base_url: string | null;
  readonly ai_api_key: string | null;
  readonly henrikdev_api_key: string | null;
  readonly coach_daily: number;
  readonly routine_daily: number;
  readonly kovaaks_import_daily: number;
  readonly riot_link_daily: number;
  readonly ai_global_daily_limit: number | null;
  readonly updated_at: string;
}

/** Les variables d'environnement d'avant le panneau, qui restent le filet. */
export interface PlatformEnv {
  readonly anthropicKey: string;
  readonly henrikdevKey: string;
}

/**
 * Les valeurs par défaut sont **les constantes d'avant**, importées et non
 * recopiées : mettre le panneau en service ne change donc le comportement de
 * personne tant que personne n'y touche.
 */
export const DEFAULT_LIMITS: AdminLimits = {
  coachDaily: COACH_DAILY_QUOTA,
  routineDaily: ROUTINE_DAILY_QUOTA,
  kovaaksImportDaily: KOVAAKS_IMPORT_DAILY_LIMIT,
  riotLinkDaily: RIOT_LINK_DAILY_LIMIT,
};

export interface ResolvedPlatformSettings {
  /**
   * La configuration à servir aux utilisateurs sans config perso, clé
   * comprise. `null` : aucune clé nulle part — le coach et la routine doivent
   * répondre « IA non configurée » plutôt que d'appeler dans le vide.
   */
  readonly ai: PlatformAiConfig | null;
  readonly aiKeySource: KeySource;
  /** La configuration **enregistrée en base**, pour l'écran d'administration. */
  readonly storedAi: AdminAiSettings | null;
  readonly hasStoredAiKey: boolean;
  /** La clé HenrikDev effective, ou `""` si elle n'est nulle part. */
  readonly henrikdevKey: string;
  readonly henrikKeySource: KeySource;
  readonly hasStoredHenrikKey: boolean;
  readonly limits: AdminLimits;
  /** `null` = pas de plafond global journalier sur les appels plateforme. */
  readonly aiGlobalDailyLimit: number | null;
  /** `null` quand la ligne n'a pas pu être lue : tout le reste est un repli. */
  readonly updatedAt: string | null;
}

/** `null` et `"   "` disent la même chose : pas de valeur. */
function present(value: string | null | undefined): string | null {
  const trimmed = (value ?? "").trim();

  return trimmed === "" ? null : trimmed;
}

function keySource(fromDatabase: string | null, fromEnvironment: string): KeySource {
  if (fromDatabase !== null) return "database";
  return fromEnvironment.trim() === "" ? "none" : "environment";
}

/**
 * La configuration IA enregistrée, si elle est exploitable.
 *
 * Une ligne hors contrat (fournisseur inconnu, arrivé par une écriture
 * manuelle ou une version antérieure) est **ignorée** plutôt que servie à
 * moitié : la plateforme retombe alors sur l'environnement, ce qui est le
 * comportement d'avant, donc celui qu'on sait juste. Les contraintes de la
 * migration 0009 rendent le cas très improbable ; il n'est pas impossible.
 */
function storedAi(row: PlatformSettingsRow | null): AdminAiSettings | null {
  if (row === null) return null;

  const provider = providerSchema.safeParse(row.ai_provider);

  if (!provider.success) return null;

  const model = present(row.ai_model) ?? providerSpec(provider.data).defaultModel;
  const baseUrl = present(row.ai_base_url);

  // La cohérence que la base impose déjà (contrainte `platform_settings_ai_base_url`),
  // revérifiée ici parce que la contrainte protège la table, pas ce module.
  if (providerSpec(provider.data).needsBaseUrl && baseUrl === null) return null;

  return { provider: provider.data, model, baseUrl };
}

/** Un entier de quota lisible, ou le défaut. */
function limit(value: number | null | undefined, fallback: number): number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 ? value : fallback;
}

/**
 * La configuration effective de la plateforme.
 *
 * @param row La ligne unique de `public.platform_settings`, ou `null` quand
 *   elle est absente, vide de sens ou illisible — les trois se traitent
 *   pareil, et c'est le point : le repli est le comportement d'avant.
 */
export function resolvePlatformSettings(
  row: PlatformSettingsRow | null,
  env: PlatformEnv,
): ResolvedPlatformSettings {
  const stored = storedAi(row);
  const storedKey = present(row?.ai_api_key);
  const storedHenrik = present(row?.henrikdev_api_key);

  // La clé de base ne sert que si le fournisseur qui va avec est lisible :
  // sinon on ne saurait pas à qui la présenter (voir l'en-tête).
  const useStoredAi = stored !== null && storedKey !== null;
  const envAnthropic = env.anthropicKey.trim();

  const ai: PlatformAiConfig | null = useStoredAi
    ? { provider: stored.provider, model: stored.model, baseUrl: stored.baseUrl, apiKey: storedKey }
    : envAnthropic === ""
      ? null
      : {
          provider: "anthropic",
          model: DEFAULT_ANTHROPIC_MODEL,
          baseUrl: null,
          apiKey: envAnthropic,
        };

  const henrikdevKey = storedHenrik ?? env.henrikdevKey.trim();

  return {
    ai,
    aiKeySource: useStoredAi ? "database" : keySource(null, envAnthropic),
    storedAi: stored,
    hasStoredAiKey: storedKey !== null,
    henrikdevKey,
    henrikKeySource: keySource(storedHenrik, env.henrikdevKey),
    hasStoredHenrikKey: storedHenrik !== null,
    limits: {
      coachDaily: limit(row?.coach_daily, DEFAULT_LIMITS.coachDaily),
      routineDaily: limit(row?.routine_daily, DEFAULT_LIMITS.routineDaily),
      kovaaksImportDaily: limit(row?.kovaaks_import_daily, DEFAULT_LIMITS.kovaaksImportDaily),
      riotLinkDaily: limit(row?.riot_link_daily, DEFAULT_LIMITS.riotLinkDaily),
    },
    aiGlobalDailyLimit:
      typeof row?.ai_global_daily_limit === "number" && row.ai_global_daily_limit >= 0
        ? row.ai_global_daily_limit
        : null,
    updatedAt: row?.updated_at ?? null,
  };
}

/**
 * La vue que l'écran d'administration reçoit : tout, **sauf** les deux clés.
 *
 * L'omission est le contrat, pas une politesse d'affichage — la base refuse de
 * relire ces colonnes, même à l'admin (privilèges de colonne, migration 0009).
 * Ce qui sort ici, c'est leur présence et leur provenance.
 */
export function toAdminSettings(resolved: ResolvedPlatformSettings): AdminSettings {
  return {
    ai: resolved.storedAi,
    hasAiKey: resolved.hasStoredAiKey,
    aiKeySource: resolved.aiKeySource,
    hasHenrikKey: resolved.hasStoredHenrikKey,
    henrikKeySource: resolved.henrikKeySource,
    limits: resolved.limits,
    aiGlobalDailyLimit: resolved.aiGlobalDailyLimit,
    updatedAt: resolved.updatedAt,
  };
}

/* ------------------------------------------------------------------ */
/* Plafond global                                                      */
/* ------------------------------------------------------------------ */

/** Le message unique du plafond atteint : une seule phrase, un seul endroit. */
export const GLOBAL_CAP_REACHED =
  "La plateforme a atteint son plafond d'appels IA du jour. Le compteur repart demain (heure UTC) — ou configure ta propre clé dans Réglages IA pour ne plus en dépendre.";

/**
 * Le plafond est-il atteint ?
 *
 * Comparaison **avant** l'appel, et non après incrément comme le quota par
 * utilisateur : ici on ne consomme rien qu'on puisse relire, on regarde une
 * somme déjà écrite. Deux requêtes simultanées peuvent donc passer toutes les
 * deux sur la dernière unité — un dépassement d'une unité, borné par le nombre
 * d'appels en vol, et sans conséquence : le plafond protège un budget, pas une
 * ressource unique.
 *
 * `null` : pas de plafond. `0` : plateforme fermée — ce qui est un réglage
 * valide, et la raison pour laquelle la comparaison est `>=` et non `>`.
 */
export function globalCapReached(usedToday: number, limit: number | null): boolean {
  if (limit === null) return false;
  return usedToday >= limit;
}
