import { describe, expect, it } from "vitest";
import {
  EnergyError,
  getScenario,
  getSubcategory,
  getTier,
  TIER_IDS,
  TIERS,
  type TierId,
} from "./index";

// Ces tests verrouillent les invariants de voltaic-s5-data.json : le moteur
// suppose 3 paliers x 9 sous-catégories x 2 scénarios, des seuils strictement
// croissants et autant de seuils que d'ancres d'énergie.
describe("données Voltaic S5", () => {
  it("expose les 3 paliers dans l'ordre", () => {
    expect(TIER_IDS).toEqual(["novice", "intermediate", "advanced"]);
    expect(TIERS.map((t) => t.id)).toEqual(TIER_IDS);
  });

  it("plafonne l'énergie à 500 / 900 / 1300", () => {
    expect(TIERS.map((t) => t.maxEnergy)).toEqual([500, 900, 1300]);
  });

  // Le JSON n'a pas d'identifiant de benchmark KovaaK's pour Advanced : le
  // type doit l'admettre plutôt que de le masquer derrière le cast.
  it("kovaaksBenchmarkId est un nombre ou null", () => {
    expect(TIERS.map((t) => t.kovaaksBenchmarkId)).toEqual([459, 458, null]);
    for (const tier of TIERS) {
      expect(tier.kovaaksBenchmarkId === null || typeof tier.kovaaksBenchmarkId === "number").toBe(
        true,
      );
    }
  });

  it.each(["novice", "intermediate", "advanced"] as const)(
    "%s : 3 catégories, 9 sous-catégories, 18 scénarios",
    (tierId) => {
      const tier = getTier(tierId);
      const subcategories = tier.categories.flatMap((c) => c.subcategories);
      const scenarios = subcategories.flatMap((s) => s.scenarios);

      expect(tier.categories.map((c) => c.name)).toEqual(["Clicking", "Tracking", "Switching"]);
      expect(subcategories).toHaveLength(9);
      expect(scenarios).toHaveLength(18);
      for (const sub of subcategories) {
        expect(sub.scenarios).toHaveLength(2);
      }
    },
  );

  it.each(["novice", "intermediate", "advanced"] as const)(
    "%s : noms de sous-catégories et de scénarios uniques",
    (tierId) => {
      const tier = getTier(tierId);
      const subNames = tier.categories.flatMap((c) => c.subcategories.map((s) => s.name));
      const scenarioNames = tier.categories.flatMap((c) =>
        c.subcategories.flatMap((s) => s.scenarios.map((sc) => sc.name)),
      );

      expect(new Set(subNames).size).toBe(subNames.length);
      expect(new Set(scenarioNames).size).toBe(scenarioNames.length);
    },
  );

  it.each(["novice", "intermediate", "advanced"] as const)(
    "%s : ancres et seuils strictement croissants et de même longueur",
    (tierId) => {
      const tier = getTier(tierId);

      for (let i = 1; i < tier.anchorEnergies.length; i++) {
        expect(tier.anchorEnergies[i]).toBeGreaterThan(tier.anchorEnergies[i - 1] as number);
      }
      expect(tier.anchorLabels).toHaveLength(tier.anchorEnergies.length);
      expect(tier.anchorEnergies.at(-1)).toBe(tier.maxEnergy);

      for (const category of tier.categories) {
        for (const sub of category.subcategories) {
          for (const scenario of sub.scenarios) {
            expect(scenario.thresholds).toHaveLength(tier.anchorEnergies.length);
            expect(scenario.thresholds[0]).toBeGreaterThan(0);
            for (let i = 1; i < scenario.thresholds.length; i++) {
              expect(scenario.thresholds[i]).toBeGreaterThan(scenario.thresholds[i - 1] as number);
            }
          }
        }
      }
    },
  );

  it.each(["novice", "intermediate", "advanced"] as const)(
    "%s : chaque rang overall correspond à une ancre du même palier",
    (tierId) => {
      const tier = getTier(tierId);

      expect(tier.overallRanks.length).toBeGreaterThan(0);
      // findRank dépend silencieusement de cet ordre pour rendre le rang le
      // plus haut atteint.
      for (let i = 1; i < tier.overallRanks.length; i++) {
        expect(tier.overallRanks[i]?.minEnergy).toBeGreaterThan(
          tier.overallRanks[i - 1]?.minEnergy as number,
        );
      }
      for (const rank of tier.overallRanks) {
        const index = tier.anchorLabels.indexOf(rank.name);
        expect(index).toBeGreaterThanOrEqual(0);
        expect(tier.anchorEnergies[index]).toBe(rank.minEnergy);
        expect(rank.color).toMatch(/^#[0-9A-Fa-f]{6}$/);
      }
    },
  );
});

describe("accesseurs", () => {
  it("getTier retourne le palier demandé", () => {
    expect(getTier("intermediate").label).toBe("Intermediate");
  });

  it("getSubcategory retourne la sous-catégorie et ses 2 scénarios", () => {
    const sub = getSubcategory("novice", "Static");

    expect(sub.scenarios.map((s) => s.name)).toEqual(["VT 1w4ts Novice", "VT ww5t Novice"]);
  });

  it("getScenario retourne le scénario et ses seuils", () => {
    const scenario = getScenario("advanced", "VT ww5t Advanced");

    expect(scenario.thresholds).toHaveLength(getTier("advanced").anchorEnergies.length);
  });

  // Le tier arrive du stockage / de l'API : il peut être invalide au runtime
  // même si le type l'interdit à la compilation.
  it("getTier throw sur un palier inconnu", () => {
    expect(() => getTier("expert" as TierId)).toThrow(EnergyError);
    expect(() => getTier("expert" as TierId)).toThrow(/palier inconnu/i);
  });

  it("getSubcategory throw sur une sous-catégorie inconnue", () => {
    expect(() => getSubcategory("novice", "Flicking")).toThrow(/sous-catégorie inconnue/i);
  });

  it("getScenario throw sur un scénario inconnu", () => {
    expect(() => getScenario("novice", "VT Pasu Advanced")).toThrow(/scénario inconnu/i);
  });
});
