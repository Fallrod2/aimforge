/**
 * Résumé du dernier bench pour le prompt du coach. Module **pur** : il
 * s'appuie sur le moteur d'énergie (`src/lib/energy/`) et sur rien d'autre.
 *
 * Le coach n'a pas besoin des 18 scénarios — il a besoin de savoir où le
 * joueur en est (palier, overall, rang) et ce qui coince (les sous-catégories
 * les plus basses). Le reste ne ferait qu'allonger le prompt.
 */

import { computeSubcategories, getTier, type TierId } from "../../lib/energy";
import type { CoachBenchSummary, CoachWeakness } from "./prompt";

/** La passe telle que la base la rend, avant résumé. */
export interface BenchRunForCoach {
  readonly tier: TierId;
  /** Horodatage ISO 8601. */
  readonly date: string;
  readonly overall: number;
  readonly rank: string | null;
  readonly complete: boolean;
}

export interface ScenarioScoreForCoach {
  readonly scenario: string;
  readonly score: number;
}

/**
 * Les sous-catégories les plus basses, de la plus basse à la moins basse.
 *
 * Le tri (énergie croissante, alphabétique à égalité) est le même que celui du
 * dashboard (`src/client/dashboard/summary.ts`). Il est réécrit ici plutôt
 * qu'importé : une fonction serveur qui va chercher son tri dans le dossier du
 * navigateur créerait une dépendance à contresens pour trois lignes.
 */
function weakest(subcategories: readonly CoachWeakness[], count: number): readonly CoachWeakness[] {
  return [...subcategories]
    .sort((a, b) => a.energy - b.energy || a.name.localeCompare(b.name, "fr"))
    .slice(0, Math.max(0, count));
}

export function summarizeBench(
  run: BenchRunForCoach,
  scores: readonly ScenarioScoreForCoach[],
  count = 3,
): CoachBenchSummary {
  const scoreMap = Object.fromEntries(scores.map((row) => [row.scenario, row.score]));
  const subcategories = computeSubcategories(run.tier, scoreMap);

  return {
    tierLabel: getTier(run.tier).label,
    date: run.date,
    overall: run.overall,
    rank: run.rank,
    complete: run.complete,
    weakest: weakest(subcategories, count),
  };
}
