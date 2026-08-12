/**
 * Le registre de benchmarks : ce qu'il propose, ce qu'il cache, et ce qu'il
 * refuse.
 *
 * La preuve du **verrou de relecture** (une passe garde ses seuils d'origine)
 * ne vit pas ici mais dans `src/client/data/benchmark-lock.test.ts`, qui la
 * démontre de bout en bout, de la ligne Postgres à la sous-catégorie affichée.
 * Ce fichier-ci couvre l'inventaire et la validation des frontières.
 */

import { afterEach, describe, expect, it } from "vitest";
import rawViscoseS2 from "../../../viscose-s2-data.json" with { type: "json" };
import {
  type BenchmarkId,
  benchmarkData,
  DEFAULT_BENCHMARK_ID,
  getBenchmark,
  listBenchmarkIds,
  listBenchmarks,
  registerBenchmark,
  toBenchmarkId,
  withBenchmark,
} from "./benchmarks.js";
import { computeBenchRunFor } from "./compute.js";
import { firstTierFor, listTiersFor, tierIdsFor, toTierId } from "./data.js";
import { benchmarkLike } from "./fixtures.js";
import { formulaFor } from "./formulas.js";
import { scenarioMarkerRegex } from "./naming.js";
import { EnergyError } from "./types.js";

const removers: (() => void)[] = [];

function register(id: string, overrides: Parameters<typeof benchmarkLike>[2] = {}): BenchmarkId {
  const benchmarkId = id as BenchmarkId;

  removers.push(registerBenchmark(benchmarkLike(DEFAULT_BENCHMARK_ID, benchmarkId, overrides)));
  return benchmarkId;
}

afterEach(() => {
  while (removers.length > 0) removers.pop()?.();
});

describe("les métadonnées du benchmark de référence", () => {
  it("décrivent Voltaic S5 sans toucher au JSON de seuils", () => {
    const s5 = getBenchmark(DEFAULT_BENCHMARK_ID);

    expect(s5.name).toBe("Voltaic S5");
    expect(s5.publisher).toBe("Voltaic");
    expect(s5.season).toBe("Season 5");
    // Voltaic annonce la S5 en BETA : le registre le dit plutôt que de la
    // présenter comme figée.
    expect(s5.status).toBe("beta");
    expect(s5.aimTrainer).toBe("kovaaks");
    expect(s5.energyFormula).toBe("voltaic-anchors");
  });

  it("reprennent la source et la date d'extraction du fichier de données", () => {
    const s5 = getBenchmark(DEFAULT_BENCHMARK_ID);

    // Deux vérités qui doivent rester la même : les métadonnées produit
    // dérivent du fichier, elles ne le paraphrasent pas.
    const meta = benchmarkData(DEFAULT_BENCHMARK_ID).meta;

    expect(s5.dataVersion).toBe(meta.extractedAt);
    expect(meta.source).toContain(s5.sourceUrl.replace("https://", ""));
  });
});

describe("listBenchmarks", () => {
  it("rend les définitions complètes, pas seulement les identifiants", () => {
    const [first] = listBenchmarks();

    // Le sélecteur affichera un nom et un éditeur : une liste d'identifiants
    // l'obligerait à refaire une lecture par ligne.
    expect(first?.id).toBe(DEFAULT_BENCHMARK_ID);
    expect(first?.name).toBe("Voltaic S5");
  });

  it("cache un benchmark incomplet : l'UI ne doit jamais le proposer", () => {
    const draft = register("voltaic-s6-brouillon", { status: "incomplete", data: null });

    expect(listBenchmarkIds()).not.toContain(draft);
    expect(listBenchmarkIds(true)).toContain(draft);
  });

  it("le garde malgré tout lisible : une passe qui le porte doit se relire", () => {
    const draft = register("voltaic-s6-brouillon", { status: "incomplete", data: null });

    expect(getBenchmark(draft).status).toBe("incomplete");
  });

  it("rend un benchmark stable ou beta sans rien demander", () => {
    const stable = register("viscose-factice", { status: "stable" });

    expect(listBenchmarkIds()).toEqual([DEFAULT_BENCHMARK_ID, stable]);
  });
});

describe("un benchmark sans barème calculable", () => {
  it("refuse `incomplete` avec des seuils, et des seuils absents sans `incomplete`", () => {
    // L'équivalence est l'invariant du registre : `data === null` veut dire
    // « incomplet », et « incomplet » veut dire `data === null`. Sans elle, un
    // barème à moitié rempli passerait pour calculable.
    expect(() =>
      registerBenchmark(
        benchmarkLike(DEFAULT_BENCHMARK_ID, "incoherent-2" as BenchmarkId, {
          status: "incomplete",
        }),
      ),
    ).toThrow(EnergyError);
    expect(() =>
      registerBenchmark(
        benchmarkLike(DEFAULT_BENCHMARK_ID, "incoherent-3" as BenchmarkId, {
          status: "beta",
          data: null,
        }),
      ),
    ).toThrow(/incomplet/);
  });

  it("lève plutôt que de laisser calculer quoi que ce soit", () => {
    const draft = register("voltaic-s6-brouillon", { status: "incomplete", data: null });

    expect(() => listTiersFor(draft)).toThrow(EnergyError);
    expect(() => listTiersFor(draft)).toThrow(/benchmark incomplet/);
    expect(() => withBenchmark(draft, () => 1)).toThrow(/benchmark incomplet/);
    expect(() => computeBenchRunFor(draft, "novice", {})).toThrow(/benchmark incomplet/);
  });
});

describe("Viscose S2", () => {
  // L'entrée existe pour que les seuils vérifiés soient versionnés et relisibles
  // (DECISIONS.md D8) ; elle ne doit toucher aucun écran tant que la formule
  // d'agrégation officielle n'est pas connue.
  const viscose = toBenchmarkId("viscose-s2");

  it("est au registre, et invisible de tout ce que l'UI propose", () => {
    expect(getBenchmark(viscose).name).toBe("Viscose S2");
    expect(getBenchmark(viscose).status).toBe("incomplete");
    expect(listBenchmarkIds()).not.toContain(viscose);
    expect(listBenchmarks().map((benchmark) => benchmark.id)).not.toContain(viscose);
    expect(listBenchmarkIds(true)).toContain(viscose);
  });

  it("n'a ni barème, ni formule, ni import : les trois lèvent", () => {
    expect(getBenchmark(viscose).data).toBeNull();
    expect(getBenchmark(viscose).kovaaks).toBeNull();
    expect(() => listTiersFor(viscose)).toThrow(/benchmark incomplet/);
    expect(() => computeBenchRunFor(viscose, "easier", {})).toThrow(/benchmark incomplet/);
    // La formule d'agrégation Viscose n'est documentée nulle part : la nommer
    // « voltaic-anchors » ferait passer un calcul Voltaic pour un rang Viscose.
    expect(() => formulaFor(viscose)).toThrow(EnergyError);
    // Sa grammaire de nommage est vide faute d'être connue : la police des
    // citations reconnaîtrait n'importe quel mot si on la construisait dessus.
    expect(() => scenarioMarkerRegex(viscose)).toThrow(/benchmark incomplet/);
  });

  it("renvoie au fichier de seuils vérifiés, dont la structure tient", () => {
    expect(getBenchmark(viscose).dataVersion).toBe(rawViscoseS2.meta.extractedAt);
    expect(rawViscoseS2.difficulties.map((difficulty) => difficulty.id)).toEqual([
      "easier",
      "medium",
      "hard",
      "expert",
    ]);
    expect(rawViscoseS2.difficulties.map((difficulty) => difficulty.kovaaksBenchmarkId)).toEqual([
      2335, 2336, 2337, 2338,
    ]);

    for (const difficulty of rawViscoseS2.difficulties) {
      const ids = difficulty.categories.map((category) => category.id);

      // Les doublons de l'API (« Speed »/« Speed  ») sont désambiguïsés : deux
      // catégories homonymes écraseraient l'une l'autre à la première lecture.
      expect(new Set(ids).size).toBe(ids.length);
      for (const rank of difficulty.ranks) {
        expect(rank.name).toBe(rank.name.trim());
      }
      for (const category of difficulty.categories) {
        expect(category.rankMaxes).toHaveLength(difficulty.ranks.length);
        for (const scenario of category.scenarios) {
          // Un seuil par rang, sinon un score se lirait sur le rang du voisin.
          expect(scenario.rankMaxes).toHaveLength(difficulty.ranks.length);
        }
      }
    }
  });
});

describe("les paliers sont qualifiés par le benchmark", () => {
  it("liste les paliers dans l'ordre de progression", () => {
    expect(tierIdsFor(DEFAULT_BENCHMARK_ID)).toEqual(["novice", "intermediate", "advanced"]);
  });

  it("désigne le plus bas comme premier palier", () => {
    expect(firstTierFor(DEFAULT_BENCHMARK_ID)).toBe("novice");
  });

  it("valide une valeur brute contre le benchmark, et rien d'autre", () => {
    expect(toTierId(DEFAULT_BENCHMARK_ID, "advanced")).toBe("advanced");
    expect(() => toTierId(DEFAULT_BENCHMARK_ID, "expert")).toThrow(EnergyError);
    expect(() => toTierId(DEFAULT_BENCHMARK_ID, "expert")).toThrow(/Palier inconnu/);
  });

  it("suit les paliers du benchmark demandé, pas ceux du benchmark courant", () => {
    const solo = register("solo-factice", {
      data: {
        ...benchmarkData(DEFAULT_BENCHMARK_ID),
        tiers: [benchmarkData(DEFAULT_BENCHMARK_ID).tiers.slice(-1)[0]].flatMap((tier) =>
          tier === undefined ? [] : [tier],
        ),
      },
    });

    expect(tierIdsFor(solo)).toEqual(["advanced"]);
    expect(firstTierFor(solo)).toBe("advanced");
    // « novice » existe dans le benchmark par défaut : ce n'est pas une raison
    // pour qu'il existe ici.
    expect(() => toTierId(solo, "novice")).toThrow(EnergyError);
  });
});
