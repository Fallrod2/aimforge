/**
 * Le client Supabase **de service** des fonctions de comptes liés, et le seul
 * usage qu'elles en font.
 *
 * Jusqu'à la migration 0007, ces trois fonctions n'écrivaient que sous le JWT
 * de l'appelant : la RLS les encadrait exactement comme le navigateur. Deux
 * besoins l'ont rendu insuffisant, et aucun des deux ne pouvait être satisfait
 * par une policy :
 *
 * 1. **le compteur d'imports** (`public.import_usage`) n'a aucune policy
 *    d'écriture, et il doit en rester ainsi — un frein que le navigateur peut
 *    remettre à zéro n'est pas un frein. Son incrément passe donc par une
 *    fonction `security definer` réservée à `service_role` ;
 * 2. **les colonnes serveur de `linked_accounts`** (`riot_puuid`,
 *    `riot_region`, `riot_mmr`, `last_refreshed_at`, `provider`,
 *    `external_id`) ne sont plus écrivables par `authenticated` : les
 *    privilèges de colonne les réservent au serveur.
 *
 * Pourquoi c'est sûr malgré le contournement de la RLS : chaque écriture faite
 * ici porte un `user_id` qui vient de `getUser(token)` — c'est-à-dire d'une
 * vérification de signature faite par Supabase Auth, pas d'un champ du corps de
 * requête. Et chaque écriture le répète dans sa clause `.eq()` : même si le
 * code se trompait de ligne, il se tromperait dans le périmètre d'un seul
 * utilisateur. Les lectures, elles, restent sur le client utilisateur.
 *
 * Le préfixe `_` sort ce fichier du routage Vercel : il est importé, jamais
 * appelé en HTTP.
 */

import { createClient } from "@supabase/supabase-js";
import type { ImportUsageKind } from "../../src/client/data/linked-accounts-contract.js";
import type { Database } from "../../src/client/supabase/database-types.js";
import type { IncrementUsage } from "../../src/server/linked/rate-limit.js";
import { SUPABASE_URL } from "../../src/shared/supabase-config.js";

export type ServiceClient = ReturnType<typeof createClient<Database>>;

/**
 * Le message d'une clé de service absente. Comme pour la clé HenrikDev, c'est
 * un état de configuration, pas une panne : la fonction le dit franchement
 * plutôt que d'écrire sans compter.
 */
export const NOT_CONFIGURED =
  "Import non configuré côté serveur : le compteur d'usage n'est pas joignable. Réessaie plus tard.";

/**
 * Le client de service, ou `null` tant que `SUPABASE_SERVICE_ROLE_KEY` n'est
 * pas posée dans l'environnement de la fonction. Le secret ne sort jamais
 * d'ici — ni dans une réponse, ni dans un log.
 */
export function serviceClient(): ServiceClient | null {
  const key = (process.env.SUPABASE_SERVICE_ROLE_KEY ?? "").trim();

  if (key === "") return null;

  return createClient<Database>(SUPABASE_URL, key, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
}

/**
 * L'incrément du compteur du jour, sous la forme qu'attend
 * `consumeDailyLimit` : une promesse de valeur brute, validée là-bas.
 *
 * L'erreur Postgres est relancée telle quelle — c'est le module de décision qui
 * tranche ce qu'on en fait (un compteur muet referme la porte).
 */
export function incrementUsage(client: ServiceClient, userId: string): IncrementUsage {
  return async (kind: ImportUsageKind) => {
    const { data, error } = await client.rpc("increment_import_usage", {
      p_user_id: userId,
      p_kind: kind,
    });

    if (error !== null) throw error;
    return data;
  };
}
