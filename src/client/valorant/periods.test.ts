import { describe, expect, it } from "vitest";
import { MONTH_WINDOW_DAYS, RECENT_WINDOW_DAYS } from "../../server/valorant/aggregates";
import type { StatPeriods, StatTotals, TrendPoint } from "../data";
import {
  PERIOD_CAPTIONS,
  PERIOD_DAYS,
  PERIOD_IDS,
  PERIOD_OPTIONS,
  type PeriodId,
  totalsFor,
  trendWithin,
} from "./periods";

const NOW = new Date("2026-08-10T12:00:00.000Z");

function daysAgo(days: number): string {
  return new Date(NOW.getTime() - days * 86_400_000).toISOString();
}

function point(playedAt: string | null, matchId = playedAt ?? "sans-date"): TrendPoint {
  return {
    matchId,
    playedAt,
    map: null,
    agent: null,
    headshotPercent: null,
    adr: null,
    result: null,
    rr: null,
  };
}

function totals(matches: number): StatTotals {
  return {
    matches,
    wins: 0,
    losses: 0,
    draws: 0,
    winrate: null,
    kills: 0,
    deaths: 0,
    assists: 0,
    kd: null,
    headshotPercent: null,
    adr: null,
  };
}

describe("les fenêtres", () => {
  it("nomme les trois clés du contrat, et rien d'autre", () => {
    expect([...PERIOD_IDS]).toEqual(["last7Days", "last30Days", "all"]);
    expect(PERIOD_OPTIONS.map((option) => option.value)).toEqual([...PERIOD_IDS]);
    expect(Object.keys(PERIOD_CAPTIONS).sort()).toEqual([...PERIOD_IDS].sort());
  });

  /**
   * La garde qui compte : le graphe et les compteurs doivent découper les mêmes
   * jours. Si le serveur change une fenêtre, ce test tombe ici, pas en prod.
   */
  it("reprend exactement les largeurs de fenêtre du serveur", () => {
    expect(PERIOD_DAYS.last7Days).toBe(RECENT_WINDOW_DAYS);
    expect(PERIOD_DAYS.last30Days).toBe(MONTH_WINDOW_DAYS);
    expect(PERIOD_DAYS.all).toBeNull();
  });
});

describe("totalsFor", () => {
  it("rend les compteurs de la fenêtre demandée, sans les recalculer", () => {
    const periods: StatPeriods = {
      last7Days: totals(3),
      last30Days: totals(11),
      all: totals(42),
    };

    expect(totalsFor(periods, "last7Days").matches).toBe(3);
    expect(totalsFor(periods, "last30Days").matches).toBe(11);
    expect(totalsFor(periods, "all").matches).toBe(42);
  });
});

describe("trendWithin", () => {
  const trend: readonly TrendPoint[] = [
    point(daysAgo(40), "vieux"),
    point(daysAgo(20), "mois"),
    point(daysAgo(3), "semaine"),
    point(null, "sans-date"),
  ];

  it("garde tout, matchs non datés compris, sur « tout »", () => {
    expect(trendWithin(trend, "all", NOW).map((entry) => entry.matchId)).toEqual([
      "vieux",
      "mois",
      "semaine",
      "sans-date",
    ]);
  });

  it("ne garde que les parties des 7 derniers jours", () => {
    expect(trendWithin(trend, "last7Days", NOW).map((entry) => entry.matchId)).toEqual(["semaine"]);
  });

  it("ne garde que les parties des 30 derniers jours", () => {
    expect(trendWithin(trend, "last30Days", NOW).map((entry) => entry.matchId)).toEqual([
      "mois",
      "semaine",
    ]);
  });

  /**
   * « Pas de date » n'est pas « aujourd'hui » : une partie sans horodatage
   * gonflerait la fenêtre récente d'une activité qui n'a peut-être pas eu lieu.
   */
  it("écarte les parties non datées de toute fenêtre glissante", () => {
    for (const period of ["last7Days", "last30Days"] satisfies PeriodId[]) {
      expect(trendWithin([point(null)], period, NOW), period).toEqual([]);
    }
    expect(trendWithin([point(null)], "all", NOW)).toHaveLength(1);
  });

  it("écarte une date illisible comme une date absente", () => {
    expect(trendWithin([point("pas une date")], "last7Days", NOW)).toEqual([]);
  });

  it("est glissante à la milliseconde, pas par journée civile", () => {
    const justInside = point(new Date(NOW.getTime() - 7 * 86_400_000 + 1).toISOString(), "dedans");
    const justOutside = point(new Date(NOW.getTime() - 7 * 86_400_000 - 1).toISOString(), "dehors");

    expect(
      trendWithin([justOutside, justInside], "last7Days", NOW).map((entry) => entry.matchId),
    ).toEqual(["dedans"]);
  });

  it("conserve l'ordre de la série (du plus ancien au plus récent)", () => {
    const filtered = trendWithin(trend, "last30Days", NOW);

    expect(filtered.map((entry) => entry.playedAt)).toEqual([daysAgo(20), daysAgo(3)]);
  });
});
