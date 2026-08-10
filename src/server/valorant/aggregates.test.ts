import { describe, expect, it } from "vitest";
import type { MatchSummary } from "../../client/data/linked-accounts-contract.js";
import { valorantStatsSchema } from "../../shared/valorant-contract.js";
import {
  aggregateValorant,
  MONTH_WINDOW_DAYS,
  RECENT_WINDOW_DAYS,
  recentCompetitiveCount,
  totalsOf,
  within,
} from "./aggregates.js";

/** L'instant de référence de tous les tests : les fenêtres sont glissantes. */
const NOW = new Date("2026-08-10T12:00:00.000Z");

/** Un match daté à `daysAgo` jours de `NOW`, complété par les champs donnés. */
function match(daysAgo: number | null, fields: Partial<MatchSummary> = {}): MatchSummary {
  return {
    matchId: fields.matchId ?? `match-${daysAgo ?? "sans-date"}-${JSON.stringify(fields.agent)}`,
    playedAt:
      daysAgo === null ? null : new Date(NOW.getTime() - daysAgo * 86_400_000).toISOString(),
    map: "Ascent",
    mode: "Competitive",
    agent: "Jett",
    kills: 20,
    deaths: 10,
    assists: 5,
    adr: 150,
    headshotPercent: 25,
    roundsWon: 13,
    roundsLost: 8,
    result: "victoire",
    ...fields,
  };
}

describe("totalsOf", () => {
  it("ne rend que des zéros et des inconnus sur une liste vide", () => {
    expect(totalsOf([])).toEqual({
      matches: 0,
      wins: 0,
      losses: 0,
      draws: 0,
      // Aucun match : le winrate n'existe pas, il ne vaut pas 0 %.
      winrate: null,
      kills: 0,
      deaths: 0,
      assists: 0,
      kd: null,
      headshotPercent: null,
      adr: null,
    });
  });

  it("compte un match unique sans moyenner quoi que ce soit", () => {
    const totals = totalsOf([match(1, { kills: 17, deaths: 13, assists: 4, adr: 142 })]);

    expect(totals.matches).toBe(1);
    expect(totals.wins).toBe(1);
    expect(totals.winrate).toBe(100);
    expect(totals.kd).toBe(round(17 / 13));
    expect(totals.adr).toBe(142);
  });

  it("calcule le winrate sur les seuls matchs au résultat connu", () => {
    const totals = totalsOf([
      match(1, { result: "victoire" }),
      match(2, { result: "defaite" }),
      match(3, { result: "egalite" }),
      // Résultat inconnu : il ne dilue pas le winrate.
      match(4, { result: null }),
    ]);

    expect(totals.matches).toBe(4);
    expect(totals.wins).toBe(1);
    expect(totals.losses).toBe(1);
    expect(totals.draws).toBe(1);
    expect(totals.winrate).toBe(round((1 / 3) * 100));
  });

  it("moyenne HS% et ADR sur les seuls matchs qui les portent", () => {
    const totals = totalsOf([
      match(1, { headshotPercent: 20, adr: 100 }),
      match(2, { headshotPercent: 30, adr: null }),
      match(3, { headshotPercent: null, adr: null }),
    ]);

    expect(totals.headshotPercent).toBe(25);
    // Un seul ADR connu : la moyenne est cet ADR, pas un tiers de sa valeur.
    expect(totals.adr).toBe(100);
  });

  it("rend un K/D inconnu quand aucune mort n'a été enregistrée", () => {
    expect(totalsOf([match(1, { kills: 12, deaths: 0 })]).kd).toBeNull();
  });
});

describe("within", () => {
  it("garde les matchs de la fenêtre et écarte ceux qui n'ont pas de date", () => {
    const recent = match(2, { matchId: "recent" });
    const old = match(20, { matchId: "vieux" });
    const undated = match(null, { matchId: "sans-date" });
    const kept = within([recent, old, undated], RECENT_WINDOW_DAYS, NOW);

    expect(kept.map((entry) => entry.matchId)).toEqual(["recent"]);
    expect(within([recent, old, undated], MONTH_WINDOW_DAYS, NOW)).toHaveLength(2);
  });
});

describe("recentCompetitiveCount", () => {
  it("compte le compétitif récent, quelle que soit l'orthographe du mode", () => {
    const matches = [
      match(1, { matchId: "a", mode: "Competitive" }),
      match(2, { matchId: "b", mode: "Compétitif" }),
      // Mode absent : l'import n'apporte que du compétitif, on ne l'écarte pas.
      match(3, { matchId: "c", mode: null }),
      match(4, { matchId: "d", mode: "Deathmatch" }),
      // Hors fenêtre.
      match(30, { matchId: "e", mode: "Competitive" }),
    ];

    expect(recentCompetitiveCount(matches, RECENT_WINDOW_DAYS, NOW)).toBe(3);
    expect(recentCompetitiveCount([], RECENT_WINDOW_DAYS, NOW)).toBe(0);
  });
});

describe("aggregateValorant", () => {
  it("respecte son propre contrat, même sur zéro match", () => {
    const stats = aggregateValorant([], { now: NOW });

    expect(valorantStatsSchema.safeParse(stats).success).toBe(true);
    expect(stats.byAgent).toEqual([]);
    expect(stats.byMap).toEqual([]);
    expect(stats.trend).toEqual([]);
  });

  it("sépare les trois fenêtres", () => {
    const stats = aggregateValorant(
      [match(1, { matchId: "a" }), match(10, { matchId: "b" }), match(100, { matchId: "c" })],
      { now: NOW },
    );

    expect(stats.periods.last7Days.matches).toBe(1);
    expect(stats.periods.last30Days.matches).toBe(2);
    expect(stats.periods.all.matches).toBe(3);
  });

  it("ventile par agent et par map, du plus joué au moins joué", () => {
    const stats = aggregateValorant(
      [
        match(1, { matchId: "a", agent: "Jett", map: "Ascent", result: "victoire" }),
        match(2, { matchId: "b", agent: "Jett", map: "Bind", result: "defaite" }),
        match(3, { matchId: "c", agent: "Raze", map: "Bind", result: "victoire" }),
        // Agent et map inconnus : ils ne créent pas de ligne « inconnu ».
        match(4, { matchId: "d", agent: null, map: null }),
      ],
      { now: NOW },
    );

    expect(stats.byAgent.map((entry) => entry.key)).toEqual(["Jett", "Raze"]);
    expect(stats.byAgent[0]?.totals.matches).toBe(2);
    expect(stats.byAgent[0]?.totals.winrate).toBe(50);
    expect(stats.byMap.map((entry) => entry.key)).toEqual(["Bind", "Ascent"]);
    expect(stats.byMap[0]?.totals.matches).toBe(2);
  });

  it("range la série du plus ancien au plus récent, les non datés à la fin", () => {
    const stats = aggregateValorant(
      [
        match(1, { matchId: "recent" }),
        match(null, { matchId: "sans-date" }),
        match(9, { matchId: "ancien" }),
      ],
      { now: NOW },
    );

    expect(stats.trend.map((point) => point.matchId)).toEqual(["ancien", "recent", "sans-date"]);
    expect(stats.trend.every((point) => point.rr === null)).toBe(true);
  });

  it("porte le RR quand l'appelant en a un pour ce match", () => {
    const stats = aggregateValorant([match(1, { matchId: "a" }), match(2, { matchId: "b" })], {
      now: NOW,
      rrByMatch: new Map([["a", -14]]),
    });

    expect(stats.trend.find((point) => point.matchId === "a")?.rr).toBe(-14);
    expect(stats.trend.find((point) => point.matchId === "b")?.rr).toBeNull();
  });
});

/** Le même arrondi que le module : une décimale. */
function round(value: number): number {
  return Math.round(value * 10) / 10;
}
