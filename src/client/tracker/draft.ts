/**
 * État de saisie d'une passe de bench : la frappe brute de l'utilisateur, par
 * palier et par scénario. Module pur (aucun React) pour rester testable.
 *
 * Une saisie est conservée palier par palier : changer de palier puis revenir
 * ne perd rien.
 */

import { currentBenchmark, type ScoreMap, type TierId, tierIdsFor } from "../../lib/energy";

/** Ce que l'utilisateur a tapé, indexé par nom de scénario. */
export type TierDraft = Readonly<Record<string, string>>;

/**
 * La saisie, palier par palier. Les clés sont les paliers du benchmark courant
 * — plus une union fermée depuis que `TierId` est ouvert (DECISIONS.md D5), d'où
 * `tierDraft` pour lire une case sans supposer qu'elle existe.
 */
export type BenchDraft = Readonly<Record<TierId, TierDraft>>;

/** Résultat de la lecture d'un champ de score. */
export type ParsedScore =
  | { readonly state: "empty" }
  | { readonly state: "invalid" }
  | { readonly state: "ok"; readonly score: number };

/** Les scores exploitables d'un palier, et les champs à corriger. */
export interface DraftScores {
  readonly scores: ScoreMap;
  /** Scénarios dont la saisie n'est pas un nombre positif. */
  readonly invalid: readonly string[];
}

export function emptyDraft(): BenchDraft {
  return Object.fromEntries(tierIdsFor(currentBenchmark()).map((tier) => [tier, {}]));
}

/** La saisie d'un palier ; vide si ce palier n'a jamais été touché. */
export function tierDraft(draft: BenchDraft, tier: TierId): TierDraft {
  return draft[tier] ?? {};
}

/**
 * Lit un champ de score. Accepte la virgule décimale (clavier français) et les
 * espaces de groupement ; refuse tout le reste plutôt que de deviner.
 */
export function parseScoreInput(raw: string): ParsedScore {
  const cleaned = raw.replace(/[\s  ]/g, "").replace(",", ".");

  if (cleaned === "") return { state: "empty" };
  if (!/^\d+(\.\d+)?$/.test(cleaned)) return { state: "invalid" };

  const score = Number(cleaned);

  return Number.isFinite(score) ? { state: "ok", score } : { state: "invalid" };
}

/** Remplace la saisie d'un scénario. Une saisie vide efface le scénario. */
export function setScoreInput(
  draft: BenchDraft,
  tier: TierId,
  scenario: string,
  raw: string,
): BenchDraft {
  const next: Record<string, string> = { ...tierDraft(draft, tier) };

  if (raw === "") {
    delete next[scenario];
  } else {
    next[scenario] = raw;
  }
  return { ...draft, [tier]: next };
}

/** Vide la saisie d'un palier, sans toucher aux deux autres. */
export function clearTier(draft: BenchDraft, tier: TierId): BenchDraft {
  return { ...draft, [tier]: {} };
}

/**
 * Les scores d'un palier prêts pour le moteur d'énergie : seules les saisies
 * valides entrent dans la `ScoreMap`, les autres sont signalées à l'UI.
 */
export function draftScores(draft: BenchDraft, tier: TierId): DraftScores {
  const scores: Record<string, number> = {};
  const invalid: string[] = [];

  for (const [scenario, raw] of Object.entries(tierDraft(draft, tier))) {
    const parsed = parseScoreInput(raw);

    if (parsed.state === "ok") {
      scores[scenario] = parsed.score;
    } else if (parsed.state === "invalid") {
      invalid.push(scenario);
    }
  }
  return { scores, invalid };
}
