/**
 * Coque de l'application authentifiée : en-tête, onglets sur grand écran,
 * barre du pouce sur téléphone.
 *
 * Mobile d'abord : la navigation vit en bas, à portée de pouce, pendant que
 * l'en-tête (marque, compte) reste collé en haut. À partir de `lg`, la barre
 * basse disparaît et les onglets remontent dans l'en-tête.
 */

import type { ReactNode } from "react";
import { useIsAdmin } from "../admin/useIsAdmin";
import { useAuth } from "../auth/AuthProvider";
import { NAV_ITEMS, type Route, routeHash, type ViewId, viewRoute } from "../route";

interface AppLayoutProps {
  readonly route: Route;
  readonly children: ReactNode;
}

/**
 * Hauteur de la barre du pouce (`h-16`, soit 4rem). Deux autres réglages en
 * dépendent et doivent bouger avec elle : le décalage bas de `<main>`, et la
 * barre de sauvegarde flottante du tracker (`bottom-16`, cf. `TrackerView`).
 */
const BOTTOM_BAR_HEIGHT = "h-16";

const ICONS: Readonly<Record<ViewId, string>> = {
  dashboard: "M4 4h7v7H4zM13 4h7v4h-7zM13 11h7v9h-7zM4 14h7v6H4z",
  tracker: "M12 3v3M12 18v3M3 12h3M18 12h3M12 7a5 5 0 1 0 0 10 5 5 0 0 0 0-10z",
  history: "M4 19V5M4 19h16M7 15l4-5 3 3 5-7",
  // Un fanion : la partie jouée, l'objectif pris — surtout pas un second
  // réticule, qui se confondrait avec celui du tracker à 20 px.
  valorant: "M6 4v16M6 5h11l-2.5 3.5L17 12H6z",
  coach: "M4 6a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H9l-5 4z",
  routine: "M9 6h11M9 12h11M9 18h11M4 6l1.4 1.4L8 4.8M4 12l1.4 1.4L8 10.8M4 18l1.4 1.4L8 16.8",
  profile: "M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM5 20a7 7 0 0 1 14 0",
  // Un bouclier : la seule entrée qui n'existe pas pour tout le monde.
  admin: "M12 3l7 3v5c0 4.4-2.9 8.3-7 9.5C7.9 19.3 5 15.4 5 11V6z",
  auth: "M15 4h3a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-3M10 16l4-4-4-4M14 12H4",
};

function Icon({ view }: { readonly view: ViewId }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className="size-5"
    >
      <path d={ICONS[view]} />
    </svg>
  );
}

export function AppLayout({ route, children }: AppLayoutProps) {
  const { user, signOut } = useAuth();
  const isAdmin = useIsAdmin();
  const profileActive = route.view === "profile";
  const adminActive = route.view === "admin";

  return (
    <div className="min-h-dvh">
      <header className="sticky top-0 z-20 border-b border-steel-800 bg-steel-950/90 backdrop-blur">
        <div className="mx-auto flex max-w-5xl items-center gap-3 px-4 py-3 sm:px-6">
          {/* La marque est « AimForge », et rien d'autre. Le nom du barème a
              longtemps été collé au logo : il y disait « cette application, c'est
              Voltaic S5 », ce qui cesse d'être vrai dès qu'un second benchmark
              existe et que l'utilisateur choisit le sien (DECISIONS.md D6). Il
              vit désormais là où il est pertinent — en tête du tracker et de
              l'historique, avec son statut et sa date de version. */}
          <a
            href={routeHash(viewRoute("dashboard"))}
            className="flex shrink-0 items-baseline gap-2"
          >
            <span className="font-mono text-lg font-semibold tracking-tight text-ember-500">
              AimForge
            </span>
          </a>

          <div className="ml-auto flex items-center gap-2 lg:gap-3">
            <nav aria-label="Sections" className="hidden gap-1 lg:flex">
              {NAV_ITEMS.map((item) => (
                <TabLink key={item.view} view={item.view} label={item.label} active={route.view} />
              ))}
            </nav>

            {/* L'entrée d'administration ne s'affiche que pour un administrateur
                — un confort, pas une protection : `api/admin/*` revérifie et
                répond 404 à tout le reste (SPEC §5 quater). Elle vit dans
                l'en-tête, à côté du profil, plutôt que dans la barre du pouce :
                celle-ci est à six entrées depuis V2 (cf. `NAV_ITEMS`), et une
                septième descendrait les cibles tactiles sous la largeur
                utilisable sur un téléphone de 360 px. */}
            {isAdmin ? (
              <a
                href={routeHash(viewRoute("admin"))}
                aria-current={adminActive ? "page" : undefined}
                title="Administration"
                className={`rounded-lg p-2 transition-colors ${
                  adminActive
                    ? "bg-ember-500/15 text-ember-400"
                    : "text-steel-400 hover:bg-steel-800 hover:text-steel-200"
                }`}
              >
                <Icon view="admin" />
                <span className="sr-only">Administration</span>
              </a>
            ) : null}

            <a
              href={routeHash(viewRoute("profile"))}
              aria-current={profileActive ? "page" : undefined}
              title={user?.email ?? "Profil"}
              className={`rounded-lg p-2 transition-colors ${
                profileActive
                  ? "bg-ember-500/15 text-ember-400"
                  : "text-steel-400 hover:bg-steel-800 hover:text-steel-200"
              }`}
            >
              <Icon view="profile" />
              <span className="sr-only">Profil</span>
            </a>
            <button
              type="button"
              onClick={() => void signOut()}
              className="rounded-lg px-2.5 py-2 text-xs font-medium text-steel-400 transition-colors hover:bg-steel-800 hover:text-steel-200"
            >
              Déconnexion
            </button>
          </div>
        </div>
      </header>

      {/* Le décalage bas laisse défiler le contenu au-dessus de la barre du pouce. */}
      <main className="mx-auto max-w-5xl px-4 py-6 pb-24 sm:px-6 sm:py-8 lg:pb-8">{children}</main>

      <nav
        aria-label="Sections"
        className={`fixed inset-x-0 bottom-0 z-20 border-t border-steel-800 bg-steel-950/95 backdrop-blur lg:hidden ${BOTTOM_BAR_HEIGHT}`}
      >
        <ul className="mx-auto grid h-full max-w-lg grid-flow-col">
          {NAV_ITEMS.map((item) => (
            <li key={item.view} className="contents">
              <BarLink view={item.view} label={item.label} active={route.view} />
            </li>
          ))}
        </ul>
      </nav>
    </div>
  );
}

interface LinkProps {
  readonly view: ViewId;
  readonly label: string;
  readonly active: ViewId;
}

function TabLink({ view, label, active }: LinkProps) {
  const current = view === active;

  return (
    <a
      href={routeHash(viewRoute(view))}
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

/**
 * Une entrée de la barre du pouce.
 *
 * Trois réglages ont changé au passage à six entrées, et ils tiennent tous au
 * même calcul : la barre répartit les entrées sur la largeur de l'écran, donc
 * une colonne fait 60 px sur un téléphone de 360 px, où le plus long libellé
 * (« HISTORIQUE ») demandait environ 62 px.
 *
 * - l'interlettrage est resserré (`tracking-normal` et non `tracking-wide`) ;
 * - le corps descend à 9 px sous 400 px de large, où la place manque vraiment,
 *   et reprend 10 px au-dessus ;
 * - `min-w-0` + `truncate` sont la ceinture : un libellé qui ne tiendrait
 *   toujours pas s'abrège au lieu de déborder sur son voisin.
 *
 * La cible tactile, elle, ne bouge pas : elle occupe toute la colonne et toute
 * la hauteur de la barre, soit 60 × 64 px — bien au-dessus des 44 px
 * recommandés.
 */
function BarLink({ view, label, active }: LinkProps) {
  const current = view === active;

  return (
    <a
      href={routeHash(viewRoute(view))}
      aria-current={current ? "page" : undefined}
      className={`flex min-w-0 flex-col items-center justify-center gap-1 px-0.5 text-[9px] font-medium tracking-normal uppercase transition-colors min-[400px]:text-[10px] ${
        current ? "text-ember-400" : "text-steel-500"
      }`}
    >
      <Icon view={view} />
      <span className="w-full truncate text-center">{label}</span>
    </a>
  );
}
