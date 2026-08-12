import { describe, expect, it } from "vitest";
import { DEFAULT_BENCHMARK_ID, getTier } from "../../lib/energy";
import type { BenchRunDetail, BenchRunSummary } from "../data";
import { buildSeries, runRankColor } from "./series";

function summary(overrides: Partial<BenchRunSummary> & Pick<BenchRunSummary, "id">) {
  return {
    date: "2026-03-01T13:00:00.000Z",
    tier: "novice",
    benchmarkId: DEFAULT_BENCHMARK_ID,
    overall: 447.36,
    rank: "Gold",
    complete: false,
    source: "manual",
    ...overrides,
  } satisfies BenchRunSummary;
}

function detail(id: number, subcategories: readonly { name: string; energy: number }[]) {
  return {
    ...summary({ id }),
    scores: [],
    subcategories: [...subcategories],
  } satisfies BenchRunDetail;
}

const UTC = "UTC";

describe("runRankColor", () => {
  it("prend la couleur officielle du JSON, jamais une couleur d'UI", () => {
    const gold = getTier("novice").overallRanks.find((rank) => rank.name === "Gold");

    expect(gold).toBeDefined();
    expect(runRankColor(summary({ id: 1, rank: "Gold" }))).toBe(gold?.color);
  });

  it("rend null sans rang atteint", () => {
    expect(runRankColor(summary({ id: 1, rank: null, overall: 0 }))).toBeNull();
  });

  it("rend null si le rang n'appartient pas au palier de la passe", () => {
    expect(runRankColor(summary({ id: 1, tier: "novice", rank: "Celestial" }))).toBeNull();
  });
});

describe("buildSeries", () => {
  it("remet les passes dans l'ordre chronologique (la liste API est décroissante)", () => {
    const runs = [
      summary({ id: 3, date: "2026-03-03T10:00:00.000Z" }),
      summary({ id: 2, date: "2026-03-02T10:00:00.000Z" }),
      summary({ id: 1, date: "2026-03-01T10:00:00.000Z" }),
    ];

    expect(buildSeries(runs, new Map(), null, UTC).map((point) => point.id)).toEqual([1, 2, 3]);
  });

  it("départage deux passes de même date par identifiant croissant", () => {
    const runs = [
      summary({ id: 9, date: "2026-03-01T10:00:00.000Z" }),
      summary({ id: 4, date: "2026-03-01T10:00:00.000Z" }),
    ];

    expect(buildSeries(runs, new Map(), null, UTC).map((point) => point.id)).toEqual([4, 9]);
  });

  it("laisse un trou plutôt que d'écraser la courbe sur un bench incomplet", () => {
    const runs = [summary({ id: 1, overall: 0, rank: null })];

    expect(buildSeries(runs, new Map(), null, UTC)[0]).toMatchObject({
      overall: null,
      rank: null,
      rankColor: null,
    });
  });

  it("tire l'énergie de la sous-catégorie suivie depuis le détail chargé", () => {
    const runs = [summary({ id: 1 }), summary({ id: 2, date: "2026-03-02T10:00:00.000Z" })];
    const details = new Map([[1, detail(1, [{ name: "Dynamic", energy: 412.5 }])]]);
    const points = buildSeries(runs, details, "Dynamic", UTC);

    // Passe 1 : détail chargé. Passe 2 : détail absent → trou, pas un zéro.
    expect(points.map((point) => point.sub)).toEqual([412.5, null]);
  });

  it("ne trace pas une sous-catégorie à 0 (scénarios non joués)", () => {
    const details = new Map([[1, detail(1, [{ name: "Dynamic", energy: 0 }])]]);

    expect(buildSeries([summary({ id: 1 })], details, "Dynamic", UTC)[0]?.sub).toBeNull();
  });

  it("ne lit aucun détail quand aucune sous-catégorie n'est suivie", () => {
    const details = new Map([[1, detail(1, [{ name: "Dynamic", energy: 412.5 }])]]);

    expect(buildSeries([summary({ id: 1 })], details, null, UTC)[0]?.sub).toBeNull();
  });

  it("étiquette l'abscisse avec la date courte de la passe", () => {
    const points = buildSeries([summary({ id: 1 })], new Map(), null, UTC);

    expect(points[0]?.label).toBe("1 mars");
  });
});
