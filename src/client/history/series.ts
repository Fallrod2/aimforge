/**
 * Construction des séries du graphe de progression. Module pur : il ne fait
 * que réordonner et trouer des valeurs déjà calculées par le moteur d'énergie.
 */

import { getTierFor } from "../../lib/energy";
import type { BenchRunDetail, BenchRunSummary } from "../data";
import { formatChartDate } from "../format";

/**
 * Couleur officielle du rang d'une passe, ou `null` si aucun rang atteint.
 *
 * Les rangs et leurs couleurs sont lus dans la saison **de la passe** : après
 * la sortie de la S6, une passe S5 garde le rang et la couleur qu'elle a
 * toujours eus (SPEC §5 quinquies).
 */
export function runRankColor(run: BenchRunSummary): string | null {
  if (run.rank === null) return null;

  return (
    getTierFor(run.season, run.tier).overallRanks.find((rank) => rank.name === run.rank)?.color ??
    null
  );
}

/** Un point du graphe. `null` = pas de valeur traçable pour cette passe. */
export interface SeriesPoint {
  readonly id: number;
  /** Libellé de l'axe des abscisses (date courte). */
  readonly label: string;
  readonly date: string;
  /** Overall de la passe ; `null` si le bench est incomplet (overall à 0). */
  readonly overall: number | null;
  /** Énergie de la sous-catégorie suivie ; `null` si inconnue ou à 0. */
  readonly sub: number | null;
  readonly rank: string | null;
  readonly rankColor: string | null;
}

/**
 * Les passes dans l'ordre chronologique, prêtes pour Recharts.
 *
 * Un bench incomplet a un overall de 0 par définition : le tracer écraserait
 * la courbe, on le laisse en `null` — le graphe casse la ligne à cet endroit
 * (trou visible), tout en gardant la passe dans l'historique.
 */
export function buildSeries(
  runs: readonly BenchRunSummary[],
  details: ReadonlyMap<number, BenchRunDetail>,
  subcategory: string | null,
  timeZone?: string,
): readonly SeriesPoint[] {
  return [...runs]
    .sort((a, b) => a.date.localeCompare(b.date) || a.id - b.id)
    .map((run) => {
      const energy = subcategory
        ? details.get(run.id)?.subcategories.find((sub) => sub.name === subcategory)?.energy
        : undefined;

      return {
        id: run.id,
        label: formatChartDate(run.date, timeZone),
        date: run.date,
        overall: run.overall > 0 ? run.overall : null,
        sub: energy !== undefined && energy > 0 ? energy : null,
        rank: run.rank,
        rankColor: runRankColor(run),
      };
    });
}
