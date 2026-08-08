/**
 * Coque de l'application : en-tête, navigation à deux vues, routage par hash.
 *
 * Mobile d'abord : l'en-tête reste collé en haut (la navigation doit rester
 * atteignable au pouce pendant la saisie des 18 scores), le contenu tient dans
 * une colonne unique et ne s'élargit qu'à partir de `lg`.
 */

import { useCallback, useEffect, useState } from "react";
import { HistoryView } from "./history/HistoryView";
import { NAV_ITEMS, parseRoute, type Route, routeHash, type ViewId } from "./route";
import { TrackerView } from "./tracker/TrackerView";

function currentRoute(): Route {
  return parseRoute(window.location.hash);
}

export default function App() {
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

  const focusRun = useCallback(
    (runId: number | null) => navigate({ view: "history", runId }),
    [navigate],
  );

  return (
    <div className="min-h-dvh">
      <header className="sticky top-0 z-20 border-b border-steel-800 bg-steel-950/90 backdrop-blur">
        <div className="mx-auto flex max-w-5xl items-center gap-4 px-4 py-3 sm:px-6">
          <a
            href={routeHash({ view: "tracker", runId: null })}
            className="flex shrink-0 items-baseline gap-2"
          >
            <span className="font-mono text-lg font-semibold tracking-tight text-ember-500">
              AimForge
            </span>
            <span className="hidden text-[11px] tracking-[0.18em] text-steel-500 uppercase sm:inline">
              Voltaic S5
            </span>
          </a>

          <nav aria-label="Sections" className="ml-auto flex gap-1">
            {NAV_ITEMS.map((item) => (
              <NavLink key={item.view} view={item.view} label={item.label} active={route.view} />
            ))}
          </nav>
        </div>
      </header>

      <main className="mx-auto max-w-5xl px-4 py-6 sm:px-6 sm:py-8">
        {route.view === "tracker" ? (
          <TrackerView onSaved={(run) => focusRun(run.id)} />
        ) : (
          <HistoryView focusRunId={route.runId} onFocusRun={focusRun} />
        )}
      </main>
    </div>
  );
}

interface NavLinkProps {
  readonly view: ViewId;
  readonly label: string;
  readonly active: ViewId;
}

function NavLink({ view, label, active }: NavLinkProps) {
  const current = view === active;

  return (
    <a
      href={routeHash({ view, runId: null })}
      aria-current={current ? "page" : undefined}
      className={`rounded-lg px-3 py-2 text-xs font-semibold tracking-wide uppercase transition-colors ${
        current
          ? "bg-ember-500/15 text-ember-400 shadow-[inset_0_0_0_1px_var(--color-ember-500)]"
          : "text-steel-400 hover:bg-steel-800 hover:text-steel-200"
      }`}
    >
      {label}
    </a>
  );
}
