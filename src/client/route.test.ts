import { describe, expect, it } from "vitest";
import { MATCH_ID_MAX } from "../shared/valorant-contract";
import {
  AUTH_ROUTE,
  canonicalHash,
  DEFAULT_ROUTE,
  isLegalView,
  LEGAL_VIEWS,
  NAV_ITEMS,
  parseRoute,
  type Route,
  requiresSession,
  routeHash,
  type ViewId,
  viewRoute,
} from "./route";

const ALL_VIEWS: readonly ViewId[] = [
  "home",
  "perfs",
  "coach",
  "profile",
  "admin",
  "auth",
  "privacy",
  "terms",
  "legal",
];

/** Les vues qu'un visiteur sans session doit pouvoir ouvrir. */
const PUBLIC_VIEWS: readonly ViewId[] = ["auth", "privacy", "terms", "legal"];

describe("parseRoute", () => {
  it("retombe sur l'accueil quand le hash est absent, vide ou inconnu", () => {
    for (const hash of ["", "#", "#/", "#/n-importe-quoi", "#accueil-bis", "#/perfs/extra"]) {
      expect(parseRoute(hash), hash).toEqual(DEFAULT_ROUTE);
    }
  });

  it("lit chacune des sections de l'application", () => {
    expect(parseRoute("#/accueil").view).toBe("home");
    expect(parseRoute("#/perfs").view).toBe("perfs");
    expect(parseRoute("#/coach").view).toBe("coach");
    expect(parseRoute("#/profil").view).toBe("profile");
    expect(parseRoute("#/administration").view).toBe("admin");
    expect(parseRoute("#/connexion").view).toBe("auth");
    expect(parseRoute("#/confidentialite").view).toBe("privacy");
    expect(parseRoute("#/cgu").view).toBe("terms");
    expect(parseRoute("#/mentions-legales").view).toBe("legal");
  });

  it("ignore les paramètres inconnus", () => {
    expect(parseRoute("#/perfs?tri=date&vue=historique&run=7")).toEqual({
      view: "perfs",
      runId: 7,
      matchId: null,
      tab: "historique",
    });
  });
});

describe("parseRoute · sous-vues de Perfs", () => {
  it("ouvre la saisie par défaut", () => {
    expect(parseRoute("#/perfs")).toEqual(viewRoute("perfs"));
    expect(parseRoute("#/perfs?vue=saisie").tab).toBe("saisie");
    expect(parseRoute("perfs").tab).toBe("saisie");
  });

  it("ouvre l'historique quand l'adresse le demande", () => {
    expect(parseRoute("#/perfs?vue=historique")).toEqual({
      view: "perfs",
      runId: null,
      matchId: null,
      tab: "historique",
    });
  });

  it("retombe sur la saisie pour une sous-vue inconnue", () => {
    expect(parseRoute("#/perfs?vue=courbes").tab).toBe("saisie");
  });

  it("lit l'identifiant de la passe ouverte", () => {
    expect(parseRoute("#/perfs?vue=historique&run=12")).toEqual({
      view: "perfs",
      runId: 12,
      matchId: null,
      tab: "historique",
    });
  });

  /** Une passe ne s'ouvre que dans l'historique : le paramètre l'impose. */
  it("bascule sur l'historique quand une passe est désignée sans sous-vue", () => {
    expect(parseRoute("#/perfs?run=12")).toEqual({
      view: "perfs",
      runId: 12,
      matchId: null,
      tab: "historique",
    });
  });

  it("ignore un identifiant de passe qui n'est pas un entier positif", () => {
    for (const raw of ["0", "-3", "abc", "1.5", "", "1e3x"]) {
      expect(parseRoute(`#/perfs?vue=historique&run=${raw}`).runId, raw).toBeNull();
    }
  });

  it("ne porte d'identifiant de passe que sur les perfs", () => {
    for (const view of ALL_VIEWS.filter((candidate) => candidate !== "perfs")) {
      const hash = routeHash({ view, runId: 7 });

      expect(hash, view).not.toContain("run=");
      expect(parseRoute(hash).runId, view).toBeNull();
    }
  });
});

describe("parseRoute · page d'une partie", () => {
  it("lit le tableau de bord quand aucun match n'est désigné", () => {
    expect(parseRoute("#/accueil")).toEqual(viewRoute("home"));
    expect(parseRoute("#/accueil?")).toEqual(viewRoute("home"));
  });

  it("lit l'identifiant du match ouvert", () => {
    expect(parseRoute("#/accueil?match=abc-123")).toEqual({
      view: "home",
      runId: null,
      matchId: "abc-123",
      tab: "saisie",
    });
  });

  it("décode l'identifiant et écarte les espaces autour", () => {
    expect(parseRoute("#/accueil?match=a%20b").matchId).toBe("a b");
    expect(parseRoute("#/accueil?match=%20abc%20").matchId).toBe("abc");
  });

  it("retombe sur le tableau de bord pour un identifiant vide ou trop long", () => {
    for (const raw of ["", "%20%20", "x".repeat(MATCH_ID_MAX + 1)]) {
      expect(parseRoute(`#/accueil?match=${raw}`).matchId, raw).toBeNull();
    }
  });

  it("accepte un identifiant à la longueur maximale du contrat", () => {
    const longest = "x".repeat(MATCH_ID_MAX);

    expect(parseRoute(`#/accueil?match=${longest}`).matchId).toBe(longest);
  });

  it("ne porte d'identifiant de match que sur l'accueil", () => {
    for (const view of ALL_VIEWS.filter((candidate) => candidate !== "home")) {
      const hash = routeHash({ view, matchId: "abc" });

      expect(hash, view).not.toContain("match=");
      expect(parseRoute(hash).matchId, view).toBeNull();
    }
  });
});

/**
 * Le cœur de la bascule V6 : aucune adresse d'avant ne devient inaccessible.
 * Un favori, un lien partagé, un onglet resté ouvert doivent tous retomber sur
 * la section qui a repris le contenu — avec leur paramètre.
 */
describe("parseRoute · adresses d'avant V6", () => {
  const REDIRECTIONS: readonly (readonly [string, Route])[] = [
    ["#/dashboard", viewRoute("home")],
    ["#/tracker", viewRoute("perfs")],
    ["#/historique", { view: "perfs", runId: null, matchId: null, tab: "historique" }],
    ["#/historique?run=12", { view: "perfs", runId: 12, matchId: null, tab: "historique" }],
    ["#/valorant", viewRoute("home")],
    ["#/valorant?match=abc-123", { view: "home", runId: null, matchId: "abc-123", tab: "saisie" }],
    ["#/routine", viewRoute("coach")],
  ];

  for (const [hash, expected] of REDIRECTIONS) {
    it(`redirige ${hash} vers ${routeHash(expected)}`, () => {
      expect(parseRoute(hash)).toEqual(expected);
      expect(canonicalHash(hash)).toBe(routeHash(expected));
    });
  }

  it("laisse les adresses qui n'ont pas bougé", () => {
    for (const hash of ["#/coach", "#/profil", "#/administration", "#/connexion"]) {
      expect(canonicalHash(hash), hash).toBeNull();
    }
  });
});

describe("canonicalHash", () => {
  it("ne réécrit pas une adresse déjà canonique", () => {
    for (const view of ALL_VIEWS) {
      expect(canonicalHash(routeHash(viewRoute(view))), view).toBeNull();
    }
    expect(canonicalHash("#/perfs?vue=historique&run=3")).toBeNull();
    expect(canonicalHash("#/accueil?match=abc")).toBeNull();
  });

  it("ne réécrit pas un hash absent — ce n'est pas une mauvaise adresse", () => {
    expect(canonicalHash("")).toBeNull();
    expect(canonicalHash("#")).toBeNull();
  });

  it("ramène une adresse inconnue sur l'accueil", () => {
    expect(canonicalHash("#/n-importe-quoi")).toBe("#/accueil");
  });

  it("nettoie les paramètres qui ne veulent rien dire", () => {
    expect(canonicalHash("#/perfs?vue=saisie")).toBe("#/perfs");
    expect(canonicalHash("#/coach?run=4")).toBe("#/coach");
  });

  /** Une réécriture qui ne converge pas boucle : la seconde passe ne bouge plus. */
  it("converge en une seule réécriture", () => {
    for (const hash of [
      "#/dashboard",
      "#/tracker",
      "#/historique?run=12",
      "#/valorant?match=abc",
      "#/routine",
      "#/n-importe-quoi",
    ]) {
      const once = canonicalHash(hash);

      expect(once, hash).not.toBeNull();
      expect(canonicalHash(once ?? ""), hash).toBeNull();
    }
  });
});

describe("routeHash", () => {
  it("produit un hash relu à l'identique pour chaque section", () => {
    for (const view of ALL_VIEWS) {
      const hash = routeHash(viewRoute(view));

      expect(parseRoute(hash), hash).toEqual(viewRoute(view));
    }
  });

  it("conserve la sous-vue et la passe ouverte des perfs", () => {
    const routes: readonly Route[] = [
      { view: "perfs", runId: null, matchId: null, tab: "historique" },
      { view: "perfs", runId: 42, matchId: null, tab: "historique" },
    ];

    for (const route of routes) {
      expect(parseRoute(routeHash(route)), routeHash(route)).toEqual(route);
    }
  });

  it("conserve le match ouvert, y compris avec un caractère à encoder", () => {
    for (const matchId of ["abc-123", "a b", "a&b=c", "é#/?"]) {
      const route: Route = { view: "home", runId: null, matchId, tab: "saisie" };

      expect(parseRoute(routeHash(route)), matchId).toEqual(route);
    }
  });

  it("n'écrit plus aucune adresse d'avant V6", () => {
    const written = ALL_VIEWS.map((view) => routeHash(viewRoute(view))).join(" ");

    for (const legacy of ["dashboard", "tracker", "historique", "valorant", "routine"]) {
      expect(written, legacy).not.toContain(legacy);
    }
  });

  it("laisse tomber l'identifiant de passe hors des perfs", () => {
    expect(routeHash({ view: "coach", runId: 9 })).toBe("#/coach");
    expect(routeHash({ view: "home", runId: 9 })).toBe("#/accueil");
  });
});

describe("requiresSession", () => {
  it("protège toutes les sections sauf la liste blanche publique", () => {
    for (const view of ALL_VIEWS) {
      expect(requiresSession(view), view).toBe(!PUBLIC_VIEWS.includes(view));
    }
  });

  it("laisse passer la route de connexion et protège la route par défaut", () => {
    expect(requiresSession(AUTH_ROUTE.view)).toBe(false);
    expect(requiresSession(DEFAULT_ROUTE.view)).toBe(true);
  });

  /**
   * Le cœur de la vague 3.5 : ces trois documents s'acceptent à l'inscription,
   * donc ils se lisent avant d'avoir un compte. Sous un mur d'authentification,
   * ils ne seraient pas publiés.
   */
  it("ouvre les trois pages légales à un visiteur sans session", () => {
    for (const hash of ["#/confidentialite", "#/cgu", "#/mentions-legales"]) {
      expect(requiresSession(parseRoute(hash).view), hash).toBe(false);
    }
  });

  it("ne rend publique aucune vue de l'application", () => {
    for (const view of ALL_VIEWS.filter((candidate) => candidate !== "auth")) {
      expect(requiresSession(view), view).toBe(!isLegalView(view));
    }
  });
});

describe("pages légales", () => {
  it("reconnaît les trois documents, et rien d'autre", () => {
    expect(LEGAL_VIEWS).toEqual(["privacy", "terms", "legal"]);
    for (const view of ALL_VIEWS) {
      expect(isLegalView(view), view).toBe(LEGAL_VIEWS.includes(view as never));
    }
  });

  it("leur donne une adresse française, lisible et stable", () => {
    expect(routeHash(viewRoute("privacy"))).toBe("#/confidentialite");
    expect(routeHash(viewRoute("terms"))).toBe("#/cgu");
    expect(routeHash(viewRoute("legal"))).toBe("#/mentions-legales");
  });

  it("les laisse hors de la navigation permanente", () => {
    for (const item of NAV_ITEMS) {
      expect(isLegalView(item.view), item.view).toBe(false);
    }
  });
});

describe("NAV_ITEMS", () => {
  it("ne propose que des vues protégées et sans doublon", () => {
    const views = NAV_ITEMS.map((item) => item.view);

    expect(new Set(views).size).toBe(views.length);
    expect(views.every(requiresSession)).toBe(true);
  });

  it("commence par l'accueil, la vue par défaut", () => {
    expect(NAV_ITEMS[0]?.view).toBe(DEFAULT_ROUTE.view);
  });

  /**
   * Trois cibles, et pas une de plus : la barre du pouce les répartit sur la
   * largeur de l'écran, soit 120 px chacune sur un téléphone de 360 px. Le
   * profil et l'administration restent dans l'en-tête — ce sont des réglages.
   */
  it("tient en trois sections, sans profil ni administration", () => {
    expect(NAV_ITEMS).toHaveLength(3);
    expect(NAV_ITEMS.map((item) => item.view)).toEqual(["home", "perfs", "coach"]);
  });
});
