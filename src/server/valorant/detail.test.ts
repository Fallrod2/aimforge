import { describe, expect, it } from "vitest";
import { matchDetailSchema } from "../../shared/valorant-contract.js";
import { parseMatchDetail } from "./detail.js";

const PUUID = "puuid-du-joueur";

const MATCH_ID = "0f7d3b21-2f2c-4a6e-9a1b-8c2d5e6f7a8b";

/** Un joueur du scoreboard, dans la forme v4 de HenrikDev. */
function player(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    puuid: "puuid-quelconque",
    name: "Joueur",
    tag: "EUW",
    team_id: "Red",
    agent: { name: "Sova" },
    stats: {
      score: 4200,
      kills: 14,
      deaths: 15,
      assists: 6,
      headshots: 20,
      bodyshots: 60,
      legshots: 20,
      damage: { dealt: 2200 },
    },
    ...overrides,
  };
}

/**
 * Un round v4 : l'équipe gagnante, l'éventuelle pose (c'est elle qui désigne
 * l'attaque), et les statistiques par joueur.
 */
function round(
  winner: string,
  options: { readonly planter?: string; readonly defuser?: string; readonly kills?: number } = {},
): Record<string, unknown> {
  return {
    winning_team: winner,
    plant:
      options.planter === undefined ? null : { player: { puuid: "poseur", team: options.planter } },
    defuse:
      options.defuser === undefined
        ? null
        : { player: { puuid: "demineur", team: options.defuser } },
    stats: [
      {
        player: { puuid: PUUID, team: "Blue" },
        stats: {
          kills: options.kills ?? 1,
          damage: 150,
          headshots: 2,
          bodyshots: 6,
          legshots: 2,
        },
      },
    ],
  };
}

/** Une réponse v4 plausible : dix joueurs, deux équipes, un déroulé de rounds. */
function henrikDetail(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    metadata: {
      match_id: MATCH_ID,
      map: { name: "Ascent" },
      started_at: "2026-08-09T18:12:00.000Z",
      queue: { name: "Competitive" },
    },
    players: [
      player({ puuid: PUUID, name: "Moi", team_id: "Blue", agent: { name: "Jett" } }),
      ...Array.from({ length: 9 }, (_, index) => player({ puuid: `autre-${index}` })),
    ],
    teams: [
      { team_id: "Blue", won: true, rounds: { won: 13, lost: 8 } },
      { team_id: "Red", won: false, rounds: { won: 8, lost: 13 } },
    ],
    rounds: [
      // Première mi-temps : Blue pose, donc Blue attaque du round 1 au 12.
      round("Blue", { planter: "Blue", kills: 2 }),
      round("Red"),
      ...Array.from({ length: 10 }, () => round("Blue")),
      // Seconde mi-temps : Red pose, les côtés ont donc bien tourné.
      round("Red", { planter: "Red" }),
      ...Array.from({ length: 8 }, () => round("Blue")),
    ],
    ...overrides,
  };
}

describe("parseMatchDetail", () => {
  it("résume une réponse v4 complète et respecte son contrat", () => {
    const detail = parseMatchDetail(henrikDetail(), PUUID);

    expect(detail).not.toBeNull();
    expect(matchDetailSchema.safeParse(detail).success).toBe(true);
    expect(detail?.matchId).toBe(MATCH_ID);
    expect(detail?.map).toBe("Ascent");
    expect(detail?.team).toBe("bleue");
    expect(detail?.result).toBe("victoire");
    expect(detail?.roundsWon).toBe(13);
    expect(detail?.roundsLost).toBe(8);
    expect(detail?.rounds).toHaveLength(21);
  });

  it("rend un scoreboard de dix lignes, anonymisé, avec la ligne du joueur marquée", () => {
    const detail = parseMatchDetail(henrikDetail(), PUUID);
    const board = detail?.scoreboard ?? [];

    expect(board).toHaveLength(10);
    expect(board.filter((entry) => entry.isYou)).toHaveLength(1);
    // Ni PUUID, ni tag : le scoreboard sert à se situer, pas à pister.
    for (const entry of board) {
      expect(Object.keys(entry).sort()).toEqual([
        "adr",
        "agent",
        "assists",
        "deaths",
        "headshotPercent",
        "isYou",
        "kills",
        "name",
        "score",
        "team",
      ]);
    }

    const other = board.find((entry) => !entry.isYou);

    // 2 200 dégâts sur 21 rounds joués, et 20 têtes sur 100 tirs.
    expect(other?.adr).toBe(105);
    expect(other?.headshotPercent).toBe(20);
    expect(other?.team).toBe("rouge");
  });

  it("déduit le côté de chaque round de la pose, mi-temps par mi-temps", () => {
    const detail = parseMatchDetail(henrikDetail(), PUUID);
    const rounds = detail?.rounds ?? [];

    // Blue (notre équipe) pose au round 1 : toute la première mi-temps est en
    // attaque, et la seconde bascule en défense sur la pose de Red.
    expect(rounds[0]?.side).toBe("attaque");
    expect(rounds[11]?.side).toBe("attaque");
    expect(rounds[12]?.side).toBe("defense");
    expect(rounds[20]?.side).toBe("defense");
    expect(rounds[0]?.won).toBe(true);
    expect(rounds[1]?.won).toBe(false);
  });

  it("déduit aussi le côté d'un désamorçage, qui désigne la défense", () => {
    const detail = parseMatchDetail(
      henrikDetail({ rounds: [round("Blue", { defuser: "Blue" })] }),
      PUUID,
    );

    // C'est nous qui désamorçons : nous défendons, donc Red attaquait.
    expect(detail?.rounds[0]?.side).toBe("defense");
  });

  it("laisse le côté inconnu quand aucun round n'apporte de preuve", () => {
    const detail = parseMatchDetail(henrikDetail({ rounds: [round("Blue"), round("Red")] }), PUUID);

    expect(detail?.rounds.map((entry) => entry.side)).toEqual([null, null]);
    // Sans côté, aucune performance par côté : mieux vaut rien qu'à moitié faux.
    expect(detail?.sides).toEqual([]);
  });

  it("agrège la performance du joueur par côté", () => {
    const detail = parseMatchDetail(henrikDetail(), PUUID);
    const attack = detail?.sides.find((entry) => entry.side === "attaque");
    const defense = detail?.sides.find((entry) => entry.side === "defense");

    expect(attack?.rounds).toBe(12);
    expect(attack?.roundsWon).toBe(11);
    // 2 kills au premier round, 1 par round ensuite.
    expect(attack?.kills).toBe(13);
    expect(attack?.adr).toBe(150);
    expect(attack?.headshotPercent).toBe(20);
    expect(defense?.rounds).toBe(9);
    expect(defense?.roundsWon).toBe(8);
  });

  it("survit à une réponse où tout est absent sauf l'identifiant", () => {
    const detail = parseMatchDetail(
      {
        metadata: { match_id: MATCH_ID },
        players: [{ puuid: PUUID }],
      },
      PUUID,
    );

    expect(matchDetailSchema.safeParse(detail).success).toBe(true);
    expect(detail).toMatchObject({
      matchId: MATCH_ID,
      playedAt: null,
      map: null,
      mode: null,
      team: null,
      result: null,
      roundsWon: null,
      roundsLost: null,
      rounds: [],
      sides: [],
    });
    expect(detail?.scoreboard[0]).toMatchObject({ isYou: true, kills: null, adr: null });
  });

  it("survit à des champs nuls là où des objets sont attendus", () => {
    const detail = parseMatchDetail(
      {
        metadata: { match_id: MATCH_ID, map: null, queue: null, started_at: null },
        players: [{ puuid: PUUID, agent: null, stats: null, team_id: null }],
        teams: null,
        rounds: null,
      },
      PUUID,
    );

    expect(matchDetailSchema.safeParse(detail).success).toBe(true);
  });

  it("refuse une réponse hors forme et un match où le joueur n'apparaît pas", () => {
    // Pas d'identifiant de match : rien à mettre en cache.
    expect(parseMatchDetail({ metadata: {} }, PUUID)).toBeNull();
    expect(parseMatchDetail(null, PUUID)).toBeNull();
    expect(parseMatchDetail("une page d'erreur HTML", PUUID)).toBeNull();
    expect(parseMatchDetail(henrikDetail({ players: [player()] }), PUUID)).toBeNull();
  });

  it("date le match sur `game_start_iso` quand `started_at` manque", () => {
    const detail = parseMatchDetail(
      henrikDetail({
        metadata: { match_id: MATCH_ID, game_start_iso: "2026-08-01T10:00:00.000Z" },
      }),
      PUUID,
    );

    expect(detail?.playedAt).toBe("2026-08-01T10:00:00.000Z");
  });
});
