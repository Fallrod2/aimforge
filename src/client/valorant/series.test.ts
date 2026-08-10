import { describe, expect, it } from "vitest";
import type { TrendPoint } from "../data";
import { buildTrendSeries, hasValues, metricSeries } from "./series";

const UTC = "UTC";

function point(overrides: Partial<TrendPoint> = {}): TrendPoint {
  return {
    matchId: "m1",
    playedAt: "2026-08-01T10:00:00.000Z",
    map: "Ascent",
    agent: "Jett",
    headshotPercent: 24,
    adr: 150,
    result: "victoire",
    rr: null,
    ...overrides,
  };
}

describe("buildTrendSeries", () => {
  it("conserve l'ordre du serveur et numérote les parties à partir de 1", () => {
    const series = buildTrendSeries(
      [
        point({ matchId: "a", playedAt: "2026-07-01T10:00:00.000Z" }),
        point({ matchId: "b", playedAt: "2026-07-05T10:00:00.000Z" }),
        point({ matchId: "c", playedAt: "2026-07-09T10:00:00.000Z" }),
      ],
      UTC,
    );

    expect(series.map((entry) => entry.matchId)).toEqual(["a", "b", "c"]);
    expect(series.map((entry) => entry.order)).toEqual([1, 2, 3]);
  });

  it("étiquette chaque point par sa date courte", () => {
    const [first] = buildTrendSeries([point({ playedAt: "2026-03-01T13:00:00.000Z" })], UTC);

    expect(first?.label).toBe("1 mars");
  });

  it("dit « — » plutôt qu'une date inventée quand la partie n'est pas datée", () => {
    const [first] = buildTrendSeries([point({ playedAt: null })], UTC);

    expect(first?.label).toBe("—");
    expect(first?.playedAt).toBeNull();
  });

  it("traite une date illisible comme une date absente", () => {
    const [first] = buildTrendSeries([point({ playedAt: "hier soir" })], UTC);

    expect(first?.label).toBe("—");
  });

  it("recopie map, agent et résultat sans les interpréter", () => {
    const [first] = buildTrendSeries([point({ map: null, agent: "Sova", result: "egalite" })], UTC);

    expect(first?.map).toBeNull();
    expect(first?.agent).toBe("Sova");
    expect(first?.result).toBe("egalite");
  });

  it("rend une série vide pour une tendance vide", () => {
    expect(buildTrendSeries([], UTC)).toEqual([]);
  });
});

describe("metricSeries", () => {
  const series = buildTrendSeries(
    [
      point({ matchId: "gagne", result: "victoire", headshotPercent: 30, adr: 180 }),
      point({ matchId: "perdu", result: "defaite", headshotPercent: 15, adr: 90 }),
      point({ matchId: "nul", result: "egalite", headshotPercent: 20, adr: 120 }),
      point({ matchId: "inconnu", result: null, headshotPercent: 22, adr: 130 }),
      point({ matchId: "sans-hs", result: "victoire", headshotPercent: null, adr: 140 }),
    ],
    UTC,
  );

  it("porte la valeur de la mesure demandée", () => {
    expect(metricSeries(series, "headshotPercent").map((entry) => entry.value)).toEqual([
      30,
      15,
      20,
      22,
      null,
    ]);
    expect(metricSeries(series, "adr").map((entry) => entry.value)).toEqual([
      180, 90, 120, 130, 140,
    ]);
  });

  it("range chaque valeur dans la seule colonne de son résultat", () => {
    const [gagne, perdu, nul, inconnu] = metricSeries(series, "headshotPercent");

    expect([gagne?.win, gagne?.loss, gagne?.other]).toEqual([30, null, null]);
    expect([perdu?.win, perdu?.loss, perdu?.other]).toEqual([null, 15, null]);
    expect([nul?.win, nul?.loss, nul?.other]).toEqual([null, null, 20]);
    expect([inconnu?.win, inconnu?.loss, inconnu?.other]).toEqual([null, null, 22]);
  });

  /**
   * Le piège à éviter : une victoire sans HS% connu poserait un marqueur de
   * victoire à 0 % — une chute qui n'a pas eu lieu.
   */
  it("ne pose aucun marqueur quand la valeur est absente, même si le résultat est connu", () => {
    const sansHs = metricSeries(series, "headshotPercent").at(-1);

    expect(sansHs?.result).toBe("victoire");
    expect([sansHs?.value, sansHs?.win, sansHs?.loss, sansHs?.other]).toEqual([
      null,
      null,
      null,
      null,
    ]);
  });

  it("place exactement une valeur par point tracé", () => {
    for (const entry of metricSeries(series, "adr")) {
      const marked = [entry.win, entry.loss, entry.other].filter((value) => value !== null);

      expect(marked, entry.matchId).toHaveLength(entry.value === null ? 0 : 1);
      if (entry.value !== null) expect(marked[0]).toBe(entry.value);
    }
  });

  it("garde les métadonnées du point pour l'infobulle", () => {
    const [first] = metricSeries(series, "adr");

    expect(first?.map).toBe("Ascent");
    expect(first?.agent).toBe("Jett");
    expect(first?.label).toBe("1 août");
  });
});

describe("hasValues", () => {
  it("dit non quand aucune partie ne porte la mesure", () => {
    const series = buildTrendSeries([point({ headshotPercent: null, adr: 100 })], UTC);

    expect(hasValues(series, "headshotPercent")).toBe(false);
    expect(hasValues(series, "adr")).toBe(true);
  });

  it("dit non sur une série vide", () => {
    expect(hasValues([], "adr")).toBe(false);
  });

  it("dit oui dès qu'une seule partie porte la mesure", () => {
    const series = buildTrendSeries(
      [point({ headshotPercent: null }), point({ headshotPercent: 0 })],
      UTC,
    );

    expect(hasValues(series, "headshotPercent")).toBe(true);
  });
});
