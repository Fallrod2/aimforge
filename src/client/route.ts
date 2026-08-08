/**
 * Routage par hash, fait maison : deux vues, un identifiant de passe optionnel.
 *
 * Le hash plutôt qu'un routeur : l'app est servie en statique derrière l'API,
 * aucune règle de réécriture serveur n'est nécessaire, et un rechargement (ou
 * un partage de lien en LAN) retombe sur la même vue.
 *
 * Module pur : aucun accès à `window`, pour rester testable.
 */

export type ViewId = "tracker" | "history";

export interface Route {
  readonly view: ViewId;
  /** Passe à ouvrir dans l'historique ; `null` = aucune. */
  readonly runId: number | null;
}

const PATHS: Readonly<Record<ViewId, string>> = {
  tracker: "tracker",
  history: "historique",
};

export const DEFAULT_ROUTE: Route = { view: "tracker", runId: null };

/** Les onglets de navigation, dans l'ordre d'affichage. */
export const NAV_ITEMS: readonly { readonly view: ViewId; readonly label: string }[] = [
  { view: "tracker", label: "Tracker" },
  { view: "history", label: "Historique" },
];

/**
 * Lit une route depuis un hash (`#/historique?run=12`). Tout hash inconnu
 * retombe sur le tracker plutôt que d'afficher une page d'erreur.
 */
export function parseRoute(hash: string): Route {
  const [path = "", query = ""] = hash.replace(/^#\/?/, "").split("?");

  if (path !== PATHS.history) return DEFAULT_ROUTE;

  const raw = new URLSearchParams(query).get("run");
  const runId = raw === null ? Number.NaN : Number(raw);

  return {
    view: "history",
    runId: Number.isInteger(runId) && runId > 0 ? runId : null,
  };
}

/** Le hash correspondant à une route, à poser sur `window.location.hash`. */
export function routeHash(route: Route): string {
  if (route.view === "tracker") return `#/${PATHS.tracker}`;

  return route.runId === null ? `#/${PATHS.history}` : `#/${PATHS.history}?run=${route.runId}`;
}
