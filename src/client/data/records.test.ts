import { describe, expect, it } from "vitest";
import { bestByScenario } from "./records";

describe("bestByScenario", () => {
  it("garde le meilleur score de chaque scénario", () => {
    const best = bestByScenario([
      { scenario: "VT Pasu Novice", score: 780 },
      { scenario: "VT Pasu Novice", score: 820 },
      { scenario: "VT Pasu Novice", score: 801 },
      { scenario: "VT Popcorn Novice", score: 430 },
    ]);

    expect(best.get("VT Pasu Novice")).toBe(820);
    expect(best.get("VT Popcorn Novice")).toBe(430);
  });

  it("ne rend rien pour un scénario jamais joué", () => {
    expect(bestByScenario([]).get("VT Pasu Novice")).toBeUndefined();
  });

  it("ignore un score illisible plutôt que de l'ériger en record", () => {
    const best = bestByScenario([
      { scenario: "VT Pasu Novice", score: 820 },
      { scenario: "VT Pasu Novice", score: Number.NaN },
      { scenario: "VT Popcorn Novice", score: Number.NaN },
    ]);

    expect(best.get("VT Pasu Novice")).toBe(820);
    expect(best.has("VT Popcorn Novice")).toBe(false);
  });

  it("accepte un record à zéro : c'est un score, pas une absence", () => {
    expect(bestByScenario([{ scenario: "VT Pasu Novice", score: 0 }]).get("VT Pasu Novice")).toBe(
      0,
    );
  });
});
