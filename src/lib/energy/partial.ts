/**
 * L'**énergie partielle** : une progression provisoire, affichée avant que le
 * bench soit complet (SPEC V4-A §4.1a).
 *
 * Pourquoi elle existe. L'overall est une moyenne harmonique et vaut 0 dès
 * qu'une sous-catégorie vaut 0 (règle métier auditée, `energy.ts`) : quelqu'un
 * qui a joué huit sous-catégories sur neuf lit donc « — · SANS RANG », exactement
 * comme quelqu'un qui n'a rien joué. C'est mathématiquement juste et
 * informativement nul. Cette fonction répond à l'autre question — « où j'en suis
 * sur ce que j'ai déjà joué ? » — sans toucher à la première.
 *
 * Ce qu'elle n'est pas, et ne doit jamais devenir :
 *
 * - ce n'est **pas** une modification d'`overallEnergy`. Le cœur mathématique
 *   n'a pas bougé : `overallEnergy` rend toujours 0 sur un bench incomplet, et
 *   c'est lui, et lui seul, qui est enregistré en base ;
 * - elle n'est **jamais persistée**. Aucune écriture ne la porte : elle se
 *   recalcule à l'écran, à partir des sous-catégories affichées ;
 * - elle est **toujours étiquetée partielle** à l'affichage, avec le nombre de
 *   sous-catégories comptées (« partiel sur 4/9 »). Un chiffre nu se lirait
 *   comme un overall ;
 * - **aucun rang n'en est dérivé.** Un rang répond de la performance sur le
 *   bench entier ; le déduire d'une moyenne sur quatre sous-catégories
 *   annoncerait un Diamond à quelqu'un qui n'a pas joué le Tracking.
 *
 * Définition mathématique. Soit `P = { e ∈ énergies | e > 0 }` (les
 * sous-catégories complètes, une sous-catégorie valant le max de ses deux
 * scénarios). L'énergie partielle est la **moyenne harmonique de P** :
 *
 *     partielle = |P| / Σ(1/e), e ∈ P
 *
 * `null` quand `P` est vide. Le choix de la moyenne harmonique n'est pas un
 * détail d'implémentation : c'est celle de l'overall, donc l'énergie partielle
 * d'un bench complet **est** son overall — la valeur affichée ne saute pas au
 * moment où la dernière sous-catégorie se remplit, elle se stabilise. C'est
 * aussi pourquoi elle vit ici, dans la lib, et non dans l'UI : elle est liée à
 * l'agrégation Voltaic (`VOLTAIC_ANCHORS`), et un benchmark qui agrégerait
 * autrement devra fournir la sienne plutôt que la voir recalculée à l'écran.
 * Elle n'entre pas dans `EnergyFormula` tant que ce second benchmark n'existe
 * pas : `overallEnergy` y exige les neuf sous-catégories, précisément parce
 * qu'un overall sur une partie du bench n'a pas de sens — et le point de cette
 * fonction est d'être *autre chose* qu'un overall.
 */

import { EnergyError } from "./types.js";

/** Une énergie partielle et ce qui la qualifie : elle ne s'affiche jamais nue. */
export interface PartialEnergy {
  /** Moyenne harmonique des seules sous-catégories renseignées. */
  readonly energy: number;
  /** Combien de sous-catégories y entrent (le « N » de « N/9 »). */
  readonly counted: number;
  /** Combien le palier en compte au total (9 sur Voltaic ; lu, pas supposé). */
  readonly total: number;
}

/**
 * L'énergie partielle d'une passe en cours, ou `null` si aucune sous-catégorie
 * n'est encore complète.
 *
 * `subcategoryEnergies` est la liste **complète** des sous-catégories du palier,
 * celles à 0 comprises — la forme exacte que rend `computeBenchRun`. C'est ce
 * qui permet de rendre `total` sans le supposer : un benchmark peut en avoir un
 * autre nombre (DECISIONS.md D5).
 */
export function partialEnergy(subcategoryEnergies: readonly number[]): PartialEnergy | null {
  if (subcategoryEnergies.length === 0) {
    throw new EnergyError("Énergie partielle : aucune sous-catégorie fournie.");
  }

  let sumOfInverses = 0;
  let counted = 0;
  let lowest = Number.POSITIVE_INFINITY;
  let highest = 0;

  for (const [index, energy] of subcategoryEnergies.entries()) {
    if (!Number.isFinite(energy) || energy < 0) {
      throw new EnergyError(
        `Énergie invalide (sous-catégorie ${index}): ${energy} (attendu: réel ≥ 0)`,
      );
    }
    if (energy === 0) continue;
    counted += 1;
    lowest = Math.min(lowest, energy);
    highest = Math.max(highest, energy);
    sumOfInverses += 1 / energy;
  }

  if (counted === 0) return null;

  // Même rattrapage de borne que l'overall : la moyenne harmonique est
  // mathématiquement dans [min, max], mais l'accumulation des inverses en
  // flottant peut en sortir de quelques ulps (9 × 500 → 499.99999999999994).
  const harmonicMean = counted / sumOfInverses;

  return {
    energy: Math.min(highest, Math.max(lowest, harmonicMean)),
    counted,
    total: subcategoryEnergies.length,
  };
}
