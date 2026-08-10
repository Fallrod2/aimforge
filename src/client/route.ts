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

import { MATCH_ID_MAX } from "../shared/valorant-contract";

export type ViewId =
  | "dashboard"
  | "tracker"
  | "history"
  | "valorant"
  | "coach"
  | "routine"
  | "profile"
  | "admin"
  | "auth";

/**
 * Une destination : la vue, et ce qu'elle ouvre — les paramètres facultatifs.
 *
 * C'est ce que `routeHash` accepte, pour qu'un appelant qui vise une vue sans
 * paramètre écrive `{ view: "profil" }` et n'ait pas à énumérer les paramètres
 * des autres vues. `Route` en est la forme complète, celle que le routeur rend.
 */
export interface RouteTarget {
  readonly view: ViewId;
  readonly runId?: number | null;
  readonly matchId?: string | null;
}

export interface Route extends RouteTarget {
  readonly view: ViewId;
  /** Passe à ouvrir dans l'historique ; `null` = aucune. */
  readonly runId: number | null;
  /**
   * Partie à ouvrir dans la vue Valorant ; `null` = la vue d'ensemble.
   *
   * Il vit dans la route et non dans une boîte à lettres mémoire (le patron de
   * `coach/prefill.ts`) parce qu'une page de match doit survivre au
   * rechargement et se partager en lien : c'est une **adresse**, pas un geste.
   */
  readonly matchId: string | null;
}

const PATHS: Readonly<Record<ViewId, string>> = {
  dashboard: "dashboard",
  tracker: "tracker",
  history: "historique",
  valorant: "valorant",
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
export const DEFAULT_ROUTE: Route = { view: "dashboard", runId: null, matchId: null };

/** La seule vue accessible sans session ; sert aussi de cible de redirection. */
export const AUTH_ROUTE: Route = { view: "auth", runId: null, matchId: null };

/** Une route sans paramètre : le cas de six vues sur neuf. */
export function viewRoute(view: ViewId): Route {
  return { view, runId: null, matchId: null };
}

export interface NavItem {
  readonly view: ViewId;
  readonly label: string;
}

/**
 * Les onglets de navigation permanents, dans l'ordre d'affichage.
 *
 * **Six entrées depuis V2**, et c'est la limite assumée. La barre du pouce en
 * tenait cinq pour rester au-dessus de la largeur de cible utilisable sur un
 * téléphone de 360 px ; Valorant est le sixième parce que c'est une destination
 * de plein droit (vue d'ensemble, tendances, page de match), pas un panneau du
 * dashboard. À 360 px chaque cible fait 60 px — au-dessus des 44 px
 * recommandés — et `AppLayout` resserre l'interlettrage des libellés de la
 * barre pour que « Historique » y tienne sans être rogné. Une septième entrée
 * casserait le compte : elle irait dans l'en-tête, comme le profil.
 *
 * L'ordre suit celui du travail : ce que je mesure (tracker, historique), ce
 * que je joue (Valorant), ce qui m'aide (coach, routine).
 */
export const NAV_ITEMS: readonly NavItem[] = [
  { view: "dashboard", label: "Accueil" },
  { view: "tracker", label: "Tracker" },
  { view: "history", label: "Historique" },
  { view: "valorant", label: "Valorant" },
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
export const ADMIN_ROUTE: Route = viewRoute("admin");

/**
 * Une vue exige-t-elle une session ? Tout sauf la page de connexion : la
 * réponse est en liste blanche, pour qu'une vue ajoutée plus tard soit
 * protégée par défaut plutôt que publique par oubli.
 */
export function requiresSession(view: ViewId): boolean {
  return view !== "auth";
}

/**
 * L'identifiant de match d'un hash, ou `null`.
 *
 * La borne est celle du contrat (`MATCH_ID_MAX`) et non un chiffre choisi ici :
 * un hash bricolé à la main ne doit pas envoyer un roman à `api/valorant/match`
 * pour se faire refuser au bout du voyage. Au-delà, le routeur préfère « aucun
 * match » — la vue d'ensemble — à une page de match vouée à l'échec.
 */
function matchIdOf(query: string): string | null {
  const raw = new URLSearchParams(query).get("match")?.trim() ?? "";

  return raw === "" || raw.length > MATCH_ID_MAX ? null : raw;
}

/**
 * Lit une route depuis un hash (`#/historique?run=12`, `#/valorant?match=abc`).
 * Tout hash inconnu retombe sur le dashboard plutôt que d'afficher une page
 * d'erreur.
 */
export function parseRoute(hash: string): Route {
  const [path = "", query = ""] = hash.replace(/^#\/?/, "").split("?");
  const view = VIEW_BY_PATH.get(path);

  if (view === undefined) return DEFAULT_ROUTE;

  if (view === "valorant") {
    return { view, runId: null, matchId: matchIdOf(query) };
  }
  if (view !== "history") return viewRoute(view);

  const raw = new URLSearchParams(query).get("run");
  const runId = raw === null ? Number.NaN : Number(raw);

  return {
    view: "history",
    runId: Number.isInteger(runId) && runId > 0 ? runId : null,
    matchId: null,
  };
}

/** Le hash correspondant à une destination, à poser sur `window.location.hash`. */
export function routeHash(route: RouteTarget): string {
  const path = PATHS[route.view];

  if (route.view === "history") {
    return route.runId === null || route.runId === undefined
      ? `#/${path}`
      : `#/${path}?run=${route.runId}`;
  }
  if (route.view === "valorant") {
    const matchId = route.matchId ?? null;

    return matchId === null ? `#/${path}` : `#/${path}?match=${encodeURIComponent(matchId)}`;
  }
  return `#/${path}`;
}
