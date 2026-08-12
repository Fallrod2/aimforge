/**
 * **La démo ne dépend d'aucun benchmark ambiant.**
 *
 * Le pointeur de benchmark de la lib (`syncCurrentBenchmark`, appelé par
 * `adoptBenchmark`) est un état de module, et **rien ne le remet à sa valeur par
 * défaut à la déconnexion** : une session qui a adopté un autre benchmark le
 * laisse en place pour la page suivante. Tant que la synthèse ne se rendait que
 * sous `ActiveBenchmarkProvider`, la cohérence était acquise par construction.
 * Depuis V4-B, la landing et `#/demo` la rendent **hors du provider** — et une
 * fonction non qualifiée y résoudrait le benchmark de la session d'avant :
 * chiffres faux dans le meilleur cas, exception dans le pire (le palier de la
 * démo peut ne pas exister dans l'autre benchmark).
 *
 * Ce fichier le prouve plutôt que de le promettre. Deux benchmarks factices,
 * choisis pour être **détectables** :
 *
 * - `FAKE_HARSH` garde les paliers de la S5 mais double les seuils de rang et
 *   `maxEnergy`. Sous lui, l'overall de la démo (685,22) ne vaut plus aucun
 *   rang : une synthèse qui lirait l'ambiant afficherait « Sans rang » et un
 *   écart au rang suivant complètement différent ;
 * - `FAKE_NOVICE_ONLY` n'a **que** le palier Novice. Sous lui, tout accès non
 *   qualifié au palier de la démo lève — donc la page ne se rendrait pas du
 *   tout.
 *
 * Les seuils factices sont **dérivés** de la S5, jamais inventés : la règle du
 * projet (le JSON est la seule source de seuils) vaut aussi dans les tests.
 */

import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it } from "vitest";
import { type BenchmarkData, type BenchmarkId, DEFAULT_BENCHMARK_ID } from "../../lib/energy";
import { benchmarkData, registerBenchmark } from "../../lib/energy/benchmarks";
import { benchmarkLike } from "../../lib/energy/fixtures";
import { adoptBenchmark } from "../app/active-benchmark";
import { formatEnergy } from "../format";
import { LandingView } from "../landing/LandingView";
import { DemoView } from "./DemoView";
import { demoBench, demoNextRank } from "./demo-data";

const FAKE_HARSH = "voltaic-factice-severe" as BenchmarkId;
const FAKE_NOVICE_ONLY = "voltaic-factice-novice-seul" as BenchmarkId;

/** Facteur appliqué aux seuils de rang : assez grand pour qu'aucun doute ne subsiste. */
const HARSHER = 2;

/** La S5 dont les rangs overall et le plafond sont deux fois plus exigeants. */
function harshData(data: BenchmarkData): BenchmarkData {
  return {
    ...data,
    tiers: data.tiers.map((tier) => ({
      ...tier,
      maxEnergy: tier.maxEnergy * HARSHER,
      overallRanks: tier.overallRanks.map((rank) => ({
        ...rank,
        minEnergy: rank.minEnergy * HARSHER,
      })),
    })),
  };
}

/** La S5 amputée de tous ses paliers sauf le premier. */
function noviceOnly(data: BenchmarkData): BenchmarkData {
  return { ...data, tiers: data.tiers.filter((tier) => tier.id === "novice") };
}

const source = benchmarkData(DEFAULT_BENCHMARK_ID);
const removers = [
  registerBenchmark(benchmarkLike(DEFAULT_BENCHMARK_ID, FAKE_HARSH, { data: harshData(source) })),
  registerBenchmark(
    benchmarkLike(DEFAULT_BENCHMARK_ID, FAKE_NOVICE_ONLY, { data: noviceOnly(source) }),
  ),
];

afterEach(() => {
  // Le benchmark courant est un état de module : le laisser basculé
  // contaminerait les tests suivants.
  adoptBenchmark(DEFAULT_BENCHMARK_ID);
});

/** Le texte visible du rendu : les assertions parlent de ce qu'on lit. */
function textOf(markup: string): string {
  return markup
    .replace(/<[^>]+>/g, " ")
    .replace(/&#x27;/g, "'")
    .replace(/&#x2F;/g, "/")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();
}

/** Ce que les deux pages doivent afficher, quel que soit le benchmark ambiant. */
const bench = demoBench();
const upcoming = demoNextRank(bench.run);

const PAGES: readonly (readonly [string, () => string])[] = [
  ["la démonstration", () => textOf(renderToStaticMarkup(<DemoView />))],
  ["la landing", () => textOf(renderToStaticMarkup(<LandingView />))],
];

describe("le benchmark factice diffère bien du benchmark de la démo", () => {
  it("priverait la passe de démonstration de son rang", () => {
    const ranks = benchmarkData(FAKE_HARSH).tiers.find((tier) => tier.id === "intermediate");
    const lowest = ranks?.overallRanks[0]?.minEnergy ?? 0;

    expect(lowest).toBeGreaterThan(bench.run.overall);
    expect(bench.run.rank).not.toBeNull();
  });

  it("ne connaît même pas le palier de la démonstration, dans sa seconde forme", () => {
    expect(benchmarkData(FAKE_NOVICE_ONLY).tiers.map((tier) => tier.id)).toEqual(["novice"]);
  });
});

for (const [name, render] of PAGES) {
  describe(`${name} sous un benchmark ambiant hostile`, () => {
    it("garde l'overall, le rang et l'écart au rang suivant de la démo", () => {
      adoptBenchmark(FAKE_HARSH);

      const text = render();

      expect(text).toContain(formatEnergy(bench.run.overall));
      expect(text).toContain(bench.run.rank ?? "");
      expect(upcoming).not.toBeNull();
      expect(text).toContain(formatEnergy(upcoming?.missing ?? 0));
      expect(text).toContain(upcoming?.name ?? "");
      // Le symptôme qu'aurait produit une résolution ambiante : sous
      // `FAKE_HARSH`, 685,22 ne vaut aucun rang.
      expect(text).not.toContain("Sans rang");
    });

    it("garde les maillons faibles et leurs énergies", () => {
      adoptBenchmark(FAKE_HARSH);

      const text = render();

      for (const sub of [...bench.run.subcategories]
        .sort((a, b) => a.energy - b.energy)
        .slice(0, 3)) {
        expect(text, sub.name).toContain(sub.name);
        expect(text, sub.name).toContain(formatEnergy(sub.energy));
      }
    });

    it("se rend encore quand le benchmark ambiant ignore le palier de la démo", () => {
      adoptBenchmark(FAKE_NOVICE_ONLY);

      expect(() => render()).not.toThrow();
      expect(render()).toContain(formatEnergy(bench.run.overall));
    });

    it("rend exactement la même chose que sous le benchmark par défaut", () => {
      const reference = render();

      adoptBenchmark(FAKE_HARSH);
      expect(render()).toBe(reference);
      adoptBenchmark(FAKE_NOVICE_ONLY);
      expect(render()).toBe(reference);
    });
  });
}

describe("le registre reste propre", () => {
  it("rend les benchmarks factices au démontage du fichier", () => {
    expect(removers).toHaveLength(2);
    for (const remove of removers) expect(typeof remove).toBe("function");
  });
});
