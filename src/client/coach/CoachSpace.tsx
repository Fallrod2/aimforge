/**
 * L'espace Coach (V6) : la routine du jour, puis le fil.
 *
 * La routine était un septième onglet ; c'était la ranger comme une table de la
 * base plutôt que comme ce qu'elle est — **une réponse du coach à « je fais quoi
 * maintenant ? »**. Elle passe donc en tête de cet espace, et le fil, qui répond
 * à tout le reste, vit en dessous.
 *
 * L'ordre n'est pas décoratif : la routine est ce qu'on vient chercher le plus
 * souvent, et elle tient en un écran. Le fil, lui, grandit par le bas et se lit
 * en descendant — le mettre au-dessus aurait poussé la séance du jour hors de
 * l'écran à mesure que la conversation s'allonge.
 *
 * Les deux blocs restent **indépendants** : ils chargent chacun leurs données,
 * et l'échec de l'un n'emporte pas l'autre. Un coach injoignable ne doit pas
 * cacher une routine déjà générée.
 */

import { RoutinePanel } from "../routine/RoutinePanel";
import { CoachThreadView } from "./CoachThreadView";

export function CoachSpace() {
  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-lg font-semibold text-steel-100">Coach</h1>
        <p className="mt-0.5 text-xs text-steel-500">
          Ta séance du jour, et une conversation qui connaît tes parties et ton bench.
        </p>
      </div>

      <RoutinePanel />
      <CoachThreadView />
    </div>
  );
}
