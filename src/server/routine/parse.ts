/**
 * Lecture de la réponse du modèle : du texte brut à la routine validée.
 *
 * Module **pur** — c'est lui, et pas la fonction serverless, qui décide qu'une
 * réponse est exploitable. Il est donc testable sans réseau ni SDK.
 *
 * Deux contrôles, dans cet ordre :
 *
 * 1. **la forme** — le schéma du contrat (`routine-contract.ts`), comme pour le
 *    debrief. L'extraction du JSON est celle du coach (`../coach/parse.ts`) :
 *    même tolérance aux enrobages (bloc de code, phrase d'introduction), parce
 *    que le défaut est cosmétique et qu'une relance coûterait plus cher que ce
 *    qu'elle corrigerait ;
 * 2. **les scénarios** — chaque nom cité doit exister dans le palier du joueur.
 *    C'est le contrôle propre à la routine : une séance bien formée qui envoie
 *    le joueur chercher « VT Tile Frenzy Deluxe » dans KovaaK's est bien formée
 *    et inutilisable. Le défaut est corrigeable, la relance a donc quelque
 *    chose à corriger — et le message nomme les scénarios fautifs.
 */

import { type RoutineContent, routineContentSchema } from "../../shared/routine-contract.js";
import { extractJsonObject, summarizeIssues } from "../coach/parse.js";
import { unknownScenarioMentions } from "./scenarios.js";

export type RoutineParse =
  | { readonly ok: true; readonly routine: RoutineContent }
  /** `reason` est renvoyé au modèle dans la relance : il doit être explicite. */
  | { readonly ok: false; readonly reason: string };

/**
 * Tous les textes d'une routine, dans l'ordre de lecture.
 *
 * Un scénario peut être cité n'importe où — le titre d'un bloc, le détail d'un
 * item, le conseil final. On les relit donc tous plutôt que de parier sur
 * l'endroit où le modèle a rangé le nom.
 */
export function routineTexts(routine: RoutineContent): readonly string[] {
  return [
    routine.titre,
    ...routine.blocs.flatMap((bloc) => [
      bloc.nom,
      ...bloc.items.flatMap((item) => [item.texte, item.detail]),
    ]),
    routine.objectif_game,
    routine.conseil,
  ];
}

/** Les scénarios cités par la routine qui ne sont pas dans le palier du joueur. */
export function unknownScenarios(
  routine: RoutineContent,
  allowed: readonly string[],
): readonly string[] {
  const unknown: string[] = [];
  const seen = new Set<string>();

  for (const text of routineTexts(routine)) {
    for (const mention of unknownScenarioMentions(text, allowed)) {
      if (seen.has(mention)) continue;
      seen.add(mention);
      unknown.push(mention);
    }
  }
  return unknown;
}

/** Nombre de scénarios fautifs nommés dans la relance ; au-delà, c'est du bruit. */
const MAX_NAMED = 4;

/**
 * Le texte brut du modèle → une routine conforme au contrat **et** au palier,
 * ou la raison du refus.
 *
 * @param allowed Les noms exacts des scénarios du palier du joueur.
 */
export function parseRoutine(raw: string, allowed: readonly string[]): RoutineParse {
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

  const parsed = routineContentSchema.safeParse(value);

  if (!parsed.success) {
    return {
      ok: false,
      reason: `le JSON ne respecte pas le schéma (${summarizeIssues(parsed.error)})`,
    };
  }

  const unknown = unknownScenarios(parsed.data, allowed);

  if (unknown.length > 0) {
    const named = unknown
      .slice(0, MAX_NAMED)
      .map((name) => `« ${name} »`)
      .join(", ");

    return {
      ok: false,
      reason: `ces scénarios n'existent pas dans le palier du joueur : ${named} — n'utilise que les noms de <scenarios_autorises>, copiés au mot près`,
    };
  }
  return { ok: true, routine: parsed.data };
}
