/**
 * Les **citations chiffrées** d'une routine : leur forme, leur vérification
 * contre les vraies données, et leur retrait du texte affiché (SPEC §5 sexies,
 * V5).
 *
 * Module **pur** : aucune dépendance au réseau, à Supabase ou au SDK d'un
 * fournisseur. C'est la même raison que pour la police de scénarios
 * (`../shared/scenarios.ts`) — le cas qui compte (« le modèle a inventé un
 * chiffre ») ne se provoque pas sur un vrai modèle, il se prouve en fixture.
 *
 * ## Pourquoi
 *
 * Une routine « ancrée dans les données » qui affirme « ton HS% est bas » sans
 * que personne n'ait vérifié le HS% n'est pas ancrée : c'est une routine qui a
 * l'air ancrée. Le prompt exige donc que chaque recommandation s'appuie sur une
 * donnée **citée entre marqueurs**, et ce module relit chaque marqueur contre la
 * valeur que le serveur, lui, connaît. Une citation inventée est traitée comme
 * un scénario inventé : relance corrective nominative, puis échec — jamais
 * affichée.
 *
 * ## La forme retenue : `[clé valeur]`
 *
 * Sobre, tapable par un modèle sans échappement, et sans ambiguïté de lecture :
 * dans `[Map Icebox 25]`, la **valeur est le dernier mot** (un nombre), la clé
 * est tout ce qui précède. C'est ce qui permet des clés à espaces (« Map
 * Icebox ») sans introduire de séparateur exotique que le modèle oublierait.
 *
 * Trois conséquences assumées :
 *
 * - un marqueur sans clé (`[23]`) n'est pas une citation — il ne sera ni
 *   vérifié ni retiré. Le prompt ne demande jamais cette forme, et la traiter
 *   demanderait de deviner de quelle donnée il s'agit ;
 * - la virgule décimale est acceptée (`[KD 0,9]`) : un modèle qui écrit en
 *   français l'écrira ainsi une fois sur deux ;
 * - la comparaison de clé est insensible à la casse et aux espaces multiples.
 *   Le reste doit être copié tel quel — la liste des clés est donnée au modèle.
 *
 * ## La tolérance d'arrondi : ±0,5
 *
 * Les valeurs sont montrées au modèle arrondies à une décimale (`23`, `0.9`,
 * `401.4`). Un modèle qui recopie « 401 » là où la donnée dit « 401,4 » n'a rien
 * inventé : il a arrondi. Refuser cela dépenserait une relance — donc de la
 * latence et des jetons — pour un écart que le joueur ne verrait pas. Au-delà de
 * 0,5, en revanche, le chiffre affirmé n'est plus le chiffre mesuré : c'est
 * exactement ce qu'on refuse. La borne est **stricte** (`> 0.5` échoue) pour que
 * le cas limite reste du bon côté.
 */

import type { RoutineSource } from "../../shared/routine-contract.js";

/** Écart maximal toléré entre la valeur citée et la valeur vraie. */
export const CITATION_TOLERANCE = 0.5;

/**
 * Une donnée que le modèle a le droit de citer.
 *
 * `key` est ce qui s'écrit entre crochets, `value` la valeur vraie contre
 * laquelle on compare, `label` et `display` ce que la puce « source » affichera
 * une fois le marqueur retiré du texte.
 */
export interface CitableFact {
  readonly key: string;
  readonly value: number;
  readonly label: string;
  readonly display: string;
}

/** Une citation trouvée dans un texte. */
export interface Citation {
  /** Le marqueur entier, tel qu'il apparaît (pour le message de relance). */
  readonly raw: string;
  readonly key: string;
  readonly value: number;
}

export type CitationCheck =
  | { readonly ok: true; readonly sources: readonly RoutineSource[] }
  /** `reason` part dans la relance corrective : il nomme les fautives. */
  | { readonly ok: false; readonly reason: string };

/**
 * Le marqueur : crochet ouvrant, une clé sans crochet ni retour à la ligne, un
 * nombre, crochet fermant. La clé est paresseuse pour que le nombre parte du
 * **dernier** groupe de chiffres et non du premier.
 */
const CITATION = /\[\s*([^[\]\n]*?)\s+(-?\d+(?:[.,]\d+)?)\s*\]/gu;

/** Deux clés se comparent sans casse ni espaces superflus, et rien de plus. */
export function normalizeCitationKey(key: string): string {
  return key.trim().replace(/\s+/gu, " ").toLowerCase();
}

/**
 * Nettoie une clé destinée au registre : ni crochet (qui casserait le
 * marqueur), ni retour à la ligne, ni espaces multiples.
 *
 * Les clés viennent en partie de données externes (un nom de map rendu par
 * HenrikDev). On les met en forme plutôt que de faire confiance à la source.
 */
export function sanitizeCitationKey(key: string): string {
  return key
    .replace(/[[\]\n]/gu, " ")
    .replace(/\s+/gu, " ")
    .trim();
}

/** Les citations d'un texte, dans l'ordre de lecture. */
export function parseCitations(text: string): readonly Citation[] {
  const found: Citation[] = [];

  // `matchAll` plutôt qu'un `exec` en boucle : le drapeau `g` porte un
  // `lastIndex` qu'une regex de module partagerait entre deux appels.
  for (const match of text.matchAll(CITATION)) {
    const key = match[1] ?? "";
    const raw = match[2] ?? "";
    const value = Number(raw.replace(",", "."));

    if (key === "" || Number.isNaN(value)) continue;
    found.push({ raw: match[0], key, value });
  }
  return found;
}

/**
 * Retire les marqueurs d'un texte et recolle proprement ce qui reste.
 *
 * Le retrait laisse des doubles espaces et des espaces avant ponctuation (« ton
 * HS% [HS% 23] , ») : on les répare ici plutôt que de compter sur le modèle pour
 * placer ses marqueurs au millimètre.
 */
export function stripCitations(text: string): string {
  return (
    text
      .replaceAll(CITATION, "")
      // Les parenthèses vides d'abord : leur retrait laisse à son tour un espace
      // à recoller, alors que l'inverse n'est pas vrai.
      .replace(/\(\s*\)/gu, "")
      .replace(/[ \t]{2,}/gu, " ")
      .replace(/[ \t]+([,;:.!?…])/gu, "$1")
      .trim()
  );
}

function describe(fact: CitableFact): RoutineSource {
  return { label: fact.label, value: fact.display };
}

/**
 * Vérifie toutes les citations d'un ensemble de textes contre le registre des
 * données citables.
 *
 * Trois refus, et un seul message qui les rassemble — le modèle corrige mieux
 * une liste complète qu'une faute à la fois :
 *
 * 1. **clé inconnue** — le modèle a nommé une donnée qui n'existe pas dans le
 *    contexte. C'est le cas le plus grave : il a inventé la mesure elle-même ;
 * 2. **valeur fausse** — la clé existe, le chiffre non (au-delà de la tolérance) ;
 * 3. **aucune citation** — alors qu'il y avait des données à citer. Une routine
 *    sans une seule donnée citée n'est pas ancrée, et c'est tout l'objet de V5.
 *    Quand le registre est vide (aucun bench, aucun match), il n'y a rien à
 *    exiger : la routine passe telle quelle.
 */
export function verifyCitations(
  texts: readonly string[],
  facts: readonly CitableFact[],
): CitationCheck {
  const registry = new Map(facts.map((fact) => [normalizeCitationKey(fact.key), fact]));
  const unknown: string[] = [];
  const wrong: string[] = [];
  const sources: RoutineSource[] = [];
  const seen = new Set<string>();

  for (const text of texts) {
    for (const citation of parseCitations(text)) {
      const fact = registry.get(normalizeCitationKey(citation.key));

      if (fact === undefined) {
        if (!unknown.includes(citation.raw)) unknown.push(citation.raw);
        continue;
      }
      if (Math.abs(citation.value - fact.value) > CITATION_TOLERANCE) {
        const detail = `${citation.raw} (valeur réelle : ${fact.display})`;

        if (!wrong.includes(detail)) wrong.push(detail);
        continue;
      }
      if (seen.has(fact.key)) continue;
      seen.add(fact.key);
      sources.push(describe(fact));
    }
  }

  const problems: string[] = [];

  if (unknown.length > 0) {
    problems.push(`ces citations ne correspondent à aucune donnée fournie : ${unknown.join(", ")}`);
  }
  if (wrong.length > 0) {
    problems.push(`ces citations annoncent un chiffre faux : ${wrong.join(", ")}`);
  }
  if (problems.length > 0) return { ok: false, reason: problems.join(" ; ") };

  if (sources.length === 0 && facts.length > 0) {
    return {
      ok: false,
      reason:
        "aucune recommandation n'est appuyée par une donnée citée entre crochets, alors que des données étaient fournies",
    };
  }
  return { ok: true, sources };
}
