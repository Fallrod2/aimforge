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

import { type BenchmarkId, getTierFor, type TierId } from "../../lib/energy/index.js";
import {
  type BenchRunForCoach,
  type ScenarioScoreForCoach,
  summarizeBench,
  summarizeTierBench,
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

/** La dernière passe d'un palier, vue par la routine. */
export interface RoutineTierBench extends RoutineBenchSummary {
  /** Le benchmark de la passe : chaque palier garde le sien. */
  readonly benchmarkId: BenchmarkId;
  /** Scénarios renseignés dans la passe. */
  readonly filled: number;
  /** Scénarios du palier (18 sur le benchmark Voltaic). */
  readonly total: number;
}

/**
 * Les benchs du joueur : la dernière passe de chaque palier mesuré.
 *
 * La routine en a besoin pour la même raison que le coach, mais elle en fait un
 * autre usage : c'est ce qui lui permet de **viser le bon palier** — travailler
 * celui qui est en cours sans oublier qu'un palier terminé plafonne déjà.
 */
export interface RoutineBenchTiers {
  /** Du palier le plus bas au plus haut ; seuls ceux qui ont une passe. */
  readonly tiers: readonly RoutineTierBench[];
  /** Le palier de la passe la plus récente ; `null` sans aucune passe. */
  readonly latestTier: TierId | null;
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
  benchmarkId: BenchmarkId,
  tier: TierId,
  energy: number,
): { readonly name: string; readonly minEnergy: number } | null {
  const found = getTierFor(benchmarkId, tier).overallRanks.find((rank) => rank.minEnergy > energy);

  return found === undefined ? null : { name: found.name, minEnergy: found.minEnergy };
}

/**
 * Résume le dernier bench pour la routine : faiblesses + écart au rang suivant.
 *
 * Le rang overall n'est pas recalculé — il est lu tel quel dans la colonne
 * `rank`, comme le fait le coach. Les rangs *parcourus* pour l'écart, eux,
 * viennent du benchmark de la passe : c'est ce qui rend « 99 d'énergie sous
 * Platinum » vrai plutôt qu'approximatif après un changement de benchmark.
 */
export function summarizeBenchForRoutine(
  run: BenchRunForCoach,
  scores: readonly ScenarioScoreForCoach[],
  count = 3,
): RoutineBenchSummary {
  const summary = summarizeBench(run, scores, count);

  // Lève tôt (et une seule fois) si le benchmark ou le palier est inconnu,
  // plutôt qu'au milieu de la boucle ci-dessous.
  getTierFor(run.benchmarkId, run.tier);

  return {
    tier: run.tier,
    tierLabel: summary.tierLabel,
    date: summary.date,
    overall: summary.overall,
    rank: summary.rank,
    complete: summary.complete,
    weakest: summary.weakest.map((weakness) => {
      const next = nextRankAbove(run.benchmarkId, run.tier, weakness.energy);

      return {
        name: weakness.name,
        energy: weakness.energy,
        nextRank: next?.name ?? null,
        gap: next === null ? null : next.minEnergy - weakness.energy,
      };
    }),
  };
}

/**
 * Le même résumé, plus le benchmark et la complétude de la passe.
 *
 * Il complète `summarizeBenchForRoutine` au lieu de le refaire : la complétude
 * et le benchmark sont comptés par le module du coach (`summarizeTierBench`), les
 * écarts au rang suivant restent ici. Une passe se résume donc d'une seule
 * façon, quel que soit celui des deux prompts qui la lit.
 */
export function summarizeTierBenchForRoutine(
  run: BenchRunForCoach,
  scores: readonly ScenarioScoreForCoach[],
  count = 3,
): RoutineTierBench {
  const tierSummary = summarizeTierBench(run, scores, count);

  return {
    ...summarizeBenchForRoutine(run, scores, count),
    benchmarkId: tierSummary.benchmarkId,
    filled: tierSummary.filled,
    total: tierSummary.total,
  };
}
