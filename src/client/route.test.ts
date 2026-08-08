import { describe, expect, it } from "vitest";
import {
  AUTH_ROUTE,
  DEFAULT_ROUTE,
  NAV_ITEMS,
  parseRoute,
  type Route,
  requiresSession,
  routeHash,
  type ViewId,
} from "./route";

const ALL_VIEWS: readonly ViewId[] = [
  "dashboard",
  "tracker",
  "history",
  "coach",
  "routine",
  "profile",
  "auth",
];

describe("parseRoute", () => {
  it("retombe sur le dashboard quand le hash est absent, vide ou inconnu", () => {
    for (const hash of ["", "#", "#/", "#/n-importe-quoi", "#historique-bis", "#/tracker/extra"]) {
      expect(parseRoute(hash), hash).toEqual(DEFAULT_ROUTE);
    }
  });

  it("lit chacune des vues de l'application", () => {
    expect(parseRoute("#/dashboard").view).toBe("dashboard");
    expect(parseRoute("#/tracker").view).toBe("tracker");
    expect(parseRoute("#/historique").view).toBe("history");
    expect(parseRoute("#/coach").view).toBe("coach");
    expect(parseRoute("#/routine").view).toBe("routine");
    expect(parseRoute("#/profil").view).toBe("profile");
    expect(parseRoute("#/connexion").view).toBe("auth");
  });

  it("lit la vue historique sans passe ouverte", () => {
    expect(parseRoute("#/historique")).toEqual({ view: "history", runId: null });
    expect(parseRoute("historique")).toEqual({ view: "history", runId: null });
  });

  it("lit l'identifiant de la passe ouverte", () => {
    expect(parseRoute("#/historique?run=12")).toEqual({ view: "history", runId: 12 });
  });

  it("ignore un identifiant qui n'est pas un entier positif", () => {
    for (const raw of ["0", "-3", "abc", "1.5", "", "1e3x"]) {
      expect(parseRoute(`#/historique?run=${raw}`).runId, raw).toBeNull();
    }
  });

  it("ignore les paramètres inconnus", () => {
    expect(parseRoute("#/historique?tri=date&run=7")).toEqual({ view: "history", runId: 7 });
  });

  it("ne porte d'identifiant de passe que sur l'historique", () => {
    for (const view of ALL_VIEWS.filter((candidate) => candidate !== "history")) {
      const hash = routeHash({ view, runId: 7 });

      expect(hash, view).not.toContain("run=");
      expect(parseRoute(hash).runId, view).toBeNull();
    }
  });
});

describe("routeHash", () => {
  it("produit un hash relu à l'identique pour chaque vue", () => {
    for (const view of ALL_VIEWS) {
      const hash = routeHash({ view, runId: null });

      expect(parseRoute(hash), hash).toEqual({ view, runId: null });
    }
  });

  it("conserve la passe ouverte de l'historique", () => {
    const route: Route = { view: "history", runId: 42 };

    expect(parseRoute(routeHash(route))).toEqual(route);
  });

  it("laisse tomber l'identifiant de passe hors de l'historique", () => {
    expect(routeHash({ view: "tracker", runId: 9 })).toBe("#/tracker");
    expect(routeHash({ view: "dashboard", runId: 9 })).toBe("#/dashboard");
  });
});

describe("requiresSession", () => {
  it("protège toutes les vues sauf la page de connexion", () => {
    for (const view of ALL_VIEWS) {
      expect(requiresSession(view), view).toBe(view !== "auth");
    }
  });

  it("laisse passer la route de connexion et protège la route par défaut", () => {
    expect(requiresSession(AUTH_ROUTE.view)).toBe(false);
    expect(requiresSession(DEFAULT_ROUTE.view)).toBe(true);
  });
});

describe("NAV_ITEMS", () => {
  it("ne propose que des vues protégées et sans doublon", () => {
    const views = NAV_ITEMS.map((item) => item.view);

    expect(new Set(views).size).toBe(views.length);
    expect(views.every(requiresSession)).toBe(true);
  });

  it("commence par le dashboard, la vue d'accueil", () => {
    expect(NAV_ITEMS[0]?.view).toBe(DEFAULT_ROUTE.view);
  });
});
