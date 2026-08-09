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
 *   une chose : incrémenter le compteur de quota, qu'aucune policy n'autorise
 *   à écrire. C'est le seul endroit du projet où la service key est utilisée.
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
import { summarizeBench } from "../src/server/coach/bench.js";
import { type AskModel, generateDebrief } from "../src/server/coach/generate.js";
import { COACH_SYSTEM_PROMPT, type CoachContext } from "../src/server/coach/prompt.js";
import { evaluateQuota } from "../src/server/coach/quota.js";
import {
  coachRequestSchema,
  MAX_STATS_LENGTH,
  type StoredDebrief,
} from "../src/shared/coach-contract.js";
import { SUPABASE_PUBLISHABLE_KEY, SUPABASE_URL } from "../src/shared/supabase-config.js";
import { loadAiSettingsWith } from "./_lib/ai-settings.js";

/**
 * Un debrief demande une génération complète, pas un aller-retour de chat :
 * 60 s couvre le cas lent (relance corrective comprise) sans laisser une
 * requête bloquée pendre indéfiniment.
 */
export const maxDuration = 60;

/** Assez pour un debrief structuré ; le contrat borne déjà les longueurs. */
const MAX_TOKENS = 2000;

/** Marge sous `maxDuration` : mieux vaut un 502 propre qu'un timeout de plateforme. */
const MODEL_TIMEOUT_MS = 45_000;

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

/* ------------------------------------------------------------------ */
/* Entrée                                                              */
/* ------------------------------------------------------------------ */

type BodyResult =
  | { readonly ok: true; readonly stats: string }
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
    return { ok: false, response: fail("Colle d'abord les stats de ta partie.", 400) };
  }
  return { ok: true, stats: parsed.data.stats };
}

/* ------------------------------------------------------------------ */
/* Contexte : profil et dernier bench, lus sous RLS                    */
/* ------------------------------------------------------------------ */

type UserClient = ReturnType<typeof createClient<Database>>;

function toTierId(value: string): TierId | null {
  return TIER_IDS.find((id) => id === value) ?? null;
}

/**
 * Le profil et le dernier bench sont du **contexte**, pas des prérequis : une
 * lecture qui échoue dégrade le debrief, elle ne doit pas l'annuler après
 * qu'un incrément de quota a déjà été consommé. D'où le `null` en cas d'échec.
 */
async function loadContext(
  client: UserClient,
  userId: string,
  stats: string,
): Promise<CoachContext> {
  const [profile, bench] = await Promise.all([
    loadProfile(client, userId),
    loadBench(client, userId),
  ]);

  return { stats, profile, bench };
}

async function loadProfile(client: UserClient, userId: string): Promise<CoachContext["profile"]> {
  const { data, error } = await client
    .from("profiles")
    .select("pseudo, rang_valorant, peak, main_agent, objectif, notes_maps")
    .eq("user_id", userId)
    .maybeSingle();

  if (error !== null || data === null) return null;
  return {
    pseudo: data.pseudo,
    rangValorant: data.rang_valorant,
    peak: data.peak,
    mainAgent: data.main_agent,
    objectif: data.objectif,
    notesMaps: data.notes_maps,
  };
}

async function loadBench(client: UserClient, userId: string): Promise<CoachContext["bench"]> {
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

  return summarizeBench(
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

/* ------------------------------------------------------------------ */
/* Appel au modèle                                                     */
/* ------------------------------------------------------------------ */

/**
 * Le port du modèle, câblé sur l'adaptateur du fournisseur résolu (SPEC §5 ter).
 *
 * Le port n'a pas changé — c'est ce qui rend ce branchement minuscule. Ce qui
 * a changé est en amont : `createAsk` rend l'adaptateur du fournisseur de
 * l'utilisateur (ou celui de la plateforme), et toute la logique de génération
 * (relance corrective comprise) reste dans `generateDebrief`, qui ne sait
 * toujours pas qui répond au bout du fil.
 */
function askWith(config: ProviderConfig): AskModel {
  const ask = createAsk(config, { system: COACH_SYSTEM_PROMPT, maxTokens: MAX_TOKENS });

  return (messages) => ask(messages, MODEL_TIMEOUT_MS);
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
  let remaining: number | null = null;

  if (config.source === "platform") {
    // Le RPC n'est pas encore décrit par `database-types.ts` (régénéré depuis la
    // base, migration 0003 comprise, à la prochaine génération) : le client de
    // service reste non typé et le retour est validé ici, à la frontière.
    const usage = await serviceClient.rpc("increment_ai_usage", {
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

    const quota = evaluateQuota(count.data);

    if (!quota.allowed) {
      return json(
        {
          error: "Quota atteint : 5 debriefs par jour. Le compteur repart demain (heure UTC).",
          remaining: quota.remaining,
        },
        429,
      );
    }
    remaining = quota.remaining;
  }

  // 6. Contexte puis génération.
  const context = await loadContext(userClient, user.id, body.stats);

  let generated: Awaited<ReturnType<typeof generateDebrief>>;

  try {
    generated = await generateDebrief(askWith(config), context);
  } catch (cause) {
    // Le détail (clé, en-têtes, corps de requête) ne remonte jamais au client :
    // il part dans les logs de la fonction, où il est utile et confiné.
    console.error("[coach] appel au modèle en échec", cause);
    if (cause instanceof ModelError) {
      // La rédaction dit **à qui appartient le problème** : une clé personnelle
      // refusée n'est pas une panne d'AimForge, et l'utilisateur est le seul à
      // pouvoir la corriger.
      return fail(modelErrorMessage(cause, "coach"), modelErrorStatus(cause));
    }
    return fail("Le coach est injoignable pour le moment. Réessaie dans un instant.", 502);
  }

  if (!generated.ok) {
    console.error(`[coach] sortie hors contrat après ${generated.attempts} tentatives`, {
      reason: generated.reason,
    });
    return fail(
      "Le coach n'a pas rendu un debrief exploitable, même après relance. Réessaie dans un instant.",
      502,
    );
  }

  // 7. Persistance, avec le JWT de l'utilisateur : c'est la RLS qui autorise
  //    l'insertion, pas la fonction.
  const { data: row, error: insertError } = await userClient
    .from("debriefs")
    .insert({
      user_id: user.id,
      input_raw: body.stats,
      resume: generated.debrief.resume,
      points_forts: generated.debrief.points_forts,
      axes: generated.debrief.axes,
      focus: generated.debrief.focus,
    })
    .select("id, date")
    .single();

  if (insertError !== null || row === null) {
    console.error("[coach] enregistrement du debrief en échec", insertError);
    return fail(
      "Le debrief a été généré mais n'a pas pu être enregistré. Ton quota a été consommé : réessaie une fois.",
      500,
    );
  }

  const stored: StoredDebrief = {
    ...generated.debrief,
    id: row.id,
    date: new Date(row.date).toISOString(),
  };

  return json({ debrief: stored, remaining }, 200);
}
