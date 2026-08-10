import { describe, expect, it } from "vitest";
import { IDLE, importFailed, importSucceeded, LOADING } from "./import";
import { isManualOpen, NO_MANUAL, openManual, opensManualGrid, toggleManual } from "./manual";

function done() {
  return importSucceeded({
    username: "Victard",
    scores: { "VT Pasu Novice": 683.5 },
    missing: [],
  });
}

describe("grille manuelle, par palier", () => {
  it("part repliée sur les trois paliers", () => {
    for (const tier of ["novice", "intermediate", "advanced"] as const) {
      expect(isManualOpen(NO_MANUAL, tier)).toBe(false);
    }
  });

  it("n'ouvre que le palier visé", () => {
    const manual = openManual(NO_MANUAL, "novice");

    expect(isManualOpen(manual, "novice")).toBe(true);
    expect(isManualOpen(manual, "advanced")).toBe(false);
  });

  it("bascule dans les deux sens, palier par palier", () => {
    const opened = toggleManual(NO_MANUAL, "novice");

    expect(isManualOpen(opened, "novice")).toBe(true);

    const closed = toggleManual(opened, "novice");

    expect(isManualOpen(closed, "novice")).toBe(false);
  });

  it("referme un palier sans refermer l'autre", () => {
    const both = openManual(openManual(NO_MANUAL, "novice"), "advanced");
    const closed = toggleManual(both, "advanced");

    expect(isManualOpen(closed, "novice")).toBe(true);
    expect(isManualOpen(closed, "advanced")).toBe(false);
  });

  it("n'altère pas la valeur précédente", () => {
    const before = openManual(NO_MANUAL, "novice");
    const after = toggleManual(before, "novice");

    expect(isManualOpen(before, "novice")).toBe(true);
    expect(isManualOpen(after, "novice")).toBe(false);
  });

  it("une réponse en retard ne rouvre pas la grille du palier affiché", () => {
    // Le défaut qu'un booléen unique laissait passer : pull de Novice parti,
    // bascule sur Advanced, Advanced arrive, l'utilisateur replie sa grille…
    // puis Novice se résout enfin. L'écran affiche Advanced : son repli doit
    // tenir, la réponse de Novice n'ouvre que Novice.
    const afterAdvancedImport = openManual(NO_MANUAL, "advanced");
    const userCollapsed = toggleManual(afterAdvancedImport, "advanced");
    const lateNovice = opensManualGrid(done())
      ? openManual(userCollapsed, "novice")
      : userCollapsed;

    expect(isManualOpen(lateNovice, "advanced")).toBe(false);
    expect(isManualOpen(lateNovice, "novice")).toBe(true);
  });
});

describe("opensManualGrid", () => {
  it("ouvre la saisie sur un import abouti : c'est l'utilisateur qui valide", () => {
    expect(opensManualGrid(done())).toBe(true);
  });

  it("ouvre la saisie sur un échec : le repli manuel est le seul chemin restant", () => {
    expect(opensManualGrid(importFailed("Trop d'imports aujourd'hui."))).toBe(true);
  });

  it("n'ouvre rien tant que l'import est en vol ou au repos", () => {
    expect(opensManualGrid(LOADING)).toBe(false);
    expect(opensManualGrid(IDLE)).toBe(false);
  });
});
