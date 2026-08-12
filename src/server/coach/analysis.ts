/**
 * Génération de la **mini-analyse d'un match** : un appel au modèle, et **une
 * seule** relance corrective si la sortie n'est pas exploitable (SPEC §5 sexies,
 * V4).
 *
 * Jumeau volontaire de `./chat.ts` — même nature de sortie (du texte libre, pas
 * un contrat de forme), donc même police : réponse vide ⇒ relance ; réponse
 * coupée au plafond de jetons ⇒ relance ; réponse trop longue ⇒ relance ;
 * scénario inventé ⇒ relance ; puis échec franc si la relance rate à son tour.
 * Livrer la réponse en retirant les noms fautifs a été écarté ici pour la même
 * raison qu'ailleurs : on livrerait un conseil amputé de sa consigne, et le
 * joueur n'aurait aucun moyen de savoir qu'il lui manque quelque chose. Un
 * échec remboursé vaut mieux qu'une analyse silencieusement fausse — d'autant
 * qu'elle serait **mise en cache à vie** (migration 0016).
 *
 * La seule différence avec le chat tient à la borne de longueur, et elle n'est
 * pas cosmétique : cet encart fait trois lignes sur la page d'un match, et le
 * texte accepté ici doit tenir dans la contrainte de colonne. `MATCH_ANALYSIS_MAX`
 * est donc la même valeur des deux côtés.
 *
 * Le modèle est derrière un port (`AskAnalysis`) plutôt qu'importé : c'est la
 * seule façon de vérifier la relance sans clé d'API ni réseau.
 */

import { MATCH_ANALYSIS_MAX } from "../../shared/valorant-contract.js";
import type { ModelAnswer } from "../ai/port.js";
import { frenchGuard } from "../shared/french-guard.js";
import {
  scenarioNames,
  unknownScenarioReason,
  unknownScenariosInTexts,
} from "../shared/scenarios.js";
import {
  type AnalysisContext,
  buildAnalysisCorrectionMessages,
  buildAnalysisMessages,
} from "./analysis-prompt.js";
import type { CoachMessage } from "./prompt.js";

/**
 * Le port de ce chemin : `AskModel` (`./generate.ts`) auquel s'ajoute le seul
 * renseignement que le texte ne porte pas — la sortie a-t-elle été coupée.
 *
 * Ailleurs (chat, fil, debrief, routine), une réponse ratée se rejoue d'un
 * clic ; ici elle est gravée. C'est ce qui justifie que ce chemin-là, et lui
 * seul, exige davantage de son adaptateur.
 */
export type AskAnalysis = (messages: readonly CoachMessage[]) => Promise<ModelAnswer>;

export type AnalysisParse =
  | { readonly ok: true; readonly analysis: string }
  /** `reason` est renvoyé au modèle dans la relance : il doit être explicite. */
  | { readonly ok: false; readonly reason: string };

/**
 * La réponse brute du modèle → une analyse exploitable, ou la raison du refus.
 *
 * Le paramètre est la réponse **entière** du port, pas seulement son texte :
 * une sortie coupée au plafond de jetons est courte, bien tournée et cite les
 * bons scénarios — aucune des trois autres règles ne la voit passer. Seul le
 * fournisseur sait qu'il écrivait encore, et c'est ici que ça se décide, parce
 * que la sortie acceptée ici est enregistrée pour de bon.
 *
 * @param allowed Les noms exacts des scénarios du palier du joueur.
 */
export function parseAnalysis(answer: ModelAnswer, allowed: readonly string[]): AnalysisParse {
  const trimmed = answer.text.trim();

  if (trimmed === "") return { ok: false, reason: "l'analyse est vide" };

  if (answer.truncated) {
    return {
      ok: false,
      reason:
        "l'analyse a été coupée avant sa fin (plafond de jetons atteint) — refais-la plus courte, deux à quatre phrases qui se terminent",
    };
  }

  // Le garde-fou passe **avant** la borne de longueur : cette sortie-là est
  // gravée en base (migration 0016), donc la longueur mesurée doit être celle du
  // texte enregistré (`../shared/french-guard.ts`).
  const guard = frenchGuard("coach-analysis", { protectedNames: allowed });
  const analysis = guard.apply(trimmed, "analysis");

  guard.flush();

  if (analysis.length > MATCH_ANALYSIS_MAX) {
    return {
      ok: false,
      reason: `l'analyse fait ${analysis.length} caractères pour ${MATCH_ANALYSIS_MAX} au maximum — deux à quatre phrases, pas davantage`,
    };
  }

  const unknown = unknownScenariosInTexts([analysis], allowed);

  if (unknown.length > 0) return { ok: false, reason: unknownScenarioReason(unknown) };
  return { ok: true, analysis };
}

export type AnalysisResult =
  | { readonly ok: true; readonly analysis: string; readonly attempts: number }
  /** `reason` décrit le dernier défaut constaté ; destiné aux logs, pas à l'écran. */
  | { readonly ok: false; readonly reason: string; readonly attempts: number };

export async function generateMatchAnalysis(
  ask: AskAnalysis,
  context: AnalysisContext,
): Promise<AnalysisResult> {
  // La liste appliquée est **dérivée** de celle qu'on montre au modèle, jamais
  // recalculée à côté : une liste montrée qui différerait de la liste contrôlée
  // ferait relancer le modèle sur des noms qu'on lui a nous-mêmes donnés.
  const allowed = scenarioNames(context.scenarios);
  const first = await ask(buildAnalysisMessages(context));
  const parsed = parseAnalysis(first, allowed);

  if (parsed.ok) return { ok: true, analysis: parsed.analysis, attempts: 1 };

  const retry = await ask(buildAnalysisCorrectionMessages(context, first.text, parsed.reason));
  const reparsed = parseAnalysis(retry, allowed);

  if (reparsed.ok) return { ok: true, analysis: reparsed.analysis, attempts: 2 };
  return { ok: false, reason: reparsed.reason, attempts: 2 };
}
