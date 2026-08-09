/**
 * Le Benchmark Tracker de kovaaks.com — **seule surface du projet qui connaît
 * cette API** (SPEC §5 bis). Tout ce qui est au-dessus manipule des scores
 * Voltaic, jamais des URL kovaaks.com : le jour où cette source disparaît, on
 * remplace ce fichier et rien d'autre.
 *
 * L'API est publique (aucune clé) et non documentée. Trois précautions en
 * découlent, et elles sont la raison d'être de ce module :
 *
 * - **délai borné** : une source non contractuelle n'a aucune obligation de
 *   répondre. On coupe, et on le dit ;
 * - **une relance, pas plus** : un 5xx ou une coupure réseau se retente une
 *   fois ; une réponse claire (404, 400) ne se retente jamais ;
 * - **cache court en mémoire** : deux clics sur « Importer » ne font pas deux
 *   allers-retours. Le cache ne survit pas à un démarrage à froid — c'est un
 *   amortisseur de rafale, pas un cache de contenu, et il ne prétend pas
 *   l'être.
 *
 * Le préfixe `_` sort ce fichier du routage Vercel : il est importé, jamais
 * appelé en HTTP.
 */

import type { TierId } from "../../src/lib/energy/index.js";
import {
  KOVAAKS_BENCHMARK_IDS,
  type KovaaksBenchmarkProgress,
  kovaaksBenchmarkProgressSchema,
} from "../../src/server/kovaaks/benchmark.js";
import { attemptTimeout, startBudget, type TimeBudget } from "../../src/server/kovaaks/budget.js";

const BASE_URL = "https://kovaaks.com/webapp-backend";

/**
 * Le temps total accordé à KovaaK's pour un import, toutes tentatives comprises.
 *
 * Le calcul, parce qu'il doit rester vérifiable : la fonction déclare
 * `maxDuration = 20` (`api/kovaaks/import.ts`). Un import enchaîne deux appels
 * — retrouver le joueur, puis lire sa progression — avec une relance chacun,
 * soit quatre tentatives au pire. Sans budget commun, le pire cas serait la
 * somme des quatre délais ; avec `TOTAL_BUDGET_MS` partagé et `ATTEMPT_CAP_MS`
 * par tentative, il vaut exactement `TOTAL_BUDGET_MS` : 5 000 + 5 000 + 4 000,
 * la quatrième tentative n'ayant plus la place de démarrer.
 *
 * Restent 6 s sous `maxDuration` pour la vérification du jeton (un aller-retour
 * Supabase), la traduction des scores et l'écriture de la réponse. C'est cette
 * marge qui garantit que l'échec sorte d'ici en 502 rédigé, et non en page
 * d'erreur de plateforme — la dégradation propre de SPEC §5 bis tient à cette
 * soustraction.
 */
const TOTAL_BUDGET_MS = 14_000;

/** Plafond d'une tentative : un appel lent ne prend pas le budget de l'autre. */
const ATTEMPT_CAP_MS = 5_000;

/** Sous ce reste, une tentative n'a plus aucune chance : on renonce à temps. */
const ATTEMPT_FLOOR_MS = 1_000;

/** Durée de vie du cache d'instance. Court : les scores bougent à chaque run. */
const CACHE_TTL_MS = 60_000;

const UNREACHABLE =
  "Le Benchmark Tracker KovaaK's ne répond pas. Réessaie dans un instant, ou saisis tes scores à la main.";

const TOO_SLOW =
  "Le Benchmark Tracker KovaaK's met trop de temps à répondre. Réessaie dans un instant, ou saisis tes scores à la main.";

const MALFORMED =
  "Le Benchmark Tracker KovaaK's a renvoyé une réponse inattendue. Saisis tes scores à la main pour cette fois.";

/** Échec d'un appel au Benchmark Tracker, porteur d'un message affichable. */
export class KovaaksError extends Error {
  override readonly name = "KovaaksError";
  /** Statut HTTP que la fonction serverless doit renvoyer. */
  readonly status: number;

  constructor(message: string, status: number, cause?: unknown) {
    super(message, { cause });
    this.status = status;
  }
}

/* ------------------------------------------------------------------ */
/* Transport                                                           */
/* ------------------------------------------------------------------ */

interface CacheEntry {
  readonly expiresAt: number;
  readonly body: unknown;
}

const cache = new Map<string, CacheEntry>();

function cached(url: string): unknown | undefined {
  const entry = cache.get(url);

  if (entry === undefined) return undefined;
  if (entry.expiresAt <= Date.now()) {
    cache.delete(url);
    return undefined;
  }
  return entry.body;
}

/**
 * Une tentative, bornée par ce qui reste du budget.
 *
 * Rend `null` quand il ne reste plus de quoi essayer : c'est le renoncement
 * volontaire, celui qui laisse le temps de rédiger l'erreur.
 */
async function fetchWithin(url: string, budget: TimeBudget): Promise<Response | null> {
  const timeout = attemptTimeout(budget.remaining(), ATTEMPT_CAP_MS, ATTEMPT_FLOOR_MS);

  if (timeout === null) return null;
  return fetch(url, {
    headers: { accept: "application/json" },
    signal: AbortSignal.timeout(timeout),
  });
}

/**
 * Un GET JSON, avec une seule relance, un cache d'instance et un budget partagé.
 *
 * Le budget traverse les deux appels d'un import : ce que la recherche du
 * joueur a consommé, la lecture de la progression ne l'a plus. Une réponse
 * servie par le cache ne coûte rien — c'est bien l'attente réseau qu'on
 * rationne, pas le nombre d'appels.
 *
 * Un 404 remonte tel quel : c'est une réponse, pas une panne, et l'appelant
 * sait mieux que ce module ce qu'un « pas trouvé » veut dire pour lui.
 */
async function getJson(path: string, budget: TimeBudget): Promise<unknown> {
  const url = `${BASE_URL}${path}`;
  const hit = cached(url);

  if (hit !== undefined) return hit;

  let response: Response | null;

  try {
    response = await fetchWithin(url, budget);
    // Une relance ne se justifie que sur une panne serveur, et seulement s'il
    // reste du temps : sinon elle ne ferait que retarder l'erreur.
    if (response !== null && response.status >= 500) {
      response = (await fetchWithin(url, budget)) ?? response;
    }
  } catch (cause) {
    try {
      response = await fetchWithin(url, budget);
    } catch (retryCause) {
      throw new KovaaksError(UNREACHABLE, 502, retryCause ?? cause);
    }
    if (response === null) throw new KovaaksError(TOO_SLOW, 504, cause);
  }

  if (response === null) throw new KovaaksError(TOO_SLOW, 504);

  if (response.status === 404) {
    throw new KovaaksError("Introuvable chez KovaaK's.", 404);
  }
  if (!response.ok) {
    throw new KovaaksError(UNREACHABLE, 502, response.status);
  }

  let body: unknown;

  try {
    body = await response.json();
  } catch (cause) {
    throw new KovaaksError(MALFORMED, 502, cause);
  }

  cache.set(url, { expiresAt: Date.now() + CACHE_TTL_MS, body });
  return body;
}

/**
 * Ouvre le budget d'un import. À appeler **une fois** par requête, et à passer
 * ensuite aux deux appels : c'est ce partage qui borne le pire cas.
 */
export function startKovaaksBudget(): TimeBudget {
  return startBudget(TOTAL_BUDGET_MS);
}

/* ------------------------------------------------------------------ */
/* Recherche d'un joueur                                               */
/* ------------------------------------------------------------------ */

export interface KovaaksPlayer {
  /** Identifiant Steam : c'est lui, et non le pseudo, que l'API des benchmarks veut. */
  readonly steamId: string;
  /** Le pseudo tel que KovaaK's l'écrit (casse d'origine). */
  readonly username: string;
}

/**
 * Le joueur dont le pseudo est **exactement** celui demandé, à la casse près.
 *
 * La recherche de kovaaks.com est floue : « miu » rend trente-deux comptes,
 * dont « Miuup » et « OSMIU ». Lier le premier résultat lierait le mauvais
 * joueur sans que personne ne s'en aperçoive — on exige donc l'égalité.
 */
export async function findPlayer(
  username: string,
  budget: TimeBudget,
): Promise<KovaaksPlayer | null> {
  const wanted = username.trim().toLowerCase();

  if (wanted === "") return null;

  const body = await getJson(
    `/user/search?username=${encodeURIComponent(username.trim())}`,
    budget,
  );

  if (!Array.isArray(body)) throw new KovaaksError(MALFORMED, 502);

  for (const entry of body) {
    const found = entry as { username?: unknown; steamId?: unknown } | null;
    const name = typeof found?.username === "string" ? found.username : null;
    const steamId = typeof found?.steamId === "string" ? found.steamId : null;

    if (name !== null && steamId !== null && name.toLowerCase() === wanted) {
      return { steamId, username: name };
    }
  }
  return null;
}

/* ------------------------------------------------------------------ */
/* Progression sur un benchmark Voltaic                                */
/* ------------------------------------------------------------------ */

/**
 * La progression du joueur sur le benchmark Voltaic S5 du palier demandé,
 * validée avant de sortir d'ici. Ce qui remonte est déjà de la forme attendue,
 * ou n'est jamais remonté.
 */
export async function fetchBenchmarkProgress(
  steamId: string,
  tier: TierId,
  budget: TimeBudget,
): Promise<KovaaksBenchmarkProgress> {
  const benchmarkId = KOVAAKS_BENCHMARK_IDS[tier];
  const body = await getJson(
    `/benchmarks/player-progress-rank-benchmark?benchmarkId=${benchmarkId}&steamId=${encodeURIComponent(steamId)}&page=0&max=100`,
    budget,
  );
  const parsed = kovaaksBenchmarkProgressSchema.safeParse(body);

  if (!parsed.success) throw new KovaaksError(MALFORMED, 502, parsed.error);
  return parsed.data;
}
