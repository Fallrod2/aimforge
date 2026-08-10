/**
 * Mise en forme des chiffres Valorant (français). Module pur, aucune règle
 * métier : les valeurs arrivent déjà calculées par `api/valorant/stats`.
 *
 * Une seule règle, tenue partout : **`null` se dit « — », jamais « 0 »**. Le
 * contrat distingue « aucun ADR connu » de « 0 de dégâts par round » (voir
 * `src/shared/valorant-contract.ts`), et l'écran doit tenir cette distinction —
 * sinon un compte fraîchement lié affiche une performance catastrophique au
 * lieu d'une absence de données.
 */

import type { TrendPoint } from "../data";

/** Ce qu'on affiche à la place d'une valeur inconnue. */
export const UNKNOWN = "—";

const oneDecimal = new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 1 });

const twoDecimals = new Intl.NumberFormat("fr-FR", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

const integer = new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 0 });

/** Un pourcentage (winrate, HS%) : « 24,3 % ». */
export function formatPercent(value: number | null): string {
  return value === null ? UNKNOWN : `${oneDecimal.format(value)} %`;
}

/** Un ADR : « 152 ». Les dégâts par round n'ont pas besoin de décimale. */
export function formatAdr(value: number | null): string {
  return value === null ? UNKNOWN : integer.format(value);
}

/** Un ratio K/D : deux décimales, comme partout où l'on compare des ratios. */
export function formatRatio(value: number | null): string {
  return value === null ? UNKNOWN : twoDecimals.format(value);
}

/** Un compte : « 12 ». */
export function formatCount(value: number): string {
  return integer.format(value);
}

/** Le verdict d'une partie, en français d'affichage. */
export const RESULT_LABELS: Readonly<Record<NonNullable<TrendPoint["result"]>, string>> = {
  victoire: "Victoire",
  defaite: "Défaite",
  egalite: "Égalité",
};

/** Le verdict, ou « Résultat inconnu » — pas « Égalité » par défaut. */
export function resultLabel(result: TrendPoint["result"]): string {
  return result === null ? "Résultat inconnu" : RESULT_LABELS[result];
}
