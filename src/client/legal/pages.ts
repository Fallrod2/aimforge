/**
 * Le registre des pages légales, chargées **à la demande**.
 *
 * Ces trois documents sont longs, denses, et ouverts une fois dans la vie d'un
 * compte : les embarquer dans le bundle initial ferait payer à chaque
 * chargement de l'application un texte que presque personne n'affiche. `lazy`
 * les sort du chemin critique ; le pied de page, lui, ne coûte que ses liens.
 *
 * Un registre plutôt que trois `lazy` dispersés dans `App.tsx` : le routeur
 * connaît `LegalViewId`, et l'exhaustivité du `Record` fait qu'un quatrième
 * document ajouté au type ne compilera pas tant qu'il n'a pas sa page.
 *
 * Les composants sont des exports nommés et `lazy` attend un export par
 * défaut : la conversion se fait ici, comme pour `MatchView` et `AdminView`
 * dans `App.tsx`, plutôt qu'en ajoutant à chaque module un `export default`
 * qui n'aurait de sens que pour ce chargeur.
 */

import { type ComponentType, type LazyExoticComponent, lazy } from "react";
import type { LegalViewId } from "../route";

export const LEGAL_PAGES: Readonly<Record<LegalViewId, LazyExoticComponent<ComponentType>>> = {
  privacy: lazy(async () => ({ default: (await import("./PrivacyView")).PrivacyView })),
  terms: lazy(async () => ({ default: (await import("./TermsView")).TermsView })),
  legal: lazy(async () => ({ default: (await import("./LegalNoticeView")).LegalNoticeView })),
};
