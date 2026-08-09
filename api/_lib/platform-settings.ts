/**
 * L'accès à `public.platform_settings` depuis les fonctions serverless
 * (SPEC §5 quater), et la vérification d'habilitation qui va avec.
 *
 * **Toujours sous service role, et nulle part ailleurs.** Les privilèges de
 * colonne de la migration 0009 interdisent à `authenticated` — administrateur
 * compris — de lire `ai_api_key` et `henrikdev_api_key` ; ce chemin est donc le
 * seul qui existe pour les obtenir, et il n'est emprunté que par les fonctions
 * qui ont un appel à passer.
 *
 * Le contrat de ce module tient en une phrase : **il ne lève jamais et il ne
 * bloque jamais.** Une table vide, une ligne absente, une base injoignable, une
 * service key non posée — les quatre rendent la même chose : la configuration
 * d'avant le panneau (variables d'environnement, constantes de quota). Mettre
 * l'administration en service ne pouvait pas devenir une nouvelle façon de
 * tomber en panne ; c'est la raison d'être du repli, et il est ici plutôt que
 * dans chaque appelant.
 *
 * Un seul aller-retour par requête : les quatre quotas, les deux clés et le
 * plafond global sortent de la même ligne, lue une fois. Chaque fonction
 * appelle donc `loadPlatformSettings` une fois et se sert dans le résultat.
 *
 * Le préfixe `_` sort ce fichier du routage Vercel : il est importé, jamais
 * appelé en HTTP.
 */

import { z } from "zod";
import {
  type PlatformSettingsRow,
  type ResolvedPlatformSettings,
  resolvePlatformSettings,
} from "../../src/server/platform/settings.js";
import type { ServiceClient } from "./service.js";

/** La ligne unique : elle est amorcée par la migration, elle ne bouge pas. */
const ROW_ID = 1;

/**
 * Les colonnes lues. Nommées explicitement plutôt qu'un `*` : ce module est le
 * seul endroit du projet qui lit deux secrets, et la liste doit se voir.
 */
export const PLATFORM_SETTINGS_COLUMNS =
  "ai_provider, ai_model, ai_base_url, ai_api_key, henrikdev_api_key, coach_daily, routine_daily, kovaaks_import_daily, riot_link_daily, ai_global_daily_limit, updated_at";

/**
 * La ligne, revalidée à la frontière. Postgres garantit les types, pas le fait
 * que la colonne existe encore sous ce nom après une migration future.
 */
const rowSchema = z.object({
  ai_provider: z.string().nullable(),
  ai_model: z.string().nullable(),
  ai_base_url: z.string().nullable(),
  ai_api_key: z.string().nullable(),
  henrikdev_api_key: z.string().nullable(),
  coach_daily: z.number().int(),
  routine_daily: z.number().int(),
  kovaaks_import_daily: z.number().int(),
  riot_link_daily: z.number().int(),
  ai_global_daily_limit: z.number().int().nullable(),
  updated_at: z.string(),
}) satisfies z.ZodType<PlatformSettingsRow, unknown>;

/** L'environnement d'avant le panneau : le filet sous chaque réglage. */
function environment() {
  return {
    anthropicKey: process.env.ANTHROPIC_API_KEY ?? "",
    henrikdevKey: process.env.HENRIKDEV_API_KEY ?? "",
  };
}

/**
 * La configuration effective de la plateforme.
 *
 * @param client Le client de service, ou `null` quand
 *   `SUPABASE_SERVICE_ROLE_KEY` n'est pas posée. `null` n'est pas une erreur
 *   ici : c'est simplement « pas de base », donc le repli complet sur
 *   l'environnement. Les fonctions qui ont besoin de la service key pour autre
 *   chose (compter un quota) le vérifient de leur côté, avec leur message.
 */
export async function loadPlatformSettings(
  client: ServiceClient | null,
): Promise<ResolvedPlatformSettings> {
  const env = environment();

  if (client === null) return resolvePlatformSettings(null, env);

  const { data, error } = await client
    .from("platform_settings")
    .select(PLATFORM_SETTINGS_COLUMNS)
    .eq("id", ROW_ID)
    .maybeSingle();

  if (error !== null) {
    // Volontairement non fatal : la plateforme retombe sur son comportement
    // d'avant plutôt que de refuser le service. Le détail part dans les logs
    // de la fonction — jamais dans une réponse, il parle d'une table de clés.
    console.error("[platform] lecture des réglages en échec", error.message);
    return resolvePlatformSettings(null, env);
  }

  const parsed = rowSchema.safeParse(data);

  if (!parsed.success) {
    if (data !== null) console.error("[platform] ligne de réglages hors contrat");
    return resolvePlatformSettings(null, env);
  }
  return resolvePlatformSettings(parsed.data, env);
}

/* ------------------------------------------------------------------ */
/* Plafond global                                                      */
/* ------------------------------------------------------------------ */

const usageSchema = z.number().int().min(0);

/**
 * Les appels IA déjà passés aujourd'hui **sur la clé de la plateforme**, tous
 * utilisateurs confondus — ou `null` si le compte n'a pas pu être fait.
 *
 * `null` laisse passer l'appel, et c'est un choix : le plafond protège un
 * budget, pas une ressource critique. Refuser tout le monde parce qu'une somme
 * n'a pas pu être calculée coûterait plus cher que le dépassement qu'on évite.
 * L'incident, lui, se voit dans les logs.
 */
export async function platformAiUsageToday(client: ServiceClient): Promise<number | null> {
  const { data, error } = await client.rpc("platform_ai_usage_today");

  if (error !== null) {
    console.error("[platform] somme d'usage IA du jour indisponible", error.message);
    return null;
  }

  const parsed = usageSchema.safeParse(data);

  if (!parsed.success) {
    console.error("[platform] somme d'usage IA du jour hors contrat");
    return null;
  }
  return parsed.data;
}

/* ------------------------------------------------------------------ */
/* Habilitation                                                        */
/* ------------------------------------------------------------------ */

/**
 * Cet utilisateur est-il administrateur de la plateforme ?
 *
 * Lecture **sous service role** : la policy `select own` de la migration 0009
 * suffirait avec le JWT de l'appelant, mais la vérification qui garde les
 * endpoints ne doit pas dépendre de ce que la RLS laisse voir à celui qu'on
 * vérifie. Ici, la question est posée par le serveur, sur un identifiant qui
 * vient de `getUser()`, et la réponse ne transite pas par le navigateur.
 *
 * En cas d'erreur de lecture : `false`. Une habilitation qu'on ne sait pas
 * établir n'est pas une habilitation — c'est le seul repli acceptable pour un
 * contrôle d'accès, et l'inverse exact du repli permissif des réglages.
 */
export async function isPlatformAdmin(client: ServiceClient, userId: string): Promise<boolean> {
  const { data, error } = await client
    .from("platform_admins")
    .select("user_id")
    .eq("user_id", userId)
    .maybeSingle();

  if (error !== null) {
    console.error("[platform] vérification d'administrateur en échec", error.message);
    return false;
  }
  return data !== null;
}
