/**
 * Ce que la vue Coach doit faire du debrief qu'on lui a désigné (SPEC
 * §5 sexies).
 *
 * Le dashboard génère un debrief depuis un match (« Débriefer »), dépose son
 * identifiant dans la boîte à lettres (`./prefill`) puis navigue vers `#/coach`.
 * Depuis que l'onglet Coach est **le fil**, la question n'est plus « quel
 * debrief déplier dans une liste » mais « où est-il ? » — et il y a deux
 * réponses possibles :
 *
 * - **il est dans le fil**, parce que la fonction y a posé sa carte au moment
 *   de la génération (`thread: true`). C'est le cas normal : on déplie la carte
 *   et on y amène l'écran ;
 * - **il n'y est pas** : debrief antérieur au fil, carte dont la pose a échoué,
 *   ou fil effacé depuis. Le navigateur ne peut plus l'y ajouter lui-même — la
 *   migration 0015 réserve les lignes du coach au serveur — et refaire poser la
 *   carte coûterait une génération, donc un quota, pour un debrief qui existe
 *   déjà. On ouvre alors l'historique sur ce debrief, qui est l'endroit où tous
 *   les debriefs sont, sans exception.
 *
 * Module **pur** : il ne connaît ni React, ni Supabase, ni le DOM. C'est
 * l'unique raison pour laquelle cette décision — la seule du pont qui puisse se
 * tromper — est testable sans monter la vue.
 */

import type { ThreadMessage } from "../../shared/coach-thread-contract";

export type DebriefFocusPlan =
  /** La carte est dans le fil : on la déplie et on la montre. */
  | { readonly kind: "card"; readonly debriefId: number; readonly messageId: number }
  /** Pas de carte : l'historique est le repli, ouvert sur ce debrief. */
  | { readonly kind: "history"; readonly debriefId: number }
  /** Rien n'était désigné : l'écran ne bouge pas. */
  | { readonly kind: "none" };

const NOTHING: DebriefFocusPlan = { kind: "none" };

/**
 * Où amener l'utilisateur pour le debrief `focusedId`.
 *
 * La carte retenue est la **première** qui référence ce debrief. Il ne peut pas
 * y en avoir deux — la fonction pose la carte au moment où elle crée le
 * debrief, donc sur un identifiant qui n'existait pas encore — mais prendre la
 * première plutôt que « la seule » évite d'avoir à croire cette garantie sur
 * parole depuis l'écran : deux cartes ne feraient pas hésiter l'affichage.
 *
 * @param messages Le fil tel qu'il vient d'être chargé, du plus ancien au plus
 *   récent.
 * @param focusedId Le debrief relevé dans la boîte à lettres, ou `null`.
 */
export function planDebriefFocus(
  messages: readonly ThreadMessage[],
  focusedId: number | null,
): DebriefFocusPlan {
  if (focusedId === null) return NOTHING;

  const card = messages.find((message) => message.debriefId === focusedId);

  if (card === undefined) return { kind: "history", debriefId: focusedId };
  return { kind: "card", debriefId: focusedId, messageId: card.id };
}

/**
 * Le fil, une fois les messages d'un nouveau tour ajoutés — sans jamais poser
 * deux fois la même ligne.
 *
 * La garde n'est pas théorique : la carte arrive par deux chemins qui peuvent
 * se croiser. Elle est écrite par la fonction au moment de la génération, et
 * l'écran l'ajoute à son état ; mais un rechargement du fil (retour sur
 * l'onglet, reprise après erreur) la ramène elle aussi. Dédupliquer sur `id` —
 * l'identifiant de la base, pas une clé fabriquée — est la seule façon de ne
 * pas afficher deux fois un message qui n'a été dit qu'une fois.
 */
export function appendMessages(
  current: readonly ThreadMessage[],
  added: readonly ThreadMessage[],
): readonly ThreadMessage[] {
  const known = new Set(current.map((message) => message.id));
  const fresh = added.filter((message) => !known.has(message.id));

  if (fresh.length === 0) return current;
  return [...current, ...fresh];
}
