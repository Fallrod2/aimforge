/**
 * L'accès au compteur de quota IA depuis les fonctions serverless.
 *
 * Un seul geste ici, et c'est le pendant de l'incrément : le **remboursement**
 * (`refund_ai_usage`, migration 0010). L'incrément, lui, reste écrit dans les
 * handlers parce qu'il décide s'ils continuent ; le remboursement, à l'inverse,
 * ne décide rien — il répare, et il doit le faire de la même façon des deux
 * côtés (`api/coach.ts`, `api/routine.ts`).
 *
 * Il passe par la **clé de service**, comme l'incrément : la table `ai_usage`
 * n'a aucune policy d'écriture, et il doit en rester ainsi. `userId` vient de
 * `getUser(token)`, jamais du corps de la requête — c'est ce qui rend le
 * contournement de la RLS sûr ici.
 *
 * Ce module **n'échoue jamais bruyamment** : il rend `null`. Un remboursement
 * qui rate est un contretemps de comptabilité ; l'erreur qui a provoqué le
 * remboursement, elle, est ce que l'utilisateur doit lire. La masquer par une
 * exception serait échanger un problème visible contre un problème caché.
 *
 * Le préfixe `_` sort ce fichier du routage Vercel : il est importé, jamais
 * appelé en HTTP.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import type { RefundUsage } from "../../src/server/coach/quota.js";

/** Les trois compteurs de `public.ai_usage`, tels que la fonction SQL les nomme. */
export type AiUsageKind = "coach" | "routine" | "chat";

const countSchema = z.number().int().min(0);

/**
 * Le remboursement de l'incrément du jour, prêt à être branché sur
 * `createQuotaRefund`.
 *
 * L'arête de minuit UTC est portée par la fonction SQL : elle ne touche que la
 * ligne du jour courant, et n'en crée aucune. Un appel incrémenté à 23:59 et
 * remboursé à 00:00 ne rembourse donc rien — on préfère ce cas rarissime à
 * l'entame du quota du lendemain.
 */
export function refundAiUsageWith(
  client: SupabaseClient,
  userId: string,
  kind: AiUsageKind,
): RefundUsage {
  return async (): Promise<number | null> => {
    const { data, error } = await client.rpc("refund_ai_usage", {
      p_user_id: userId,
      p_kind: kind,
    });

    if (error !== null) {
      console.error(`[${kind}] remboursement du quota impossible`, error);
      return null;
    }

    const count = countSchema.safeParse(data);

    if (!count.success) {
      console.error(`[${kind}] remboursement du quota : valeur inattendue`, data);
      return null;
    }
    return count.data;
  };
}
