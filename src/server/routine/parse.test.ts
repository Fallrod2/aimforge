import { describe, expect, it } from "vitest";
import { scenarioCatalog } from "../shared/scenarios";
import type { CitableFact } from "./citations";
import { parseRoutine, routineTexts, unknownScenarios } from "./parse";

const ALLOWED = scenarioCatalog("novice").names;

const ROUTINE = {
  titre: "Séance 45 min · Tracking précis",
  duree_totale: 45,
  blocs: [
    {
      nom: "Échauffement",
      duree: 10,
      items: [{ texte: "VT Pasu Novice", detail: "3 runs, sans forcer la vitesse." }],
    },
    {
      nom: "Travail ciblé",
      duree: 35,
      items: [
        { texte: "VT PGT Novice", detail: "5 runs, viseur au centre de la cible." },
        { texte: "Deathmatch", detail: "Une partie, sans se soucier du score." },
      ],
    },
  ],
  objectif_game: "Un duel gagné par round sur l'entrée.",
  conseil: "Coupe le chat vocal pendant la séance.",
};

const JSON_TEXT = JSON.stringify(ROUTINE);

describe("routineTexts", () => {
  it("ramasse tous les textes, y compris les titres de blocs et le conseil", () => {
    const texts = routineTexts(ROUTINE);

    expect(texts).toContain("Séance 45 min · Tracking précis");
    expect(texts).toContain("Échauffement");
    expect(texts).toContain("VT PGT Novice");
    expect(texts).toContain("Coupe le chat vocal pendant la séance.");
  });
});

describe("unknownScenarios", () => {
  it("ne signale rien sur une routine qui reste dans le palier", () => {
    expect(unknownScenarios(ROUTINE, ALLOWED)).toEqual([]);
  });

  it("signale un scénario inventé, où qu'il soit dans la routine", () => {
    const conseil = { ...ROUTINE, conseil: "Finis par VT Tile Frenzy Deluxe." };

    expect(unknownScenarios(conseil, ALLOWED)).toEqual(["VT Tile Frenzy Deluxe"]);
  });

  it("dédoublonne un même scénario fautif cité dans deux blocs", () => {
    const twice = {
      ...ROUTINE,
      conseil: "Reprends VT Faux Novice.",
      objectif_game: "Après VT Faux Novice, joue une classée.",
    };

    expect(unknownScenarios(twice, ALLOWED)).toEqual(["VT Faux Novice"]);
  });
});

describe("parseRoutine", () => {
  it("accepte une routine conforme", () => {
    const parsed = parseRoutine(JSON_TEXT, ALLOWED);

    expect(parsed.ok).toBe(true);
    expect(parsed.ok && parsed.routine.blocs).toHaveLength(2);
  });

  it("tolère un bloc de code markdown autour du JSON", () => {
    expect(parseRoutine(`\`\`\`json\n${JSON_TEXT}\n\`\`\``, ALLOWED).ok).toBe(true);
  });

  it("tolère une phrase avant et après l'objet", () => {
    expect(parseRoutine(`Voici ta séance :\n${JSON_TEXT}\nBon entraînement !`, ALLOWED).ok).toBe(
      true,
    );
  });

  it("refuse une réponse sans objet JSON, et le dit", () => {
    const parsed = parseRoutine("Je ne peux pas faire ça.", ALLOWED);

    expect(parsed.ok).toBe(false);
    expect(parsed.ok || parsed.reason).toContain("aucun objet JSON");
  });

  it("refuse un JSON mal formé", () => {
    const parsed = parseRoutine("{ titre: pas du json }", ALLOWED);

    expect(parsed.ok).toBe(false);
    expect(parsed.ok || parsed.reason).toContain("mal formé");
  });

  it("refuse un JSON valide mais hors schéma, en nommant le champ", () => {
    const parsed = parseRoutine(JSON.stringify({ titre: "Séance" }), ALLOWED);

    expect(parsed.ok).toBe(false);
    expect(parsed.ok || parsed.reason).toContain("schéma");
    expect(parsed.ok || parsed.reason).toContain("blocs");
  });

  it("refuse une routine bien formée qui cite un scénario inventé", () => {
    const invented = JSON.stringify({
      ...ROUTINE,
      blocs: [
        {
          nom: "Travail",
          duree: 45,
          items: [{ texte: "VT Tile Frenzy Deluxe", detail: "5 runs." }],
        },
      ],
    });
    const parsed = parseRoutine(invented, ALLOWED);

    expect(parsed.ok).toBe(false);
    expect(parsed.ok || parsed.reason).toContain("n'existent pas dans le palier");
    expect(parsed.ok || parsed.reason).toContain("VT Tile Frenzy Deluxe");
  });

  it("refuse un scénario d'un autre palier : le joueur ne l'a pas dans son bench", () => {
    const wrongTier = JSON.stringify({
      ...ROUTINE,
      blocs: [
        {
          nom: "Travail",
          duree: 45,
          items: [{ texte: "VT Pasu Advanced", detail: "5 runs." }],
        },
      ],
    });
    const parsed = parseRoutine(wrongTier, ALLOWED);

    expect(parsed.ok).toBe(false);
    expect(parsed.ok || parsed.reason).toContain("VT Pasu Advanced");
  });

  it("accepte un exercice sans scénario : tout n'est pas du KovaaK's", () => {
    const noScenario = JSON.stringify({
      ...ROUTINE,
      blocs: [
        {
          nom: "Mise en jambes",
          duree: 45,
          items: [{ texte: "Deathmatch", detail: "Une partie complète, viseur haut." }],
        },
      ],
    });

    expect(parseRoutine(noScenario, ALLOWED).ok).toBe(true);
  });

  it("ne nomme pas plus de quatre scénarios fautifs dans la relance", () => {
    const many = JSON.stringify({
      ...ROUTINE,
      blocs: [
        {
          nom: "Travail",
          duree: 45,
          items: [
            { texte: "VT A", detail: "VT B" },
            { texte: "VT C", detail: "VT D" },
            { texte: "VT E", detail: "VT F" },
          ],
        },
      ],
    });
    const parsed = parseRoutine(many, ALLOWED);

    expect(parsed.ok).toBe(false);
    expect(parsed.ok || (parsed.reason.match(/«/gu) ?? []).length).toBe(4);
  });
});

describe("parseRoutine — citations chiffrées (V5)", () => {
  const FACTS: readonly CitableFact[] = [
    { key: "HS%", value: 23, label: "Tirs à la tête (30 derniers jours)", display: "23 %" },
    { key: "Precise", value: 401.4, label: "Énergie Precise (dernier bench)", display: "401.4" },
  ];

  /** La routine de référence, avec un marqueur posé dans le détail d'un item. */
  function cited(marker: string): string {
    return JSON.stringify({
      ...ROUTINE,
      conseil: `Coupe le chat vocal, ton ${marker} le mérite.`,
    });
  }

  it("accepte une citation vraie, retire le marqueur et rend la source", () => {
    const parsed = parseRoutine(cited("[HS% 23]"), ALLOWED, FACTS);

    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    // Le joueur lit une phrase, pas un appareil de notes.
    expect(parsed.routine.conseil).toBe("Coupe le chat vocal, ton le mérite.");
    expect(parsed.sources).toEqual([
      { label: "Tirs à la tête (30 derniers jours)", value: "23 %" },
    ]);
  });

  it("accepte un arrondi de la valeur montrée au modèle", () => {
    expect(parseRoutine(cited("[Precise 401]"), ALLOWED, FACTS).ok).toBe(true);
  });

  it("refuse un chiffre faux, et le nomme dans la raison de la relance", () => {
    const parsed = parseRoutine(cited("[HS% 41]"), ALLOWED, FACTS);

    expect(parsed.ok).toBe(false);
    expect(parsed.ok || parsed.reason).toContain("[HS% 41]");
  });

  it("refuse une donnée qui n'existe pas dans le contexte", () => {
    const parsed = parseRoutine(cited("[KAST 71]"), ALLOWED, FACTS);

    expect(parsed.ok).toBe(false);
    expect(parsed.ok || parsed.reason).toContain("aucune donnée fournie");
  });

  it("refuse une routine qui ne cite rien alors qu'il y avait de quoi citer", () => {
    const parsed = parseRoutine(JSON_TEXT, ALLOWED, FACTS);

    expect(parsed.ok).toBe(false);
    expect(parsed.ok || parsed.reason).toContain("aucune recommandation n'est appuyée");
  });

  it("refuse une citation quand le registre est vide : il n'y avait rien à citer", () => {
    const parsed = parseRoutine(cited("[HS% 23]"), ALLOWED);

    expect(parsed.ok).toBe(false);
    expect(parsed.ok || parsed.reason).toContain("aucune donnée fournie");
  });

  it("refuse un texte qui ne survit pas au retrait des marqueurs", () => {
    const empty = JSON.stringify({ ...ROUTINE, conseil: "[HS% 23]" });
    const parsed = parseRoutine(empty, ALLOWED, FACTS);

    expect(parsed.ok).toBe(false);
    expect(parsed.ok || parsed.reason).toContain("phrases complètes");
  });

  it("laisse une routine sans citation intacte quand il n'y a rien à citer", () => {
    const parsed = parseRoutine(JSON_TEXT, ALLOWED);

    expect(parsed.ok).toBe(true);
    expect(parsed.ok && parsed.sources).toEqual([]);
  });
});
