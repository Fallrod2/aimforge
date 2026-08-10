/**
 * Racine de l'application : routage par hash, garde d'authentification, choix
 * de la vue.
 *
 * La garde est ici et nulle part ailleurs — une vue n'a jamais à vérifier
 * elle-même qu'il y a une session. Sans session, tout ce qui n'est pas la page
 * de connexion affiche la landing **sans changer le hash** : l'adresse
 * demandée survit à la connexion, et l'utilisateur atterrit là où il allait.
 *
 * Trois vues sont chargées à la demande, pour deux raisons différentes :
 *
 * - **l'historique** et **Valorant**, parce que leurs courbes tirent Recharts,
 *   et Recharts tire d3 et un store Redux — environ un tiers du bundle pour des
 *   écrans que personne ne voit au premier chargement (l'application ouvre sur
 *   le tableau de bord). Valorant pousse le découpage d'un cran : ses figures
 *   sont elles-mêmes différées à l'intérieur de la vue, pour que ses chiffres
 *   s'affichent sans attendre ses graphes ;
 * - **l'administration**, parce que presque personne ne l'ouvrira jamais : elle
 *   n'existe que pour les administrateurs (SPEC §5 quater), et il n'y a aucune
 *   raison de la faire télécharger à tous les autres.
 *
 * Les cinq autres vues restent en import statique : elles ne pèsent que leur
 * propre code, et les découper coûterait un aller-retour réseau à chaque onglet
 * pour rien.
 */

import { lazy, Suspense, useCallback, useEffect, useState } from "react";
import { AppLayout } from "./app/AppLayout";
import { AuthProvider, useAuth } from "./auth/AuthProvider";
import { AuthView } from "./auth/AuthView";
import { RecoveryView } from "./auth/RecoveryView";
import { CoachThreadView } from "./coach/CoachThreadView";
import { DashboardView } from "./dashboard/DashboardView";
import { LandingView } from "./landing/LandingView";
import { ProfileView } from "./profile/ProfileView";
import {
  DEFAULT_ROUTE,
  parseRoute,
  type Route,
  type RouteTarget,
  requiresSession,
  routeHash,
} from "./route";
import { RoutineView } from "./routine/RoutineView";
import { TrackerView } from "./tracker/TrackerView";

/**
 * `HistoryView` est un export nommé, `lazy` attend un export par défaut : on
 * fait la conversion ici plutôt que d'ajouter un `export default` au module,
 * qui n'aurait de sens que pour ce chargeur.
 */
const HistoryView = lazy(async () => ({
  default: (await import("./history/HistoryView")).HistoryView,
}));

const ValorantView = lazy(async () => ({
  default: (await import("./valorant/ValorantView")).ValorantView,
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
    const sync = () => setRoute(currentRoute());

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
    // Connecté sur une vue publique (la page de connexion) : elle n'a plus
    // rien à demander, on renvoie sur l'accueil de l'application.
    if (authenticated && !guarded) navigate(DEFAULT_ROUTE);
  }, [authenticated, guarded, navigate]);

  // La session stockée n'est pas encore relue : afficher quoi que ce soit
  // ferait clignoter la landing sous un utilisateur déjà connecté.
  if (status === "loading") return <Booting />;

  // Un lien « mot de passe oublié » ouvre une session : elle ne doit servir
  // qu'à choisir le nouveau mot de passe, jamais à parcourir l'application.
  if (recovering) return <RecoveryView />;

  if (!authenticated) return guarded ? <LandingView /> : <AuthView />;

  return (
    <AppLayout route={route}>
      {/* Le repli ne s'affiche que le temps de télécharger l'historique, une
          fois par session : un cadre muet, pas un écran de chargement, pour ne
          pas faire clignoter la mise en page sous l'utilisateur. */}
      <Suspense fallback={<ViewLoading />}>
        <View route={route} navigate={navigate} />
      </Suspense>
    </AppLayout>
  );
}

interface ViewProps {
  readonly route: Route;
  readonly navigate: (route: RouteTarget) => void;
}

function View({ route, navigate }: ViewProps) {
  const focusRun = (runId: number | null) => navigate({ view: "history", runId });

  switch (route.view) {
    case "tracker":
      return <TrackerView onSaved={(run) => focusRun(run.id)} />;
    case "history":
      return <HistoryView focusRunId={route.runId} onFocusRun={focusRun} />;
    case "valorant":
      return (
        <ValorantView
          matchId={route.matchId}
          onOpenMatch={(matchId) => navigate({ view: "valorant", matchId })}
        />
      );
    case "coach":
      // L'onglet Coach est le fil (SPEC §5 sexies) ; l'historique des debriefs
      // vit à l'intérieur, en repli.
      return <CoachThreadView />;
    case "routine":
      return <RoutineView />;
    case "profile":
      return <ProfileView />;
    case "admin":
      // La route existe pour tout le monde ; c'est le serveur qui refuse, et la
      // vue affiche alors « rien à voir ici » (SPEC §5 quater). Un routeur qui
      // refuserait ici annoncerait ce qu'il refuse.
      return <AdminView />;
    default:
      return <DashboardView />;
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
