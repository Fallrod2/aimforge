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
 *    chose à corriger — et le message nomme les scénarios fautifs ;
 * 3. **les citations chiffrées** (SPEC §5 sexies, V5) — chaque marqueur écrit
 *    par le modèle doit correspondre à une donnée réelle du contexte
 *    (`./citations.ts`). Même patron que les scénarios, pour la même raison :
 *    un chiffre inventé rend la routine plus convaincante et moins vraie.
 *
 * Et une transformation, après les contrôles : les marqueurs vérifiés sont
 * **retirés du texte** et rendus séparément (`sources`). Le joueur lit une
 * séance, pas un appareil de notes ; l'écran affiche les chiffres en puces
 * « source » sous la routine. Une routine dont un texte ne survivrait pas au
 * retrait (parce qu'il ne contenait que des marqueurs) est refusée comme une
 * routine hors format — c'est le même défaut, vu après nettoyage.
 */

import {
  type RoutineContent,
  type RoutineSource,
  routineContentSchema,
} from "../../shared/routine-contract.js";
import { extractJsonObject, summarizeIssues } from "../coach/parse.js";
import { unknownScenarioReason, unknownScenariosInTexts } from "../shared/scenarios.js";
import { type CitableFact, stripCitations, verifyCitations } from "./citations.js";

export type RoutineParse =
  | {
      readonly ok: true;
      /** La routine **sans** les marqueurs : ce qui sera enregistré et affiché. */
      readonly routine: RoutineContent;
      /** Les données citées et vérifiées, dans l'ordre de première apparition. */
      readonly sources: readonly RoutineSource[];
    }
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
  return unknownScenariosInTexts(routineTexts(routine), allowed);
}

/** La même routine, marqueurs de citation retirés de tous ses textes. */
export function stripRoutineCitations(routine: RoutineContent): RoutineContent {
  return {
    ...routine,
    titre: stripCitations(routine.titre),
    blocs: routine.blocs.map((bloc) => ({
      ...bloc,
      nom: stripCitations(bloc.nom),
      items: bloc.items.map((item) => ({
        texte: stripCitations(item.texte),
        detail: stripCitations(item.detail),
      })),
    })),
    objectif_game: stripCitations(routine.objectif_game),
    conseil: stripCitations(routine.conseil),
  };
}

/**
 * Le texte brut du modèle → une routine conforme au contrat, au palier **et**
 * aux données, ou la raison du refus.
 *
 * @param allowed Les noms exacts des scénarios du palier du joueur.
 * @param facts Le registre des chiffres citables, celui-là même qui a été
 *   montré au modèle (`citableFacts`). Vide par défaut : aucun chiffre à citer,
 *   donc aucune citation exigée — c'est l'état d'une routine bâtie sur rien
 *   d'autre que le temps disponible.
 */
export function parseRoutine(
  raw: string,
  allowed: readonly string[],
  facts: readonly CitableFact[] = [],
): RoutineParse {
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

  if (unknown.length > 0) return { ok: false, reason: unknownScenarioReason(unknown) };

  const citations = verifyCitations(routineTexts(parsed.data), facts);

  if (!citations.ok) return { ok: false, reason: citations.reason };

  const stripped = routineContentSchema.safeParse(stripRoutineCitations(parsed.data));

  if (!stripped.success) {
    return {
      ok: false,
      reason: `une fois les marqueurs de citation retirés, le JSON ne respecte plus le schéma (${summarizeIssues(stripped.error)}) : écris des phrases complètes autour des marqueurs`,
    };
  }
  return { ok: true, routine: stripped.data, sources: citations.sources };
}
