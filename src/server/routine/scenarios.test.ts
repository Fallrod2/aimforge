import { describe, expect, it } from "vitest";
import { listScenarios, TIER_IDS } from "../../lib/energy";
import { scenarioCatalog, unknownScenarioMentions } from "./scenarios";

const NOVICE = scenarioCatalog("novice").names;

describe("scenarioCatalog", () => {
  it("rend les 18 scénarios du palier, groupés par sous-catégorie", () => {
    const catalog = scenarioCatalog("intermediate");

    expect(catalog.names).toHaveLength(18);
    expect(catalog.groups).toHaveLength(9);
    expect(catalog.groups.every((group) => group.scenarios.length === 2)).toBe(true);
  });

  it("reprend exactement les noms du JSON Voltaic, sans les réécrire", () => {
    for (const tier of TIER_IDS) {
      expect(scenarioCatalog(tier).names).toEqual(listScenarios(tier).map((s) => s.name));
    }
  });

  it("préfixe « VT » sur les 54 scénarios : c'est le marqueur dont dépend la police", () => {
    for (const tier of TIER_IDS) {
      for (const name of scenarioCatalog(tier).names) {
        expect(name.startsWith("VT ")).toBe(true);
      }
    }
  });
});

describe("unknownScenarioMentions", () => {
  it("ne signale rien sur un texte sans scénario", () => {
    expect(unknownScenarioMentions("Échauffement libre, 5 minutes.", NOVICE)).toEqual([]);
  });

  it("laisse passer un scénario du palier, cité exactement", () => {
    expect(unknownScenarioMentions("VT Pasu Novice : 3 runs de 60 s.", NOVICE)).toEqual([]);
  });

  it("laisse passer plusieurs scénarios dans la même phrase", () => {
    expect(
      unknownScenarioMentions("VT Pasu Novice puis VT Popcorn Novice, en alternance.", NOVICE),
    ).toEqual([]);
  });

  it("signale un scénario inventé", () => {
    expect(unknownScenarioMentions("Fais VT Tile Frenzy Deluxe, 5 runs.", NOVICE)).toEqual([
      "VT Tile Frenzy Deluxe",
    ]);
  });

  it("signale un scénario d'un autre palier que celui du joueur", () => {
    expect(unknownScenarioMentions("VT Pasu Intermediate, 3 runs.", NOVICE)).toEqual([
      "VT Pasu Intermediate",
    ]);
  });

  it("signale une casse fantaisiste plutôt que de la laisser passer", () => {
    expect(unknownScenarioMentions("vt pasu novice", NOVICE)).toEqual(["vt pasu novice"]);
  });

  it("dédoublonne les mentions et garde l'ordre d'apparition", () => {
    expect(unknownScenarioMentions("VT Faux A. VT Faux B. VT Faux A.", NOVICE)).toEqual([
      "VT Faux A",
      "VT Faux B",
    ]);
  });

  it("coupe l'extrait à la ponctuation, pas au milieu du texte suivant", () => {
    expect(unknownScenarioMentions("VT Inconnu Novice, puis repos et café.", NOVICE)).toEqual([
      "VT Inconnu Novice",
    ]);
  });

  it("ne prend pas « VT » collé à un mot pour une citation", () => {
    expect(unknownScenarioMentions("VTOL et VTuber ne sont pas des scénarios.", NOVICE)).toEqual(
      [],
    );
  });

  it("valide les 18 scénarios de chaque palier contre son propre catalogue", () => {
    for (const tier of TIER_IDS) {
      const names = scenarioCatalog(tier).names;

      expect(unknownScenarioMentions(names.join(" · "), names)).toEqual([]);
    }
  });

  it("n'a pas d'état résiduel entre deux appels (drapeau global de la regex)", () => {
    const text = "VT Inconnu";

    expect(unknownScenarioMentions(text, NOVICE)).toEqual(["VT Inconnu"]);
    expect(unknownScenarioMentions(text, NOVICE)).toEqual(["VT Inconnu"]);
  });
});
