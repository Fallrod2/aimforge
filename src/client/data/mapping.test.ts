/**
 * La frontière base → UI. Ce module est le seul endroit où une ligne Postgres
 * devient un type d'affichage : c'est aussi le seul endroit où l'on peut se
 * tromper de palier, de date ou d'ordre.
 */

import { describe, expect, it } from "vitest";
import { listScenarios } from "../../lib/energy";
import { anchorEnergy, scoresAtAnchor } from "../../lib/energy/fixtures";
import { DataError } from "./errors";
import {
  type BenchRunRow,
  type ScenarioScoreRow,
  toBenchRunDetail,
  toBenchRunSummaries,
  toBenchRunSummary,
} from "./mapping";

const row: BenchRunRow = {
  id: 12,
  date: "2026-03-01T12:00:00+00:00",
  tier: "novice",
  overall: 400,
  rank: "Gold",
  complete: true,
  source: "manual",
  season: "voltaic-s5",
};

describe("toBenchRunSummary", () => {
  it("reprend les valeurs de la ligne telles quelles", () => {
    expect(toBenchRunSummary(row)).toEqual({
      id: 12,
      date: "2026-03-01T12:00:00.000Z",
      tier: "novice",
      season: "voltaic-s5",
      overall: 400,
      rank: "Gold",
      complete: true,
      source: "manual",
    });
  });

  it("normalise le timestamptz de PostgREST en ISO UTC", () => {
    // Même instant, deux écritures : l'UI trie les dates lexicographiquement,
    // deux formes différentes s'ordonneraient au hasard.
    const utc = toBenchRunSummary({ ...row, date: "2026-03-01T12:00:00+00:00" });
    const shifted = toBenchRunSummary({ ...row, date: "2026-03-01T14:00:00+02:00" });

    expect(utc.date).toBe("2026-03-01T12:00:00.000Z");
    expect(shifted.date).toBe(utc.date);
  });

  it("garde un rang absent à null (aucune passe sous le premier rang n'en invente)", () => {
    expect(toBenchRunSummary({ ...row, rank: null, overall: 0 }).rank).toBeNull();
  });

  it("refuse un palier hors des trois : c'est une dérive de schéma, pas une saisie", () => {
    expect(() => toBenchRunSummary({ ...row, tier: "expert" })).toThrow(DataError);
    expect(() => toBenchRunSummary({ ...row, tier: "expert" })).toThrow(/expert/);
  });

  it("refuse une date illisible plutôt que de rendre « Invalid Date » à l'écran", () => {
    expect(() => toBenchRunSummary({ ...row, date: "pas une date" })).toThrow(DataError);
  });

  it("reconnaît une passe importée depuis KovaaK's", () => {
    expect(toBenchRunSummary({ ...row, source: "kovaaks" }).source).toBe("kovaaks");
  });

  it("refuse une provenance hors des deux : c'est une dérive de schéma", () => {
    expect(() => toBenchRunSummary({ ...row, source: "aimlab" })).toThrow(DataError);
    expect(() => toBenchRunSummary({ ...row, source: "aimlab" })).toThrow(/aimlab/);
  });
});

describe("toBenchRunSummaries", () => {
  it("conserve l'ordre de la requête (le tri est fait par Postgres)", () => {
    const rows = [
      { ...row, id: 3, date: "2026-03-03T00:00:00+00:00" },
      { ...row, id: 1, date: "2026-03-01T00:00:00+00:00" },
      { ...row, id: 2, date: "2026-03-02T00:00:00+00:00" },
    ];

    expect(toBenchRunSummaries(rows).map((run) => run.id)).toEqual([3, 1, 2]);
  });

  it("rend une liste vide sans broncher", () => {
    expect(toBenchRunSummaries([])).toEqual([]);
  });
});

describe("toBenchRunDetail", () => {
  const scores = scoresAtAnchor("novice", "Gold");
  const scoreRows: readonly ScenarioScoreRow[] = Object.entries(scores).map(
    ([scenario, score]) => ({
      scenario,
      score,
      energy: anchorEnergy("novice", "Gold"),
    }),
  );

  it("rend les 9 sous-catégories, dérivées à la lecture", () => {
    const detail = toBenchRunDetail(row, scoreRows);

    expect(detail.subcategories).toHaveLength(9);
    for (const sub of detail.subcategories) {
      expect(sub.energy).toBeCloseTo(anchorEnergy("novice", "Gold"), 5);
    }
  });

  it("range les scénarios dans l'ordre du tableur Voltaic, pas dans celui de Postgres", () => {
    const shuffled = [...scoreRows].reverse();
    const detail = toBenchRunDetail(row, shuffled);

    expect(detail.scores.map((score) => score.scenario)).toEqual(
      listScenarios("novice").map((scenario) => scenario.name),
    );
  });

  it("garde l'énergie figée en base, sans la recalculer", () => {
    const detail = toBenchRunDetail(row, [
      { scenario: "VT Pasu Novice", score: 745, energy: 123.45 },
    ]);

    expect(detail.scores).toEqual([{ scenario: "VT Pasu Novice", score: 745, energy: 123.45 }]);
  });

  it("rend une passe sans aucun score : 9 sous-catégories à 0", () => {
    const detail = toBenchRunDetail({ ...row, overall: 0, rank: null, complete: false }, []);

    expect(detail.scores).toEqual([]);
    expect(detail.subcategories).toHaveLength(9);
    expect(detail.subcategories.every((sub) => sub.energy === 0)).toBe(true);
  });

  it("ne perd pas un scénario inconnu du palier : il ferme la marche", () => {
    const detail = toBenchRunDetail(row, [
      { scenario: "VT Inconnu", score: 1, energy: 2 },
      { scenario: "VT Pasu Novice", score: 745, energy: 300 },
    ]);

    expect(detail.scores.map((score) => score.scenario)).toEqual(["VT Pasu Novice", "VT Inconnu"]);
  });
});
