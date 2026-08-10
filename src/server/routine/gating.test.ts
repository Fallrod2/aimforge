/**
 * Le gating de la routine (SPEC §5 sexies, V5), prouvé aux bornes : le nombre
 * de parties (4 contre 5) et la fenêtre de 14 jours, au jour près.
 *
 * L'horloge est injectée, donc ces cas ne dépendent pas du moment où la suite
 * tourne — c'est toute la raison pour laquelle `gateRoutine` prend un `now`.
 */

import { describe, expect, it } from "vitest";
import type { MatchSummary } from "../../client/data/linked-accounts-contract";
import {
  ROUTINE_MIN_RECENT_MATCHES,
  ROUTINE_RECENT_WINDOW_DAYS,
} from "../../shared/routine-contract";
import { gateRoutine } from "./gating";

const NOW = new Date("2026-08-10T12:00:00.000Z");
const DAY_MS = 86_400_000;

function match(fields: Partial<MatchSummary> = {}): MatchSummary {
  return {
    matchId: `match-${Math.random()}`,
    playedAt: new Date(NOW.getTime() - DAY_MS).toISOString(),
    map: "Ascent",
    mode: "Compétitif",
    agent: "Jett",
    kills: 18,
    deaths: 14,
    assists: 5,
    adr: 150,
    headshotPercent: 22,
    roundsWon: 13,
    roundsLost: 11,
    result: "victoire",
    ...fields,
  };
}

/** `count` parties jouées il y a `daysAgo` jours. */
function played(count: number, daysAgo = 1): readonly MatchSummary[] {
  return Array.from({ length: count }, () =>
    match({ playedAt: new Date(NOW.getTime() - daysAgo * DAY_MS).toISOString() }),
  );
}

describe("gateRoutine", () => {
  it("bascule en bench seul quand rien n'a été importé", () => {
    expect(gateRoutine([], NOW)).toEqual({ mode: "bench_only", matchesUsed: 0, missing: 5 });
  });

  it("reste en bench seul à une partie près du seuil, et dit combien il en manque", () => {
    expect(gateRoutine(played(ROUTINE_MIN_RECENT_MATCHES - 1), NOW)).toEqual({
      mode: "bench_only",
      matchesUsed: 4,
      missing: 1,
    });
  });

  it("passe en mode complet exactement au seuil", () => {
    expect(gateRoutine(played(ROUTINE_MIN_RECENT_MATCHES), NOW)).toEqual({
      mode: "full",
      matchesUsed: 5,
      missing: 0,
    });
  });

  it("compte les parties posées juste à l'intérieur de la fenêtre", () => {
    const inside = played(5, ROUTINE_RECENT_WINDOW_DAYS - 0.01);

    expect(gateRoutine(inside, NOW).mode).toBe("full");
  });

  it("écarte les parties d'un jour trop tôt : récent ne veut pas dire éternel", () => {
    const outside = played(5, ROUTINE_RECENT_WINDOW_DAYS + 1);

    expect(gateRoutine(outside, NOW)).toEqual({
      mode: "bench_only",
      matchesUsed: 0,
      missing: 5,
    });
  });

  it("ne compte pas les parties non compétitives", () => {
    const mixed = [...played(4), ...played(3).map((entry) => ({ ...entry, mode: "Deathmatch" }))];

    expect(gateRoutine(mixed, NOW).mode).toBe("bench_only");
  });

  it("ne compte pas une partie sans date : elle n'entre dans aucune fenêtre", () => {
    const undated = played(5).map((entry) => ({ ...entry, playedAt: null }));

    expect(gateRoutine(undated, NOW).matchesUsed).toBe(0);
  });
});
