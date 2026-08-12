/**
 * La lecture des trois compteurs de `public.ai_usage` pour le jour courant.
 *
 * C'est la moitié « serveur » de la vérité unique des quotas : le contrat
 * (`src/shared/ai-quota-contract.ts`) dit la forme, l'heure et les phrases ;
 * ce module dit **où en est le compteur**, en lisant la même ligne que les
 * fonctions SQL écrivent.
 *
 * Deux points qui ne doivent pas dériver :
 *
 * 1. **le jour lu est celui que la base écrit.** `aiQuotaDay` reproduit
 *    `(now() at time zone 'utc')::date` — la date civile UTC. Lire la date
 *    locale de la fonction serverless donnerait, deux heures par nuit, les
 *    compteurs de la veille ou du lendemain ;
 * 2. **une lecture en échec vaut zéro consommé, pas un refus.** Ce module ne
 *    décide rien : le refus, lui, vient de l'incrément (`increment_ai_usage` +
 *    `evaluateQuota`), qui est atomique et qui reste la seule autorité. Une
 *    ligne d'affichage indisponible ne doit pas empêcher de générer.
 *
 * La lecture passe par le **client de l'appelant** : `ai_usage` a une policy
 * `select own` (migration 0001), donc la clé de service n'est pas nécessaire —
 * elle ne l'est que pour les écritures et pour les limites de
 * `platform_settings`.
 *
 * Le préfixe `_` sort ce fichier du routage Vercel : il est importé, jamais
 * appelé en HTTP.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import type { AdminLimits } from "../../src/shared/admin-contract.js";
import {
  type AiQuota,
  type AiQuotaKind,
  aiQuotaDay,
  aiQuotaOf,
} from "../../src/shared/ai-quota-contract.js";
import { CHAT_DAILY_QUOTA } from "../../src/shared/coach-chat-contract.js";

/** Les trois colonnes de compteur, telles que la table les porte. */
const COLUMNS = "coach_count, routine_count, chat_count";

const countsSchema = z.object({
  coach_count: z.number().int().min(0),
  routine_count: z.number().int().min(0),
  chat_count: z.number().int().min(0),
});

/** Aucune ligne aujourd'hui = rien de consommé. C'est exact, pas un repli. */
const NOTHING_USED = { coach_count: 0, routine_count: 0, chat_count: 0 };

/**
 * La limite appliquée à chaque compteur.
 *
 * `coach` et `routine` se règlent dans `platform_settings` (SPEC §5 quater) ;
 * `chat` reste une constante, et c'est assumé dans son contrat — l'ajouter à la
 * table demanderait de toucher le contrat d'administration et son écran. Le
 * jour où elle deviendra un réglage, c'est ici qu'elle changera d'origine, et
 * nulle part ailleurs.
 */
export function aiQuotaLimits(limits: AdminLimits): Readonly<Record<AiQuotaKind, number>> {
  return { coach: limits.coachDaily, routine: limits.routineDaily, chat: CHAT_DAILY_QUOTA };
}

/**
 * Les trois compteurs du jour, prêts à être affichés.
 *
 * @param now L'instant de référence, injecté pour que le passage de minuit UTC
 *   soit testable sans horloge système.
 */
export async function readAiQuotas(
  client: SupabaseClient,
  userId: string,
  limits: Readonly<Record<AiQuotaKind, number>>,
  now: Date,
): Promise<readonly AiQuota[]> {
  const { data, error } = await client
    .from("ai_usage")
    .select(COLUMNS)
    .eq("user_id", userId)
    .eq("day", aiQuotaDay(now))
    .maybeSingle();

  if (error !== null) {
    // Volontairement non fatal : c'est une ligne d'affichage, pas une décision.
    console.error("[ai-quota] lecture des compteurs du jour en échec", error.message);
  }

  const parsed = countsSchema.safeParse(data);
  const counts = parsed.success ? parsed.data : NOTHING_USED;

  if (!parsed.success && data !== null && error === null) {
    console.error("[ai-quota] compteurs du jour hors contrat");
  }

  return [
    aiQuotaOf("coach", counts.coach_count, limits.coach, now),
    aiQuotaOf("routine", counts.routine_count, limits.routine, now),
    aiQuotaOf("chat", counts.chat_count, limits.chat, now),
  ];
}
