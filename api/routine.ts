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
 */

import { createClient } from "@supabase/supabase-js";
import { z } from "zod";
// Le schéma généré depuis la base : il décrit les tables, donc il vaut pour
// les deux côtés. Import de type uniquement — rien n'en sort à l'exécution.
import type { Database } from "../src/client/supabase/database-types.js";
import { TIER_IDS, type TierId } from "../src/lib/energy/index.js";
import {
  AiSettingsUnavailableError,
  createAsk,
  ModelError,
  modelErrorMessage,
  modelErrorStatus,
  type ProviderConfig,
  resolveModelFor,
} from "../src/server/ai/index.js";
import { evaluateQuota } from "../src/server/coach/quota.js";
import { attemptTimeout, startBudget } from "../src/server/kovaaks/budget.js";
import { type RoutineBenchSummary, summarizeBenchForRoutine } from "../src/server/routine/bench.js";
import { type AskModel, generateRoutine } from "../src/server/routine/generate.js";
import {
  ROUTINE_SYSTEM_PROMPT,
  type RoutineContext,
  type RoutineDebriefAxes,
} from "../src/server/routine/prompt.js";
import { scenarioCatalog } from "../src/server/routine/scenarios.js";
import { coachAxeSchema } from "../src/shared/coach-contract.js";
import {
  ROUTINE_DAILY_QUOTA,
  routineRequestSchema,
  type StoredRoutine,
} from "../src/shared/routine-contract.js";
import { SUPABASE_PUBLISHABLE_KEY, SUPABASE_URL } from "../src/shared/supabase-config.js";
import { loadAiSettingsWith } from "./_lib/ai-settings.js";

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

/** Palier retenu quand le joueur n'a aucune passe : le premier du benchmark. */
const DEFAULT_TIER: TierId = "novice";

/** Nombre de debriefs relus pour en tirer les axes (AIMFORGE_KICKOFF §3). */
const DEBRIEF_COUNT = 3;

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
/* Contexte : dernier bench et derniers debriefs, lus sous RLS          */
/* ------------------------------------------------------------------ */

type UserClient = ReturnType<typeof createClient<Database>>;

function toTierId(value: string): TierId | null {
  return TIER_IDS.find((id) => id === value) ?? null;
}

/**
 * Le bench et les debriefs sont du **contexte**, pas des prérequis : une
 * lecture qui échoue dégrade la routine, elle ne doit pas l'annuler après
 * qu'un incrément de quota a déjà été consommé. D'où le repli sur `null` et
 * sur la liste vide en cas d'échec — le prompt sait le dire au modèle.
 */
async function loadContext(
  client: UserClient,
  userId: string,
  dureeMinutes: number,
  focus: string | null,
): Promise<RoutineContext> {
  const [bench, debriefs] = await Promise.all([
    loadBench(client, userId),
    loadDebriefs(client, userId),
  ]);
  const catalog = scenarioCatalog(bench?.tier ?? DEFAULT_TIER);

  return { dureeMinutes, focus, bench, debriefs, scenarios: catalog.groups };
}

async function loadBench(client: UserClient, userId: string): Promise<RoutineBenchSummary | null> {
  const { data: run, error } = await client
    .from("bench_runs")
    .select("id, date, tier, overall, rank, complete")
    .eq("user_id", userId)
    .order("date", { ascending: false })
    .order("id", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error !== null || run === null) return null;

  const tier = toTierId(run.tier);

  if (tier === null) return null;

  const { data: scores } = await client
    .from("scenario_scores")
    .select("scenario, score")
    .eq("run_id", run.id);

  return summarizeBenchForRoutine(
    {
      tier,
      date: run.date,
      overall: run.overall,
      rank: run.rank,
      complete: run.complete,
    },
    scores ?? [],
  );
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
function askWith(config: ProviderConfig, budget: ReturnType<typeof startBudget>): AskModel {
  const ask = createAsk(config, { system: ROUTINE_SYSTEM_PROMPT, maxTokens: MAX_TOKENS });

  return (messages) => {
    const timeout = attemptTimeout(budget.remaining(), BUDGET_CALL_CAP_MS, BUDGET_CALL_FLOOR_MS);

    if (timeout === null) {
      throw new BudgetExhaustedError("plus assez de temps pour une tentative");
    }
    return ask(messages, timeout);
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
  //    l'utilisateur (privilèges de colonne, migration 0008). La clé Anthropic
  //    de la plateforme, elle, n'est plus obligatoire — un utilisateur qui a
  //    posé la sienne n'en dépend plus (SPEC §5 ter).
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";

  if (serviceKey === "") {
    return fail("IA non configurée", 503);
  }

  const serviceClient = createClient(SUPABASE_URL, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });

  // 4. Quel fournisseur, et qui paie. C'est la seule bascule de SPEC §5 ter :
  //    configuration personnelle ⇒ le compteur de quota n'est pas appelé.
  let resolution: Awaited<ReturnType<typeof resolveModelFor>>;

  try {
    resolution = await resolveModelFor(
      loadAiSettingsWith(serviceClient),
      user.id,
      process.env.ANTHROPIC_API_KEY ?? "",
    );
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
  let remaining: number | null = null;

  if (config.source === "platform") {
    // Le RPC n'est pas encore décrit par `database-types.ts` (régénéré depuis la
    // base, migration 0003 comprise, à la prochaine génération) : le client de
    // service reste non typé et le retour est validé ici, à la frontière.
    const usage = await serviceClient.rpc("increment_ai_usage", {
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

    const quota = evaluateQuota(count.data, ROUTINE_DAILY_QUOTA);

    if (!quota.allowed) {
      return json(
        {
          error: `Quota atteint : ${ROUTINE_DAILY_QUOTA} routines par jour. Le compteur repart demain (heure UTC).`,
          remaining: quota.remaining,
        },
        429,
      );
    }
    remaining = quota.remaining;
  }

  // 6. Contexte puis génération.
  const context = await loadContext(userClient, user.id, body.dureeMinutes, body.focus);
  const allowed = scenarioCatalog(context.bench?.tier ?? DEFAULT_TIER).names;
  const budget = startBudget(BUDGET_TOTAL_MS);

  let generated: Awaited<ReturnType<typeof generateRoutine>>;

  try {
    generated = await generateRoutine(askWith(config, budget), context, allowed);
  } catch (cause) {
    // Le détail (clé, en-têtes, corps de requête) ne remonte jamais au client :
    // il part dans les logs de la fonction, où il est utile et confiné.
    console.error("[routine] appel au modèle en échec", cause);
    if (cause instanceof BudgetExhaustedError) {
      return fail(
        "La génération a pris trop de temps. Réessaie : c'est en général plus rapide.",
        504,
      );
    }
    if (cause instanceof ModelError) {
      // La rédaction dit **à qui appartient le problème** : une clé personnelle
      // refusée n'est pas une panne d'AimForge, et l'utilisateur est le seul à
      // pouvoir la corriger.
      return fail(modelErrorMessage(cause, "routine"), modelErrorStatus(cause));
    }
    return fail("La génération est injoignable pour le moment. Réessaie dans un instant.", 502);
  }

  if (!generated.ok) {
    console.error(`[routine] sortie hors contrat après ${generated.attempts} tentatives`, {
      reason: generated.reason,
    });
    return fail(
      "La routine rendue n'était pas exploitable, même après relance. Réessaie dans un instant.",
      502,
    );
  }

  // 7. Persistance, avec le JWT de l'utilisateur : c'est la RLS qui autorise
  //    l'insertion, pas la fonction.
  const { data: row, error: insertError } = await userClient
    .from("routines")
    .insert({
      user_id: user.id,
      duree_minutes: body.dureeMinutes,
      focus: body.focus,
      contenu: generated.routine,
      done: false,
    })
    .select("id, date, done")
    .single();

  if (insertError !== null || row === null) {
    console.error("[routine] enregistrement de la routine en échec", insertError);
    return fail(
      "La routine a été générée mais n'a pas pu être enregistrée. Ton quota a été consommé : réessaie une fois.",
      500,
    );
  }

  const stored: StoredRoutine = {
    ...generated.routine,
    id: row.id,
    date: new Date(row.date).toISOString(),
    duree_minutes: body.dureeMinutes,
    focus: body.focus,
    done: row.done,
  };

  return json({ routine: stored, remaining }, 200);
}
