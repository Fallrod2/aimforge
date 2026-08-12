/**
 * Ce que les trois documents légaux ont en commun : leur titre, leur date de
 * mise à jour, et le libellé sous lequel le pied de page les propose.
 *
 * Module de données pures, séparé des composants : le pied de page (affiché
 * partout, y compris sur la landing) a besoin des libellés et des adresses,
 * pas du texte des documents — qui, lui, est chargé à la demande.
 */

import { type LegalViewId, routeHash, viewRoute } from "../route";

/**
 * La date affichée en tête de chaque document, en toutes lettres.
 *
 * Une constante partagée et non trois dates recopiées : les trois textes ont
 * été écrits ensemble et se relisent ensemble. Le jour où l'un d'eux change
 * seul, il prendra sa propre date — et cette constante deviendra un tableau.
 */
export const LEGAL_UPDATED_AT = "12 août 2026";

/** Le titre de chaque document, tel qu'il s'affiche en tête de page. */
export const LEGAL_TITLES: Readonly<Record<LegalViewId, string>> = {
  privacy: "Politique de confidentialité",
  terms: "Conditions générales d'utilisation",
  legal: "Mentions légales",
};

/** Le libellé court du pied de page — trois liens sur une ligne. */
export const LEGAL_SHORT_LABELS: Readonly<Record<LegalViewId, string>> = {
  privacy: "Confidentialité",
  terms: "CGU",
  legal: "Mentions légales",
};

/** L'adresse d'un document, prête à poser dans un `href`. */
export function legalHash(view: LegalViewId): string {
  return routeHash(viewRoute(view));
}

/**
 * L'adresse de contact de l'éditeur.
 *
 * Elle apparaît dans les trois documents (responsable de traitement, exercice
 * des droits, réclamation) : une constante évite qu'une correction n'en oublie
 * un.
 */
export const LEGAL_CONTACT_EMAIL = "alex.abriel3@gmail.com";

/** L'éditeur, tel qu'il se nomme dans les trois documents. */
export const LEGAL_PUBLISHER = "Alexandre Abriel";
