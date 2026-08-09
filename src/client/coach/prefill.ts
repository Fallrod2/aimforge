/**
 * Pré-remplissage du formulaire du Coach depuis l'extérieur.
 *
 * SPEC §5 bis : « le Coach peut débriefer un match importé (pré-remplissage de
 * son entrée depuis `imported_matches`) ». Le module d'import n'existe pas
 * encore ; ce module est le point d'entrée qu'il utilisera, et il est écrit
 * pour ne rien lui demander en retour — il ne connaît ni les matchs, ni la
 * base, ni React.
 *
 * Une boîte à lettres à un seul message plutôt qu'un paramètre de route : la
 * grammaire du hash (`src/client/route.ts`) ne transporte qu'un identifiant de
 * passe, et y faire passer un résumé de match entier serait à la fois moche et
 * limité en taille. L'appelant dépose le texte, puis navigue vers `#/coach` :
 *
 * ```ts
 * setCoachPrefill(resumeDuMatch);
 * navigate({ view: "coach", runId: null });
 * ```
 *
 * Le message est **consommé** à la lecture (`takeCoachPrefill`). C'est
 * délibéré : un texte qui resterait en mémoire réapparaîtrait à la prochaine
 * visite de la vue, longtemps après que l'utilisateur l'a effacé — un
 * formulaire qui se re-remplit tout seul est un bug, pas un service.
 *
 * Portée : l'onglet courant. Un rechargement de page le perd, et c'est très
 * bien — la navigation qui l'a déposé n'a pas survécu non plus.
 */

/** Le texte en attente, ou `null` si la boîte est vide. */
let pending: string | null = null;

/**
 * Dépose un texte à pré-remplir dans le formulaire du Coach.
 *
 * Un texte vide (ou uniquement des espaces) vide la boîte plutôt que d'y
 * déposer du blanc : l'appelant n'a pas à filtrer avant d'appeler.
 *
 * La longueur n'est pas bornée ici. Au-delà de `MAX_STATS_LENGTH`, le
 * formulaire l'affiche, le signale et refuse l'envoi — un texte tronqué en
 * silence serait pire, parce que le joueur enverrait un match amputé sans le
 * savoir.
 */
export function setCoachPrefill(stats: string): void {
  const trimmed = stats.trim();

  pending = trimmed === "" ? null : trimmed;
}

/** Relit et vide la boîte. `null` s'il n'y avait rien à pré-remplir. */
export function takeCoachPrefill(): string | null {
  const value = pending;

  pending = null;
  return value;
}
