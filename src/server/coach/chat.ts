/**
 * Génération d'une réponse du chat coach : un appel au modèle, et **une seule**
 * relance corrective si la réponse n'est pas exploitable (SPEC §5 ter bis).
 *
 * Jumeau volontaire de `./generate.ts`, avec une différence de nature : le
 * debrief a un contrat de forme (un objet JSON), le chat n'en a pas. Ce qui
 * reste à vérifier, ce sont les deux choses qui rendraient la réponse
 * inutilisable :
 *
 * 1. **elle est vide** — un modèle qui n'a rien rendu n'est pas une réponse, et
 *    la colonne `content` interdit le vide de toute façon (migration 0011) ;
 * 2. **elle cite un scénario qui n'existe pas** — c'est la même police que le
 *    debrief et la routine, appliquée au même endroit du cycle. Un joueur qui
 *    tape « VT Pasu Master » dans KovaaK's ne trouve rien ; un conseil
 *    inapplicable n'est pas un conseil.
 *
 * Le verdict sur les scénarios est **le même que pour le debrief** : mention
 * inventée ⇒ relance, puis 502 si la relance échoue à son tour. Livrer la
 * réponse en retirant les noms fautifs a été écarté — on livrerait un conseil
 * amputé de sa consigne (« fais 3 runs de » sans scénario), et l'utilisateur
 * n'aurait aucun moyen de savoir qu'il lui manque quelque chose. Mieux vaut un
 * échec franc, remboursé, qu'un conseil silencieusement faux.
 *
 * Le modèle est derrière un port (`AskModel`) plutôt qu'importé : c'est la
 * seule façon de vérifier la relance sans clé d'API ni réseau.
 */

import { CHAT_ANSWER_MAX } from "../../shared/coach-chat-contract.js";
import { frenchGuard } from "../shared/french-guard.js";
import {
  scenarioNames,
  unknownScenarioReason,
  unknownScenariosInTexts,
} from "../shared/scenarios.js";
import { buildChatCorrectionMessages, buildChatMessages, type ChatContext } from "./chat-prompt.js";
import type { AskModel } from "./generate.js";

export type ChatAnswerParse =
  | { readonly ok: true; readonly answer: string }
  /** `reason` est renvoyé au modèle dans la relance : il doit être explicite. */
  | { readonly ok: false; readonly reason: string };

/**
 * Le texte brut du modèle → une réponse exploitable, ou la raison du refus.
 *
 * @param allowed Les noms exacts des scénarios du palier du joueur.
 */
export function parseChatAnswer(raw: string, allowed: readonly string[]): ChatAnswerParse {
  const trimmed = raw.trim();

  if (trimmed === "") return { ok: false, reason: "la réponse est vide" };

  // Le garde-fou passe **avant** la borne de longueur : la longueur mesurée
  // doit être celle du texte livré, pas celle d'un texte qu'on va encore
  // retoucher (`../shared/french-guard.ts`).
  const guard = frenchGuard("coach-chat", { protectedNames: allowed });
  const answer = guard.apply(trimmed, "answer");

  guard.flush();

  if (answer.length > CHAT_ANSWER_MAX) {
    return {
      ok: false,
      reason: `la réponse fait ${answer.length} caractères pour ${CHAT_ANSWER_MAX} au maximum — sois beaucoup plus court`,
    };
  }

  const unknown = unknownScenariosInTexts([answer], allowed);

  if (unknown.length > 0) return { ok: false, reason: unknownScenarioReason(unknown) };
  return { ok: true, answer };
}

export type ChatResult =
  | { readonly ok: true; readonly answer: string; readonly attempts: number }
  /** `reason` décrit le dernier défaut constaté ; destiné aux logs, pas à l'écran. */
  | { readonly ok: false; readonly reason: string; readonly attempts: number };

export async function generateChatAnswer(ask: AskModel, context: ChatContext): Promise<ChatResult> {
  // La liste appliquée est **dérivée** de celle qu'on montre au modèle, jamais
  // recalculée à côté : une liste montrée qui différerait de la liste contrôlée
  // ferait relancer le modèle sur des noms qu'on lui a nous-mêmes donnés.
  const allowed = scenarioNames(context.scenarios);
  const first = await ask(buildChatMessages(context));
  const parsed = parseChatAnswer(first, allowed);

  if (parsed.ok) return { ok: true, answer: parsed.answer, attempts: 1 };

  const retry = await ask(buildChatCorrectionMessages(context, first, parsed.reason));
  const reparsed = parseChatAnswer(retry, allowed);

  if (reparsed.ok) return { ok: true, answer: reparsed.answer, attempts: 2 };
  return { ok: false, reason: reparsed.reason, attempts: 2 };
}
