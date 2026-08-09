import { beforeEach, describe, expect, it } from "vitest";
import { setCoachPrefill, takeCoachPrefill } from "./prefill";

// L'état vit dans le module : chaque test repart d'une boîte vide.
beforeEach(() => {
  takeCoachPrefill();
});

describe("setCoachPrefill / takeCoachPrefill", () => {
  it("rend null quand rien n'a été déposé", () => {
    expect(takeCoachPrefill()).toBeNull();
  });

  it("rend le texte déposé", () => {
    setCoachPrefill("Ascent · Jett · 18/14/5");

    expect(takeCoachPrefill()).toBe("Ascent · Jett · 18/14/5");
  });

  it("consomme le texte : une seule lecture le sert", () => {
    setCoachPrefill("Haven · Omen · 12/16/9");

    expect(takeCoachPrefill()).toBe("Haven · Omen · 12/16/9");
    // Sans cela, le formulaire se re-remplirait à la prochaine visite de la vue.
    expect(takeCoachPrefill()).toBeNull();
  });

  it("ne garde que le dernier dépôt", () => {
    setCoachPrefill("premier match");
    setCoachPrefill("second match");

    expect(takeCoachPrefill()).toBe("second match");
  });

  it("détoure le texte déposé", () => {
    setCoachPrefill("  Split · Raze  \n");

    expect(takeCoachPrefill()).toBe("Split · Raze");
  });

  it("traite un texte vide comme un vidage, pas comme un dépôt de blanc", () => {
    setCoachPrefill("Breeze · Sova");
    setCoachPrefill("   \n  ");

    expect(takeCoachPrefill()).toBeNull();
  });
});
