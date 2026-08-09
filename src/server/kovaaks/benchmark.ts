/**
 * Lecture d'une progression de benchmark KovaaK's — module **pur** : il ne
 * connaît que la *forme* des données du Benchmark Tracker, jamais son réseau
 * (celui-ci vit dans `api/_lib/kovaaks.ts`). C'est donc ici que se teste tout
 * ce qui peut se tromper, sans appeler kovaaks.com.
 *
 * Trois choses non évidentes, vérifiées contre l'API réelle :
 *
 * 1. **Les noms de scénarios** du Benchmark Tracker sont exactement ceux du
 *    tableur Voltaic, suffixés « S5 » (`VT Pasu Novice S5`). La correspondance
 *    est de 18/18 sur les trois paliers. On la fait quand même par
 *    normalisation plutôt que par découpe littérale : une variante de casse ou
 *    une double espace ne doit pas faire perdre un scénario.
 * 2. **Les scores sont en centièmes** (`96840` pour `968.4`). Rien ne le
 *    documente, donc on ne fait pas confiance à la division : chaque score est
 *    recoupé avec le rang annoncé pour ce scénario et ses seuils de rangs, que
 *    la même réponse fournit. Un score qui ne tombe pas dans la tranche de son
 *    propre rang est rejeté (`incoherent`) plutôt que pré-rempli cent fois trop
 *    grand — c'est le garde-fou qui nous préviendra le jour où l'échelle
 *    changera.
 * 3. **Un score à zéro n'est pas un score** : c'est un scénario jamais joué.
 *    Le pré-remplissage doit laisser le champ vide, pas y écrire 0 (qui vaudrait
 *    une énergie nulle bien réelle dans le moteur).
 */

import { z } from "zod";
import type { MissingScenario } from "../../client/data/linked-accounts-contract.js";
import { listScenarios, type TierId } from "../../lib/energy/index.js";

/**
 * Les benchmarks Voltaic S5 officiels du Benchmark Tracker (auteur « Tammas »).
 * Ce sont les seuls dont les 18 scénarios correspondent au tableur ; les
 * innombrables copies communautaires ne sont pas des sources de vérité.
 */
export const KOVAAKS_BENCHMARK_IDS = {
  novice: 432,
  intermediate: 431,
  advanced: 427,
} as const satisfies Record<TierId, number>;

/** Facteur d'échelle des scores renvoyés par le Benchmark Tracker. */
export const SCORE_SCALE = 100;

/**
 * Tolérance sur la borne basse du recoupement. Elle n'existe que pour absorber
 * l'arrondi de la division par cent, pas pour laisser passer un écart réel.
 */
const BOUND_EPSILON = 1e-6;

/* ------------------------------------------------------------------ */
/* La forme des données reçues                                         */
/* ------------------------------------------------------------------ */

export const kovaaksScenarioProgressSchema = z.object({
  /** En centièmes. `0` = scénario jamais joué dans ce benchmark. */
  score: z.number().min(0),
  /** Rang atteint sur ce scénario : `0` = sous le premier seuil. */
  scenario_rank: z.number().int().min(0).nullish(),
  /** Seuils de rangs du scénario, croissants, dans l'unité du tableur. */
  rank_maxes: z.array(z.number()).nullish(),
});

export const kovaaksBenchmarkProgressSchema = z.object({
  categories: z.record(
    z.string(),
    z.object({ scenarios: z.record(z.string(), kovaaksScenarioProgressSchema) }),
  ),
});

export type KovaaksScenarioProgress = z.infer<typeof kovaaksScenarioProgressSchema>;
export type KovaaksBenchmarkProgress = z.infer<typeof kovaaksBenchmarkProgressSchema>;

/* ------------------------------------------------------------------ */
/* Correspondance des noms                                             */
/* ------------------------------------------------------------------ */

/**
 * Forme comparable d'un nom de scénario : casse ignorée, espaces normalisés,
 * marqueur de saison final retiré (`… Novice S5` → `… novice`).
 */
export function normalizeScenarioName(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ")
    .replace(/\ss\d+$/, "");
}

const namesByTier = new Map<TierId, ReadonlyMap<string, string>>();

/** Nom normalisé → nom officiel du palier. Construit une fois par palier. */
function officialNames(tier: TierId): ReadonlyMap<string, string> {
  const cached = namesByTier.get(tier);

  if (cached !== undefined) return cached;

  const built = new Map(
    listScenarios(tier).map((scenario) => [normalizeScenarioName(scenario.name), scenario.name]),
  );

  namesByTier.set(tier, built);
  return built;
}

/** Le nom officiel correspondant, ou `null` si le scénario n'est pas du palier. */
export function voltaicScenarioName(tier: TierId, raw: string): string | null {
  return officialNames(tier).get(normalizeScenarioName(raw)) ?? null;
}

/* ------------------------------------------------------------------ */
/* Recoupement de l'échelle                                            */
/* ------------------------------------------------------------------ */

/**
 * Le score (déjà ramené à l'unité du tableur) tombe-t-il dans la tranche du
 * rang que la source annonce pour lui ?
 *
 * Sans rang ni seuils, il n'y a rien à recouper : on accepte plutôt que de
 * rejeter un scénario pour une information que la source n'a pas donnée.
 */
export function scoreMatchesRank(
  score: number,
  rank: number | null | undefined,
  maxes: readonly number[] | null | undefined,
): boolean {
  if (rank === null || rank === undefined) return true;
  if (maxes === null || maxes === undefined || maxes.length === 0) return true;
  if (rank < 0 || rank > maxes.length) return true;

  const low = rank === 0 ? 0 : maxes[rank - 1];
  const high = rank === maxes.length ? Number.POSITIVE_INFINITY : maxes[rank];

  if (low === undefined || high === undefined) return true;
  return score >= low - BOUND_EPSILON && score < high;
}

/* ------------------------------------------------------------------ */
/* Lecture complète d'un palier                                        */
/* ------------------------------------------------------------------ */

export interface MappedBenchmark {
  readonly tier: TierId;
  /** Nom officiel du scénario → score dans l'unité du tableur. */
  readonly scores: Readonly<Record<string, number>>;
  /** Les scénarios du palier restés sans score, et pourquoi. */
  readonly missing: readonly MissingScenario[];
  /** Ce que la source a renvoyé et qu'on n'a pas su rattacher au palier. */
  readonly unknown: readonly string[];
}

/** Ramène un score de centièmes à l'unité du tableur, sans traîne binaire. */
function toScoreUnit(raw: number): number {
  return Math.round((raw / SCORE_SCALE) * 100) / 100;
}

/**
 * Traduit une progression de benchmark en scores prêts à pré-remplir le
 * tracker. Les 18 scénarios du palier sont toujours comptés : ceux qui n'ont
 * pas de score exploitable ressortent dans `missing` avec leur raison, jamais
 * en silence.
 */
export function mapBenchmarkProgress(
  tier: TierId,
  progress: KovaaksBenchmarkProgress,
): MappedBenchmark {
  const scores: Record<string, number> = {};
  const reasons = new Map<string, MissingScenario["reason"]>();
  const unknown: string[] = [];

  for (const category of Object.values(progress.categories)) {
    for (const [rawName, entry] of Object.entries(category.scenarios)) {
      const scenario = voltaicScenarioName(tier, rawName);

      if (scenario === null) {
        unknown.push(rawName);
        continue;
      }
      if (entry.score <= 0) {
        reasons.set(scenario, "sans-score");
        continue;
      }

      const score = toScoreUnit(entry.score);

      if (!scoreMatchesRank(score, entry.scenario_rank, entry.rank_maxes)) {
        reasons.set(scenario, "incoherent");
        continue;
      }
      scores[scenario] = score;
    }
  }

  // Les 18 du palier font foi : un scénario que la source n'a pas mentionné du
  // tout est `absent`, et doit se voir dans le rapport comme les autres.
  const missing = listScenarios(tier)
    .filter((scenario) => scores[scenario.name] === undefined)
    .map((scenario) => ({
      scenario: scenario.name,
      reason: reasons.get(scenario.name) ?? "absent",
    }));

  return { tier, scores, missing, unknown };
}
