import { describe, expect, it } from "vitest";
import { draftScores, emptyDraft, setScoreInput, tierDraft } from "./draft";
import {
  applyImportedScores,
  clearImportState,
  formatImportedScore,
  IDLE,
  importFailed,
  importReport,
  importStateFor,
  importSucceeded,
  isImportedTier,
  LOADING,
  NO_IMPORTS,
  withImportState,
} from "./import";

describe("formatImportedScore", () => {
  it("écrit un entier sans décimale", () => {
    expect(formatImportedScore(1395)).toBe("1395");
  });

  it("garde le point comme séparateur décimal", () => {
    expect(formatImportedScore(683.5)).toBe("683.5");
    expect(formatImportedScore(1395.23)).toBe("1395.23");
  });

  it("ne laisse pas fuiter la traîne binaire d'un flottant", () => {
    expect(formatImportedScore(0.1 + 0.2)).toBe("0.3");
  });

  it("produit une chaîne que la saisie sait relire", () => {
    const draft = setScoreInput(
      emptyDraft(),
      "novice",
      "VT Pasu Novice",
      formatImportedScore(683.5),
    );

    expect(draftScores(draft, "novice")).toEqual({
      scores: { "VT Pasu Novice": 683.5 },
      invalid: [],
    });
  });
});

describe("applyImportedScores", () => {
  it("verse les scores importés dans le palier visé", () => {
    const draft = applyImportedScores(emptyDraft(), "novice", {
      "VT Pasu Novice": 683.5,
      "VT Popcorn Novice": 512,
    });

    expect(tierDraft(draft, "novice")).toEqual({
      "VT Pasu Novice": "683.5",
      "VT Popcorn Novice": "512",
    });
  });

  it("laisse les autres paliers intacts", () => {
    const before = setScoreInput(emptyDraft(), "advanced", "VT Pasu Advanced", "968.4");
    const after = applyImportedScores(before, "novice", { "VT Pasu Novice": 683.5 });

    expect(tierDraft(after, "advanced")).toEqual({ "VT Pasu Advanced": "968.4" });
  });

  it("complète sans effacer une saisie que l'import ne couvre pas", () => {
    const before = setScoreInput(emptyDraft(), "novice", "VT Ground Novice", "2100");
    const after = applyImportedScores(before, "novice", { "VT Pasu Novice": 683.5 });

    expect(tierDraft(after, "novice")["VT Ground Novice"]).toBe("2100");
    expect(tierDraft(after, "novice")["VT Pasu Novice"]).toBe("683.5");
  });

  it("remplace une saisie que l'import couvre", () => {
    const before = setScoreInput(emptyDraft(), "novice", "VT Pasu Novice", "1");
    const after = applyImportedScores(before, "novice", { "VT Pasu Novice": 683.5 });

    expect(tierDraft(after, "novice")["VT Pasu Novice"]).toBe("683.5");
  });

  it("ne touche à rien quand l'import est vide", () => {
    const before = setScoreInput(emptyDraft(), "novice", "VT Pasu Novice", "1");

    expect(applyImportedScores(before, "novice", {})).toEqual(before);
  });
});

describe("machine d'état", () => {
  it("part au repos et passe en chargement", () => {
    expect(IDLE.status).toBe("idle");
    expect(LOADING.status).toBe("loading");
  });

  it("retient le message d'un échec", () => {
    expect(importFailed("Pseudo inconnu.")).toEqual({
      status: "error",
      message: "Pseudo inconnu.",
    });
  });

  it("retient les scénarios remplis et les manquants", () => {
    const state = importSucceeded({
      username: "Victard",
      scores: { "VT Pasu Novice": 683.5, "VT Popcorn Novice": 512 },
      missing: [{ scenario: "VT Ground Novice", reason: "sans-score" }],
    });

    expect(state).toEqual({
      status: "done",
      username: "Victard",
      filled: ["VT Pasu Novice", "VT Popcorn Novice"],
      missing: [{ scenario: "VT Ground Novice", reason: "sans-score" }],
    });
  });
});

describe("état d'import par palier", () => {
  /** Un import complet de novice, tel que le tracker le range. */
  function afterNoviceImport() {
    return withImportState(
      NO_IMPORTS,
      "novice",
      importSucceeded({
        username: "Victard",
        scores: Object.fromEntries(
          Array.from({ length: 18 }, (_, index) => [`VT scenario ${index} Novice`, 500]),
        ),
        missing: [],
      }),
    );
  }

  it("part au repos sur les trois paliers", () => {
    for (const tier of ["novice", "intermediate", "advanced"] as const) {
      expect(importStateFor(NO_IMPORTS, tier)).toEqual(IDLE);
    }
  });

  it("n'annonce pas sur un autre palier l'import qu'on vient de faire", () => {
    // Le scénario exact du défaut : importer en novice, basculer en advanced.
    // L'écran ne doit plus dire « 18 scénarios importés » au-dessus d'une
    // grille vide — ce serait inviter à sauvegarder une passe inexistante.
    const states = afterNoviceImport();

    expect(importStateFor(states, "novice").status).toBe("done");
    expect(importStateFor(states, "advanced")).toEqual(IDLE);
    expect(importReport(importStateFor(states, "advanced"), 18)).toBeNull();
    expect(importReport(importStateFor(states, "novice"), 18)).toContain("18 scénarios importés");
  });

  it("ne marque comme importé que le palier concerné", () => {
    const states = afterNoviceImport();

    expect(isImportedTier(states, "novice")).toBe(true);
    expect(isImportedTier(states, "intermediate")).toBe(false);
    expect(isImportedTier(states, "advanced")).toBe(false);
  });

  it("ne marque pas importé un palier dont l'import n'a rien ramené", () => {
    const states = withImportState(
      NO_IMPORTS,
      "novice",
      importSucceeded({ username: "Victard", scores: {}, missing: [] }),
    );

    expect(isImportedTier(states, "novice")).toBe(false);
  });

  it("ne marque pas importé un palier dont l'import a échoué", () => {
    const states = withImportState(NO_IMPORTS, "novice", importFailed("Pseudo inconnu."));

    expect(isImportedTier(states, "novice")).toBe(false);
  });

  it("garde les deux paliers quand on importe successivement", () => {
    const states = withImportState(
      afterNoviceImport(),
      "advanced",
      importSucceeded({
        username: "Victard",
        scores: { "VT Pasu Advanced": 968.4 },
        missing: [],
      }),
    );

    expect(isImportedTier(states, "novice")).toBe(true);
    expect(isImportedTier(states, "advanced")).toBe(true);
  });

  it("efface un palier sans toucher aux autres", () => {
    const states = clearImportState(afterNoviceImport(), "advanced");

    expect(isImportedTier(states, "novice")).toBe(true);

    const cleared = clearImportState(states, "novice");

    expect(importStateFor(cleared, "novice")).toEqual(IDLE);
    expect(isImportedTier(cleared, "novice")).toBe(false);
  });

  it("n'altère pas l'état précédent (les mises à jour rendent un nouvel objet)", () => {
    const before = afterNoviceImport();
    const after = withImportState(before, "advanced", LOADING);

    expect(importStateFor(before, "advanced")).toEqual(IDLE);
    expect(importStateFor(after, "advanced")).toEqual(LOADING);
  });
});

describe("importReport", () => {
  function done(filled: number) {
    const scores = Object.fromEntries(
      Array.from({ length: filled }, (_, index) => [`scenario-${index}`, 100]),
    );

    return importSucceeded({ username: "Victard", scores, missing: [] });
  }

  it("ne dit rien tant que l'import n'a pas abouti", () => {
    expect(importReport(IDLE, 18)).toBeNull();
    expect(importReport(LOADING, 18)).toBeNull();
    expect(importReport(importFailed("nope"), 18)).toBeNull();
  });

  it("annonce un import complet", () => {
    expect(importReport(done(18), 18)).toContain("18 scénarios importés");
  });

  it("chiffre ce qui manque plutôt que de laisser croire à un bench complet", () => {
    const report = importReport(done(14), 18);

    expect(report).toContain("14/18");
    expect(report).toContain("4 autres");
  });

  it("explique un import sans aucun score", () => {
    expect(importReport(done(0), 18)).toContain("Aucun score trouvé");
  });
});
