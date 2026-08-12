/**
 * Racine de l'application : routage par hash, garde d'authentification, choix
 * de la section.
 *
 * La garde est ici et nulle part ailleurs — une vue n'a jamais à vérifier
 * elle-même qu'il y a une session. Sans session, tout ce qui n'est pas la page
 * de connexion affiche la landing **sans changer le hash** : l'adresse
 * demandée survit à la connexion, et l'utilisateur atterrit là où il allait.
 *
 * ## Trois sections (V6)
 *
 * `Accueil` (tableau de bord, et la page d'une partie derrière
 * `?match=<id>`), `Perfs` (saisie et historique) et `Coach` (routine du jour et
 * fil). Les anciennes adresses sont toujours lues par `parseRoute` et
 * **réécrites** ici, une fois, avec `history.replaceState` : un favori
 * `#/historique?run=12` ouvre la bonne passe et l'adresse redevient canonique
 * sans empiler d'entrée dans l'historique du navigateur.
 *
 * ## Ce qui est chargé à la demande, et pourquoi
 *
 * - **l'historique des perfs** (dans `PerfsView`) et **la page d'une partie**,
 *   parce qu'ils entraînent Recharts — et Recharts tire d3 et un store Redux,
 *   environ un tiers du bundle pour des écrans que personne ne voit au premier
 *   chargement. Le bloc Valorant de l'accueil pousse le découpage d'un cran :
 *   ses figures ne sont téléchargées qu'à l'ouverture de son repli ;
 * - **l'administration**, parce que presque personne ne l'ouvrira jamais : elle
 *   n'existe que pour les administrateurs (SPEC §5 quater), et il n'y a aucune
 *   raison de la faire télécharger à tous les autres ;
 * - **les trois documents légaux** (`legal/pages`), pour la même raison : du
 *   texte long, ouvert une fois, qui n'a rien à faire dans le premier
 *   chargement. Ils sont en revanche **publics** — la garde d'authentification
 *   les laisse passer, sans session comme avec.
 *
 * Le reste est en import statique : ces vues ne pèsent que leur propre code, et
 * les découper coûterait un aller-retour réseau à chaque onglet pour rien.
 */

import { lazy, Suspense, useCallback, useEffect, useState } from "react";
import { AppLayout } from "./app/AppLayout";
import { ActiveBenchmarkProvider } from "./app/active-benchmark";
import { AuthProvider, useAuth } from "./auth/AuthProvider";
import { AuthView } from "./auth/AuthView";
import { RecoveryView } from "./auth/RecoveryView";
import { CoachSpace } from "./coach/CoachSpace";
import { DashboardView } from "./dashboard/DashboardView";
import { LandingView } from "./landing/LandingView";
import { LegalShell } from "./legal/LegalShell";
import { LEGAL_PAGES } from "./legal/pages";
import { PerfsView } from "./perfs/PerfsView";
import { ProfileView } from "./profile/ProfileView";
import {
  canonicalHash,
  DEFAULT_ROUTE,
  isLegalView,
  parseRoute,
  type Route,
  type RouteTarget,
  requiresSession,
  routeHash,
} from "./route";

/**
 * `MatchView` est un export nommé, `lazy` attend un export par défaut : on fait
 * la conversion ici plutôt que d'ajouter un `export default` au module, qui
 * n'aurait de sens que pour ce chargeur.
 */
const MatchView = lazy(async () => ({
  default: (await import("./valorant/MatchView")).MatchView,
}));

const AdminView = lazy(async () => ({
  default: (await import("./admin/AdminView")).AdminView,
}));

function currentRoute(): Route {
  return parseRoute(window.location.hash);
}

export default function App() {
  return (
    <AuthProvider>
      <Routed />
    </AuthProvider>
  );
}

function Routed() {
  const { status, recovering } = useAuth();
  const [route, setRoute] = useState<Route>(currentRoute);

  useEffect(() => {
    // La redirection des adresses d'avant V6, et le ménage des paramètres qui
    // ne veulent rien dire. `replaceState` ne déclenche pas `hashchange` et
    // n'empile rien dans l'historique du navigateur : seule l'adresse change,
    // la route lue est la même avant et après (`canonicalHash` converge, cf.
    // son test). D'où l'ordre — réécrire, puis lire.
    const rewrite = () => {
      const canonical = canonicalHash(window.location.hash);

      if (canonical !== null) window.history.replaceState(null, "", canonical);
    };
    const sync = () => {
      rewrite();
      setRoute(currentRoute());
    };

    // L'adresse d'arrivée : elle n'a déclenché aucun `hashchange`.
    rewrite();
    window.addEventListener("hashchange", sync);
    return () => window.removeEventListener("hashchange", sync);
  }, []);

  const navigate = useCallback((next: RouteTarget) => {
    const hash = routeHash(next);

    // `hashchange` ne se déclenche pas si le hash est déjà le bon (premier
    // chargement sans hash, notamment) : on rejoue la synchro à la main.
    if (window.location.hash === hash) setRoute(parseRoute(hash));
    else window.location.hash = hash;
  }, []);

  const authenticated = status === "authenticated";
  const guarded = requiresSession(route.view);

  useEffect(() => {
    // Connecté sur la page de connexion : elle n'a plus rien à demander, on
    // renvoie sur l'accueil de l'application. La condition porte sur `auth` et
    // non sur « vue publique » : les pages légales sont publiques elles aussi,
    // et un utilisateur connecté qui ouvre les CGU doit les lire, pas se faire
    // rediriger vers l'accueil.
    if (authenticated && route.view === "auth") navigate(DEFAULT_ROUTE);
  }, [authenticated, route.view, navigate]);

  // La session stockée n'est pas encore relue : afficher quoi que ce soit
  // ferait clignoter la landing sous un utilisateur déjà connecté.
  if (status === "loading") return <Booting />;

  // Un lien « mot de passe oublié » ouvre une session : elle ne doit servir
  // qu'à choisir le nouveau mot de passe, jamais à parcourir l'application.
  if (recovering) return <RecoveryView />;

  if (!authenticated) {
    // Les documents légaux sont publics (cf. `requiresSession`) : sans session
    // ils s'affichent dans leur propre coque, puisqu'il n'y a pas d'`AppLayout`
    // pour les porter. Une fois connecté, ils passent par `View`, comme les
    // autres vues.
    if (isLegalView(route.view)) {
      const LegalPage = LEGAL_PAGES[route.view];

      return (
        <LegalShell>
          <Suspense fallback={<ViewLoading />}>
            <LegalPage />
          </Suspense>
        </LegalShell>
      );
    }
    return guarded ? <LandingView /> : <AuthView />;
  }

  return (
    // Le benchmark actif est une préférence du profil (DECISIONS.md D6) : il se
    // charge à l'ouverture de session, donc ici — au-dessus de toutes les vues
    // qui le suivent (perfs, accueil, profil) et sous la garde
    // d'authentification, puisqu'il n'existe pas sans profil.
    <ActiveBenchmarkProvider>
      <AppLayout route={route}>
        {/* Le repli ne s'affiche que le temps de télécharger un morceau différé,
            une fois par session : un cadre muet, pas un écran de chargement,
            pour ne pas faire clignoter la mise en page sous l'utilisateur. */}
        <Suspense fallback={<ViewLoading />}>
          <View route={route} navigate={navigate} />
        </Suspense>
      </AppLayout>
    </ActiveBenchmarkProvider>
  );
}

interface ViewProps {
  readonly route: Route;
  readonly navigate: (route: RouteTarget) => void;
}

function View({ route, navigate }: ViewProps) {
  // Avant le `switch` : les trois documents légaux ne sont pas des sections de
  // l'application mais des pages qu'elle héberge, et leur composant vient d'un
  // registre différé plutôt que d'une branche écrite ici (cf. `legal/pages`).
  if (isLegalView(route.view)) {
    const LegalPage = LEGAL_PAGES[route.view];

    return <LegalPage />;
  }

  switch (route.view) {
    case "perfs":
      return (
        <PerfsView
          tab={route.tab}
          focusRunId={route.runId}
          onTabChange={(tab) => navigate({ view: "perfs", tab })}
          onFocusRun={(runId) => navigate({ view: "perfs", tab: "historique", runId })}
        />
      );
    case "coach":
      // La routine du jour et le fil (SPEC §5 sexies, V6) ; l'historique des
      // debriefs et celui des routines vivent à l'intérieur, en repli.
      return <CoachSpace />;
    case "profile":
      return <ProfileView />;
    case "admin":
      // La route existe pour tout le monde ; c'est le serveur qui refuse, et la
      // vue affiche alors « rien à voir ici » (SPEC §5 quater). Un routeur qui
      // refuserait ici annoncerait ce qu'il refuse.
      return <AdminView />;
    default:
      // L'accueil porte deux écrans : le tableau de bord, et la page d'une
      // partie quand l'adresse en désigne une. Le retour repasse par le
      // routeur — l'adresse reste la seule vérité.
      return route.matchId === null ? (
        <DashboardView />
      ) : (
        <MatchView matchId={route.matchId} onBack={() => navigate({ view: "home" })} />
      );
  }
}

/** Écran d'attente muet : quelques dizaines de millisecondes, sans contenu. */
function Booting() {
  return <div className="min-h-dvh" aria-busy="true" />;
}

/** Même principe, mais dans la mise en page : le temps d'un chargement différé. */
function ViewLoading() {
  return <div className="min-h-[60dvh]" aria-busy="true" />;
}
