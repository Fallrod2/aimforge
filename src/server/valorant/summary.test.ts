import { describe, expect, it } from "vitest";
import {
  type HenrikMatch,
  henrikMatchSchema,
  summarizeMatch,
  summarizeMatches,
  summarizeMmr,
  toIsoOrNull,
} from "./summary";

const PUUID = "puuid-du-joueur";

/** Un match complet, tel que la source le sert dans le cas nominal. */
function match(overrides: Partial<HenrikMatch> = {}): HenrikMatch {
  return {
    metadata: {
      match_id: "m-1",
      map: { name: "Ascent" },
      started_at: "2026-08-01T18:30:00.000Z",
      queue: { name: "Competitive" },
    },
    players: [
      {
        puuid: PUUID,
        team_id: "Red",
        agent: { name: "Jett" },
        stats: {
          kills: 21,
          deaths: 14,
          assists: 4,
          headshots: 30,
          bodyshots: 60,
          legshots: 10,
          damage: { dealt: 4200 },
        },
      },
      { puuid: "autre", team_id: "Blue", agent: { name: "Sova" }, stats: { kills: 10 } },
    ],
    teams: [
      { team_id: "Red", won: true, rounds: { won: 13, lost: 8 } },
      { team_id: "Blue", won: false, rounds: { won: 8, lost: 13 } },
    ],
    ...overrides,
  };
}

describe("summarizeMatch", () => {
  it("résume la partie du point de vue du joueur demandé", () => {
    const summary = summarizeMatch(match(), PUUID);

    expect(summary).toEqual({
      matchId: "m-1",
      playedAt: "2026-08-01T18:30:00.000Z",
      map: "Ascent",
      mode: "Competitive",
      agent: "Jett",
      kills: 21,
      deaths: 14,
      assists: 4,
      // 4200 dégâts sur 21 rounds.
      adr: 200,
      // 30 têtes sur 100 tirs.
      headshotPercent: 30,
      roundsWon: 13,
      roundsLost: 8,
      result: "victoire",
    });
  });

  it("prend le point de vue de l'autre joueur si on le demande", () => {
    const summary = summarizeMatch(match(), "autre");

    expect(summary?.agent).toBe("Sova");
    expect(summary?.result).toBe("defaite");
  });

  it("rend null quand le joueur n'est pas dans la partie", () => {
    expect(summarizeMatch(match(), "inconnu")).toBeNull();
  });

  it("ne fabrique ni ADR ni HS% quand les rounds ou les tirs manquent", () => {
    const summary = summarizeMatch(
      match({
        players: [
          {
            puuid: PUUID,
            team_id: "Red",
            agent: { name: "Jett" },
            stats: {
              kills: 0,
              deaths: 0,
              headshots: 0,
              bodyshots: 0,
              legshots: 0,
              damage: { dealt: 0 },
            },
          },
        ],
        teams: [{ team_id: "Red", won: null, rounds: null }],
      }),
      PUUID,
    );

    expect(summary?.adr).toBeNull();
    expect(summary?.headshotPercent).toBeNull();
    expect(summary?.roundsWon).toBeNull();
    expect(summary?.result).toBeNull();
  });

  it("reconnaît une égalité même quand la source dit « perdu »", () => {
    const summary = summarizeMatch(
      match({
        teams: [
          { team_id: "Red", won: false, rounds: { won: 12, lost: 12 } },
          { team_id: "Blue", won: false, rounds: { won: 12, lost: 12 } },
        ],
      }),
      PUUID,
    );

    expect(summary?.result).toBe("egalite");
  });

  it("retombe sur les rounds quand le booléen de victoire manque", () => {
    const summary = summarizeMatch(
      match({
        teams: [
          { team_id: "Red", won: null, rounds: { won: 13, lost: 11 } },
          { team_id: "Blue", won: null, rounds: { won: 11, lost: 13 } },
        ],
      }),
      PUUID,
    );

    expect(summary?.result).toBe("victoire");
  });

  it("accepte l'horodatage sous son ancien nom", () => {
    const summary = summarizeMatch(
      match({
        metadata: {
          match_id: "m-2",
          map: { name: "Bind" },
          started_at: null,
          game_start_iso: "2026-07-30T10:00:00Z",
          queue: null,
        },
      }),
      PUUID,
    );

    expect(summary?.playedAt).toBe("2026-07-30T10:00:00.000Z");
    expect(summary?.mode).toBeNull();
  });
});

describe("summarizeMatches", () => {
  it("écarte les entrées illisibles sans perdre les autres", () => {
    const summaries = summarizeMatches([match(), { metadata: {} }, null, "bruit"], PUUID);

    expect(summaries).toHaveLength(1);
    expect(summaries[0]?.matchId).toBe("m-1");
  });

  it("écarte les parties où le joueur n'apparaît pas", () => {
    expect(summarizeMatches([match()], "inconnu")).toEqual([]);
  });
});

describe("summarizeMmr", () => {
  it("lit le rang courant", () => {
    const summary = summarizeMmr({
      current: { tier: { name: "Ascendant 2" }, rr: 43, last_change: -18, elo: 1543 },
    });

    expect(summary).toEqual({ tier: "Ascendant 2", rr: 43, lastChange: -18, elo: 1543 });
  });

  it("omet un RR hors bornes plutôt que de l'afficher", () => {
    expect(summarizeMmr({ current: { rr: 4312 } }).rr).toBeNull();
  });

  it("survit à une réponse vide", () => {
    expect(summarizeMmr({})).toEqual({ tier: null, rr: null, lastChange: null, elo: null });
  });
});

describe("toIsoOrNull", () => {
  it("normalise un horodatage lisible", () => {
    expect(toIsoOrNull("2026-08-01T18:30:00Z")).toBe("2026-08-01T18:30:00.000Z");
  });

  it("rend null sur une date illisible ou absente", () => {
    expect(toIsoOrNull("pas une date")).toBeNull();
    expect(toIsoOrNull(null)).toBeNull();
    expect(toIsoOrNull("  ")).toBeNull();
  });
});

describe("henrikMatchSchema", () => {
  it("exige un identifiant de match", () => {
    expect(henrikMatchSchema.safeParse({ metadata: { map: { name: "Ascent" } } }).success).toBe(
      false,
    );
  });

  it("accepte une partie réduite à son identifiant", () => {
    expect(henrikMatchSchema.safeParse({ metadata: { match_id: "m" } }).success).toBe(true);
  });
});
