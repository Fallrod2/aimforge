/**
 * `POST /api/routine` — la Routine du jour (SPEC §1, §4, §7-P4 ;
 * AIMFORGE_KICKOFF §3).
 *
 * Fonction serverless Vercel, et **seule détentrice des secrets** :
 * `ANTHROPIC_API_KEY` et `SUPABASE_SERVICE_ROLE_KEY` ne sortent jamais d'ici.
 * Le navigateur, lui, ne connaît que l'URL Supabase et la clé publiable.
 *
 * Elle est le jumeau de `api/coach.ts` — même ordre de contrôles, mêmes deux
 * clients Supabase, même patron generate/parse — et les commentaires d'en-tête
 * de ce fichier-là valent ici mot pour mot : le **client utilisateur** (clé
 * publiable + JWT de l'appelant) pour tout ce qui touche aux données métier, le
 * **client de service** pour la seule chose qu'aucune policy n'autorise,
 * l'incrément du compteur de quota.
 *
 * L'ordre des vérifications est délibéré : identité d'abord (un appel anonyme
 * n'apprend rien de l'état de configuration du service), entrée ensuite,
 * configuration, **résolution du fournisseur**, quota, puis seulement le
 * modèle. La résolution passe avant le quota parce qu'elle décide s'il y a un
 * quota à compter : une configuration personnelle (SPEC §5 ter) ne consomme
 * rien chez nous, donc le compteur n'est pas appelé et `remaining` sort à
 * `null`.
 *
 * Depuis SPEC §5 quater, le fournisseur de la plateforme, la limite du jour et
 * le plafond global viennent de `platform_settings` — une seule lecture les
 * rapporte tous les trois (`loadPlatformSettings`), avec repli sur les
 * variables d'environnement et les constantes d'avant.
 *
 * La signature est **`export async function POST(request: Request)`**, et pas
 * un export par défaut : c'est la seule forme que le runtime Node de Vercel
 * reconnaît comme un gestionnaire web. Tous les imports relatifs portent une
 * extension `.js` explicite (et `with { type: "json" }` pour le JSON, dans la
 * lib d'énergie) : le constructeur ne réécrit pas les spécificateurs.
 *
 * Ce que cette fonction fait de plus que le coach : elle **borne son temps**.
 * Deux appels au modèle (l'appel initial et la relance corrective) avec un
 * délai fixe chacun peuvent, additionnés, dépasser la durée que la plateforme
 * accorde à la fonction — et une fonction tuée par la plateforme ne rend pas le
 * message soigné qu'on a écrit, elle rend une page d'erreur. D'où un budget
 * unique et décroissant (`src/server/kovaaks/budget.ts`) partagé par les deux
 * tentatives : quand il ne reste pas de quoi tenter, on renonce nous-mêmes, à
 * temps, avec notre propre message.
 *
 * Depuis V5 (SPEC §5 sexies), elle fait aussi deux choses de plus :
 *
 * 1. elle **compte les parties classées récentes** de l'appelant (14 jours,
 *    `src/server/routine/gating.ts`) et en déduit le mode. Sous cinq parties,
 *    la routine se génère quand même mais sans la moindre stat in-game dans le
 *    prompt, et la réponse porte `mode: "bench_only"` pour que l'écran le dise ;
 * 2. elle **fait vérifier les chiffres cités** par le modèle contre les vraies
 *    valeurs du contexte (`src/server/routine/citations.ts`). Une citation
 *    fausse suit exactement le chemin d'un scénario inventé : une relance
 *    corrective nominative, puis 502 avec remboursement du quota.
 */

import { createClient } from "@supabase/supabase-js";
import { z } from "zod";
import {
  type MatchSummary,
  matchSummarySchema,
} from "../src/client/data/linked-accounts-contract.js";
// Le schéma généré depuis la base : il décrit les tables, donc il vaut pour
// les deux côtés. Import de type uniquement — rien n'en sort à l'exécution.
import type { Database } from "../src/client/supabase/database-types.js";
import type { BenchmarkId } from "../src/lib/energy/index.js";
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
import { identityOf, type PromptIdentity } from "../src/server/coach/prompt.js";
import {
  createQuotaRefund,
  evaluateQuota,
  type QuotaRefund,
  refundQuota,
} from "../src/server/coach/quota.js";
import { attemptTimeout, startBudget } from "../src/server/kovaaks/budget.js";
import { GLOBAL_CAP_REACHED, globalCapReached } from "../src/server/platform/settings.js";
import {
  type RoutineBenchTiers,
  summarizeTierBenchForRoutine,
} from "../src/server/routine/bench.js";
import { gateRoutine, type RoutineGate } from "../src/server/routine/gating.js";
import { type AskModel, generateRoutine } from "../src/server/routine/generate.js";
import { summarizeIngameForRoutine } from "../src/server/routine/ingame.js";
import {
  type RoutineContext,
  type RoutineDebriefAxes,
  routineSystemPrompt,
} from "../src/server/routine/prompt.js";
import { scenarioCatalog } from "../src/server/shared/scenarios.js";
import { coachAxeSchema } from "../src/shared/coach-contract.js";
import { routineRequestSchema, type StoredRoutine } from "../src/shared/routine-contract.js";
import { SUPABASE_PUBLISHABLE_KEY, SUPABASE_URL } from "../src/shared/supabase-config.js";
import { loadAiSettingsWith, persistChatGptTokensWith } from "./_lib/ai-settings.js";
import { refundAiUsageWith } from "./_lib/ai-usage.js";
import {
  defaultTierFor,
  loadLatestBenchRuns,
  loadProfile,
  preferencesOf,
} from "./_lib/coach-context.js";
import { loadPlatformSettings, platformAiUsageToday } from "./_lib/platform-settings.js";
import { serviceClient } from "./_lib/service.js";

/**
 * Une routine est plus longue à écrire qu'un debrief (blocs, items, durées) et
 * peut demander deux appels. 60 s couvre le pire cas réel — deux tentatives
 * bornées par le budget ci-dessous — sans laisser une requête pendre.
 */
export const maxDuration = 60;

/** Assez pour une séance structurée ; le contrat borne déjà les longueurs. */
const MAX_TOKENS = 3000;

/**
 * Budget de temps des appels au modèle, ouvert juste avant le premier.
 *
 * `TOTAL` garde une marge sous `maxDuration` pour l'écriture en base et la
 * construction de la réponse. `CAP` empêche un premier appel lent d'avaler
 * tout le budget et de laisser la relance sans rien. `FLOOR` évite de lancer
 * une relance qui n'a aucune chance d'aboutir : mieux vaut un 502 rédigé
 * qu'une coupure de plateforme.
 */
const BUDGET_TOTAL_MS = 48_000;
const BUDGET_CALL_CAP_MS = 38_000;
const BUDGET_CALL_FLOOR_MS = 8_000;

/** Nombre de debriefs relus pour en tirer les axes (AIMFORGE_KICKOFF §3). */
const DEBRIEF_COUNT = 3;

/**
 * Plafond de matchs importés relus, comme `api/valorant/stats`.
 *
 * Les deux fenêtres qui comptent ici (14 et 30 jours) sont servies par les plus
 * récents, et le tri est explicite pour que la troncature coupe l'ancien.
 */
const MATCH_CAP = 200;

const usageCountSchema = z.number().int().min(0);

/** Les axes d'un debrief, relus depuis une colonne `jsonb` non garantie. */
const storedAxesSchema = z.array(coachAxeSchema);

const JSON_HEADERS: Readonly<Record<string, string>> = {
  "content-type": "application/json; charset=utf-8",
  // La routine est personnelle et payée au quota : aucun intermédiaire ne la garde.
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
 * après un remboursement, pour que l'écran ne montre pas une routine consommée
 * qui vient d'être rendue.
 *
 * La clé est **omise** plutôt que mise à `null` quand il n'y a rien à compter :
 * le contrat d'erreur (`routineErrorSchema`) la déclare facultative, pas
 * nullable. Un `null` ferait échouer la relecture côté client, qui remplacerait
 * alors le message soigné par son message générique.
 */
function failWithQuota(error: string, status: number, remaining: number | null): Response {
  return remaining === null ? fail(error, status) : json({ error, remaining }, status);
}

/** Renoncement volontaire faute de temps : distingué d'une panne du modèle. */
class BudgetExhaustedError extends Error {
  override readonly name = "BudgetExhaustedError";
}

/* ------------------------------------------------------------------ */
/* Entrée                                                              */
/* ------------------------------------------------------------------ */

type BodyResult =
  | { readonly ok: true; readonly dureeMinutes: number; readonly focus: string | null }
  | { readonly ok: false; readonly response: Response };

function readBody(raw: string): BodyResult {
  let value: unknown;

  try {
    value = JSON.parse(raw);
  } catch {
    return { ok: false, response: fail("Corps de requête illisible : JSON attendu.", 400) };
  }

  const parsed = routineRequestSchema.safeParse(value);

  if (!parsed.success) {
    return {
      ok: false,
      response: fail(
        "Requête invalide : indique une durée en minutes (entier, de 10 à 240) et un focus court, facultatif.",
        400,
      ),
    };
  }
  return { ok: true, dureeMinutes: parsed.data.duree_minutes, focus: parsed.data.focus };
}

/* ------------------------------------------------------------------ */
/* Contexte : benchs par palier et derniers debriefs, lus sous RLS      */
/* ------------------------------------------------------------------ */

type UserClient = ReturnType<typeof createClient<Database>>;

/**
 * Le bench, les debriefs et les matchs sont du **contexte**, pas des
 * prérequis : une lecture qui échoue dégrade la routine, elle ne doit pas
 * l'annuler après qu'un incrément de quota a déjà été consommé. D'où le repli
 * sur `null` et sur la liste vide en cas d'échec — le prompt sait le dire au
 * modèle.
 *
 * La contrepartie, dite franchement : une lecture de matchs en échec fait
 * basculer la routine en mode « bench seul », donc affiche un bandeau qui
 * demande au joueur de jouer des parties qu'il a peut-être déjà jouées. C'est
 * le moindre mal — l'inverse serait de citer des chiffres qu'on n'a pas pu
 * lire — et l'échec part dans les logs de la fonction.
 */
async function loadContext(
  client: UserClient,
  userId: string,
  dureeMinutes: number,
  focus: string | null,
): Promise<{
  readonly context: RoutineContext;
  readonly gate: RoutineGate;
  readonly identity: PromptIdentity;
  readonly activeBenchmark: BenchmarkId;
}> {
  // Le profil se lit **avant** le bench : il porte le benchmark actif
  // (DECISIONS.md D6), donc le barème dont la séance parle et celui dans lequel
  // les passes se lisent. La routine ne montrait jusqu'ici aucun profil ; elle
  // le lit désormais pour ces deux préférences, et pour rien d'autre.
  const profile = await loadProfile(client, userId);
  const identity = identityOf(profile);
  const { activeBenchmark } = preferencesOf(profile);
  const [bench, debriefs, matches] = await Promise.all([
    loadBenchTiers(client, userId, activeBenchmark),
    loadDebriefs(client, userId),
    loadMatches(client),
  ]);
  // Le catalogue suit la passe la plus récente : c'est le palier que la séance
  // vise, même quand les paliers d'avant sont terminés et restent affichés.
  const catalog = scenarioCatalog(bench.latestTier ?? defaultTierFor(activeBenchmark));
  const gate = gateRoutine(matches);
  // Sous le seuil, le modèle ne voit **aucune** statistique de partie : c'est
  // ce qui rend le mode « bench seul » vrai plutôt que déclaratif.
  const ingame = gate.mode === "full" ? summarizeIngameForRoutine(matches) : null;

  return {
    context: { dureeMinutes, focus, bench, debriefs, ingame, scenarios: catalog.groups },
    gate,
    identity,
    activeBenchmark,
  };
}

/**
 * Les parties importées du compte Riot principal, lues sous RLS.
 *
 * Même chemin que `api/valorant/stats` — compte principal, tri du plus récent
 * au plus ancien, plafond, revalidation ligne à ligne — parce que ce sont les
 * mêmes données, et qu'une routine qui compterait ses matchs autrement que le
 * tracker affiché juste à côté finirait par ne plus dire la même chose que lui.
 */
async function loadMatches(client: UserClient): Promise<readonly MatchSummary[]> {
  const account = await client
    .from("linked_accounts")
    .select("id")
    .eq("provider", "riot")
    .order("is_primary", { ascending: false })
    .order("id", { ascending: true })
    .limit(1)
    .maybeSingle();

  if (account.error !== null) {
    console.error("[routine] lecture du compte Riot principal en échec", account.error);
    return [];
  }

  const accountId = account.data?.id ?? null;

  if (accountId === null) return [];

  const rows = await client
    .from("imported_matches")
    .select("payload")
    .eq("linked_account_id", accountId)
    .order("played_at", { ascending: false, nullsFirst: false })
    .order("id", { ascending: false })
    .limit(MATCH_CAP);

  if (rows.error !== null) {
    console.error("[routine] lecture des matchs importés en échec", rows.error);
    return [];
  }

  // Une entrée hors contrat (import d'une version antérieure) est écartée
  // plutôt que de fausser une moyenne que le modèle va ensuite citer.
  return (rows.data ?? []).flatMap((row) => {
    const parsed = matchSummarySchema.safeParse(row.payload);

    return parsed.success ? [parsed.data] : [];
  });
}

/**
 * La dernière passe de **chaque** palier mesuré, résumée pour la routine.
 *
 * La lecture est celle du coach (`./_lib/coach-context.ts`) : une seule requête
 * par palier, écrite une seule fois. Seul le résumé diffère — la routine y
 * ajoute l'écart au rang suivant, qui est ce qui transforme une énergie en
 * objectif de séance.
 *
 * Une passe qui n'est rapportée par personne (lecture en échec, benchmark inconnu)
 * fait perdre un palier, pas la routine : le bench reste du contexte.
 */
async function loadBenchTiers(
  client: UserClient,
  userId: string,
  activeBenchmark: BenchmarkId,
): Promise<RoutineBenchTiers> {
  const { runs, latestTier } = await loadLatestBenchRuns(client, userId, activeBenchmark);

  return {
    tiers: runs.map((entry) => summarizeTierBenchForRoutine(entry.run, entry.scores)),
    latestTier,
  };
}

/**
 * Les axes des derniers debriefs.
 *
 * `axes` est une colonne `jsonb` : Postgres n'en garantit que la syntaxe. Elle
 * est donc revalidée ici avec le schéma du contrat du coach — un debrief dont
 * le contenu a dérivé est ignoré plutôt que recopié tel quel dans le prompt.
 */
async function loadDebriefs(
  client: UserClient,
  userId: string,
): Promise<readonly RoutineDebriefAxes[]> {
  const { data, error } = await client
    .from("debriefs")
    .select("date, focus, axes")
    .eq("user_id", userId)
    .order("date", { ascending: false })
    .order("id", { ascending: false })
    .limit(DEBRIEF_COUNT);

  if (error !== null || data === null) return [];

  return data.flatMap((row) => {
    const axes = storedAxesSchema.safeParse(row.axes);

    if (!axes.success || axes.data.length === 0) return [];
    return [{ date: new Date(row.date).toISOString(), focus: row.focus, axes: axes.data }];
  });
}

/* ------------------------------------------------------------------ */
/* Appel au modèle                                                     */
/* ------------------------------------------------------------------ */

/**
 * Le port du modèle, câblé sur l'adaptateur du fournisseur résolu (SPEC §5 ter)
 * et sur le budget de temps.
 *
 * Le budget est la raison pour laquelle le port passe le délai en paramètre
 * plutôt que de le laisser à l'adaptateur : chaque tentative reçoit ce qu'il
 * reste, plafonné. Quand il ne reste pas de quoi tenter, on lève —
 * `generateRoutine` laisse remonter, et le handler en fait une erreur rédigée
 * plutôt qu'un timeout de plateforme. Ce raisonnement vaut pour les cinq
 * fournisseurs, y compris ceux qu'on ne connaît pas.
 */
function askWith(
  config: ProviderConfig,
  identity: PromptIdentity,
  budget: ReturnType<typeof startBudget>,
  deps: AskDeps,
): AskModel {
  const ask = createAsk(
    config,
    { system: routineSystemPrompt(identity), maxTokens: MAX_TOKENS },
    deps,
  );

  return (messages) => {
    const timeout = attemptTimeout(budget.remaining(), BUDGET_CALL_CAP_MS, BUDGET_CALL_FLOOR_MS);

    if (timeout === null) {
      throw new BudgetExhaustedError("plus assez de temps pour une tentative");
    }
    // Seul le texte est retenu : une routine hors contrat passe déjà par la
    // relance corrective de `generateRoutine` — un JSON coupé ne parse pas. Le
    // drapeau de troncature ne compte que là où la sortie est écrite en base
    // pour toujours (`api/_lib/match-analysis.ts`).
    return ask(messages, timeout).then((answer) => answer.text);
  };
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
    console.error("[routine] réglages IA illisibles", cause);
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
  //    toutes les deux sur la dernière routine disponible.
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
      p_kind: "routine",
    });

    if (usage.error !== null) {
      return fail("Le compteur de quota est indisponible. Réessaie dans un instant.", 503);
    }

    const count = usageCountSchema.safeParse(usage.data);

    if (!count.success) {
      return fail("Le compteur de quota a renvoyé une valeur inattendue.", 503);
    }

    const limit = platform.limits.routineDaily;
    const quota = evaluateQuota(count.data, limit);

    if (!quota.allowed) {
      return json(
        {
          error: `Quota atteint : ${limit} routines par jour. Le compteur repart demain (heure UTC).`,
          remaining: quota.remaining,
        },
        429,
      );
    }
    remaining = quota.remaining;
    refund = createQuotaRefund(
      quota.remaining,
      limit,
      refundAiUsageWith(service, user.id, "routine"),
    );
  }

  // 6. Contexte (bench, debriefs, parties récentes → mode) puis génération.
  const { context, gate, identity, activeBenchmark } = await loadContext(
    userClient,
    user.id,
    body.dureeMinutes,
    body.focus,
  );
  const allowed = scenarioCatalog(
    context.bench.latestTier ?? defaultTierFor(activeBenchmark),
  ).names;
  const budget = startBudget(BUDGET_TOTAL_MS);

  let generated: Awaited<ReturnType<typeof generateRoutine>>;

  try {
    generated = await generateRoutine(
      // La réécriture des jetons ne concerne que la liaison ChatGPT ; les
      // adaptateurs à clé l'ignorent. La passer sans condition évite d'avoir à
      // se rappeler quel fournisseur en a besoin.
      askWith(config, identity, budget, { persist: persistChatGptTokensWith(service, user.id) }),
      context,
      allowed,
    );
  } catch (cause) {
    // Le détail (clé, en-têtes, corps de requête) ne remonte jamais au client :
    // il part dans les logs de la fonction, où il est utile et confiné.
    console.error("[routine] appel au modèle en échec", cause);
    // Aucune routine produite : l'incrément n'a plus de contrepartie, on le
    // rend. Le remboursement ne lève pas et ne change pas le code de retour —
    // c'est l'erreur d'origine qui explique l'échec, pas l'état du compteur.
    // Le renoncement au budget en fait partie : le temps manquant est le nôtre.
    remaining = await refundQuota(refund, remaining);
    if (cause instanceof BudgetExhaustedError) {
      return failWithQuota(
        "La génération a pris trop de temps. Réessaie : c'est en général plus rapide.",
        504,
        remaining,
      );
    }
    if (cause instanceof ModelError) {
      // La rédaction dit **à qui appartient le problème** : une clé personnelle
      // refusée n'est pas une panne d'AimForge, et l'utilisateur est le seul à
      // pouvoir la corriger.
      return failWithQuota(modelErrorMessage(cause, "routine"), modelErrorStatus(cause), remaining);
    }
    return failWithQuota(
      "La génération est injoignable pour le moment. Réessaie dans un instant.",
      502,
      remaining,
    );
  }

  if (!generated.ok) {
    console.error(`[routine] sortie hors contrat après ${generated.attempts} tentatives`, {
      reason: generated.reason,
    });
    remaining = await refundQuota(refund, remaining);
    return failWithQuota(
      "La routine rendue n'était pas exploitable, même après relance. Réessaie dans un instant.",
      502,
      remaining,
    );
  }

  // 7. Persistance, avec le JWT de l'utilisateur : c'est la RLS qui autorise
  //    l'insertion, pas la fonction.
  //
  //    L'ancrage (mode, parties comptées, sources vérifiées) part dans la même
  //    colonne `jsonb` que le contenu : c'est ce qui permet à l'historique de
  //    réafficher le bandeau et les sources d'une routine d'hier sans migration
  //    ni seconde lecture. Le contrat les déclare facultatifs, donc les
  //    routines écrites avant V5 se relisent toujours (`routine-contract.ts`).
  const contenu = {
    ...generated.routine,
    mode: gate.mode,
    matchesUsed: gate.matchesUsed,
    // Copie mutable : `contenu` part en `jsonb`, dont le type généré n'accepte
    // pas un tableau en lecture seule.
    sources: [...generated.sources],
  };
  const { data: row, error: insertError } = await userClient
    .from("routines")
    .insert({
      user_id: user.id,
      duree_minutes: body.dureeMinutes,
      focus: body.focus,
      contenu,
      done: false,
    })
    .select("id, date, done")
    .single();

  if (insertError !== null || row === null) {
    console.error("[routine] enregistrement de la routine en échec", insertError);
    // Générée mais pas enregistrée : l'utilisateur n'a rien, donc la règle du
    // remboursement s'applique ici comme sur une panne du modèle. Le jeton
    // dépensé chez le fournisseur, lui, est perdu — c'est notre affaire, pas
    // celle de son quota.
    remaining = await refundQuota(refund, remaining);
    return failWithQuota(
      "La routine a été générée mais n'a pas pu être enregistrée. Ton quota n'a pas été décompté : réessaie.",
      500,
      remaining,
    );
  }

  const stored: StoredRoutine = {
    ...contenu,
    id: row.id,
    date: new Date(row.date).toISOString(),
    duree_minutes: body.dureeMinutes,
    focus: body.focus,
    done: row.done,
  };

  return json({ routine: stored, remaining }, 200);
}
