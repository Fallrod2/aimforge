/**
 * Appel de la fonction serverless `/api/ai-settings` (SPEC §5 ter).
 *
 * Comme `coach-api.ts`, ce module passe par HTTP là où le reste du client va
 * directement à Postgres, et pour une raison précise : la clé. La table
 * autorise bien le navigateur à l'**écrire** (privilèges de colonne, migration
 * 0008), mais tester une connexion depuis le navigateur est impossible — CORS
 * d'un côté, et surtout la clé qui traverserait le réseau du navigateur vers
 * cinq fournisseurs différents. Une seule porte, donc, et c'est la fonction.
 *
 * Ce module ne connaît jamais la clé enregistrée : il l'envoie, il ne la relit
 * pas. `hasKey` est tout ce qui revient.
 */

import {
  type AiLinkPollResponse,
  type AiLinkStart,
  type AiSettings,
  type AiSettingsInput,
  type AiTestResponse,
  aiLinkPollResponseSchema,
  aiLinkStartResponseSchema,
  aiSettingsErrorSchema,
  aiSettingsResponseSchema,
  aiTestResponseSchema,
} from "../../shared/ai-settings-contract";
import { supabase } from "../supabase/client";
import { NO_SESSION_MESSAGE } from "./errors";

const PATH = "/api/ai-settings";

/** Échec d'un appel aux réglages IA, porteur d'un message destiné à l'écran. */
export class AiSettingsError extends Error {
  override readonly name = "AiSettingsError";
  /** Statut HTTP, ou `0` si la requête n'a jamais abouti. */
  readonly status: number;

  constructor(message: string, status: number, cause?: unknown) {
    super(message, { cause });
    this.status = status;
  }
}

const OFFLINE = "Service injoignable : vérifie ta connexion, puis réessaie.";

const NOT_DEPLOYED =
  "Les réglages IA ne sont pas servis ici : les fonctions `/api/**` sont absentes. En local, lance `bunx vercel dev` plutôt que `bun dev`.";

const UNEXPECTED = "Réponse inattendue du service. Réessaie dans un instant.";

function errorMessage(status: number, body: string): string {
  try {
    const parsed = aiSettingsErrorSchema.safeParse(JSON.parse(body));

    if (parsed.success) return parsed.data.error;
  } catch {
    // Corps non-JSON : le 404 servi par Vite en développement, ou une page
    // d'erreur de plateforme. Traité juste en dessous.
  }
  return status === 404 ? NOT_DEPLOYED : UNEXPECTED;
}

async function call(method: string, payload?: unknown): Promise<unknown> {
  const { data, error } = await supabase.auth.getSession();
  const token = data.session?.access_token;

  if (error !== null || token === undefined) {
    throw new AiSettingsError(NO_SESSION_MESSAGE, 401, error);
  }

  let response: Response;

  try {
    response = await fetch(PATH, {
      method,
      headers: {
        authorization: `Bearer ${token}`,
        ...(payload === undefined ? {} : { "content-type": "application/json" }),
      },
      body: payload === undefined ? undefined : JSON.stringify(payload),
    });
  } catch (cause) {
    throw new AiSettingsError(OFFLINE, 0, cause);
  }

  const body = await response.text();

  if (!response.ok) {
    throw new AiSettingsError(errorMessage(response.status, body), response.status);
  }

  try {
    return JSON.parse(body);
  } catch (cause) {
    throw new AiSettingsError(UNEXPECTED, response.status, cause);
  }
}

function readSettings(payload: unknown, status = 200): AiSettings | null {
  const parsed = aiSettingsResponseSchema.safeParse(payload);

  if (!parsed.success) throw new AiSettingsError(UNEXPECTED, status, parsed.error);
  return parsed.data.settings;
}

/** La configuration enregistrée, ou `null` s'il n'y en a pas. Jamais la clé. */
export async function getAiSettings(): Promise<AiSettings | null> {
  return readSettings(await call("GET"));
}

/** Enregistre (ou remplace) la configuration, et rend ce qui est réellement stocké. */
export async function saveAiSettings(settings: AiSettingsInput): Promise<AiSettings | null> {
  return readSettings(await call("POST", { action: "save", settings }));
}

/**
 * Teste la configuration **sans l'enregistrer**.
 *
 * Un test raté n'est pas une erreur d'appel : il rend un verdict. D'où un
 * `AiTestResponse` plutôt qu'une exception — l'écran affiche le verdict à
 * l'endroit du bouton, pas une bannière rouge de panne.
 */
export async function testAiSettings(settings: AiSettingsInput): Promise<AiTestResponse> {
  const payload = await call("POST", { action: "test", settings });
  const parsed = aiTestResponseSchema.safeParse(payload);

  if (!parsed.success) throw new AiSettingsError(UNEXPECTED, 200, parsed.error);
  return parsed.data;
}

/** Retire la configuration : retour au fournisseur de la plateforme et à son quota. */
export async function deleteAiSettings(): Promise<void> {
  readSettings(await call("DELETE"));
}

/* ------------------------------------------------------------------ */
/* Liaison de compte (ChatGPT abonnement)                              */
/* ------------------------------------------------------------------ */

/**
 * Ouvre une demande d'autorisation chez OpenAI et rend de quoi la présenter :
 * le code à recopier, la page à ouvrir, et un jeton opaque à rendre tel quel à
 * `pollChatGptLink`. Ce jeton ne porte aucun secret — les jetons de la liaison,
 * eux, ne quittent jamais le serveur.
 */
export async function startChatGptLink(): Promise<AiLinkStart> {
  const payload = await call("POST", { action: "link_start" });
  const parsed = aiLinkStartResponseSchema.safeParse(payload);

  if (!parsed.success) throw new AiSettingsError(UNEXPECTED, 200, parsed.error);
  return parsed.data.link;
}

/**
 * Demande où en est l'autorisation. Un seul aller-retour : c'est l'écran qui
 * décide du rythme et du moment d'arrêter.
 */
export async function pollChatGptLink(handle: string): Promise<AiLinkPollResponse> {
  const payload = await call("POST", { action: "link_poll", handle });
  const parsed = aiLinkPollResponseSchema.safeParse(payload);

  if (!parsed.success) throw new AiSettingsError(UNEXPECTED, 200, parsed.error);
  return parsed.data;
}
