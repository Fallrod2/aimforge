/**
 * **La preuve du branchement de formule** (DECISIONS.md D4).
 *
 * Il n'existe aujourd'hui qu'une formule réelle (`voltaic-anchors`), donc rien
 * dans le comportement courant ne dirait si `compute.ts` la résolvait depuis la
 * définition du benchmark ou l'appelait en dur : les deux rendraient les mêmes
 * chiffres. Le seul moyen honnête de le vérifier est d'enregistrer une seconde
 * formule, volontairement absurde, et de constater que le calcul la suit.
 *
 * La formule factice ne calcule rien de plausible — elle rend des constantes.
 * C'est le but : aucune erreur d'arrondi, aucune coïncidence de seuils ne peut
 * produire ces valeurs-là.
 */

import { afterEach, describe, expect, it } from "vitest";
import { type BenchmarkId, DEFAULT_BENCHMARK_ID, registerBenchmark } from "./benchmarks.js";
import { computeBenchRunFor, computeSubcategoriesFor, findRankFor } from "./compute.js";
import { SUBCATEGORY_COUNT } from "./energy.js";
import { benchmarkLike, scoresAtAnchor } from "./fixtures.js";
import {
  type EnergyFormula,
  formulaFor,
  getEnergyFormula,
  registerEnergyFormula,
} from "./formulas.js";
import { EnergyError, type ScoreMap } from "./types.js";

const FLAT_ID = "test-plate";
const FLAT_ENERGY = 42;
const FLAT_OVERALL = 7;
const FLAT_RANK = { name: "Plat", minEnergy: 0, color: "#000000" };

/** Une formule qui ignore les seuils : impossible à confondre avec Voltaic. */
const flat: EnergyFormula = {
  id: FLAT_ID,
  scenarioEnergy: () => FLAT_ENERGY,
  subcategoryEnergy: () => FLAT_ENERGY,
  overallEnergy: () => FLAT_OVERALL,
  findRank: () => FLAT_RANK,
  rankFor: () => FLAT_RANK.name,
  isComplete: () => true,
};

const FAKE = "benchmark-a-formule-plate" as BenchmarkId;

const removers: (() => void)[] = [];
let goldScores: ScoreMap;

afterEach(() => {
  while (removers.length > 0) removers.pop()?.();
});

function registerFlatBenchmark(): void {
  goldScores = scoresAtAnchor("novice", "Gold");
  removers.push(registerEnergyFormula(flat));
  removers.push(
    registerBenchmark(benchmarkLike(DEFAULT_BENCHMARK_ID, FAKE, { energyFormula: FLAT_ID })),
  );
}

describe("le registre de formules", () => {
  it("connaît la formule Voltaic et la sert au benchmark de référence", () => {
    expect(formulaFor(DEFAULT_BENCHMARK_ID).id).toBe("voltaic-anchors");
    expect(getEnergyFormula("voltaic-anchors")).toBe(formulaFor(DEFAULT_BENCHMARK_ID));
  });

  it("refuse une formule inconnue plutôt que de retomber sur Voltaic", () => {
    // Le repli silencieux est exactement le défaut qu'on interdit ailleurs :
    // il calculerait des énergies fausses sans le dire.
    expect(() => getEnergyFormula("formule-qui-n-existe-pas")).toThrow(EnergyError);
  });

  it("refuse d'écraser une formule déjà enregistrée", () => {
    removers.push(registerEnergyFormula(flat));
    expect(() => registerEnergyFormula(flat)).toThrow(EnergyError);
  });
});

describe("compute.ts résout la formule depuis la définition du benchmark", () => {
  it("calcule les sous-catégories avec la formule du benchmark, pas avec Voltaic", () => {
    registerFlatBenchmark();

    const voltaic = computeSubcategoriesFor(DEFAULT_BENCHMARK_ID, "novice", goldScores);
    const plate = computeSubcategoriesFor(FAKE, "novice", goldScores);

    expect(voltaic.every((sub) => sub.energy === 400)).toBe(true);
    expect(plate).toHaveLength(SUBCATEGORY_COUNT);
    expect(plate.every((sub) => sub.energy === FLAT_ENERGY)).toBe(true);
  });

  it("calcule énergies, overall, rang et complétude d'une passe avec elle", () => {
    registerFlatBenchmark();

    const run = computeBenchRunFor(FAKE, "novice", goldScores);

    expect(run.scores).toHaveLength(18);
    expect(run.scores.every((score) => score.energy === FLAT_ENERGY)).toBe(true);
    expect(run.overall).toBe(FLAT_OVERALL);
    expect(run.rank).toBe(FLAT_RANK.name);
    expect(run.complete).toBe(true);
  });

  it("rend le rang de la formule du benchmark, couleur comprise", () => {
    registerFlatBenchmark();

    expect(findRankFor(FAKE, "novice", 400)).toEqual(FLAT_RANK);
    expect(findRankFor(DEFAULT_BENCHMARK_ID, "novice", 400)?.name).toBe("Gold");
  });

  it("rétablit la formule précédente en sortant de la portée", () => {
    registerFlatBenchmark();
    computeBenchRunFor(FAKE, "novice", goldScores);

    // Le benchmark courant n'a pas bougé : la résolution est locale à l'appel.
    expect(computeBenchRunFor(DEFAULT_BENCHMARK_ID, "novice", goldScores).overall).toBe(400);
  });

  it("refuse de calculer si la formule du benchmark n'est pas enregistrée", () => {
    const orphan = "benchmark-sans-formule" as BenchmarkId;

    removers.push(
      registerBenchmark(
        benchmarkLike(DEFAULT_BENCHMARK_ID, orphan, { energyFormula: "formule-absente" }),
      ),
    );

    expect(() => computeBenchRunFor(orphan, "novice", {})).toThrow(EnergyError);
  });
});
