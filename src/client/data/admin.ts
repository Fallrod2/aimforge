/**
 * Appels des fonctions `/api/admin/*` (SPEC §5 quater), et la seule question
 * que le navigateur pose directement à Postgres sur ce sujet : « suis-je
 * administrateur ? ».
 *
 * Deux chemins, deux raisons :
 *
 * - **`isPlatformAdmin`** passe par PostgREST, sous RLS. La policy `select own`
 *   de la migration 0009 fait qu'un `select` rend au plus une ligne — la
 *   sienne. Cette lecture ne sert qu'à afficher ou non l'entrée de menu ; elle
 *   n'ouvre aucune porte, et c'est important : la sécurité réelle est la
 *   vérification faite dans chaque endpoint, côté serveur. Cacher un lien n'a
 *   jamais protégé personne ;
 * - **`getAdminSettings` / `saveAdminSettings` / `getAdminUsage`** passent par
 *   HTTP, parce que ce qu'elles manipulent — la présence des clés, les
 *   agrégats de tous les utilisateurs — n'est lisible que par la service key.
 *
 * Ce module ne connaît jamais les clés enregistrées : il les envoie, il ne les
 * relit pas. `hasAiKey` et `hasHenrikKey` sont tout ce qui revient.
 *
 * Le 404 a ici un sens précis et voulu : ce n'est pas « la fonction est
 * absente », c'est « rien à voir ici » — la réponse que le serveur fait à tout
 * ce qui n'est pas un administrateur. L'écran le traite comme tel.
 */

import {
  type AdminSettings,
  type AdminSettingsSave,
  type AdminUsage,
  adminErrorSchema,
  adminSettingsResponseSchema,
  adminUsageResponseSchema,
} from "../../shared/admin-contract";
import { supabase } from "../supabase/client";
import { NO_SESSION_MESSAGE } from "./errors";

const SETTINGS_PATH = "/api/admin/settings";
const USAGE_PATH = "/api/admin/usage";

/** Échec d'un appel d'administration, porteur d'un message destiné à l'écran. */
export class AdminError extends Error {
  override readonly name = "AdminError";
  /** Statut HTTP, ou `0` si la requête n'a jamais abouti. */
  readonly status: number;

  constructor(message: string, status: number, cause?: unknown) {
    super(message, { cause });
    this.status = status;
  }
}

const OFFLINE = "Service injoignable : vérifie ta connexion, puis réessaie.";

const NOT_DEPLOYED =
  "L'administration n'est pas servie ici : les fonctions `/api/**` sont absentes. En local, lance `bunx vercel dev` plutôt que `bun dev`.";

const UNEXPECTED = "Réponse inattendue du service. Réessaie dans un instant.";

function errorMessage(status: number, body: string): string {
  try {
    const parsed = adminErrorSchema.safeParse(JSON.parse(body));

    if (parsed.success) return parsed.data.error;
  } catch {
    // Corps non-JSON : le 404 servi par Vite en développement, ou une page
    // d'erreur de plateforme. Traité juste en dessous.
  }
  return status === 404 ? NOT_DEPLOYED : UNEXPECTED;
}

async function call(path: string, method: string, payload?: unknown): Promise<unknown> {
  const { data, error } = await supabase.auth.getSession();
  const token = data.session?.access_token;

  if (error !== null || token === undefined) {
    throw new AdminError(NO_SESSION_MESSAGE, 401, error);
  }

  let response: Response;

  try {
    response = await fetch(path, {
      method,
      headers: {
        authorization: `Bearer ${token}`,
        ...(payload === undefined ? {} : { "content-type": "application/json" }),
      },
      body: payload === undefined ? undefined : JSON.stringify(payload),
    });
  } catch (cause) {
    throw new AdminError(OFFLINE, 0, cause);
  }

  const body = await response.text();

  if (!response.ok) {
    throw new AdminError(errorMessage(response.status, body), response.status);
  }

  try {
    return JSON.parse(body);
  } catch (cause) {
    throw new AdminError(UNEXPECTED, response.status, cause);
  }
}

function readSettings(payload: unknown, status = 200): AdminSettings {
  const parsed = adminSettingsResponseSchema.safeParse(payload);

  if (!parsed.success) throw new AdminError(UNEXPECTED, status, parsed.error);
  return parsed.data.settings;
}

/** La configuration de la plateforme, sans aucune clé. */
export async function getAdminSettings(): Promise<AdminSettings> {
  return readSettings(await call(SETTINGS_PATH, "GET"));
}

/**
 * Enregistre un ou plusieurs blocs, et rend l'état complet qui en résulte.
 *
 * L'appelant n'envoie que ce qu'il modifie : les blocs absents ne sont pas
 * touchés, un `null` explicite efface (donc fait retomber sur la variable
 * d'environnement). Voir `adminSettingsSaveSchema`.
 */
export async function saveAdminSettings(patch: AdminSettingsSave): Promise<AdminSettings> {
  return readSettings(await call(SETTINGS_PATH, "POST", patch));
}

/** Les agrégats du jour et des quatorze derniers jours. Aucune identité. */
export async function getAdminUsage(): Promise<AdminUsage> {
  const parsed = adminUsageResponseSchema.safeParse(await call(USAGE_PATH, "GET"));

  if (!parsed.success) throw new AdminError(UNEXPECTED, 200, parsed.error);
  return parsed.data.usage;
}

/* ------------------------------------------------------------------ */
/* « Suis-je administrateur ? »                                        */
/* ------------------------------------------------------------------ */

/**
 * Le passage dans `platform_admins`, lu sous RLS avec le JWT du navigateur.
 *
 * Une erreur rend `false` : l'entrée de menu ne s'affiche pas, et rien d'autre
 * ne change — l'administration reste joignable par son adresse, où le serveur
 * refera la vérification pour de bon.
 */
export async function isPlatformAdmin(userId: string): Promise<boolean> {
  const { data, error } = await supabase
    .from("platform_admins")
    .select("user_id")
    .eq("user_id", userId)
    .maybeSingle();

  if (error !== null) return false;
  return data !== null;
}
