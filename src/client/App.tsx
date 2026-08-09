/**
 * Racine de l'application : routage par hash, garde d'authentification, choix
 * de la vue.
 *
 * La garde est ici et nulle part ailleurs — une vue n'a jamais à vérifier
 * elle-même qu'il y a une session. Sans session, tout ce qui n'est pas la page
 * de connexion affiche la landing **sans changer le hash** : l'adresse
 * demandée survit à la connexion, et l'utilisateur atterrit là où il allait.
 */

import { useCallback, useEffect, useState } from "react";
import { AppLayout } from "./app/AppLayout";
import { AuthProvider, useAuth } from "./auth/AuthProvider";
import { AuthView } from "./auth/AuthView";
import { RecoveryView } from "./auth/RecoveryView";
import { CoachView } from "./coach/CoachView";
import { DashboardView } from "./dashboard/DashboardView";
import { HistoryView } from "./history/HistoryView";
import { LandingView } from "./landing/LandingView";
import { ProfileView } from "./profile/ProfileView";
import { DEFAULT_ROUTE, parseRoute, type Route, requiresSession, routeHash } from "./route";
import { RoutineView } from "./routine/RoutineView";
import { TrackerView } from "./tracker/TrackerView";

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

  const navigate = useCallback((next: Route) => {
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
      <View route={route} navigate={navigate} />
    </AppLayout>
  );
}

interface ViewProps {
  readonly route: Route;
  readonly navigate: (route: Route) => void;
}

function View({ route, navigate }: ViewProps) {
  const focusRun = (runId: number | null) => navigate({ view: "history", runId });

  switch (route.view) {
    case "tracker":
      return <TrackerView onSaved={(run) => focusRun(run.id)} />;
    case "history":
      return <HistoryView focusRunId={route.runId} onFocusRun={focusRun} />;
    case "coach":
      return <CoachView />;
    case "routine":
      return <RoutineView />;
    case "profile":
      return <ProfileView />;
    default:
      return <DashboardView />;
  }
}

/** Écran d'attente muet : quelques dizaines de millisecondes, sans contenu. */
function Booting() {
  return <div className="min-h-dvh" aria-busy="true" />;
}
