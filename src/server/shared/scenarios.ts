/**
 * Le catalogue des scénarios KovaaK's d'un palier, et la police qui va avec.
 *
 * Module **pur** : il ne connaît que `src/lib/energy/` (donc
 * `voltaic-s5-data.json`, la source de vérité). Il sert deux fois, et c'est
 * volontairement le même module aux deux bouts :
 *
 * 1. **avant** l'appel — la liste est donnée au modèle, qui n'a le droit de
 *    citer que ces noms ;
 * 2. **après** l'appel — la sortie est relue, et toute mention d'un scénario
 *    inventé (ou d'un scénario d'un autre palier) déclenche la relance
 *    corrective. Un joueur qui tape « VT Pasu Master » dans KovaaK's ne trouve
 *    rien : une routine qui cite un scénario inexistant n'est pas une routine.
 *
 * Il vit dans `src/server/shared/` et non plus chez la routine parce que les
 * **deux** fonctionnalités qui parlent de scénarios en ont besoin : la routine
 * les prescrit, le coach les recommande dans ses axes. Une génération réelle du
 * coach a proposé « Close Range Strafe Tracking », « PraFlick » et « Reactive
 * Tracking » — trois noms qui n'existent nulle part. Un seul catalogue, une
 * seule police : deux copies auraient dérivé.
 *
 * La détection repose sur un fait du benchmark Voltaic S5, verrouillé par
 * `scenarios.test.ts` : les 54 scénarios (3 paliers × 18) commencent tous par
 * « VT ». Le marqueur `VT` est donc l'endroit exact où une citation commence —
 * on n'a pas à deviner où elle finit, il suffit de vérifier qu'un nom autorisé
 * commence bien là.
 *
 * **La limite de cette police, dite honnêtement** : elle ne voit que ce qui est
 * annoncé comme un scénario Voltaic. Une invention **sans préfixe VT** —
 * « PraFlick », « Close Range Strafe Tracking », « scénarios d'éco avec des
 * armes faibles », toutes relevées dans une vraie génération — passe au travers,
 * et aucune heuristique raisonnable ne l'attraperait : rien ne distingue
 * mécaniquement un faux nom de scénario d'un exercice décrit en français, qui
 * est justement ce qu'on veut autoriser (« échauffement libre », « deathmatch »).
 * Ce qui combat ces inventions-là, c'est le prompt : la liste exacte est donnée
 * au modèle, et la consigne lui dit de se rabattre sur le nom de la
 * sous-catégorie plutôt que d'inventer. La police, elle, garantit le cas
 * détectable — et `unknownScenarioMentions` a un test qui documente ce trou.
 */

import { listSubcategories, type TierId } from "../../lib/energy/index.js";

/** Les scénarios d'une sous-catégorie, tels qu'on les montre au modèle. */
export interface ScenarioGroup {
  readonly subcategory: string;
  readonly scenarios: readonly string[];
}

export interface ScenarioCatalog {
  /** Les 18 noms exacts du palier, dans l'ordre du tableur Voltaic. */
  readonly names: readonly string[];
  /** Les mêmes, groupés par sous-catégorie — c'est ce qui parle au modèle. */
  readonly groups: readonly ScenarioGroup[];
}

/** Le catalogue d'un palier. */
export function scenarioCatalog(tier: TierId): ScenarioCatalog {
  const groups = listSubcategories(tier).map((subcategory) => ({
    subcategory: subcategory.name,
    scenarios: subcategory.scenarios.map((scenario) => scenario.name),
  }));

  return { names: groups.flatMap((group) => group.scenarios), groups };
}

/**
 * Les noms autorisés d'un catalogue déjà groupé.
 *
 * Ce qui est montré au modèle, ce sont les **groupes** : c'est eux que le
 * contexte transporte. Redemander un catalogue au palier pour obtenir la liste
 * de contrôle ouvrirait la seule faille qui compte ici — une liste montrée et
 * une liste appliquée qui ne seraient pas la même. On dérive donc la seconde de
 * la première.
 */
export function scenarioNames(groups: readonly ScenarioGroup[]): readonly string[] {
  return groups.flatMap((group) => group.scenarios);
}

/**
 * Le marqueur d'une citation de scénario.
 *
 * Insensible à la casse : « vt pasu novice » n'est pas un nom valide, et on
 * préfère le signaler au modèle plutôt que de le laisser passer inaperçu parce
 * que la casse ne correspondait pas.
 */
const MARKER = /\bVT\b/giu;

/** Longueur de l'extrait remonté au modèle pour qu'il sache quoi corriger. */
const EXCERPT_LENGTH = 60;

/** Ce qui suit le marqueur, coupé à la première ponctuation ou fin de ligne. */
function excerptAt(text: string, start: number): string {
  const tail = text.slice(start, start + EXCERPT_LENGTH);
  const cut = tail.search(/[\n,;.!?)\]]/u);

  return (cut === -1 ? tail : tail.slice(0, cut)).trim();
}

/**
 * Les scénarios cités qui ne figurent pas dans la liste autorisée.
 *
 * Chaque occurrence du marqueur doit être **le début exact** d'un nom autorisé.
 * « VT Pasu Novice » passe ; « VT Pasu Intermediate » sur un palier Novice ne
 * passe pas (aucun nom autorisé ne commence là), ce qui est précisément le but :
 * la routine doit rester dans le palier mesuré du joueur.
 *
 * Le résultat est dédupliqué et ordonné par première apparition : c'est un
 * message destiné au modèle, pas une trace d'audit.
 */
export function unknownScenarioMentions(
  text: string,
  allowed: readonly string[],
): readonly string[] {
  const unknown: string[] = [];
  const seen = new Set<string>();

  // `matchAll` plutôt qu'un `exec` en boucle : le drapeau `g` porte un état
  // (`lastIndex`) qu'une regex de module partagerait entre deux appels.
  for (const match of text.matchAll(MARKER)) {
    const start = match.index;

    if (allowed.some((name) => text.startsWith(name, start))) continue;

    const excerpt = excerptAt(text, start);

    if (excerpt === "" || seen.has(excerpt)) continue;
    seen.add(excerpt);
    unknown.push(excerpt);
  }
  return unknown;
}

/**
 * Les scénarios inconnus cités par un ensemble de textes.
 *
 * Un scénario peut être cité n'importe où — le titre d'un bloc de routine, le
 * détail d'un axe de debrief, le conseil final. L'appelant rend **tous** ses
 * textes, on les relit tous plutôt que de parier sur l'endroit où le modèle a
 * rangé le nom. Résultat dédupliqué et ordonné par première apparition : c'est
 * un message destiné au modèle, pas une trace d'audit.
 */
export function unknownScenariosInTexts(
  texts: readonly string[],
  allowed: readonly string[],
): readonly string[] {
  const unknown: string[] = [];
  const seen = new Set<string>();

  for (const text of texts) {
    for (const mention of unknownScenarioMentions(text, allowed)) {
      if (seen.has(mention)) continue;
      seen.add(mention);
      unknown.push(mention);
    }
  }
  return unknown;
}

/** Nombre de scénarios fautifs nommés dans la relance ; au-delà, c'est du bruit. */
const MAX_NAMED = 4;

/**
 * La raison du refus, rédigée **pour le modèle** : elle nomme les fautifs et
 * rappelle où est la liste. Le coach et la routine ont le même besoin et le
 * même bloc `<scenarios_autorises>` — un seul texte, donc, plutôt que deux qui
 * dériveraient.
 */
export function unknownScenarioReason(unknown: readonly string[]): string {
  const named = unknown
    .slice(0, MAX_NAMED)
    .map((name) => `« ${name} »`)
    .join(", ");

  return `ces scénarios n'existent pas dans le palier du joueur : ${named} — n'utilise que les noms de <scenarios_autorises>, copiés au mot près`;
}
