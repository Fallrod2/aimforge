import { beforeEach, describe, expect, it } from "vitest";
import type { TierId } from "../../lib/energy";
import {
  type AutoPullContext,
  type AutoPulls,
  awaitsAutoPull,
  forgetAutoPulls,
  hasAutoPulled,
  NO_AUTO_PULLS,
  rememberAutoPull,
  sessionAutoPulls,
  shouldAutoPull,
  withAutoPull,
} from "./auto-import";
import { IDLE, importFailed, importSucceeded, LOADING } from "./import";

/** Le cas nominal : compte lié, palier connu, rien de tenté, rien en vol. */
function context(overrides: Partial<AutoPullContext> = {}): AutoPullContext {
  return {
    tier: "novice",
    hasAccount: true,
    ready: true,
    pulls: NO_AUTO_PULLS,
    state: IDLE,
    ...overrides,
  };
}

function done(scenario = "VT Pasu Novice") {
  return importSucceeded({ username: "Victard", scores: { [scenario]: 683.5 }, missing: [] });
}

describe("shouldAutoPull", () => {
  it("part tout seul à l'ouverture quand un compte est lié", () => {
    expect(shouldAutoPull(context())).toBe(true);
  });

  it("ne fait rien sans compte KovaaK's lié", () => {
    expect(shouldAutoPull(context({ hasAccount: false }))).toBe(false);
  });

  it("attend de connaître le palier de départ", () => {
    // Sans ce verrou : un import de Novice, puis un second du vrai palier une
    // seconde plus tard — deux unités du quota quotidien pour un besoin.
    expect(shouldAutoPull(context({ ready: false }))).toBe(false);
  });

  it("ne relance pas un palier déjà pré-rempli tout seul", () => {
    const pulls = withAutoPull(NO_AUTO_PULLS, "novice");

    expect(shouldAutoPull(context({ pulls }))).toBe(false);
  });

  it("ne repart pas non plus après un échec du même palier", () => {
    // La marque est posée avant la requête : un échec ne rouvre pas la boucle.
    const pulls = withAutoPull(NO_AUTO_PULLS, "novice");

    expect(shouldAutoPull(context({ pulls, state: importFailed("429") }))).toBe(false);
  });

  it("ne double pas un import en vol", () => {
    expect(shouldAutoPull(context({ state: LOADING }))).toBe(false);
  });

  it("n'écrase pas un import déjà abouti", () => {
    // Cas réel : « Rafraîchir » a rempli le palier, la mémoire d'onglet a été
    // vidée par un remontage — l'état du palier reste le dernier verrou.
    expect(shouldAutoPull(context({ state: done() }))).toBe(false);
  });

  it("importe le nouveau palier au changement, une fois lui aussi", () => {
    const first = context();

    expect(shouldAutoPull(first)).toBe(true);

    const pulls = withAutoPull(first.pulls, "novice");

    expect(shouldAutoPull(context({ tier: "advanced", pulls }))).toBe(true);

    const both = withAutoPull(pulls, "advanced");

    expect(shouldAutoPull(context({ tier: "advanced", pulls: both }))).toBe(false);
    // Retour sur le premier palier : toujours pas de second import.
    expect(shouldAutoPull(context({ tier: "novice", pulls: both }))).toBe(false);
  });
});

describe("marques de pull", () => {
  it("ne marque que le palier visé", () => {
    const pulls = withAutoPull(NO_AUTO_PULLS, "intermediate");

    expect(hasAutoPulled(pulls, "intermediate")).toBe(true);
    expect(hasAutoPulled(pulls, "novice")).toBe(false);
    expect(hasAutoPulled(pulls, "advanced")).toBe(false);
  });

  it("n'altère pas la valeur précédente", () => {
    const before: AutoPulls = NO_AUTO_PULLS;
    const after = withAutoPull(before, "novice");

    expect(hasAutoPulled(before, "novice")).toBe(false);
    expect(hasAutoPulled(after, "novice")).toBe(true);
  });
});

describe("mémoire d'onglet", () => {
  beforeEach(forgetAutoPulls);

  it("part vierge", () => {
    expect(sessionAutoPulls()).toEqual(NO_AUTO_PULLS);
  });

  it("survit au démontage du tracker : un seul pull auto par palier", () => {
    // Le scénario du défaut qu'elle évite : tracker → dashboard → tracker.
    // Un état de composant repartirait de zéro à chaque retour.
    const mount = () => shouldAutoPull(context({ pulls: sessionAutoPulls() }));

    expect(mount()).toBe(true);
    rememberAutoPull("novice");
    expect(mount()).toBe(false);
    expect(mount()).toBe(false);
  });

  it("laisse passer les autres paliers", () => {
    rememberAutoPull("novice");

    expect(shouldAutoPull(context({ tier: "intermediate", pulls: sessionAutoPulls() }))).toBe(true);
  });
});

describe("awaitsAutoPull", () => {
  it("attend sur un palier que le pull auto n'a pas encore visité", () => {
    expect(awaitsAutoPull(IDLE, NO_AUTO_PULLS, "novice")).toBe(true);
  });

  it("attend pendant l'import", () => {
    expect(awaitsAutoPull(LOADING, withAutoPull(NO_AUTO_PULLS, "novice"), "novice")).toBe(true);
  });

  it("n'attend plus une fois l'import abouti ou en échec", () => {
    const pulls = withAutoPull(NO_AUTO_PULLS, "novice");

    expect(awaitsAutoPull(done(), pulls, "novice")).toBe(false);
    expect(awaitsAutoPull(importFailed("429"), pulls, "novice")).toBe(false);
  });

  it("n'attend plus après un « Effacer la saisie » : le pull a déjà eu lieu", () => {
    // `clearImportState` remet le palier au repos ; sans la mémoire d'onglet,
    // l'écran repartirait en squelette devant quelqu'un qui vient d'effacer
    // pour taper ses scores à la main.
    const pulls = withAutoPull(NO_AUTO_PULLS, "novice");

    expect(awaitsAutoPull(IDLE, pulls, "novice")).toBe(false);
  });

  it("attend sur le palier voisin, qui n'a rien reçu", () => {
    const pulls = withAutoPull(NO_AUTO_PULLS, "novice");

    expect(awaitsAutoPull(IDLE, pulls, "advanced")).toBe(true);
  });
});

describe("les trois paliers", () => {
  const tiers: readonly TierId[] = ["novice", "intermediate", "advanced"];

  it("se marquent indépendamment", () => {
    let pulls = NO_AUTO_PULLS;

    for (const tier of tiers) {
      expect(shouldAutoPull(context({ tier, pulls }))).toBe(true);
      pulls = withAutoPull(pulls, tier);
    }
    for (const tier of tiers) {
      expect(shouldAutoPull(context({ tier, pulls }))).toBe(false);
    }
  });
});
