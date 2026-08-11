/**
 * Génération d'un debrief : un appel au modèle, et **une seule** relance
 * corrective si la réponse n'entre pas dans le contrat (SPEC §4).
 *
 * Le modèle est derrière un port (`AskModel`) plutôt qu'importé : c'est la
 * seule façon de vérifier la relance sans clé d'API ni réseau — le cas qui
 * compte (« la première réponse est mauvaise, la seconde est bonne ») est
 * précisément celui qu'on ne peut pas provoquer sur un vrai modèle.
 *
 * Une seule relance, pas une boucle : au-delà, une sortie durablement hors
 * format est un problème de prompt ou de modèle, pas de chance — et chaque
 * tentative se paie en latence et en jetons.
 */

import type { CoachDebrief } from "../../shared/coach-contract.js";
import { scenarioNames } from "../shared/scenarios.js";
import { parseDebrief } from "./parse.js";
import {
  buildCoachMessages,
  buildCorrectionMessages,
  type CoachContext,
  type CoachMessage,
} from "./prompt.js";

/** Un bloc de contenu tel que le SDK Anthropic le rend. */
export interface ModelContentBlock {
  readonly type: string;
  readonly text?: string;
}

/**
 * Le texte d'une réponse : uniquement les blocs `text`, recollés.
 *
 * Les autres types de blocs (réflexion, appel d'outil) n'ont pas à finir dans
 * le JSON qu'on s'apprête à parser — ce module en rencontrerait si la
 * configuration du modèle changeait un jour.
 */
export function textOf(content: readonly ModelContentBlock[]): string {
  return content
    .flatMap((block) => (block.type === "text" && block.text !== undefined ? [block.text] : []))
    .join("\n")
    .trim();
}

/**
 * Le seul contact avec le modèle : une conversation entre, du texte sort.
 *
 * Du texte, et rien d'autre : ce que rend le debrief, le chat ou le fil n'est
 * pas gravé, et une réponse ratée se rejoue. La mini-analyse d'un match, elle,
 * est écrite en base pour toujours et a besoin d'en savoir plus — elle a son
 * propre port (`AskAnalysis`, `./analysis.ts`).
 */
export type AskModel = (messages: readonly CoachMessage[]) => Promise<string>;

export type GenerateResult =
  | { readonly ok: true; readonly debrief: CoachDebrief; readonly attempts: number }
  /** `reason` décrit le dernier défaut constaté ; destiné aux logs, pas à l'écran. */
  | { readonly ok: false; readonly reason: string; readonly attempts: number };

export async function generateDebrief(
  ask: AskModel,
  context: CoachContext,
): Promise<GenerateResult> {
  // La liste appliquée est **dérivée** de celle qu'on montre au modèle, jamais
  // recalculée à côté : une liste montrée qui différerait de la liste contrôlée
  // ferait relancer le modèle sur des noms qu'on lui a nous-mêmes donnés.
  const allowed = scenarioNames(context.scenarios);
  const first = await ask(buildCoachMessages(context));
  const parsed = parseDebrief(first, allowed);

  if (parsed.ok) return { ok: true, debrief: parsed.debrief, attempts: 1 };

  const retry = await ask(buildCorrectionMessages(context, first, parsed.reason));
  const reparsed = parseDebrief(retry, allowed);

  if (reparsed.ok) return { ok: true, debrief: reparsed.debrief, attempts: 2 };
  return { ok: false, reason: reparsed.reason, attempts: 2 };
}
