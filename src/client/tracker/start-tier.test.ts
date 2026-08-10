import { describe, expect, it } from "vitest";
import { startTier, type TieredRun } from "./start-tier";

/** L'ordre de `listBenchRuns` : du plus récent au plus ancien. */
function history(...tiers: readonly TieredRun["tier"][]): readonly TieredRun[] {
  return tiers.map((tier) => ({ tier }));
}

describe("startTier", () => {
  it("ouvre sur Novice sans historique", () => {
    expect(startTier([])).toBe("novice");
  });

  it("ouvre sur le palier du dernier bench", () => {
    expect(startTier(history("intermediate"))).toBe("intermediate");
  });

  it("suit le dernier bench, pas le plus fréquent", () => {
    // Dix passes Novice puis un premier Intermediate : c'est le palier qu'on
    // joue maintenant, même s'il n'a qu'une passe.
    expect(startTier(history("intermediate", ...Array(10).fill("novice")))).toBe("intermediate");
  });

  it("redescend si la dernière passe est redescendue", () => {
    expect(startTier(history("novice", "advanced"))).toBe("novice");
  });

  it("gère les trois paliers", () => {
    expect(startTier(history("advanced"))).toBe("advanced");
    expect(startTier(history("novice"))).toBe("novice");
  });
});
