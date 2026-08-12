import { describe, expect, it } from "vitest";
import {
  clearTier,
  draftScores,
  emptyDraft,
  parseScoreInput,
  setScoreInput,
  tierDraft,
} from "./draft";

const PASU = "VT Pasu Novice";
const POPCORN = "VT Popcorn Novice";

describe("parseScoreInput", () => {
  it("reconnaît un entier et un décimal", () => {
    expect(parseScoreInput("807")).toEqual({ state: "ok", score: 807 });
    expect(parseScoreInput("412.96")).toEqual({ state: "ok", score: 412.96 });
  });

  it("accepte la virgule décimale du clavier français", () => {
    expect(parseScoreInput("412,96")).toEqual({ state: "ok", score: 412.96 });
  });

  it("accepte les espaces de groupement, y compris insécables", () => {
    // Espace simple, insécable (U+00A0) et insécable étroit (U+202F) : ce que
    // produit un copier-coller depuis un nombre affiché à la française.
    for (const space of [" ", " ", " "]) {
      expect(parseScoreInput(`1${space}162`), JSON.stringify(space)).toEqual({
        state: "ok",
        score: 1162,
      });
    }
  });

  it("distingue le champ vide du champ invalide", () => {
    expect(parseScoreInput("")).toEqual({ state: "empty" });
    expect(parseScoreInput("   ")).toEqual({ state: "empty" });
  });

  it("refuse tout ce qui n'est pas un nombre positif plutôt que de deviner", () => {
    for (const raw of ["abc", "-5", "12.5.6", "1e3", "807pts", "+807", ".5"]) {
      expect(parseScoreInput(raw), raw).toEqual({ state: "invalid" });
    }
  });
});

describe("setScoreInput", () => {
  it("garde les saisies palier par palier", () => {
    const draft = setScoreInput(
      setScoreInput(emptyDraft(), "novice", PASU, "807"),
      "intermediate",
      "VT Pasu Intermediate",
      "900",
    );

    expect(tierDraft(draft, "novice")[PASU]).toBe("807");
    expect(tierDraft(draft, "intermediate")["VT Pasu Intermediate"]).toBe("900");
    expect(tierDraft(draft, "advanced")).toEqual({});
  });

  it("efface le scénario quand la saisie repasse à vide", () => {
    const filled = setScoreInput(emptyDraft(), "novice", PASU, "807");
    const emptied = setScoreInput(filled, "novice", PASU, "");

    expect(tierDraft(emptied, "novice")).toEqual({});
  });

  it("ne mute pas le brouillon reçu", () => {
    const before = setScoreInput(emptyDraft(), "novice", PASU, "807");

    setScoreInput(before, "novice", POPCORN, "500");
    expect(tierDraft(before, "novice")).toEqual({ [PASU]: "807" });
  });
});

describe("clearTier", () => {
  it("ne vide que le palier demandé", () => {
    const draft = setScoreInput(
      setScoreInput(emptyDraft(), "novice", PASU, "807"),
      "advanced",
      "VT Pasu Advanced",
      "1000",
    );
    const cleared = clearTier(draft, "novice");

    expect(tierDraft(cleared, "novice")).toEqual({});
    expect(tierDraft(cleared, "advanced")).toEqual({ "VT Pasu Advanced": "1000" });
  });
});

describe("draftScores", () => {
  it("ne retient que les saisies exploitables et signale les autres", () => {
    let draft = setScoreInput(emptyDraft(), "novice", PASU, "807");

    draft = setScoreInput(draft, "novice", POPCORN, "oups");

    expect(draftScores(draft, "novice")).toEqual({
      scores: { [PASU]: 807 },
      invalid: [POPCORN],
    });
  });

  it("ignore les champs vides sans les compter comme invalides", () => {
    const draft = setScoreInput(emptyDraft(), "novice", PASU, "  ");

    expect(draftScores(draft, "novice")).toEqual({ scores: {}, invalid: [] });
  });

  it("autorise une saisie partielle : un seul scénario suffit", () => {
    const draft = setScoreInput(emptyDraft(), "novice", PASU, "807");

    expect(Object.keys(draftScores(draft, "novice").scores)).toEqual([PASU]);
  });
});
