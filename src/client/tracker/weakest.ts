/**
 * Les maillons faibles de la passe en cours, et ce qu'on affiche quand il n'y
 * en a plus (SPEC §5 sexies, V6). Module pur (aucun React).
 *
 * L'overall est une moyenne **harmonique** : c'est la sous-catégorie la plus
 * basse qui le tire vers le bas, donc la lister, c'est dire où travailler.
 * Sauf qu'au plafond du palier, les trois plus faibles valent `maxEnergy` comme
 * les six autres : la liste continue d'afficher des chiffres identiques et
 * désigne des « faiblesses » qui n'en sont pas. Ce n'est plus une consigne
 * d'entraînement, c'est un signal qu'il faut changer de palier — et l'écran
 * doit le dire au lieu de le laisser deviner.
 */

import {
  type BenchmarkId,
  type ComputedSubcategory,
  currentBenchmark,
  getTier,
  type TierId,
  tierIdsFor,
} from "../../lib/energy";

/** Combien de sous-catégories on nomme : assez pour orienter, pas pour noyer. */
export const WEAKEST_COUNT = 3;

/** Ce que le panneau de synthèse a à montrer sous « Maillons faibles ». */
export type WeakestView =
  /** Rien de saisi : pas de faiblesse à désigner. */
  | { readonly kind: "empty" }
  | { readonly kind: "list"; readonly subcategories: readonly ComputedSubcategory[] }
  /** Les 9 sous-catégories sont au plafond ; `next` est le palier d'après. */
  | { readonly kind: "capped"; readonly next: TierId | null };

/**
 * Le palier suivant dans la progression du benchmark, `null` après le dernier.
 *
 * L'ordre vient du benchmark : « après Advanced il n'y a rien » est un fait de
 * Voltaic, pas du domaine (DECISIONS.md D5).
 */
export function nextTierAfter(
  tier: TierId,
  benchmarkId: BenchmarkId = currentBenchmark(),
): TierId | null {
  const tiers = tierIdsFor(benchmarkId);

  return tiers[tiers.indexOf(tier) + 1] ?? null;
}

/**
 * Toutes les sous-catégories sont-elles au plafond du palier ?
 *
 * On exige les **neuf** (`computeBenchRun` les rend toutes, y compris à 0), et
 * pas seulement les trois plus faibles affichées : trois sous-catégories au
 * plafond au milieu d'un bench à moitié vide, ce n'est pas un palier terminé,
 * c'est un bench incomplet — et son overall vaut zéro. Les deux formulations
 * se rejoignent dès que le bench est complet, puisque les trois plus faibles
 * sont alors le minimum des neuf.
 */
export function atTierCap(tier: TierId, subcategories: readonly ComputedSubcategory[]): boolean {
  const { maxEnergy } = getTier(tier);

  return (
    subcategories.length > 0 &&
    subcategories.every((subcategory) => subcategory.energy >= maxEnergy)
  );
}

/** Ce qu'il faut afficher : la liste, l'invitation à monter, ou rien. */
export function weakestView(
  tier: TierId,
  subcategories: readonly ComputedSubcategory[],
): WeakestView {
  if (atTierCap(tier, subcategories)) {
    return { kind: "capped", next: nextTierAfter(tier) };
  }

  const scored = subcategories.filter((subcategory) => subcategory.energy > 0);

  if (scored.length === 0) return { kind: "empty" };
  return {
    kind: "list",
    subcategories: [...scored].sort((a, b) => a.energy - b.energy).slice(0, WEAKEST_COUNT),
  };
}
