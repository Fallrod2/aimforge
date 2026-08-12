/**
 * Quelles sous-vues de Perfs restent montées (V5-A, revue — finding 2).
 *
 * La règle : **une sous-vue visitée ne redescend jamais**. Elle se cache, elle
 * ne se démonte pas. Deux états qui coûtent cher à perdre l'imposent, et
 * aucun des deux n'est visible dans le rendu :
 *
 * 1. la **saisie** du tracker n'est pas persistée (choix assumé,
 *    `tracker/draft.ts`) : la démonter pour aller regarder une courbe jetterait
 *    dix-huit scores tapés à la main ;
 * 2. l'**historique** porte la fenêtre d'annulation de cinq secondes d'une
 *    suppression (`components/useConfirm.ts`). Le démonter fait partir l'appel
 *    au serveur immédiatement — c'est ce que `usePendingUndo` doit faire, un
 *    geste confirmé ne s'évapore pas —, et le toast « Annuler » disparaît avec
 *    lui. Autrement dit : supprimer une passe puis toucher l'onglet « Saisie »
 *    fermait la fenêtre d'annulation sans rien dire, à un clic du toast.
 *
 * Ce module est pur pour que la règle se teste sans DOM. Elle est courte, mais
 * c'est une règle de **cycle de vie** : elle ne se relit pas dans le rendu, et
 * l'inverser ne casse aucun test d'affichage — seulement le produit.
 */

import type { PerfsTab } from "../route";

/** Les sous-vues déjà visitées depuis l'ouverture de l'écran. */
export type MountedTabs = Readonly<Record<PerfsTab, boolean>>;

/** À l'ouverture : rien de visité. */
export const NOTHING_MOUNTED: MountedTabs = { saisie: false, historique: false };

/**
 * Marque `tab` comme visitée. **Monotone** : cette fonction n'a aucun chemin qui
 * fasse repasser une sous-vue à `false`, et c'est toute la garantie.
 */
export function visit(state: MountedTabs, tab: PerfsTab): MountedTabs {
  return state[tab] ? state : { ...state, [tab]: true };
}

/** `tab` doit-elle être dans l'arbre (visible ou cachée) ? */
export function isMounted(state: MountedTabs, tab: PerfsTab): boolean {
  return state[tab];
}
