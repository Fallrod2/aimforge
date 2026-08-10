import { describe, expect, it } from "vitest";
import type { StatBreakdown } from "../data";
import { BREAKDOWN_LIMIT, rankBreakdowns } from "./breakdowns";

function entry(key: string, matches: number): StatBreakdown {
  return {
    key,
    totals: {
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
    },
  };
}

function keysOf(breakdowns: readonly StatBreakdown[]): readonly string[] {
  return breakdowns.map((item) => item.key);
}

describe("rankBreakdowns", () => {
  it("classe par volume décroissant", () => {
    const { rows } = rankBreakdowns([entry("Sova", 2), entry("Jett", 9), entry("Omen", 5)]);

    expect(keysOf(rows)).toEqual(["Jett", "Omen", "Sova"]);
  });

  /**
   * L'ordre d'arrivée ne doit rien décider : la réponse peut venir d'un cache
   * écrit par une version antérieure, ou d'une source qui trie autrement.
   */
  it("ne dépend pas de l'ordre d'entrée", () => {
    const shuffled = rankBreakdowns([entry("Omen", 5), entry("Sova", 2), entry("Jett", 9)]);
    const sorted = rankBreakdowns([entry("Jett", 9), entry("Omen", 5), entry("Sova", 2)]);

    expect(keysOf(shuffled.rows)).toEqual(keysOf(sorted.rows));
  });

  it("départage à volume égal par ordre alphabétique, accents compris", () => {
    const { rows } = rankBreakdowns([entry("Ébène", 3), entry("Astra", 3), entry("breeze", 3)]);

    expect(keysOf(rows)).toEqual(["Astra", "breeze", "Ébène"]);
  });

  it("coupe à la limite et compte ce qui reste", () => {
    const { rows, hidden, hiddenMatches } = rankBreakdowns(
      [entry("a", 10), entry("b", 8), entry("c", 3), entry("d", 2)],
      2,
    );

    expect(keysOf(rows)).toEqual(["a", "b"]);
    expect(hidden).toBe(2);
    expect(hiddenMatches).toBe(5);
  });

  it("ne cache rien quand tout tient", () => {
    const ranked = rankBreakdowns([entry("a", 1), entry("b", 1)], 5);

    expect(ranked.rows).toHaveLength(2);
    expect(ranked.hidden).toBe(0);
    expect(ranked.hiddenMatches).toBe(0);
  });

  it("s'applique une limite par défaut de six lignes", () => {
    const many = Array.from({ length: 10 }, (_, index) => entry(`agent-${index}`, 10 - index));

    expect(rankBreakdowns(many).rows).toHaveLength(BREAKDOWN_LIMIT);
    expect(rankBreakdowns(many).hidden).toBe(10 - BREAKDOWN_LIMIT);
  });

  it("rend un tableau vide sans rien inventer", () => {
    expect(rankBreakdowns([])).toEqual({ rows: [], hidden: 0, hiddenMatches: 0 });
  });

  it("ne rend aucune ligne pour une limite nulle ou négative", () => {
    const ranked = rankBreakdowns([entry("a", 4)], 0);

    expect(ranked.rows).toEqual([]);
    expect(ranked.hidden).toBe(1);
    expect(ranked.hiddenMatches).toBe(4);
    expect(rankBreakdowns([entry("a", 4)], -3).rows).toEqual([]);
  });

  it("ne modifie pas le tableau reçu", () => {
    const input = [entry("b", 1), entry("a", 9)];

    rankBreakdowns(input);
    expect(keysOf(input)).toEqual(["b", "a"]);
  });
});
