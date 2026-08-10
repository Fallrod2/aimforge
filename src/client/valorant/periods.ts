/**
 * Les trois fenêtres de la vue Valorant (SPEC §5 sexies, V2) : 7 jours,
 * 30 jours, tout.
 *
 * Module pur. Il ne calcule **aucun agrégat** — ceux-là arrivent déjà faits de
 * `api/valorant/stats`, calculés par `src/server/valorant/aggregates.ts`, et
 * c'est important : ce sont les chiffres que le coach (V4) et la routine (V5)
 * citeront, donc ils n'ont qu'une source. Ce module ne fait que deux choses :
 * nommer les fenêtres pour le sélecteur, et **découper la série temporelle**
 * selon la même règle que le serveur découpe les périodes.
 *
 * Cette règle-là, en revanche, est recopiée — et elle doit l'être à
 * l'identique, sinon le graphe montrerait des parties que le compteur juste
 * au-dessus n'a pas comptées :
 *
 * 1. fenêtre **glissante à la milliseconde**, pas journée civile (le fuseau de
 *    l'utilisateur n'a pas à décider si sa partie d'hier soir compte encore) ;
 * 2. une partie **non datée** n'entre dans aucune fenêtre : elle compte dans
 *    « tout », jamais dans « 7 jours ». La placer d'office dans la fenêtre
 *    récente inventerait une activité.
 */

import type { StatPeriods, StatTotals, TrendPoint } from "../data";

const DAY_MS = 86_400_000;

/** Les clés du contrat, dans l'ordre de lecture du sélecteur. */
export const PERIOD_IDS = ["last7Days", "last30Days", "all"] as const;

export type PeriodId = (typeof PERIOD_IDS)[number];

/**
 * La largeur de chaque fenêtre en jours ; `null` pour « tout », qui n'en a pas.
 *
 * Les deux nombres sont ceux de `RECENT_WINDOW_DAYS` et `MONTH_WINDOW_DAYS`
 * côté serveur. Ils ne sont pas importés : `src/server/**` ne doit pas entrer
 * dans le bundle du navigateur. Le test de ce module les rappelle.
 */
export const PERIOD_DAYS: Readonly<Record<PeriodId, number | null>> = {
  last7Days: 7,
  last30Days: 30,
  all: null,
};

/** Les libellés du sélecteur : courts, ils vivent dans un segment. */
export const PERIOD_OPTIONS: readonly { readonly value: PeriodId; readonly label: string }[] = [
  { value: "last7Days", label: "7 j" },
  { value: "last30Days", label: "30 j" },
  { value: "all", label: "Tout" },
];

/** La phrase qui rappelle, sous les compteurs, ce qu'on est en train de lire. */
export const PERIOD_CAPTIONS: Readonly<Record<PeriodId, string>> = {
  last7Days: "sur les 7 derniers jours",
  last30Days: "sur les 30 derniers jours",
  all: "sur toutes les parties importées",
};

/** Les compteurs d'une fenêtre, pris tels quels dans la réponse du serveur. */
export function totalsFor(periods: StatPeriods, period: PeriodId): StatTotals {
  return periods[period];
}

/**
 * Les points de la série temporelle qui tombent dans la fenêtre.
 *
 * `all` rend la série entière, matchs non datés compris : ils sont à la fin
 * (l'agrégateur les y range) et le graphe les affiche sans date, ce qui est
 * exactement ce qu'on sait d'eux.
 */
export function trendWithin(
  trend: readonly TrendPoint[],
  period: PeriodId,
  now: Date = new Date(),
): readonly TrendPoint[] {
  const days = PERIOD_DAYS[period];

  if (days === null) return trend;

  const floor = now.getTime() - days * DAY_MS;

  return trend.filter((point) => {
    if (point.playedAt === null) return false;

    const time = Date.parse(point.playedAt);

    return !Number.isNaN(time) && time >= floor;
  });
}
