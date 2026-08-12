import { afterEach, describe, expect, it } from "vitest";
import {
  type BenchmarkId,
  DEFAULT_BENCHMARK_ID,
  listScenarios,
  tierIdsFor,
} from "../../lib/energy";
import { registerBenchmark } from "../../lib/energy/benchmarks";
import { benchmarkLike } from "../../lib/energy/fixtures";
import {
  scenarioCatalog,
  scenarioNames,
  subcategoryNames,
  unknownScenarioMentions,
  unknownScenarioReason,
  unknownScenariosInTexts,
} from "./scenarios";

/**
 * Les paliers du benchmark de référence. Ce n'est plus une constante de type :
 * la liste appartient au benchmark, et se lit dans le registre (DECISIONS.md D5).
 */
const TIER_IDS = tierIdsFor(DEFAULT_BENCHMARK_ID);

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

  /**
   * La limite de la police, documentée par un cas réel plutôt que par un
   * commentaire seul : ces quatre inventions viennent d'un debrief produit en
   * production. Aucune ne porte le marqueur « VT », donc aucune n'est
   * détectable — et le test dit `[]` pour que personne ne croie le contraire.
   * Ce qui les combat est ailleurs : la liste exacte et la consigne de repli
   * sur la sous-catégorie, dans `../coach/prompt.ts`.
   */
  it("ne voit PAS les inventions sans préfixe VT — la limite assumée de la police", () => {
    const reel = [
      "Travaille Close Range Strafe Tracking pour tenir la cible de près.",
      "Ajoute du PraFlick en fin de séance.",
      "Enchaîne avec Reactive Tracking sur cible lente.",
      "Fais des scénarios d'éco avec des armes faibles.",
    ].join("\n");

    expect(unknownScenariosInTexts(reel.split("\n"), NOVICE)).toEqual([]);
  });
});

describe("scenarioNames", () => {
  it("aplatit les groupes dans l'ordre du catalogue", () => {
    const catalog = scenarioCatalog("advanced");

    expect(scenarioNames(catalog.groups)).toEqual(catalog.names);
  });

  it("rend une liste vide sur un catalogue vide", () => {
    expect(scenarioNames([])).toEqual([]);
  });
});

describe("unknownScenariosInTexts", () => {
  it("relit tous les textes, pas seulement le premier", () => {
    expect(unknownScenariosInTexts(["VT Pasu Novice", "VT Inventé"], NOVICE)).toEqual([
      "VT Inventé",
    ]);
  });

  it("dédoublonne d'un texte à l'autre et garde l'ordre d'apparition", () => {
    expect(unknownScenariosInTexts(["VT Faux A", "VT Faux B", "VT Faux A"], NOVICE)).toEqual([
      "VT Faux A",
      "VT Faux B",
    ]);
  });
});

describe("unknownScenarioReason", () => {
  it("nomme les fautifs et renvoie à la liste autorisée", () => {
    const reason = unknownScenarioReason(["VT Faux A", "VT Faux B"]);

    expect(reason).toContain("« VT Faux A »");
    expect(reason).toContain("« VT Faux B »");
    expect(reason).toContain("<scenarios_autorises>");
  });

  it("s'arrête à quatre noms : au-delà, la relance devient du bruit", () => {
    const reason = unknownScenarioReason(["a", "b", "c", "d", "e"]);

    expect(reason).toContain("« d »");
    expect(reason).not.toContain("« e »");
  });
});

describe("la police suit la grammaire du benchmark", () => {
  const OTHER = "marqueur-factice" as BenchmarkId;
  const removers: (() => void)[] = [];

  afterEach(() => {
    while (removers.length > 0) removers.pop()?.();
  });

  function registerOther(): void {
    removers.push(
      registerBenchmark(
        benchmarkLike(DEFAULT_BENCHMARK_ID, OTHER, {
          naming: { scenarioMarker: "AL", displayPrefix: "AL", tierLabelSuffix: true },
        }),
      ),
    );
  }

  it("cherche le marqueur déclaré par le benchmark, pas « VT » en dur", () => {
    registerOther();

    const text = "Fais AL Sphere Novice puis VT Pasu Novice.";

    // Sous ce benchmark, « AL » ouvre une citation — et « AL Sphere Novice »
    // n'est pas dans la liste autorisée, donc il est signalé. « VT Pasu
    // Novice », lui, n'est plus un marqueur : il passe comme du texte libre.
    expect(unknownScenarioMentions(text, NOVICE, OTHER)).toEqual([
      "AL Sphere Novice puis VT Pasu Novice",
    ]);
  });

  it("laisse passer un nom autorisé qui commence au marqueur", () => {
    registerOther();

    // Le catalogue est celui de la S5 (le benchmark factice en hérite) : un nom
    // autorisé reste autorisé, quel que soit le marqueur cherché.
    expect(unknownScenarioMentions("Fais VT Pasu Novice.", NOVICE, OTHER)).toEqual([]);
  });
});

describe("subcategoryNames", () => {
  it("rend les 9 sous-catégories du benchmark, dans l'ordre du tableur", () => {
    expect(subcategoryNames(DEFAULT_BENCHMARK_ID)).toEqual([
      "Dynamic",
      "Static",
      "Linear",
      "Precise",
      "Reactive",
      "Control",
      "Speed",
      "Evasive",
      "Stability",
    ]);
  });

  it("dit la même chose sur tous les paliers : c'est ce qui rend l'overall comparable", () => {
    for (const tier of TIER_IDS) {
      expect(subcategoryNames(DEFAULT_BENCHMARK_ID, tier)).toEqual(
        subcategoryNames(DEFAULT_BENCHMARK_ID),
      );
    }
  });
});
