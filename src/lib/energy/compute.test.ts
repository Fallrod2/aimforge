/**
 * `computeBenchRun` est le seul chemin de calcul d'une passe : la saisie live
 * du tracker et l'écriture en base l'appellent tous les deux. Ces tests
 * fixaient auparavant le comportement de l'API HTTP ; ils portent désormais
 * directement sur la fonction pure, sans base ni serveur.
 */

import { describe, expect, it } from "vitest";
import { computeBenchRun, computeSubcategories, scenarioNames } from "./compute";
import { listScenarios, listSubcategories } from "./data";
import { anchorEnergy, scoresAtAnchor } from "./fixtures";

describe("scenarioNames", () => {
  it("rend les 18 scénarios du palier", () => {
    const names = scenarioNames("novice");

    expect(names.size).toBe(18);
    for (const scenario of listScenarios("novice")) {
      expect(names.has(scenario.name)).toBe(true);
    }
  });

  it("ne mélange pas les paliers", () => {
    const novice = scenarioNames("novice");

    for (const scenario of listScenarios("advanced")) {
      expect(novice.has(scenario.name)).toBe(false);
    }
  });
});

describe("computeBenchRun — bench complet posé sur une ancre", () => {
  const computed = computeBenchRun("novice", scoresAtAnchor("novice", "Gold"));

  it("rend les 18 scores et les 9 sous-catégories", () => {
    expect(computed.scores).toHaveLength(18);
    expect(computed.subcategories).toHaveLength(9);
  });

  it("porte chaque sous-catégorie à l'énergie de l'ancre", () => {
    for (const sub of computed.subcategories) {
      expect(sub.energy).toBeCloseTo(anchorEnergy("novice", "Gold"), 5);
    }
  });

  it("rend un overall égal à l'énergie de l'ancre (9 valeurs identiques)", () => {
    expect(computed.overall).toBeCloseTo(anchorEnergy("novice", "Gold"), 5);
  });

  it("atteint le rang de l'ancre, badge « Complete » compris", () => {
    expect(computed.rank).toBe("Gold");
    expect(computed.complete).toBe(true);
  });
});

describe("computeBenchRun — bench incomplet", () => {
  const scenarios = listScenarios("novice");
  const full = scoresAtAnchor("novice", "Gold");
  const partial = { ...full };
  const dropped = scenarios[0];

  if (dropped === undefined) throw new Error("Palier novice sans scénario");
  delete partial[dropped.name];

  const computed = computeBenchRun("novice", partial);

  it("ne rend que les scénarios renseignés", () => {
    expect(computed.scores).toHaveLength(17);
    expect(computed.scores.some((row) => row.scenario === dropped.name)).toBe(false);
  });

  it("rend toujours les 9 sous-catégories", () => {
    expect(computed.subcategories).toHaveLength(9);
  });

  it("garde l'énergie de la sous-catégorie amputée (max des 2 scénarios)", () => {
    const owner = listSubcategories("novice").find((sub) =>
      sub.scenarios.some((scenario) => scenario.name === dropped.name),
    );

    if (owner === undefined) throw new Error("Sous-catégorie introuvable");

    const energy = computed.subcategories.find((sub) => sub.name === owner.name)?.energy;

    expect(energy).toBeCloseTo(anchorEnergy("novice", "Gold"), 5);
  });

  it("refuse le badge « Complete » : un scénario manque au seuil du rang", () => {
    expect(computed.complete).toBe(false);
  });
});

describe("computeBenchRun — sous-catégorie entièrement vide", () => {
  const empty = listSubcategories("novice")[0];

  if (empty === undefined) throw new Error("Palier novice sans sous-catégorie");

  const scores = { ...scoresAtAnchor("novice", "Gold") };

  for (const scenario of empty.scenarios) delete scores[scenario.name];

  const computed = computeBenchRun("novice", scores);

  it("écrase l'overall à 0 (moyenne harmonique avec un zéro)", () => {
    expect(computed.overall).toBe(0);
  });

  it("ne rend aucun rang, donc aucun badge", () => {
    expect(computed.rank).toBeNull();
    expect(computed.complete).toBe(false);
  });
});

describe("computeBenchRun — aucun score", () => {
  const computed = computeBenchRun("advanced", {});

  it("rend une passe vide mais structurée", () => {
    expect(computed.scores).toHaveLength(0);
    expect(computed.subcategories).toHaveLength(9);
    expect(computed.subcategories.every((sub) => sub.energy === 0)).toBe(true);
    expect(computed.overall).toBe(0);
    expect(computed.rank).toBeNull();
  });
});

describe("computeSubcategories", () => {
  it("redonne exactement les sous-catégories de computeBenchRun", () => {
    const scores = scoresAtAnchor("intermediate", "Platinum");

    expect(computeSubcategories("intermediate", scores)).toEqual(
      computeBenchRun("intermediate", scores).subcategories,
    );
  });
});
