/**
 * Routage par hash, fait maison : une section, et ce qu'elle ouvre.
 *
 * Le hash plutôt qu'un routeur : l'app est servie en statique (Vercel), aucune
 * règle de réécriture n'est nécessaire, et un rechargement ou un lien partagé
 * retombe sur la même vue.
 *
 * Le hash reste à nous seuls : le client Supabase est configuré en PKCE, donc
 * ses retours (OAuth, confirmation d'email, réinitialisation) arrivent en
 * `?code=…` dans la query et ne piétinent jamais cette grammaire.
 *
 * ## Trois sections depuis V6
 *
 * Six onglets disaient l'organisation du code (un écran par table) plutôt que
 * celle du travail. Il n'en reste **trois** : où j'en suis (Accueil), ce que je
 * mesure (Perfs), ce qui m'aide (Coach). Tracker et Historique sont devenus les
 * deux sous-vues de Perfs, Valorant un bloc de l'accueil, la Routine une action
 * du coach.
 *
 * **Aucune ancienne adresse n'est perdue** : `parseRoute` lit encore
 * `#/dashboard`, `#/tracker`, `#/historique`, `#/valorant` et `#/routine`, avec
 * leurs paramètres, et rend la route nouvelle. `routeHash` ne les écrit plus —
 * c'est ce qui fait de `canonicalHash` une réécriture qui converge : une
 * adresse lue puis réécrite est stable au coup d'après.
 *
 * Module pur : aucun accès à `window`, pour rester testable.
 */

import { MATCH_ID_MAX } from "../shared/valorant-contract";

export type ViewId = "home" | "perfs" | "coach" | "profile" | "admin" | "auth" | LegalViewId;

/**
 * Les trois documents légaux (vague 3.5).
 *
 * Ils sont des vues à part entière — une adresse, un titre, un contenu — mais
 * n'appartiennent à aucune barre de navigation : on y arrive par le pied de
 * page, ou par un lien depuis l'extérieur. D'où le type séparé, dont
 * `AppViewId` est le complément : ce qui peut porter une icône et une entrée
 * d'onglet.
 */
export type LegalViewId = "privacy" | "terms" | "legal";

/** Les vues de l'application proprement dite : tout sauf les pages légales. */
export type AppViewId = Exclude<ViewId, LegalViewId>;

/** Les trois pages légales, dans l'ordre où le pied de page les affiche. */
export const LEGAL_VIEWS: readonly LegalViewId[] = ["privacy", "terms", "legal"];

const LEGAL_VIEW_SET: ReadonlySet<string> = new Set(LEGAL_VIEWS);

/** Cette vue est-elle un document légal ? */
export function isLegalView(view: ViewId): view is LegalViewId {
  return LEGAL_VIEW_SET.has(view);
}

/**
 * Les deux sous-vues de Perfs.
 *
 * Elle vit dans l'**adresse** et non dans un `useState` : une sous-vue en
 * mémoire ne survit pas au rechargement et ne se partage pas en lien, alors que
 * « regarde ma courbe » est exactement ce qu'on veut envoyer à quelqu'un.
 */
export type PerfsTab = "saisie" | "historique";

/**
 * Une destination : la section, et ce qu'elle ouvre — les paramètres facultatifs.
 *
 * C'est ce que `routeHash` accepte, pour qu'un appelant qui vise une section
 * sans paramètre écrive `{ view: "profile" }` et n'ait pas à énumérer les
 * paramètres des autres. `Route` en est la forme complète, celle que le routeur
 * rend.
 */
export interface RouteTarget {
  readonly view: ViewId;
  readonly runId?: number | null;
  readonly matchId?: string | null;
  readonly tab?: PerfsTab;
}

export interface Route extends RouteTarget {
  readonly view: ViewId;
  /** Passe à ouvrir dans l'historique des perfs ; `null` = aucune. */
  readonly runId: number | null;
  /**
   * Partie à ouvrir sur l'accueil ; `null` = le tableau de bord.
   *
   * Il vit dans la route et non dans une boîte à lettres mémoire (le patron de
   * `coach/prefill.ts`) parce qu'une page de match doit survivre au
   * rechargement et se partager en lien : c'est une **adresse**, pas un geste.
   */
  readonly matchId: string | null;
  /** Sous-vue de Perfs ; « saisie » partout ailleurs, et sans effet. */
  readonly tab: PerfsTab;
}

/** Les adresses **écrites**. Une section, un chemin, en français. */
const PATHS: Readonly<Record<ViewId, string>> = {
  home: "accueil",
  perfs: "perfs",
  coach: "coach",
  profile: "profil",
  admin: "administration",
  auth: "connexion",
  privacy: "confidentialite",
  terms: "cgu",
  legal: "mentions-legales",
};

interface PathSpec {
  readonly view: ViewId;
  /** Sous-vue imposée par le chemin (les anciens onglets, qui en désignaient une). */
  readonly tab?: PerfsTab;
}

/**
 * Les adresses **lues** : les canoniques, et celles d'avant V6.
 *
 * Les anciennes ne sont pas des alias polis, ce sont des liens déjà partagés et
 * des favoris déjà posés. Elles restent lues pour toujours ; c'est le coût,
 * assumé et minuscule, d'avoir changé la navigation.
 */
const SPEC_BY_PATH: ReadonlyMap<string, PathSpec> = new Map<string, PathSpec>([
  ...Object.entries(PATHS).map(
    ([view, path]) => [path, { view: view as ViewId }] as [string, PathSpec],
  ),
  ["dashboard", { view: "home" }],
  ["tracker", { view: "perfs", tab: "saisie" }],
  ["historique", { view: "perfs", tab: "historique" }],
  ["valorant", { view: "home" }],
  ["routine", { view: "coach" }],
]);

/** Vue d'accueil une fois connecté. Tout hash inconnu y retombe. */
export const DEFAULT_ROUTE: Route = {
  view: "home",
  runId: null,
  matchId: null,
  tab: "saisie",
};

/** La seule vue accessible sans session ; sert aussi de cible de redirection. */
export const AUTH_ROUTE: Route = { view: "auth", runId: null, matchId: null, tab: "saisie" };

/** Une route sans paramètre : le cas de quatre sections sur six. */
export function viewRoute(view: ViewId): Route {
  return { view, runId: null, matchId: null, tab: "saisie" };
}

export interface NavItem {
  readonly view: AppViewId;
  readonly label: string;
}

/**
 * Les onglets de navigation permanents, dans l'ordre d'affichage.
 *
 * **Trois entrées depuis V6.** Elles ne décrivent plus des écrans mais des
 * moments : où j'en suis, ce que je mesure, ce qui m'aide. Sur un téléphone de
 * 360 px, chaque cible de la barre du pouce fait 120 × 64 px — deux fois et
 * demie les 44 px recommandés, là où six entrées descendaient à 60 px de large
 * et forçaient à rogner les libellés.
 *
 * Le profil et l'administration restent dans l'en-tête : ce sont des réglages,
 * pas des destinations de travail.
 */
export const NAV_ITEMS: readonly NavItem[] = [
  { view: "home", label: "Accueil" },
  { view: "perfs", label: "Perfs" },
  { view: "coach", label: "Coach" },
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
 * Les vues accessibles **sans session**, et la raison de chacune.
 *
 * - `auth` : la page de connexion, évidemment — c'est par elle qu'on obtient
 *   une session ;
 * - `privacy`, `terms`, `legal` : les trois documents légaux. Ils doivent être
 *   lisibles *avant* de créer un compte, puisque c'est en les acceptant qu'on
 *   s'inscrit, et rester lisibles par un visiteur qui n'en créera jamais — un
 *   document légal derrière un mur d'authentification n'est pas publié.
 *
 * La liste est **blanche** et non noire : une vue ajoutée demain est protégée
 * par défaut, et ne devient publique que si quelqu'un l'écrit ici.
 */
const PUBLIC_VIEWS: ReadonlySet<ViewId> = new Set<ViewId>(["auth", ...LEGAL_VIEWS]);

/** Une vue exige-t-elle une session ? Tout ce qui n'est pas public. */
export function requiresSession(view: ViewId): boolean {
  return !PUBLIC_VIEWS.has(view);
}

/**
 * L'identifiant de match d'un hash, ou `null`.
 *
 * La borne est celle du contrat (`MATCH_ID_MAX`) et non un chiffre choisi ici :
 * un hash bricolé à la main ne doit pas envoyer un roman à `api/valorant/match`
 * pour se faire refuser au bout du voyage. Au-delà, le routeur préfère « aucun
 * match » — le tableau de bord — à une page de match vouée à l'échec.
 */
function matchIdOf(params: URLSearchParams): string | null {
  const raw = params.get("match")?.trim() ?? "";

  return raw === "" || raw.length > MATCH_ID_MAX ? null : raw;
}

/** L'identifiant de passe d'un hash, ou `null` s'il n'est pas un entier positif. */
function runIdOf(params: URLSearchParams): number | null {
  const raw = params.get("run");
  const runId = raw === null ? Number.NaN : Number(raw);

  return Number.isInteger(runId) && runId > 0 ? runId : null;
}

/**
 * Lit une route depuis un hash (`#/perfs?vue=historique&run=12`,
 * `#/accueil?match=abc`), y compris depuis une adresse d'avant V6. Tout hash
 * inconnu retombe sur l'accueil plutôt que d'afficher une page d'erreur.
 */
export function parseRoute(hash: string): Route {
  const [path = "", query = ""] = hash.replace(/^#\/?/, "").split("?");
  const spec = SPEC_BY_PATH.get(path);

  if (spec === undefined) return DEFAULT_ROUTE;

  const params = new URLSearchParams(query);

  if (spec.view === "home") {
    return { view: "home", runId: null, matchId: matchIdOf(params), tab: "saisie" };
  }
  if (spec.view !== "perfs") return viewRoute(spec.view);

  const runId = runIdOf(params);
  // Une passe désignée impose l'historique : c'est la seule sous-vue qui sache
  // l'ouvrir. Sans cette règle, `#/perfs?run=12` afficherait la saisie et
  // perdrait silencieusement le paramètre.
  const tab: PerfsTab =
    runId !== null
      ? "historique"
      : (spec.tab ?? (params.get("vue") === "historique" ? "historique" : "saisie"));

  return { view: "perfs", runId, matchId: null, tab };
}

/** Le hash correspondant à une destination, à poser sur `window.location.hash`. */
export function routeHash(route: RouteTarget): string {
  const path = PATHS[route.view];

  if (route.view === "perfs") {
    const runId = route.runId ?? null;
    const tab = runId !== null ? "historique" : (route.tab ?? "saisie");

    if (tab === "saisie") return `#/${path}`;
    return runId === null ? `#/${path}?vue=historique` : `#/${path}?vue=historique&run=${runId}`;
  }
  if (route.view === "home") {
    const matchId = route.matchId ?? null;

    return matchId === null ? `#/${path}` : `#/${path}?match=${encodeURIComponent(matchId)}`;
  }
  return `#/${path}`;
}

/**
 * L'adresse canonique d'un hash, ou `null` s'il l'est déjà — c'est-à-dire s'il
 * n'y a rien à réécrire.
 *
 * C'est ainsi que les anciennes adresses redirigent : `App` la pose avec
 * `history.replaceState`, qui **ne déclenche pas** `hashchange` et n'empile
 * rien dans l'historique du navigateur. La route affichée, elle, a déjà été lue
 * du hash d'origine — la réécriture est cosmétique, jamais un second rendu.
 *
 * Un hash absent n'est pas réécrit : « pas d'adresse » n'est pas une mauvaise
 * adresse, et pousser un `#/accueil` sous quelqu'un qui vient d'ouvrir la
 * racine du site n'apporte rien.
 */
export function canonicalHash(hash: string): string | null {
  if (hash === "" || hash === "#") return null;

  const canonical = routeHash(parseRoute(hash));

  return canonical === hash ? null : canonical;
}
