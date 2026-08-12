/**
 * `POST /api/coach` — le Coach post-game (SPEC §2, §4, §7-P3).
 *
 * Fonction serverless Vercel, et **seule détentrice des secrets** :
 * `ANTHROPIC_API_KEY` et `SUPABASE_SERVICE_ROLE_KEY` ne sortent jamais d'ici.
 * Le navigateur, lui, ne connaît que l'URL Supabase et la clé publiable.
 *
 * Ce fichier est volontairement mince : il ne fait qu'enchaîner des étapes et
 * traduire chaque échec en code HTTP. Tout ce qui mérite d'être testé — la
 * construction du prompt, la lecture de la réponse du modèle, le verdict de
 * quota, le résumé du bench — vit dans `src/server/coach/`, en modules purs.
 *
 * Deux clients Supabase, et le choix entre les deux n'est jamais anodin :
 *
 * - le **client utilisateur** (clé publiable + JWT de l'appelant) sert à tout
 *   ce qui touche aux données métier : lecture du profil, du dernier bench,
 *   écriture du debrief. La RLS s'applique donc exactement comme dans le
 *   navigateur — la fonction ne peut pas lire ou écrire chez quelqu'un d'autre,
 *   même si son code se trompait d'identifiant ;
 * - le **client de service** (service key, qui contourne la RLS) ne sert qu'à
 *   ce qu'aucune policy ne peut autoriser : incrémenter le compteur de quota,
 *   lire la clé du fournisseur personnel de l'utilisateur (migration 0008) et
 *   celle de la plateforme (migration 0009), et sommer la consommation du jour
 *   de tout le monde pour le plafond global. Rien d'autre ne passe par lui.
 *
 * L'ordre des vérifications est délibéré : identité d'abord, configuration
 * ensuite. Un appel sans jeton doit être refusé (401) même quand les clés IA
 * ne sont pas encore posées dans Vercel — sinon la fonction annoncerait son
 * état de configuration à n'importe qui.
 *
 * Depuis SPEC §5 ter, le modèle n'est plus forcément le nôtre : `resolveModelFor`
 * dit quel fournisseur sert cet appel. Deux conséquences, et une seule ligne de
 * code les porte toutes les deux — `config.source` :
 *
 * - **le quota** ne mesure que notre clé. Sur une configuration personnelle, le
 *   compteur n'est pas remis à zéro : il n'est simplement **pas appelé**, et
 *   `remaining` sort à `null` ;
 * - **les erreurs** désignent leur responsable. Une clé personnelle refusée
 *   n'est pas une panne d'AimForge, et le message doit envoyer l'utilisateur
 *   dans ses réglages plutôt qu'à la salle d'attente.
 *
 * Depuis SPEC §5 quater, deux choses de plus ne sont plus figées dans ce
 * fichier : **quel fournisseur** la plateforme sert (l'administration le
 * choisit ; `ANTHROPIC_API_KEY` n'est plus qu'un repli) et **combien** de
 * debriefs par jour elle accorde. Les deux sortent de la même lecture, faite
 * une fois — `loadPlatformSettings`. S'y ajoute un **plafond global** : au-delà,
 * plus personne ne consomme la clé de la plateforme, mais les configurations
 * personnelles continuent, puisqu'elles ne coûtent rien ici.
 *
 * Depuis SPEC §5 ter bis, l'entrée n'est plus seulement un texte collé : la
 * fonction accepte aussi `{"match_id": …}` et va lire elle-même le résumé du
 * match dans `imported_matches`, sous la RLS de l'appelant. Le navigateur
 * n'envoie donc jamais de stats pré-formatées pour un match importé — sinon il
 * suffirait de mentir sur le contenu de la partie tout en gardant le badge
 * « débriefé ». Le debrief produit garde la référence du match, et l'index
 * unique de la migration 0011 interdit de le débriefer deux fois.
 *
 * La signature est **`export async function POST(request: Request)`**, et pas
 * un export par défaut : c'est la seule forme que le runtime Node de Vercel
 * reconnaît comme un gestionnaire web. Un `export default (request) => …` est
 * appelé, lui, avec la signature Node historique `(req, res)` — le code reçoit
 * alors un `IncomingMessage`, `request.headers.get` n'existe pas, et chaque
 * appel meurt en 500 avant la première vérification. Les autres méthodes HTTP
 * n'ont pas d'export : la plateforme y répond 405 toute seule.
 */

import { createClient } from "@supabase/supabase-js";
import { z } from "zod";
// Le schéma généré depuis la base : il décrit les tables, donc il vaut pour
// les deux côtés. Import de type uniquement — rien n'en sort à l'exécution.
import type { Database } from "../src/client/supabase/database-types.js";
import {
  AiSettingsUnavailableError,
  type AskDeps,
  createAsk,
  ModelError,
  modelErrorMessage,
  modelErrorStatus,
  type ProviderConfig,
  resolveModelFor,
} from "../src/server/ai/index.js";
import { type AskModel, generateDebrief } from "../src/server/coach/generate.js";
import { matchStatsFrom } from "../src/server/coach/match-stats.js";
import {
  type CoachContext,
  coachSystemPrompt,
  identityOf,
  type PromptIdentity,
} from "../src/server/coach/prompt.js";
import {
  createQuotaRefund,
  evaluateQuota,
  type QuotaRefund,
  refundQuota,
} from "../src/server/coach/quota.js";
import { GLOBAL_CAP_REACHED, globalCapReached } from "../src/server/platform/settings.js";
import { scenarioCatalog } from "../src/server/shared/scenarios.js";
import { aiQuotaReachedMessage } from "../src/shared/ai-quota-contract.js";
import {
  AI_MODEL_BUDGET_MS,
  AI_MODEL_CALL_CAP_MS,
  AI_MODEL_CALL_FLOOR_MS,
} from "../src/shared/ai-timing.js";
import {
  coachRequestSchema,
  MAX_STATS_LENGTH,
  type StoredDebrief,
} from "../src/shared/coach-contract.js";
import { SUPABASE_PUBLISHABLE_KEY, SUPABASE_URL } from "../src/shared/supabase-config.js";
import { loadAiSettingsWith, persistChatGptTokensWith } from "./_lib/ai-settings.js";
import { refundAiUsageWith } from "./_lib/ai-usage.js";
import {
  defaultTierFor,
  loadBenchTiers,
  loadProfile,
  preferencesOf,
} from "./_lib/coach-context.js";
import { postDebriefCard } from "./_lib/coach-thread-write.js";
import { BudgetExhaustedError, type ModelBudget, startModelBudget } from "./_lib/model-budget.js";
import { loadPlatformSettings, platformAiUsageToday } from "./_lib/platform-settings.js";
import { serviceClient } from "./_lib/service.js";

/**
 * Un debrief demande une génération complète, pas un aller-retour de chat :
 * 60 s couvre le cas lent (relance corrective comprise) sans laisser une
 * requête bloquée pendre indéfiniment.
 *
 * La valeur reste **littérale** : la plateforme la lit par analyse statique.
 * `src/shared/ai-timing.ts` en tient le miroir, et son test refuse la dérive.
 */
export const maxDuration = 60;

/** Assez pour un debrief structuré ; le contrat borne déjà les longueurs. */
const MAX_TOKENS = 2000;

const usageCountSchema = z.number().int().min(0);

const JSON_HEADERS: Readonly<Record<string, string>> = {
  "content-type": "application/json; charset=utf-8",
  // Le debrief est personnel et payé au quota : aucun intermédiaire ne le garde.
  "cache-control": "no-store",
};

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), { status, headers: JSON_HEADERS });
}

function fail(error: string, status: number): Response {
  return json({ error }, status);
}

/**
 * Un échec, avec le quota du jour quand il y en a un à annoncer — c'est-à-dire
 * après un remboursement, pour que l'écran ne montre pas un debrief consommé
 * qui vient d'être rendu.
 *
 * La clé est **omise** plutôt que mise à `null` quand il n'y a rien à compter :
 * le contrat d'erreur (`coachErrorSchema`) la déclare facultative, pas
 * nullable. Un `null` ferait échouer la relecture côté client, qui remplacerait
 * alors le message soigné par son message générique.
 */
function failWithQuota(error: string, status: number, remaining: number | null): Response {
  return remaining === null ? fail(error, status) : json({ error, remaining }, status);
}

/* ------------------------------------------------------------------ */
/* Entrée                                                              */
/* ------------------------------------------------------------------ */

/**
 * Ce que la requête demande de débriefer : un texte collé, ou un match importé
 * dont **le serveur** ira chercher le résumé (SPEC §5 ter bis).
 */
type Input =
  | { readonly kind: "stats"; readonly stats: string; readonly thread: boolean }
  | { readonly kind: "match"; readonly matchId: string; readonly thread: boolean };

type BodyResult =
  | { readonly ok: true; readonly input: Input }
  | { readonly ok: false; readonly response: Response };

function readBody(raw: string): BodyResult {
  let value: unknown;

  try {
    value = JSON.parse(raw);
  } catch {
    return { ok: false, response: fail("Corps de requête illisible : JSON attendu.", 400) };
  }

  // La longueur est vérifiée avant le schéma pour distinguer « trop long »
  // (413, l'utilisateur doit couper) de « mal formé » (400, le client a un bug).
  const stats: unknown = (value as { stats?: unknown } | null)?.stats;

  if (typeof stats === "string" && stats.length > MAX_STATS_LENGTH) {
    return {
      ok: false,
      response: fail(
        `Stats trop longues : ${stats.length} caractères pour ${MAX_STATS_LENGTH} au maximum. Colle seulement le tableau de la partie.`,
        413,
      ),
    };
  }

  const parsed = coachRequestSchema.safeParse(value);

  if (!parsed.success) {
    return {
      ok: false,
      response: fail("Colle les stats de ta partie, ou choisis un match importé.", 400),
    };
  }
  const thread = parsed.data.thread === true;

  return {
    ok: true,
    input:
      "stats" in parsed.data
        ? { kind: "stats", stats: parsed.data.stats, thread }
        : { kind: "match", matchId: parsed.data.match_id, thread },
  };
}

/* ------------------------------------------------------------------ */
/* Match importé                                                       */
/* ------------------------------------------------------------------ */

type UserClient = ReturnType<typeof createClient<Database>>;

const ALREADY_DEBRIEFED = "Ce match a déjà été débriefé.";

const MATCH_UNKNOWN =
  "Ce match n'est pas dans tes parties importées. Rafraîchis ton compte Riot, puis réessaie.";

type MatchResolution =
  | { readonly ok: true; readonly stats: string }
  | { readonly ok: false; readonly response: Response };

/**
 * Le texte de stats d'un match importé, lu **sous la RLS de l'appelant**.
 *
 * Le client utilisateur n'est pas une commodité ici, c'est le contrôle d'accès :
 * un match qui appartient à quelqu'un d'autre n'est pas « refusé », il est
 * **invisible**, donc indiscernable d'un match qui n'existe pas. C'est
 * exactement ce qu'on veut répondre — 404 dans les deux cas, sans dire lequel.
 * Le `.eq("user_id")` est redondant avec la policy : il est là pour emprunter
 * l'index et pour que la lecture du code dise ce que la base fait.
 *
 * Deux refus de plus, dans l'ordre où ils comptent :
 *
 * - **déjà débriefé** (409) — la contrainte d'unicité de la migration 0011 le
 *   garantit de toute façon à l'insertion ; cette vérification-ci existe pour
 *   ne pas consommer un quota et un appel au modèle avant d'y arriver. Elle
 *   rend l'identifiant du debrief existant, pour que l'écran propose de
 *   l'ouvrir plutôt que d'annoncer un échec ;
 * - **résumé illisible** (422) — le `payload` est un `jsonb`, Postgres n'en
 *   garantit que la syntaxe. Un match à moitié lu ne part pas au modèle.
 */
async function resolveMatch(
  client: UserClient,
  userId: string,
  matchId: string,
): Promise<MatchResolution> {
  // Plusieurs comptes liés peuvent avoir importé la même partie (l'unicité est
  // par compte lié) : on lit la plus récente plutôt que d'exiger une ligne.
  const { data: matches, error } = await client
    .from("imported_matches")
    .select("payload")
    .eq("user_id", userId)
    .eq("match_id", matchId)
    .order("id", { ascending: false })
    .limit(1);

  if (error !== null) {
    console.error("[coach] lecture du match importé en échec", error);
    return {
      ok: false,
      response: fail("Tes matchs importés n'ont pas pu être lus. Réessaie dans un instant.", 503),
    };
  }

  const match = matches?.[0] ?? null;

  if (match === null) return { ok: false, response: fail(MATCH_UNKNOWN, 404) };

  const { data: existing, error: existingError } = await client
    .from("debriefs")
    .select("id")
    .eq("user_id", userId)
    .eq("match_id", matchId)
    .limit(1);

  if (existingError !== null) {
    console.error("[coach] lecture du debrief existant en échec", existingError);
    return {
      ok: false,
      response: fail("Tes debriefs n'ont pas pu être lus. Réessaie dans un instant.", 503),
    };
  }

  const already = existing?.[0] ?? null;

  if (already !== null) {
    return {
      ok: false,
      response: json({ error: ALREADY_DEBRIEFED, debrief_id: already.id }, 409),
    };
  }

  const stats = matchStatsFrom(match.payload);

  if (stats === null) {
    console.error("[coach] résumé de match hors contrat", { matchId });
    return {
      ok: false,
      response: fail(
        "Le résumé de ce match n'est plus lisible. Rafraîchis ton compte Riot, ou colle les stats à la main.",
        422,
      ),
    };
  }
  return { ok: true, stats };
}

/**
 * L'identifiant du debrief déjà posé sur ce match, quand l'insertion a été
 * refusée par la contrainte d'unicité (course entre deux clics).
 *
 * Rend `null` si la relecture échoue : on préfère un 409 sans identifiant à un
 * message d'erreur qui parlerait d'autre chose que du vrai problème.
 */
async function existingDebriefId(
  client: UserClient,
  userId: string,
  matchId: string,
): Promise<number | null> {
  const { data, error } = await client
    .from("debriefs")
    .select("id")
    .eq("user_id", userId)
    .eq("match_id", matchId)
    .limit(1);

  if (error !== null) return null;
  return data?.[0]?.id ?? null;
}

/* ------------------------------------------------------------------ */
/* Contexte : profil et dernier bench, lus sous RLS                    */
/* ------------------------------------------------------------------ */

/**
 * Le profil et le dernier bench sont du **contexte**, pas des prérequis : la
 * lecture vit dans `./_lib/coach-context.ts`, qui explique pourquoi un échec y
 * rend `null` plutôt que d'annuler la requête — et pourquoi les deux fonctions
 * du coach la partagent.
 *
 * Le catalogue de scénarios, lui, est toujours présent : sans bench (donc sans
 * palier mesuré), c'est celui du palier Novice, exactement comme la routine.
 * Mieux vaut la liste du premier palier qu'aucune liste — sans elle, le modèle
 * n'a plus de noms à citer et se remet à en inventer.
 */
async function loadContext(
  client: UserClient,
  userId: string,
  stats: string,
): Promise<{ readonly context: CoachContext; readonly identity: PromptIdentity }> {
  // Le profil se lit **avant** le bench, et non en parallèle : c'est lui qui
  // porte le benchmark actif (DECISIONS.md D6), et le bench se lit dans ce
  // benchmark-là. Un aller-retour de plus sur un chemin qui attend ensuite
  // vingt secondes de modèle est un prix qu'on paie sans hésiter pour ne pas
  // résumer des passes d'un barème que le joueur ne travaille plus.
  const profile = await loadProfile(client, userId);
  const identity = identityOf(profile);
  const { activeBenchmark } = preferencesOf(profile);
  const bench = await loadBenchTiers(client, userId, activeBenchmark);
  // Le palier retenu est celui de la passe la plus récente : c'est celui sur
  // lequel le joueur s'entraîne, donc le seul catalogue qui lui soit utile.
  const catalog = scenarioCatalog(bench.latestTier ?? defaultTierFor(activeBenchmark));

  return { context: { stats, profile, bench, scenarios: catalog.groups }, identity };
}

/* ------------------------------------------------------------------ */
/* Appel au modèle                                                     */
/* ------------------------------------------------------------------ */

/**
 * Le port du modèle, câblé sur l'adaptateur du fournisseur résolu (SPEC §5 ter)
 * et sur le budget de temps.
 *
 * Le port n'a pas changé — c'est ce qui rend ce branchement minuscule. Ce qui
 * a changé est en amont : `createAsk` rend l'adaptateur du fournisseur de
 * l'utilisateur (ou celui de la plateforme), et toute la logique de génération
 * (relance corrective comprise) reste dans `generateDebrief`, qui ne sait
 * toujours pas qui répond au bout du fil.
 *
 * Le délai vient du **budget** et non d'une constante par appel (V4-C §4.9) :
 * `generateDebrief` peut appeler deux fois, et deux fois 45 s dépassaient le
 * `maxDuration`. La fonction était alors tuée avant d'avoir pu rembourser le
 * quota — le raisonnement complet est dans `./_lib/model-budget.js`.
 */
function askWith(
  config: ProviderConfig,
  identity: PromptIdentity,
  budget: ModelBudget,
  deps: AskDeps,
): AskModel {
  const ask = createAsk(
    config,
    { system: coachSystemPrompt(identity), maxTokens: MAX_TOKENS },
    deps,
  );

  return (messages) =>
    // Seul le texte est retenu : un debrief n'est pas mis en cache, et une
    // sortie coupée retombe déjà dans la relance corrective de
    // `generateDebrief` — un JSON tronqué ne parse pas. C'est la mini-analyse
    // d'un match, écrite en base pour toujours, qui a besoin du drapeau
    // (`api/_lib/match-analysis.ts`).
    ask(messages, budget.nextTimeout()).then((answer) => answer.text);
}

/* ------------------------------------------------------------------ */
/* Handler                                                             */
/* ------------------------------------------------------------------ */

export async function POST(request: Request): Promise<Response> {
  // 1. Identité. Avant tout le reste : un appel anonyme n'apprend rien de
  //    l'état de configuration du service.
  const authorization = request.headers.get("authorization") ?? "";
  const token = authorization.toLowerCase().startsWith("bearer ")
    ? authorization.slice(7).trim()
    : "";

  if (token === "") {
    return fail("Authentification requise : reconnecte-toi.", 401);
  }

  const userClient = createClient<Database>(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { headers: { Authorization: `Bearer ${token}` } },
  });
  const { data: auth, error: authError } = await userClient.auth.getUser(token);
  const user = auth?.user ?? null;

  if (authError !== null || user === null) {
    return fail("Session invalide ou expirée : reconnecte-toi.", 401);
  }

  // 2. Entrée.
  const body = readBody(await request.text());

  if (!body.ok) return body.response;

  // 2 bis. Débrief d'un match importé (SPEC §5 ter bis) : le texte de stats est
  //        construit ici, à partir de la base, et jamais reçu du navigateur.
  //        La lecture passe **avant** la configuration IA et avant le quota :
  //        un match inconnu ou déjà débriefé ne doit rien coûter à personne.
  let matchId: string | null = null;
  let stats: string;

  if (body.input.kind === "stats") {
    stats = body.input.stats;
  } else {
    const resolved = await resolveMatch(userClient, user.id, body.input.matchId);

    if (!resolved.ok) return resolved.response;
    stats = resolved.stats;
    matchId = body.input.matchId;
  }

  // 3. Configuration. La service key est requise dans tous les cas : c'est
  //    elle, et elle seule, qui peut lire la clé du fournisseur personnel de
  //    l'utilisateur (privilèges de colonne, migration 0008) et celle de la
  //    plateforme (migration 0009). La clé Anthropic d'environnement, elle,
  //    n'est plus obligatoire — ni pour qui a posé la sienne (SPEC §5 ter), ni
  //    pour la plateforme si l'administration en a configuré une autre
  //    (SPEC §5 quater).
  const service = serviceClient();

  if (service === null) {
    return fail("IA non configurée", 503);
  }

  //    Un seul aller-retour pour toute la configuration de la plateforme : le
  //    fournisseur servi par défaut, la limite du jour, le plafond global.
  const platform = await loadPlatformSettings(service);

  // 4. Quel fournisseur, et qui paie. C'est la seule bascule de SPEC §5 ter :
  //    configuration personnelle ⇒ le compteur de quota n'est pas appelé.
  let resolution: Awaited<ReturnType<typeof resolveModelFor>>;

  try {
    resolution = await resolveModelFor(loadAiSettingsWith(service), user.id, platform.ai);
  } catch (cause) {
    // Une lecture de réglages en échec ne bascule pas en douce sur la clé de
    // la plateforme : l'utilisateur a demandé le contraire, et son quota est
    // levé — le faire consommer sans le dire serait pire que l'attente.
    console.error("[coach] réglages IA illisibles", cause);
    if (cause instanceof AiSettingsUnavailableError) {
      return fail("Tes réglages IA n'ont pas pu être lus. Réessaie dans un instant.", 503);
    }
    throw cause;
  }

  if (!resolution.ok) return fail(resolution.reason, resolution.status);

  const config = resolution.config;

  // 5. Quota, incrémenté avant l'appel au modèle (SPEC §4) — **et seulement
  //    sur la clé de la plateforme**. L'incrément et la lecture sont la même
  //    instruction SQL : deux requêtes simultanées ne peuvent pas passer
  //    toutes les deux sur le dernier debrief disponible.
  //
  //    Ce que l'incrément anticipé ne doit pas faire, en revanche, c'est
  //    facturer nos propres pannes : si rien n'est persisté au bout du compte,
  //    on rembourse (`refund`, migration 0010). Le remboursement n'existe que
  //    sur ce chemin — une configuration personnelle n'a rien incrémenté, il
  //    n'y a donc rien à lui rendre.
  let remaining: number | null = null;
  let refund: QuotaRefund | null = null;

  if (config.source === "platform") {
    // 5a. Le plafond **global** (SPEC §5 quater), avant le compteur personnel :
    //     quand la plateforme a épuisé son budget du jour, il n'y a pas de
    //     raison de consommer en plus le quota de celui qui demande. Une somme
    //     indisponible laisse passer — le plafond protège un budget, et
    //     `platformAiUsageToday` explique pourquoi on ne referme pas dessus.
    const usedToday = await platformAiUsageToday(service);

    if (usedToday !== null && globalCapReached(usedToday, platform.aiGlobalDailyLimit)) {
      return json({ error: GLOBAL_CAP_REACHED, remaining: 0 }, 429);
    }

    // 5b. Le quota par utilisateur, dont la limite se règle en base.
    const usage = await service.rpc("increment_ai_usage", {
      p_user_id: user.id,
      p_kind: "coach",
    });

    if (usage.error !== null) {
      return fail("Le compteur de quota est indisponible. Réessaie dans un instant.", 503);
    }

    const count = usageCountSchema.safeParse(usage.data);

    if (!count.success) {
      return fail("Le compteur de quota a renvoyé une valeur inattendue.", 503);
    }

    const limit = platform.limits.coachDaily;
    const quota = evaluateQuota(count.data, limit);

    if (!quota.allowed) {
      return json(
        {
          error: aiQuotaReachedMessage("coach", limit),
          remaining: quota.remaining,
        },
        429,
      );
    }
    remaining = quota.remaining;
    refund = createQuotaRefund(
      quota.remaining,
      limit,
      refundAiUsageWith(service, user.id, "coach"),
    );
  }

  // 6. Contexte puis génération.
  const { context, identity } = await loadContext(userClient, user.id, stats);
  // Le budget s'ouvre **ici**, juste avant le premier appel : le contexte est
  // déjà lu, et ce qui reste sous le `maxDuration` doit couvrir la génération,
  // sa relance, l'écriture en base et, si besoin, le remboursement.
  const budget = startModelBudget(AI_MODEL_BUDGET_MS, AI_MODEL_CALL_CAP_MS, AI_MODEL_CALL_FLOOR_MS);

  let generated: Awaited<ReturnType<typeof generateDebrief>>;

  try {
    generated = await generateDebrief(
      // La réécriture des jetons ne concerne que la liaison ChatGPT ; les
      // adaptateurs à clé l'ignorent. La passer sans condition évite d'avoir à
      // se rappeler quel fournisseur en a besoin.
      askWith(config, identity, budget, { persist: persistChatGptTokensWith(service, user.id) }),
      context,
    );
  } catch (cause) {
    // Le détail (clé, en-têtes, corps de requête) ne remonte jamais au client :
    // il part dans les logs de la fonction, où il est utile et confiné.
    console.error("[coach] appel au modèle en échec", cause);
    // Aucun debrief produit : l'incrément n'a plus de contrepartie, on le rend.
    // Le remboursement ne lève pas et ne change pas le code de retour — c'est
    // l'erreur d'origine qui explique l'échec, pas l'état du compteur.
    // Le renoncement au budget en fait partie : le temps manquant est le nôtre.
    remaining = await refundQuota(refund, remaining);
    if (cause instanceof BudgetExhaustedError) {
      return failWithQuota(
        "Le debrief a pris trop de temps. Réessaie : c'est en général plus rapide.",
        504,
        remaining,
      );
    }
    if (cause instanceof ModelError) {
      // La rédaction dit **à qui appartient le problème** : une clé personnelle
      // refusée n'est pas une panne d'AimForge, et l'utilisateur est le seul à
      // pouvoir la corriger.
      return failWithQuota(modelErrorMessage(cause, "coach"), modelErrorStatus(cause), remaining);
    }
    return failWithQuota(
      "Le coach est injoignable pour le moment. Réessaie dans un instant.",
      502,
      remaining,
    );
  }

  if (!generated.ok) {
    console.error(`[coach] sortie hors contrat après ${generated.attempts} tentatives`, {
      reason: generated.reason,
    });
    remaining = await refundQuota(refund, remaining);
    return failWithQuota(
      "Le coach n'a pas rendu un debrief exploitable, même après relance. Réessaie dans un instant.",
      502,
      remaining,
    );
  }

  // 7. Persistance, avec le JWT de l'utilisateur : c'est la RLS qui autorise
  //    l'insertion, pas la fonction.
  const { data: row, error: insertError } = await userClient
    .from("debriefs")
    .insert({
      user_id: user.id,
      input_raw: stats,
      match_id: matchId,
      resume: generated.debrief.resume,
      points_forts: generated.debrief.points_forts,
      axes: generated.debrief.axes,
      focus: generated.debrief.focus,
    })
    .select("id, date, match_id")
    .single();

  // Deux clics rapides sur « Débriefer » partent en parallèle : le second se
  // fait refuser par l'index unique de la migration 0011 (23505). Ce n'est pas
  // une panne — le debrief demandé existe — donc 409 et l'identifiant de
  // l'existant, comme au contrôle d'entrée. Le quota, lui, est rendu : cette
  // requête-ci n'a rien produit.
  if (insertError?.code === "23505" && matchId !== null) {
    remaining = await refundQuota(refund, remaining);

    const existing = await existingDebriefId(userClient, user.id, matchId);
    const body409: Record<string, unknown> = { error: ALREADY_DEBRIEFED };

    if (existing !== null) body409.debrief_id = existing;
    if (remaining !== null) body409.remaining = remaining;
    return json(body409, 409);
  }

  if (insertError !== null || row === null) {
    console.error("[coach] enregistrement du debrief en échec", insertError);
    // Généré mais pas enregistré : l'utilisateur n'a rien, donc la règle du
    // remboursement s'applique ici comme sur une panne du modèle. Le jeton
    // dépensé chez le fournisseur, lui, est perdu — c'est notre affaire, pas
    // celle de son quota.
    remaining = await refundQuota(refund, remaining);
    return failWithQuota(
      "Le debrief a été généré mais n'a pas pu être enregistré. Ton quota n'a pas été décompté : réessaie.",
      500,
      remaining,
    );
  }

  const stored: StoredDebrief = {
    ...generated.debrief,
    id: row.id,
    date: new Date(row.date).toISOString(),
    match_id: row.match_id,
  };

  // 8. La carte dans le fil (SPEC §5 sexies), quand le debrief a été demandé
  //    depuis le fil ou depuis un geste qui y mène. Elle est posée **ici** et
  //    non par le navigateur, parce que la migration 0015 lui interdit d'écrire
  //    une ligne `role = 'coach'` — et parce que la poser au plus près de la
  //    génération supprime la fenêtre où le joueur arriverait sur un fil muet
  //    alors que son quota est déjà consommé.
  //
  //    Aucun doublon possible sur ce chemin : `row.id` vient d'être créé, donc
  //    aucune carte ne peut déjà le référencer. Et un échec ici ne fait pas
  //    échouer la requête : le debrief est enregistré et facturé, `thread` est
  //    simplement absent de la réponse et l'écran se rabat sur l'historique.
  const thread = body.input.thread
    ? await postDebriefCard(
        userClient,
        service,
        user.id,
        stored,
        body.input.kind === "match" ? "match" : "stats",
      )
    : null;

  return json(
    thread === null ? { debrief: stored, remaining } : { debrief: stored, remaining, thread },
    200,
  );
}
