/**
 * Lecture de la réponse du modèle : du texte brut au debrief validé.
 *
 * Module **pur** — c'est lui, et pas la fonction serverless, qui décide
 * qu'une réponse est exploitable. Il est donc testable sans réseau ni SDK.
 *
 * Le prompt exige du JSON nu, mais un modèle reste un modèle : on tolère les
 * enrobages les plus courants (bloc de code, phrase d'introduction) plutôt que
 * de dépenser une relance sur une réponse dont le contenu était bon. Ce qu'on
 * ne tolère pas, c'est un contenu qui ne respecte pas le contrat : là, la
 * relance corrective a quelque chose à corriger.
 *
 * Deux contrôles, donc, dans cet ordre — les mêmes que la routine :
 *
 * 1. **la forme** — le schéma du contrat (`coach-contract.ts`) ;
 * 2. **les scénarios** — chaque nom cité doit exister dans le palier du joueur.
 *    Un debrief bien formé qui envoie chercher « VT Reactive Tracking » dans
 *    KovaaK's est bien formé et inapplicable. Le défaut est corrigeable, la
 *    relance a donc quelque chose à corriger — et le message nomme les fautifs.
 *
 * La portée exacte de ce second contrôle est décrite dans
 * `../shared/scenarios.ts` : il attrape les mentions préfixées « VT », pas les
 * inventions déguisées en français (« PraFlick »), que seul le prompt combat.
 *
 * Puis, une fois les deux contrôles passés, une **retouche** et non un
 * contrôle : le garde-fou de français (`../shared/french-guard.ts`) repose la
 * typographie mécanique du debrief et signale ce qui reste bancal. Il ne refuse
 * rien — un français maladroit n'est pas un debrief inexploitable, et une
 * relance ne le rendrait pas meilleur de façon fiable.
 */

import { type CoachDebrief, coachDebriefSchema } from "../../shared/coach-contract.js";
import { frenchGuard } from "../shared/french-guard.js";
import { unknownScenarioReason, unknownScenariosInTexts } from "../shared/scenarios.js";

export type DebriefParse =
  | { readonly ok: true; readonly debrief: CoachDebrief }
  /** `reason` est renvoyé au modèle dans la relance : il doit être explicite. */
  | { readonly ok: false; readonly reason: string };

/**
 * Isole l'objet JSON d'une réponse : premier `{` jusqu'au dernier `}`.
 *
 * Les délimiteurs de bloc de code sont retirés d'abord, sinon un ```` ```json ````
 * en tête laisserait le contenu intact mais ferait échouer les cas où le
 * modèle commente **après** l'objet.
 */
export function extractJsonObject(raw: string): string | null {
  const withoutFences = raw.replace(/```[a-zA-Z]*\n?/g, "").replace(/```/g, "");
  const start = withoutFences.indexOf("{");
  const end = withoutFences.lastIndexOf("}");

  if (start === -1 || end === -1 || end < start) return null;
  return withoutFences.slice(start, end + 1);
}

/**
 * Résume les défauts relevés par Zod en une phrase lisible par le modèle.
 *
 * Exportée pour la Routine (`../routine/parse.ts`), qui a exactement le même
 * besoin : une raison de refus rédigée pour un modèle, pas pour un journal.
 */
export function summarizeIssues(error: {
  readonly issues: readonly { path: PropertyKey[]; message: string }[];
}): string {
  return error.issues
    .slice(0, 4)
    .map((issue) => {
      const path = issue.path.length === 0 ? "racine" : issue.path.join(".");

      return `${path} : ${issue.message}`;
    })
    .join(" ; ");
}

/**
 * Tous les textes d'un debrief, dans l'ordre de lecture.
 *
 * Un scénario peut être cité n'importe où — le résumé, un point fort, le détail
 * d'un axe, le focus. On les relit donc tous plutôt que de parier sur l'endroit
 * où le modèle a rangé le nom.
 */
export function debriefTexts(debrief: CoachDebrief): readonly string[] {
  return [
    debrief.resume,
    ...debrief.points_forts,
    ...debrief.axes.flatMap((axe) => [axe.titre, axe.detail]),
    debrief.focus,
  ];
}

/** Les scénarios cités par le debrief qui ne sont pas dans le palier du joueur. */
export function unknownScenarios(
  debrief: CoachDebrief,
  allowed: readonly string[],
): readonly string[] {
  return unknownScenariosInTexts(debriefTexts(debrief), allowed);
}

/**
 * Le debrief, passé au garde-fou de français (`../shared/french-guard.ts`).
 *
 * Il ne réécrit aucune phrase : il repose les majuscules après un point, resserre
 * la ponctuation, et **signale** ce qui reste bancal. Les titres d'axes sont
 * déclarés comme tels — le contrat leur demande 3 à 6 mots, donc exiger d'eux
 * une phrase complète produirait un signal faux à chaque génération.
 *
 * Les noms de scénarios sont passés en zone protégée : « VT 1w4ts Novice » n'est
 * pas du français, et lui appliquer la typographie française serait exactement
 * la faute qu'on essaie d'éviter.
 */
export function guardDebriefFrench(
  debrief: CoachDebrief,
  allowed: readonly string[],
): CoachDebrief {
  const guard = frenchGuard("coach", { protectedNames: allowed });
  const guarded: CoachDebrief = {
    resume: guard.apply(debrief.resume, "resume"),
    points_forts: debrief.points_forts.map((point, index) =>
      guard.apply(point, `points_forts[${index}]`),
    ),
    axes: debrief.axes.map((axe, index) => ({
      titre: guard.apply(axe.titre, `axes[${index}].titre`, "titre"),
      detail: guard.apply(axe.detail, `axes[${index}].detail`),
    })),
    focus: guard.apply(debrief.focus, "focus"),
  };

  guard.flush();
  return guarded;
}

/**
 * Le texte brut du modèle → un debrief conforme au contrat **et** au palier, ou
 * la raison du refus.
 *
 * @param allowed Les noms exacts des scénarios du palier du joueur.
 */
export function parseDebrief(raw: string, allowed: readonly string[]): DebriefParse {
  const candidate = extractJsonObject(raw);

  if (candidate === null) {
    return { ok: false, reason: "aucun objet JSON n'a été trouvé dans la réponse" };
  }

  let value: unknown;

  try {
    value = JSON.parse(candidate);
  } catch (cause) {
    const detail = cause instanceof Error ? cause.message : "erreur inconnue";

    return { ok: false, reason: `le JSON est mal formé (${detail})` };
  }

  const parsed = coachDebriefSchema.safeParse(value);

  if (!parsed.success) {
    return {
      ok: false,
      reason: `le JSON ne respecte pas le schéma (${summarizeIssues(parsed.error)})`,
    };
  }

  const unknown = unknownScenarios(parsed.data, allowed);

  if (unknown.length > 0) return { ok: false, reason: unknownScenarioReason(unknown) };
  // Le garde-fou vient **en dernier** : il s'applique au debrief qui part
  // vraiment à l'écran, pas à une sortie qu'une relance va remplacer.
  return { ok: true, debrief: guardDebriefFrench(parsed.data, allowed) };
}
