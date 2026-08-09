import { describe, expect, it } from "vitest";
import { attemptTimeout, type Clock, startBudget } from "./budget";

/** Une horloge qu'on avance à la main : aucun test n'attend réellement. */
function fakeClock(): Clock & { advance: (ms: number) => void } {
  let time = 1_000;
  const clock = (() => time) as Clock & { advance: (ms: number) => void };

  clock.advance = (ms: number) => {
    time += ms;
  };
  return clock;
}

describe("startBudget", () => {
  it("part du total demandé", () => {
    const clock = fakeClock();

    expect(startBudget(14_000, clock).remaining()).toBe(14_000);
  });

  it("décroît au fil du temps", () => {
    const clock = fakeClock();
    const budget = startBudget(14_000, clock);

    clock.advance(5_000);
    expect(budget.remaining()).toBe(9_000);
    clock.advance(4_000);
    expect(budget.remaining()).toBe(5_000);
  });

  it("ne descend jamais sous zéro", () => {
    const clock = fakeClock();
    const budget = startBudget(14_000, clock);

    clock.advance(20_000);
    expect(budget.remaining()).toBe(0);
  });

  it("est partagé : deux appelants lisent le même reste", () => {
    const clock = fakeClock();
    const budget = startBudget(10_000, clock);
    const premier = budget.remaining();

    clock.advance(3_000);
    // Ce que « consomme » le premier appel, le second ne l'a plus.
    expect(premier - budget.remaining()).toBe(3_000);
  });
});

describe("attemptTimeout", () => {
  const CAP = 5_000;
  const FLOOR = 1_000;

  it("plafonne une tentative quand le budget est large", () => {
    expect(attemptTimeout(14_000, CAP, FLOOR)).toBe(5_000);
  });

  it("réduit la tentative à ce qui reste", () => {
    expect(attemptTimeout(4_000, CAP, FLOOR)).toBe(4_000);
  });

  it("renonce quand il ne reste pas de quoi aboutir", () => {
    expect(attemptTimeout(800, CAP, FLOOR)).toBeNull();
    expect(attemptTimeout(0, CAP, FLOOR)).toBeNull();
  });

  it("accepte exactement le plancher", () => {
    expect(attemptTimeout(1_000, CAP, FLOOR)).toBe(1_000);
  });
});

describe("le pire cas tient dans le budget", () => {
  /**
   * Le test qui donne son sens au module : on rejoue la séquence complète d'un
   * import (deux appels, une relance chacun) en supposant que **chaque
   * tentative expire**, et on vérifie qu'on renonce de nous-mêmes avant la fin
   * du budget — donc avant que la plateforme ne tue la fonction.
   */
  it("deux appels à deux tentatives ne dépassent pas le total", () => {
    const TOTAL = 14_000;
    const CAP = 5_000;
    const FLOOR = 1_000;
    const clock = fakeClock();
    const budget = startBudget(TOTAL, clock);
    let attempts = 0;

    // Deux appels, deux tentatives chacun : la boucle s'arrête d'elle-même si
    // le budget est épuisé avant.
    for (let call = 0; call < 2; call++) {
      for (let attempt = 0; attempt < 2; attempt++) {
        const timeout = attemptTimeout(budget.remaining(), CAP, FLOOR);

        if (timeout === null) break;
        attempts += 1;
        // Le pire cas : la tentative consomme tout son délai puis échoue.
        clock.advance(timeout);
      }
    }

    expect(budget.remaining()).toBe(0);
    // 5 000 + 5 000 + 4 000 : la quatrième tentative n'a plus sa place.
    expect(attempts).toBe(3);
  });
});
