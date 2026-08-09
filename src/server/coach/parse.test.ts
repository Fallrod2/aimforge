import { describe, expect, it } from "vitest";
import { extractJsonObject, parseDebrief } from "./parse";

const DEBRIEF = {
  resume: "Partie serrée, perdue sur les retakes.",
  points_forts: ["Entrées propres sur A"],
  axes: [{ titre: "Retakes", detail: "Entrez groupés après la pose." }],
  focus: "Viseur à hauteur de tête.",
};

const JSON_TEXT = JSON.stringify(DEBRIEF);

describe("extractJsonObject", () => {
  it("rend l'objet d'une réponse nue", () => {
    expect(extractJsonObject(JSON_TEXT)).toBe(JSON_TEXT);
  });

  it("retire un bloc de code markdown", () => {
    expect(extractJsonObject(`\`\`\`json\n${JSON_TEXT}\n\`\`\``)).toBe(JSON_TEXT);
  });

  it("ignore le bavardage avant et après", () => {
    expect(extractJsonObject(`Voici ton debrief :\n${JSON_TEXT}\n\nBon entraînement !`)).toBe(
      JSON_TEXT,
    );
  });

  it("rend null quand il n'y a aucun objet", () => {
    expect(extractJsonObject("Je ne peux pas t'aider.")).toBeNull();
    expect(extractJsonObject("")).toBeNull();
    expect(extractJsonObject("} mal placé {")).toBeNull();
  });
});

describe("parseDebrief", () => {
  it("accepte un JSON valide et conforme", () => {
    const parsed = parseDebrief(JSON_TEXT);

    expect(parsed.ok).toBe(true);
    expect(parsed.ok && parsed.debrief.focus).toBe("Viseur à hauteur de tête.");
  });

  it("accepte le même JSON enrobé de markdown", () => {
    expect(parseDebrief(`\`\`\`json\n${JSON_TEXT}\n\`\`\``).ok).toBe(true);
  });

  it("refuse une réponse sans JSON, avec une raison exploitable en relance", () => {
    const parsed = parseDebrief("Je préfère te répondre en texte libre.");

    expect(parsed.ok).toBe(false);
    expect(parsed.ok || parsed.reason).toContain("aucun objet JSON");
  });

  it("refuse un JSON mal formé", () => {
    const parsed = parseDebrief('{"resume": "oups", }');

    expect(parsed.ok).toBe(false);
    expect(parsed.ok || parsed.reason).toContain("mal formé");
  });

  it("refuse un JSON valide mais hors contrat, en nommant le champ fautif", () => {
    const parsed = parseDebrief(JSON.stringify({ ...DEBRIEF, focus: undefined }));

    expect(parsed.ok).toBe(false);
    expect(parsed.ok || parsed.reason).toContain("schéma");
    expect(parsed.ok || parsed.reason).toContain("focus");
  });

  it("refuse une liste d'axes vide", () => {
    const parsed = parseDebrief(JSON.stringify({ ...DEBRIEF, axes: [] }));

    expect(parsed.ok).toBe(false);
  });

  it("refuse une réponse contenant deux objets : rien ne dit lequel est le debrief", () => {
    expect(parseDebrief(`${JSON_TEXT}\n${JSON_TEXT}`).ok).toBe(false);
  });
});
