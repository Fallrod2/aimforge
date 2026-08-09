/**
 * L'API HenrikDev — **seule surface du projet qui la connaît** (SPEC §5 bis).
 * Au-dessus, on ne manipule que des résumés (`MmrSummary`, `MatchSummary`) :
 * la migration vers l'API Riot officielle, le jour où RSO sera accordé, se
 * jouera dans ce fichier et nulle part ailleurs.
 *
 * La clé ne vit **plus** dans l'environnement de ce module depuis SPEC
 * §5 quater : elle est passée en argument, parce qu'elle peut venir de deux
 * endroits — la table `platform_settings`, où l'administration la tourne sans
 * redéploiement, ou `HENRIKDEV_API_KEY` en repli. Ce module n'a pas à connaître
 * cet arbitrage : c'est `api/_lib/platform-settings.ts` qui tranche, une fois,
 * et lui passe le résultat.
 *
 * Qu'il n'y ait de clé nulle part reste un état prévu, pas une panne : les
 * fonctions le vérifient avant d'appeler (`hasKey`), répondent 503 avec un
 * message net, et l'UI se dégrade au lieu de casser. Toute autre issue (une clé
 * vide envoyée quand même, un message d'erreur brut de l'API) ferait passer un
 * défaut de configuration pour un bug.
 *
 * Le préfixe `_` sort ce fichier du routage Vercel : il est importé, jamais
 * appelé en HTTP.
 */

import {
  type HenrikAccount,
  type HenrikMmr,
  henrikAccountSchema,
  henrikMmrSchema,
} from "../../src/server/valorant/summary.js";

const BASE_URL = "https://api.henrikdev.xyz/valorant";

/** Plateforme des comptes suivis. Valorant PC : la seule que le tracker vise. */
const PLATFORM = "pc";

/** Région par défaut quand l'utilisateur n'en donne pas. */
export const DEFAULT_REGION = "eu";

const TIMEOUT_MS = 9000;

/** Le message unique de « la clé n'est pas posée ». */
export const NOT_CONFIGURED =
  "Import Valorant non configuré : la clé de l'API de données n'est pas encore en place. Tes comptes KovaaK's et la saisie manuelle restent disponibles.";

const UNREACHABLE = "La source de données Valorant ne répond pas. Réessaie dans quelques minutes.";

const MALFORMED = "La source de données Valorant a renvoyé une réponse inattendue.";

/** Échec d'un appel HenrikDev, porteur d'un message affichable tel quel. */
export class HenrikError extends Error {
  override readonly name = "HenrikError";
  /** Statut HTTP que la fonction serverless doit renvoyer. */
  readonly status: number;

  constructor(message: string, status: number, cause?: unknown) {
    super(message, { cause });
    this.status = status;
  }
}

/**
 * Une clé utilisable est-elle disponible ?
 *
 * La question se pose **avant** l'appel, dans la fonction serverless : c'est là
 * qu'on peut encore répondre 503 avec une phrase rédigée, plutôt que de
 * découvrir le problème au milieu d'un aller-retour réseau.
 */
export function hasKey(key: string): boolean {
  return key.trim() !== "";
}

function required(key: string): string {
  const trimmed = key.trim();

  if (trimmed === "") throw new HenrikError(NOT_CONFIGURED, 503);
  return trimmed;
}

/* ------------------------------------------------------------------ */
/* Transport                                                           */
/* ------------------------------------------------------------------ */

/**
 * Un GET JSON authentifié, dont le corps utile est déjà déballé.
 *
 * Les statuts sont traduits ici, une fois : au-dessus, on ne fait plus de
 * distinction entre « 403 » et « 401 », seulement entre « ta faute »,
 * « pas trouvé » et « la source est en peine ».
 */
async function getData(key: string, path: string): Promise<unknown> {
  const url = `${BASE_URL}${path}`;

  let response: Response;

  try {
    response = await fetch(url, {
      headers: { accept: "application/json", authorization: required(key) },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (cause) {
    if (cause instanceof HenrikError) throw cause;
    throw new HenrikError(UNREACHABLE, 502, cause);
  }

  if (response.status === 404) {
    throw new HenrikError("Ce compte Riot est introuvable. Vérifie le nom et le tag.", 404);
  }
  if (response.status === 401 || response.status === 403) {
    // La clé est là mais refusée : c'est un problème de configuration, pas de
    // l'utilisateur. Le détail part dans les logs, pas à l'écran.
    console.error("[valorant] clé HenrikDev refusée", response.status);
    throw new HenrikError(NOT_CONFIGURED, 503);
  }
  if (response.status === 429) {
    throw new HenrikError("Trop d'appels à la source Valorant. Réessaie dans une minute.", 429);
  }
  if (!response.ok) {
    throw new HenrikError(UNREACHABLE, 502, response.status);
  }

  let body: unknown;

  try {
    body = await response.json();
  } catch (cause) {
    throw new HenrikError(MALFORMED, 502, cause);
  }

  // Les réponses utiles sont enveloppées dans `data` ; une source qui
  // arrêterait de le faire reste lisible plutôt que de devenir vide.
  const envelope = body as { data?: unknown } | null;

  return envelope !== null && typeof envelope === "object" && "data" in envelope
    ? envelope.data
    : body;
}

/* ------------------------------------------------------------------ */
/* Appels                                                              */
/* ------------------------------------------------------------------ */

/** Le compte derrière un Riot ID : son PUUID (stable) et sa région. */
export async function resolveAccount(
  key: string,
  name: string,
  tag: string,
): Promise<HenrikAccount> {
  const data = await getData(
    key,
    `/v2/account/${encodeURIComponent(name)}/${encodeURIComponent(tag)}?force=true`,
  );
  const parsed = henrikAccountSchema.safeParse(data);

  if (!parsed.success) throw new HenrikError(MALFORMED, 502, parsed.error);
  return parsed.data;
}

/** Le rang courant du compte. */
export async function fetchMmr(key: string, region: string, puuid: string): Promise<HenrikMmr> {
  const data = await getData(
    key,
    `/v3/by-puuid/mmr/${encodeURIComponent(region)}/${PLATFORM}/${encodeURIComponent(puuid)}`,
  );
  const parsed = henrikMmrSchema.safeParse(data);

  if (!parsed.success) throw new HenrikError(MALFORMED, 502, parsed.error);
  return parsed.data;
}

/**
 * Les derniers matchs compétitifs du compte, bruts. Le résumé est fait plus
 * haut, par un module pur — ici on ne fait que rapporter.
 */
export async function fetchCompetitiveMatches(
  key: string,
  region: string,
  puuid: string,
  size: number,
): Promise<readonly unknown[]> {
  const data = await getData(
    key,
    `/v4/by-puuid/matches/${encodeURIComponent(region)}/${PLATFORM}/${encodeURIComponent(puuid)}?mode=competitive&size=${size}`,
  );

  if (!Array.isArray(data)) throw new HenrikError(MALFORMED, 502);
  return data;
}
