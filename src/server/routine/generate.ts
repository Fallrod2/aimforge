/**
 * Génération d'une routine : un appel au modèle, et **une seule** relance
 * corrective si la réponse n'entre pas dans le contrat ou cite un scénario qui
 * n'existe pas (SPEC §4).
 *
 * Le modèle est derrière un port (`AskModel`) plutôt qu'importé : c'est la
 * seule façon de vérifier la relance sans clé d'API ni réseau — le cas qui
 * compte (« la première réponse invente un scénario, la seconde est bonne »)
 * est précisément celui qu'on ne peut pas provoquer sur un vrai modèle.
 *
 * Une seule relance, pas une boucle : au-delà, une sortie durablement hors
 * format est un problème de prompt ou de modèle, pas de chance — et chaque
 * tentative se paie en latence, en jetons et en budget de temps de la fonction.
 */

import type { RoutineContent } from "../../shared/routine-contract.js";
import { parseRoutine } from "./parse.js";
import {
  buildCorrectionMessages,
  buildRoutineMessages,
  type RoutineContext,
  type RoutineMessage,
} from "./prompt.js";

/** Le seul contact avec le modèle : une conversation entre, du texte sort. */
export type AskModel = (messages: readonly RoutineMessage[]) => Promise<string>;

export type GenerateResult =
  | { readonly ok: true; readonly routine: RoutineContent; readonly attempts: number }
  /** `reason` décrit le dernier défaut constaté ; destiné aux logs, pas à l'écran. */
  | { readonly ok: false; readonly reason: string; readonly attempts: number };

/**
 * @param allowed Les noms exacts des scénarios du palier du joueur — la même
 *   liste que celle donnée au modèle dans le prompt.
 */
export async function generateRoutine(
  ask: AskModel,
  context: RoutineContext,
  allowed: readonly string[],
): Promise<GenerateResult> {
  const first = await ask(buildRoutineMessages(context));
  const parsed = parseRoutine(first, allowed);

  if (parsed.ok) return { ok: true, routine: parsed.routine, attempts: 1 };

  const retry = await ask(buildCorrectionMessages(context, first, parsed.reason));
  const reparsed = parseRoutine(retry, allowed);

  if (reparsed.ok) return { ok: true, routine: reparsed.routine, attempts: 2 };
  return { ok: false, reason: reparsed.reason, attempts: 2 };
}
