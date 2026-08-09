/**
 * Les classes des contrôles de formulaire, à un seul endroit.
 *
 * Elles vivaient dans `AiSettingsPanel` tant qu'un seul écran en avait besoin.
 * Le panneau d'administration (SPEC §5 quater) pose exactement les mêmes
 * gestes — choisir un fournisseur, coller une clé qu'on ne relira pas,
 * enregistrer — et deux copies de ces chaînes divergeraient à la première
 * retouche, sur l'écran que personne ne regarde.
 */

export const CONTROL_CLASSES =
  "w-full rounded-md border border-steel-700 bg-steel-800 px-3 py-2.5 text-sm text-steel-100 transition-colors placeholder:text-steel-600 hover:border-steel-600 focus:border-ember-500 focus:outline-none disabled:opacity-60";

export const PRIMARY_BUTTON =
  "rounded-lg bg-ember-500 px-4 py-2.5 text-sm font-semibold text-steel-950 transition-colors hover:bg-ember-400 disabled:cursor-not-allowed disabled:bg-steel-800 disabled:text-steel-500";

export const GHOST_BUTTON =
  "inline-flex min-h-10 items-center rounded-lg border border-steel-700 px-3 py-2 text-xs font-medium text-steel-300 transition-colors hover:border-steel-600 hover:text-steel-100 disabled:cursor-not-allowed disabled:text-steel-600";
