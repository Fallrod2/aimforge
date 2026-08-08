/**
 * Lecture des jetons de couleur du thème depuis le CSS.
 *
 * Recharts veut des couleurs concrètes (attributs SVG : `var()` n'y est pas
 * résolu). Plutôt que de recopier les valeurs de `index.css`, on les relit sur
 * `:root`. Les valeurs de repli ne servent que si le CSS n'est pas encore là.
 */

export type ThemeToken =
  | "steel-950"
  | "steel-900"
  | "steel-800"
  | "steel-700"
  | "steel-400"
  | "steel-200"
  | "ember-600"
  | "ember-500"
  | "quench-500";

const FALLBACKS: Record<ThemeToken, string> = {
  "steel-950": "#0b0d10",
  "steel-900": "#12151a",
  "steel-800": "#1b2027",
  "steel-700": "#2a313b",
  "steel-400": "#7c8898",
  "steel-200": "#c8cfd9",
  "ember-600": "#c9550f",
  "ember-500": "#f2711c",
  "quench-500": "#4595c9",
};

/** La valeur du jeton `--color-<token>`, ou son repli. */
export function themeColor(token: ThemeToken): string {
  if (typeof window === "undefined") return FALLBACKS[token];

  const value = getComputedStyle(document.documentElement)
    .getPropertyValue(`--color-${token}`)
    .trim();

  return value === "" ? FALLBACKS[token] : value;
}
