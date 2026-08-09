import { describe, expect, it } from "vitest";
import { COACH_DAILY_QUOTA } from "../../shared/coach-contract";
import { evaluateQuota } from "./quota";

describe("evaluateQuota", () => {
  it("autorise le premier debrief du jour et annonce ce qui reste", () => {
    expect(evaluateQuota(1)).toEqual({ allowed: true, remaining: COACH_DAILY_QUOTA - 1 });
  });

  it("autorise le dernier debrief du quota, sans reste", () => {
    expect(evaluateQuota(COACH_DAILY_QUOTA)).toEqual({ allowed: true, remaining: 0 });
  });

  it("refuse le debrief suivant", () => {
    expect(evaluateQuota(COACH_DAILY_QUOTA + 1)).toEqual({ allowed: false, remaining: 0 });
  });

  it("ne rouvre jamais le quota, même si le compteur a dépassé (tentatives refusées)", () => {
    expect(evaluateQuota(42).allowed).toBe(false);
    expect(evaluateQuota(42).remaining).toBe(0);
  });

  it("accepte une limite explicite (P4 réutilisera la même règle)", () => {
    expect(evaluateQuota(2, 2)).toEqual({ allowed: true, remaining: 0 });
    expect(evaluateQuota(3, 2)).toEqual({ allowed: false, remaining: 0 });
  });
});
