/**
 * La mini-analyse d'un match : tout ce que `api/valorant/match` fait **après**
 * avoir obtenu le détail de la partie (SPEC §5 sexies, V4).
 *
 * Elle vit ici plutôt que dans le handler pour une raison de lecture : le
 * handler répond à la question « de quelle partie parle-t-on, et ai-je le droit
 * d'en parler ? » ; ce module répond à « que coûte cette analyse, et qui la
 * paie ? ». Ce sont deux sujets, et le second est celui qui manipule un quota.
 *
 * Quatre décisions, dans l'ordre où elles s'appliquent :
 *
 * 1. **Le cache passe avant le modèle, et le handler l'a déjà vérifié.** Une
 *    partie analysée ne se réanalyse jamais : la relecture ne coûte ni jeton ni
 *    quota. C'est ce qui rend l'écriture en base non négociable (point 4).
 * 2. **Le compteur est `chat`, pas un compteur neuf.** Une mini-analyse est du
 *    texte libre, court, produit d'un aller simple : c'est exactement ce que
 *    coûte **un message de coach**, et c'est de ce budget-là qu'elle doit
 *    sortir. Ajouter un quatrième `kind` à `increment_ai_usage` demanderait une
 *    migration et créerait un budget parallèle : le joueur pourrait épuiser son
 *    fil du coach *et* s'offrir vingt analyses, alors que les deux dépenses
 *    tirent sur la même clé de plateforme. Le compteur `coach` a été écarté pour
 *    la raison inverse : il compte des **debriefs complets**, dix fois plus
 *    chers, et une analyse qui en consommerait un rendrait le vrai debrief du
 *    match impossible juste après.
 * 3. **Incrément avant l'appel, remboursement dès que rien n'est rendu.** Patron
 *    exact de `api/coach-thread` : l'incrément décide si on continue, le
 *    remboursement répare, et il ne joue qu'au plus une fois (`createQuotaRefund`).
 * 4. **L'écriture passe par la service key.** `match_details` n'a aucune policy
 *    `update` (décision de la 0013, confirmée par la 0016) : le navigateur ne
 *    peut pas écrire cette colonne, et c'est ce qui empêche de s'offrir des
 *    « analyses » gratuites en écrivant soi-même dans le cache. Le `user_id`
 *    n'est jamais pris dans le corps de la requête — il vient de `getUser` —, et
 *    la clause `.is("analysis", null)` fait gagner le premier écrivain quand deux
 *    clics partent en même temps.
 *
 * Le préfixe `_` sort ce fichier du routage Vercel : il est importé, jamais
 * appelé en HTTP.
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
} from "../../src/server/ai/index.js";
import { type AskAnalysis, generateMatchAnalysis } from "../../src/server/coach/analysis.js";
import {
  type AnalysisContext,
  matchAnalysisSystemPrompt,
} from "../../src/server/coach/analysis-prompt.js";
import { matchStatsFrom } from "../../src/server/coach/match-stats.js";
import { identityOf, type PromptIdentity } from "../../src/server/coach/prompt.js";
import {
  createQuotaRefund,
  evaluateQuota,
  type QuotaRefund,
  refundQuota,
} from "../../src/server/coach/quota.js";
import { GLOBAL_CAP_REACHED, globalCapReached } from "../../src/server/platform/settings.js";
import { scenarioCatalog } from "../../src/server/shared/scenarios.js";
import { CHAT_DAILY_QUOTA } from "../../src/shared/coach-chat-contract.js";
import type { MatchDetail, MatchDetailResponse } from "../../src/shared/valorant-contract.js";
import { loadAiSettingsWith, persistChatGptTokensWith } from "./ai-settings.js";
import { refundAiUsageWith } from "./ai-usage.js";
import {
  type CoachUserClient,
  defaultTierFor,
  loadBenchTiers,
  loadProfile,
  preferencesOf,
} from "./coach-context.js";
import { loadPlatformSettings, platformAiUsageToday } from "./platform-settings.js";
import { fail, json } from "./request.js";
import type { ServiceClient } from "./service.js";

/**
 * Deux à quatre phrases. Serré volontairement : c'est la borne qui rend
 * impossible le debrief déguisé, et elle coûte moins cher que la police de
 * longueur qui la double (`MATCH_ANALYSIS_MAX`).
 */
const MAX_TOKENS = 300;

/** Marge sous le `maxDuration` du handler : deux tentatives, et un 502 propre. */
const MODEL_TIMEOUT_MS = 25_000;

const usageCountSchema = z.number().int().min(0);

export interface AnalyzeMatchInput {
  /** Le client monté avec le JWT de l'appelant : toutes les lectures passent par lui. */
  readonly client: CoachUserClient;
  /** Le client de service, ou `null` si la clé n'est pas posée. */
  readonly service: ServiceClient | null;
  /** L'identité vérifiée, jamais un champ du corps de requête. */
  readonly userId: string;
  readonly matchId: string;
  /** Le détail de la partie — obtenu par le handler, jamais optionnel ici. */
  readonly detail: MatchDetail;
  /** `true` quand le détail venait du cache (aucun appel sortant n'a eu lieu). */
  readonly cached: boolean;
  /** Le `payload` de `imported_matches`, tel qu'il a été relu (jsonb brut). */
  readonly summary: unknown;
}

/** Un échec, avec le quota du jour quand il y a quelque chose à annoncer. */
function failWithQuota(error: string, status: number, remaining: number | null): Response {
  return remaining === null ? fail(error, status) : json({ error, remaining }, status);
}

/**
 * Le port, rendu **entier** à la génération — texte et troncature.
 *
 * Les autres chemins (chat, fil, debrief, routine) ne gardent que le texte :
 * ce qu'ils rendent n'est pas conservé, et un mauvais tour se rejoue d'un clic.
 * Ici, `MAX_TOKENS` est serré et la sortie est écrite en base pour toujours
 * (point 1 en tête de fichier) : perdre le fait qu'elle a été coupée
 * reviendrait à graver une phrase inachevée.
 */
function askWith(config: ProviderConfig, identity: PromptIdentity, deps: AskDeps): AskAnalysis {
  const ask = createAsk(
    config,
    { system: matchAnalysisSystemPrompt(identity), maxTokens: MAX_TOKENS },
    deps,
  );

  return (messages) => ask(messages, MODEL_TIMEOUT_MS);
}

/**
 * Génère l'analyse de la partie, l'enregistre, et rend la réponse complète.
 *
 * L'appelant a déjà tranché l'identité (401), l'entrée (400), la possession
 * (404) et l'existence du détail : ce qui reste ici commence à la configuration
 * (503) et finit au quota (429), qui est la seule marche qui coûte quelque
 * chose.
 */
export async function analyzeMatch(input: AnalyzeMatchInput): Promise<Response> {
  const { client, service, userId, matchId, detail, cached } = input;

  // 1. Configuration. La service key est requise dans tous les cas : elle seule
  //    peut lire la clé du fournisseur personnel (migration 0008) et celle de la
  //    plateforme (migration 0009) — et elle seule peut écrire l'analyse.
  if (service === null) return fail("IA non configurée", 503);

  const platform = await loadPlatformSettings(service);

  // 2. Quel fournisseur, et qui paie.
  let resolution: Awaited<ReturnType<typeof resolveModelFor>>;

  try {
    resolution = await resolveModelFor(loadAiSettingsWith(service), userId, platform.ai);
  } catch (cause) {
    console.error("[valorant] réglages IA illisibles", cause);
    if (cause instanceof AiSettingsUnavailableError) {
      return fail("Tes réglages IA n'ont pas pu être lus. Réessaie dans un instant.", 503);
    }
    throw cause;
  }

  if (!resolution.ok) return fail(resolution.reason, resolution.status);

  const config = resolution.config;

  // 3. Quota. Le compteur `chat` de la migration 0011, incrémenté avant l'appel
  //    et **seulement** sur la clé de la plateforme : une clé personnelle paie
  //    déjà ses jetons, lui compter un quota reviendrait à la facturer deux fois.
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
          error: `Quota atteint : ${CHAT_DAILY_QUOTA} messages de coach par jour, analyses comprises. Le compteur repart demain (heure UTC).`,
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

  // 4. Contexte. Tout est lu sous la RLS de l'appelant, et aucune de ces deux
  //    lectures n'est un prérequis : un échec dégrade l'analyse (moins de
  //    contexte), il ne l'annule pas. Le détail, lui, est déjà là — c'est le
  //    seul élément sans lequel on refuse d'appeler le modèle.
  // Le profil se lit **avant** le reste : c'est lui qui porte le benchmark actif
  // (DECISIONS.md D6), et le bench se lit dans ce benchmark-là. Un aller-retour
  // de plus, sur un chemin qui attend ensuite le modèle, plutôt que de résumer
  // des passes d'un barème que le joueur ne travaille plus.
  const profile = await loadProfile(client, userId);
  const identity = identityOf(profile);
  const { activeBenchmark } = preferencesOf(profile);
  const bench = await loadBenchTiers(client, userId, activeBenchmark);
  const context: AnalysisContext = {
    detail,
    summary: matchStatsFrom(input.summary),
    profile,
    bench,
    // Le catalogue suit la passe la plus récente : c'est le palier sur lequel
    // le joueur s'entraîne, même quand les paliers d'avant sont terminés.
    scenarios: scenarioCatalog(bench.latestTier ?? defaultTierFor(activeBenchmark)).groups,
  };

  let generated: Awaited<ReturnType<typeof generateMatchAnalysis>>;

  try {
    generated = await generateMatchAnalysis(
      askWith(config, identity, { persist: persistChatGptTokensWith(service, userId) }),
      context,
    );
  } catch (cause) {
    console.error("[valorant] analyse de match : appel au modèle en échec", cause);
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
    console.error(`[valorant] analyse hors contrat après ${generated.attempts} tentatives`, {
      reason: generated.reason,
    });
    remaining = await refundQuota(refund, remaining);
    return failWithQuota(
      "Le coach n'a pas rendu une analyse exploitable, même après relance. Réessaie dans un instant.",
      502,
      remaining,
    );
  }

  // 5. Mise en cache. `.is("analysis", null)` traduit l'absence de policy
  //    `update` du côté du serveur : deux clics simultanés ne laissent qu'un
  //    texte, et le premier gagne. Les deux `.eq()` répètent l'identité vérifiée
  //    — même si le code se trompait de ligne, il se tromperait chez le seul
  //    utilisateur qui a le droit de la lire.
  const stored = await service
    .from("match_details")
    .update({ analysis: generated.analysis })
    .eq("user_id", userId)
    .eq("match_id", matchId)
    .is("analysis", null);

  if (stored.error !== null) {
    // Générée mais pas gardée : elle a quand même été payée et elle est utile,
    // donc on la rend. Le prochain clic repassera par le modèle — c'est
    // exactement le comportement voulu tant que le cache est en peine, et c'est
    // déjà celui du détail juste au-dessus.
    console.error("[valorant] mise en cache de l'analyse en échec", stored.error);
  }

  return json(
    {
      cached,
      detail,
      analysis: generated.analysis,
      remaining,
    } satisfies MatchDetailResponse,
    200,
  );
}
