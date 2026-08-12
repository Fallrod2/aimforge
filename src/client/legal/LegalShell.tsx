/**
 * La coque des documents légaux **pour un visiteur sans session**.
 *
 * Une fois connecté, ces pages s'affichent dans `AppLayout` comme n'importe
 * quelle vue. Sans session il n'y a pas d'`AppLayout` — d'où cette coque
 * minimale : la marque, un retour vers la présentation, le document, le pied
 * de page. Aucune navigation applicative : il n'y a rien à naviguer sans
 * compte.
 */

import type { ReactNode } from "react";
import { DEFAULT_ROUTE, routeHash } from "../route";
import { LegalFooter } from "./LegalFooter";

/** Sans session, la route par défaut affiche la landing (cf. `App.tsx`). */
const LANDING_HASH = routeHash(DEFAULT_ROUTE);

export function LegalShell({ children }: { readonly children: ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-col">
      <header className="border-b border-steel-800">
        <div className="mx-auto flex max-w-5xl items-center gap-4 px-4 py-4 sm:px-6">
          <a
            href={LANDING_HASH}
            className="font-mono text-lg font-semibold tracking-tight text-ember-500"
          >
            AimForge
          </a>
          <a
            href={LANDING_HASH}
            className="ml-auto text-xs text-steel-500 transition-colors hover:text-steel-300"
          >
            ← Retour à la présentation
          </a>
        </div>
      </header>

      <main className="mx-auto w-full max-w-5xl grow px-4 py-10 sm:px-6 sm:py-14">{children}</main>

      <LegalFooter />
    </div>
  );
}
