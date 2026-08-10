/**
 * L'état de la grille de saisie manuelle : dépliée ou non, **par palier**.
 * Module pur (aucun React).
 *
 * Par palier pour la même raison que la saisie (`draft.ts`) et que l'état
 * d'import (`import.ts`) : les trois paliers sont trois benchs distincts, et
 * depuis que l'import part tout seul (SPEC §5 sexies), deux pulls peuvent être
 * en vol en même temps — celui du palier qu'on vient de quitter et celui du
 * palier qu'on regarde.
 *
 * Un booléen unique laissait passer ceci : le pull du palier A part, on bascule
 * sur B, B arrive, on referme la grille de B à la main… puis A se résout enfin
 * et rouvre la grille — celle de B, la seule à l'écran. L'utilisateur voit son
 * geste annulé par un import dont il ne parle plus. Le palier visé par la
 * réponse est porté par la clé, donc une réponse en retard ne peut plus toucher
 * qu'à son propre palier.
 */

import type { TierId } from "../../lib/energy";
import type { ImportState } from "./import";

/** Les paliers dont la grille manuelle est dépliée. */
export type ManualTiers = Readonly<Partial<Record<TierId, true>>>;

/** Au départ, tout est replié : c'est l'import qui ouvre, ou l'utilisateur. */
export const NO_MANUAL: ManualTiers = {};

export function isManualOpen(manual: ManualTiers, tier: TierId): boolean {
  return manual[tier] === true;
}

/** Ouvre la grille d'un palier, sans toucher aux deux autres. */
export function openManual(manual: ManualTiers, tier: TierId): ManualTiers {
  return { ...manual, [tier]: true };
}

/** Bascule la grille d'un palier — le « saisir à la main » de l'écran. */
export function toggleManual(manual: ManualTiers, tier: TierId): ManualTiers {
  if (!isManualOpen(manual, tier)) return openManual(manual, tier);

  const next: Partial<Record<TierId, true>> = { ...manual };

  delete next[tier];
  return next;
}

/**
 * Un import terminé ouvre la saisie manuelle **de son palier**, qu'il ait
 * abouti ou échoué.
 *
 * Abouti, parce que l'utilisateur doit relire les 18 chiffres avant de
 * sauvegarder — c'est lui qui valide, pas l'API. Échoué, parce que la seule
 * chose qui lui reste à faire est de taper ses scores : lui laisser un écran
 * replié serait lui demander de trouver le bouton avant de pouvoir avancer.
 * Un import *en vol* n'ouvre rien : la grille arrive avec ses valeurs.
 */
export function opensManualGrid(state: ImportState): boolean {
  return state.status === "done" || state.status === "error";
}
