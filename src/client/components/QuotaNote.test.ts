/**
 * L'arbitrage entre ce qui a été lu au montage et ce que la dernière génération
 * a dit du restant.
 *
 * C'est la seule logique du composant, et c'est celle qui décidait autrefois si
 * l'écran affichait une limite fausse : trois écrans la réécrivaient chacun de
 * leur côté, avec chacun leur constante. Les cas testés sont ceux où les deux
 * sources se contredisent — c'est là qu'une phrase périmée s'affiche.
 */

import { describe, expect, it } from "vitest";
import { aiQuotaLabel } from "../../shared/ai-quota-contract";
import { type LoadedQuota, quotaDisplay } from "./QuotaNote";

const NOW = new Date("2026-08-12T10:00:00.000Z");

const COUNTED: LoadedQuota = {
  status: "counted",
  quota: { kind: "routine", used: 1, limit: 5, resetAt: "2026-08-13T00:00:00.000Z" },
};

describe("quotaDisplay", () => {
  it("garde ce qui a été lu au montage tant qu'aucune génération n'a répondu", () => {
    expect(quotaDisplay(COUNTED, undefined, NOW)).toEqual(COUNTED);
    expect(quotaDisplay({ status: "lifted" }, undefined, NOW)).toEqual({ status: "lifted" });
    expect(quotaDisplay({ status: "unknown" }, undefined, NOW)).toEqual({ status: "unknown" });
  });

  it("retraduit le restant de la dernière réponse en compteur utilisé", () => {
    expect(quotaDisplay(COUNTED, 2, NOW)).toEqual({
      status: "counted",
      quota: { kind: "routine", used: 3, limit: 5, resetAt: "2026-08-13T00:00:00.000Z" },
    });
  });

  it("annonce le quota levé dès qu'une réponse dit n'avoir rien compté", () => {
    expect(quotaDisplay({ status: "unknown" }, null, NOW)).toEqual({ status: "lifted" });
    expect(quotaDisplay(COUNTED, null, NOW)).toEqual({ status: "lifted" });
  });

  it("n'invente pas de dénominateur quand la limite n'a pas pu être lue", () => {
    // `/api/ai-quota` non servi (bun dev) : on connaît le restant, pas la limite.
    expect(quotaDisplay({ status: "unknown" }, 2, NOW)).toEqual({ status: "unknown" });
  });

  it("abandonne un « quota levé » périmé quand une réponse se met à compter", () => {
    expect(quotaDisplay({ status: "lifted" }, 2, NOW)).toEqual({ status: "unknown" });
  });

  it("produit la même phrase que les autres écrans, pour le même état", () => {
    const label = aiQuotaLabel("routine", quotaDisplay(COUNTED, 2, NOW));

    expect(label).toMatch(/^3\/5 aujourd'hui — se réinitialise à \d{2}:\d{2}$/);
  });
});
