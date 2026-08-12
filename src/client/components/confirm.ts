/**
 * La machine à états des gestes destructifs (V5-A §5.4).
 *
 * Trois boutons effacent des choses — le fil du coach, une passe, une routine,
 * la saisie en cours — et aucun ne demandait rien. Une modale aurait réglé le
 * problème en en créant un autre : elle vole le focus, coupe le geste, et se
 * clique machinalement au bout de la troisième fois.
 *
 * Le motif retenu est plus léger et **réversible dans les deux sens** :
 *
 * 1. le premier appui **arme** le bouton, qui devient « Confirmer ? » pendant
 *    quatre secondes. Un clic ailleurs, une touche Échap ou l'expiration le
 *    désarment — l'utilisateur n'a rien à annuler, il n'a qu'à ne rien faire ;
 * 2. le second appui, dans la fenêtre, **déclenche** ;
 * 3. quand la donnée le permet, le déclenchement n'appelle pas le serveur tout
 *    de suite : il **diffère** de cinq secondes, le temps qu'un toast propose
 *    « Annuler ». Passé le délai, l'appel part.
 *
 * Tout est ici, en fonctions pures, pour une raison : c'est la partie qui se
 * trompe. Les quatre écrans qui l'utilisent partagent donc les mêmes règles —
 * y compris « armer un autre bouton désarme le premier », qui est ce qui empêche
 * deux « Confirmer ? » d'être ouverts en même temps.
 *
 * Le temps est **toujours un paramètre**. Aucune de ces fonctions ne lit
 * l'horloge : c'est ce qui les rend testables sans attendre quatre secondes.
 */

/** Combien de temps un bouton armé attend sa confirmation. */
export const CONFIRM_WINDOW_MS = 4_000;

/** Combien de temps une suppression reste annulable avant de partir au serveur. */
export const UNDO_WINDOW_MS = 5_000;

/**
 * Le bouton armé, et depuis quand. `null` = aucun.
 *
 * Une clé, pas un booléen : une liste de passes a un bouton par ligne, et c'est
 * l'état partagé qui garantit qu'une seule est armée à la fois.
 */
export type Confirmation = { readonly key: string; readonly armedAt: number } | null;

/** Rien d'armé. La valeur initiale, et celle de tout désarmement. */
export const IDLE: Confirmation = null;

/** Arme `key`, en remplaçant ce qui l'était. */
export function arm(key: string, now: number): Confirmation {
  return { key, armedAt: now };
}

/** Ce qui reste de la fenêtre, en millisecondes ; 0 si rien n'est armé. */
export function remainingMs(
  state: Confirmation,
  key: string,
  now: number,
  window = CONFIRM_WINDOW_MS,
): number {
  if (state === null || state.key !== key) return 0;
  return Math.max(0, state.armedAt + window - now);
}

/**
 * `key` est-il armé **et encore dans sa fenêtre** ?
 *
 * C'est ce que le rendu demande pour choisir entre « Supprimer » et
 * « Confirmer ? ». Une fenêtre écoulée répond `false` même si l'état n'a pas
 * encore été nettoyé : l'affichage ne dépend pas d'un minuteur qui aurait pu
 * ne pas se déclencher (onglet en arrière-plan, rendu figé).
 */
export function isArmed(
  state: Confirmation,
  key: string,
  now: number,
  window = CONFIRM_WINDOW_MS,
): boolean {
  return remainingMs(state, key, now, window) > 0;
}

/** L'état débarrassé d'une confirmation périmée. Idempotent. */
export function prune(state: Confirmation, now: number, window = CONFIRM_WINDOW_MS): Confirmation {
  if (state === null) return IDLE;
  return isArmed(state, state.key, now, window) ? state : IDLE;
}

/** Ce qu'un appui produit : le nouvel état, et s'il faut agir. */
export interface Press {
  readonly state: Confirmation;
  /** `true` seulement au second appui, dans la fenêtre : c'est le feu vert. */
  readonly fire: boolean;
}

/**
 * Un appui sur le bouton destructif `key`.
 *
 * Le premier arme, le second déclenche — et déclencher **désarme**, sinon un
 * troisième appui rejouerait le geste sur une donnée déjà partie. Un appui sur
 * une autre clé arme la sienne et abandonne la précédente : deux confirmations
 * ouvertes en même temps, c'est deux occasions de se tromper de bouton.
 */
export function press(
  state: Confirmation,
  key: string,
  now: number,
  window = CONFIRM_WINDOW_MS,
): Press {
  if (isArmed(state, key, now, window)) return { state: IDLE, fire: true };
  return { state: arm(key, now), fire: false };
}

/**
 * Une action différée, en attente de son « Annuler ».
 *
 * `payload` est ce qu'il faut pour **exécuter** l'action au terme du délai
 * (l'identifiant à supprimer) autant que pour la **rendre** (le libellé du
 * toast) : un seul objet, pour qu'aucun écran n'ait à tenir deux états en
 * parallèle.
 */
export type Deferred<T> = { readonly payload: T; readonly scheduledAt: number } | null;

/** Programme l'action. Une seule à la fois : la précédente est remplacée. */
export function defer<T>(payload: T, now: number): Deferred<T> {
  return { payload, scheduledAt: now };
}

/** Le délai est-il écoulé ? `false` s'il n'y a rien en attente. */
export function isDue<T>(state: Deferred<T>, now: number, window = UNDO_WINDOW_MS): boolean {
  return state !== null && now - state.scheduledAt >= window;
}

/**
 * L'annulation : rien de plus que l'oubli de l'action.
 *
 * C'est ce qui rend le motif sûr — tant que le délai n'est pas écoulé, aucun
 * appel n'est parti, donc « Annuler » n'a rien à défaire.
 */
export function forget<T>(): Deferred<T> {
  return null;
}
