import { describe, expect, it } from "vitest";
import { CURRENT_SEASON, listScenarios, listSubcategories } from "../../lib/energy";
import { summarizeBench } from "./bench";

const RUN = {
  tier: "novice",
  season: CURRENT_SEASON,
  date: "2026-08-01T18:30:00.000Z",
  overall: 447.36,
  rank: "Gold",
  complete: false,
} as const;

/** Une passe complète où un scénario ciblé est volontairement bas. */
function scoresWithDip(weakScenario: string): { scenario: string; score: number }[] {
  return listScenarios("novice").map((scenario) => ({
    scenario: scenario.name,
    score: scenario.name === weakScenario ? 1 : (scenario.thresholds.at(-1) ?? 1),
  }));
}

describe("summarizeBench", () => {
  it("reprend le palier, la date et le rang tels quels", () => {
    const summary = summarizeBench(RUN, scoresWithDip(""));

    expect(summary.tierLabel).toBe("Novice");
    expect(summary.date).toBe(RUN.date);
    expect(summary.rank).toBe("Gold");
    expect(summary.overall).toBe(447.36);
  });

  it("rend trois sous-catégories, de la plus basse à la moins basse", () => {
    const summary = summarizeBench(RUN, scoresWithDip(""));

    expect(summary.weakest).toHaveLength(3);
    const energies = summary.weakest.map((sub) => sub.energy);

    expect([...energies].sort((a, b) => a - b)).toEqual(energies);
  });

  it("remonte en tête la sous-catégorie où un scénario s'effondre", () => {
    const scenario = listScenarios("novice")[0];
    const owner = listSubcategories("novice").find((sub) =>
      sub.scenarios.some((entry) => entry.name === scenario?.name),
    );
    // La sous-catégorie vaut le max de ses 2 scénarios : on baisse les deux.
    const weakScenarios = new Set((owner?.scenarios ?? []).map((entry) => entry.name));
    const scores = listScenarios("novice").map((entry) => ({
      scenario: entry.name,
      score: weakScenarios.has(entry.name) ? 1 : (entry.thresholds.at(-1) ?? 1),
    }));

    expect(summarizeBench(RUN, scores).weakest[0]?.name).toBe(owner?.name);
  });

  it("classe une sous-catégorie non jouée à zéro, devant les autres", () => {
    // Une passe partielle : aucun score du tout.
    const summary = summarizeBench({ ...RUN, overall: 0, rank: null, complete: false }, []);

    expect(summary.weakest).toHaveLength(3);
    expect(summary.weakest.every((sub) => sub.energy === 0)).toBe(true);
  });

  it("respecte le nombre demandé", () => {
    expect(summarizeBench(RUN, scoresWithDip(""), 1).weakest).toHaveLength(1);
    expect(summarizeBench(RUN, scoresWithDip(""), 0).weakest).toHaveLength(0);
  });
});
