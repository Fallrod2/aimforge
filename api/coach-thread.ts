/**
 * `POST /api/coach-thread` — le fil du coach (SPEC §5 sexies, V3).
 *
 * L'onglet Coach n'est plus une liste de debriefs mais **une** conversation
 * continue, et cette fonction en est le seul chemin d'écriture. Elle reprend la
 * machinerie de `api/coach-chat.ts` — mêmes deux clients Supabase, même
 * résolution de fournisseur, même quota `chat` incrémenté avant l'appel et
 * remboursé quand rien n'est persisté — avec trois différences :
 *
 * 1. **il n'y a pas de sujet extérieur**, donc pas de 404 à rendre : le corps
 *    ne porte qu'un message. L'ordre des contrôles est celui du reste du
 *    projet, débarrassé de sa marche « appartenance » : identité (401) avant
 *    tout, validation (400) ensuite, configuration (503), puis le quota (429)
 *    en dernier — c'est la seule marche qui coûte quelque chose ;
 * 2. **le contexte est plus large** : profil, dernier bench (du benchmark de la
 *    passe), derniers matchs importés, derniers debriefs, derniers messages du
 *    fil. Tout est scellé, tout est du contexte — une lecture en échec dégrade
 *    la réponse, elle ne l'annule pas ;
 * 3. **le modèle peut proposer un debrief**, et la fonction **ne le génère
 *    pas**. Il pose un marqueur convenu
 *    (`DEBRIEF_SUGGESTION_MARKER`, documenté dans le contrat) ; la fonction le
 *    retire du texte, choisit elle-même le match visé — le dernier importé non
 *    débriefé — et rend la suggestion. Le client affiche un bouton, et c'est le
 *    clic qui dépense le quota `coach` via `api/coach`. Générer ici serait une
 *    double dépense cachée, décidée par le modèle.
 *
 * Comme pour le chat, **rien n'est persisté sur un échec**, le message de
 * l'utilisateur compris : une conversation trouée se relirait comme un tour que
 * le coach aurait ignoré, et repartirait au modèle dans cet état au tour
 * suivant. Les deux messages sont donc insérés ensemble, après coup.
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
import type { AskModel } from "../src/server/coach/generate.js";
import { identityOf, type PromptIdentity } from "../src/server/coach/prompt.js";
import {
  createQuotaRefund,
  evaluateQuota,
  type QuotaRefund,
  refundQuota,
} from "../src/server/coach/quota.js";
import { generateThreadAnswer } from "../src/server/coach/thread.js";
import { coachThreadSystemPrompt, type ThreadContext } from "../src/server/coach/thread-prompt.js";
import { GLOBAL_CAP_REACHED, globalCapReached } from "../src/server/platform/settings.js";
import { scenarioCatalog } from "../src/server/shared/scenarios.js";
import { aiQuotaReachedMessage } from "../src/shared/ai-quota-contract.js";
import {
  AI_MODEL_BUDGET_MS,
  AI_MODEL_CALL_CAP_MS,
  AI_MODEL_CALL_FLOOR_MS,
} from "../src/shared/ai-timing.js";
import { CHAT_DAILY_QUOTA } from "../src/shared/coach-chat-contract.js";
import {
  type DebriefSuggestion,
  type ThreadMessage,
  threadRequestSchema,
} from "../src/shared/coach-thread-contract.js";
import { loadAiSettingsWith, persistChatGptTokensWith } from "./_lib/ai-settings.js";
import { refundAiUsageWith } from "./_lib/ai-usage.js";
import {
  type CoachUserClient,
  defaultTierFor,
  loadBenchTiers,
  loadProfile,
  preferencesOf,
} from "./_lib/coach-context.js";
import {
  loadRecentDebriefs,
  loadRecentMatches,
  loadThreadHistory,
} from "./_lib/coach-thread-context.js";
import { insertCoachMessage, insertUserMessage, removeMessage } from "./_lib/coach-thread-write.js";
import { BudgetExhaustedError, type ModelBudget, startModelBudget } from "./_lib/model-budget.js";
import { loadPlatformSettings, platformAiUsageToday } from "./_lib/platform-settings.js";
import { authenticate, fail, json, readBody } from "./_lib/request.js";
import { type ServiceClient, serviceClient } from "./_lib/service.js";

/**
 * Un tour de fil est un aller-retour court, pas une génération complète : les
 * deux tentatives possibles tiennent largement sous cette borne, relance
 * corrective comprise, parce qu'elles partagent le budget de
 * `./_lib/model-budget.js` au lieu d'avoir chacune son délai.
 *
 * La valeur reste **littérale** : la plateforme la lit par analyse statique.
 * `src/shared/ai-timing.ts` en tient le miroir, et son test refuse la dérive.
 */
export const maxDuration = 60;

/** Une réponse de coach fait quelques paragraphes ; le prompt vise 200 mots. */
const MAX_TOKENS = 800;

const usageCountSchema = z.number().int().min(0);

const INVALID_MESSAGE = "Écris ton message au coach (2 000 caractères au maximum).";

/** Un échec, avec le quota du jour quand il y a quelque chose à annoncer. */
function failWithQuota(error: string, status: number, remaining: number | null): Response {
  return remaining === null ? fail(error, status) : json({ error, remaining }, status);
}

/**
 * Le délai vient du **budget** et non d'une constante par appel (V4-C §4.9) :
 * deux tentatives à délai fixe pouvaient s'additionner au-delà du
 * `maxDuration`, et la fonction était alors tuée avant d'avoir pu rembourser le
 * quota (`./_lib/model-budget.js`).
 */
function askWith(
  config: ProviderConfig,
  identity: PromptIdentity,
  budget: ModelBudget,
  deps: AskDeps,
): AskModel {
  const ask = createAsk(
    config,
    { system: coachThreadSystemPrompt(identity), maxTokens: MAX_TOKENS },
    deps,
  );

  // Seul le texte est retenu : un tour de fil se rejoue en reposant la
  // question. Le drapeau de troncature ne compte que là où la sortie est écrite
  // en base pour toujours (`api/_lib/match-analysis.ts`).
  return (messages) => ask(messages, budget.nextTimeout()).then((answer) => answer.text);
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
  const body = await readBody(request, threadRequestSchema, INVALID_MESSAGE);

  if (!body.ok) return body.response;

  const question = body.value.message;

  // 3. Configuration. La service key est requise dans tous les cas : elle seule
  //    peut lire la clé du fournisseur personnel (migration 0008) et celle de
  //    la plateforme (migration 0009).
  const service = serviceClient();

  if (service === null) return fail("IA non configurée", 503);

  const platform = await loadPlatformSettings(service);

  // 4. Quel fournisseur, et qui paie.
  let resolution: Awaited<ReturnType<typeof resolveModelFor>>;

  try {
    resolution = await resolveModelFor(loadAiSettingsWith(service), userId, platform.ai);
  } catch (cause) {
    console.error("[coach-thread] réglages IA illisibles", cause);
    if (cause instanceof AiSettingsUnavailableError) {
      return fail("Tes réglages IA n'ont pas pu être lus. Réessaie dans un instant.", 503);
    }
    throw cause;
  }

  if (!resolution.ok) return fail(resolution.reason, resolution.status);

  const config = resolution.config;

  // 5. Quota du fil : le compteur `chat` de la migration 0011, incrémenté avant
  //    l'appel et **seulement** sur la clé de la plateforme. Le fil remplace le
  //    chat par debrief, il n'a donc pas de compteur à lui — deux compteurs
  //    pour la même dépense se seraient contredits le jour où l'un des deux
  //    aurait changé de limite.
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
          error: aiQuotaReachedMessage("chat", CHAT_DAILY_QUOTA),
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

  // 6. Contexte puis génération. Tout est lu sous la RLS de l'appelant, et
  //    aucune de ces lectures n'est un prérequis : un échec dégrade la réponse.
  // Le profil se lit **avant** le reste : c'est lui qui porte le benchmark actif
  // (DECISIONS.md D6), et le bench se lit dans ce benchmark-là. Un aller-retour
  // de plus, sur un chemin qui attend ensuite le modèle, plutôt que de résumer
  // des passes d'un barème que le joueur ne travaille plus.
  const profile = await loadProfile(userClient, userId);
  const identity = identityOf(profile);
  const { activeBenchmark } = preferencesOf(profile);
  const [bench, matches, debriefs, history] = await Promise.all([
    loadBenchTiers(userClient, userId, activeBenchmark),
    loadRecentMatches(userClient, userId),
    loadRecentDebriefs(userClient, userId),
    loadThreadHistory(userClient, userId),
  ]);
  const context: ThreadContext = {
    profile,
    bench,
    // Le catalogue suit la passe la plus récente : c'est le palier sur lequel
    // le joueur s'entraîne, même quand les paliers d'avant sont terminés.
    scenarios: scenarioCatalog(bench.latestTier ?? defaultTierFor(activeBenchmark)).groups,
    matches: matches.summaries,
    debriefs,
    history,
    question,
    hasUndebriefedMatch: matches.undebriefedMatchId !== null,
  };

  let generated: Awaited<ReturnType<typeof generateThreadAnswer>>;

  // Le budget s'ouvre **ici**, juste avant le premier appel : le contexte est
  // déjà lu, et ce qui reste sous le `maxDuration` doit couvrir la génération,
  // sa relance, l'écriture en base et, si besoin, le remboursement.
  const budget = startModelBudget(AI_MODEL_BUDGET_MS, AI_MODEL_CALL_CAP_MS, AI_MODEL_CALL_FLOOR_MS);

  try {
    generated = await generateThreadAnswer(
      askWith(config, identity, budget, { persist: persistChatGptTokensWith(service, userId) }),
      context,
    );
  } catch (cause) {
    console.error("[coach-thread] appel au modèle en échec", cause);
    // Le renoncement au budget fait partie des échecs remboursés : le temps
    // manquant est le nôtre, pas celui de l'utilisateur.
    remaining = await refundQuota(refund, remaining);
    if (cause instanceof BudgetExhaustedError) {
      return failWithQuota(
        "La réponse a pris trop de temps. Réessaie : c'est en général plus rapide.",
        504,
        remaining,
      );
    }
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
    console.error(`[coach-thread] sortie hors contrat après ${generated.attempts} tentatives`, {
      reason: generated.reason,
    });
    remaining = await refundQuota(refund, remaining);
    return failWithQuota(
      "Le coach n'a pas rendu une réponse exploitable, même après relance. Réessaie dans un instant.",
      502,
      remaining,
    );
  }

  // 7. Persistance des deux messages, chacun par le client qui a autorité pour
  //    l'écrire (migration 0015) : la question sous le **JWT de l'utilisateur**
  //    — c'est la RLS qui l'autorise, et qui vérifie au passage le rôle, la
  //    longueur et l'absence de référence de debrief —, la réponse sous la
  //    **service key**, parce qu'aucune policy ne peut autoriser un navigateur
  //    à parler au nom du coach sans rouvrir la porte que la 0015 a fermée.
  //
  //    Le prix de ce partage est la perte de l'insertion atomique. Il est payé
  //    par une compensation (`removeMessage`) : une question sans réponse ne
  //    survit pas à l'échec, sinon le tour suivant repartirait au modèle avec un
  //    trou dans la conversation.
  const stored = await storeTurn(userClient, service, userId, question, generated.answer);

  if (stored === null) {
    // Généré mais pas enregistré : l'utilisateur n'a rien, donc on rembourse.
    // Le jeton dépensé chez le fournisseur est perdu — c'est notre affaire.
    remaining = await refundQuota(refund, remaining);
    return failWithQuota(
      "La réponse du coach n'a pas pu être enregistrée. Ton quota n'a pas été décompté : réessaie.",
      500,
      remaining,
    );
  }

  // 8. La suggestion, quand le modèle l'a posée. Le match visé est celui que
  //    **le serveur** a retenu, jamais un identifiant sorti du modèle. Une
  //    suggestion sans match reste rendue : le client dit alors qu'il n'y a
  //    rien à débriefer plutôt que d'afficher un bouton qui échouerait.
  const suggestion: DebriefSuggestion | null = generated.suggestsDebrief
    ? { matchId: matches.undebriefedMatchId }
    : null;

  return json({ question: stored.question, answer: stored.answer, suggestion, remaining }, 200);
}

/**
 * Le tour complet enregistré, ou `null` si l'une des deux lignes n'a pas pu
 * l'être.
 *
 * L'ordre compte deux fois : la question est écrite **avant** la réponse pour
 * que les identifiants (monotones) rendent le fil dans l'ordre où il a été dit,
 * et parce que c'est celle des deux qui peut échouer sans conséquence — rien
 * n'a encore été écrit derrière elle.
 */
async function storeTurn(
  client: CoachUserClient,
  service: ServiceClient,
  userId: string,
  question: string,
  answer: string,
): Promise<{ readonly question: ThreadMessage; readonly answer: ThreadMessage } | null> {
  const stored = await insertUserMessage(client, userId, question);

  if (stored === null) return null;

  const reply = await insertCoachMessage(service, userId, answer);

  if (reply === null) {
    await removeMessage(service, stored.id);
    return null;
  }
  return { question: stored, answer: reply };
}
