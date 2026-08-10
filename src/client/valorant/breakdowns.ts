/**
 * Les tableaux par agent et par map (SPEC §5 sexies, V2). Module pur.
 *
 * Les compteurs viennent du serveur (`api/valorant/stats`) : ce module ne
 * recalcule rien, il **ordonne et coupe**.
 *
 * Pourquoi retrier ce qui arrive déjà trié : parce que l'ordre est la seule
 * chose que l'écran promet (« par volume »), et qu'une promesse d'affichage ne
 * se délègue pas à une réponse réseau. Le jour où le contrat change d'ordre, ou
 * où une réponse arrive d'un cache écrit par une version antérieure, le tableau
 * reste juste. Le tri est le même que celui du serveur — volume décroissant,
 * puis alphabétique — pour que les deux ne se contredisent jamais.
 *
 * La coupe, elle, est une décision d'écran : au-delà d'une poignée de lignes on
 * ne lit plus un tableau, on le parcourt. Ce qui dépasse n'est pas caché en
 * silence — le reste est compté, agents et parties, sous le tableau.
 */

import type { StatBreakdown } from "../data";

/** Lignes affichées par défaut : de quoi voir un pool, pas de quoi défiler. */
export const BREAKDOWN_LIMIT = 6;

export interface RankedBreakdowns {
  readonly rows: readonly StatBreakdown[];
  /** Entrées laissées de côté par la coupe. */
  readonly hidden: number;
  /** Parties portées par ces entrées : la coupe ne fait pas disparaître un volume. */
  readonly hiddenMatches: number;
}

/** Ordre alphabétique stable, insensible à la casse et aux accents. */
function compare(left: string, right: string): number {
  return left.localeCompare(right, "fr");
}

/**
 * Les `limit` premières entrées par volume, plus le compte de ce qui reste.
 *
 * Une limite nulle ou négative ne rend rien et compte tout comme caché : c'est
 * plus honnête que d'inventer une ligne.
 */
export function rankBreakdowns(
  breakdowns: readonly StatBreakdown[],
  limit: number = BREAKDOWN_LIMIT,
): RankedBreakdowns {
  const sorted = [...breakdowns].sort(
    (left, right) => right.totals.matches - left.totals.matches || compare(left.key, right.key),
  );
  const kept = Math.max(0, Math.trunc(limit));
  const rows = sorted.slice(0, kept);
  const rest = sorted.slice(kept);

  return {
    rows,
    hidden: rest.length,
    hiddenMatches: rest.reduce((total, entry) => total + entry.totals.matches, 0),
  };
}
