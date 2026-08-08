import { describe, expect, it } from "vitest";
import { latestRun, type SubcategoryEnergy, weakestSubcategories } from "./summary";

const RUNS = [
  { id: 1, date: "2026-07-20T18:30:00.000Z" },
  { id: 2, date: "2026-08-01T09:00:00.000Z" },
  { id: 3, date: "2026-07-31T23:59:00.000Z" },
];

describe("latestRun", () => {
  it("rend null sur une liste vide", () => {
    expect(latestRun([])).toBeNull();
  });

  it("prend la passe la plus récente, quel que soit l'ordre de la liste", () => {
    expect(latestRun(RUNS)?.id).toBe(2);
    expect(latestRun([...RUNS].reverse())?.id).toBe(2);
  });

  it("départage deux passes de même date par l'identifiant le plus grand", () => {
    const sameDate = [
      { id: 4, date: "2026-08-01T09:00:00.000Z" },
      { id: 9, date: "2026-08-01T09:00:00.000Z" },
    ];

    expect(latestRun(sameDate)?.id).toBe(9);
    expect(latestRun([...sameDate].reverse())?.id).toBe(9);
  });

  it("ignore une date illisible plutôt que de la faire gagner", () => {
    expect(latestRun([{ id: 1, date: "pas une date" }, ...RUNS])?.id).toBe(2);
    expect(latestRun([{ id: 1, date: "pas une date" }])).toBeNull();
  });
});

describe("weakestSubcategories", () => {
  const subcategories: readonly SubcategoryEnergy[] = [
    { name: "Dynamic Clicking", energy: 412.5 },
    { name: "Precise Tracking", energy: 180.1 },
    { name: "Static Clicking", energy: 500 },
    { name: "Reactive Tracking", energy: 180.1 },
    { name: "Speed Switching", energy: 0 },
  ];

  it("rend les trois plus basses, de la plus basse à la moins basse", () => {
    expect(weakestSubcategories(subcategories).map((sub) => sub.name)).toEqual([
      "Speed Switching",
      "Precise Tracking",
      "Reactive Tracking",
    ]);
  });

  it("garde les sous-catégories non jouées : elles pèsent dans l'overall", () => {
    expect(weakestSubcategories(subcategories)[0]).toEqual({ name: "Speed Switching", energy: 0 });
  });

  it("ne modifie pas la liste reçue", () => {
    const input = [...subcategories];

    weakestSubcategories(input);
    expect(input).toEqual(subcategories);
  });

  it("rend moins de trois entrées quand il y en a moins", () => {
    expect(weakestSubcategories(subcategories.slice(0, 2))).toHaveLength(2);
    expect(weakestSubcategories([])).toEqual([]);
  });

  it("respecte un nombre demandé explicitement", () => {
    expect(weakestSubcategories(subcategories, 1).map((sub) => sub.name)).toEqual([
      "Speed Switching",
    ]);
    expect(weakestSubcategories(subcategories, 0)).toEqual([]);
  });
});
