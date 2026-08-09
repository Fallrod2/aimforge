/**
 * Coordonnées du projet Supabase, côté client.
 *
 * Les valeurs elles-mêmes vivent dans `src/shared/supabase-config.ts` depuis
 * P3 : la fonction serverless `api/coach.ts` vérifie le JWT de l'appelant et
 * relit ses données avec ce même JWT, donc elle a besoin des mêmes
 * coordonnées. Un seul endroit les écrit, les deux côtés le lisent.
 *
 * Elles sont écrites en dur plutôt que lues dans un `.env` : une variable
 * d'environnement côté client n'ajouterait aucune confidentialité (elle finit
 * inlinée dans le bundle) mais ajouterait un mode de panne — un déploiement
 * sans la variable rendrait l'app muette au lieu d'échouer à la compilation.
 */

export { SUPABASE_PUBLISHABLE_KEY, SUPABASE_URL } from "../../shared/supabase-config";
