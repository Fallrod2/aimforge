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
 */

import { type CoachDebrief, coachDebriefSchema } from "../../shared/coach-contract";

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

/** Résume les défauts relevés par Zod en une phrase lisible par le modèle. */
function summarizeIssues(error: {
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

/** Le texte brut du modèle → un debrief conforme au contrat, ou la raison du refus. */
export function parseDebrief(raw: string): DebriefParse {
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
  return { ok: true, debrief: parsed.data };
}
