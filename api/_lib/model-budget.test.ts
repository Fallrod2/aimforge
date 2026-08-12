/**
 * Le budget des appels au modèle : l'arithmétique qui empêche la plateforme de
 * tuer la fonction avant qu'elle ait pu rembourser.
 *
 * Le scénario du dernier test est celui de l'incident qu'on ferme : deux appels
 * lents d'affilée. Avec un délai fixe par appel, leur somme dépassait le
 * `maxDuration` ; avec un budget, elle ne peut pas.
 */

import { describe, expect, it } from "vitest";
import {
  AI_MAX_DURATION_S,
  AI_MODEL_BUDGET_MS,
  AI_MODEL_CALL_CAP_MS,
  AI_MODEL_CALL_FLOOR_MS,
} from "../../src/shared/ai-timing.js";
import { BudgetExhaustedError, startModelBudget } from "./model-budget.js";

/** Une horloge que le test avance à la main. */
function clock(): { now: () => number; advance: (ms: number) => void } {
  let time = 1_000_000;

  return {
    now: () => time,
    advance: (ms) => {
      time += ms;
    },
  };
}

const TOTAL = 48_000;
const CAP = 38_000;
const FLOOR = 8_000;

describe("startModelBudget", () => {
  it("plafonne la première tentative pour laisser sa chance à la relance", () => {
    const budget = startModelBudget(TOTAL, CAP, FLOOR, clock().now);

    expect(budget.nextTimeout()).toBe(CAP);
  });

  it("n'accorde à la relance que ce qui reste vraiment", () => {
    const time = clock();
    const budget = startModelBudget(TOTAL, CAP, FLOOR, time.now);

    budget.nextTimeout();
    time.advance(CAP);
    expect(budget.nextTimeout()).toBe(TOTAL - CAP);
  });

  it("renonce plutôt que de lancer un appel qui n'a aucune chance", () => {
    const time = clock();
    const budget = startModelBudget(TOTAL, CAP, FLOOR, time.now);

    time.advance(TOTAL - FLOOR + 1);
    expect(() => budget.nextTimeout()).toThrow(BudgetExhaustedError);
  });

  it("garde deux appels lents sous le `maxDuration` de la plateforme", () => {
    const time = clock();
    const budget = startModelBudget(TOTAL, CAP, FLOOR, time.now);
    let spent = 0;

    // Deux tentatives, chacune allant jusqu'au bout de ce qu'on lui accorde.
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const timeout = budget.nextTimeout();

      spent += timeout;
      time.advance(timeout);
    }

    expect(spent).toBeLessThanOrEqual(TOTAL);
    expect(spent).toBeLessThan(AI_MAX_DURATION_S * 1_000);
  });

  it("est câblé sur les constantes partagées, pas sur des nombres recopiés", () => {
    expect([TOTAL, CAP, FLOOR]).toEqual([
      AI_MODEL_BUDGET_MS,
      AI_MODEL_CALL_CAP_MS,
      AI_MODEL_CALL_FLOOR_MS,
    ]);
  });
});
