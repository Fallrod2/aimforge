/**
 * Le pied de page légal, affiché partout : landing, application connectée, et
 * documents légaux eux-mêmes.
 *
 * Discret par construction — c'est une obligation de publication, pas une
 * navigation. Trois liens et une mention de copyright, en petit, sur une ligne
 * qui se replie sur téléphone.
 *
 * Il vit dans `legal/` et non dans `components/` parce qu'il n'est pas une
 * brique réutilisable : c'est le pied de page **de ces documents-là**, et il
 * suit leur liste (`LEGAL_VIEWS`) sans que personne ait à le tenir à jour.
 */

import { LEGAL_VIEWS } from "../route";
import { LEGAL_SHORT_LABELS, legalHash } from "./documents";

interface LegalFooterProps {
  /** Classes de mise en page de l'hôte (marges, décalage bas). */
  readonly className?: string;
}

export function LegalFooter({ className = "" }: LegalFooterProps) {
  return (
    <footer className={`border-t border-steel-900 ${className}`}>
      {/* `steel-400` et non `steel-500` : le pied de page est le seul endroit
          qui se lise sur le fond nu **et** au bas d'une page dense, où l'œil
          arrive fatigué. Il était en `steel-600` — 2,00:1, soit trois fois moins
          que le seuil AA — ; `steel-400` le remonte à 5,40:1 sans en faire une
          navigation (cf. `contrast.test.ts`). */}
      <div className="mx-auto flex max-w-5xl flex-wrap items-center gap-x-4 gap-y-2 px-4 py-6 text-xs text-steel-400 sm:px-6">
        <span>© 2026 AimForge</span>
        <nav
          aria-label="Informations légales"
          className="flex flex-wrap items-center gap-x-4 gap-y-2"
        >
          {LEGAL_VIEWS.map((view) => (
            <a key={view} href={legalHash(view)} className="transition-colors hover:text-steel-300">
              {LEGAL_SHORT_LABELS[view]}
            </a>
          ))}
        </nav>
      </div>
    </footer>
  );
}
