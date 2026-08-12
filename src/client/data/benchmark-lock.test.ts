/**
 * **La preuve du verrou multi-benchmarks** (SPEC §5 quinquies, DECISIONS.md D4).
 *
 * Tout le chantier tient à une promesse : *une passe enregistrée sous Voltaic S5
 * gardera ses valeurs S5 pour toujours, quel que soit le benchmark courant*.
 * Cette promesse ne se démontre pas avec un seul benchmark — il en faut un
 * second qui donne des résultats **visiblement différents** sur les mêmes
 * scores. C'est ce que fait ce fichier, et c'est sa seule raison d'être.
 *
 * Le benchmark utilisé ici est **factice** et vit dans ce fichier de test : il
 * n'est jamais versionné comme donnée réelle, jamais déposé dans le registre en
 * dehors du test, et ses seuils sont **dérivés** de la S5 (× 10) plutôt
 * qu'inventés — la règle du projet reste que `voltaic-s5-data.json` est la seule
 * source de seuils.
 *
 * Multiplier les seuils par dix donne un écart qu'aucune erreur d'arrondi ne
 * peut produire : les mêmes 18 scores valent « Gold, 400 d'énergie » en S5 et
 * moins de 20 d'énergie sans aucun rang sous le benchmark factice.
 */

import { afterEach, beforeAll, describe, expect, it } from "vitest";
import {
  type BenchmarkData,
  type BenchmarkId,
  computeBenchRunFor,
  DEFAULT_BENCHMARK_ID,
  EnergyError,
  listBenchmarkIds,
  type ScoreMap,
} from "../../lib/energy";
import {
  activeBenchmark,
  benchmarkData,
  registerBenchmark,
  setCurrentBenchmark,
  withBenchmark,
} from "../../lib/energy/benchmarks";
import { anchorEnergy, benchmarkLike, scoresAtAnchor } from "../../lib/energy/fixtures";
import { type BenchRunStore, saveBenchRunTo } from "./bench-runs";
import { type BenchRunRow, type ScenarioScoreRow, toBenchRunDetail } from "./mapping";

const FAKE_S6 = "voltaic-s6-factice" as BenchmarkId;

/** Facteur appliqué aux seuils : assez grand pour qu'aucun doute ne subsiste. */
const HARDER = 10;

/**
 * Le jeu de données factice : celui de la S5 dont **tous les seuils de
 * scénarios** sont dix fois plus exigeants. Les ancres d'énergie, les rangs et
 * les noms ne bougent pas — on ne veut faire varier qu'une chose, sinon la
 * démonstration ne dirait plus laquelle compte.
 */
function harderData(data: BenchmarkData): BenchmarkData {
  return {
    ...data,
    tiers: data.tiers.map((tier) => ({
      ...tier,
      categories: tier.categories.map((category) => ({
        ...category,
        subcategories: category.subcategories.map((subcategory) => ({
          ...subcategory,
          scenarios: subcategory.scenarios.map((scenario) => ({
            ...scenario,
            thresholds: scenario.thresholds.map((threshold) => threshold * HARDER),
          })),
        })),
      })),
    })),
  };
}

/** Les 18 scores d'une passe Novice pile sur l'ancre « Gold » de la **S5**. */
let goldScores: ScoreMap;
/** L'énergie de cette ancre en S5 : la valeur que la passe doit garder. */
let goldEnergy: number;

const restorers: (() => void)[] = [];

/** Rend `benchmarkId` courant pour la durée du test en cours. */
function makeCurrent(benchmarkId: BenchmarkId): void {
  restorers.push(setCurrentBenchmark(benchmarkId));
}

beforeAll(() => {
  // Capturé **avant** toute bascule : ces scores sont ceux du tableur S5, et
  // c'est bien eux qu'on relira sous un autre benchmark courant.
  goldScores = scoresAtAnchor("novice", "Gold");
  goldEnergy = anchorEnergy("novice", "Gold");

  const remove = registerBenchmark(
    benchmarkLike(DEFAULT_BENCHMARK_ID, FAKE_S6, {
      data: harderData(benchmarkData(DEFAULT_BENCHMARK_ID)),
      kovaaks: {
        benchmarkIds: { novice: 1, intermediate: 2, advanced: 3 },
        scenarioSuffix: " S6",
      },
    }),
  );

  return () => {
    remove();
  };
});

afterEach(() => {
  // Le benchmark courant est un état de module : le laisser basculé
  // contaminerait les tests suivants, ce que ce fichier est mal placé pour se
  // permettre.
  while (restorers.length > 0) restorers.pop()?.();
});

/** Une ligne `bench_runs` : la colonne du benchmark est `benchmark_id` (0017). */
function benchRow(benchmarkId: string): BenchRunRow {
  return {
    id: 12,
    date: "2026-03-01T12:00:00+00:00",
    tier: "novice",
    overall: goldEnergy,
    rank: "Gold",
    complete: true,
    source: "manual",
    benchmark_id: benchmarkId,
  };
}

function scoreRows(scores: ScoreMap): ScenarioScoreRow[] {
  return Object.entries(scores).map(([scenario, score]) => ({ scenario, score, energy: 0 }));
}

describe("le benchmark factice diffère bien du courant", () => {
  it("rend les mêmes scores nettement moins énergétiques", () => {
    const s5 = computeBenchRunFor(DEFAULT_BENCHMARK_ID, "novice", goldScores);
    const s6 = computeBenchRunFor(FAKE_S6, "novice", goldScores);

    expect(s5.overall).toBe(goldEnergy);
    expect(s5.rank).toBe("Gold");
    expect(s6.overall).toBeLessThan(20);
    expect(s6.rank).toBeNull();
  });
});

describe("(a) une passe S5 relue sous un autre benchmark courant", () => {
  it("garde ses 9 sous-catégories S5, au chiffre près", () => {
    makeCurrent(FAKE_S6);

    const detail = toBenchRunDetail(benchRow(DEFAULT_BENCHMARK_ID), scoreRows(goldScores));

    expect(detail.benchmarkId).toBe(DEFAULT_BENCHMARK_ID);
    expect(detail.subcategories).toHaveLength(9);
    // 400 d'énergie sur les neuf, exactement — la valeur de l'ancre « Gold »
    // du palier Novice en S5.
    expect(goldEnergy).toBe(400);
    for (const subcategory of detail.subcategories) {
      expect(subcategory.energy, subcategory.name).toBe(400);
    }
  });

  it("garde son overall et son rang S5 quand on les recalcule", () => {
    makeCurrent(FAKE_S6);

    const detail = toBenchRunDetail(benchRow(DEFAULT_BENCHMARK_ID), scoreRows(goldScores));
    const recomputed = computeBenchRunFor(detail.benchmarkId, detail.tier, goldScores);

    expect(recomputed.overall).toBe(400);
    expect(recomputed.rank).toBe("Gold");
    expect(recomputed.complete).toBe(true);
  });

  it("suit la colonne, pas le benchmark courant : la même ligne notée S6 change de valeurs", () => {
    makeCurrent(FAKE_S6);

    const asS5 = toBenchRunDetail(benchRow(DEFAULT_BENCHMARK_ID), scoreRows(goldScores));
    const asS6 = toBenchRunDetail(benchRow(FAKE_S6), scoreRows(goldScores));

    expect(asS5.subcategories.every((sub) => sub.energy === 400)).toBe(true);
    expect(asS6.subcategories.every((sub) => sub.energy < 20)).toBe(true);
  });

  it("ordonne les scénarios avec le tableur du benchmark de la passe", () => {
    makeCurrent(FAKE_S6);

    const detail = toBenchRunDetail(benchRow(DEFAULT_BENCHMARK_ID), scoreRows(goldScores));

    expect(detail.scores).toHaveLength(18);
    expect(detail.scores[0]?.scenario).toBe("VT Pasu Novice");
  });
});

describe("(b) une nouvelle passe s'estampille le benchmark courant", () => {
  it("écrit le benchmark factice quand il est courant, avec ses énergies", async () => {
    makeCurrent(FAKE_S6);

    const written: { benchmarkId: string; overall: number }[] = [];
    const store: BenchRunStore = {
      async insertRun(run) {
        written.push({ benchmarkId: run.benchmarkId, overall: run.overall });
        return { ...benchRow(run.benchmarkId), overall: run.overall, rank: run.rank };
      },
      async insertScores() {},
      async deleteRun() {},
    };

    await saveBenchRunTo(store, { tier: "novice", scores: goldScores });

    expect(written).toHaveLength(1);
    expect(written[0]?.benchmarkId).toBe(FAKE_S6);
    // La passe est écrite avec les seuils du benchmark qu'elle estampille :
    // l'étiquette et le calcul ne peuvent pas se contredire.
    expect(written[0]?.overall).toBeLessThan(20);
  });

  it("écrit le benchmark publié le reste du temps", async () => {
    const written: string[] = [];
    const store: BenchRunStore = {
      async insertRun(run) {
        written.push(run.benchmarkId);
        return benchRow(run.benchmarkId);
      },
      async insertScores() {},
      async deleteRun() {},
    };

    await saveBenchRunTo(store, { tier: "novice", scores: goldScores });

    expect(written).toEqual([DEFAULT_BENCHMARK_ID]);
  });

  it("calcule dans le benchmark que l'appelant nomme, pas dans le courant", async () => {
    // Le courant reste la S5 : c'est le cas qui piège. Nommer un benchmark et
    // calculer dans un autre écrirait des énergies S5 sous l'étiquette S6 —
    // fausses, et indétectables puisque la ligne aurait l'air cohérente.
    const written: { benchmarkId: string; overall: number }[] = [];
    const store: BenchRunStore = {
      async insertRun(run) {
        written.push({ benchmarkId: run.benchmarkId, overall: run.overall });
        return { ...benchRow(run.benchmarkId), overall: run.overall, rank: run.rank };
      },
      async insertScores() {},
      async deleteRun() {},
    };

    await saveBenchRunTo(store, {
      tier: "novice",
      scores: goldScores,
      benchmarkId: FAKE_S6,
    });

    expect(written[0]?.benchmarkId).toBe(FAKE_S6);
    expect(written[0]?.overall).toBeLessThan(20);
  });
});

describe("(c) un benchmark inconnu ne se rabat jamais sur le courant", () => {
  it("refuse la ligne à la lecture", () => {
    expect(() => toBenchRunDetail(benchRow("voltaic-s99"), scoreRows(goldScores))).toThrow(
      EnergyError,
    );
    expect(() => toBenchRunDetail(benchRow("voltaic-s99"), scoreRows(goldScores))).toThrow(
      /Benchmark inconnu/,
    );
  });

  it("refuse aussi un calcul explicitement qualifié", () => {
    expect(() => computeBenchRunFor("voltaic-s99" as BenchmarkId, "novice", goldScores)).toThrow(
      EnergyError,
    );
  });

  it("refuse un benchmark retiré du registre après coup", () => {
    const ghost = "voltaic-s7-factice" as BenchmarkId;
    const remove = registerBenchmark(benchmarkLike(DEFAULT_BENCHMARK_ID, ghost));

    expect(() => computeBenchRunFor(ghost, "novice", goldScores)).not.toThrow();
    remove();
    expect(() => computeBenchRunFor(ghost, "novice", goldScores)).toThrow(EnergyError);
  });
});

describe("la portée de résolution est étanche", () => {
  it("rétablit le benchmark précédent, y compris imbriqué", () => {
    expect(
      withBenchmark(FAKE_S6, () => withBenchmark(DEFAULT_BENCHMARK_ID, () => activeBenchmark())),
    ).toBe(DEFAULT_BENCHMARK_ID);
    expect(withBenchmark(FAKE_S6, () => activeBenchmark())).toBe(FAKE_S6);
    expect(activeBenchmark()).toBe(DEFAULT_BENCHMARK_ID);
  });

  it("rétablit le benchmark précédent même si le calcul lève", () => {
    expect(() =>
      withBenchmark(FAKE_S6, () => {
        throw new Error("boum");
      }),
    ).toThrow("boum");
    expect(activeBenchmark()).toBe(DEFAULT_BENCHMARK_ID);
  });

  it("refuse un calcul asynchrone, dont la portée ne survivrait pas à un await", () => {
    expect(() => withBenchmark(FAKE_S6, () => Promise.resolve(1))).toThrow(EnergyError);
    expect(activeBenchmark()).toBe(DEFAULT_BENCHMARK_ID);
  });
});

describe("le registre reste propre", () => {
  it("ne connaît que le benchmark publié et le factice du fichier", () => {
    expect(listBenchmarkIds()).toEqual([DEFAULT_BENCHMARK_ID, FAKE_S6]);
  });
});
