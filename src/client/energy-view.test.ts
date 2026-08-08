import { describe, expect, it } from "vitest";
import { getTier } from "../lib/energy";
import { nextRank, nextTarget, railFraction, rankColorFor, rankTicks } from "./energy-view";

const NOVICE = getTier("novice");

describe("rankColorFor", () => {
  it("rend exactement la couleur du JSON Voltaic", () => {
    for (const rank of NOVICE.overallRanks) {
      expect(rankColorFor("novice", rank.minEnergy), rank.name).toBe(rank.color);
    }
  });

  it("rend null sous le premier rang du palier", () => {
    expect(rankColorFor("novice", 99.99)).toBeNull();
    expect(rankColorFor("novice", 0)).toBeNull();
  });
});

describe("railFraction", () => {
  it("place l'énergie sur l'échelle 0 → maxEnergy du palier", () => {
    expect(railFraction("novice", 250)).toBeCloseTo(0.5, 10);
    expect(railFraction("advanced", 650)).toBeCloseTo(0.5, 10);
  });

  it("borne la jauge à [0, 1] même au-delà du plafond", () => {
    expect(railFraction("novice", 10_000)).toBe(1);
    expect(railFraction("novice", 0)).toBe(0);
  });
});

describe("rankTicks", () => {
  it("pose les 4 rangs du palier avec leur couleur officielle", () => {
    const ticks = rankTicks("novice", 0);

    expect(ticks.map((tick) => tick.name)).toEqual(["Iron", "Bronze", "Silver", "Gold"]);
    expect(ticks.map((tick) => tick.color)).toEqual(NOVICE.overallRanks.map((rank) => rank.color));
  });

  it("marque comme franchis les rangs atteints, seuil inclus", () => {
    expect(rankTicks("novice", 300).map((tick) => tick.reached)).toEqual([true, true, true, false]);
  });
});

describe("nextTarget", () => {
  it("désigne la première ancre encore au-dessus du score", () => {
    // VT Pasu Novice : ancre « Gold » à 800, « Gold II » à 818.
    expect(nextTarget("novice", "VT Pasu Novice", 807)).toEqual({
      label: "Gold II",
      threshold: 818,
      missing: 11,
    });
  });

  it("vise la première ancre quand le score est encore très bas", () => {
    expect(nextTarget("novice", "VT Pasu Novice", 0)?.label).toBe("Plastic I");
  });

  it("rend null au-delà de la dernière ancre (énergie plafonnée)", () => {
    const last = NOVICE.anchorLabels.length - 1;
    const threshold = getTier("novice")
      .categories.flatMap((category) => category.subcategories)
      .flatMap((sub) => sub.scenarios)
      .find((scenario) => scenario.name === "VT Pasu Novice")?.thresholds[last];

    expect(threshold).toBeDefined();
    expect(nextTarget("novice", "VT Pasu Novice", Number(threshold))).toBeNull();
  });
});

describe("nextRank", () => {
  it("indique l'énergie manquante pour le rang suivant", () => {
    // 350 en Novice : Silver (300) est acquis, Gold (400) est à 50 d'énergie.
    expect(nextRank("novice", 350)).toEqual({ rank: NOVICE.overallRanks[3], missing: 50 });
  });

  it("rend null quand l'overall dépasse déjà le dernier rang du palier", () => {
    expect(nextRank("novice", 447.36)).toBeNull();
  });

  it("vise le premier rang quand aucun n'est atteint", () => {
    expect(nextRank("novice", 0)?.rank.name).toBe("Iron");
  });

  it("rend null une fois le dernier rang du palier atteint", () => {
    expect(nextRank("novice", 500)).toBeNull();
  });
});
