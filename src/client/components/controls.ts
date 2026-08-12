/**
 * Les classes des contrôles de formulaire, à un seul endroit.
 *
 * Elles vivaient dans `AiSettingsPanel` tant qu'un seul écran en avait besoin.
 * Le panneau d'administration (SPEC §5 quater) pose exactement les mêmes
 * gestes — choisir un fournisseur, coller une clé qu'on ne relira pas,
 * enregistrer — et deux copies de ces chaînes divergeraient à la première
 * retouche, sur l'écran que personne ne regarde.
 *
 * `PRIMARY_BUTTON` est **le** bouton plein de l'application (V5-A §5.2). Il n'y
 * en a qu'un seul style : `brand-fill` (#b4520a) et du **blanc pur**, 5,06:1.
 * L'ancien couple — braise vive et encre presque noire — passait AA lui aussi
 * (6,63:1), et ce n'est donc pas le contraste qui l'a fait disparaître : c'est
 * qu'il coexistait avec l'autre. Deux boutons pleins de couleurs différentes
 * pour la même intention, sur deux écrans voisins, ne se lisent pas comme un
 * choix — ils se lisent comme un oubli.
 *
 * La règle qui va avec le jeton : `brand-fill` ne porte **jamais** `steel-100`
 * (4,12:1). Elle est tenue par `contrast.test.ts`, dans les deux sens.
 */

export const CONTROL_CLASSES =
  "w-full rounded-md border border-steel-700 bg-steel-800 px-3 py-2.5 text-sm text-steel-100 transition-colors placeholder:text-steel-400 hover:border-steel-600 focus:border-ember-500 disabled:opacity-60";

export const PRIMARY_BUTTON =
  "rounded-lg bg-brand-fill px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-brand-fill-hover disabled:cursor-not-allowed disabled:bg-steel-800 disabled:text-steel-500";

export const GHOST_BUTTON =
  "inline-flex min-h-10 items-center rounded-lg border border-steel-700 px-3 py-2 text-xs font-medium text-steel-300 transition-colors hover:border-steel-600 hover:text-steel-100 disabled:cursor-not-allowed disabled:text-steel-500";
