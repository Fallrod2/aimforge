/**
 * La grammaire de nommage vient de la définition du benchmark.
 *
 * Le test qui compte n'est pas « Voltaic se comporte comme avant » (les tests
 * de `format`, `scenarios` et `kovaaks/benchmark` le disent déjà) : c'est
 * « **un autre benchmark change la grammaire sans qu'on touche au code** ».
 * D'où le benchmark factice avec un marqueur, un préfixe et un suffixe
 * différents, et sans libellé de palier dans ses noms.
 */

import { afterEach, describe, expect, it } from "vitest";
import { type BenchmarkId, DEFAULT_BENCHMARK_ID, registerBenchmark } from "./benchmarks.js";
import { benchmarkLike } from "./fixtures.js";
import { normalizedScenarioKey, scenarioDisplayName, scenarioMarkerRegex } from "./naming.js";

const OTHER = "grammaire-factice" as BenchmarkId;

const removers: (() => void)[] = [];

function registerOther(): void {
  removers.push(
    registerBenchmark(
      benchmarkLike(DEFAULT_BENCHMARK_ID, OTHER, {
        // Un marqueur qui contient un métacaractère de regex : s'il n'était pas
        // échappé, `V.T` filerait sur « VaT » et la police laisserait passer.
        naming: { scenarioMarker: "V.T", displayPrefix: "V.T", tierLabelSuffix: false },
        kovaaks: { benchmarkIds: { novice: 1 }, scenarioSuffix: " (2026)" },
      }),
    ),
  );
}

afterEach(() => {
  while (removers.length > 0) removers.pop()?.();
});

describe("scenarioMarkerRegex", () => {
  it("repère le marqueur du benchmark, quelle que soit la casse", () => {
    const found = [
      ..."VT Pasu Novice puis vt Popcorn".matchAll(scenarioMarkerRegex(DEFAULT_BENCHMARK_ID)),
    ];

    expect(found).toHaveLength(2);
  });

  it("échappe le marqueur : il est de la donnée, pas un fragment de regex", () => {
    registerOther();

    const regex = scenarioMarkerRegex(OTHER);

    expect("V.T Cible".match(regex)).not.toBeNull();
    expect("VaT Cible".match(regex)).toBeNull();
  });
});

describe("scenarioDisplayName", () => {
  it("retire le préfixe et le libellé du palier (grammaire Voltaic)", () => {
    expect(scenarioDisplayName(DEFAULT_BENCHMARK_ID, "VT Pasu Novice", "Novice")).toBe("Pasu");
  });

  it("laisse intact un nom qui ne suit pas la grammaire", () => {
    expect(scenarioDisplayName(DEFAULT_BENCHMARK_ID, "Tile Frenzy", "Novice")).toBe("Tile Frenzy");
  });

  it("ne retire pas le palier d'un benchmark qui ne l'inscrit pas dans ses noms", () => {
    registerOther();

    // `tierLabelSuffix: false` : « Novice » ici ferait partie du nom, pas du
    // palier — le retirer serait une amputation.
    expect(scenarioDisplayName(OTHER, "V.T Pasu Novice", "Novice")).toBe("Pasu Novice");
  });
});

describe("normalizedScenarioKey", () => {
  it("retire le marqueur d'import exact du benchmark", () => {
    expect(normalizedScenarioKey(DEFAULT_BENCHMARK_ID, "VT Pasu Novice S5")).toBe(
      normalizedScenarioKey(DEFAULT_BENCHMARK_ID, "VT  pasu   novice "),
    );
  });

  it("ne retire pas un suffixe qui ressemble à un marqueur sans en être un", () => {
    registerOther();

    // L'ancien motif générique (`\ss\d+$`) aurait amputé ce nom ; le suffixe
    // déclaré par ce benchmark est « (2026) », donc « S5 » fait partie du nom.
    expect(normalizedScenarioKey(OTHER, "V.T Cible S5")).toBe("v.t cible s5");
    expect(normalizedScenarioKey(OTHER, "V.T Cible (2026)")).toBe("v.t cible");
  });
});
