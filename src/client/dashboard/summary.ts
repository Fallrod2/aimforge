/**
 * Dérivations affichées par le dashboard. Module pur : il ne calcule aucune
 * énergie (c'est le rôle de `src/lib/energy/`), il ne fait que choisir et
 * trier ce qui vaut la peine d'être montré.
 */

export interface DatedRun {
  readonly id: number;
  readonly date: string;
}

export interface SubcategoryEnergy {
  readonly name: string;
  readonly energy: number;
}

/**
 * La passe la plus récente, ou `null` s'il n'y en a aucune.
 *
 * L'ordre de la liste n'est pas supposé : on relit les dates. À dates égales,
 * l'identifiant le plus grand gagne — c'est la dernière enregistrée.
 */
export function latestRun<T extends DatedRun>(runs: readonly T[]): T | null {
  let best: T | null = null;
  let bestTime = Number.NEGATIVE_INFINITY;

  for (const run of runs) {
    const time = Date.parse(run.date);

    if (Number.isNaN(time)) continue;
    if (best === null || time > bestTime || (time === bestTime && run.id > best.id)) {
      best = run;
      bestTime = time;
    }
  }
  return best;
}

/**
 * Les sous-catégories les plus faibles, de la plus basse à la moins basse.
 *
 * Les sous-catégories à zéro (aucun score saisi sur une passe partielle) sont
 * conservées : sur le bench Voltaic, une sous-catégorie non jouée pèse
 * exactement autant qu'une sous-catégorie ratée dans l'overall harmonique.
 * À énergie égale, l'ordre alphabétique tranche pour que l'affichage soit stable.
 */
export function weakestSubcategories(
  subcategories: readonly SubcategoryEnergy[],
  count = 3,
): readonly SubcategoryEnergy[] {
  return [...subcategories]
    .sort((a, b) => a.energy - b.energy || a.name.localeCompare(b.name, "fr"))
    .slice(0, Math.max(0, count));
}
