/**
 * Le bandeau d'accueil du tracker : à qui il s'adresse, et quand il disparaît
 * (SPEC V4-A §4.1c). Module pur (aucun React) — la décision se teste sans DOM.
 *
 * Le problème qu'il traite : quelqu'un qui ouvre AimForge pour la première fois
 * tombe sur dix-huit champs vides et une énergie à zéro. Rien à l'écran ne dit
 * que ces scores se jouent *ailleurs*, dans KovaaK's, et qu'on vient les
 * recopier ici. Les trois étapes le disent une fois.
 *
 * Trois conditions, et la conjonction des trois :
 *
 * 1. **aucune passe enregistrée** — quelqu'un qui en a une connaît le geste ;
 * 2. **aucun brouillon en cours** — dès qu'un chiffre est tapé, l'explication
 *    arrive après la bataille et ne fait plus que pousser la grille vers le bas ;
 * 3. **pas déjà refermé** — le choix est retenu dans le navigateur
 *    (`local-store.ts`), donc il survit au rechargement.
 *
 * Ce n'est pas une modale : c'est un encart en tête de page, qui n'attrape pas
 * le focus et ne bloque rien. Quelqu'un qui sait ce qu'il fait n'a même pas à le
 * fermer pour saisir ses scores.
 */

import { type KeyValueStore, PREF_PREFIX } from "./local-store";

/** Clé du « je l'ai lu ». Sa valeur ne porte rien : c'est sa présence qui parle. */
export const ONBOARDING_KEY = `${PREF_PREFIX}.tracker-onboarding-dismissed`;

/** Ce que l'écran sait au moment de décider d'afficher le bandeau. */
export interface OnboardingContext {
  /** Le compte a-t-il au moins une passe ? `null` tant qu'on ne sait pas. */
  readonly hasRuns: boolean | null;
  /** Au moins un champ de score est rempli sur le palier affiché. */
  readonly hasDraft: boolean;
  readonly dismissed: boolean;
}

/** Faut-il montrer le bandeau des trois étapes ? */
export function showsOnboarding(context: OnboardingContext): boolean {
  const { hasRuns, hasDraft, dismissed } = context;

  // `null` (historique pas encore lu) vaut « non » : on préfère un bandeau qui
  // arrive une demi-seconde trop tard à un bandeau qui s'affiche puis se retire.
  if (hasRuns !== false) return false;
  return !hasDraft && !dismissed;
}

/** Le bandeau a-t-il déjà été refermé sur ce navigateur ? */
export function isOnboardingDismissed(store: KeyValueStore): boolean {
  try {
    return store.getItem(ONBOARDING_KEY) !== null;
  } catch {
    return false;
  }
}

/** Referme le bandeau, pour de bon. */
export function dismissOnboarding(store: KeyValueStore): void {
  try {
    store.setItem(ONBOARDING_KEY, "1");
  } catch {
    // Un bandeau qui réapparaît est un désagrément ; une exception ici
    // casserait le tracker.
  }
}
