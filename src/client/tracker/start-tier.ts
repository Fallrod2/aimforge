/**
 * Le palier sur lequel le tracker s'ouvre (SPEC §5 sexies, V6). Module pur
 * (aucun React).
 *
 * Il ouvrait sur Novice, toujours. Or personne ne refait le bench d'un palier
 * qu'il a quitté : quelqu'un qui vient de passer Intermediate arrivait sur une
 * grille de scénarios qui ne sont plus les siens, et devait cliquer avant de
 * pouvoir taper. Le dernier bench enregistré dit ce qu'il joue aujourd'hui —
 * c'est la seule donnée dont on dispose, et elle a le mérite d'être la sienne.
 *
 * Sans historique, Novice : c'est là que commence le benchmark Voltaic.
 */

import type { TierId } from "../../lib/energy";

const FIRST_TIER: TierId = "novice";

/** Ce que le tracker regarde d'une passe pour choisir un palier. */
export interface TieredRun {
  readonly tier: TierId;
}

/**
 * Le palier du bench le plus récent, Novice à défaut.
 *
 * `runs` est attendu **du plus récent au plus ancien** — l'ordre que rend
 * `listBenchRuns` (`date desc, id desc`). On ne retrie pas ici : la liste ne
 * porte pas de date dans ce type, et refaire un tri sur une donnée qu'on n'a
 * pas serait inventer un ordre.
 */
export function startTier(runs: readonly TieredRun[]): TierId {
  return runs[0]?.tier ?? FIRST_TIER;
}
