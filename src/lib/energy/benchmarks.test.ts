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
import {
  type BenchmarkId,
  DEFAULT_BENCHMARK_ID,
  getBenchmark,
  listBenchmarkIds,
  listBenchmarks,
  registerBenchmark,
} from "./benchmarks.js";
import { firstTierFor, tierIdsFor, toTierId } from "./data.js";
import { benchmarkLike } from "./fixtures.js";
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
    expect(s5.dataVersion).toBe(s5.data.meta.extractedAt);
    expect(s5.data.meta.source).toContain(s5.sourceUrl.replace("https://", ""));
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
    const draft = register("voltaic-s6-brouillon", { status: "incomplete" });

    expect(listBenchmarkIds()).not.toContain(draft);
    expect(listBenchmarkIds(true)).toContain(draft);
  });

  it("le garde malgré tout lisible : une passe qui le porte doit se relire", () => {
    const draft = register("voltaic-s6-brouillon", { status: "incomplete" });

    expect(getBenchmark(draft).status).toBe("incomplete");
  });

  it("rend un benchmark stable ou beta sans rien demander", () => {
    const stable = register("viscose-factice", { status: "stable" });

    expect(listBenchmarkIds()).toEqual([DEFAULT_BENCHMARK_ID, stable]);
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
        ...getBenchmark(DEFAULT_BENCHMARK_ID).data,
        tiers: [getBenchmark(DEFAULT_BENCHMARK_ID).data.tiers.slice(-1)[0]].flatMap((tier) =>
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
