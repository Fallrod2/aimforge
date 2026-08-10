/**
 * Le **gating** de la routine : y a-t-il assez de parties classées récentes
 * pour construire une séance sur autre chose que le bench ? (SPEC §5 sexies,
 * V5.)
 *
 * Module **pur** — il ne lit ni la base, ni l'horloge (l'instant de référence
 * est injecté). Il tient en une décision, et cette décision se prouve aux
 * bornes : 4 matchs, 5 matchs, un match posé exactement sur le bord de la
 * fenêtre.
 *
 * Les deux nombres (cinq parties, quatorze jours) et leur justification vivent
 * dans le contrat (`routine-contract.ts`) : l'écran en a besoin autant que la
 * fonction, puisque c'est lui qui écrit « joue N parties classées ».
 *
 * Sous le seuil, la routine **se génère quand même**. Refuser serait doublement
 * faux : le bench seul suffit à travailler sa visée, et un joueur qui vient de
 * lier son compte n'a rien fait de mal. Ce qui change, c'est ce que le modèle
 * voit (aucune stat in-game) et ce que l'écran dit (un bandeau explicite).
 */

import type { MatchSummary } from "../../client/data/linked-accounts-contract.js";
import {
  ROUTINE_MIN_RECENT_MATCHES,
  ROUTINE_RECENT_WINDOW_DAYS,
  type RoutineMode,
} from "../../shared/routine-contract.js";
import { recentCompetitiveCount } from "../valorant/aggregates.js";

export interface RoutineGate {
  readonly mode: RoutineMode;
  /** Parties classées comptées dans la fenêtre. */
  readonly matchesUsed: number;
  /** Ce qu'il manque pour passer en mode complet ; `0` en mode complet. */
  readonly missing: number;
}

/**
 * La décision de gating pour un ensemble de matchs importés.
 *
 * @param now L'instant de référence de la fenêtre glissante.
 */
export function gateRoutine(matches: readonly MatchSummary[], now: Date = new Date()): RoutineGate {
  const matchesUsed = recentCompetitiveCount(matches, ROUTINE_RECENT_WINDOW_DAYS, now);
  const missing = Math.max(0, ROUTINE_MIN_RECENT_MATCHES - matchesUsed);

  return { mode: missing === 0 ? "full" : "bench_only", matchesUsed, missing };
}
