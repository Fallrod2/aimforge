import { describe, expect, it } from "vitest";
import { type BenchmarkId, toBenchmarkId } from "../lib/energy";
import { type ComparableRun, deltaOf, previousRun, subcategoryDeltas } from "./run-delta";

const S5 = toBenchmarkId("voltaic-s5");
const OTHER = toBenchmarkId("viscose-s2");

function run(
  id: number,
  date: string,
  tier = "novice",
  benchmarkId: BenchmarkId = S5,
): ComparableRun {
  return { id, date, tier, benchmarkId, overall: id * 10 };
}

describe("previousRun", () => {
  const current = run(4, "2026-03-10T12:00:00.000Z");

  it("ne rend rien quand c'est la première passe", () => {
    expect(previousRun([current], current)).toBeNull();
    expect(previousRun([], current)).toBeNull();
  });

  it("rend la passe immédiatement antérieure du même palier", () => {
    const older = run(1, "2026-03-01T12:00:00.000Z");
    const previous = run(2, "2026-03-08T12:00:00.000Z");

    expect(previousRun([current, previous, older], current)).toBe(previous);
  });

  it("ignore les passes d'un autre palier", () => {
    const otherTier = run(3, "2026-03-09T12:00:00.000Z", "intermediate");
    const same = run(2, "2026-03-08T12:00:00.000Z");

    expect(previousRun([current, otherTier, same], current)).toBe(same);
  });

  it("ignore les passes d'un autre benchmark : les seuils ne sont pas comparables", () => {
    const otherBenchmark = run(3, "2026-03-09T12:00:00.000Z", "novice", OTHER);
    const same = run(2, "2026-03-08T12:00:00.000Z");

    expect(previousRun([current, otherBenchmark, same], current)).toBe(same);
  });

  it("ignore les passes postérieures", () => {
    const newer = run(9, "2026-03-20T12:00:00.000Z");

    expect(previousRun([newer, current], current)).toBeNull();
  });

  it("départage deux passes du même horodatage par l'identifiant", () => {
    const sameDate = run(3, "2026-03-10T12:00:00.000Z");
    const alsoSameDate = run(5, "2026-03-10T12:00:00.000Z");

    // 5 est postérieure (enregistrée après), 3 est bien la précédente.
    expect(previousRun([alsoSameDate, current, sameDate], current)).toBe(sameDate);
  });

  it("ne se laisse pas piéger par une liste non triée", () => {
    const previous = run(2, "2026-03-08T12:00:00.000Z");

    expect(previousRun([run(1, "2026-01-01T12:00:00.000Z"), current, previous], current)).toBe(
      previous,
    );
  });

  it("ignore une date illisible plutôt que de la prendre pour l'origine des temps", () => {
    const broken = { ...run(2, "pas une date") };

    expect(previousRun([current, broken], current)).toBeNull();
  });
});

describe("deltaOf", () => {
  it("chiffre et oriente une progression", () => {
    expect(deltaOf(447.36, 435)).toEqual({ value: 447.36 - 435, direction: "up" });
  });

  it("chiffre et oriente une régression", () => {
    const delta = deltaOf(431.07, 434.17);

    expect(delta.direction).toBe("down");
    expect(delta.value).toBeCloseTo(-3.1, 10);
  });

  it("rend « stable » un écart qui s'afficherait à zéro", () => {
    expect(deltaOf(447.36, 447.36).direction).toBe("flat");
    expect(deltaOf(447.361, 447.36).direction).toBe("flat");
  });
});

describe("subcategoryDeltas", () => {
  const current = [
    { name: "Dynamic", energy: 420 },
    { name: "Static", energy: 300 },
    { name: "Precise", energy: 0 },
  ];

  it("apparie les sous-catégories par leur nom, pas par leur position", () => {
    const previous = [
      { name: "Static", energy: 290 },
      { name: "Dynamic", energy: 430 },
      { name: "Precise", energy: 100 },
    ];
    const deltas = subcategoryDeltas(current, previous);

    expect(deltas.map((entry) => entry.name)).toEqual(["Dynamic", "Static", "Precise"]);
    expect(deltas[0]?.delta?.value).toBeCloseTo(-10, 10);
    expect(deltas[1]?.delta?.value).toBeCloseTo(10, 10);
  });

  it("ne compare pas une sous-catégorie non jouée : ni avant, ni maintenant", () => {
    const deltas = subcategoryDeltas(current, [
      { name: "Dynamic", energy: 0 },
      { name: "Static", energy: 290 },
      { name: "Precise", energy: 100 },
    ]);

    // Dynamic n'existait pas dans la passe précédente : « +420 » serait faux.
    expect(deltas[0]?.delta).toBeNull();
    // Precise n'est pas jouée cette fois-ci : rien à comparer non plus.
    expect(deltas[2]?.delta).toBeNull();
  });

  it("ne compare rien quand la sous-catégorie est absente de la passe précédente", () => {
    expect(subcategoryDeltas(current, [])[0]?.delta).toBeNull();
  });
});
