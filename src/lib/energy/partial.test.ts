import { describe, expect, it } from "vitest";
import { overallEnergy } from "./energy.js";
import { partialEnergy } from "./partial.js";
import { EnergyError } from "./types.js";

/** Les 9 cases d'un bench, dont seules les premières sont renseignées. */
function nine(...energies: readonly number[]): readonly number[] {
  return Array.from({ length: 9 }, (_, index) => energies[index] ?? 0);
}

describe("partialEnergy", () => {
  it("ne rend rien tant qu'aucune sous-catégorie n'est complète", () => {
    expect(partialEnergy(nine())).toBeNull();
  });

  it("rend l'énergie de la seule sous-catégorie renseignée", () => {
    const partial = partialEnergy(nine(412.96));

    expect(partial).not.toBeNull();
    expect(partial?.counted).toBe(1);
    expect(partial?.total).toBe(9);
    expect(partial?.energy).toBeCloseTo(412.96, 5);
  });

  it("fait la moyenne harmonique de deux sous-catégories (vérifié à la main)", () => {
    // 2 / (1/412 + 1/452) = 2 × 412 × 452 / (412 + 452) = 372448 / 864
    const partial = partialEnergy(nine(412, 452));

    expect(partial?.counted).toBe(2);
    expect(partial?.energy).toBeCloseTo(431.074074, 5);
  });

  it("fait la moyenne harmonique de trois sous-catégories (vérifié à la main)", () => {
    // 3 / (1/400 + 1/500 + 1/600) = 3 / (37/6000) = 18000 / 37
    const partial = partialEnergy(nine(400, 500, 600));

    expect(partial?.counted).toBe(3);
    expect(partial?.energy).toBeCloseTo(486.486486, 5);
  });

  it("ignore les sous-catégories à 0 où qu'elles soient, sans changer le résultat", () => {
    const dispersed = partialEnergy([0, 400, 0, 0, 500, 0, 600, 0, 0]);

    expect(dispersed?.counted).toBe(3);
    expect(dispersed?.energy).toBeCloseTo(486.486486, 5);
  });

  it("rejoint exactement l'overall quand les 9 sous-catégories sont renseignées", () => {
    const energies = [412, 452, 407, 499, 491, 431, 415, 471, 470];
    const partial = partialEnergy(energies);

    expect(partial?.counted).toBe(9);
    expect(partial?.energy).toBeCloseTo(overallEnergy(energies), 10);
    // La fixture officielle du kickoff : 447,36.
    expect(partial?.energy).toBeCloseTo(447.36, 2);
  });

  it("reste bornée par la plus basse et la plus haute des sous-catégories comptées", () => {
    const partial = partialEnergy(nine(300, 500, 500, 500, 500, 500, 500, 500, 500));

    expect(partial?.energy).toBeGreaterThanOrEqual(300);
    expect(partial?.energy).toBeLessThanOrEqual(500);
  });

  it("ne dépasse pas le plafond quand toutes les sous-catégories y sont", () => {
    // 9 × 500 : l'accumulation des inverses en flottant sortirait de la borne.
    expect(partialEnergy(Array(9).fill(500))?.energy).toBe(500);
    expect(partialEnergy([900, 900])?.energy).toBe(900);
  });

  it("compte les sous-catégories du benchmark, pas neuf en dur", () => {
    const partial = partialEnergy([400, 0, 600]);

    expect(partial?.total).toBe(3);
    expect(partial?.counted).toBe(2);
    expect(partial?.energy).toBeCloseTo(480, 10);
  });

  it("refuse une liste vide : il n'y a pas de « partiel sur 0 »", () => {
    expect(() => partialEnergy([])).toThrow(EnergyError);
  });

  it("refuse une énergie négative ou non finie, comme le moteur", () => {
    expect(() => partialEnergy(nine(-1))).toThrow(EnergyError);
    expect(() => partialEnergy(nine(Number.NaN))).toThrow(EnergyError);
  });
});
