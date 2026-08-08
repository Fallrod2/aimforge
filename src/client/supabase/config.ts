/**
 * Coordonnées du projet Supabase.
 *
 * Ces deux valeurs sont **publiques par conception** : elles voyagent dans
 * chaque requête du navigateur et sont destinées au bundle client. Ce qui
 * protège les données, ce n'est pas leur secret, c'est la RLS (chaque table
 * n'expose que les lignes dont `user_id = auth.uid()`, cf.
 * `supabase/migrations/0001_initial_schema.sql`).
 *
 * Elles sont donc écrites en dur plutôt que lues dans un `.env` : une variable
 * d'environnement côté client n'ajouterait aucune confidentialité (elle finit
 * inlinée dans le bundle) mais ajouterait un mode de panne — un déploiement
 * sans la variable rendrait l'app muette au lieu d'échouer à la compilation.
 *
 * Les vrais secrets (`ANTHROPIC_API_KEY`, `SUPABASE_SERVICE_ROLE_KEY`) ne
 * passeront jamais par ici : ils restent dans l'environnement des fonctions
 * serverless (phases P3/P4).
 */

export const SUPABASE_URL = "https://xmwdoasyigowvutvmhkl.supabase.co";

/** Clé « publishable » (anonyme). Publique : toute lecture reste filtrée par RLS. */
export const SUPABASE_PUBLISHABLE_KEY = "sb_publishable_AuTVnASaHXungcLYLCcNyw_qAArWyVV";
