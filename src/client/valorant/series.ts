/**
 * Préparation des séries « match après match » (SPEC §5 sexies, V2).
 *
 * Module pur : il ne fait que remettre en forme la série temporelle rendue par
 * `api/valorant/stats`. Trois décisions y sont prises, et elles se voient dans
 * le graphe.
 *
 * **1. L'axe des abscisses est l'ordre des parties, pas le temps.** Une soirée
 * de cinq parties d'affilée et une semaine de silence n'ont pas à se disputer
 * la même largeur : ce que l'écran raconte, c'est « partie après partie ». Le
 * libellé, lui, reste une date — c'est ce qu'on cherche du regard.
 *
 * **2. Le résultat est encodé sur le point, pas sur la ligne.** La ligne relie
 * les valeurs (elle porte la tendance, en gris) ; le point porte l'issue de la
 * partie. D'où trois colonnes séparées — `win`, `loss`, `other` — plutôt qu'une
 * couleur calculée au rendu : c'est ce découpage qui permet de tracer trois
 * séries de points sans jamais recolorer une ligne, et il est testable.
 *
 * **3. `null` reste `null`.** Une partie sans HS% connu ne vaut pas 0 : elle
 * troue la ligne, ce qui est la vérité. Une partie sans ADR ne descend pas la
 * courbe d'ADR, elle en sort.
 *
 * Le troisième état (`other`) couvre l'égalité **et** le résultat inconnu. Ils
 * partagent un point creux plutôt qu'une troisième couleur : la palette du
 * projet n'a que deux teintes de série validées pour la vision des couleurs
 * (braise et acier trempé) et un gris ajouté comme troisième catégorie tombe
 * sous le seuil de séparation. Une forme distincte fait le travail qu'une
 * couleur ne peut pas faire ici.
 */

import type { TrendPoint } from "../data";
import { formatChartDate } from "../format";

/** Ce qu'un graphe de tendance peut tracer aujourd'hui. */
export type MatchMetric = "headshotPercent" | "adr";

/** Un point de la série, avant découpage par résultat. */
export interface TrendSeriesPoint {
  readonly matchId: string;
  /** Rang de la partie dans la fenêtre, à partir de 1 : l'abscisse réelle. */
  readonly order: number;
  /** Libellé de l'axe : la date courte, ou `—` pour une partie non datée. */
  readonly label: string;
  readonly playedAt: string | null;
  readonly map: string | null;
  readonly agent: string | null;
  readonly headshotPercent: number | null;
  readonly adr: number | null;
  readonly result: TrendPoint["result"];
}

/** Un point prêt pour Recharts : la valeur, plus ses trois déclinaisons. */
export interface MetricPoint extends TrendSeriesPoint {
  /** La valeur de la mesure suivie ; `null` = trou dans la ligne. */
  readonly value: number | null;
  /** La même valeur, portée par la seule série qui correspond au résultat. */
  readonly win: number | null;
  readonly loss: number | null;
  /** Égalité ou résultat inconnu : un point creux, pas une troisième couleur. */
  readonly other: number | null;
}

const NO_DATE = "—";

/**
 * La série d'affichage : l'ordre du serveur (du plus ancien au plus récent) est
 * conservé tel quel, il fait foi.
 */
export function buildTrendSeries(
  trend: readonly TrendPoint[],
  timeZone?: string,
): readonly TrendSeriesPoint[] {
  return trend.map((point, index) => ({
    matchId: point.matchId,
    order: index + 1,
    label: point.playedAt === null ? NO_DATE : chartDate(point.playedAt, timeZone),
    playedAt: point.playedAt,
    map: point.map,
    agent: point.agent,
    headshotPercent: point.headshotPercent,
    adr: point.adr,
    result: point.result,
  }));
}

/** Une date illisible se dit comme une date absente plutôt que « Invalid Date ». */
function chartDate(iso: string, timeZone?: string): string {
  return Number.isNaN(Date.parse(iso)) ? NO_DATE : formatChartDate(iso, timeZone);
}

/**
 * La série d'une mesure, découpée par résultat.
 *
 * Un point sans valeur n'est dans aucune des trois colonnes : il ne doit ni
 * tracer un zéro, ni poser un marqueur de victoire à hauteur nulle.
 */
export function metricSeries(
  points: readonly TrendSeriesPoint[],
  metric: MatchMetric,
): readonly MetricPoint[] {
  return points.map((point) => {
    const value = point[metric];
    const won = value !== null && point.result === "victoire";
    const lost = value !== null && point.result === "defaite";

    return {
      ...point,
      value,
      win: won ? value : null,
      loss: lost ? value : null,
      other: value !== null && !won && !lost ? value : null,
    };
  });
}

/** Y a-t-il quelque chose à tracer ? Sinon l'écran dit pourquoi, sans graphe. */
export function hasValues(points: readonly TrendSeriesPoint[], metric: MatchMetric): boolean {
  return points.some((point) => point[metric] !== null);
}
