import { describe, expect, it } from "vitest";
import {
  type ImportUsageKind,
  KOVAAKS_IMPORT_DAILY_LIMIT,
  RIOT_LINK_DAILY_LIMIT,
} from "../../client/data/linked-accounts-contract";
import {
  consumeDailyLimit,
  type DailyLimit,
  kovaaksImportLimit,
  riotLinkLimit,
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

    await consumeDailyLimit(usage.increment, riotLinkLimit());
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

  it("porte les limites du contrat partagé quand rien n'est réglé en base", () => {
    expect(kovaaksImportLimit().limit).toBe(KOVAAKS_IMPORT_DAILY_LIMIT);
    expect(riotLinkLimit().limit).toBe(RIOT_LINK_DAILY_LIMIT);
    expect(kovaaksImportLimit().reached).toContain(String(KOVAAKS_IMPORT_DAILY_LIMIT));
    expect(riotLinkLimit().reached).toContain(String(RIOT_LINK_DAILY_LIMIT));
  });

  it("annonce la limite réellement en vigueur, pas celle du code (SPEC §5 quater)", () => {
    // Le piège que ce test ferme : un message figé à la compilation
    // contredirait l'administration dès qu'elle descend la limite.
    const tightened = kovaaksImportLimit(3);

    expect(tightened.limit).toBe(3);
    expect(tightened.reached).toContain("3 imports");
    expect(tightened.reached).not.toContain(String(KOVAAKS_IMPORT_DAILY_LIMIT));
    expect(riotLinkLimit(0).reached).toContain("0 liaisons");
  });
});
