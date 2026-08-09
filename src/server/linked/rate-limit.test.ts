import { describe, expect, it } from "vitest";
import {
  type ImportUsageKind,
  KOVAAKS_IMPORT_DAILY_LIMIT,
  RIOT_LINK_DAILY_LIMIT,
} from "../../client/data/linked-accounts-contract";
import {
  consumeDailyLimit,
  type DailyLimit,
  KOVAAKS_IMPORT_LIMIT,
  RIOT_LINK_LIMIT,
} from "./rate-limit";

/** Un compteur en mémoire : ce que la base ferait, sans la base. */
function counter(start = 0) {
  let count = start;
  const kinds: ImportUsageKind[] = [];

  return {
    kinds,
    increment: async (kind: ImportUsageKind) => {
      kinds.push(kind);
      count += 1;
      return count;
    },
  };
}

const TINY: DailyLimit = { kind: "kovaaks_import", limit: 2, reached: "stop" };

describe("consumeDailyLimit", () => {
  it("laisse passer le premier appel du jour et annonce ce qui reste", async () => {
    const { increment } = counter();

    expect(await consumeDailyLimit(increment, TINY)).toEqual({ ok: true, remaining: 1 });
  });

  it("laisse passer le dernier appel du quota, sans reste", async () => {
    const { increment } = counter(1);

    expect(await consumeDailyLimit(increment, TINY)).toEqual({ ok: true, remaining: 0 });
  });

  it("refuse l'appel suivant en 429, avec le message du frein", async () => {
    const { increment } = counter(2);

    expect(await consumeDailyLimit(increment, TINY)).toEqual({
      ok: false,
      status: 429,
      message: "stop",
    });
  });

  it("ne rouvre jamais la porte, même si le compteur a dépassé", async () => {
    const { increment } = counter(99);
    const verdict = await consumeDailyLimit(increment, TINY);

    expect(verdict.ok).toBe(false);
  });

  it("incrémente avant de décider : un refus consomme quand même une unité", async () => {
    const usage = counter(2);

    await consumeDailyLimit(usage.increment, TINY);
    expect(usage.kinds).toEqual(["kovaaks_import"]);
  });

  it("compte sur le bon kind", async () => {
    const usage = counter();

    await consumeDailyLimit(usage.increment, RIOT_LINK_LIMIT);
    expect(usage.kinds).toEqual(["riot_link"]);
  });

  it("referme en 503 quand le compteur est injoignable", async () => {
    const verdict = await consumeDailyLimit(async () => {
      throw new Error("réseau");
    }, TINY);

    expect(verdict).toEqual({
      ok: false,
      status: 503,
      message: "Le compteur d'imports est indisponible. Réessaie dans un instant.",
    });
  });

  it.each([null, undefined, "3", 1.5, -1, Number.NaN])(
    "referme en 503 sur un compteur hors forme (%s)",
    async (raw) => {
      const verdict = await consumeDailyLimit(async () => raw, TINY);

      expect(verdict).toEqual({ ok: false, status: 503, message: expect.any(String) });
      expect(verdict.ok).toBe(false);
    },
  );

  it("porte les limites du contrat partagé", () => {
    expect(KOVAAKS_IMPORT_LIMIT.limit).toBe(KOVAAKS_IMPORT_DAILY_LIMIT);
    expect(RIOT_LINK_LIMIT.limit).toBe(RIOT_LINK_DAILY_LIMIT);
    expect(KOVAAKS_IMPORT_LIMIT.reached).toContain(String(KOVAAKS_IMPORT_DAILY_LIMIT));
    expect(RIOT_LINK_LIMIT.reached).toContain(String(RIOT_LINK_DAILY_LIMIT));
  });
});
