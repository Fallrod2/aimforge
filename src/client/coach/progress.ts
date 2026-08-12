/**
 * Le squelette d'attente des générations IA (V4-C §4.9).
 *
 * ## Pourquoi pas de streaming — décision d'architecture, déjà prise
 *
 * La tentation évidente devant douze secondes d'attente est le SSE : faire
 * couler le texte du modèle à l'écran. **C'est refusé ici, et ce n'est pas une
 * question de complexité.** Ce que les fonctions `api/routine` et `api/coach*`
 * rendent n'est pas la sortie du modèle : c'est du JSON *validé et corrigé
 * côté serveur* — police anti-hallucination (aucun scénario inventé), relance
 * corrective quand la sortie est hors contrat, garde-fou de français. Diffuser
 * au fil de l'eau reviendrait à afficher du texte que la police n'a pas encore
 * relu, donc à montrer au joueur des noms de scénarios qui n'existent pas, puis
 * à les retirer sous ses yeux. Un écran honnête pendant l'attente vaut mieux
 * qu'un écran vivant qui ment.
 *
 * Le contrepoids, c'est ce module : au lieu d'un texte qui coule, des **étapes
 * datées** qui disent où en est vraiment la fonction, et un temps écoulé quand
 * l'attente devient sensible.
 *
 * ## L'honnêteté du squelette
 *
 * Les étapes sont calées sur ce que la fonction fait réellement, dans l'ordre
 * où elle le fait (lecture du contexte en base, appel au modèle, vérification
 * des citations avant écriture). Leurs bornes sont des durées **observées**,
 * pas une animation décorative — et la dernière étape n'a pas de fin : elle
 * reste active tant que la réponse n'est pas là. Une progression qui atteint
 * 100 % puis attend est exactement le mensonge qu'on veut éviter.
 *
 * Module **pur** : aucun React, aucune horloge interne. C'est l'appelant qui
 * fournit le temps écoulé, donc tout est testable sans faux minuteur.
 */

/** Une étape du squelette, avec l'instant où elle prend la main. */
export interface ProgressStep {
  readonly label: string;
  /** Millisecondes écoulées à partir desquelles l'étape devient active. */
  readonly from: number;
}

export type StepState = "done" | "active" | "pending";

export interface RenderedStep {
  readonly label: string;
  readonly state: StepState;
}

/**
 * Les étapes d'une génération de routine.
 *
 * Elles suivent `api/routine` : contexte (profil, dernier bench, debriefs,
 * parties récentes), puis appel au modèle, puis la police des sources — c'est
 * elle qui vérifie que chaque scénario cité existe dans le catalogue du palier,
 * et qui relance le modèle si ce n'est pas le cas.
 */
export const ROUTINE_STEPS: readonly ProgressStep[] = [
  { label: "Lecture de ton bench et de tes debriefs…", from: 0 },
  { label: "Génération de la séance…", from: 3_000 },
  { label: "Vérification des citations…", from: 14_000 },
];

/** Les étapes du fil : plus courtes, parce qu'un tour de conversation l'est. */
export const THREAD_STEPS: readonly ProgressStep[] = [
  { label: "Lecture de ton contexte…", from: 0 },
  { label: "Rédaction de la réponse…", from: 2_500 },
];

/**
 * Ce qu'on annonce comme ordre de grandeur, une fois l'attente devenue
 * sensible. La mention du modèle est volontaire : c'est lui qui décide du
 * temps, et le joueur qui branche sa propre clé peut voir tout autre chose.
 */
export const ROUTINE_EXPECTATION = "~15-25 s avec le modèle de la plateforme";

export const THREAD_EXPECTATION = "~10-20 s avec le modèle de la plateforme";

/** Au-delà de ce délai, l'attente mérite un chiffre plutôt qu'un silence. */
export const ELAPSED_AFTER_MS = 8_000;

/**
 * Les étapes avec leur état, pour un temps écoulé donné.
 *
 * La dernière étape atteinte est `active` et le **reste** : rien, à cet
 * instant, ne permet d'affirmer qu'elle est terminée.
 */
export function progressSteps(
  steps: readonly ProgressStep[],
  elapsedMs: number,
): readonly RenderedStep[] {
  // Une horloge qui recule (mise à l'heure du système pendant l'attente) ne doit
  // pas vider l'écran de ses étapes : le départ est un plancher.
  const elapsed = Math.max(0, elapsedMs);
  let active = 0;

  for (const [index, step] of steps.entries()) {
    if (elapsed >= step.from) active = index;
  }

  return steps.map((step, index) => ({
    label: step.label,
    state: index < active ? "done" : index === active ? "active" : "pending",
  }));
}

/**
 * Le temps écoulé, ou `null` tant qu'il n'y a rien d'anormal à signaler.
 *
 * Les secondes sont arrondies **vers le bas** : annoncer une seconde qui n'est
 * pas passée est la version miniature du même mensonge.
 */
export function elapsedLabel(elapsedMs: number, expectation: string): string | null {
  if (elapsedMs < ELAPSED_AFTER_MS) return null;
  return `${Math.floor(elapsedMs / 1_000)} s écoulées · ${expectation}`;
}
