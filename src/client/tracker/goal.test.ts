import { describe, expect, it } from "vitest";
import { getTier, listScenarios, toBenchmarkId } from "../../lib/energy";
import { goalKey, goalProgress, goalRanks, readGoal, writeGoal } from "./goal";
import { createMemoryStore } from "./local-store";

const S5 = toBenchmarkId("voltaic-s5");
const VISCOSE = toBenchmarkId("viscose-s2");

/** Les scores qui atteignent pile le seuil `rankName` sur les 18 scénarios. */
function atRank(tier: string, rankName: string): Record<string, number> {
  const index = getTier(tier).anchorLabels.indexOf(rankName);
  const scores: Record<string, number> = {};

  for (const scenario of listScenarios(tier)) {
    scores[scenario.name] = scenario.thresholds[index] ?? 0;
  }
  return scores;
}

describe("goalRanks", () => {
  it("propose les rangs du palier, pas une liste en dur", () => {
    expect(goalRanks("novice").map((rank) => rank.name)).toEqual([
      "Iron",
      "Bronze",
      "Silver",
      "Gold",
    ]);
    expect(goalRanks("intermediate").map((rank) => rank.name)).toEqual([
      "Platinum",
      "Diamond",
      "Jade",
      "Master",
    ]);
  });
});

describe("goalProgress", () => {
  it("compte les scénarios au seuil du rang visé", () => {
    const progress = goalProgress("novice", "Silver", atRank("novice", "Silver"));

    expect(progress).not.toBeNull();
    expect(progress?.reached).toBe(18);
    expect(progress?.total).toBe(18);
    expect(progress?.missing).toEqual([]);
  });

  it("nomme ce qui manque et le score exact à atteindre", () => {
    const scores = atRank("novice", "Silver");
    const pasu = getTier("novice").categories[0]?.subcategories[0]?.scenarios[0];
    const silver = getTier("novice").anchorLabels.indexOf("Silver");
    const threshold = pasu?.thresholds[silver] ?? 0;

    // Un seul scénario sous son seuil : dix points de moins.
    const progress = goalProgress("novice", "Silver", {
      ...scores,
      [pasu?.name ?? ""]: threshold - 10,
    });

    expect(progress?.reached).toBe(17);
    expect(progress?.missing).toHaveLength(1);
    expect(progress?.missing[0]?.scenario).toBe(pasu?.name);
    expect(progress?.missing[0]?.threshold).toBe(threshold);
    expect(progress?.missing[0]?.score).toBe(threshold - 10);
  });

  it("classe les manquants du plus proche au plus loin", () => {
    const scores = atRank("novice", "Silver");
    const [first, second] = listScenarios("novice");
    const silver = getTier("novice").anchorLabels.indexOf("Silver");
    const progress = goalProgress("novice", "Silver", {
      ...scores,
      [first?.name ?? ""]: (first?.thresholds[silver] ?? 0) - 100,
      [second?.name ?? ""]: (second?.thresholds[silver] ?? 0) - 5,
    });

    expect(progress?.missing.map((entry) => entry.scenario)).toEqual([second?.name, first?.name]);
  });

  it("traite un scénario jamais joué comme manquant, sans score", () => {
    const progress = goalProgress("novice", "Iron", {});

    expect(progress?.reached).toBe(0);
    expect(progress?.missing).toHaveLength(18);
    expect(progress?.missing[0]?.score).toBeNull();
  });

  it("lit les seuils du rang demandé, pas d'un rang voisin", () => {
    // Des scores au seuil Silver ne suffisent pas pour l'objectif Gold.
    const progress = goalProgress("novice", "Gold", atRank("novice", "Silver"));

    expect(progress?.reached).toBe(0);
  });

  it("ne casse pas sur un rang qui n'est pas de ce palier", () => {
    // Le cas réel : un objectif rangé pour Intermediate, relu en Novice.
    expect(goalProgress("novice", "Diamond", {})).toBeNull();
    expect(goalProgress("novice", "n'importe quoi", {})).toBeNull();
  });
});

describe("mémoire de l'objectif", () => {
  it("range un objectif par benchmark et par palier", () => {
    expect(goalKey(S5, "novice")).not.toBe(goalKey(S5, "intermediate"));
    expect(goalKey(S5, "novice")).not.toBe(goalKey(VISCOSE, "novice"));
  });

  it("relit ce qui a été écrit, palier par palier", () => {
    const store = createMemoryStore();

    writeGoal(store, S5, "novice", "Gold");
    writeGoal(store, S5, "intermediate", "Diamond");

    expect(readGoal(store, S5, "novice")).toBe("Gold");
    expect(readGoal(store, S5, "intermediate")).toBe("Diamond");
    expect(readGoal(store, S5, "advanced")).toBeNull();
  });

  it("efface l'objectif quand on n'en veut plus", () => {
    const store = createMemoryStore();

    writeGoal(store, S5, "novice", "Gold");
    writeGoal(store, S5, "novice", null);
    expect(readGoal(store, S5, "novice")).toBeNull();
  });

  it("ignore un objectif qui n'est pas un rang du palier", () => {
    const store = createMemoryStore();

    store.setItem(goalKey(S5, "novice"), "Diamond");
    expect(readGoal(store, S5, "novice")).toBeNull();
  });

  it("survit à un stockage qui refuse d'écrire", () => {
    const hostile = {
      getItem: () => {
        throw new Error("bloqué");
      },
      setItem: () => {
        throw new Error("bloqué");
      },
      removeItem: () => {
        throw new Error("bloqué");
      },
    };

    expect(() => writeGoal(hostile, S5, "novice", "Gold")).not.toThrow();
    expect(readGoal(hostile, S5, "novice")).toBeNull();
  });
});
