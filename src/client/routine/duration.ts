/**
 * La durée demandée : du champ de saisie à un entier de minutes valide.
 *
 * Module **pur**, séparé du composant pour être testable sans DOM. Il porte la
 * seule règle non triviale du formulaire : ce que le joueur tape en saisie
 * libre n'est pas un nombre, c'est une chaîne — vide, décimale, négative, avec
 * un « min » à la fin, écrite à la virgule française. Le refus doit être une
 * phrase, pas un `NaN` qui remonte jusqu'à la fonction serverless.
 *
 * Les bornes viennent du contrat partagé : la fonction refuse exactement ce que
 * ce module refuse, donc le formulaire ne peut pas promettre ce que l'API
 * rejettera.
 */

import {
  MAX_DUREE_MINUTES,
  MAX_FOCUS_LENGTH,
  MIN_DUREE_MINUTES,
} from "../../shared/routine-contract";

export type DurationParse =
  | { readonly ok: true; readonly minutes: number }
  /** `message` est affiché tel quel sous le champ. */
  | { readonly ok: false; readonly message: string };

const RANGE = `Durée attendue entre ${MIN_DUREE_MINUTES} et ${MAX_DUREE_MINUTES} minutes.`;

/**
 * Lit une durée saisie librement.
 *
 * La virgule est acceptée comme séparateur décimal (clavier français), et le
 * suffixe « min » est toléré — pour être aussitôt refusé s'il reste des
 * décimales : une séance ne se planifie pas à la demi-minute, et arrondir en
 * silence donnerait au joueur une durée qu'il n'a pas demandée.
 */
export function parseDuration(raw: string): DurationParse {
  const cleaned = raw
    .trim()
    .replace(",", ".")
    .replace(/\s*min(utes?)?$/iu, "")
    .trim();

  if (cleaned === "") return { ok: false, message: "Indique une durée." };

  const value = Number(cleaned);

  if (!Number.isFinite(value)) {
    return { ok: false, message: "Durée illisible : indique un nombre de minutes." };
  }
  if (!Number.isInteger(value)) {
    return { ok: false, message: "Durée en minutes entières." };
  }
  if (value < MIN_DUREE_MINUTES || value > MAX_DUREE_MINUTES) {
    return { ok: false, message: RANGE };
  }
  return { ok: true, minutes: value };
}

/** Le focus prêt pour l'API : `null` quand il est vide. */
export function normalizeFocus(raw: string): string | null {
  const trimmed = raw.trim();

  return trimmed === "" ? null : trimmed.slice(0, MAX_FOCUS_LENGTH);
}

/** Une durée en minutes rendue lisible (« 1 h 30 », « 45 min »). */
export function formatDuration(minutes: number): string {
  if (minutes < 60) return `${minutes} min`;

  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;

  return rest === 0 ? `${hours} h` : `${hours} h ${String(rest).padStart(2, "0")}`;
}
