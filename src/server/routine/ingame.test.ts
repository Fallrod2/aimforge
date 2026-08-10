/**
 * Les stats in-game vues par la routine (SPEC §5 sexies, V5).
 *
 * Ce module ne calcule rien lui-même : ce qui se prouve ici est donc ce qu'il
 * **choisit** — la fenêtre de 30 jours, les maps qui ont assez de parties pour
 * qu'un winrate veuille dire quelque chose, et le fait qu'une moyenne inconnue
 * reste `null` au lieu de devenir zéro.
 */

import { describe, expect, it } from "vitest";
import type { MatchSummary } from "../../client/data/linked-accounts-contract";
import {
  MIN_MAP_MATCHES,
  ROUTINE_INGAME_WINDOW_DAYS,
  summarizeIngameForRoutine,
  WORST_MAP_COUNT,
} from "./ingame";

const NOW = new Date("2026-08-10T12:00:00.000Z");
const DAY_MS = 86_400_000;

let counter = 0;

function match(fields: Partial<MatchSummary> = {}): MatchSummary {
  counter += 1;
  return {
    matchId: `match-${counter}`,
    playedAt: new Date(NOW.getTime() - DAY_MS).toISOString(),
    map: "Ascent",
    mode: "Compétitif",
    agent: "Jett",
    kills: 20,
    deaths: 10,
    assists: 4,
    adr: 150,
    headshotPercent: 20,
    roundsWon: 13,
    roundsLost: 11,
    result: "victoire",
    ...fields,
  };
}

function onMap(map: string, results: readonly MatchSummary["result"][]): readonly MatchSummary[] {
  return results.map((result) => match({ map, result }));
}

describe("summarizeIngameForRoutine", () => {
  it("annonce la fenêtre et ne compte que les parties qui y tombent", () => {
    const summary = summarizeIngameForRoutine(
      [
        match(),
        match({
          playedAt: new Date(
            NOW.getTime() - (ROUTINE_INGAME_WINDOW_DAYS + 1) * DAY_MS,
          ).toISOString(),
        }),
      ],
      NOW,
    );

    expect(summary.windowDays).toBe(ROUTINE_INGAME_WINDOW_DAYS);
    expect(summary.matches).toBe(1);
  });

  it("reprend les moyennes de l'agrégateur, sans les recalculer autrement", () => {
    const summary = summarizeIngameForRoutine(
      [
        match({ result: "victoire", headshotPercent: 20, adr: 140, kills: 20, deaths: 10 }),
        match({ result: "defaite", headshotPercent: 30, adr: 160, kills: 10, deaths: 10 }),
      ],
      NOW,
    );

    expect(summary.winrate).toBe(50);
    expect(summary.headshotPercent).toBe(25);
    expect(summary.adr).toBe(150);
    expect(summary.kd).toBe(1.5);
  });

  it("rend `null` plutôt que zéro quand une moyenne n'est pas connue", () => {
    const summary = summarizeIngameForRoutine([match({ adr: null, headshotPercent: null })], NOW);

    expect(summary.adr).toBeNull();
    expect(summary.headshotPercent).toBeNull();
  });

  it("classe les pires maps du winrate le plus bas au moins bas", () => {
    const summary = summarizeIngameForRoutine(
      [
        ...onMap("Icebox", ["defaite", "defaite", "defaite", "defaite"]),
        ...onMap("Bind", ["defaite", "defaite", "victoire", "victoire"]),
        ...onMap("Ascent", ["victoire", "victoire", "victoire", "defaite"]),
      ],
      NOW,
    );

    expect(summary.worstMaps).toEqual([
      { map: "Icebox", matches: 4, winrate: 0 },
      { map: "Bind", matches: 4, winrate: 50 },
      { map: "Ascent", matches: 4, winrate: 75 },
    ]);
  });

  it("écarte une map jouée trop peu : deux défaites ne sont pas une faiblesse de map", () => {
    const played = Array.from({ length: MIN_MAP_MATCHES - 1 }, () =>
      match({ map: "Lotus", result: "defaite" }),
    );
    const summary = summarizeIngameForRoutine(
      [...played, ...onMap("Ascent", ["victoire", "victoire", "defaite"])],
      NOW,
    );

    expect(summary.worstMaps.map((entry) => entry.map)).toEqual(["Ascent"]);
  });

  it("ne remonte jamais plus de trois maps", () => {
    const summary = summarizeIngameForRoutine(
      ["Icebox", "Bind", "Ascent", "Lotus", "Split"].flatMap((map) =>
        onMap(map, ["defaite", "defaite", "victoire"]),
      ),
      NOW,
    );

    expect(summary.worstMaps).toHaveLength(WORST_MAP_COUNT);
  });

  it("rend une liste de maps vide plutôt qu'une map inventée quand rien n'est concluant", () => {
    expect(summarizeIngameForRoutine([match()], NOW).worstMaps).toEqual([]);
  });
});
