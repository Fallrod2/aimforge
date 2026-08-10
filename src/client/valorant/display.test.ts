import { describe, expect, it } from "vitest";
import {
  formatAdr,
  formatCount,
  formatPercent,
  formatRatio,
  resultLabel,
  UNKNOWN,
} from "./display";

describe("formatage", () => {
  it("dit « — » pour une valeur inconnue, jamais zéro", () => {
    expect(formatPercent(null)).toBe(UNKNOWN);
    expect(formatAdr(null)).toBe(UNKNOWN);
    expect(formatRatio(null)).toBe(UNKNOWN);
  });

  it("distingue une valeur nulle d'une valeur absente", () => {
    expect(formatPercent(0)).not.toBe(UNKNOWN);
    expect(formatAdr(0)).not.toBe(UNKNOWN);
    expect(formatRatio(0)).not.toBe(UNKNOWN);
  });

  it("met en forme les pourcentages à une décimale", () => {
    expect(formatPercent(24.34)).toBe("24,3 %");
    expect(formatPercent(50)).toBe("50 %");
  });

  it("arrondit l'ADR à l'unité", () => {
    expect(formatAdr(152.4)).toBe("152");
  });

  it("garde deux décimales sur un ratio", () => {
    expect(formatRatio(1.2)).toBe("1,20");
  });

  it("compte en entiers", () => {
    expect(formatCount(12)).toBe("12");
  });
});

describe("resultLabel", () => {
  it("nomme les trois verdicts", () => {
    expect(resultLabel("victoire")).toBe("Victoire");
    expect(resultLabel("defaite")).toBe("Défaite");
    expect(resultLabel("egalite")).toBe("Égalité");
  });

  /** Un résultat absent n'est pas une égalité : la source ne l'a pas dit. */
  it("distingue un résultat inconnu d'une égalité", () => {
    expect(resultLabel(null)).toBe("Résultat inconnu");
    expect(resultLabel(null)).not.toBe(resultLabel("egalite"));
  });
});
