/**
 * Le client Supabase de l'application — instance unique, typée par le schéma
 * généré depuis la base (`database-types.ts`).
 *
 * Une seule instance pour tout le bundle : chaque `createClient` démarre son
 * propre rafraîchissement de jeton et son propre canal `onAuthStateChange`,
 * deux instances se marcheraient dessus sur le même `localStorage`.
 */

import { createClient } from "@supabase/supabase-js";
import { SUPABASE_PUBLISHABLE_KEY, SUPABASE_URL } from "./config";
import type { Database } from "./database-types";

export const supabase = createClient<Database>(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
    // PKCE plutôt que le flux implicite (défaut de la lib) : les retours
    // d'OAuth, de confirmation d'email et de réinitialisation arrivent alors
    // en `?code=…` dans la query, jamais en `#access_token=…` dans le hash.
    // C'est doublement gagnant ici : le hash appartient à notre routeur
    // (`route.ts`), et aucun jeton ne se retrouve dans l'historique du
    // navigateur ni dans les logs d'un éventuel intermédiaire.
    flowType: "pkce",
  },
});
