/**
 * Le budget de temps des appels au modèle, partagé par les fonctions IA.
 *
 * ## Le problème qu'il règle, et qui n'était pas théorique
 *
 * Chaque fonction IA peut appeler le modèle **deux fois** : la génération, puis
 * une relance corrective si la sortie est hors contrat. Tant que le délai était
 * une constante par appel, le pire cas valait deux fois cette constante — et
 * `api/coach` la fixait à 45 s sous un `maxDuration` de 60 s. Deux appels lents
 * faisaient donc 90 s, soit une **fonction tuée par la plateforme** : pas de
 * réponse JSON, pas de message rédigé, et surtout pas de remboursement du
 * quota. L'utilisateur payait un debrief qu'il n'a jamais reçu, exactement
 * l'incident que le remboursement (`./ai-usage.ts`) avait été écrit pour éviter.
 *
 * Un budget déplace la limite du bon côté : ce n'est plus « chaque appel a
 * 45 s », c'est « les appels ont 48 s **à eux tous** ». Ce qui reste sous le
 * `maxDuration` couvre la lecture du contexte, l'écriture en base, le
 * remboursement et la réponse — donc un 504 rédigé plutôt qu'une coupure muette.
 *
 * Les trois nombres (total, plafond par appel, plancher) vivent dans
 * `src/shared/ai-timing.ts`, avec le raisonnement qui les relie au `maxDuration`
 * et au délai du navigateur.
 *
 * Le préfixe `_` sort ce fichier du routage Vercel : il est importé, jamais
 * appelé en HTTP.
 */

import { attemptTimeout, type Clock, startBudget } from "../../src/server/kovaaks/budget.js";

/**
 * Renoncement volontaire faute de temps.
 *
 * Distinguée d'une panne du modèle parce qu'elle ne se raconte pas pareil : le
 * temps manquant est le nôtre, et le handler en fait un 504 (« ça a pris trop
 * de temps, réessaie ») plutôt qu'un 502 (« le fournisseur est injoignable »).
 *
 * Une seule classe pour toutes les fonctions : deux définitions locales
 * portant le même nom feraient échouer un `instanceof` sans rien signaler.
 */
export class BudgetExhaustedError extends Error {
  override readonly name = "BudgetExhaustedError";
}

export interface ModelBudget {
  /**
   * Le délai à accorder à la prochaine tentative : ce qu'il reste, plafonné.
   *
   * @throws {BudgetExhaustedError} quand il ne reste pas de quoi tenter — mieux
   *   vaut un échec rédigé et remboursé qu'un appel qui n'aboutira pas.
   */
  readonly nextTimeout: () => number;
  /** Ce qu'il reste, pour les journaux. */
  readonly remaining: () => number;
}

export function startModelBudget(
  totalMs: number,
  capMs: number,
  floorMs: number,
  now: Clock = Date.now,
): ModelBudget {
  const budget = startBudget(totalMs, now);

  return {
    nextTimeout: () => {
      const timeout = attemptTimeout(budget.remaining(), capMs, floorMs);

      if (timeout === null) {
        throw new BudgetExhaustedError("plus assez de temps pour une tentative");
      }
      return timeout;
    },
    remaining: () => budget.remaining(),
  };
}
