/**
 * Le squelette d'attente : ce qu'il dit, et surtout ce qu'il ne prétend pas.
 *
 * La règle qui porte tout le module est testée en premier : la dernière étape
 * **reste active** tant que la réponse n'est pas là. Une barre qui se remplit
 * jusqu'au bout puis attend est un mensonge — et c'est le mensonge le plus
 * courant des écrans de chargement.
 */

import { describe, expect, it } from "vitest";
import {
  ELAPSED_AFTER_MS,
  elapsedLabel,
  progressSteps,
  ROUTINE_EXPECTATION,
  ROUTINE_STEPS,
  THREAD_STEPS,
} from "./progress";

/** Les libellés, avec leur état : plus lisible qu'un tableau d'objets. */
function states(elapsedMs: number, steps = ROUTINE_STEPS): string[] {
  return progressSteps(steps, elapsedMs).map((step) => step.state);
}

describe("progressSteps", () => {
  it("ouvre sur la première étape, les suivantes en attente", () => {
    expect(states(0)).toEqual(["active", "pending", "pending"]);
  });

  it("avance à l'étape suivante une fois son heure venue", () => {
    const second = ROUTINE_STEPS[1]?.from ?? 0;

    expect(states(second - 1)).toEqual(["active", "pending", "pending"]);
    expect(states(second)).toEqual(["done", "active", "pending"]);
  });

  it("laisse la dernière étape active indéfiniment : rien ne dit qu'elle est finie", () => {
    const last = ROUTINE_STEPS.at(-1)?.from ?? 0;

    expect(states(last)).toEqual(["done", "done", "active"]);
    // Dix fois le temps prévu : toujours active, jamais « done ».
    expect(states(last * 10)).toEqual(["done", "done", "active"]);
  });

  it("rend toutes les étapes, dans l'ordre où elles sont déclarées", () => {
    expect(progressSteps(ROUTINE_STEPS, 0).map((step) => step.label)).toEqual(
      ROUTINE_STEPS.map((step) => step.label),
    );
  });

  it("traite un temps négatif comme le départ, plutôt que de ne rien activer", () => {
    // Une horloge qui recule (mise à l'heure du système) ne doit pas vider
    // l'écran de ses étapes.
    expect(states(-5_000)).toEqual(["active", "pending", "pending"]);
  });

  it("vaut aussi pour le fil, plus court parce que l'attente y est plus courte", () => {
    expect(THREAD_STEPS.length).toBeLessThan(ROUTINE_STEPS.length);
    expect(states(0, THREAD_STEPS)).toEqual(["active", "pending"]);
  });

  it("déclare des étapes croissantes et une première à zéro", () => {
    for (const steps of [ROUTINE_STEPS, THREAD_STEPS]) {
      expect(steps[0]?.from).toBe(0);
      for (let index = 1; index < steps.length; index += 1) {
        expect(steps[index]?.from).toBeGreaterThan(steps[index - 1]?.from ?? 0);
      }
    }
  });
});

describe("elapsedLabel", () => {
  it("se tait tant que l'attente est normale", () => {
    expect(elapsedLabel(0, ROUTINE_EXPECTATION)).toBeNull();
    expect(elapsedLabel(ELAPSED_AFTER_MS - 1, ROUTINE_EXPECTATION)).toBeNull();
  });

  it("annonce le temps écoulé et l'ordre de grandeur attendu", () => {
    expect(elapsedLabel(ELAPSED_AFTER_MS, ROUTINE_EXPECTATION)).toBe(
      `8 s écoulées · ${ROUTINE_EXPECTATION}`,
    );
  });

  it("arrondit vers le bas : on n'annonce pas une seconde qui n'est pas passée", () => {
    expect(elapsedLabel(12_900, ROUTINE_EXPECTATION)).toBe(
      `12 s écoulées · ${ROUTINE_EXPECTATION}`,
    );
  });
});
