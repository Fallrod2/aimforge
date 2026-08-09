import { describe, expect, it } from "vitest";
import { scenarioCatalog } from "../shared/scenarios";
import { debriefTexts, extractJsonObject, parseDebrief } from "./parse";

/** Le palier du joueur : la seule liste de scénarios que le debrief peut citer. */
const ALLOWED = scenarioCatalog("novice").names;

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
    const parsed = parseDebrief(JSON_TEXT, ALLOWED);

    expect(parsed.ok).toBe(true);
    expect(parsed.ok && parsed.debrief.focus).toBe("Viseur à hauteur de tête.");
  });

  it("accepte le même JSON enrobé de markdown", () => {
    expect(parseDebrief(`\`\`\`json\n${JSON_TEXT}\n\`\`\``, ALLOWED).ok).toBe(true);
  });

  it("refuse une réponse sans JSON, avec une raison exploitable en relance", () => {
    const parsed = parseDebrief("Je préfère te répondre en texte libre.", ALLOWED);

    expect(parsed.ok).toBe(false);
    expect(parsed.ok || parsed.reason).toContain("aucun objet JSON");
  });

  it("refuse un JSON mal formé", () => {
    const parsed = parseDebrief('{"resume": "oups", }', ALLOWED);

    expect(parsed.ok).toBe(false);
    expect(parsed.ok || parsed.reason).toContain("mal formé");
  });

  it("refuse un JSON valide mais hors contrat, en nommant le champ fautif", () => {
    const parsed = parseDebrief(JSON.stringify({ ...DEBRIEF, focus: undefined }), ALLOWED);

    expect(parsed.ok).toBe(false);
    expect(parsed.ok || parsed.reason).toContain("schéma");
    expect(parsed.ok || parsed.reason).toContain("focus");
  });

  it("refuse une liste d'axes vide", () => {
    const parsed = parseDebrief(JSON.stringify({ ...DEBRIEF, axes: [] }), ALLOWED);

    expect(parsed.ok).toBe(false);
  });

  it("refuse une réponse contenant deux objets : rien ne dit lequel est le debrief", () => {
    expect(parseDebrief(`${JSON_TEXT}\n${JSON_TEXT}`, ALLOWED).ok).toBe(false);
  });
});

describe("debriefTexts", () => {
  it("rend tous les textes du debrief, y compris les détails des axes", () => {
    expect(debriefTexts(DEBRIEF)).toEqual([
      "Partie serrée, perdue sur les retakes.",
      "Entrées propres sur A",
      "Retakes",
      "Entrez groupés après la pose.",
      "Viseur à hauteur de tête.",
    ]);
  });
});

/**
 * La police de scénarios du coach — l'exact pendant de celle de la routine.
 *
 * Elle existe à cause d'une génération réelle (deepseek servi par la
 * plateforme) qui a recommandé quatre entraînements inexistants. Les tests
 * ci-dessous couvrent les deux moitiés du problème : ce que la police attrape,
 * et ce qu'elle n'attrape pas.
 */
describe("parseDebrief — police des scénarios", () => {
  function withAxeDetail(detail: string): string {
    return JSON.stringify({ ...DEBRIEF, axes: [{ titre: "Tracking", detail }] });
  }

  it("accepte un scénario du palier, cité au mot près", () => {
    expect(parseDebrief(withAxeDetail("Fais 3 runs de VT Pasu Novice."), ALLOWED).ok).toBe(true);
  });

  it("refuse un scénario inventé, en le nommant pour la relance", () => {
    const parsed = parseDebrief(withAxeDetail("Fais 3 runs de VT Reactive Tracking."), ALLOWED);

    expect(parsed.ok).toBe(false);
    expect(parsed.ok || parsed.reason).toContain("« VT Reactive Tracking »");
    expect(parsed.ok || parsed.reason).toContain("<scenarios_autorises>");
  });

  it("refuse un scénario d'un autre palier que celui du joueur", () => {
    const parsed = parseDebrief(withAxeDetail("Passe sur VT Pasu Intermediate."), ALLOWED);

    expect(parsed.ok).toBe(false);
    expect(parsed.ok || parsed.reason).toContain("« VT Pasu Intermediate »");
  });

  it("relit le resume, les points forts et le focus, pas seulement les axes", () => {
    for (const faulty of [
      { ...DEBRIEF, resume: "Bon match, mais VT Inventé A reste à travailler." },
      { ...DEBRIEF, points_forts: ["Net sur VT Inventé B"] },
      { ...DEBRIEF, focus: "Trente minutes de VT Inventé C." },
    ]) {
      expect(parseDebrief(JSON.stringify(faulty), ALLOWED).ok).toBe(false);
    }
  });

  /**
   * Le cas réel, et la limite dite honnêtement : ce debrief est exactement
   * celui qui a été servi en production. Aucun de ses quatre scénarios
   * n'existe, et pourtant il passe — aucun ne porte le marqueur « VT », donc
   * rien ne le distingue mécaniquement d'un conseil rédigé en français. Ce qui
   * combat ces inventions-là est le prompt (liste exacte + repli sur la
   * sous-catégorie), pas cette fonction. Ce test le grave pour qu'on ne croie
   * pas la police plus forte qu'elle n'est.
   */
  it("laisse passer les inventions sans préfixe VT — limite documentée, cas de production", () => {
    const production = {
      resume: "Défaite 11-13 sur Ascent, avec un début de partie perdu au duel.",
      points_forts: ["Placement de viseur correct en attaque"],
      axes: [
        {
          titre: "Tracking rapproché",
          detail: "Travaille Close Range Strafe Tracking et Reactive Tracking, 10 minutes.",
        },
        { titre: "Flicks", detail: "Ajoute du PraFlick en fin de séance." },
      ],
      focus: "Fais des scénarios d'éco avec des armes faibles.",
    };

    expect(parseDebrief(JSON.stringify(production), ALLOWED).ok).toBe(true);
  });
});
