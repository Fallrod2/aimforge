/**
 * Le flux d'autorisation par code d'appareil de ChatGPT (abonnement) —
 * SPEC §5 ter.
 *
 * ⚠️ Ce **n'est pas** un flux RFC 8628 générique. C'est le flux propriétaire en
 * trois temps du Codex CLI d'OpenAI, transcrit ici depuis une implémentation
 * déjà éprouvée en production (projet engram, vérifiée contre le vrai serveur
 * le 14/07/2026). Les détails qui suivent ne se devinent pas, et chacun a été
 * payé une fois :
 *
 * 1. **`/api/accounts` fait partie de l'URL** des points d'entrée de code
 *    d'appareil (`api_base_url` du CLI). Sans ce préfixe, l'initialisation
 *    répond 404 — et un 404 signifie tout autre chose (voir plus bas) ;
 * 2. **l'attente répond 403 ou 404**, pas 400 `authorization_pending` : ces
 *    deux statuts veulent dire « l'utilisateur n'a pas encore autorisé » ;
 * 3. **le PKCE est fabriqué par OpenAI**, pas par nous : le corps de l'attente
 *    réussie porte `authorization_code` *et* `code_verifier`, qu'on renvoie
 *    tels quels au point d'entrée `oauth/token` ;
 * 4. **l'échange et le rafraîchissement vivent sur l'hôte nu**
 *    (`{issuer}/oauth/token`), sans le préfixe `/api/accounts` ;
 * 5. **`interval` arrive en chaîne de caractères** (`"5"`), pas en nombre.
 *
 * Un 404 à l'initialisation — et **seulement là** — a un sens précis : la
 * connexion par code d'appareil n'est pas activée sur le compte ChatGPT
 * (Réglages → Sécurité). Tout autre échec est une panne d'OpenAI, et le dire
 * franchement évite d'envoyer l'utilisateur régler une option qui n'a rien à
 * voir.
 *
 * Module **pur au réseau près** : `fetch` est injecté, donc tout se teste sans
 * compte ChatGPT et sans sortir de la machine. Il ne journalise **rien** — tout
 * ce qui passe ici est secret.
 */

import { accountIdOf, type CodexTokens, expiryOf } from "./codex-tokens.js";
import type { FetchLike } from "./openai-compatible.js";

/* ------------------------------------------------------------------ */
/* Constantes                                                          */
/* ------------------------------------------------------------------ */

/**
 * L'identifiant client **public** du Codex CLI d'OpenAI. Public au sens propre :
 * il est distribué dans un binaire open source, et tous les outils tiers qui
 * parlent à ce flux utilisent le même. Ce n'est pas un secret, et il n'y a rien
 * à mettre en variable d'environnement.
 */
export const CODEX_CLIENT_ID = "app_EMoamEEZ73f0CkXaXp7hrann";

/** L'hôte d'authentification d'OpenAI. Constante : aucun réglage utilisateur
 * ne décide où part une demande d'autorisation. */
const AUTH_BASE = "https://auth.openai.com";

/** Initialisation : `POST { client_id }`. Le préfixe `/api/accounts` est vital. */
export const USERCODE_URL = `${AUTH_BASE}/api/accounts/deviceauth/usercode`;

/** Attente : `POST { device_auth_id, user_code }`. */
export const DEVICE_TOKEN_URL = `${AUTH_BASE}/api/accounts/deviceauth/token`;

/** Échange **et** rafraîchissement : sur l'hôte nu, sans `/api/accounts`. */
export const OAUTH_TOKEN_URL = `${AUTH_BASE}/oauth/token`;

/** L'URI de redirection que l'échange doit répéter. Jamais réellement appelée. */
const REDIRECT_URI = `${AUTH_BASE}/deviceauth/callback`;

/** La page que l'utilisateur ouvre pour saisir son code. */
export const VERIFICATION_URI = `${AUTH_BASE}/codex/device`;

/** Le CLI plafonne l'attente à quinze minutes ; OpenAI ne rend pas de durée. */
export const DEVICE_EXPIRES_IN_SECONDS = 15 * 60;

/** Intervalle d'attente par défaut, quand OpenAI n'en propose pas. */
const DEFAULT_INTERVAL_SECONDS = 5;

/** Un aller-retour d'autorisation est court : au-delà, quelque chose ne va pas. */
const OAUTH_TIMEOUT_MS = 15_000;

/* ------------------------------------------------------------------ */
/* Résultats                                                           */
/* ------------------------------------------------------------------ */

/** Ce qu'une initialisation réussie rend. */
export interface DeviceAuthStart {
  readonly deviceAuthId: string;
  readonly userCode: string;
  /** Intervalle d'attente conseillé, en secondes. */
  readonly intervalSeconds: number;
}

export type StartResult =
  | { readonly ok: true; readonly start: DeviceAuthStart }
  /** 404 à l'initialisation : la connexion par code est désactivée sur le compte. */
  | { readonly ok: false; readonly kind: "disabled" }
  /** Tout le reste : OpenAI n'a pas pu ouvrir la demande. */
  | { readonly ok: false; readonly kind: "upstream"; readonly status: number | null };

export type PollResult =
  | { readonly status: "pending" }
  | { readonly status: "linked"; readonly tokens: CodexTokens }
  /** Refus explicite, ou échange impossible : il faut recommencer. */
  | { readonly status: "denied" };

export type RefreshResult =
  | { readonly status: "ok"; readonly tokens: CodexTokens }
  /** Jeton révoqué ou périmé : la liaison est morte, il faut relier. */
  | { readonly status: "revoked" }
  /** Panne passagère : la liaison est intacte, l'appel ne l'est pas. */
  | { readonly status: "error"; readonly httpStatus: number | null };

/* ------------------------------------------------------------------ */
/* Appels                                                              */
/* ------------------------------------------------------------------ */

async function post(
  fetchImpl: FetchLike,
  url: string,
  init: { readonly headers: Record<string, string>; readonly body: string },
): Promise<Response> {
  return fetchImpl(url, {
    method: "POST",
    headers: init.headers,
    body: init.body,
    // On ne suit pas les redirections sur un chemin d'autorisation : un 3xx
    // voudrait dire qu'on ne parle plus à qui on croit.
    redirect: "manual",
    signal: AbortSignal.timeout(OAUTH_TIMEOUT_MS),
  });
}

const JSON_HEADERS: Readonly<Record<string, string>> = { "content-type": "application/json" };

/** Étape 1 — ouvrir une demande d'autorisation et obtenir le code à saisir. */
export async function startDeviceAuth(fetchImpl: FetchLike = fetch): Promise<StartResult> {
  let response: Response;

  try {
    response = await post(fetchImpl, USERCODE_URL, {
      headers: JSON_HEADERS,
      body: JSON.stringify({ client_id: CODEX_CLIENT_ID }),
    });
  } catch {
    return { ok: false, kind: "upstream", status: null };
  }

  if (!response.ok) {
    // Le 404 est le **seul** signal fiable de « connexion par code désactivée
    // sur ce compte ». Le confondre avec une panne (ou l'inverse) envoie
    // l'utilisateur régler la mauvaise chose.
    if (response.status === 404) return { ok: false, kind: "disabled" };
    return { ok: false, kind: "upstream", status: response.status };
  }

  const body = await readJson(response);
  const deviceAuthId = stringField(body, "device_auth_id");
  const userCode = stringField(body, "user_code");

  if (deviceAuthId === null || userCode === null) {
    // Un 200 inexploitable est une rupture de contrat d'OpenAI, pas un réglage
    // de compte : on le rapporte comme tel.
    return { ok: false, kind: "upstream", status: response.status };
  }

  const interval = Number((body as { interval?: unknown } | null)?.interval);

  return {
    ok: true,
    start: {
      deviceAuthId,
      userCode,
      intervalSeconds:
        Number.isFinite(interval) && interval > 0 ? interval : DEFAULT_INTERVAL_SECONDS,
    },
  };
}

/**
 * Étapes 2 et 3 — demander où en est l'autorisation puis, si elle est donnée,
 * échanger le code contre des jetons **dans la même requête serveur**.
 *
 * Les deux étapes sont soudées à dessein : le code d'autorisation et son
 * `code_verifier` ne doivent jamais exister ailleurs qu'ici. Les faire
 * transiter par le navigateur pour un second appel les rendrait interceptables
 * sans rien apporter.
 */
export async function pollDeviceAuth(
  args: { readonly deviceAuthId: string; readonly userCode: string },
  fetchImpl: FetchLike = fetch,
  now: number = Date.now(),
): Promise<PollResult> {
  let response: Response;

  try {
    response = await post(fetchImpl, DEVICE_TOKEN_URL, {
      headers: JSON_HEADERS,
      body: JSON.stringify({ device_auth_id: args.deviceAuthId, user_code: args.userCode }),
    });
  } catch {
    // Un aller-retour manqué n'est pas un refus : on redemandera.
    return { status: "pending" };
  }

  // 403 et 404 sont la façon d'OpenAI de dire « pas encore autorisé ».
  if (response.status === 403 || response.status === 404) return { status: "pending" };
  if (!response.ok) return { status: "denied" };

  const body = await readJson(response);
  const code = stringField(body, "authorization_code");
  const verifier = stringField(body, "code_verifier");

  if (code === null || verifier === null) return { status: "denied" };

  const tokens = await exchangeCode(code, verifier, fetchImpl, now);

  return tokens === null ? { status: "denied" } : { status: "linked", tokens };
}

/** Étape 3 — le code contre les jetons, en formulaire (et non en JSON). */
async function exchangeCode(
  code: string,
  verifier: string,
  fetchImpl: FetchLike,
  now: number,
): Promise<CodexTokens | null> {
  const form = new URLSearchParams({
    grant_type: "authorization_code",
    code,
    redirect_uri: REDIRECT_URI,
    client_id: CODEX_CLIENT_ID,
    code_verifier: verifier,
  });

  let response: Response;

  try {
    response = await post(fetchImpl, OAUTH_TOKEN_URL, {
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: form.toString(),
    });
  } catch {
    return null;
  }

  if (!response.ok) return null;
  return tokensFrom(await readJson(response), now, null);
}

/**
 * Le rafraîchissement, et la distinction qui compte : un jeton **révoqué**
 * (400/401) tue la liaison — il faut relier — tandis qu'une panne passagère
 * (réseau, 5xx) la laisse intacte. Confondre les deux ferait délier tout le
 * monde le jour d'un incident chez OpenAI.
 */
export async function refreshTokens(
  refreshToken: string,
  fetchImpl: FetchLike = fetch,
  now: number = Date.now(),
): Promise<RefreshResult> {
  let response: Response;

  try {
    response = await post(fetchImpl, OAUTH_TOKEN_URL, {
      headers: JSON_HEADERS,
      body: JSON.stringify({
        client_id: CODEX_CLIENT_ID,
        grant_type: "refresh_token",
        refresh_token: refreshToken,
      }),
    });
  } catch {
    return { status: "error", httpStatus: null };
  }

  if (response.status === 400 || response.status === 401) return { status: "revoked" };
  if (!response.ok) return { status: "error", httpStatus: response.status };

  // Rotation : OpenAI peut rendre un nouveau jeton de rafraîchissement, ou
  // aucun. Dans le second cas, l'ancien reste valable — l'oublier ferait mourir
  // la liaison au rafraîchissement suivant.
  const tokens = tokensFrom(await readJson(response), now, refreshToken);

  return tokens === null
    ? { status: "error", httpStatus: response.status }
    : { status: "ok", tokens };
}

/* ------------------------------------------------------------------ */
/* Lecture des corps                                                   */
/* ------------------------------------------------------------------ */

async function readJson(response: Response): Promise<unknown> {
  try {
    return JSON.parse(await response.text());
  } catch {
    return null;
  }
}

function stringField(body: unknown, field: string): string | null {
  const value = (body as Record<string, unknown> | null)?.[field];

  return typeof value === "string" && value !== "" ? value : null;
}

/** Un corps de réponse OAuth → un groupe de jetons, ou `null` s'il est inutilisable. */
function tokensFrom(
  body: unknown,
  now: number,
  fallbackRefresh: string | null,
): CodexTokens | null {
  const accessToken = stringField(body, "access_token");

  if (accessToken === null) return null;

  const record = body as Record<string, unknown>;

  return {
    accessToken,
    refreshToken: stringField(body, "refresh_token") ?? fallbackRefresh,
    expiresAt: expiryOf(accessToken, record.expires_in, now),
    accountId: accountIdOf(stringField(body, "id_token")),
  };
}

/**
 * Réunit les jetons rafraîchis et ceux qu'on avait : OpenAI omet volontiers
 * l'`id_token` au rafraîchissement, et perdre l'identifiant de compte ferait
 * échouer tous les appels suivants (le back-end l'exige en en-tête).
 */
export function mergeTokens(previous: CodexTokens, next: CodexTokens): CodexTokens {
  return {
    accessToken: next.accessToken,
    refreshToken: next.refreshToken ?? previous.refreshToken,
    expiresAt: next.expiresAt ?? previous.expiresAt,
    accountId: next.accountId ?? previous.accountId,
  };
}
