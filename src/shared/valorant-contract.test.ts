import { describe, expect, it } from "vitest";
import {
  MATCH_ID_MAX,
  matchDetailRequestSchema,
  matchDetailResponseSchema,
  matchDetailSchema,
  scoreboardEntrySchema,
  statTotalsSchema,
  valorantErrorSchema,
  valorantStatsResponseSchema,
} from "./valorant-contract.js";

/** Un détail minimal mais valide : tout ce qui peut manquer manque. */
const DETAIL = {
  matchId: "0f7d3b21-2f2c-4a6e-9a1b-8c2d5e6f7a8b",
  playedAt: null,
  map: null,
  mode: null,
  team: null,
  result: null,
  roundsWon: null,
  roundsLost: null,
  scoreboard: [],
  rounds: [],
  sides: [],
};

describe("matchDetailRequestSchema", () => {
  it("accepte un identifiant de match et le débarrasse de ses espaces", () => {
    expect(matchDetailRequestSchema.parse({ match_id: "  abc  " })).toEqual({ match_id: "abc" });
  });

  it("refuse le vide, l'absence et les identifiants démesurés", () => {
    expect(matchDetailRequestSchema.safeParse({}).success).toBe(false);
    expect(matchDetailRequestSchema.safeParse({ match_id: "   " }).success).toBe(false);
    expect(
      matchDetailRequestSchema.safeParse({ match_id: "x".repeat(MATCH_ID_MAX + 1) }).success,
    ).toBe(false);
  });
});

describe("matchDetailSchema", () => {
  it("accepte un détail où tout est inconnu sauf l'identifiant", () => {
    expect(matchDetailSchema.safeParse(DETAIL).success).toBe(true);
  });

  it("refuse un vocabulaire qui n'est pas le sien", () => {
    expect(matchDetailSchema.safeParse({ ...DETAIL, team: "verte" }).success).toBe(false);
    expect(matchDetailSchema.safeParse({ ...DETAIL, result: "nul" }).success).toBe(false);
    expect(
      matchDetailSchema.safeParse({
        ...DETAIL,
        rounds: [{ index: 0, won: true, side: "attaque" }],
      }).success,
    ).toBe(false);
    expect(
      matchDetailSchema.safeParse({
        ...DETAIL,
        sides: [{ side: "milieu", rounds: 1, roundsWon: 1, kills: 1, adr: 1, headshotPercent: 1 }],
      }).success,
    ).toBe(false);
  });

  it("borne le pourcentage de tirs à la tête d'une ligne de scoreboard", () => {
    const entry = {
      name: "Moi",
      agent: "Jett",
      team: "bleue",
      isYou: true,
      score: 5200,
      kills: 18,
      deaths: 14,
      assists: 5,
      adr: 152,
      headshotPercent: 21,
    };

    expect(scoreboardEntrySchema.safeParse(entry).success).toBe(true);
    expect(scoreboardEntrySchema.safeParse({ ...entry, headshotPercent: 140 }).success).toBe(false);
    // `isYou` n'est pas optionnel : sans lui, aucune ligne ne serait la sienne.
    expect(scoreboardEntrySchema.safeParse({ ...entry, isYou: undefined }).success).toBe(false);
  });

  it("valide une réponse complète de la fonction", () => {
    expect(matchDetailResponseSchema.safeParse({ cached: true, detail: DETAIL }).success).toBe(
      true,
    );
    expect(matchDetailResponseSchema.safeParse({ detail: DETAIL }).success).toBe(false);
  });
});

describe("statTotalsSchema", () => {
  const totals = {
    matches: 0,
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

  it("accepte des compteurs vides avec des moyennes inconnues", () => {
    expect(statTotalsSchema.safeParse(totals).success).toBe(true);
  });

  it("refuse un winrate hors bornes", () => {
    expect(statTotalsSchema.safeParse({ ...totals, winrate: 140 }).success).toBe(false);
    expect(statTotalsSchema.safeParse({ ...totals, winrate: -1 }).success).toBe(false);
  });

  it("valide la réponse d'un profil sans compte lié", () => {
    const empty = {
      accountId: null,
      matchCount: 0,
      stats: {
        periods: { last7Days: totals, last30Days: totals, all: totals },
        byAgent: [],
        byMap: [],
        trend: [],
      },
    };

    expect(valorantStatsResponseSchema.safeParse(empty).success).toBe(true);
  });
});

describe("valorantErrorSchema", () => {
  it("exige un message non vide", () => {
    expect(valorantErrorSchema.safeParse({ error: "Cette partie est introuvable." }).success).toBe(
      true,
    );
    expect(valorantErrorSchema.safeParse({ error: "" }).success).toBe(false);
  });
});
