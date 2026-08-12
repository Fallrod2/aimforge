/**
 * L'**objectif de rang** : le rang que le joueur vise sur le palier qu'il
 * saisit, et ce qui lui manque encore pour l'obtenir (SPEC V4-A §4.5).
 *
 * L'écran disait déjà « il manque X d'énergie pour Diamond ». C'est vrai, et
 * c'est inactionnable : l'énergie overall est une moyenne harmonique de neuf
 * sous-catégories, personne ne sait quoi jouer pour gagner « 12 points
 * d'énergie ». La question à laquelle ce module répond est l'autre : **quels
 * scénarios sont déjà au seuil du rang visé, et à combien sont les autres ?**
 * Un objectif, un compte, et des scores à battre.
 *
 * Les seuils viennent tous du registre (`getTier(...).anchorLabels` et
 * `scenario.thresholds`), jamais d'une table écrite à la main : c'est la même
 * lecture que celle du badge « Complete » (`energy.ts`), qui exige exactement
 * la même chose — les 18 scénarios au seuil du rang.
 *
 * Le choix, lui, vit dans le navigateur (`local-store.ts`) : c'est une
 * préférence locale, à promouvoir en base si le besoin multi-appareil se
 * confirme.
 */

import { type BenchmarkId, getTier, getTierFor, type Rank, type ScoreMap } from "../../lib/energy";
import { type KeyValueStore, PREF_PREFIX } from "./local-store";

/** Un scénario qui n'est pas encore au seuil du rang visé. */
export interface GoalGap {
  readonly scenario: string;
  /** Le score à atteindre pour ce scénario, au rang visé. */
  readonly threshold: number;
  /** Le score actuel, `null` si le scénario n'a pas été joué. */
  readonly score: number | null;
  /** Ce qui reste à gagner (`threshold - score`). */
  readonly missing: number;
}

/** Où en est le joueur sur son objectif. */
export interface GoalProgress {
  readonly rank: string;
  /** Scénarios déjà au seuil du rang. */
  readonly reached: number;
  readonly total: number;
  /** Les autres, du plus proche du seuil au plus loin. */
  readonly missing: readonly GoalGap[];
}

/** Les rangs qu'on peut viser sur ce palier : ceux du benchmark, dans l'ordre. */
export function goalRanks(tier: string): readonly Rank[] {
  return getTier(tier).overallRanks;
}

/**
 * Où en est la saisie par rapport au rang visé.
 *
 * `null` quand `rankName` n'est pas un rang de ce palier — le cas n'est pas
 * théorique : l'objectif est rangé par palier, mais un stockage recopié d'un
 * appareil à l'autre, ou une saisie relue après un changement de benchmark,
 * peut présenter un rang étranger. Le tracker doit alors afficher un écran sans
 * objectif, pas une exception.
 */
export function goalProgress(
  tier: string,
  rankName: string,
  scores: ScoreMap,
): GoalProgress | null {
  const tierData = getTier(tier);
  const anchorIndex = tierData.anchorLabels.indexOf(rankName);
  // Un rang overall est toujours un libellé d'ancre (c'est ce sur quoi repose
  // `isComplete`) : l'absence signe un rang qui n'est pas de ce palier.
  const known = tierData.overallRanks.some((rank) => rank.name === rankName);

  if (anchorIndex < 0 || !known) return null;

  const gaps: GoalGap[] = [];
  let reached = 0;
  let total = 0;

  for (const category of tierData.categories) {
    for (const subcategory of category.subcategories) {
      for (const scenario of subcategory.scenarios) {
        const threshold = scenario.thresholds[anchorIndex];

        if (threshold === undefined) continue;
        total += 1;

        const raw = scores[scenario.name];
        const score = raw === undefined || !Number.isFinite(raw) ? null : raw;

        if (score !== null && score >= threshold) {
          reached += 1;
        } else {
          gaps.push({
            scenario: scenario.name,
            threshold,
            score,
            missing: threshold - (score ?? 0),
          });
        }
      }
    }
  }

  return {
    rank: rankName,
    reached,
    total,
    // Le plus proche d'abord : c'est celui qu'il est rationnel d'aller chercher.
    // À égalité, le nom tranche pour que la liste ne bouge pas d'un rendu à
    // l'autre.
    missing: gaps.sort((a, b) => a.missing - b.missing || a.scenario.localeCompare(b.scenario)),
  };
}

/* ------------------------------------------------------------------ */
/* Mémoire locale                                                      */
/* ------------------------------------------------------------------ */

/**
 * La clé de l'objectif : **un objectif par benchmark et par palier**.
 *
 * Viser Gold en Novice et Diamond en Intermediate sont deux objectifs, pas deux
 * versions du même : une clé unique ferait qu'un changement de palier écraserait
 * silencieusement l'autre.
 */
export function goalKey(benchmarkId: BenchmarkId, tier: string): string {
  return `${PREF_PREFIX}.rank-goal.${benchmarkId}.${tier}`;
}

/**
 * L'objectif rangé pour ce palier, **revalidé** contre les rangs du benchmark.
 *
 * Une valeur qui n'est plus un rang du palier (données recopiées, barème qui a
 * changé de rangs) est traitée comme absente plutôt que réaffichée : mieux vaut
 * ne pas avoir d'objectif qu'en afficher un que le registre ne connaît pas.
 */
export function readGoal(
  store: KeyValueStore,
  benchmarkId: BenchmarkId,
  tier: string,
): string | null {
  try {
    const stored = store.getItem(goalKey(benchmarkId, tier));

    if (stored === null) return null;
    const ranks = getTierFor(benchmarkId, tier).overallRanks;

    return ranks.some((rank) => rank.name === stored) ? stored : null;
  } catch {
    // Stockage refusé, ou palier inconnu de ce benchmark : pas d'objectif.
    return null;
  }
}

/** Pose l'objectif du palier, ou l'efface si `rankName` est `null`. */
export function writeGoal(
  store: KeyValueStore,
  benchmarkId: BenchmarkId,
  tier: string,
  rankName: string | null,
): void {
  try {
    const key = goalKey(benchmarkId, tier);

    if (rankName === null) {
      store.removeItem(key);
    } else {
      store.setItem(key, rankName);
    }
  } catch {
    // Un objectif non retenu se rechoisit ; une exception ici casserait la
    // saisie en cours, ce qui coûterait bien plus cher.
  }
}
