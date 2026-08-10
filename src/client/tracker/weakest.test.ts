import { describe, expect, it } from "vitest";
import {
  type ComputedSubcategory,
  getTier,
  listSubcategories,
  type TierId,
} from "../../lib/energy";
import { atTierCap, nextTierAfter, WEAKEST_COUNT, weakestView } from "./weakest";

/**
 * Les 9 sous-catégories réelles du palier, à l'énergie donnée pour chacune —
 * la forme exacte que rend `computeBenchRun` (celles à 0 comprises).
 */
function subcategories(tier: TierId, energies: readonly number[]): readonly ComputedSubcategory[] {
  return listSubcategories(tier).map((subcategory, index) => ({
    name: subcategory.name,
    energy: energies[index] ?? 0,
  }));
}

function filled(tier: TierId, energy: number): readonly ComputedSubcategory[] {
  return subcategories(tier, Array(9).fill(energy));
}

describe("nextTierAfter", () => {
  it("suit la progression Voltaic", () => {
    expect(nextTierAfter("novice")).toBe("intermediate");
    expect(nextTierAfter("intermediate")).toBe("advanced");
  });

  it("n'invente rien au-dessus d'Advanced", () => {
    expect(nextTierAfter("advanced")).toBeNull();
  });
});

describe("atTierCap", () => {
  it("reconnaît les 9 sous-catégories au plafond", () => {
    expect(atTierCap("novice", filled("novice", getTier("novice").maxEnergy))).toBe(true);
    expect(atTierCap("advanced", filled("advanced", getTier("advanced").maxEnergy))).toBe(true);
  });

  it("ne se déclenche pas s'il en reste une sous le plafond", () => {
    const max = getTier("novice").maxEnergy;
    const energies = Array(9).fill(max);

    energies[4] = max - 0.1;
    expect(atTierCap("novice", subcategories("novice", energies))).toBe(false);
  });

  it("ne prend pas un bench à moitié vide pour un palier terminé", () => {
    // Trois sous-catégories au plafond, six à zéro : les « trois plus faibles »
    // affichées seraient au plafond, mais l'overall vaut zéro — c'est un bench
    // incomplet, pas un palier fini.
    const max = getTier("novice").maxEnergy;

    expect(atTierCap("novice", subcategories("novice", [max, max, max]))).toBe(false);
  });

  it("ne se déclenche pas sur une saisie vide", () => {
    expect(atTierCap("novice", filled("novice", 0))).toBe(false);
    expect(atTierCap("novice", [])).toBe(false);
  });

  it("compare au plafond du palier demandé, pas à un seuil en dur", () => {
    const noviceMax = getTier("novice").maxEnergy;

    // 500 partout : plafond de Novice, très loin de celui d'Intermediate.
    expect(atTierCap("novice", filled("novice", noviceMax))).toBe(true);
    expect(atTierCap("intermediate", filled("intermediate", noviceMax))).toBe(false);
  });
});

describe("weakestView", () => {
  it("ne montre rien tant que rien n'est saisi", () => {
    expect(weakestView("novice", filled("novice", 0))).toEqual({ kind: "empty" });
  });

  it("nomme les trois plus faibles, dans l'ordre croissant", () => {
    const view = weakestView("novice", subcategories("novice", [400, 120, 300, 90, 250]));

    expect(view.kind).toBe("list");
    if (view.kind !== "list") return;
    expect(view.subcategories).toHaveLength(WEAKEST_COUNT);
    expect(view.subcategories.map((sub) => sub.energy)).toEqual([90, 120, 250]);
  });

  it("ignore les sous-catégories sans score : une case vide n'est pas une faiblesse", () => {
    const view = weakestView("novice", subcategories("novice", [400, 0, 300]));

    expect(view.kind === "list" && view.subcategories.map((sub) => sub.energy)).toEqual([300, 400]);
  });

  it("remplace la liste par l'invitation à monter de palier au plafond", () => {
    expect(weakestView("novice", filled("novice", getTier("novice").maxEnergy))).toEqual({
      kind: "capped",
      next: "intermediate",
    });
  });

  it("n'a pas de palier suivant à proposer en Advanced", () => {
    expect(weakestView("advanced", filled("advanced", getTier("advanced").maxEnergy))).toEqual({
      kind: "capped",
      next: null,
    });
  });
});
