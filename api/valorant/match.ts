/**
 * `POST /api/valorant/match` — le détail d'une partie déjà importée, et sa
 * mini-analyse à la demande (SPEC §5 sexies, V1 puis V4).
 *
 * `api/valorant/refresh` rapporte des **résumés** : dix lignes d'historique par
 * rafraîchissement. Cette fonction-ci rapporte ce qu'on regarde quand on
 * **ouvre** une de ces lignes — scoreboard des dix joueurs, déroulé des rounds,
 * performance par côté. C'est un appel de plus à une source non officielle, il
 * ne part donc que lorsque quelqu'un le demande vraiment, et il ne part
 * **qu'une fois par partie**.
 *
 * Quatre décisions, dans l'ordre où la fonction les applique :
 *
 * 1. **Le match doit être à l'appelant.** Il est cherché dans ses
 *    `imported_matches`, sous RLS : un match qui n'est pas à lui est
 *    indiscernable d'un match inexistant (404). Sans cette étape, l'identifiant
 *    d'une partie — qui circule — suffirait à faire payer un appel à la
 *    plateforme pour la partie de n'importe qui.
 * 2. **Le cache passe avant tout appel sortant.** Une partie terminée n'aura
 *    jamais un autre scoreboard : une ligne dans `match_details` est définitive,
 *    et un second clic ne coûte plus rien.
 * 3. **Pas de compteur quotidien pour le détail, et surtout aucun compteur
 *    détourné.** Le frein est structurel : l'ensemble des matchs atteignables est
 *    celui que l'utilisateur a déjà importé (dix par rafraîchissement, eux-mêmes
 *    bornés par `import_usage`), et chacun ne peut être cherché qu'une seule fois
 *    dans sa vie. Le pire cas se compte donc en dizaines d'appels par compte,
 *    jamais en boucle. Ajouter un `kind` à `increment_import_usage` demanderait
 *    une migration pour mesurer une pression qui ne peut pas exister ; réutiliser
 *    le compteur KovaaK's ou celui des liaisons ferait mentir les deux — un quota
 *    qui ne dit plus ce qu'il compte ne protège plus rien.
 * 4. **On stocke un résumé structuré, jamais la réponse brute** — même règle
 *    que pour l'historique, et validé par le contrat avant d'entrer en base.
 *
 * **La mini-analyse (V4) est une action de cette même fonction**, pas un endpoint
 * de plus, et le drapeau `analyze` du corps de requête la déclenche. C'est le
 * choix le plus simple, et il l'est pour une raison précise : l'analyse exige le
 * **détail réel** de la partie (scoreboard et sides, pas le résumé d'historique),
 * donc elle doit pouvoir le générer quand il manque. Un endpoint séparé aurait
 * eu à refaire ici les quatre marches ci-dessus, ou à en extraire un module
 * partagé pour éviter que les deux chemins divergent — deux fois plus de code
 * pour la même garantie que le drapeau donne par construction. Ce qui se paie en
 * retour : la fonction embarque désormais l'aiguillage des fournisseurs IA, et
 * son `maxDuration` couvre le pire cas des deux chemins. Tout ce qui suit
 * l'obtention du détail vit dans `../_lib/match-analysis.ts` — quota compris.
 *
 * La signature est `export async function POST(request: Request)` : c'est la
 * forme sur laquelle le runtime Node de Vercel bascule en gestionnaires Web
 * (voir `api/_lib/request.ts`).
 */

import { parseMatchDetail } from "../../src/server/valorant/detail.js";
import {
  type MatchDetail,
  type MatchDetailResponse,
  matchDetailRequestSchema,
  matchDetailSchema,
} from "../../src/shared/valorant-contract.js";
import type { CoachUserClient } from "../_lib/coach-context.js";
import {
  DEFAULT_REGION,
  fetchMatchDetail,
  HenrikError,
  hasKey,
  NOT_CONFIGURED,
} from "../_lib/henrikdev.js";
import { analyzeMatch } from "../_lib/match-analysis.js";
import { loadPlatformSettings } from "../_lib/platform-settings.js";
import { authenticate, fail, json, readBody } from "../_lib/request.js";
import { type ServiceClient, serviceClient } from "../_lib/service.js";

/**
 * Un appel sortant et une écriture pour le détail ; deux tentatives de 25 s pour
 * l'analyse. La borne couvre le pire cas des deux chemins réunis — c'est un
 * plafond, pas un coût : une lecture de cache répond toujours en quelques
 * dizaines de millisecondes.
 */
export const maxDuration = 60;

const INVALID_BODY = "Identifiant de match attendu.";

/**
 * La même phrase pour « ce match n'existe pas » et « ce match n'est pas à toi ».
 * La RLS ne distingue pas les deux, l'utilisateur n'a pas à le faire non plus.
 */
const UNKNOWN_MATCH = "Cette partie n'est pas dans tes matchs importés.";

const MALFORMED = "La source de données Valorant a renvoyé un détail de partie illisible.";

/** Le détail obtenu, ou la réponse d'échec à rendre telle quelle. */
type Resolved =
  | { readonly ok: true; readonly detail: MatchDetail }
  | { readonly ok: false; readonly response: Response };

export async function POST(request: Request): Promise<Response> {
  const auth = await authenticate(request);

  if (!auth.ok) return auth.response;

  const body = await readBody(request, matchDetailRequestSchema, INVALID_BODY);

  if (!body.ok) return body.response;

  const matchId = body.value.match_id;
  const analyze = body.value.analyze === true;

  // 1. Possession. La lecture est sous RLS : elle ne rend que les matchs de
  //    l'appelant. Le plus récemment importé fait foi quand deux comptes liés
  //    du même utilisateur ont joué la partie ensemble — les deux perspectives
  //    sont légitimes, il en faut une, et celle-là est stable.
  //
  //    `payload` voyage avec : c'est le résumé d'historique, que l'analyse
  //    donne au modèle à côté du détail. Une colonne de plus sur une ligne qu'on
  //    lisait déjà coûte moins qu'une seconde requête sur le chemin V4.
  const owned = await auth.client
    .from("imported_matches")
    .select("linked_account_id, payload")
    .eq("match_id", matchId)
    .order("id", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (owned.error !== null) {
    console.error("[valorant] lecture du match importé en échec", owned.error);
    return fail("Le match n'a pas pu être lu. Réessaie dans un instant.", 500);
  }
  if (owned.data === null) return fail(UNKNOWN_MATCH, 404);

  // 2. Cache. Il passe avant la vérification de configuration : un détail déjà
  //    en base reste consultable même si la clé vient d'être retirée.
  const stored = await auth.client
    .from("match_details")
    .select("payload, analysis")
    .eq("match_id", matchId)
    .maybeSingle();

  let cachedDetail: MatchDetail | null = null;
  let cachedAnalysis: string | null = null;

  if (stored.error !== null) {
    // Le cache est en peine : ce n'est pas une raison de refuser la partie, on
    // continue vers la source. Le pire cas est un appel de plus.
    console.error("[valorant] lecture du détail en cache en échec", stored.error);
  } else if (stored.data !== null) {
    const parsed = matchDetailSchema.safeParse(stored.data.payload);

    // Une ligne écrite par une version antérieure du résumé est écartée plutôt
    // que servie à moitié : on la recalcule, et l'insertion la remplacera le
    // jour où le cache sera purgé.
    if (parsed.success) cachedDetail = parsed.data;
    else console.warn("[valorant] détail en cache hors contrat, ignoré");

    // L'analyse, elle, ne dépend pas de la validité du payload : c'est une
    // colonne à part, et un texte déjà payé se rend même si le résumé structuré
    // qui l'accompagnait a changé de forme entre-temps.
    cachedAnalysis =
      typeof stored.data.analysis === "string" && stored.data.analysis.trim() !== ""
        ? stored.data.analysis
        : null;
  }

  // Le client de service est monté une fois pour les deux chemins : il lit les
  // réglages de la plateforme, et lui seul peut écrire l'analyse.
  const service = serviceClient();

  // 3. Une analyse déjà en base ne se regénère **jamais** : ni jeton, ni quota,
  //    quel que soit le nombre de clics. C'est la contrepartie de la mise en
  //    cache à vie (migration 0016), et elle est vérifiée avant toute autre
  //    considération sur le chemin V4.
  const analysisIsCached = analyze && cachedAnalysis !== null;

  if (cachedDetail !== null && (!analyze || analysisIsCached)) {
    return json(
      {
        cached: true,
        detail: cachedDetail,
        analysis: cachedAnalysis,
        remaining: null,
      } satisfies MatchDetailResponse,
      200,
    );
  }

  // 4. Le détail manque : on va le chercher. C'est le même chemin pour les deux
  //    actions — l'analyse ne se fonde pas sur autre chose que ce que la page
  //    affiche.
  const resolved =
    cachedDetail === null
      ? await resolveDetail(
          auth.client,
          service,
          auth.userId,
          matchId,
          owned.data.linked_account_id,
        )
      : ({ ok: true, detail: cachedDetail } as const);

  if (!resolved.ok) return resolved.response;

  const cached = cachedDetail !== null;

  if (!analyze || analysisIsCached) {
    return json(
      {
        cached,
        detail: resolved.detail,
        analysis: cachedAnalysis,
        remaining: null,
      } satisfies MatchDetailResponse,
      200,
    );
  }

  // 5. L'analyse : configuration, quota, modèle, écriture. Tout est là-bas.
  return analyzeMatch({
    client: auth.client,
    service,
    userId: auth.userId,
    matchId,
    detail: resolved.detail,
    cached,
    summary: owned.data.payload,
  });
}

/**
 * Le détail d'une partie tiré de la source, résumé, validé, mis en cache.
 *
 * Extrait du handler parce que **deux** chemins en dépendent désormais (la
 * lecture et l'analyse) et qu'ils doivent obtenir exactement le même objet :
 * une analyse fondée sur un détail obtenu autrement que celui qu'on affiche
 * serait un commentaire sur une partie que le joueur ne voit pas.
 */
async function resolveDetail(
  client: CoachUserClient,
  service: ServiceClient | null,
  userId: string,
  matchId: string,
  linkedAccountId: number,
): Promise<Resolved> {
  // Le compte lié qui a importé ce match : c'est lui qui donne la région
  // d'appel et le PUUID dont le détail est calculé.
  const found = await client
    .from("linked_accounts")
    .select("riot_puuid, riot_region")
    .eq("id", linkedAccountId)
    .maybeSingle();

  if (found.error !== null) {
    console.error("[valorant] lecture du compte lié en échec", found.error);
    return {
      ok: false,
      response: fail("Le compte lié n'a pas pu être lu. Réessaie dans un instant.", 500),
    };
  }

  const puuid = found.data?.riot_puuid ?? null;

  if (puuid === null) {
    return {
      ok: false,
      response: fail("Ce compte lié n'a pas d'identifiant Riot : délie-le et relie-le.", 409),
    };
  }

  const platform = await loadPlatformSettings(service);

  if (!hasKey(platform.henrikdevKey)) {
    return { ok: false, response: fail(NOT_CONFIGURED, 503) };
  }

  const region = found.data?.riot_region ?? DEFAULT_REGION;

  let detail: MatchDetail;

  try {
    const raw = await fetchMatchDetail(platform.henrikdevKey, region, matchId);
    const summarized = parseMatchDetail(raw, puuid);

    // `null` : la réponse n'a pas la forme attendue, ou le joueur n'y figure
    // pas — ce qui, pour un match tiré de *son* historique, est une incohérence
    // de la source et non une erreur de l'utilisateur.
    if (summarized === null) return { ok: false, response: fail(MALFORMED, 502) };

    const validated = matchDetailSchema.safeParse(summarized);

    if (!validated.success) {
      console.error("[valorant] détail hors contrat après résumé", validated.error);
      return { ok: false, response: fail(MALFORMED, 502) };
    }
    detail = validated.data;
  } catch (cause) {
    if (cause instanceof HenrikError) {
      console.error("[valorant] détail de match en échec", cause);
      return { ok: false, response: fail(cause.message, cause.status) };
    }
    console.error("[valorant] échec inattendu sur le détail de match", cause);
    return {
      ok: false,
      response: fail(
        "Le détail de la partie n'a pas pu être chargé. Réessaie dans un instant.",
        500,
      ),
    };
  }

  // Mise en cache. `ignoreDuplicates` traduit l'absence de policy `update` :
  // deux clics simultanés ne laissent qu'une ligne, et la première gagne.
  const { error } = await client
    .from("match_details")
    .upsert(
      { user_id: userId, match_id: matchId, payload: detail },
      { onConflict: "user_id,match_id", ignoreDuplicates: true },
    );

  if (error !== null) {
    // Le détail n'a pas pu être gardé, mais il a été lu : autant le rendre. Le
    // prochain appel repassera par la source, ce qui est exactement le
    // comportement voulu tant que le cache est en peine.
    console.error("[valorant] mise en cache du détail en échec", error);
  }

  return { ok: true, detail };
}
