import { describe, expect, it } from "vitest";
import {
  EnergyError,
  findRank,
  getTier,
  isComplete,
  listSubcategories,
  overallEnergy,
  rankFor,
  type ScoreMap,
  scenarioEnergy,
  subcategoryEnergy,
  TIER_IDS,
  type TierId,
} from "./index";

const TOLERANCE = 0.05;

/** Construit les 18 scores d'un palier à partir d'un score par scénario. */
function scoresFor(tierId: TierId, score: (scenarioName: string) => number): ScoreMap {
  const entries = getTier(tierId).categories.flatMap((category) =>
    category.subcategories.flatMap((sub) =>
      sub.scenarios.map((scenario) => [scenario.name, score(scenario.name)] as const),
    ),
  );

  return Object.fromEntries(entries);
}

/** Seuil du scénario pour le rang donné (index du rang dans anchorLabels). */
function thresholdAt(tierId: TierId, scenarioName: string, rankName: string): number {
  const tier = getTier(tierId);
  const index = tier.anchorLabels.indexOf(rankName);
  const scenario = tier.categories
    .flatMap((c) => c.subcategories)
    .flatMap((s) => s.scenarios)
    .find((sc) => sc.name === scenarioName);

  if (!scenario || index < 0) throw new Error(`fixture invalide: ${scenarioName} / ${rankName}`);
  return scenario.thresholds[index] as number;
}

describe("scenarioEnergy — fixtures officielles (tolérance ±0,05)", () => {
  const fixtures: ReadonlyArray<readonly [TierId, string, number, number, string]> = [
    ["novice", "VT 1w4ts Novice", 1162, 451.96, "interpolation"],
    ["novice", "VT Pasu Novice", 807, 412.96, "interpolation"],
    ["novice", "VT ww5t Novice", 1290, 400.0, "ancre exacte"],
    ["novice", "VT Pasu Novice", 900, 500.0, "plafond"],
    ["novice", "VT Popcorn Novice", 100, 25.64, "sous la 1re ancre"],
    ["intermediate", "VT Popcorn Intermediate", 330, 258.82, "interpolation"],
    ["intermediate", "VT FlyTS Intermediate", 523, 505.88, "interpolation"],
    ["advanced", "VT ww5t Advanced", 1610, 1000.0, "ancre exacte"],
  ];

  it.each(fixtures)("%s / %s @ %i → %f (%s)", (tierId, scenarioName, score, expected) => {
    expect(Math.abs(scenarioEnergy(tierId, scenarioName, score) - expected)).toBeLessThanOrEqual(
      TOLERANCE,
    );
  });
});

describe("scenarioEnergy — ancres, plafond et bas de courbe", () => {
  it("rend exactement l'énergie d'ancre sur chaque seuil (54 scénarios)", () => {
    for (const tier of [getTier("novice"), getTier("intermediate"), getTier("advanced")]) {
      for (const category of tier.categories) {
        for (const sub of category.subcategories) {
          for (const scenario of sub.scenarios) {
            scenario.thresholds.forEach((threshold, i) => {
              expect(scenarioEnergy(tier.id, scenario.name, threshold)).toBeCloseTo(
                tier.anchorEnergies[i] as number,
                6,
              );
            });
          }
        }
      }
    }
  });

  it("plafonne au-delà de la dernière ancre", () => {
    const tier = getTier("advanced");
    const last = thresholdAt("advanced", "VT Pasu Advanced", "Celestial+");

    expect(scenarioEnergy("advanced", "VT Pasu Advanced", last)).toBe(tier.maxEnergy);
    expect(scenarioEnergy("advanced", "VT Pasu Advanced", last + 1)).toBe(tier.maxEnergy);
    expect(scenarioEnergy("advanced", "VT Pasu Advanced", last * 10)).toBe(tier.maxEnergy);
  });

  it("interpole depuis (0, 0) sous la première ancre", () => {
    // Palier intermediate : la 1re ancre vaut 400, pas 33,33 — la droite part
    // quand même de l'origine.
    const first = thresholdAt("intermediate", "VT Pasu Intermediate", "Gold");

    expect(scenarioEnergy("intermediate", "VT Pasu Intermediate", first / 2)).toBeCloseTo(200, 4);
    expect(scenarioEnergy("intermediate", "VT Pasu Intermediate", first)).toBeCloseTo(400, 4);
  });

  it("score 0 → énergie 0", () => {
    expect(scenarioEnergy("novice", "VT Pasu Novice", 0)).toBe(0);
    expect(scenarioEnergy("advanced", "VT Ground Advanced", 0)).toBe(0);
  });

  // Choix tranché : un score négatif est une donnée invalide (KovaaK's ne peut
  // pas en produire), on throw plutôt que de le ramener silencieusement à 0.
  it("throw sur un score négatif ou non fini", () => {
    expect(() => scenarioEnergy("novice", "VT Pasu Novice", -1)).toThrow(EnergyError);
    expect(() => scenarioEnergy("novice", "VT Pasu Novice", -1)).toThrow(/score invalide/i);
    expect(() => scenarioEnergy("novice", "VT Pasu Novice", Number.NaN)).toThrow(/score invalide/i);
    expect(() => scenarioEnergy("novice", "VT Pasu Novice", Number.POSITIVE_INFINITY)).toThrow(
      /score invalide/i,
    );
  });

  it("throw sur un palier ou un scénario inconnu", () => {
    expect(() => scenarioEnergy("expert" as TierId, "VT Pasu Novice", 100)).toThrow(
      /palier inconnu/i,
    );
    expect(() => scenarioEnergy("novice", "VT Inexistant", 100)).toThrow(/scénario inconnu/i);
  });
});

describe("subcategoryEnergy", () => {
  it("prend le max des 2 scénarios", () => {
    const pasu = scenarioEnergy("novice", "VT Pasu Novice", 807);
    const popcorn = scenarioEnergy("novice", "VT Popcorn Novice", 100);

    expect(popcorn).toBeLessThan(pasu);
    expect(
      subcategoryEnergy("novice", "Dynamic", {
        "VT Pasu Novice": 807,
        "VT Popcorn Novice": 100,
      }),
    ).toBeCloseTo(pasu, 6);
    expect(
      subcategoryEnergy("novice", "Dynamic", {
        "VT Pasu Novice": 100,
        "VT Popcorn Novice": 700,
      }),
    ).toBeCloseTo(scenarioEnergy("novice", "VT Popcorn Novice", 700), 6);
  });

  // Score absent = scénario non joué = 0 (c'est ce qui rend un bench incomplet).
  it("traite un scénario absent comme un score de 0", () => {
    expect(subcategoryEnergy("novice", "Dynamic", { "VT Pasu Novice": 807 })).toBeCloseTo(
      scenarioEnergy("novice", "VT Pasu Novice", 807),
      6,
    );
    expect(subcategoryEnergy("novice", "Dynamic", {})).toBe(0);
  });

  it("throw sur une sous-catégorie ou un palier inconnu", () => {
    expect(() => subcategoryEnergy("novice", "Flicking", {})).toThrow(/sous-catégorie inconnue/i);
    expect(() => subcategoryEnergy("expert" as TierId, "Dynamic", {})).toThrow(/palier inconnu/i);
  });
});

describe("overallEnergy — moyenne harmonique", () => {
  it("fixture officielle", () => {
    const energies = [412, 452, 407, 499, 491, 431, 415, 471, 470];

    expect(Math.abs(overallEnergy(energies) - 447.36)).toBeLessThanOrEqual(TOLERANCE);
  });

  it("vaut la valeur commune quand les 9 sous-catégories sont égales", () => {
    expect(overallEnergy(new Array<number>(9).fill(400))).toBeCloseTo(400, 6);
  });

  it("est strictement inférieure à la moyenne arithmétique quand les valeurs diffèrent", () => {
    const energies = [412, 452, 407, 499, 491, 431, 415, 471, 470];
    const arithmetic = energies.reduce((a, b) => a + b, 0) / energies.length;

    expect(overallEnergy(energies)).toBeLessThan(arithmetic);
  });

  it("vaut 0 dès qu'une sous-catégorie vaut 0 (bench incomplet)", () => {
    const energies = [412, 452, 407, 499, 491, 431, 415, 471, 470];

    for (let i = 0; i < energies.length; i++) {
      const withHole = [...energies];
      withHole[i] = 0;
      expect(overallEnergy(withHole)).toBe(0);
    }
    expect(overallEnergy(new Array<number>(9).fill(0))).toBe(0);
  });

  it("throw si le nombre de sous-catégories n'est pas 9", () => {
    expect(() => overallEnergy([400, 400])).toThrow(EnergyError);
    expect(() => overallEnergy([400, 400])).toThrow(/9 sous-catégories/i);
  });

  it("throw sur une énergie négative ou non finie", () => {
    const eight = new Array<number>(8).fill(400);

    expect(() => overallEnergy([...eight, -1])).toThrow(/énergie invalide/i);
    expect(() => overallEnergy([...eight, Number.NaN])).toThrow(/énergie invalide/i);
  });
});

describe("rankFor — bornes exactes", () => {
  const cases: ReadonlyArray<readonly [TierId, number, string | null]> = [
    ["novice", 0, null],
    ["novice", 99.99, null],
    ["novice", 100, "Iron"],
    ["novice", 199.99, "Iron"],
    ["novice", 200, "Bronze"],
    ["novice", 299.99, "Bronze"],
    ["novice", 300, "Silver"],
    ["novice", 399.99, "Silver"],
    ["novice", 400, "Gold"],
    ["novice", 500, "Gold"],
    ["intermediate", 499.99, null],
    ["intermediate", 500, "Platinum"],
    ["intermediate", 599.99, "Platinum"],
    ["intermediate", 600, "Diamond"],
    ["intermediate", 699.99, "Diamond"],
    ["intermediate", 700, "Jade"],
    ["intermediate", 799.99, "Jade"],
    ["intermediate", 800, "Master"],
    ["intermediate", 900, "Master"],
    ["advanced", 899.99, null],
    ["advanced", 900, "Grandmaster"],
    ["advanced", 999.99, "Grandmaster"],
    ["advanced", 1000, "Nova"],
    ["advanced", 1099.99, "Nova"],
    ["advanced", 1100, "Astra"],
    ["advanced", 1199.99, "Astra"],
    ["advanced", 1200, "Celestial"],
    ["advanced", 1300, "Celestial"],
  ];

  it.each(cases)("%s @ %f → %s", (tierId, overall, expected) => {
    expect(rankFor(tierId, overall)).toBe(expected);
  });

  it("findRank rend l'objet rang complet (couleur incluse) pour l'UI", () => {
    expect(findRank("novice", 450)).toEqual({ name: "Gold", minEnergy: 400, color: "#CAB148" });
    expect(findRank("novice", 99)).toBeNull();
  });

  it("throw sur un palier inconnu ou un overall invalide", () => {
    expect(() => rankFor("expert" as TierId, 400)).toThrow(/palier inconnu/i);
    expect(() => rankFor("novice", Number.NaN)).toThrow(/énergie invalide/i);
    expect(() => rankFor("novice", -1)).toThrow(/énergie invalide/i);
  });
});

describe("isComplete", () => {
  it("vrai quand les 18 scénarios sont pile au seuil du rang", () => {
    const scores = scoresFor("novice", (name) => thresholdAt("novice", name, "Gold"));

    expect(isComplete("novice", "Gold", scores)).toBe(true);
  });

  it("faux quand un seul des 18 scénarios est sous le seuil", () => {
    const scores = {
      ...scoresFor("novice", (name) => thresholdAt("novice", name, "Gold")),
      "VT ww5t Novice": thresholdAt("novice", "VT ww5t Novice", "Gold") - 1,
    };

    expect(isComplete("novice", "Gold", scores)).toBe(false);
  });

  it("faux quand un scénario n'a pas été joué", () => {
    const scores = scoresFor("novice", (name) => thresholdAt("novice", name, "Gold"));
    const partial = Object.fromEntries(
      Object.entries(scores).filter(([name]) => name !== "VT Pasu Novice"),
    );

    expect(Object.keys(partial)).toHaveLength(17);
    expect(isComplete("novice", "Gold", partial)).toBe(false);
  });

  it("vrai pour un rang inférieur quand les scores dépassent largement", () => {
    const scores = scoresFor("intermediate", (name) => thresholdAt("intermediate", name, "Master"));

    expect(isComplete("intermediate", "Master", scores)).toBe(true);
    expect(isComplete("intermediate", "Platinum", scores)).toBe(true);
    expect(isComplete("intermediate", "Master+", scores)).toBe(false);
  });

  it("fonctionne sur les 3 paliers pour chaque rang overall", () => {
    for (const tierId of ["novice", "intermediate", "advanced"] as const) {
      for (const rank of getTier(tierId).overallRanks) {
        const scores = scoresFor(tierId, (name) => thresholdAt(tierId, name, rank.name));
        expect(isComplete(tierId, rank.name, scores)).toBe(true);
      }
    }
  });

  it("throw sur un rang ou un palier inconnu", () => {
    expect(() => isComplete("novice", "Radiant", {})).toThrow(EnergyError);
    expect(() => isComplete("novice", "Radiant", {})).toThrow(/rang inconnu/i);
    expect(() => isComplete("expert" as TierId, "Gold", {})).toThrow(/palier inconnu/i);
  });
});

describe("bench bout-en-bout — scores pile au seuil d'un rang", () => {
  // Chaîne complète scores → 9 sous-catégories → overall → rang. Un joueur
  // exactement aux seuils d'un rang doit obtenir CE rang : c'est la garantie
  // que l'accumulation flottante de la moyenne harmonique ne le fait pas
  // basculer sous la borne du rang.
  const ranks = TIER_IDS.flatMap((tierId) =>
    getTier(tierId).overallRanks.map((rank) => [tierId, rank.name, rank.minEnergy] as const),
  );

  it("couvre les 12 rangs des 3 paliers", () => {
    expect(ranks).toHaveLength(12);
  });

  it.each(ranks)(
    "%s / %s : 18 scores au seuil → overall %f et rang atteint",
    (tierId, rankName) => {
      const scores = scoresFor(tierId, (name) => thresholdAt(tierId, name, rankName));
      const subEnergies = listSubcategories(tierId).map((sub) =>
        subcategoryEnergy(tierId, sub.name, scores),
      );
      const overall = overallEnergy(subEnergies);
      const minEnergy = getTier(tierId).overallRanks.find((r) => r.name === rankName)?.minEnergy;

      expect(subEnergies).toHaveLength(9);
      for (const energy of subEnergies) {
        expect(energy).toBeCloseTo(minEnergy as number, 6);
      }
      expect(overall).toBeGreaterThanOrEqual(minEnergy as number);
      expect(rankFor(tierId, overall)).toBe(rankName);
      expect(isComplete(tierId, rankName, scores)).toBe(true);
    },
  );
});
