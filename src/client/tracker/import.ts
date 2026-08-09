/**
 * Pré-remplissage du tracker depuis un import KovaaK's. Module **pur** (aucun
 * React) : la mécanique du bouton « Importer mes scores » est ici, testable
 * sans DOM ni réseau.
 *
 * Le principe produit tient en une règle : **l'import propose, l'utilisateur
 * dispose.** Rien ne part en base à l'import ; les scores atterrissent dans la
 * même saisie que la frappe manuelle, avec le même calcul live, et c'est le
 * bouton « Sauvegarder » habituel qui écrit. Un import qui enregistrerait
 * directement ferait d'une source non officielle une vérité que personne
 * n'aurait relue.
 *
 * Deuxième règle, moins évidente : **l'import complète, il n'efface pas.** Un
 * scénario absent de l'import garde ce que l'utilisateur avait tapé. Le cas
 * réel est banal — un scénario joué hors benchmark, un score relevé à la main —
 * et écraser cette saisie par du vide serait une perte silencieuse.
 */

import type { TierId } from "../../lib/energy";
import type { MissingScenario } from "../data/linked-accounts-contract";
import { type BenchDraft, setScoreInput } from "./draft";

/** Où en est l'import, du point de vue de l'écran. */
export type ImportState =
  | { readonly status: "idle" }
  | { readonly status: "loading" }
  | { readonly status: "error"; readonly message: string }
  | {
      readonly status: "done";
      /** Orthographe du pseudo telle que KovaaK's l'écrit. */
      readonly username: string;
      /** Scénarios effectivement pré-remplis. */
      readonly filled: readonly string[];
      /** Les scénarios du palier restés vides, et pourquoi. */
      readonly missing: readonly MissingScenario[];
    };

/** Ce qu'un import réussi rapporte, réduit à ce dont l'écran a besoin. */
export interface ImportOutcome {
  readonly username: string;
  readonly scores: Readonly<Record<string, number>>;
  readonly missing: readonly MissingScenario[];
}

export const IDLE: ImportState = { status: "idle" };

export const LOADING: ImportState = { status: "loading" };

export function importFailed(message: string): ImportState {
  return { status: "error", message };
}

export function importSucceeded(outcome: ImportOutcome): ImportState {
  return {
    status: "done",
    username: outcome.username,
    filled: Object.keys(outcome.scores),
    missing: outcome.missing,
  };
}

/* ------------------------------------------------------------------ */
/* Un état par palier                                                  */
/* ------------------------------------------------------------------ */

/**
 * L'état d'import de chaque palier.
 *
 * Il est indexé par palier pour la même raison que la saisie l'est : les trois
 * paliers sont trois benchs distincts. Un état unique ferait dire à l'écran
 * « 18 scénarios importés, vérifie puis sauvegarde » au-dessus d'une grille
 * vide dès qu'on bascule de palier après un import — la phrase la plus
 * trompeuse que cet écran puisse afficher, puisqu'elle invite à enregistrer
 * une passe qui n'existe pas.
 */
export type ImportStates = Readonly<Partial<Record<TierId, ImportState>>>;

export const NO_IMPORTS: ImportStates = {};

/** L'état du palier demandé ; au repos tant qu'il n'a rien vécu. */
export function importStateFor(states: ImportStates, tier: TierId): ImportState {
  return states[tier] ?? IDLE;
}

export function withImportState(
  states: ImportStates,
  tier: TierId,
  state: ImportState,
): ImportStates {
  return { ...states, [tier]: state };
}

/** Oublie ce qui s'est passé sur un palier, sans toucher aux deux autres. */
export function clearImportState(states: ImportStates, tier: TierId): ImportStates {
  const next: Partial<Record<TierId, ImportState>> = { ...states };

  delete next[tier];
  return next;
}

/**
 * La saisie de ce palier vient-elle d'un import ?
 *
 * C'est ce qui décide de `bench_runs.source`. Un import qui n'a rien ramené ne
 * compte pas : les champs sont restés vides, ce qui sera tapé ensuite le sera
 * à la main.
 */
export function isImportedTier(states: ImportStates, tier: TierId): boolean {
  const state = importStateFor(states, tier);

  return state.status === "done" && state.filled.length > 0;
}

/**
 * Le score tel qu'il s'écrira dans le champ de saisie.
 *
 * Point décimal et pas de séparateur de milliers : c'est la forme que
 * `parseScoreInput` relit sans ambiguïté, et celle que l'utilisateur peut
 * corriger à la main sans se demander ce qu'il regarde.
 */
export function formatImportedScore(value: number): string {
  return String(Math.round(value * 100) / 100);
}

/**
 * Verse les scores importés dans la saisie du palier.
 *
 * Les autres paliers ne bougent pas (la saisie est conservée palier par
 * palier), et les scénarios absents de l'import non plus.
 */
export function applyImportedScores(
  draft: BenchDraft,
  tier: TierId,
  scores: Readonly<Record<string, number>>,
): BenchDraft {
  let next = draft;

  for (const [scenario, score] of Object.entries(scores)) {
    next = setScoreInput(next, tier, scenario, formatImportedScore(score));
  }
  return next;
}

/**
 * La phrase qui rend compte de l'import, une fois pour toutes.
 *
 * Elle dit toujours le nombre de scénarios manquants : un import à 14/18 qui
 * annoncerait seulement « scores importés » enverrait l'utilisateur sauvegarder
 * un bench incomplet sans le savoir — et un bench incomplet vaut un overall à
 * zéro, ce qu'il ne comprendrait qu'après coup.
 */
export function importReport(state: ImportState, total: number): string | null {
  if (state.status !== "done") return null;

  const filled = state.filled.length;

  if (filled === 0) {
    return `Aucun score trouvé pour « ${state.username} » sur ce palier. Joue le benchmark sur KovaaK's, ou saisis tes scores à la main.`;
  }
  if (filled >= total) {
    return `${filled} scénarios importés depuis « ${state.username} ». Vérifie, puis sauvegarde.`;
  }
  return `${filled}/${total} scénarios importés depuis « ${state.username} ». Les ${total - filled} autres restent à compléter à la main.`;
}
