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
 * La détection repose sur un fait du benchmark Voltaic S5, verrouillé par
 * `scenarios.test.ts` : les 54 scénarios (3 paliers × 18) commencent tous par
 * « VT ». Le marqueur `VT` est donc l'endroit exact où une citation commence —
 * on n'a pas à deviner où elle finit, il suffit de vérifier qu'un nom autorisé
 * commence bien là.
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
