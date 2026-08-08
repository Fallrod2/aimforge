import { describe, expect, it } from "vitest";
import { DEFAULT_ROUTE, parseRoute, type Route, routeHash } from "./route";

describe("parseRoute", () => {
  it("retombe sur le tracker quand le hash est absent, vide ou inconnu", () => {
    for (const hash of ["", "#", "#/", "#/tracker", "#/n-importe-quoi", "#historique-bis"]) {
      expect(parseRoute(hash), hash).toEqual(DEFAULT_ROUTE);
    }
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
});

describe("routeHash", () => {
  const routes: readonly Route[] = [
    { view: "tracker", runId: null },
    { view: "history", runId: null },
    { view: "history", runId: 42 },
  ];

  it("produit un hash relu à l'identique", () => {
    for (const route of routes) {
      // Le tracker n'a pas d'identifiant de passe : la route relue le remet à null.
      const expected = route.view === "tracker" ? DEFAULT_ROUTE : route;

      expect(parseRoute(routeHash(route)), routeHash(route)).toEqual(expected);
    }
  });

  it("laisse tomber l'identifiant de passe sur la vue tracker", () => {
    expect(routeHash({ view: "tracker", runId: 9 })).toBe("#/tracker");
  });
});
