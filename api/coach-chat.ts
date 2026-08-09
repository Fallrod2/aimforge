/**
 * `POST /api/coach-chat` — la conversation sous un debrief (SPEC §5 ter bis).
 *
 * Même machinerie que `api/coach.ts`, et c'est voulu : mêmes deux clients
 * Supabase (celui de l'appelant pour les données, celui de service pour ce
 * qu'aucune policy ne peut autoriser), même résolution de fournisseur, même
 * quota incrémenté avant l'appel et remboursé quand rien n'est persisté. Ce qui
 * change tient en trois points :
 *
 * 1. **la sortie est du texte libre**, pas un objet JSON. Il n'y a donc pas de
 *    contrat de forme à faire respecter — mais la **police des scénarios**, elle,
 *    s'applique à l'identique : un nom inventé déclenche une relance, puis un
 *    502 si la relance échoue à son tour. Livrer une réponse amputée de ses noms
 *    fautifs donnerait un conseil silencieusement faux (voir
 *    `src/server/coach/chat.ts`) ;
 * 2. **le quota est le sien** (`chat`, 20 par jour UTC, migration 0011). Un
 *    message de chat coûte bien moins cher qu'un debrief, et une conversation
 *    qui s'arrête au troisième aller-retour ne sert à rien ;
 * 3. **rien n'est persisté sur un échec**, le message de l'utilisateur compris.
 *    Une conversation trouée — une question sans réponse — se relirait comme un
 *    tour que le coach aurait ignoré, et repartirait au modèle au tour suivant
 *    dans cet état. Les deux messages sont donc insérés ensemble, après coup.
 *
 * L'ordre des contrôles est celui du reste du projet, et chaque marche a sa
 * raison : identité (401) avant tout, parce qu'un appel anonyme n'apprend rien ;
 * validation (400) ensuite ; **appartenance du debrief (404) avant la
 * configuration**, pour qu'un identifiant qui n'est pas à l'appelant ne
 * renseigne pas non plus sur l'état du service ; configuration (503) ; quota
 * (429) en dernier, parce que c'est la seule marche qui coûte quelque chose.
 *
 * La signature est **`export async function POST(request: Request)`**, et pas
 * un export par défaut : c'est la seule forme que le runtime Node de Vercel
 * reconnaît comme un gestionnaire web.
 */

import { z } from "zod";
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
import { generateChatAnswer } from "../src/server/coach/chat.js";
import {
  type ChatContext,
  type ChatDebrief,
  type ChatTurn,
  COACH_CHAT_SYSTEM_PROMPT,
} from "../src/server/coach/chat-prompt.js";
import type { AskModel } from "../src/server/coach/generate.js";
import {
  createQuotaRefund,
  evaluateQuota,
  type QuotaRefund,
  refundQuota,
} from "../src/server/coach/quota.js";
import { GLOBAL_CAP_REACHED, globalCapReached } from "../src/server/platform/settings.js";
import { scenarioCatalog } from "../src/server/shared/scenarios.js";
import {
  CHAT_DAILY_QUOTA,
  CHAT_HISTORY_SIZE,
  type ChatMessage,
  chatRequestSchema,
  chatRoleSchema,
} from "../src/shared/coach-chat-contract.js";
import { coachDebriefSchema } from "../src/shared/coach-contract.js";
import { loadAiSettingsWith, persistChatGptTokensWith } from "./_lib/ai-settings.js";
import { refundAiUsageWith } from "./_lib/ai-usage.js";
import {
  type CoachUserClient,
  DEFAULT_TIER,
  loadBench,
  loadProfile,
} from "./_lib/coach-context.js";
import { loadPlatformSettings, platformAiUsageToday } from "./_lib/platform-settings.js";
import { authenticate, fail, json, readBody } from "./_lib/request.js";
import { serviceClient } from "./_lib/service.js";

/**
 * Un tour de chat est un aller-retour court, pas une génération complète : deux
 * tentatives de 25 s tiennent largement sous cette borne, relance corrective
 * comprise.
 */
export const maxDuration = 60;

/** Une réponse de coach fait quelques paragraphes ; le prompt vise 200 mots. */
const MAX_TOKENS = 800;

/** Marge sous `maxDuration` : deux tentatives possibles, et un 502 propre. */
const MODEL_TIMEOUT_MS = 25_000;

const usageCountSchema = z.number().int().min(0);

const DEBRIEF_NOT_FOUND =
  "Ce debrief est introuvable : il a peut-être été supprimé. Recharge la page.";

const DEBRIEF_UNREADABLE =
  "Ce debrief ne correspond plus au format attendu : le coach ne peut pas en discuter.";

const INVALID_MESSAGE = "Écris ta question au coach (2 000 caractères au maximum).";

/** Un échec, avec le quota du jour quand il y a quelque chose à annoncer. */
function failWithQuota(error: string, status: number, remaining: number | null): Response {
  return remaining === null ? fail(error, status) : json({ error, remaining }, status);
}

/* ------------------------------------------------------------------ */
/* Le debrief dont on discute                                          */
/* ------------------------------------------------------------------ */

type DebriefLookup =
  | { readonly ok: true; readonly debrief: ChatDebrief }
  | { readonly ok: false; readonly response: Response };

/**
 * Le debrief, lu **sous la RLS de l'appelant**.
 *
 * Le client utilisateur n'est pas une commodité ici, c'est le contrôle d'accès :
 * le debrief de quelqu'un d'autre n'est pas « refusé », il est **invisible** —
 * donc indiscernable d'un debrief supprimé, et c'est exactement la réponse
 * qu'on veut donner (404 dans les deux cas, sans dire lequel).
 *
 * `points_forts` et `axes` sont des colonnes `jsonb` : Postgres n'en garantit
 * que la syntaxe. Elles sont revalidées avec le schéma qui les a écrites — un
 * debrief dérivé ne part pas au modèle en morceaux, il est refusé (422) et le
 * dit.
 */
async function loadDebrief(
  client: CoachUserClient,
  userId: string,
  debriefId: number,
): Promise<DebriefLookup> {
  const { data, error } = await client
    .from("debriefs")
    .select("id, date, resume, points_forts, axes, focus")
    .eq("user_id", userId)
    .eq("id", debriefId)
    .maybeSingle();

  if (error !== null) {
    console.error("[coach-chat] lecture du debrief en échec", error);
    return {
      ok: false,
      response: fail("Ton debrief n'a pas pu être lu. Réessaie dans un instant.", 503),
    };
  }
  if (data === null) return { ok: false, response: fail(DEBRIEF_NOT_FOUND, 404) };

  const parsed = coachDebriefSchema.safeParse({
    resume: data.resume,
    points_forts: data.points_forts,
    axes: data.axes,
    focus: data.focus,
  });

  if (!parsed.success) {
    console.error("[coach-chat] debrief hors contrat", { debriefId });
    return { ok: false, response: fail(DEBRIEF_UNREADABLE, 422) };
  }
  return { ok: true, debrief: { ...parsed.data, date: new Date(data.date).toISOString() } };
}

/**
 * Les derniers messages de la conversation, du plus ancien au plus récent.
 *
 * Lus en ordre **décroissant** puis retournés : c'est la fin de la conversation
 * qui compte, et un `limit` sur un tri croissant rendrait le début. Une lecture
 * en échec rend une liste vide plutôt que d'annuler la requête — le fil perd son
 * contexte, l'utilisateur garde sa réponse.
 */
async function loadHistory(
  client: CoachUserClient,
  debriefId: number,
): Promise<readonly ChatTurn[]> {
  const { data, error } = await client
    .from("coach_messages")
    .select("role, content")
    .eq("debrief_id", debriefId)
    .order("id", { ascending: false })
    .limit(CHAT_HISTORY_SIZE);

  if (error !== null || data === null) {
    if (error !== null) console.error("[coach-chat] lecture de la conversation en échec", error);
    return [];
  }

  const turns: ChatTurn[] = [];

  for (const row of data) {
    const role = chatRoleSchema.safeParse(row.role);

    // Un rôle hors des deux valeurs attendues ne peut pas exister (contrainte
    // `check` de la migration 0011) ; s'il existait, l'ignorer vaut mieux que
    // le donner au modèle sans savoir qui parle.
    if (role.success) turns.push({ role: role.data, content: row.content });
  }
  return turns.reverse();
}

/* ------------------------------------------------------------------ */
/* Appel au modèle                                                     */
/* ------------------------------------------------------------------ */

function askWith(config: ProviderConfig, deps: AskDeps): AskModel {
  const ask = createAsk(config, { system: COACH_CHAT_SYSTEM_PROMPT, maxTokens: MAX_TOKENS }, deps);

  return (messages) => ask(messages, MODEL_TIMEOUT_MS);
}

/* ------------------------------------------------------------------ */
/* Handler                                                             */
/* ------------------------------------------------------------------ */

export async function POST(request: Request): Promise<Response> {
  // 1. Identité.
  const auth = await authenticate(request);

  if (!auth.ok) return auth.response;

  const userClient = auth.client;
  const userId = auth.userId;

  // 2. Entrée.
  const body = await readBody(request, chatRequestSchema, INVALID_MESSAGE);

  if (!body.ok) return body.response;

  const debriefId = body.value.debrief_id;
  const question = body.value.message;

  // 3. Le debrief est-il le sien ? Avant la configuration : un identifiant qui
  //    n'est pas à l'appelant ne doit rien apprendre de l'état du service.
  const found = await loadDebrief(userClient, userId, debriefId);

  if (!found.ok) return found.response;

  // 4. Configuration. La service key est requise dans tous les cas : elle seule
  //    peut lire la clé du fournisseur personnel (migration 0008) et celle de
  //    la plateforme (migration 0009).
  const service = serviceClient();

  if (service === null) return fail("IA non configurée", 503);

  const platform = await loadPlatformSettings(service);

  // 5. Quel fournisseur, et qui paie.
  let resolution: Awaited<ReturnType<typeof resolveModelFor>>;

  try {
    resolution = await resolveModelFor(loadAiSettingsWith(service), userId, platform.ai);
  } catch (cause) {
    console.error("[coach-chat] réglages IA illisibles", cause);
    if (cause instanceof AiSettingsUnavailableError) {
      return fail("Tes réglages IA n'ont pas pu être lus. Réessaie dans un instant.", 503);
    }
    throw cause;
  }

  if (!resolution.ok) return fail(resolution.reason, resolution.status);

  const config = resolution.config;

  // 6. Quota du chat, incrémenté avant l'appel — et seulement sur la clé de la
  //    plateforme. Une configuration personnelle n'incrémente rien, il n'y a
  //    donc rien à lui rembourser.
  let remaining: number | null = null;
  let refund: QuotaRefund | null = null;

  if (config.source === "platform") {
    const usedToday = await platformAiUsageToday(service);

    if (usedToday !== null && globalCapReached(usedToday, platform.aiGlobalDailyLimit)) {
      return json({ error: GLOBAL_CAP_REACHED, remaining: 0 }, 429);
    }

    const usage = await service.rpc("increment_ai_usage", { p_user_id: userId, p_kind: "chat" });

    if (usage.error !== null) {
      return fail("Le compteur de quota est indisponible. Réessaie dans un instant.", 503);
    }

    const count = usageCountSchema.safeParse(usage.data);

    if (!count.success) {
      return fail("Le compteur de quota a renvoyé une valeur inattendue.", 503);
    }

    const quota = evaluateQuota(count.data, CHAT_DAILY_QUOTA);

    if (!quota.allowed) {
      return json(
        {
          error: `Quota atteint : ${CHAT_DAILY_QUOTA} messages par jour. Le compteur repart demain (heure UTC).`,
          remaining: quota.remaining,
        },
        429,
      );
    }
    remaining = quota.remaining;
    refund = createQuotaRefund(
      quota.remaining,
      CHAT_DAILY_QUOTA,
      refundAiUsageWith(service, userId, "chat"),
    );
  }

  // 7. Contexte puis génération. Le profil, le bench et l'historique sont du
  //    contexte : une lecture en échec dégrade la réponse, elle ne l'annule pas.
  const [profile, bench, history] = await Promise.all([
    loadProfile(userClient, userId),
    loadBench(userClient, userId),
    loadHistory(userClient, debriefId),
  ]);
  const context: ChatContext = {
    debrief: found.debrief,
    profile,
    bench,
    scenarios: scenarioCatalog(bench?.tier ?? DEFAULT_TIER).groups,
    history,
    question,
  };

  let generated: Awaited<ReturnType<typeof generateChatAnswer>>;

  try {
    generated = await generateChatAnswer(
      askWith(config, { persist: persistChatGptTokensWith(service, userId) }),
      context,
    );
  } catch (cause) {
    console.error("[coach-chat] appel au modèle en échec", cause);
    remaining = await refundQuota(refund, remaining);
    if (cause instanceof ModelError) {
      return failWithQuota(modelErrorMessage(cause, "coach"), modelErrorStatus(cause), remaining);
    }
    return failWithQuota(
      "Le coach est injoignable pour le moment. Réessaie dans un instant.",
      502,
      remaining,
    );
  }

  if (!generated.ok) {
    console.error(`[coach-chat] sortie hors contrat après ${generated.attempts} tentatives`, {
      reason: generated.reason,
    });
    remaining = await refundQuota(refund, remaining);
    return failWithQuota(
      "Le coach n'a pas rendu une réponse exploitable, même après relance. Réessaie dans un instant.",
      502,
      remaining,
    );
  }

  // 8. Persistance des **deux** messages, en une seule instruction et avec le
  //    JWT de l'utilisateur : c'est la RLS qui autorise l'insertion (et qui
  //    vérifie au passage que le debrief lui appartient), pas la fonction.
  const { data: rows, error: insertError } = await userClient
    .from("coach_messages")
    .insert([
      { user_id: userId, debrief_id: debriefId, role: "user", content: question },
      { user_id: userId, debrief_id: debriefId, role: "coach", content: generated.answer },
    ])
    .select("id, debrief_id, role, content, created_at");

  const stored = toMessages(rows);

  if (insertError !== null || stored === null) {
    console.error("[coach-chat] enregistrement de la conversation en échec", insertError);
    // Généré mais pas enregistré : l'utilisateur n'a rien, donc on rembourse.
    // Le jeton dépensé chez le fournisseur est perdu — c'est notre affaire.
    remaining = await refundQuota(refund, remaining);
    return failWithQuota(
      "La réponse du coach n'a pas pu être enregistrée. Ton quota n'a pas été décompté : réessaie.",
      500,
      remaining,
    );
  }

  return json({ question: stored.question, answer: stored.answer, remaining }, 200);
}

/** La forme d'une ligne relue juste après l'insertion. */
interface MessageRow {
  readonly id: number;
  readonly debrief_id: number;
  readonly role: string;
  readonly content: string;
  readonly created_at: string;
}

/**
 * Les deux messages enregistrés, retrouvés **par leur rôle** et non par leur
 * position : l'ordre de retour d'un `insert` multi-lignes n'est pas un contrat
 * qu'on a envie de tenir pour acquis.
 */
function toMessages(
  rows: readonly MessageRow[] | null,
): { readonly question: ChatMessage; readonly answer: ChatMessage } | null {
  const question = rows?.find((row) => row.role === "user") ?? null;
  const answer = rows?.find((row) => row.role === "coach") ?? null;

  if (question === null || answer === null) return null;
  return { question: toMessage(question, "user"), answer: toMessage(answer, "coach") };
}

function toMessage(row: MessageRow, role: ChatMessage["role"]): ChatMessage {
  return {
    id: row.id,
    debriefId: row.debrief_id,
    role,
    content: row.content,
    createdAt: new Date(row.created_at).toISOString(),
  };
}
