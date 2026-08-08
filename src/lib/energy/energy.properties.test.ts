import { describe, expect, it } from "vitest";
import {
  getTier,
  overallEnergy,
  type Scenario,
  scenarioEnergy,
  subcategoryEnergy,
  TIER_IDS,
  type TierId,
} from "./index";

interface ScenarioRef {
  readonly tierId: TierId;
  readonly subcategoryName: string;
  readonly scenario: Scenario;
}

/** Les 54 scénarios (3 paliers × 9 sous-catégories × 2). */
const ALL_SCENARIOS: readonly ScenarioRef[] = TIER_IDS.flatMap((tierId) =>
  getTier(tierId).categories.flatMap((category) =>
    category.subcategories.flatMap((sub) =>
      sub.scenarios.map((scenario) => ({ tierId, subcategoryName: sub.name, scenario })),
    ),
  ),
);

const STEPS = 60;

/** Grille de scores de 0 au dernier seuil (plafond exclu). */
function scoreGrid(scenario: Scenario): number[] {
  const last = scenario.thresholds.at(-1) as number;

  return Array.from({ length: STEPS + 1 }, (_, i) => (last * i) / (STEPS + 1));
}

describe("propriétés — 54 scénarios", () => {
  it("il y a bien 54 scénarios à balayer", () => {
    expect(ALL_SCENARIOS).toHaveLength(54);
  });

  it("monotonie stricte sous le plafond", () => {
    for (const { tierId, scenario } of ALL_SCENARIOS) {
      let previous = Number.NEGATIVE_INFINITY;

      for (const score of scoreGrid(scenario)) {
        const energy = scenarioEnergy(tierId, scenario.name, score);
        expect(energy, `${scenario.name} @ ${score}`).toBeGreaterThan(previous);
        previous = energy;
      }
    }
  });

  it("constante au plafond au-delà de la dernière ancre", () => {
    for (const { tierId, scenario } of ALL_SCENARIOS) {
      const { maxEnergy } = getTier(tierId);
      const last = scenario.thresholds.at(-1) as number;

      for (const score of [last, last + 0.5, last + 1, last * 2, last * 100]) {
        expect(scenarioEnergy(tierId, scenario.name, score), `${scenario.name} @ ${score}`).toBe(
          maxEnergy,
        );
      }
    }
  });

  it("bornes [0, maxEnergy] et score 0 → énergie 0", () => {
    for (const { tierId, scenario } of ALL_SCENARIOS) {
      const { maxEnergy } = getTier(tierId);

      expect(scenarioEnergy(tierId, scenario.name, 0)).toBe(0);
      for (const score of [...scoreGrid(scenario), (scenario.thresholds.at(-1) as number) * 3]) {
        const energy = scenarioEnergy(tierId, scenario.name, score);
        expect(energy, `${scenario.name} @ ${score}`).toBeGreaterThanOrEqual(0);
        expect(energy, `${scenario.name} @ ${score}`).toBeLessThanOrEqual(maxEnergy);
      }
    }
  });

  // Choix tranché : score négatif → erreur (voir energy.test.ts), jamais un
  // clamp silencieux à 0.
  it("throw sur tout score négatif", () => {
    for (const { tierId, scenario } of ALL_SCENARIOS) {
      expect(() => scenarioEnergy(tierId, scenario.name, -0.001)).toThrow(/score invalide/i);
    }
  });
});

describe("propriétés — sous-catégories et overall", () => {
  it("subcategoryEnergy = max des 2 scénarios, sur toutes les sous-catégories", () => {
    for (const tierId of TIER_IDS) {
      for (const category of getTier(tierId).categories) {
        for (const sub of category.subcategories) {
          const [first, second] = [sub.scenarios[0] as Scenario, sub.scenarios[1] as Scenario];

          for (const ratio of [0, 0.25, 0.5, 0.75, 1]) {
            const scores = {
              [first.name]: (first.thresholds.at(-1) as number) * ratio,
              [second.name]: (second.thresholds.at(-1) as number) * (1 - ratio),
            };
            const expected = Math.max(
              scenarioEnergy(tierId, first.name, scores[first.name] as number),
              scenarioEnergy(tierId, second.name, scores[second.name] as number),
            );

            expect(subcategoryEnergy(tierId, sub.name, scores), `${sub.name} @ ${ratio}`).toBe(
              expected,
            );
          }
        }
      }
    }
  });

  it("overall = 0 dès qu'une sous-catégorie vaut 0", () => {
    const energies = [120, 340, 260, 480, 199, 410, 305, 275, 366];

    for (let i = 0; i < energies.length; i++) {
      const withHole = [...energies];
      withHole[i] = 0;
      expect(overallEnergy(withHole)).toBe(0);
    }
  });

  // Borne mathématique de la moyenne harmonique : min ≤ HM ≤ max, SANS marge.
  // Toute tolérance ici masquerait une dérive d'accumulation flottante.
  it("min ≤ overall ≤ max, sans tolérance", () => {
    const sets: readonly (readonly number[])[] = [
      [120, 340, 260, 480, 199, 410, 305, 275, 366],
      [1, 2, 3, 4, 5, 6, 7, 8, 9],
      [499.9999, 500, 500.0001, 412, 452, 407, 471, 470, 431],
      [1e-6, 500, 500, 500, 500, 500, 500, 500, 500],
    ];

    for (const energies of sets) {
      const overall = overallEnergy(energies);
      expect(overall, energies.join(",")).toBeGreaterThanOrEqual(Math.min(...energies));
      expect(overall, energies.join(",")).toBeLessThanOrEqual(Math.max(...energies));
      // Valeurs distinctes ⇒ inégalités strictes : le bornage ne doit pas
      // dégénérer en min ou en max.
      expect(overall, energies.join(",")).toBeGreaterThan(Math.min(...energies));
      expect(overall, energies.join(",")).toBeLessThan(Math.max(...energies));
    }
  });

  // Cas le plus contraignant : 9 valeurs identiques ⇒ HM = cette valeur, à
  // l'identique (les énergies d'ancre sont exactement ces valeurs-là).
  it("9 valeurs identiques → overall égal à cette valeur (énergies d'ancre incluses)", () => {
    const anchorEnergies = TIER_IDS.flatMap((tierId) => getTier(tierId).anchorEnergies);
    const values = [...new Set([...anchorEnergies, 1, 250, 447.36, 1e-3])];

    for (const value of values) {
      const overall = overallEnergy(new Array<number>(9).fill(value));
      expect(overall, `HM de 9 × ${value}`).toBeGreaterThanOrEqual(value);
      expect(overall, `HM de 9 × ${value}`).toBeLessThanOrEqual(value);
    }
  });

  it("overall est strictement sous la moyenne arithmétique quand les valeurs diffèrent", () => {
    const energies = [120, 340, 260, 480, 199, 410, 305, 275, 366];
    const arithmetic = energies.reduce((a, b) => a + b, 0) / energies.length;

    expect(overallEnergy(energies)).toBeLessThan(arithmetic);
  });

  it("overall d'un bench complet reste dans [0, maxEnergy]", () => {
    for (const tierId of TIER_IDS) {
      const tier = getTier(tierId);
      const subcategories = tier.categories.flatMap((c) => c.subcategories);

      for (const ratio of [0.1, 0.5, 0.9, 1, 2]) {
        const subEnergies = subcategories.map((sub) => {
          const scores = Object.fromEntries(
            sub.scenarios.map((sc) => [sc.name, (sc.thresholds.at(-1) as number) * ratio]),
          );
          return subcategoryEnergy(tierId, sub.name, scores);
        });
        const overall = overallEnergy(subEnergies);

        expect(overall, `${tierId} @ ${ratio}`).toBeGreaterThan(0);
        expect(overall, `${tierId} @ ${ratio}`).toBeLessThanOrEqual(tier.maxEnergy);
      }
    }
  });
});
