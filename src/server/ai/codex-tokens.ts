/**
 * Le groupe de jetons d'une liaison ChatGPT (abonnement) — SPEC §5 ter.
 *
 * Pour ce fournisseur, la colonne `ai_settings.api_key` ne porte pas une clé
 * mais **le résultat d'une autorisation de compte**, sérialisé en JSON :
 *
 * ```json
 * { "access_token": "…", "refresh_token": "…",
 *   "expires_at": "2026-08-09T12:34:56.000Z", "account_id": "…" }
 * ```
 *
 * Ce choix — réutiliser la colonne plutôt qu'en ajouter une — n'est pas une
 * économie de migration : c'est ce qui fait que les jetons héritent **sans
 * rien écrire de plus** du verrou le plus important du projet (privilèges de
 * colonne, migration 0008 : écriture autorisée, lecture refusée à
 * `authenticated`). Une nouvelle colonne aurait été un nouveau verrou à poser,
 * donc un nouveau verrou à oublier.
 *
 * Module **pur** : Zod, du base64 et de l'arithmétique de dates. Ni réseau, ni
 * base — c'est ce qui permet de tester l'expiration et la rotation sans compte
 * ChatGPT. Il ne journalise rien : tout ce qu'il manipule est secret.
 */

import { z } from "zod";

/** Les jetons, tels que le reste du serveur les manipule. */
export interface CodexTokens {
  readonly accessToken: string;
  /** Absent quand OpenAI n'en a pas rendu : la liaison mourra à l'expiration. */
  readonly refreshToken: string | null;
  /** Expiration du jeton d'accès, en millisecondes epoch. `null` = inconnue. */
  readonly expiresAt: number | null;
  /** Claim `chatgpt_account_id`, exigé en en-tête par le back-end d'OpenAI. */
  readonly accountId: string | null;
}

/**
 * La forme stockée. Tolérante à dessein sur `expires_at` (ISO 8601 ou epoch en
 * secondes/millisecondes) : ce champ vient d'un JWT que nous n'écrivons pas, et
 * une liaison utilisable ne doit pas être jetée pour un détail de sérialisation.
 */
const bundleSchema = z.object({
  access_token: z.string().min(1),
  refresh_token: z.string().min(1).nullish(),
  expires_at: z.union([z.string(), z.number()]).nullish(),
  account_id: z.string().min(1).nullish(),
});

/** Marge de rafraîchissement : on renouvelle 5 min avant l'échéance. */
export const REFRESH_MARGIN_MS = 5 * 60 * 1000;

/**
 * Durée retenue quand OpenAI ne dit rien de l'expiration : une heure. Prudente
 * plutôt qu'optimiste — au pire on rafraîchit un jeton encore valable, ce qui
 * ne coûte qu'un aller-retour ; au mieux on évite un appel refusé.
 */
const DEFAULT_LIFETIME_MS = 60 * 60 * 1000;

/* ------------------------------------------------------------------ */
/* Lecture d'un JWT (sans vérification)                                */
/* ------------------------------------------------------------------ */

/**
 * Les claims d'un JWT, **sans vérifier la signature**.
 *
 * C'est volontaire et sans conséquence de sécurité : ce jeton, nous ne le
 * validons pas — nous le **présentons** à OpenAI, qui le validera. On n'y lit
 * que deux choses de confort (l'expiration, l'identifiant de compte), et une
 * valeur mensongère ne ferait que provoquer un rafraîchissement inutile ou un
 * 401 chez OpenAI. Vérifier la signature demanderait la clé publique d'OpenAI,
 * donc une dépendance et un appel réseau, pour ne rien protéger de plus.
 */
export function decodeJwtClaims(token: string): Record<string, unknown> | null {
  const parts = token.split(".");
  const payload = parts.length === 3 ? parts[1] : undefined;

  if (payload === undefined || payload === "") return null;

  try {
    // base64url → base64, puis octets → texte UTF-8. `atob` seul rendrait du
    // latin-1, et un pseudo accentué deviendrait illisible.
    const binary = atob(payload.replaceAll("-", "+").replaceAll("_", "/"));
    const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
    const parsed: unknown = JSON.parse(new TextDecoder().decode(bytes));

    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    return parsed as Record<string, unknown>;
  } catch {
    return null;
  }
}

/** L'identifiant de compte porté par l'`id_token`, s'il y en a un. */
export function accountIdOf(idToken: string | null | undefined): string | null {
  if (idToken === null || idToken === undefined) return null;

  const value = decodeJwtClaims(idToken)?.chatgpt_account_id;

  return typeof value === "string" && value !== "" ? value : null;
}

/**
 * L'expiration du jeton d'accès : le claim `exp` d'abord (c'est la vérité
 * d'OpenAI), `expires_in` ensuite, et une heure à défaut.
 */
export function expiryOf(accessToken: string, expiresIn: unknown, now: number): number {
  const exp = decodeJwtClaims(accessToken)?.exp;

  if (typeof exp === "number" && Number.isFinite(exp) && exp > 0) return exp * 1000;
  if (typeof expiresIn === "number" && Number.isFinite(expiresIn) && expiresIn > 0) {
    return now + expiresIn * 1000;
  }
  return now + DEFAULT_LIFETIME_MS;
}

/* ------------------------------------------------------------------ */
/* Sérialisation                                                       */
/* ------------------------------------------------------------------ */

/** Un horodatage stocké, quelle que soit la forme reçue. `null` si illisible. */
function readExpiry(value: string | number | null | undefined): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    // Un epoch en secondes (10 chiffres) et un epoch en millisecondes (13) ne
    // se confondent pas : au-delà de l'an 2286 en secondes, on est forcément
    // en millisecondes.
    return value < 1e12 ? value * 1000 : value;
  }
  if (typeof value !== "string") return null;

  const asNumber = Number(value);

  if (value.trim() !== "" && Number.isFinite(asNumber)) {
    return asNumber < 1e12 ? asNumber * 1000 : asNumber;
  }

  const parsed = Date.parse(value);

  return Number.isNaN(parsed) ? null : parsed;
}

/**
 * Les jetons contenus dans la colonne, ou `null` si elle ne porte pas une
 * liaison lisible (une clé collée à la main du temps de la version 1, par
 * exemple).
 */
export function parseTokenBundle(raw: string): CodexTokens | null {
  let value: unknown;

  try {
    value = JSON.parse(raw);
  } catch {
    return null;
  }

  const parsed = bundleSchema.safeParse(value);

  if (!parsed.success) return null;
  return {
    accessToken: parsed.data.access_token,
    refreshToken: parsed.data.refresh_token ?? null,
    expiresAt: readExpiry(parsed.data.expires_at),
    accountId: parsed.data.account_id ?? null,
  };
}

/** La colonne telle qu'on l'écrit : la forme documentée, et rien de plus. */
export function serializeTokenBundle(tokens: CodexTokens): string {
  return JSON.stringify({
    access_token: tokens.accessToken,
    refresh_token: tokens.refreshToken,
    expires_at: tokens.expiresAt === null ? null : new Date(tokens.expiresAt).toISOString(),
    account_id: tokens.accountId,
  });
}

/* ------------------------------------------------------------------ */
/* Fraîcheur                                                           */
/* ------------------------------------------------------------------ */

/**
 * Faut-il rafraîchir avant d'appeler ? Oui dès qu'on entre dans la marge — un
 * jeton qui expire pendant l'appel est refusé aussi sûrement qu'un jeton déjà
 * expiré. Une expiration inconnue vaut « à rafraîchir » : mieux vaut un
 * aller-retour de trop qu'un debrief perdu.
 */
export function needsRefresh(tokens: CodexTokens, now: number): boolean {
  if (tokens.expiresAt === null) return true;
  return tokens.expiresAt - now <= REFRESH_MARGIN_MS;
}

/** Le jeton est-il **vraiment** expiré (et non simplement dans la marge) ? */
export function hasExpired(tokens: CodexTokens, now: number): boolean {
  return tokens.expiresAt !== null && tokens.expiresAt <= now;
}
