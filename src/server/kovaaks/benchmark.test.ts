import { describe, expect, it } from "vitest";
import { CURRENT_SEASON, getSeason, listScenarios, TIER_IDS } from "../../lib/energy";
import {
  type KovaaksBenchmarkProgress,
  kovaaksBenchmarkId,
  kovaaksBenchmarkProgressSchema,
  mapBenchmarkProgress,
  normalizeScenarioName,
  scoreMatchesRank,
  voltaicScenarioName,
} from "./benchmark";

/** Une progression minimale : une catégorie, les scénarios qu'on lui donne. */
function progress(
  scenarios: Record<
    string,
    { score: number; scenario_rank?: number | null; rank_maxes?: number[] | null }
  >,
): KovaaksBenchmarkProgress {
  return { categories: { "Dynamic Clicking": { scenarios } } };
}

describe("normalizeScenarioName", () => {
  it("retire le marqueur de saison final", () => {
    expect(normalizeScenarioName("VT Pasu Novice S5")).toBe("vt pasu novice");
  });

  it("ignore la casse et les espaces surnuméraires", () => {
    expect(normalizeScenarioName("  vt   PASU   novice  ")).toBe("vt pasu novice");
  });

  it("ne retire pas un chiffre qui fait partie du nom", () => {
    // « 1w4ts » n'est pas un marqueur de saison : il doit survivre.
    expect(normalizeScenarioName("VT 1w4ts Novice S5")).toBe("vt 1w4ts novice");
  });
});

describe("voltaicScenarioName", () => {
  it("rattache les 18 scénarios de chaque palier au nom officiel", () => {
    for (const tier of ["novice", "intermediate", "advanced"] as const) {
      const official = listScenarios(tier);

      expect(official).toHaveLength(18);
      for (const scenario of official) {
        // La forme réellement servie par le Benchmark Tracker.
        expect(voltaicScenarioName(CURRENT_SEASON, tier, `${scenario.name} S5`)).toBe(
          scenario.name,
        );
      }
    }
  });

  it("refuse un scénario d'un autre palier", () => {
    expect(voltaicScenarioName(CURRENT_SEASON, "novice", "VT Pasu Advanced S5")).toBeNull();
  });

  it("refuse un scénario inconnu", () => {
    expect(voltaicScenarioName(CURRENT_SEASON, "novice", "Tile Frenzy")).toBeNull();
  });
});

describe("scoreMatchesRank", () => {
  const maxes = [910, 1020, 1110, 1240];

  it("accepte un score dans la tranche de son rang", () => {
    expect(scoreMatchesRank(968.4, 1, maxes)).toBe(true);
  });

  it("accepte un score sous le premier seuil au rang 0", () => {
    expect(scoreMatchesRank(500, 0, maxes)).toBe(true);
  });

  it("accepte un score au-dessus du dernier seuil au rang maximal", () => {
    expect(scoreMatchesRank(5000, 4, maxes)).toBe(true);
  });

  it("rejette un score resté en centièmes", () => {
    // Le cas que le garde-fou existe pour attraper : l'échelle a changé.
    expect(scoreMatchesRank(96840, 1, maxes)).toBe(false);
  });

  it("rejette un score sous la tranche annoncée", () => {
    expect(scoreMatchesRank(800, 1, maxes)).toBe(false);
  });

  it("accepte faute de rang ou de seuils à recouper", () => {
    expect(scoreMatchesRank(968.4, null, maxes)).toBe(true);
    expect(scoreMatchesRank(968.4, 1, null)).toBe(true);
    expect(scoreMatchesRank(968.4, 1, [])).toBe(true);
    // Rang hors barème : la source s'est contredite, on n'en conclut rien.
    expect(scoreMatchesRank(968.4, 9, maxes)).toBe(true);
  });
});

describe("mapBenchmarkProgress", () => {
  it("ramène les centièmes à l'unité du tableur", () => {
    const result = mapBenchmarkProgress(
      CURRENT_SEASON,
      "novice",
      progress({
        "VT Pasu Novice S5": { score: 68350, scenario_rank: 2, rank_maxes: [555, 660, 745, 800] },
      }),
    );

    expect(result.scores["VT Pasu Novice"]).toBe(683.5);
  });

  it("laisse vide un scénario jamais joué plutôt que d'y écrire 0", () => {
    const result = mapBenchmarkProgress(
      CURRENT_SEASON,
      "novice",
      progress({ "VT Pasu Novice S5": { score: 0, scenario_rank: 0, rank_maxes: [555, 660] } }),
    );

    expect(result.scores["VT Pasu Novice"]).toBeUndefined();
    expect(result.missing).toContainEqual({ scenario: "VT Pasu Novice", reason: "sans-score" });
  });

  it("rejette un score qui contredit son propre rang", () => {
    const result = mapBenchmarkProgress(
      CURRENT_SEASON,
      "novice",
      // 96840 centièmes = 968.4, très au-dessus de la tranche du rang 0.
      progress({
        "VT Pasu Novice S5": { score: 9684000, scenario_rank: 0, rank_maxes: [555, 660] },
      }),
    );

    expect(result.scores["VT Pasu Novice"]).toBeUndefined();
    expect(result.missing).toContainEqual({ scenario: "VT Pasu Novice", reason: "incoherent" });
  });

  it("compte les 18 scénarios du palier, renseignés ou non", () => {
    const result = mapBenchmarkProgress(
      CURRENT_SEASON,
      "novice",
      progress({
        "VT Pasu Novice S5": { score: 68350, scenario_rank: 2, rank_maxes: [555, 660, 745, 800] },
        "VT Popcorn Novice S5": { score: 0, scenario_rank: 0, rank_maxes: [390, 500, 600, 720] },
      }),
    );

    expect(Object.keys(result.scores)).toEqual(["VT Pasu Novice"]);
    expect(result.missing).toHaveLength(17);
    expect(result.missing.filter((entry) => entry.reason === "absent")).toHaveLength(16);
  });

  it("signale les scénarios qu'il n'a pas su rattacher", () => {
    const result = mapBenchmarkProgress(
      CURRENT_SEASON,
      "novice",
      progress({ "Tile Frenzy": { score: 12300 } }),
    );

    expect(result.unknown).toEqual(["Tile Frenzy"]);
    expect(result.scores).toEqual({});
  });

  it("accepte un scénario sans rang ni seuils", () => {
    const result = mapBenchmarkProgress(
      CURRENT_SEASON,
      "novice",
      progress({ "VT Pasu Novice S5": { score: 68350 } }),
    );

    expect(result.scores["VT Pasu Novice"]).toBe(683.5);
  });
});

describe("kovaaksBenchmarkProgressSchema", () => {
  it("accepte la forme servie par le Benchmark Tracker", () => {
    const raw = {
      benchmark_progress: 86400,
      overall_rank: 1,
      categories: {
        "Dynamic Clicking": {
          benchmark_progress: 20000,
          category_rank: 4,
          scenarios: {
            "VT Pasu Novice S5": {
              score: 68350,
              leaderboard_rank: 416,
              scenario_rank: 1,
              rank_maxes: [555, 660, 745, 800],
              leaderboard_id: 98059,
            },
          },
        },
      },
    };

    expect(kovaaksBenchmarkProgressSchema.safeParse(raw).success).toBe(true);
  });

  it("refuse une réponse sans catégories", () => {
    expect(kovaaksBenchmarkProgressSchema.safeParse({ error: "nope" }).success).toBe(false);
  });
});

describe("kovaaksBenchmarkId", () => {
  it("désigne un benchmark distinct par palier", () => {
    const ids = TIER_IDS.map((tier) => kovaaksBenchmarkId(CURRENT_SEASON, tier));

    expect(new Set(ids).size).toBe(ids.length);
  });

  it("lit les identifiants dans la définition de saison, pas une constante locale", () => {
    const { benchmarkIds } = getSeason(CURRENT_SEASON).kovaaks;

    for (const tier of TIER_IDS) {
      expect(kovaaksBenchmarkId(CURRENT_SEASON, tier)).toBe(benchmarkIds[tier]);
    }
  });
});
