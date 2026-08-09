/**
 * La garde du panneau d'administration, vérifiée sur ce qu'elle promet et pas
 * seulement sur ce qu'elle laisse passer.
 *
 * Trois propriétés, et aucune n'est visible en lisant le code d'appel : les
 * trois façons d'échouer sont **indiscernables** de l'extérieur, l'échec est un
 * 404 et non un 403, et un appel non identifié ne fait travailler personne.
 */

import { describe, expect, it, vi } from "vitest";
import { ADMIN_NOT_FOUND, adminVerdict } from "./admin";

/** Une lecture de `platform_admins` qui rend ce qu'on lui dit, et se compte. */
function lookup(result: boolean) {
  return vi.fn(async () => result);
}

describe("adminVerdict", () => {
  it("laisse passer un administrateur identifié", async () => {
    expect(
      await adminVerdict({ authenticated: true, serviceAvailable: true, lookup: lookup(true) }),
    ).toEqual({ ok: true });
  });

  it.each([
    ["sans jeton", { authenticated: false, serviceAvailable: true, admin: true }],
    ["sans service key", { authenticated: true, serviceAvailable: false, admin: true }],
    ["compte non administrateur", { authenticated: true, serviceAvailable: true, admin: false }],
  ])(
    "refuse en 404, avec le même corps qu'une route inexistante (%s)",
    async (_label, scenario) => {
      const verdict = await adminVerdict({
        authenticated: scenario.authenticated,
        serviceAvailable: scenario.serviceAvailable,
        lookup: lookup(scenario.admin),
      });

      expect(verdict.ok).toBe(false);
      if (verdict.ok) return;
      // 404 et pas 403 : un 403 confirmerait que la surface existe.
      expect(verdict.status).toBe(404);
      expect(verdict.message).toBe(ADMIN_NOT_FOUND);
    },
  );

  it("rend exactement le même message dans les trois cas de refus", async () => {
    const messages = await Promise.all(
      [
        { authenticated: false, serviceAvailable: true, admin: true },
        { authenticated: true, serviceAvailable: false, admin: true },
        { authenticated: true, serviceAvailable: true, admin: false },
      ].map(async (scenario) => {
        const verdict = await adminVerdict({
          authenticated: scenario.authenticated,
          serviceAvailable: scenario.serviceAvailable,
          lookup: lookup(scenario.admin),
        });

        return verdict.ok ? "passé" : verdict.message;
      }),
    );

    // Un message qui distinguerait « pas connecté » de « pas admin » rendrait
    // la distinction observable — donc la surface devinable.
    expect(new Set(messages).size).toBe(1);
  });

  it("n'interroge pas la base pour un appel non identifié", async () => {
    const spy = lookup(true);

    await adminVerdict({ authenticated: false, serviceAvailable: true, lookup: spy });
    expect(spy).not.toHaveBeenCalled();
  });

  it("referme quand l'habilitation est invérifiable, au lieu de supposer", async () => {
    const spy = lookup(true);
    const verdict = await adminVerdict({
      authenticated: true,
      serviceAvailable: false,
      lookup: spy,
    });

    expect(verdict.ok).toBe(false);
    expect(spy).not.toHaveBeenCalled();
  });

  it("garde une raison pour le journal, jamais pour la réponse", async () => {
    const verdict = await adminVerdict({
      authenticated: true,
      serviceAvailable: true,
      lookup: lookup(false),
    });

    expect(verdict.ok).toBe(false);
    if (verdict.ok) return;
    expect(verdict.reason).toContain("administrateur");
    // Le message rendu au client, lui, ne dit rien de la raison.
    expect(verdict.message).not.toContain("administrateur");
  });
});
