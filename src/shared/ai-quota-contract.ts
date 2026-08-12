/**
 * **La** vérité des quotas IA : leur forme sur le fil, l'heure à laquelle ils
 * repartent, et la phrase qui les dit.
 *
 * Ce module existe parce que trois formulations coexistaient dans l'écran
 * (« 20 messages par jour », « 5 routines par jour », « 5 debriefs et 5
 * routines par jour »), qu'aucune ne montrait le restant ni l'heure de
 * réinitialisation, et que toutes recopiaient une limite que
 * `platform_settings` peut changer sans redéploiement. Une limite affichée qui
 * n'est pas celle que le serveur applique est pire qu'une limite non affichée :
 * elle promet.
 *
 * **L'heure de réinitialisation n'est pas une supposition.** Les trois
 * compteurs vivent dans `public.ai_usage`, dont la clé primaire porte
 * `day date`, et les trois fonctions SQL qui la touchent (`increment_ai_usage`,
 * `refund_ai_usage`, `platform_ai_usage_today`, migrations 0003, 0010 et 0011)
 * calculent ce jour de la même façon, au mot près :
 *
 * ```sql
 * (now() at time zone 'utc')::date
 * ```
 *
 * Le jour de quota est donc le **jour civil UTC**, et le compteur repart au
 * prochain minuit UTC — 02:00 en France l'été, 01:00 l'hiver. C'est ce que
 * `nextAiQuotaResetAt` calcule, et c'est ce que le serveur envoie ; l'écran le
 * traduit en heure locale, parce que « demain (heure UTC) » ne dit pas à
 * quelqu'un qui joue à minuit et demi s'il doit attendre une heure ou vingt-cinq.
 *
 * Module pur : Zod, les trois constantes de défaut, et rien d'autre. Ni React,
 * ni Supabase, ni SDK — il est importé des deux côtés.
 */

import { z } from "zod";
import { CHAT_DAILY_QUOTA } from "./coach-chat-contract.js";
import { COACH_DAILY_QUOTA } from "./coach-contract.js";
import { ROUTINE_DAILY_QUOTA } from "./routine-contract.js";

/* ------------------------------------------------------------------ */
/* Les trois compteurs                                                 */
/* ------------------------------------------------------------------ */

/**
 * Les trois compteurs de `public.ai_usage`, nommés comme les fonctions SQL les
 * nomment (`p_kind`) et comme les colonnes les portent (`coach_count`,
 * `routine_count`, `chat_count`).
 */
export const AI_QUOTA_KINDS = ["coach", "routine", "chat"] as const;

export const aiQuotaKindSchema = z.enum(AI_QUOTA_KINDS);

export type AiQuotaKind = z.infer<typeof aiQuotaKindSchema>;

/**
 * Les limites servies quand `platform_settings` ne dit rien.
 *
 * Elles ne sont pas recopiées : ce sont les constantes des contrats, celles
 * que `src/server/platform/settings.ts` utilise déjà comme repli
 * (`DEFAULT_LIMITS`). Le chat n'a pas de colonne dans `platform_settings` — sa
 * limite est donc toujours celle-ci, et c'est documenté dans son contrat.
 */
export const DEFAULT_AI_QUOTA_LIMITS: Readonly<Record<AiQuotaKind, number>> = {
  coach: COACH_DAILY_QUOTA,
  routine: ROUTINE_DAILY_QUOTA,
  chat: CHAT_DAILY_QUOTA,
};

/**
 * Le nom de ce qu'un compteur compte, au singulier et au pluriel.
 *
 * Une seule table, parce que c'est la source de la discordance qu'on répare :
 * l'écran du fil disait « messages », celui de la routine « routines », les
 * réglages « debriefs et routines », et le serveur écrivait encore autre chose
 * dans ses 429.
 */
const NOUNS: Readonly<Record<AiQuotaKind, { readonly one: string; readonly many: string }>> = {
  coach: { one: "debrief", many: "debriefs" },
  routine: { one: "routine", many: "routines" },
  chat: { one: "message", many: "messages" },
};

/** Le nom du compteur, accordé. `0 message`, `1 message`, `2 messages`. */
export function aiQuotaNoun(kind: AiQuotaKind, count: number): string {
  return count > 1 ? NOUNS[kind].many : NOUNS[kind].one;
}

/* ------------------------------------------------------------------ */
/* L'état d'un compteur                                                */
/* ------------------------------------------------------------------ */

/**
 * L'état d'un compteur du jour, tel que le serveur le connaît.
 *
 * `used` est **plafonné à `limit`** avant de partir : le compteur en base peut
 * légitimement le dépasser (une tentative refusée a quand même incrémenté, voir
 * `src/server/coach/quota.ts`), et « 6/5 » n'apprendrait rien à personne.
 */
export const aiQuotaSchema = z.object({
  kind: aiQuotaKindSchema,
  used: z.number().int().min(0),
  limit: z.number().int().min(0),
  /**
   * Instant ISO 8601 du prochain retour à zéro : le prochain minuit UTC, parce
   * que c'est ce que `(now() at time zone 'utc')::date` impose.
   */
  resetAt: z.string().min(1),
});

export type AiQuota = z.infer<typeof aiQuotaSchema>;

/**
 * L'état complet des quotas d'un utilisateur, tel que `GET /api/ai-settings`
 * le joint à ses réglages.
 *
 * Il voyage avec les réglages IA plutôt que sur une route à lui, et ce n'est
 * pas une économie de code : `lifted` **est** une question de réglages (SPEC
 * §5 ter), et la fonction qui les lit répond donc à la question sans un seul
 * aller-retour de plus. Une route dédiée aurait relu la même ligne pour la
 * même réponse — et compté pour une fonction serverless de plus, sur une
 * plateforme qui les plafonne.
 */
export const aiQuotaResponseSchema = z.object({
  /**
   * `true` = l'utilisateur a posé sa propre configuration IA (SPEC §5 ter) : rien
   * n'est compté chez nous, et les compteurs ci-dessous ne le concernent plus.
   */
  lifted: z.boolean(),
  quotas: z.array(aiQuotaSchema),
});

export type AiQuotaResponse = z.infer<typeof aiQuotaResponseSchema>;

/** Le compteur d'un genre donné, ou `null` s'il n'a pas été rapporté. */
export function findAiQuota(state: AiQuotaResponse, kind: AiQuotaKind): AiQuota | null {
  return state.quotas.find((quota) => quota.kind === kind) ?? null;
}

/* ------------------------------------------------------------------ */
/* Le jour de quota                                                    */
/* ------------------------------------------------------------------ */

/**
 * Le jour de quota courant, au format que Postgres attend pour `ai_usage.day`.
 *
 * `toISOString().slice(0, 10)` est exactement `(now() at time zone 'utc')::date` :
 * la date civile UTC, sans fuseau local d'aucune sorte.
 */
export function aiQuotaDay(now: Date): string {
  return now.toISOString().slice(0, 10);
}

/**
 * L'instant où le compteur du jour repart : le prochain minuit UTC.
 *
 * Strictement après `now`, y compris à 00:00:00.000 UTC pile — à cet instant, le
 * jour de quota qui vient de commencer a bien vingt-quatre heures devant lui.
 */
export function nextAiQuotaResetAt(now: Date): string {
  return new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1),
  ).toISOString();
}

/* ------------------------------------------------------------------ */
/* Construction et mise à jour                                         */
/* ------------------------------------------------------------------ */

/** Un compteur du jour, plafonné et daté. Le seul constructeur d'`AiQuota`. */
export function aiQuotaOf(kind: AiQuotaKind, used: number, limit: number, now: Date): AiQuota {
  return {
    kind,
    used: Math.max(0, Math.min(used, limit)),
    limit,
    resetAt: nextAiQuotaResetAt(now),
  };
}

/**
 * Le même compteur, réécrit depuis le `remaining` d'une réponse d'API.
 *
 * Les fonctions serverless rendent déjà `remaining` sur le chemin heureux, sur
 * le 429 et sur les échecs remboursés : l'écran n'a donc pas besoin d'un second
 * aller-retour pour se remettre à jour, il lui manque seulement la limite et
 * l'heure — que `GET /api/ai-quota` lui a données une fois.
 *
 * Le passage de minuit est traité ici plutôt qu'ignoré : un onglet ouvert
 * depuis la veille afficherait sinon une heure de réinitialisation déjà passée.
 * La règle appliquée est celle du serveur, pas une approximation — c'est la
 * même fonction qui la calcule des deux côtés.
 */
export function aiQuotaWithRemaining(quota: AiQuota, remaining: number, now: Date): AiQuota {
  const stale = Date.parse(quota.resetAt);
  const resetAt =
    Number.isNaN(stale) || now.getTime() >= stale ? nextAiQuotaResetAt(now) : quota.resetAt;

  return {
    kind: quota.kind,
    used: Math.max(0, Math.min(quota.limit - remaining, quota.limit)),
    limit: quota.limit,
    resetAt,
  };
}

/* ------------------------------------------------------------------ */
/* Les phrases                                                         */
/* ------------------------------------------------------------------ */

/**
 * Ce que l'écran sait du quota d'un compteur.
 *
 * Trois états et non un `AiQuota | null`, parce que `null` voudrait dire deux
 * choses opposées : « pas encore lu » et « il n'y a plus rien à compter »
 * (SPEC §5 ter — l'utilisateur a apporté sa clé). Les confondre afficherait une
 * limite à quelqu'un qui n'en a plus.
 */
export type AiQuotaDisplay =
  | { readonly status: "unknown" }
  | { readonly status: "lifted" }
  | { readonly status: "counted"; readonly quota: AiQuota };

/** L'heure locale de réinitialisation, `HH:MM`, ou `null` si l'instant est illisible. */
export function aiQuotaResetLabel(resetAt: string): string | null {
  const at = new Date(resetAt);

  if (Number.isNaN(at.getTime())) return null;

  const hours = String(at.getHours()).padStart(2, "0");
  const minutes = String(at.getMinutes()).padStart(2, "0");

  return `${hours}:${minutes}`;
}

/**
 * La phrase du quota, la seule — celle que les trois écrans affichent.
 *
 * - lu : `3/5 aujourd'hui — se réinitialise à 02:00`, l'heure étant **locale**,
 *   traduite depuis le minuit UTC que le serveur a envoyé ;
 * - levé : l'utilisateur paie ses jetons, il n'y a pas de compteur ;
 * - pas encore lu : la limite **par défaut**, annoncée comme telle. C'est un
 *   état de chargement (et le repli quand `/api/ai-quota` n'est pas servi, en
 *   `bun dev` par exemple) : il ne prétend pas connaître le réglage en base.
 */
export function aiQuotaLabel(kind: AiQuotaKind, display: AiQuotaDisplay): string {
  if (display.status === "lifted") return "Quota levé · ta configuration IA";

  if (display.status === "unknown") {
    const limit = DEFAULT_AI_QUOTA_LIMITS[kind];

    return `${limit} ${aiQuotaNoun(kind, limit)} par jour`;
  }

  const { used, limit, resetAt } = display.quota;
  const reset = aiQuotaResetLabel(resetAt);
  const counted = `${used}/${limit} aujourd'hui`;

  return reset === null ? counted : `${counted} — se réinitialise à ${reset}`;
}

/**
 * Le message du quota atteint, rendu par les fonctions serverless en 429.
 *
 * Écrit ici et nulle part ailleurs : cinq fichiers d'API l'écrivaient chacun de
 * leur côté, avec chacun leur nom pour la chose comptée. L'heure y reste
 * annoncée en UTC — le serveur ne connaît pas le fuseau de l'appelant, et c'est
 * l'écran qui traduit, à partir de `resetAt`.
 *
 * @param precision Une incise facultative, quand un compteur paie plus d'un
 *   geste (le compteur `chat` paie aussi les analyses de match).
 */
export function aiQuotaReachedMessage(
  kind: AiQuotaKind,
  limit: number,
  precision?: string,
): string {
  const noun = `${limit} ${aiQuotaNoun(kind, limit)} par jour`;
  const detail = precision === undefined ? "" : `, ${precision}`;

  return `Quota atteint : ${noun}${detail}. Le compteur repart demain (heure UTC).`;
}
