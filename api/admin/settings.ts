/**
 * `GET|POST /api/admin/settings` — la configuration de la plateforme
 * (SPEC §5 quater).
 *
 * Deux verbes, et trois règles qui ne se négocient pas :
 *
 * 1. **La vérification d'admin est faite ici, côté serveur, avant tout le
 *    reste.** L'entrée cachée dans l'interface est un confort d'affichage, pas
 *    une sécurité : ces deux fonctions sont appelables directement, avec un
 *    jeton valide de n'importe quel compte. `requireAdmin` répond 404 à tout ce
 *    qui n'est pas un administrateur prouvé — voir `api/_lib/admin.ts` pour le
 *    pourquoi du 404 plutôt que du 403 ;
 * 2. **les clés entrent, elles ne ressortent jamais.** Aucune réponse de ce
 *    fichier ne porte `ai_api_key` ni `henrikdev_api_key` ; `GET` rend
 *    `hasAiKey` / `hasHenrikKey` et la **provenance** de la clé effective
 *    (base ou environnement). C'est la moitié applicative du verrou posé en
 *    base (migration 0009, privilèges de colonne), et les deux moitiés doivent
 *    rester d'accord — y compris pour l'admin, qui ne relit pas plus que les
 *    autres ;
 * 3. **l'écriture passe par le JWT de l'admin**, pas par la service key. Les
 *    policies admin-only de la migration 0009 revérifient donc l'habilitation
 *    en base : une fonction qui se tromperait de garde se ferait refuser par
 *    Postgres. La service key ne sert qu'à ce que la RLS interdit par
 *    construction — savoir si une clé est posée sans jamais la lire.
 *
 * La lecture des colonnes de clés étant impossible même pour l'admin, la
 * réponse est toujours construite à partir de la lecture **service role**
 * (`loadPlatformSettings`), jamais du retour de l'écriture. C'est aussi ce qui
 * évite le piège de PostgREST documenté en `api/_lib/ai-settings.ts` : une
 * écriture qui relit toutes ses colonnes échouerait en 42501.
 *
 * Les deux verbes sont exportés nommément (`GET`, `POST`) : c'est la forme que
 * le runtime Node de Vercel reconnaît comme gestionnaire web. Les autres
 * méthodes n'ont pas d'export, la plateforme y répond 405 toute seule.
 */

import type { Database } from "../../src/client/supabase/database-types.js";
import { checkBaseUrl, storedBaseUrl } from "../../src/server/ai/index.js";
import { toAdminSettings } from "../../src/server/platform/settings.js";
import {
  type AdminSettingsResponse,
  type AdminSettingsSave,
  adminSettingsSaveSchema,
} from "../../src/shared/admin-contract.js";
import { requireAdmin } from "../_lib/admin.js";
import { loadPlatformSettings } from "../_lib/platform-settings.js";
import { fail, json, readBody } from "../_lib/request.js";

/** Aucun appel à un modèle ici : lire une ligne et en écrire une autre. */
export const maxDuration = 15;

const SAVE_FAILED =
  "Les réglages de la plateforme n'ont pas pu être enregistrés. Réessaie ; si cela persiste, recharge la page.";

const INVALID_BODY =
  "Réglages invalides : vérifie le fournisseur, le modèle et les valeurs numériques.";

type SettingsUpdate = Database["public"]["Tables"]["platform_settings"]["Update"];

/** La ligne unique, amorcée par la migration 0009 : on ne fait que l'écrire. */
const ROW_ID = 1;

/* ------------------------------------------------------------------ */
/* GET                                                                 */
/* ------------------------------------------------------------------ */

export async function GET(request: Request): Promise<Response> {
  const admin = await requireAdmin(request);

  if (!admin.ok) return admin.response;

  const settings = await loadPlatformSettings(admin.service);

  return json({ settings: toAdminSettings(settings) } satisfies AdminSettingsResponse, 200);
}

/* ------------------------------------------------------------------ */
/* POST                                                                */
/* ------------------------------------------------------------------ */

export async function POST(request: Request): Promise<Response> {
  const admin = await requireAdmin(request);

  if (!admin.ok) return admin.response;

  const body = await readBody(request, adminSettingsSaveSchema, INVALID_BODY);

  if (!body.ok) return body.response;

  // L'état courant, lu avant d'écrire : il sert à deux choses, et les deux
  // comptent. Refuser un changement de fournisseur sans sa clé (ci-dessous), et
  // rendre la réponse — puisque l'écriture, elle, ne peut rien relire.
  const current = await loadPlatformSettings(admin.service);
  const patch = buildPatch(body.value, current.storedAi?.provider ?? null, current.hasStoredAiKey);

  if (!patch.ok) return fail(patch.reason, 400);

  const { error } = await admin.client
    .from("platform_settings")
    .update(patch.value)
    // Pas de `.select()` : relire la ligne relirait les colonnes de clés, que
    // les privilèges de colonne refusent à `authenticated` (42501) — l'écriture
    // entière échouerait. La réponse est reconstruite plus bas, sous service
    // role, sans jamais porter de secret.
    .eq("id", ROW_ID);

  if (error !== null) {
    console.error("[admin] enregistrement des réglages en échec", error.message);
    return fail(SAVE_FAILED, 503);
  }

  const settings = await loadPlatformSettings(admin.service);

  return json({ settings: toAdminSettings(settings) } satisfies AdminSettingsResponse, 200);
}

/* ------------------------------------------------------------------ */
/* Construction de l'écriture                                          */
/* ------------------------------------------------------------------ */

type Patch =
  | { readonly ok: true; readonly value: SettingsUpdate }
  | { readonly ok: false; readonly reason: string };

/**
 * Traduit un enregistrement partiel en colonnes.
 *
 * Trois valeurs par bloc, trois sens (voir `adminSettingsSaveSchema`) :
 * **absent** ne touche à rien, **`null`** efface — donc fait retomber sur la
 * variable d'environnement —, une valeur remplace.
 *
 * Le refus le plus utile de cette fonction n'est pas syntaxique : on ne laisse
 * pas changer de fournisseur sans donner la clé qui va avec. La clé enregistrée
 * appartient à l'ancien fournisseur, et personne — pas même l'admin — ne peut
 * la relire pour s'en apercevoir. Sans ce garde-fou, la plateforme se
 * retrouverait avec une configuration qui a l'air complète à l'écran et qui
 * échoue à chaque appel.
 */
function buildPatch(
  input: AdminSettingsSave,
  currentProvider: string | null,
  hasKey: boolean,
): Patch {
  const value: SettingsUpdate = {};

  if (input.ai === null) {
    // Effacement complet du bloc IA : les quatre colonnes ensemble, sinon la
    // contrainte de cohérence de la migration 0009 refuserait l'écriture.
    value.ai_provider = null;
    value.ai_model = null;
    value.ai_base_url = null;
    value.ai_api_key = null;
  } else if (input.ai !== undefined) {
    const ai = input.ai;
    const keeps = ai.api_key === undefined;

    if (keeps && (!hasKey || currentProvider !== ai.provider)) {
      return {
        ok: false,
        reason: hasKey
          ? "Changer de fournisseur demande sa clé : celle qui est enregistrée appartient au fournisseur précédent, et elle n'est pas relisible."
          : "Aucune clé n'est enregistrée pour la plateforme : colle-en une.",
      };
    }

    // L'URL de base est appelée **par le serveur** : la vérifier n'est pas une
    // validation de formulaire, c'est ce qui empêche la fonction de servir de
    // relais vers l'intérieur de l'infrastructure (`src/server/ai/base-url.ts`).
    let baseUrl: string | null = null;

    if (ai.base_url !== undefined && ai.base_url !== null && ai.base_url !== "") {
      const checked = checkBaseUrl(ai.base_url);

      if (!checked.ok) return { ok: false, reason: checked.reason };
      baseUrl = storedBaseUrl(checked.url);
    }

    value.ai_provider = ai.provider;
    value.ai_model = ai.model;
    value.ai_base_url = baseUrl;
    if (!keeps) value.ai_api_key = ai.api_key;
  }

  if (input.henrikdevApiKey !== undefined) value.henrikdev_api_key = input.henrikdevApiKey;

  if (input.limits !== undefined) {
    value.coach_daily = input.limits.coachDaily;
    value.routine_daily = input.limits.routineDaily;
    value.kovaaks_import_daily = input.limits.kovaaksImportDaily;
    value.riot_link_daily = input.limits.riotLinkDaily;
  }

  if (input.aiGlobalDailyLimit !== undefined) {
    value.ai_global_daily_limit = input.aiGlobalDailyLimit;
  }

  return { ok: true, value };
}
