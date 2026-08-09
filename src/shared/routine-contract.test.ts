import { describe, expect, it } from "vitest";
import {
  MAX_DUREE_MINUTES,
  MAX_FOCUS_LENGTH,
  MIN_DUREE_MINUTES,
  routineContentSchema,
  routineRequestSchema,
  storedRoutineSchema,
} from "./routine-contract";

const CONTENT = {
  titre: "Séance 45 min · Tracking précis",
  duree_totale: 45,
  blocs: [
    {
      nom: "Échauffement",
      duree: 10,
      items: [{ texte: "VT Pasu Novice", detail: "3 runs, sans forcer la vitesse." }],
    },
  ],
  objectif_game: "Un duel gagné par round sur l'entrée.",
  conseil: "Coupe le son du chat vocal pendant la séance.",
};

describe("routineRequestSchema", () => {
  it("accepte une durée dans les bornes sans focus", () => {
    const parsed = routineRequestSchema.safeParse({ duree_minutes: 45 });

    expect(parsed.success).toBe(true);
    expect(parsed.success && parsed.data.focus).toBeNull();
  });

  it("normalise un focus vide ou blanc en absence de focus", () => {
    expect(routineRequestSchema.parse({ duree_minutes: 30, focus: "   " }).focus).toBeNull();
    expect(routineRequestSchema.parse({ duree_minutes: 30, focus: null }).focus).toBeNull();
  });

  it("détoure le focus renseigné", () => {
    expect(routineRequestSchema.parse({ duree_minutes: 30, focus: "  tracking  " }).focus).toBe(
      "tracking",
    );
  });

  it("refuse une durée hors bornes ou non entière", () => {
    expect(routineRequestSchema.safeParse({ duree_minutes: MIN_DUREE_MINUTES - 1 }).success).toBe(
      false,
    );
    expect(routineRequestSchema.safeParse({ duree_minutes: MAX_DUREE_MINUTES + 1 }).success).toBe(
      false,
    );
    expect(routineRequestSchema.safeParse({ duree_minutes: 42.5 }).success).toBe(false);
  });

  it("refuse une durée absente ou non numérique", () => {
    expect(routineRequestSchema.safeParse({}).success).toBe(false);
    expect(routineRequestSchema.safeParse({ duree_minutes: "45" }).success).toBe(false);
  });

  it("refuse un focus plus long que la borne", () => {
    expect(
      routineRequestSchema.safeParse({ duree_minutes: 45, focus: "x".repeat(MAX_FOCUS_LENGTH + 1) })
        .success,
    ).toBe(false);
  });
});

describe("routineContentSchema", () => {
  it("accepte une séance conforme", () => {
    expect(routineContentSchema.safeParse(CONTENT).success).toBe(true);
  });

  it("refuse une séance sans bloc", () => {
    expect(routineContentSchema.safeParse({ ...CONTENT, blocs: [] }).success).toBe(false);
  });

  it("refuse un bloc sans item", () => {
    expect(
      routineContentSchema.safeParse({
        ...CONTENT,
        blocs: [{ nom: "Vide", duree: 10, items: [] }],
      }).success,
    ).toBe(false);
  });

  it("refuse un item sans détail", () => {
    expect(
      routineContentSchema.safeParse({
        ...CONTENT,
        blocs: [{ nom: "Bloc", duree: 5, items: [{ texte: "VT Pasu Novice", detail: "" }] }],
      }).success,
    ).toBe(false);
  });

  it("refuse une durée de bloc nulle ou négative", () => {
    expect(
      routineContentSchema.safeParse({
        ...CONTENT,
        blocs: [{ ...CONTENT.blocs[0], duree: 0 }],
      }).success,
    ).toBe(false);
  });

  it("tolère un total qui ne colle pas exactement à la somme des blocs", () => {
    // Le modèle arrondit ; refuser coûterait une relance pour rien.
    expect(routineContentSchema.safeParse({ ...CONTENT, duree_totale: 44 }).success).toBe(true);
  });
});

describe("storedRoutineSchema", () => {
  it("accepte une routine relue en base", () => {
    const parsed = storedRoutineSchema.safeParse({
      ...CONTENT,
      id: 12,
      date: "2026-08-09T10:00:00.000Z",
      duree_minutes: 45,
      focus: null,
      done: false,
    });

    expect(parsed.success).toBe(true);
  });

  it("refuse une routine sans identifiant", () => {
    expect(
      storedRoutineSchema.safeParse({
        ...CONTENT,
        date: "2026-08-09T10:00:00.000Z",
        duree_minutes: 45,
        focus: null,
        done: false,
      }).success,
    ).toBe(false);
  });
});
