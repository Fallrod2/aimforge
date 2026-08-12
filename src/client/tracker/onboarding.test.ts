import { describe, expect, it } from "vitest";
import { createMemoryStore } from "./local-store";
import {
  dismissOnboarding,
  isOnboardingDismissed,
  ONBOARDING_KEY,
  showsOnboarding,
} from "./onboarding";

describe("showsOnboarding", () => {
  const fresh = { hasRuns: false, hasDraft: false, dismissed: false };

  it("accueille un compte sans passe et sans brouillon", () => {
    expect(showsOnboarding(fresh)).toBe(true);
  });

  it("se tait dès qu'une passe existe", () => {
    expect(showsOnboarding({ ...fresh, hasRuns: true })).toBe(false);
  });

  it("se tait dès que la saisie a commencé : le bandeau n'explique plus rien", () => {
    expect(showsOnboarding({ ...fresh, hasDraft: true })).toBe(false);
  });

  it("se tait quand il a été refermé", () => {
    expect(showsOnboarding({ ...fresh, dismissed: true })).toBe(false);
  });

  it("n'apparaît pas tant qu'on ne sait pas si le compte a des passes", () => {
    // `null` = l'historique n'a pas encore répondu : afficher puis retirer le
    // bandeau ferait sauter la page sous les yeux de quelqu'un qui a des passes.
    expect(showsOnboarding({ ...fresh, hasRuns: null })).toBe(false);
  });
});

describe("mémoire du bandeau", () => {
  it("retient qu'il a été refermé", () => {
    const store = createMemoryStore();

    expect(isOnboardingDismissed(store)).toBe(false);
    dismissOnboarding(store);
    expect(isOnboardingDismissed(store)).toBe(true);
  });

  it("écrit sous une clé préfixée par l'application", () => {
    expect(ONBOARDING_KEY.startsWith("aimforge.")).toBe(true);
  });

  it("survit à un stockage indisponible", () => {
    const hostile = {
      getItem: () => {
        throw new Error("bloqué");
      },
      setItem: () => {
        throw new Error("bloqué");
      },
      removeItem: () => {
        throw new Error("bloqué");
      },
    };

    expect(() => dismissOnboarding(hostile)).not.toThrow();
    expect(isOnboardingDismissed(hostile)).toBe(false);
  });
});
