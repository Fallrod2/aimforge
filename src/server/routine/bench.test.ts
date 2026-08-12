import { describe, expect, it } from "vitest";
import {
  DEFAULT_BENCHMARK_ID,
  EnergyError,
  listScenarios,
  listSubcategories,
} from "../../lib/energy";
import { nextRankAbove, summarizeBenchForRoutine, summarizeTierBenchForRoutine } from "./bench";

const RUN = {
  tier: "novice",
  benchmarkId: DEFAULT_BENCHMARK_ID,
  date: "2026-08-01T18:30:00.000Z",
  overall: 447.36,
  rank: "Gold",
  complete: false,
} as const;

/** Une passe où les 2 scénarios d'une sous-catégorie sont volontairement bas. */
function scoresWithWeakSubcategory(subcategoryName: string): { scenario: string; score: number }[] {
  const weak = new Set(
    (listSubcategories("novice").find((sub) => sub.name === subcategoryName)?.scenarios ?? []).map(
      (scenario) => scenario.name,
    ),
  );

  return listScenarios("novice").map((scenario) => ({
    scenario: scenario.name,
    score: weak.has(scenario.name) ? 1 : (scenario.thresholds.at(-1) ?? 1),
  }));
}

describe("nextRankAbove", () => {
  it("rend le premier rang du palier dont le seuil dépasse l'énergie", () => {
    // Novice : Iron 100 · Bronze 200 · Silver 300 · Gold 400.
    expect(nextRankAbove(DEFAULT_BENCHMARK_ID, "novice", 0)).toEqual({
      name: "Iron",
      minEnergy: 100,
    });
    expect(nextRankAbove(DEFAULT_BENCHMARK_ID, "novice", 250)).toEqual({
      name: "Silver",
      minEnergy: 300,
    });
  });

  it("passe au rang suivant dès que le seuil est exactement atteint", () => {
    expect(nextRankAbove(DEFAULT_BENCHMARK_ID, "novice", 300)).toEqual({
      name: "Gold",
      minEnergy: 400,
    });
  });

  it("rend null au-dessus du dernier rang du palier", () => {
    expect(nextRankAbove(DEFAULT_BENCHMARK_ID, "novice", 450)).toBeNull();
  });

  it("suit les rangs propres à chaque palier", () => {
    expect(nextRankAbove(DEFAULT_BENCHMARK_ID, "intermediate", 401)).toEqual({
      name: "Platinum",
      minEnergy: 500,
    });
    expect(nextRankAbove(DEFAULT_BENCHMARK_ID, "advanced", 950)).toEqual({
      name: "Nova",
      minEnergy: 1000,
    });
  });

  it("refuse un palier inconnu", () => {
    // `TierId` est un string ouvert (DECISIONS.md D5) : ce n'est plus le type
    // qui refuse « gold », c'est le registre, à l'exécution.
    expect(() => nextRankAbove(DEFAULT_BENCHMARK_ID, "gold", 100)).toThrow(EnergyError);
  });
});

describe("summarizeBenchForRoutine", () => {
  it("reprend le résumé du coach sans le recalculer", () => {
    const summary = summarizeBenchForRoutine(RUN, scoresWithWeakSubcategory("Precise"));

    expect(summary.tier).toBe("novice");
    expect(summary.tierLabel).toBe("Novice");
    expect(summary.date).toBe(RUN.date);
    expect(summary.overall).toBe(447.36);
    expect(summary.rank).toBe("Gold");
    expect(summary.weakest).toHaveLength(3);
  });

  it("remonte en tête la sous-catégorie effondrée", () => {
    const summary = summarizeBenchForRoutine(RUN, scoresWithWeakSubcategory("Precise"));

    expect(summary.weakest[0]?.name).toBe("Precise");
  });

  it("chiffre l'écart au prochain rang de chaque faiblesse", () => {
    const summary = summarizeBenchForRoutine(RUN, scoresWithWeakSubcategory("Precise"));
    const weakest = summary.weakest[0];

    expect(weakest?.nextRank).toBe("Iron");
    // Deux scénarios à 1 : l'énergie reste très basse, le rang suivant est Iron (100).
    expect(weakest?.gap).toBeCloseTo(100 - (weakest?.energy ?? 0), 6);
  });

  it("annonce l'absence de rang suivant au sommet du palier plutôt qu'un écart nul", () => {
    // Tous les scénarios au dernier seuil : chaque sous-catégorie plafonne à 500.
    const scores = listScenarios("novice").map((scenario) => ({
      scenario: scenario.name,
      score: scenario.thresholds.at(-1) ?? 1,
    }));
    const summary = summarizeBenchForRoutine({ ...RUN, overall: 500 }, scores);

    expect(summary.weakest.every((sub) => sub.nextRank === null)).toBe(true);
    expect(summary.weakest.every((sub) => sub.gap === null)).toBe(true);
  });

  it("traite une passe sans aucun score comme neuf sous-catégories à zéro", () => {
    const summary = summarizeBenchForRoutine({ ...RUN, overall: 0, rank: null }, []);

    expect(summary.weakest).toHaveLength(3);
    expect(summary.weakest.every((sub) => sub.energy === 0)).toBe(true);
    expect(summary.weakest[0]?.nextRank).toBe("Iron");
    expect(summary.weakest[0]?.gap).toBe(100);
  });

  it("respecte le nombre de faiblesses demandé", () => {
    expect(
      summarizeBenchForRoutine(RUN, scoresWithWeakSubcategory("Precise"), 1).weakest,
    ).toHaveLength(1);
  });
});

describe("summarizeTierBenchForRoutine", () => {
  it("garde les écarts au rang suivant et y ajoute benchmark et complétude", () => {
    const summary = summarizeTierBenchForRoutine(RUN, scoresWithWeakSubcategory("Precise"));

    expect(summary.tierLabel).toBe("Novice");
    expect(summary.benchmarkId).toBe(DEFAULT_BENCHMARK_ID);
    expect(summary.filled).toBe(18);
    expect(summary.total).toBe(18);
    expect(summary.weakest[0]?.nextRank).toBe("Iron");
  });

  it("compte les scénarios renseignés d'une passe en cours", () => {
    const summary = summarizeTierBenchForRoutine(
      { ...RUN, overall: 0, rank: null },
      scoresWithWeakSubcategory("Precise").slice(0, 4),
    );

    expect(summary.filled).toBe(4);
    expect(summary.total).toBe(18);
  });
});
