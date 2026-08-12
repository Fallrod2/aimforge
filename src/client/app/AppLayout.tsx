/**
 * Coque de l'application authentifiée : en-tête, onglets sur grand écran,
 * barre du pouce sur téléphone.
 *
 * Mobile d'abord : la navigation vit en bas, à portée de pouce, pendant que
 * l'en-tête (marque, compte) reste collé en haut. À partir de `lg`, la barre
 * basse disparaît et les onglets remontent dans l'en-tête.
 *
 * Trois entrées depuis V6 (cf. `NAV_ITEMS`), et rien d'autre dans la barre : le
 * profil et l'administration restent des icônes de l'en-tête. Une barre du
 * pouce n'est pas un sommaire, c'est un jeu de cibles — chacune fait ici un
 * tiers de la largeur.
 */

import type { ReactNode } from "react";
import { useIsAdmin } from "../admin/useIsAdmin";
import { useAuth } from "../auth/AuthProvider";
import { LegalFooter } from "../legal/LegalFooter";
import { type AppViewId, NAV_ITEMS, type Route, routeHash, type ViewId, viewRoute } from "../route";

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

/**
 * Une icône par vue de l'application — `AppViewId` et non `ViewId` : les trois
 * documents légaux n'ont ni entrée d'onglet ni icône, ils vivent dans le pied
 * de page. Le registre reste ainsi total, sans entrées mortes.
 */
const ICONS: Readonly<Record<AppViewId, string>> = {
  home: "M4 4h7v7H4zM13 4h7v4h-7zM13 11h7v9h-7zM4 14h7v6H4z",
  // Une courbe montante : Perfs porte la saisie **et** l'historique, et c'est
  // la progression qui les relie. Un réticule n'aurait parlé que de la saisie.
  perfs: "M4 19V5M4 19h16M7 15l4-5 3 3 5-7",
  coach: "M4 6a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H9l-5 4z",
  profile: "M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM5 20a7 7 0 0 1 14 0",
  // Un bouclier : la seule entrée qui n'existe pas pour tout le monde.
  admin: "M12 3l7 3v5c0 4.4-2.9 8.3-7 9.5C7.9 19.3 5 15.4 5 11V6z",
  auth: "M15 4h3a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-3M10 16l4-4-4-4M14 12H4",
};

function Icon({ view }: { readonly view: AppViewId }) {
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
          <a href={routeHash(viewRoute("home"))} className="flex shrink-0 items-baseline gap-2">
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
                celle-ci ne porte que les trois sections de travail (cf.
                `NAV_ITEMS`), et un réglage n'en est pas une. */}
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

      <main className="mx-auto max-w-5xl px-4 py-6 sm:px-6 sm:py-8">{children}</main>

      {/* Le pied de page légal ferme le document, et porte désormais le
          décalage bas qui laisse défiler le contenu au-dessus de la barre du
          pouce : c'est lui le dernier élément de la page, plus `<main>`. Le
          `pb-16` vaut exactement `BOTTOM_BAR_HEIGHT`, et disparaît en `lg` avec
          la barre. Il reste discret — une obligation de publication, pas une
          navigation. */}
      <LegalFooter className="pb-16 lg:pb-0" />

      <nav
        aria-label="Sections"
        className={`fixed inset-x-0 bottom-0 z-20 border-t border-steel-800 bg-steel-950/95 backdrop-blur lg:hidden ${BOTTOM_BAR_HEIGHT}`}
      >
        {/* Trois colonnes, imposées : `grid-cols-3` plutôt qu'un `grid-flow-col`
            qui suivrait le nombre d'entrées. La largeur d'une cible est une
            décision d'ergonomie (un tiers de l'écran, jamais moins), pas une
            conséquence de la longueur d'une liste. */}
        <ul className="mx-auto grid h-full max-w-lg grid-cols-3">
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
  /** Une vue de l'application : un document légal ne s'affiche pas en onglet. */
  readonly view: AppViewId;
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
 * Le passage à trois sections (V6) a rendu la place : la cible occupe un tiers
 * de l'écran et toute la hauteur de la barre, soit 120 × 64 px sur un téléphone
 * de 360 px — là où six entrées tombaient à 60 px de large et obligeaient à
 * rogner l'interlettrage puis le corps du texte. Le `min-h-11` (44 px) est
 * explicite et non déduit de `BOTTOM_BAR_HEIGHT` : c'est le plancher tactile
 * recommandé, il doit survivre à un changement de hauteur de la barre.
 *
 * `min-w-0` + `truncate` restent la ceinture, pour un libellé qui grandirait.
 */
function BarLink({ view, label, active }: LinkProps) {
  const current = view === active;

  return (
    <a
      href={routeHash(viewRoute(view))}
      aria-current={current ? "page" : undefined}
      className={`flex min-h-11 min-w-0 flex-col items-center justify-center gap-1 px-1 text-[11px] font-medium tracking-wide uppercase transition-colors ${
        current ? "text-ember-400" : "text-steel-500"
      }`}
    >
      <Icon view={view} />
      <span className="w-full truncate text-center">{label}</span>
    </a>
  );
}
