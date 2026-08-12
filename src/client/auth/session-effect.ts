/**
 * Ce qu'une session — ou son absence — impose au reste de l'application.
 *
 * Module pur, extrait de `AuthProvider` pour une raison précise : la remise à
 * zéro du benchmark n'était câblée que sur la déconnexion **volontaire**
 * (`signOut`), alors qu'une session tombe de plusieurs façons dont aucune ne
 * passe par ce bouton — jeton expiré, session révoquée depuis un autre
 * appareil, `getSession` en échec au démarrage. Toutes ces routes arrivent dans
 * le même rappel (`onAuthStateChange`), et c'est donc là que la règle doit
 * vivre, pas dans l'action de l'utilisateur.
 *
 * La règle tient en une phrase : **plus de session = plus de préférences**. Le
 * benchmark actif est une préférence de compte (`profiles.active_benchmark`),
 * mais `src/lib/energy` le garde dans un pointeur de module, hors de React et
 * hors de toute session. Laissé en place après une déconnexion, il fait calculer
 * la landing, la démo publique ou la session suivante avec les seuils d'un
 * barème que personne n'a choisi.
 *
 * `benchmarkReset` vaut `null` quand une session s'ouvre : ce n'est pas
 * « ne rien faire par défaut », c'est « ce n'est pas à cette fonction de
 * décider ». Le benchmark d'un compte connecté est lu dans son profil par
 * `ActiveBenchmarkProvider` ; imposer le défaut ici écraserait sa préférence le
 * temps d'un aller-retour réseau.
 */

import { type BenchmarkId, DEFAULT_BENCHMARK_ID } from "../../lib/energy";

export type AuthStatus = "loading" | "anonymous" | "authenticated";

export interface SessionEffect {
  readonly status: AuthStatus;
  /**
   * Le benchmark à réimposer au pointeur de module de `src/lib/energy`, ou
   * `null` quand il n'appartient pas à la session de le décider.
   */
  readonly benchmarkReset: BenchmarkId | null;
}

/**
 * L'effet d'un état de session, **quelle qu'en soit la cause**.
 *
 * L'événement Supabase n'est délibérément pas un paramètre : `SIGNED_OUT`,
 * `INITIAL_SESSION` sans session, `TOKEN_REFRESHED` qui échoue et une lecture
 * de session en erreur décrivent tous la même chose — il n'y a plus personne.
 * Les distinguer ici, c'est se donner l'occasion d'en oublier un.
 */
export function sessionEffect(hasSession: boolean): SessionEffect {
  return hasSession
    ? { status: "authenticated", benchmarkReset: null }
    : { status: "anonymous", benchmarkReset: DEFAULT_BENCHMARK_ID };
}
