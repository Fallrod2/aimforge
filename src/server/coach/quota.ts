/**
 * Verdict de quota. Module **pur** : l'incrément atomique vit en base
 * (`public.increment_ai_usage`, migration 0003) ; ici on ne fait que lire le
 * compteur qu'elle renvoie.
 *
 * L'ordre est délibéré : on **incrémente d'abord, on décide ensuite**. Décider
 * avant d'incrémenter laisserait la place à deux requêtes simultanées qui
 * liraient toutes les deux 4 et passeraient toutes les deux. La contrepartie
 * assumée : une tentative refusée a quand même consommé un incrément, donc le
 * compteur du jour peut dépasser la limite. Ça ne rouvre rien (le verdict est
 * `count <= limit`), ça rend seulement le compteur plus grand que le nombre de
 * debriefs réellement produits — et ça décourage le martèlement.
 */

import { COACH_DAILY_QUOTA } from "../../shared/coach-contract.js";

export interface QuotaVerdict {
  /** L'appel au modèle est-il autorisé ? */
  readonly allowed: boolean;
  /** Debriefs encore disponibles aujourd'hui, une fois celui-ci compté. */
  readonly remaining: number;
}

/**
 * @param countAfterIncrement Le compteur du jour **après** incrément, tel que
 *   le renvoie `increment_ai_usage`.
 */
export function evaluateQuota(
  countAfterIncrement: number,
  limit: number = COACH_DAILY_QUOTA,
): QuotaVerdict {
  return {
    allowed: countAfterIncrement <= limit,
    remaining: Math.max(0, limit - countAfterIncrement),
  };
}
