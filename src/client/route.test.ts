import { describe, expect, it } from "vitest";
import { MATCH_ID_MAX } from "../shared/valorant-contract";
import {
  AUTH_ROUTE,
  DEFAULT_ROUTE,
  NAV_ITEMS,
  parseRoute,
  type Route,
  requiresSession,
  routeHash,
  type ViewId,
  viewRoute,
} from "./route";

const ALL_VIEWS: readonly ViewId[] = [
  "dashboard",
  "tracker",
  "history",
  "valorant",
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
    expect(parseRoute("#/valorant").view).toBe("valorant");
    expect(parseRoute("#/coach").view).toBe("coach");
    expect(parseRoute("#/routine").view).toBe("routine");
    expect(parseRoute("#/profil").view).toBe("profile");
    expect(parseRoute("#/connexion").view).toBe("auth");
  });

  it("lit la vue historique sans passe ouverte", () => {
    expect(parseRoute("#/historique")).toEqual(viewRoute("history"));
    expect(parseRoute("historique")).toEqual(viewRoute("history"));
  });

  it("lit l'identifiant de la passe ouverte", () => {
    expect(parseRoute("#/historique?run=12")).toEqual({
      view: "history",
      runId: 12,
      matchId: null,
    });
  });

  it("ignore un identifiant qui n'est pas un entier positif", () => {
    for (const raw of ["0", "-3", "abc", "1.5", "", "1e3x"]) {
      expect(parseRoute(`#/historique?run=${raw}`).runId, raw).toBeNull();
    }
  });

  it("ignore les paramètres inconnus", () => {
    expect(parseRoute("#/historique?tri=date&run=7")).toEqual({
      view: "history",
      runId: 7,
      matchId: null,
    });
  });

  it("ne porte d'identifiant de passe que sur l'historique", () => {
    for (const view of ALL_VIEWS.filter((candidate) => candidate !== "history")) {
      const hash = routeHash({ view, runId: 7 });

      expect(hash, view).not.toContain("run=");
      expect(parseRoute(hash).runId, view).toBeNull();
    }
  });
});

describe("parseRoute · vue Valorant", () => {
  it("lit la vue d'ensemble quand aucun match n'est désigné", () => {
    expect(parseRoute("#/valorant")).toEqual(viewRoute("valorant"));
    expect(parseRoute("#/valorant?")).toEqual(viewRoute("valorant"));
  });

  it("lit l'identifiant du match ouvert", () => {
    expect(parseRoute("#/valorant?match=abc-123")).toEqual({
      view: "valorant",
      runId: null,
      matchId: "abc-123",
    });
  });

  it("décode l'identifiant et écarte les espaces autour", () => {
    expect(parseRoute("#/valorant?match=a%20b").matchId).toBe("a b");
    expect(parseRoute("#/valorant?match=%20abc%20").matchId).toBe("abc");
  });

  it("retombe sur la vue d'ensemble pour un identifiant vide ou trop long", () => {
    for (const raw of ["", "%20%20", "x".repeat(MATCH_ID_MAX + 1)]) {
      expect(parseRoute(`#/valorant?match=${raw}`).matchId, raw).toBeNull();
    }
  });

  it("accepte un identifiant à la longueur maximale du contrat", () => {
    const longest = "x".repeat(MATCH_ID_MAX);

    expect(parseRoute(`#/valorant?match=${longest}`).matchId).toBe(longest);
  });

  it("ne porte d'identifiant de match que sur la vue Valorant", () => {
    for (const view of ALL_VIEWS.filter((candidate) => candidate !== "valorant")) {
      const hash = routeHash({ view, matchId: "abc" });

      expect(hash, view).not.toContain("match=");
      expect(parseRoute(hash).matchId, view).toBeNull();
    }
  });
});

describe("routeHash", () => {
  it("produit un hash relu à l'identique pour chaque vue", () => {
    for (const view of ALL_VIEWS) {
      const hash = routeHash(viewRoute(view));

      expect(parseRoute(hash), hash).toEqual(viewRoute(view));
    }
  });

  it("conserve la passe ouverte de l'historique", () => {
    const route: Route = { view: "history", runId: 42, matchId: null };

    expect(parseRoute(routeHash(route))).toEqual(route);
  });

  it("conserve le match ouvert, y compris avec un caractère à encoder", () => {
    for (const matchId of ["abc-123", "a b", "a&b=c", "é#/?"]) {
      const route: Route = { view: "valorant", runId: null, matchId };

      expect(parseRoute(routeHash(route)), matchId).toEqual(route);
    }
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

  it("porte la vue Valorant, destination de plein droit depuis V2", () => {
    expect(NAV_ITEMS.map((item) => item.view)).toContain("valorant");
  });

  /**
   * La barre du pouce répartit ces entrées sur toute la largeur : à six, une
   * cible fait encore 60 px sur un téléphone de 360 px. Une septième
   * descendrait à 51 px — sous le confort de frappe — et devrait remonter dans
   * l'en-tête, comme le profil et l'administration.
   */
  it("ne dépasse pas six entrées, la limite de la barre du pouce", () => {
    expect(NAV_ITEMS.length).toBeLessThanOrEqual(6);
  });
});
