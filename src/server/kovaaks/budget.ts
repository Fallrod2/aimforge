/**
 * Budget de temps partagé entre plusieurs appels réseau — module **pur** :
 * il ne connaît ni `fetch`, ni KovaaK's, seulement une horloge.
 *
 * Le problème qu'il résout est arithmétique, pas conceptuel. Un import KovaaK's
 * enchaîne deux appels (retrouver le joueur, puis lire sa progression), chacun
 * avec une relance. Si chaque tentative a son propre délai fixe, le pire cas est
 * la **somme** de toutes les tentatives — et cette somme peut dépasser la durée
 * que la plateforme accorde à la fonction. Quand cela arrive, la fonction est
 * tuée avant d'avoir pu construire son erreur : l'utilisateur reçoit une page
 * d'erreur de plateforme au lieu du message soigné qu'on avait écrit pour lui.
 * Toute la dégradation propre tombe pour une addition.
 *
 * D'où un budget unique, décroissant, partagé par tous les appels : chaque
 * tentative est bornée par ce qui reste, et quand il ne reste rien, on renonce
 * **nous-mêmes**, à temps, avec notre propre message.
 */

/** Une horloge monotone en millisecondes. Injectable pour les tests. */
export type Clock = () => number;

export interface TimeBudget {
  /** Millisecondes restantes, jamais négatives. */
  readonly remaining: () => number;
}

/** Ouvre un budget de `totalMs` millisecondes à partir de maintenant. */
export function startBudget(totalMs: number, now: Clock = Date.now): TimeBudget {
  const deadline = now() + totalMs;

  return { remaining: () => Math.max(0, deadline - now()) };
}

/**
 * Le délai à accorder à la prochaine tentative, ou `null` s'il ne reste pas
 * assez de temps pour qu'elle ait une chance d'aboutir.
 *
 * `cap` empêche un seul appel d'avaler tout le budget : sans lui, un premier
 * appel lent laisserait le second sans rien, alors que c'est souvent le second
 * qui porte la donnée utile. `floor` évite les tentatives absurdes — lancer une
 * requête avec 80 ms devant soi, c'est dépenser une connexion pour un échec
 * certain.
 */
export function attemptTimeout(remaining: number, cap: number, floor: number): number | null {
  if (remaining < floor) return null;
  return Math.min(cap, remaining);
}
