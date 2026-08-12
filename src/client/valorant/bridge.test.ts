import { describe, expect, it } from "vitest";
import { type BenchmarkId, DEFAULT_BENCHMARK_ID } from "../../lib/energy";
import type { BenchRunSummary, TrendPoint } from "../data";
import { buildBridge } from "./bridge";

const OTHER_BENCHMARK = "s4" as BenchmarkId;

function run(overrides: Partial<BenchRunSummary> = {}): BenchRunSummary {
  return {
    id: 1,
    date: "2026-07-01T10:00:00.000Z",
    tier: "novice",
    overall: 400,
    rank: null,
    complete: true,
    source: "manual",
    benchmarkId: DEFAULT_BENCHMARK_ID,
    ...overrides,
  };
}

function match(overrides: Partial<TrendPoint> = {}): TrendPoint {
  return {
    matchId: "m1",
    playedAt: "2026-07-02T10:00:00.000Z",
    map: null,
    agent: null,
    headshotPercent: 25,
    adr: null,
    result: null,
    rr: null,
    ...overrides,
  };
}

const RUNS: readonly BenchRunSummary[] = [
  run({ id: 1, date: "2026-07-01T10:00:00.000Z", overall: 400 }),
  run({ id: 2, date: "2026-07-10T10:00:00.000Z", overall: 430 }),
  run({ id: 3, date: "2026-07-20T10:00:00.000Z", overall: 455 }),
];

const MATCHES: readonly TrendPoint[] = [
  match({ matchId: "a", playedAt: "2026-07-05T10:00:00.000Z", headshotPercent: 20 }),
  match({ matchId: "b", playedAt: "2026-07-15T10:00:00.000Z", headshotPercent: 24 }),
];

describe("buildBridge", () => {
  it("rend les deux séries et un axe du temps commun", () => {
    const bridge = buildBridge(RUNS, MATCHES, DEFAULT_BENCHMARK_ID);

    expect(bridge).not.toBeNull();
    expect(bridge?.bench.map((point) => point.value)).toEqual([400, 430, 455]);
    expect(bridge?.ingame.map((point) => point.value)).toEqual([20, 24]);
    expect(bridge?.from).toBe(Date.parse("2026-07-01T10:00:00.000Z"));
    expect(bridge?.to).toBe(Date.parse("2026-07-20T10:00:00.000Z"));
  });

  /**
   * Le cœur du parti pris : aucune valeur n'est retouchée. Ni indice base 100,
   * ni mise à l'échelle — seul l'axe du temps est mis en commun.
   */
  it("ne normalise aucune valeur : les énergies et les HS% sortent tels quels", () => {
    const bridge = buildBridge(RUNS, MATCHES, DEFAULT_BENCHMARK_ID);

    expect(bridge?.bench.map((point) => point.value)).toEqual(RUNS.map((entry) => entry.overall));
    expect(bridge?.ingame.map((point) => point.value)).toEqual([20, 24]);
  });

  it("trie les deux séries du plus ancien au plus récent", () => {
    const bridge = buildBridge(
      [RUNS[2] as BenchRunSummary, RUNS[0] as BenchRunSummary, RUNS[1] as BenchRunSummary],
      [MATCHES[1] as TrendPoint, MATCHES[0] as TrendPoint],
      DEFAULT_BENCHMARK_ID,
    );

    expect(bridge?.bench.map((point) => point.key)).toEqual(["1", "2", "3"]);
    expect(bridge?.ingame.map((point) => point.key)).toEqual(["a", "b"]);
  });

  it("ne retient que le palier de la passe la plus récente", () => {
    const bridge = buildBridge(
      [
        run({ id: 1, date: "2026-07-01T10:00:00.000Z", tier: "novice", overall: 400 }),
        run({ id: 2, date: "2026-07-10T10:00:00.000Z", tier: "intermediate", overall: 300 }),
        run({ id: 3, date: "2026-07-20T10:00:00.000Z", tier: "intermediate", overall: 340 }),
      ],
      MATCHES,
      DEFAULT_BENCHMARK_ID,
    );

    expect(bridge?.tier).toBe("intermediate");
    expect(bridge?.bench.map((point) => point.value)).toEqual([300, 340]);
  });

  it("écarte les passes d'un autre benchmark", () => {
    const bridge = buildBridge(
      [
        run({
          id: 1,
          date: "2026-06-01T10:00:00.000Z",
          benchmarkId: OTHER_BENCHMARK,
          overall: 999,
        }),
        ...RUNS,
      ],
      MATCHES,
      DEFAULT_BENCHMARK_ID,
    );

    expect(bridge?.bench.map((point) => point.value)).toEqual([400, 430, 455]);
  });

  /** Un bench incomplet a un overall de 0 : le tracer écraserait la courbe. */
  it("écarte les passes incomplètes (overall à zéro)", () => {
    const bridge = buildBridge(
      [...RUNS, run({ id: 4, date: "2026-07-25T10:00:00.000Z", overall: 0, complete: false })],
      MATCHES,
      DEFAULT_BENCHMARK_ID,
    );

    expect(bridge?.bench).toHaveLength(3);
    expect(bridge?.to).toBe(Date.parse("2026-07-20T10:00:00.000Z"));
  });

  it("écarte les parties non datées et celles sans HS% connu", () => {
    const bridge = buildBridge(
      RUNS,
      [
        ...MATCHES,
        match({ matchId: "sans-date", playedAt: null }),
        match({ matchId: "sans-hs", playedAt: "2026-07-18T10:00:00.000Z", headshotPercent: null }),
      ],
      DEFAULT_BENCHMARK_ID,
    );

    expect(bridge?.ingame.map((point) => point.key)).toEqual(["a", "b"]);
  });

  it("compte les jours où les deux séries se recouvrent vraiment", () => {
    // Bench du 1er au 20 juillet, parties du 5 au 15 : dix jours en regard.
    expect(buildBridge(RUNS, MATCHES, DEFAULT_BENCHMARK_ID)?.overlapDays).toBe(10);
  });

  it("annonce zéro jour de recouvrement quand les séries ne se croisent pas", () => {
    const bridge = buildBridge(
      RUNS,
      [
        match({ matchId: "a", playedAt: "2026-08-01T10:00:00.000Z" }),
        match({ matchId: "b", playedAt: "2026-08-04T10:00:00.000Z" }),
      ],
      DEFAULT_BENCHMARK_ID,
    );

    expect(bridge?.overlapDays).toBe(0);
    // L'axe commun couvre quand même les deux séries : elles sont côte à côte.
    expect(bridge?.to).toBe(Date.parse("2026-08-04T10:00:00.000Z"));
  });

  describe("rien à montrer", () => {
    it("rend null sans aucune passe du benchmark", () => {
      expect(buildBridge([], MATCHES, DEFAULT_BENCHMARK_ID)).toBeNull();
      expect(
        buildBridge([run({ benchmarkId: OTHER_BENCHMARK })], MATCHES, DEFAULT_BENCHMARK_ID),
      ).toBeNull();
    });

    it("rend null avec une seule passe : un point n'est pas une tendance", () => {
      expect(buildBridge([RUNS[0] as BenchRunSummary], MATCHES, DEFAULT_BENCHMARK_ID)).toBeNull();
    });

    it("rend null avec moins de deux parties exploitables", () => {
      expect(buildBridge(RUNS, [], DEFAULT_BENCHMARK_ID)).toBeNull();
      expect(buildBridge(RUNS, [MATCHES[0] as TrendPoint], DEFAULT_BENCHMARK_ID)).toBeNull();
    });

    it("rend null quand le palier le plus récent n'a qu'une passe", () => {
      const bridge = buildBridge(
        [
          run({ id: 1, date: "2026-07-01T10:00:00.000Z", tier: "novice" }),
          run({ id: 2, date: "2026-07-10T10:00:00.000Z", tier: "novice" }),
          run({ id: 3, date: "2026-07-20T10:00:00.000Z", tier: "advanced" }),
        ],
        MATCHES,
        DEFAULT_BENCHMARK_ID,
      );

      expect(bridge).toBeNull();
    });
  });
});
