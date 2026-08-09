/**
 * Routage par hash, fait maison : une vue, un identifiant de passe optionnel.
 *
 * Le hash plutôt qu'un routeur : l'app est servie en statique (Vercel), aucune
 * règle de réécriture n'est nécessaire, et un rechargement ou un lien partagé
 * retombe sur la même vue.
 *
 * Le hash reste à nous seuls : le client Supabase est configuré en PKCE, donc
 * ses retours (OAuth, confirmation d'email, réinitialisation) arrivent en
 * `?code=…` dans la query et ne piétinent jamais cette grammaire.
 *
 * Module pur : aucun accès à `window`, pour rester testable.
 */

export type ViewId =
  | "dashboard"
  | "tracker"
  | "history"
  | "coach"
  | "routine"
  | "profile"
  | "admin"
  | "auth";

export interface Route {
  readonly view: ViewId;
  /** Passe à ouvrir dans l'historique ; `null` = aucune. */
  readonly runId: number | null;
}

const PATHS: Readonly<Record<ViewId, string>> = {
  dashboard: "dashboard",
  tracker: "tracker",
  history: "historique",
  coach: "coach",
  routine: "routine",
  profile: "profil",
  admin: "administration",
  auth: "connexion",
};

const VIEW_BY_PATH: ReadonlyMap<string, ViewId> = new Map(
  Object.entries(PATHS).map(([view, path]) => [path, view as ViewId]),
);

/** Vue d'accueil une fois connecté. Tout hash inconnu y retombe. */
export const DEFAULT_ROUTE: Route = { view: "dashboard", runId: null };

/** La seule vue accessible sans session ; sert aussi de cible de redirection. */
export const AUTH_ROUTE: Route = { view: "auth", runId: null };

export interface NavItem {
  readonly view: ViewId;
  readonly label: string;
}

/**
 * Les onglets de navigation permanents, dans l'ordre d'affichage.
 *
 * Cinq entrées, pas six : le profil est atteint depuis l'en-tête (avec la
 * déconnexion) pour que la barre du pouce reste sous la limite où les cibles
 * tactiles deviennent trop étroites sur un téléphone de 360 px.
 */
export const NAV_ITEMS: readonly NavItem[] = [
  { view: "dashboard", label: "Accueil" },
  { view: "tracker", label: "Tracker" },
  { view: "history", label: "Historique" },
  { view: "coach", label: "Coach" },
  { view: "routine", label: "Routine" },
];

/**
 * L'administration n'est **pas** dans `NAV_ITEMS` : elle n'existe que pour les
 * administrateurs, et une liste de navigation constante ne sait pas qui
 * regarde. `AppLayout` ajoute son entrée à côté du profil quand
 * `useIsAdmin` répond oui. Sa route, elle, existe pour tout le monde — c'est le
 * serveur qui refuse (404), pas le routeur, parce qu'un routeur qui refuse
 * annonce ce qu'il refuse.
 */
export const ADMIN_ROUTE: Route = { view: "admin", runId: null };

/**
 * Une vue exige-t-elle une session ? Tout sauf la page de connexion : la
 * réponse est en liste blanche, pour qu'une vue ajoutée plus tard soit
 * protégée par défaut plutôt que publique par oubli.
 */
export function requiresSession(view: ViewId): boolean {
  return view !== "auth";
}

/**
 * Lit une route depuis un hash (`#/historique?run=12`). Tout hash inconnu
 * retombe sur le dashboard plutôt que d'afficher une page d'erreur.
 */
export function parseRoute(hash: string): Route {
  const [path = "", query = ""] = hash.replace(/^#\/?/, "").split("?");
  const view = VIEW_BY_PATH.get(path);

  if (view === undefined) return DEFAULT_ROUTE;
  if (view !== "history") return { view, runId: null };

  const raw = new URLSearchParams(query).get("run");
  const runId = raw === null ? Number.NaN : Number(raw);

  return {
    view: "history",
    runId: Number.isInteger(runId) && runId > 0 ? runId : null,
  };
}

/** Le hash correspondant à une route, à poser sur `window.location.hash`. */
export function routeHash(route: Route): string {
  if (route.view !== "history") return `#/${PATHS[route.view]}`;

  return route.runId === null ? `#/${PATHS.history}` : `#/${PATHS.history}?run=${route.runId}`;
}
