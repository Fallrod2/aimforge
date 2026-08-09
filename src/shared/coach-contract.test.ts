import { describe, expect, it } from "vitest";
import {
  coachDebriefSchema,
  coachErrorSchema,
  coachRequestSchema,
  coachResponseSchema,
  MAX_STATS_LENGTH,
  storedDebriefSchema,
} from "./coach-contract";

const VALID = {
  resume: "Partie serrée en attaque, perdue sur les retakes.",
  points_forts: ["Entrées propres sur A", "Bonne gestion des utilitaires"],
  axes: [
    {
      titre: "Crosshair placement",
      detail: "Garde le viseur à hauteur de tête dans les couloirs.",
    },
    { titre: "Retakes", detail: "Entrez groupés plutôt qu'en trickle après la pose." },
  ],
  focus: "Une seule chose : viseur à hauteur de tête.",
};

describe("coachRequestSchema", () => {
  it("accepte des stats collées", () => {
    expect(coachRequestSchema.safeParse({ stats: "Ascent · Jett · 18/14/5" }).success).toBe(true);
  });

  it("refuse des stats vides", () => {
    expect(coachRequestSchema.safeParse({ stats: "" }).success).toBe(false);
    expect(coachRequestSchema.safeParse({}).success).toBe(false);
  });

  it("refuse des stats faites uniquement d'espaces", () => {
    // Sans détourage, ce corps atteindrait le modèle : la fonction est
    // appelable sans passer par le formulaire, qui, lui, détoure déjà.
    expect(coachRequestSchema.safeParse({ stats: "   \n\t " }).success).toBe(false);
  });

  it("détoure les stats acceptées", () => {
    const parsed = coachRequestSchema.safeParse({ stats: "  Ascent 13-11  \n" });

    expect(parsed.success && parsed.data.stats).toBe("Ascent 13-11");
  });

  it("refuse une entrée trop longue", () => {
    expect(coachRequestSchema.safeParse({ stats: "x".repeat(MAX_STATS_LENGTH) }).success).toBe(
      true,
    );
    expect(coachRequestSchema.safeParse({ stats: "x".repeat(MAX_STATS_LENGTH + 1) }).success).toBe(
      false,
    );
  });
});

describe("coachDebriefSchema", () => {
  it("accepte un debrief conforme", () => {
    const parsed = coachDebriefSchema.safeParse(VALID);

    expect(parsed.success).toBe(true);
    expect(parsed.success && parsed.data.axes).toHaveLength(2);
  });

  it("refuse un debrief amputé d'une clé du contrat", () => {
    for (const key of ["resume", "points_forts", "axes", "focus"] as const) {
      const { [key]: _removed, ...rest } = VALID;

      expect(coachDebriefSchema.safeParse(rest).success, key).toBe(false);
    }
  });

  it("refuse une liste vide plutôt que d'afficher une section sans contenu", () => {
    expect(coachDebriefSchema.safeParse({ ...VALID, points_forts: [] }).success).toBe(false);
    expect(coachDebriefSchema.safeParse({ ...VALID, axes: [] }).success).toBe(false);
  });

  it("refuse un axe sans détail", () => {
    expect(
      coachDebriefSchema.safeParse({ ...VALID, axes: [{ titre: "Retakes", detail: "" }] }).success,
    ).toBe(false);
    expect(coachDebriefSchema.safeParse({ ...VALID, axes: [{ titre: "Retakes" }] }).success).toBe(
      false,
    );
  });

  it("refuse une chaîne là où le contrat attend une liste", () => {
    expect(coachDebriefSchema.safeParse({ ...VALID, points_forts: "bonnes entrées" }).success).toBe(
      false,
    );
  });

  it("ignore les clés supplémentaires plutôt que de refuser le debrief", () => {
    const parsed = coachDebriefSchema.safeParse({ ...VALID, commentaire: "bonus du modèle" });

    expect(parsed.success).toBe(true);
    expect(parsed.success && "commentaire" in parsed.data).toBe(false);
  });
});

describe("storedDebriefSchema", () => {
  it("exige un identifiant et une date", () => {
    expect(
      storedDebriefSchema.safeParse({ ...VALID, id: 12, date: "2026-08-08T10:00:00Z" }).success,
    ).toBe(true);
    expect(storedDebriefSchema.safeParse(VALID).success).toBe(false);
    expect(storedDebriefSchema.safeParse({ ...VALID, id: 0, date: "x" }).success).toBe(false);
  });
});

describe("réponses de la fonction", () => {
  it("valide une réponse de succès", () => {
    const parsed = coachResponseSchema.safeParse({
      debrief: { ...VALID, id: 3, date: "2026-08-08T10:00:00Z" },
      remaining: 4,
    });

    expect(parsed.success).toBe(true);
  });

  it("valide une erreur de quota, avec ou sans compteur", () => {
    expect(coachErrorSchema.safeParse({ error: "Quota atteint", remaining: 0 }).success).toBe(true);
    expect(coachErrorSchema.safeParse({ error: "IA non configurée" }).success).toBe(true);
    expect(coachErrorSchema.safeParse({ error: "" }).success).toBe(false);
    expect(coachErrorSchema.safeParse({}).success).toBe(false);
  });
});
