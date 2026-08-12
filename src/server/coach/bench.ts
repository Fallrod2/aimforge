/**
 * Résumé du dernier bench pour le prompt du coach. Module **pur** : il
 * s'appuie sur le moteur d'énergie (`src/lib/energy/`) et sur rien d'autre.
 *
 * Le coach n'a pas besoin des 18 scores — il a besoin de savoir où le joueur en
 * est (palier, overall, rang) et ce qui coince (les sous-catégories les plus
 * basses). Le reste ne ferait qu'allonger le prompt.
 *
 * Le palier (`tier`, et pas seulement son libellé) fait partie du résumé depuis
 * que le coach cite des scénarios : c'est lui qui choisit le catalogue autorisé.
 */

import {
  type BenchmarkId,
  computeSubcategoriesFor,
  getTierFor,
  scenarioNamesFor,
  type TierId,
} from "../../lib/energy/index.js";
import type { CoachBenchSummary, CoachTierBench, CoachWeakness } from "./prompt.js";

/** La passe telle que la base la rend, avant résumé. */
export interface BenchRunForCoach {
  readonly tier: TierId;
  /**
   * Le benchmark de la passe (SPEC §5 quinquies). Les 9 sous-catégories sont
   * dérivées ici, à la lecture : sans lui, le coach commenterait une passe
   * Voltaic S5 avec les seuils du benchmark courant — et dirait des choses
   * fausses.
   */
  readonly benchmarkId: BenchmarkId;
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
  const subcategories = computeSubcategoriesFor(run.benchmarkId, run.tier, scoreMap);

  return {
    tier: run.tier,
    tierLabel: getTierFor(run.benchmarkId, run.tier).label,
    date: run.date,
    overall: run.overall,
    rank: run.rank,
    complete: run.complete,
    weakest: weakest(subcategories, count),
  };
}

/**
 * Le même résumé, plus le benchmark de la passe et sa **complétude**.
 *
 * C'est la forme que le coach lit quand il regarde les paliers ensemble : sans
 * « 4 scénarios sur 18 », une passe en cours et un palier effondré s'écrivent de
 * la même façon (overall 0, aucun rang), et le modèle choisit mal lequel des
 * deux il raconte.
 *
 * Les scénarios comptés sont ceux **du palier de la passe** : un score d'un
 * autre palier, ou deux lignes pour le même scénario, ne gonflent pas le compte.
 */
export function summarizeTierBench(
  run: BenchRunForCoach,
  scores: readonly ScenarioScoreForCoach[],
  count = 3,
): CoachTierBench {
  const catalog = scenarioNamesFor(run.benchmarkId, run.tier);
  const filled = new Set(
    scores.flatMap((row) => (catalog.has(row.scenario) ? [row.scenario] : [])),
  );

  return {
    ...summarizeBench(run, scores, count),
    benchmarkId: run.benchmarkId,
    filled: filled.size,
    total: catalog.size,
  };
}
