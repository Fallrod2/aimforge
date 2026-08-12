/**
 * L'écart d'une passe avec la **précédente**, pour l'accueil et l'historique
 * (SPEC V4-A §4.4). Module pur : aucun React, aucun accès réseau.
 *
 * Un overall nu ne dit pas si on progresse. « 447,36 » est une position, pas un
 * mouvement — et c'est le mouvement qui décide si la semaine a servi à quelque
 * chose. D'où l'écart chiffré et fléché, à côté du chiffre.
 *
 * Ce qui définit « la passe précédente » n'est pas négociable : **le même
 * palier et le même benchmark**. Deux énergies de paliers différents ne se
 * soustraient pas (500 en Novice n'est pas 500 en Advanced), deux benchmarks
 * n'ont pas les mêmes seuils (DECISIONS.md D2) : un écart entre eux serait un
 * nombre sans référent. C'est le même cadrage que l'historique, appliqué à la
 * comparaison plutôt qu'à la liste.
 *
 * Et sur une première passe, on n'affiche **rien**. Comparer à zéro afficherait
 * « ▲ +447,36 » à quelqu'un qui vient de faire son premier bench : un progrès
 * inventé, à partir d'une passe qui n'existe pas.
 */

import type { BenchmarkId, TierId } from "../lib/energy";

/** Ce qu'il faut d'une passe pour la situer dans le temps et la comparer. */
export interface ComparableRun {
  readonly id: number;
  /** Horodatage ISO 8601, tel que le rend `listBenchRuns`. */
  readonly date: string;
  readonly tier: TierId;
  readonly benchmarkId: BenchmarkId;
  readonly overall: number;
}

/** Une énergie de sous-catégorie, telle que la porte un détail de passe. */
export interface NamedEnergy {
  readonly name: string;
  readonly energy: number;
}

/** Un écart : sa valeur signée et le sens dans lequel l'afficher. */
export interface Delta {
  readonly value: number;
  readonly direction: "up" | "down" | "flat";
}

/** L'écart d'une sous-catégorie ; `null` quand il n'y a rien à comparer. */
export interface SubcategoryDelta {
  readonly name: string;
  readonly energy: number;
  readonly delta: Delta | null;
}

/**
 * En deçà de quoi un écart est dit « stable ».
 *
 * Les énergies s'affichent à deux décimales : un écart de 0,004 se rendrait
 * « +0,00 », c'est-à-dire une flèche sur rien. Le seuil est la moitié du
 * dernier chiffre affiché — ce qui s'arrondit à zéro est annoncé comme tel.
 */
const DELTA_EPSILON = 0.005;

/** Le rang temporel d'une passe : la date, puis l'identifiant à date égale. */
function isBefore(candidate: ComparableRun, reference: ComparableRun): boolean {
  const candidateTime = Date.parse(candidate.date);
  const referenceTime = Date.parse(reference.date);

  // Une date illisible ne se compare pas : la passe est écartée plutôt que
  // ramenée à l'origine des temps, où elle deviendrait « la plus ancienne ».
  if (Number.isNaN(candidateTime) || Number.isNaN(referenceTime)) return false;
  if (candidateTime !== referenceTime) return candidateTime < referenceTime;
  return candidate.id < reference.id;
}

/**
 * La passe qui précède immédiatement `current`, dans son palier et son
 * benchmark. `null` s'il n'y en a pas — c'est le cas « première passe ».
 *
 * L'ordre de `runs` n'est pas supposé : la liste est parcourue en entier. Elle
 * arrive triée de `listBenchRuns`, mais s'appuyer dessus ferait dépendre un
 * affichage d'un `order by` situé à deux modules de là.
 */
export function previousRun<T extends ComparableRun>(
  runs: readonly T[],
  current: ComparableRun,
): T | null {
  let best: T | null = null;

  for (const run of runs) {
    if (run.id === current.id) continue;
    if (run.tier !== current.tier || run.benchmarkId !== current.benchmarkId) continue;
    if (!isBefore(run, current)) continue;
    if (best === null || isBefore(best, run)) best = run;
  }
  return best;
}

/** L'écart entre deux valeurs, orienté pour l'affichage. */
export function deltaOf(current: number, previous: number): Delta {
  const value = current - previous;

  if (Math.abs(value) < DELTA_EPSILON) return { value, direction: "flat" };
  return { value, direction: value > 0 ? "up" : "down" };
}

/**
 * L'écart de chaque sous-catégorie de la passe courante, dans son ordre.
 *
 * Une énergie à 0 vaut « non jouée » des deux côtés (une sous-catégorie est le
 * max de ses deux scénarios, donc elle ne tombe à 0 que si aucun n'a de score).
 * On ne compare pas contre elle : « +420 » parce que la sous-catégorie était
 * absente de la passe précédente raconterait un progrès qui n'a pas eu lieu.
 */
export function subcategoryDeltas(
  current: readonly NamedEnergy[],
  previous: readonly NamedEnergy[],
): readonly SubcategoryDelta[] {
  const before = new Map(previous.map((entry) => [entry.name, entry.energy]));

  return current.map((entry) => {
    const past = before.get(entry.name);
    const comparable = past !== undefined && past > 0 && entry.energy > 0;

    return {
      name: entry.name,
      energy: entry.energy,
      delta: comparable ? deltaOf(entry.energy, past) : null,
    };
  });
}
