/**
 * Comptes liés : lecture directe dans Postgres, écritures partagées entre la
 * base et les fonctions serverless (SPEC §5 bis).
 *
 * Le partage n'est pas arbitraire, il suit les secrets :
 *
 * - **KovaaK's** ne demande aucune clé. La liaison est donc un simple insert
 *   sous RLS, et seule la lecture des scores passe par une fonction — parce que
 *   le navigateur ne peut pas appeler kovaaks.com (CORS), pas parce qu'il y
 *   aurait quelque chose à cacher ;
 * - **Riot** demande la clé HenrikDev pour résoudre un Riot ID en PUUID. La
 *   liaison et le rafraîchissement passent donc obligatoirement par le serveur.
 *
 * Les suppressions et le choix du compte principal restent en base : ce sont
 * des écritures sur ses propres lignes, la RLS suffit à les encadrer.
 */

import type { z } from "zod";
import type { TierId } from "../../lib/energy";
import { supabase } from "../supabase/client";
import { DataError, NO_SESSION_MESSAGE, queryError } from "./errors";
import {
  type KovaaksImportResponse,
  kovaaksImportResponseSchema,
  type LinkedAccount,
  linkedAccountsErrorSchema,
  type MatchSummary,
  matchSummarySchema,
  type Provider,
  type RefreshResponse,
  refreshResponseSchema,
  riotLinkResponseSchema,
} from "./linked-accounts-contract";
import {
  formatRiotId,
  LINKED_ACCOUNT_COLUMNS,
  type RiotId,
  toLinkedAccount,
  toLinkedAccounts,
} from "./linked-accounts-mapping";
import { currentUserId } from "./session";

/* ------------------------------------------------------------------ */
/* Appel des fonctions serverless                                      */
/* ------------------------------------------------------------------ */

/**
 * Échec d'un appel aux fonctions de comptes liés, porteur d'un message destiné
 * à l'écran — même contrat que `CoachError` côté coach.
 */
export class LinkedAccountError extends Error {
  override readonly name = "LinkedAccountError";
  /** Statut HTTP, ou `0` si la requête n'a jamais abouti. */
  readonly status: number;

  constructor(message: string, status: number, cause?: unknown) {
    super(message, { cause });
    this.status = status;
  }

  /**
   * La fonctionnalité n'est pas configurée (clé absente côté serveur). L'UI en
   * fait une explication posée, pas une erreur rouge : il n'y a rien à
   * réessayer, et rien que l'utilisateur puisse corriger.
   */
  get notConfigured(): boolean {
    return this.status === 503;
  }

  /** Le compte visé n'existe pas chez la source. */
  get notFound(): boolean {
    return this.status === 404;
  }

  /**
   * Le frein quotidien a parlé (migration 0007). Comme « non configuré » :
   * ni faute, ni panne — il n'y a rien à corriger et rien à réessayer tout de
   * suite. L'écran le dit posément, sur le même fond neutre.
   */
  get rateLimited(): boolean {
    return this.status === 429;
  }
}

const OFFLINE = "Service injoignable : vérifie ta connexion, puis réessaie.";

const NOT_DEPLOYED =
  "Cette fonctionnalité n'est pas servie ici : les fonctions `/api/**` sont absentes. En local, lance `bunx vercel dev` plutôt que `bun dev`.";

const UNEXPECTED = "Réponse inattendue du service. Réessaie dans un instant.";

/** Le message d'un échec HTTP : celui de la fonction si elle en a donné un. */
function errorMessage(status: number, body: string): string {
  try {
    const parsed = linkedAccountsErrorSchema.safeParse(JSON.parse(body));

    if (parsed.success) return parsed.data.error;
  } catch {
    // Corps non-JSON : le 404 servi par Vite en développement, ou une page
    // d'erreur de plateforme. Traité juste en dessous.
  }
  return status === 404 ? NOT_DEPLOYED : UNEXPECTED;
}

/** `POST` sur une fonction, avec le JWT joint à la main et la réponse validée. */
async function callFunction<T extends z.ZodType>(
  path: string,
  payload: unknown,
  schema: T,
): Promise<z.infer<T>> {
  const { data, error } = await supabase.auth.getSession();
  const token = data.session?.access_token;

  if (error !== null || token === undefined) {
    throw new LinkedAccountError(NO_SESSION_MESSAGE, 401, error);
  }

  let response: Response;

  try {
    response = await fetch(path, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
      body: JSON.stringify(payload),
    });
  } catch (cause) {
    throw new LinkedAccountError(OFFLINE, 0, cause);
  }

  const body = await response.text();

  if (!response.ok) {
    throw new LinkedAccountError(errorMessage(response.status, body), response.status);
  }

  let parsed: unknown;

  try {
    parsed = JSON.parse(body);
  } catch (cause) {
    throw new LinkedAccountError(UNEXPECTED, response.status, cause);
  }

  const validated = schema.safeParse(parsed);

  if (!validated.success) {
    throw new LinkedAccountError(UNEXPECTED, response.status, validated.error);
  }
  return validated.data;
}

/* ------------------------------------------------------------------ */
/* Lecture                                                             */
/* ------------------------------------------------------------------ */

/**
 * Les comptes liés de l'utilisateur : le principal d'abord, puis du plus
 * ancien au plus récent. L'ordre est stable, donc l'écran ne se réorganise pas
 * d'un chargement à l'autre.
 */
export async function listLinkedAccounts(): Promise<readonly LinkedAccount[]> {
  const userId = await currentUserId();
  const { data, error } = await supabase
    .from("linked_accounts")
    .select(LINKED_ACCOUNT_COLUMNS)
    .eq("user_id", userId)
    .order("is_primary", { ascending: false })
    .order("id", { ascending: true });

  if (error !== null || data === null) {
    throw queryError(error, "Les comptes liés n'ont pas pu être chargés.");
  }
  return toLinkedAccounts(data);
}

/** Les comptes d'un fournisseur donné, dans l'ordre de `listLinkedAccounts`. */
export function accountsOf(
  accounts: readonly LinkedAccount[],
  provider: Provider,
): readonly LinkedAccount[] {
  return accounts.filter((account) => account.provider === provider);
}

/**
 * Le compte à afficher pour un fournisseur : celui marqué principal, sinon le
 * premier. Le repli évite un dashboard vide quand aucun compte n'a été désigné.
 */
export function primaryAccount(
  accounts: readonly LinkedAccount[],
  provider: Provider,
): LinkedAccount | null {
  const owned = accountsOf(accounts, provider);

  return owned.find((account) => account.isPrimary) ?? owned[0] ?? null;
}

/**
 * Les matchs importés d'un compte, du plus récent au plus ancien.
 *
 * Le `payload` est validé à la lecture avec le schéma qui l'a écrit : une
 * ligne hors contrat (import d'une version antérieure, schéma modifié) est
 * écartée plutôt que de faire planter l'écran sur un champ manquant.
 */
export async function listImportedMatches(
  linkedAccountId: number,
  limit: number,
): Promise<readonly MatchSummary[]> {
  const { data, error } = await supabase
    .from("imported_matches")
    .select("payload")
    .eq("linked_account_id", linkedAccountId)
    .order("played_at", { ascending: false, nullsFirst: false })
    .order("id", { ascending: false })
    .limit(limit);

  if (error !== null || data === null) {
    throw queryError(error, "Les matchs importés n'ont pas pu être chargés.");
  }

  const matches: MatchSummary[] = [];

  for (const row of data) {
    const parsed = matchSummarySchema.safeParse(row.payload);

    if (parsed.success) matches.push(parsed.data);
  }
  return matches;
}

/* ------------------------------------------------------------------ */
/* Liaison KovaaK's                                                    */
/* ------------------------------------------------------------------ */

/** Palier utilisé pour vérifier qu'un pseudo KovaaK's existe. */
const VERIFICATION_TIER: TierId = "novice";

/**
 * Lie un pseudo KovaaK's, après l'avoir vérifié.
 *
 * La vérification passe par l'import lui-même : c'est le seul appel qui sait
 * dire si le pseudo désigne quelqu'un, et il rend au passage l'orthographe
 * exacte du site — on stocke celle-là plutôt que la frappe de l'utilisateur,
 * pour que les imports suivants ne dépendent pas d'une majuscule.
 *
 * Enregistrer un pseudo sans le vérifier reviendrait à déplacer l'échec au
 * premier import, c'est-à-dire au moment où l'utilisateur attend des scores.
 */
export async function linkKovaaksAccount(username: string): Promise<LinkedAccount> {
  const verified = await importKovaaksScores(username, VERIFICATION_TIER);
  const userId = await currentUserId();
  const { data, error } = await supabase
    .from("linked_accounts")
    .insert({
      user_id: userId,
      provider: "kovaaks",
      external_id: verified.username,
      // Le premier compte KovaaK's est le seul : rien à arbitrer.
      is_primary: true,
    })
    .select(LINKED_ACCOUNT_COLUMNS)
    .single();

  if (error !== null || data === null) {
    if (error?.code === "23505") {
      throw new DataError(`« ${verified.username} » est déjà lié à ton compte.`);
    }
    throw queryError(error, "Le compte KovaaK's n'a pas pu être enregistré.");
  }
  return toLinkedAccount(data);
}

/** Les scores Voltaic du pseudo, pour le palier demandé. N'écrit rien. */
export async function importKovaaksScores(
  username: string,
  tier: TierId,
): Promise<KovaaksImportResponse> {
  return callFunction("/api/kovaaks/import", { username, tier }, kovaaksImportResponseSchema);
}

/* ------------------------------------------------------------------ */
/* Liaison Riot                                                        */
/* ------------------------------------------------------------------ */

export interface RiotLinkOptions {
  readonly label?: string;
  readonly isPrimary?: boolean;
}

/** Lie un compte Riot. La résolution du PUUID a lieu côté serveur. */
export async function linkRiotAccount(
  riotId: RiotId,
  options: RiotLinkOptions = {},
): Promise<LinkedAccount> {
  const response = await callFunction(
    "/api/valorant/link",
    { name: riotId.name, tag: riotId.tag, ...options },
    riotLinkResponseSchema,
  );

  return response.account;
}

/** Rafraîchit rang et derniers matchs d'un compte Riot lié. */
export async function refreshRiotAccount(linkedAccountId: number): Promise<RefreshResponse> {
  return callFunction("/api/valorant/refresh", { linkedAccountId }, refreshResponseSchema);
}

/* ------------------------------------------------------------------ */
/* Compte principal et déliaison                                       */
/* ------------------------------------------------------------------ */

/**
 * Désigne le compte principal d'un fournisseur.
 *
 * En deux écritures, sans transaction : un index unique partiel interdit deux
 * principaux, donc il faut libérer la place avant de la prendre. Si la seconde
 * écriture échoue, l'utilisateur se retrouve sans principal — état visible et
 * réparable d'un clic, contrairement à un doublon que la base aurait refusé.
 */
export async function setPrimaryAccount(account: LinkedAccount): Promise<void> {
  const userId = await currentUserId();
  const cleared = await supabase
    .from("linked_accounts")
    .update({ is_primary: false })
    .eq("user_id", userId)
    .eq("provider", account.provider)
    .eq("is_primary", true);

  if (cleared.error !== null) {
    throw queryError(cleared.error, "Le compte principal n'a pas pu être changé.");
  }

  const { data, error } = await supabase
    .from("linked_accounts")
    .update({ is_primary: true })
    .eq("id", account.id)
    .select("id");

  if (error !== null) throw queryError(error, "Le compte principal n'a pas pu être changé.");
  if (data === null || data.length === 0) {
    throw new DataError("Ce compte lié n'existe plus : recharge la page.");
  }
}

/**
 * Délie un compte. Ses matchs importés partent en cascade (contrainte FK).
 *
 * Si le compte retiré était le principal, le plus ancien de ses pairs prend la
 * place : laisser un fournisseur sans principal ferait disparaître le rang du
 * dashboard alors qu'il reste des comptes liés.
 */
export async function unlinkAccount(account: LinkedAccount): Promise<void> {
  const { data, error } = await supabase
    .from("linked_accounts")
    .delete()
    .eq("id", account.id)
    .select("id");

  if (error !== null) throw queryError(error, "Le compte n'a pas pu être délié.");
  // Zéro ligne touchée : soit le compte n'existe plus, soit il est à quelqu'un
  // d'autre — la RLS ne distingue pas les deux, l'UI non plus.
  if (data === null || data.length === 0) {
    throw new DataError("Ce compte lié n'existe plus : recharge la page.");
  }

  if (!account.isPrimary) return;

  const remaining = accountsOf(await listLinkedAccounts(), account.provider);
  const heir = remaining[0];

  // Une succession ratée n'annule pas la déliaison, qui a bien eu lieu : on
  // laisse l'écran se recharger plutôt que de crier sur une retouche cosmétique.
  if (heir !== undefined && !heir.isPrimary) {
    await supabase.from("linked_accounts").update({ is_primary: true }).eq("id", heir.id);
  }
}

/** Le Riot ID canonique d'un compte lié, pour l'affichage. */
export function displayName(account: LinkedAccount): string {
  return account.label ?? account.externalId;
}

export { formatRiotId };
