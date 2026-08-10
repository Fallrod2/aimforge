/**
 * Le dernier bench vu par la Routine : les mêmes faiblesses que pour le coach,
 * plus **l'écart au prochain rang**.
 *
 * Le résumé n'est pas recalculé ici : `summarizeBench` (module du coach) le
 * fait déjà, à partir du moteur d'énergie. Ce module l'appelle et l'enrichit —
 * il n'y a qu'une définition de « sous-catégorie faible » dans le projet, et
 * elle ne peut donc pas diverger entre les deux fonctions IA.
 *
 * L'écart, lui, est propre à la routine : le coach explique une partie, la
 * routine doit dire ce qu'il reste à gagner. Il est défini comme la différence
 * entre l'énergie de la sous-catégorie et le `minEnergy` du **prochain rang du
 * palier** — c'est ce qui transforme « Precise : 401 » en « 99 d'énergie sous
 * Platinum », soit un objectif de séance plutôt qu'un constat.
 *
 * Module **pur** : moteur d'énergie et module du coach, rien d'autre.
 */

import { getTierFor, type SeasonId, type TierId } from "../../lib/energy/index.js";
import {
  type BenchRunForCoach,
  type ScenarioScoreForCoach,
  summarizeBench,
} from "../coach/bench.js";

/** Une sous-catégorie faible, et ce qui la sépare du rang suivant. */
export interface RoutineWeakness {
  readonly name: string;
  readonly energy: number;
  /** Le prochain rang du palier ; `null` au-delà du dernier rang. */
  readonly nextRank: string | null;
  /** Énergie manquante pour l'atteindre ; `null` s'il n'y a pas de rang suivant. */
  readonly gap: number | null;
}

/** Le dernier bench, résumé pour la routine. */
export interface RoutineBenchSummary {
  readonly tier: TierId;
  /** Libellé du palier (« Novice », « Intermediate »…). */
  readonly tierLabel: string;
  /** Horodatage ISO 8601 de la passe. */
  readonly date: string;
  readonly overall: number;
  readonly rank: string | null;
  readonly complete: boolean;
  /** Les sous-catégories les plus basses, de la plus basse à la moins basse. */
  readonly weakest: readonly RoutineWeakness[];
}

/**
 * Le prochain rang du palier au-dessus d'une énergie donnée.
 *
 * Les rangs du JSON sont ordonnés par `minEnergy` croissant : le premier dont
 * le seuil dépasse strictement l'énergie est le suivant. Au sommet du palier,
 * il n'y en a plus — et c'est une information, pas un trou : cette
 * sous-catégorie n'est plus le frein.
 */
export function nextRankAbove(
  season: SeasonId,
  tier: TierId,
  energy: number,
): { readonly name: string; readonly minEnergy: number } | null {
  const found = getTierFor(season, tier).overallRanks.find((rank) => rank.minEnergy > energy);

  return found === undefined ? null : { name: found.name, minEnergy: found.minEnergy };
}

/**
 * Résume le dernier bench pour la routine : faiblesses + écart au rang suivant.
 *
 * Le rang overall n'est pas recalculé — il est lu tel quel dans la colonne
 * `rank`, comme le fait le coach. Les rangs *parcourus* pour l'écart, eux,
 * viennent de la saison de la passe : c'est ce qui rend « 99 d'énergie sous
 * Platinum » vrai plutôt qu'approximatif après un changement de saison.
 */
export function summarizeBenchForRoutine(
  run: BenchRunForCoach,
  scores: readonly ScenarioScoreForCoach[],
  count = 3,
): RoutineBenchSummary {
  const summary = summarizeBench(run, scores, count);

  // Lève tôt (et une seule fois) si la saison ou le palier est inconnu, plutôt
  // qu'au milieu de la boucle ci-dessous.
  getTierFor(run.season, run.tier);

  return {
    tier: run.tier,
    tierLabel: summary.tierLabel,
    date: summary.date,
    overall: summary.overall,
    rank: summary.rank,
    complete: summary.complete,
    weakest: summary.weakest.map((weakness) => {
      const next = nextRankAbove(run.season, run.tier, weakness.energy);

      return {
        name: weakness.name,
        energy: weakness.energy,
        nextRank: next?.name ?? null,
        gap: next === null ? null : next.minEnergy - weakness.energy,
      };
    }),
  };
}
