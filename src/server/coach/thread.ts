/**
 * Génération d'une réponse du fil du coach : un appel au modèle, et **une
 * seule** relance corrective si la réponse n'est pas exploitable (SPEC
 * §5 sexies).
 *
 * Jumeau volontaire de `./chat.ts`, avec une différence : le fil transporte un
 * **signal** en plus du texte — le marqueur par lequel le modèle propose de
 * générer un debrief structuré. Il est retiré du texte **avant** toute autre
 * vérification, pour trois raisons :
 *
 * 1. il ne doit jamais être enregistré ni affiché — il n'est pas destiné à être
 *    lu, et un joueur qui verrait « [[DEBRIEF]] » en fin de réponse penserait à
 *    un bug ;
 * 2. la longueur contrôlée doit être celle du texte que l'utilisateur reçoit,
 *    pas celle du texte plus sa signalisation ;
 * 3. une réponse qui ne contiendrait *que* le marqueur est une réponse vide, et
 *    doit être traitée comme telle (relance) plutôt que persistée.
 *
 * Le reste est le patron du projet : réponse vide ⇒ relance ; scénario inventé
 * ⇒ relance, puis 502 si la relance échoue à son tour. Livrer la réponse en
 * retirant les noms fautifs a été écarté — on livrerait un conseil amputé de sa
 * consigne, et l'utilisateur n'aurait aucun moyen de savoir qu'il lui manque
 * quelque chose.
 *
 * Le modèle est derrière un port (`AskModel`) plutôt qu'importé : c'est la
 * seule façon de vérifier la relance sans clé d'API ni réseau.
 */

import {
  DEBRIEF_SUGGESTION_MARKER,
  THREAD_ANSWER_MAX,
} from "../../shared/coach-thread-contract.js";
import {
  scenarioNames,
  unknownScenarioReason,
  unknownScenariosInTexts,
} from "../shared/scenarios.js";
import type { AskModel } from "./generate.js";
import {
  buildThreadCorrectionMessages,
  buildThreadMessages,
  type ThreadContext,
} from "./thread-prompt.js";

export type ThreadAnswerParse =
  | { readonly ok: true; readonly answer: string; readonly suggestsDebrief: boolean }
  /** `reason` est renvoyé au modèle dans la relance : il doit être explicite. */
  | { readonly ok: false; readonly reason: string };

/**
 * Retire **toutes** les occurrences du marqueur et dit s'il y en avait une.
 *
 * Toutes, et pas seulement la dernière ligne : le prompt demande une ligne
 * finale, mais un modèle qui la place au milieu ou la répète ne doit pas la
 * faire lire au joueur. Une ligne qui ne contenait **que** le marqueur
 * disparaît entièrement — sans quoi la réponse finirait sur une ligne vide.
 */
export function stripDebriefSuggestion(raw: string): {
  readonly text: string;
  readonly suggested: boolean;
} {
  if (!raw.includes(DEBRIEF_SUGGESTION_MARKER)) return { text: raw, suggested: false };

  const kept: string[] = [];

  for (const line of raw.split("\n")) {
    if (!line.includes(DEBRIEF_SUGGESTION_MARKER)) {
      kept.push(line);
      continue;
    }

    const cleaned = line.split(DEBRIEF_SUGGESTION_MARKER).join("").trim();

    if (cleaned !== "") kept.push(cleaned);
  }
  return { text: kept.join("\n"), suggested: true };
}

/**
 * Le texte brut du modèle → une réponse exploitable, ou la raison du refus.
 *
 * @param allowed Les noms exacts des scénarios du palier du joueur.
 */
export function parseThreadAnswer(raw: string, allowed: readonly string[]): ThreadAnswerParse {
  const { text, suggested } = stripDebriefSuggestion(raw);
  const answer = text.trim();

  if (answer === "") return { ok: false, reason: "la réponse est vide" };

  if (answer.length > THREAD_ANSWER_MAX) {
    return {
      ok: false,
      reason: `la réponse fait ${answer.length} caractères pour ${THREAD_ANSWER_MAX} au maximum — sois beaucoup plus court`,
    };
  }

  const unknown = unknownScenariosInTexts([answer], allowed);

  if (unknown.length > 0) return { ok: false, reason: unknownScenarioReason(unknown) };
  return { ok: true, answer, suggestsDebrief: suggested };
}

export type ThreadResult =
  | {
      readonly ok: true;
      readonly answer: string;
      readonly suggestsDebrief: boolean;
      readonly attempts: number;
    }
  /** `reason` décrit le dernier défaut constaté ; destiné aux logs, pas à l'écran. */
  | { readonly ok: false; readonly reason: string; readonly attempts: number };

export async function generateThreadAnswer(
  ask: AskModel,
  context: ThreadContext,
): Promise<ThreadResult> {
  // La liste appliquée est **dérivée** de celle qu'on montre au modèle, jamais
  // recalculée à côté : une liste montrée qui différerait de la liste contrôlée
  // ferait relancer le modèle sur des noms qu'on lui a nous-mêmes donnés.
  const allowed = scenarioNames(context.scenarios);
  const first = await ask(buildThreadMessages(context));
  const parsed = parseThreadAnswer(first, allowed);

  if (parsed.ok) {
    return {
      ok: true,
      answer: parsed.answer,
      suggestsDebrief: parsed.suggestsDebrief,
      attempts: 1,
    };
  }

  const retry = await ask(buildThreadCorrectionMessages(context, first, parsed.reason));
  const reparsed = parseThreadAnswer(retry, allowed);

  if (reparsed.ok) {
    return {
      ok: true,
      answer: reparsed.answer,
      suggestsDebrief: reparsed.suggestsDebrief,
      attempts: 2,
    };
  }
  return { ok: false, reason: reparsed.reason, attempts: 2 };
}
