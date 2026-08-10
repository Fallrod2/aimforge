import { describe, expect, it } from "vitest";
import { niceStep, paddedDomain } from "./scale";

describe("niceStep", () => {
  it("arrondit au pas rond supérieur dans la décade", () => {
    expect(niceStep(0.9)).toBe(1);
    expect(niceStep(1)).toBe(1);
    expect(niceStep(1.2)).toBe(2);
    expect(niceStep(2.1)).toBe(2.5);
    expect(niceStep(3)).toBe(5);
    expect(niceStep(6)).toBe(10);
  });

  it("change de décade sans changer de vocabulaire", () => {
    expect(niceStep(11)).toBe(20);
    expect(niceStep(0.11)).toBe(0.2);
    expect(niceStep(120)).toBe(200);
  });

  it("se rabat sur 1 pour une entrée absurde", () => {
    expect(niceStep(0)).toBe(1);
    expect(niceStep(-4)).toBe(1);
    expect(niceStep(Number.NaN)).toBe(1);
  });
});

describe("paddedDomain", () => {
  it("encadre la plage observée sans jamais la toucher", () => {
    const [low, high] = paddedDomain([18, 24, 31]);

    expect(low).toBeLessThan(18);
    expect(high).toBeGreaterThan(31);
  });

  it("rend des bornes rondes", () => {
    expect(paddedDomain([18, 24, 31])).toEqual([16, 34]);
    expect(paddedDomain([120, 150, 190])).toEqual([100, 220]);
  });

  /**
   * La borne physique est un **plafond de sécurité**, pas une cible : un HS%
   * observé entre 18 et 31 ne se cadre pas de 0 à 100 sous prétexte que ce sont
   * les bornes d'un pourcentage — c'est précisément ce que ce module évite.
   */
  it("ne colle pas le domaine aux bornes physiques quand les données sont loin", () => {
    expect(paddedDomain([18, 31], { lower: 0, upper: 100 })).toEqual([16, 34]);
  });

  it("écrête à la borne physique basse quand la marge la dépasserait", () => {
    // Sans écrêtage, la marge descendrait sous zéro : un HS% négatif n'existe pas.
    expect(paddedDomain([0, 10], { lower: 0 })[0]).toBe(0);
    expect(paddedDomain([0, 10])[0]).toBeLessThan(0);
  });

  it("écrête à la borne physique haute quand la marge la dépasserait", () => {
    expect(paddedDomain([95, 100], { upper: 100 })[1]).toBe(100);
    expect(paddedDomain([95, 100])[1]).toBeGreaterThan(100);
  });

  it("donne de l'air autour d'une valeur unique plutôt qu'un domaine ponctuel", () => {
    const [low, high] = paddedDomain([25]);

    expect(low).toBeLessThan(25);
    expect(high).toBeGreaterThan(25);
  });

  it("traite plusieurs valeurs identiques comme une seule", () => {
    expect(paddedDomain([25, 25, 25])).toEqual(paddedDomain([25]));
  });

  it("ignore les trous de la série", () => {
    expect(paddedDomain([null, 18, null, 31, null])).toEqual(paddedDomain([18, 31]));
  });

  it("rend un cadre neutre quand rien n'est traçable", () => {
    expect(paddedDomain([])).toEqual([0, 1]);
    expect(paddedDomain([null, null])).toEqual([0, 1]);
    expect(paddedDomain([], { lower: 10 })).toEqual([10, 11]);
  });

  it("ne descend pas sous la borne basse même avec une valeur nulle", () => {
    expect(paddedDomain([0, 4], { lower: 0 })[0]).toBe(0);
  });
});
