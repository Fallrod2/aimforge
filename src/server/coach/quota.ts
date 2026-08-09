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
 *
 * Cette contrepartie a une limite, et elle a été payée en vrai : deux échecs
 * 502 imputables à la **configuration de la plateforme** ont consommé deux
 * debriefs du quota d'un utilisateur qui n'avait rien reçu. D'où la règle que
 * `createQuotaRefund` tient : incrément consommé + rien de persisté ⇒
 * remboursement. Elle ne rouvre pas la porte au martèlement, parce qu'un abus
 * ne passe pas par une panne de notre modèle — c'est notre panne qu'on cesse
 * de facturer, pas la sienne qu'on excuse.
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

/* ------------------------------------------------------------------ */
/* Remboursement                                                       */
/* ------------------------------------------------------------------ */

/**
 * Le remboursement effectif — l'appel à `refund_ai_usage` (migration 0010).
 *
 * Rend le compteur du jour **après** décrément, ou `null` quand le
 * remboursement n'a pas pu être fait : la base est le seul endroit qui sait ce
 * que vaut le compteur, et on ne le devine pas.
 */
export type RefundUsage = () => Promise<number | null>;

export interface QuotaRefund {
  /**
   * Rembourse l'incrément de cette requête, **au plus une fois**, et rend le
   * `remaining` à annoncer au client.
   */
  readonly refund: () => Promise<number>;
}

/**
 * Le remboursement d'une requête, borné à un.
 *
 * « Au plus une fois » n'est pas une précaution de style : un même appel peut
 * traverser plusieurs chemins d'échec (la relance corrective qui échoue à son
 * tour, une erreur du modèle attrapée puis une sortie hors contrat) et chacun
 * appelle le remboursement. Deux décréments pour un incrément rendraient un
 * debrief gratuit — le plancher de la fonction SQL protège du négatif, pas de
 * ça. Le drapeau est posé **avant** l'attente, donc deux chemins qui se
 * suivraient de très près ne peuvent pas passer tous les deux.
 *
 * Un remboursement en échec n'est pas retenté et ne lève pas : l'erreur
 * d'origine est celle qui doit remonter à l'utilisateur, un compteur mal rendu
 * ne doit jamais la masquer. On garde alors le `remaining` d'avant, qui est
 * l'état réel de la base.
 *
 * @param remaining Le `remaining` accordé par l'incrément, avant remboursement.
 * @param limit La limite du jour, pour retraduire le compteur remboursé.
 */
export function createQuotaRefund(
  remaining: number,
  limit: number,
  refundUsage: RefundUsage,
): QuotaRefund {
  let settled = false;
  let current = remaining;

  return {
    refund: async (): Promise<number> => {
      if (settled) return current;
      settled = true;

      const count = await refundUsage();

      if (count !== null) current = evaluateQuota(count, limit).remaining;
      return current;
    },
  };
}

/**
 * Le `remaining` à annoncer sur un chemin d'échec.
 *
 * Remboursé quand il y avait un incrément à rendre ; inchangé quand il n'y en
 * avait pas — configuration personnelle (SPEC §5 ter), où rien n'a été compté
 * et où `remaining` vaut `null`. Les deux fonctions serverless passent par
 * cette même ligne, pour qu'aucune des deux n'oublie l'un des deux cas.
 */
export function refundQuota(
  refund: QuotaRefund | null,
  remaining: number | null,
): Promise<number | null> {
  return refund === null ? Promise.resolve(remaining) : refund.refund();
}
