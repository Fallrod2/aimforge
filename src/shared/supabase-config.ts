/**
 * Coordonnées du projet Supabase, partagées par le bundle client et les
 * fonctions serverless.
 *
 * Ces deux valeurs sont **publiques par conception** : elles voyagent dans
 * chaque requête du navigateur et sont destinées au bundle client. Ce qui
 * protège les données, ce n'est pas leur secret, c'est la RLS (chaque table
 * n'expose que les lignes dont `user_id = auth.uid()`).
 *
 * Elles vivent ici plutôt que dans `src/client/` parce que la fonction
 * `api/coach.ts` en a besoin elle aussi : elle vérifie le JWT de l'appelant et
 * relit ses données **avec ce JWT** (donc sous RLS), exactement comme le
 * navigateur. Dupliquer l'URL des deux côtés serait la garantie qu'un jour
 * l'une des deux pointe ailleurs.
 *
 * Les vrais secrets (`ANTHROPIC_API_KEY`, `SUPABASE_SERVICE_ROLE_KEY`) ne
 * passent jamais par ce module : ils sont lus dans l'environnement de la
 * fonction serverless, et nulle part ailleurs.
 */

export const SUPABASE_URL = "https://xmwdoasyigowvutvmhkl.supabase.co";

/** Clé « publishable » (anonyme). Publique : toute lecture reste filtrée par RLS. */
export const SUPABASE_PUBLISHABLE_KEY = "sb_publishable_AuTVnASaHXungcLYLCcNyw_qAArWyVV";
