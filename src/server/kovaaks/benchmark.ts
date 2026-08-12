/**
 * Lecture d'une progression de benchmark KovaaK's — module **pur** : il ne
 * connaît que la *forme* des données du Benchmark Tracker, jamais son réseau
 * (celui-ci vit dans `api/_lib/kovaaks.ts`). C'est donc ici que se teste tout
 * ce qui peut se tromper, sans appeler kovaaks.com.
 *
 * Trois choses non évidentes, vérifiées contre l'API réelle :
 *
 * 1. **Les noms de scénarios** du Benchmark Tracker sont exactement ceux du
 *    tableur Voltaic, suffixés du marqueur de saison (`VT Pasu Novice S5`) —
 *    marqueur qui vit dans la définition du benchmark (`kovaaks.scenarioSuffix`),
 *    d'où `normalizedScenarioKey` le tire. La correspondance est de 18/18 sur
 *    les trois paliers. On la fait quand même par normalisation plutôt que par
 *    découpe littérale : une variante de casse ou une double espace ne doit pas
 *    faire perdre un scénario.
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
import {
  type BenchmarkDefinition,
  type BenchmarkId,
  EnergyError,
  getBenchmark,
  listScenariosFor,
  normalizedScenarioKey,
  type TierId,
} from "../../lib/energy/index.js";

/**
 * L'identifiant du benchmark officiel du Benchmark Tracker à interroger pour un
 * palier.
 *
 * Il change à chaque publication (le Benchmark Tracker republie), d'où sa place
 * dans la définition du benchmark plutôt qu'en dur ici (SPEC §5 quinquies). Un
 * benchmark qui ne s'importe pas depuis KovaaK's, ou un palier qu'il n'y publie
 * pas, lève : c'est un appel qui n'a pas de réponse, pas un appel qui vaut zéro.
 */
export function kovaaksBenchmarkId(benchmarkId: BenchmarkId, tier: TierId): number {
  const kovaaks = getBenchmark(benchmarkId).kovaaks;

  if (kovaaks === null) {
    throw new EnergyError(`Benchmark non importable depuis KovaaK's: "${benchmarkId}"`);
  }

  const id = kovaaks.benchmarkIds[tier];

  if (id === undefined) {
    throw new EnergyError(
      `Aucun benchmark KovaaK's pour le palier "${tier}" (benchmark ${benchmarkId})`,
    );
  }
  return id;
}

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
 * marqueur d'import final retiré (`… Novice S5` → `… novice`).
 *
 * Le marqueur retiré est celui **déclaré par le benchmark**, et non plus un
 * motif générique (`\ss\d+$`) qui amputait au jugé tout nom finissant par une
 * lettre et un chiffre.
 */
export function normalizeScenarioName(benchmarkId: BenchmarkId, raw: string): string {
  return normalizedScenarioKey(benchmarkId, raw);
}

const namesByBenchmark = new WeakMap<
  BenchmarkDefinition,
  Map<TierId, ReadonlyMap<string, string>>
>();

/**
 * Nom normalisé → nom officiel du palier, pour un benchmark. Construit une fois
 * par couple (benchmark, palier).
 *
 * Deux clés par scénario : le nom du tableur, et ce même nom **suffixé du
 * marqueur d'import** — la forme exacte que publie KovaaK's. La normalisation
 * fait tomber les deux au même endroit puisqu'elle retire ce marqueur ; la clé
 * explicite reste posée pour le benchmark qui n'en déclarerait pas.
 */
function officialNames(benchmarkId: BenchmarkId, tier: TierId): ReadonlyMap<string, string> {
  const definition = getBenchmark(benchmarkId);
  const byTier = namesByBenchmark.get(definition) ?? new Map();
  const cached = byTier.get(tier);

  if (cached !== undefined) return cached;

  const built = new Map<string, string>();
  const suffix = definition.kovaaks?.scenarioSuffix ?? "";

  for (const scenario of listScenariosFor(benchmarkId, tier)) {
    built.set(normalizeScenarioName(benchmarkId, scenario.name), scenario.name);
    built.set(normalizeScenarioName(benchmarkId, `${scenario.name}${suffix}`), scenario.name);
  }

  byTier.set(tier, built);
  namesByBenchmark.set(definition, byTier);
  return built;
}

/** Le nom officiel correspondant, ou `null` si le scénario n'est pas du palier. */
export function voltaicScenarioName(
  benchmarkId: BenchmarkId,
  tier: TierId,
  raw: string,
): string | null {
  return officialNames(benchmarkId, tier).get(normalizeScenarioName(benchmarkId, raw)) ?? null;
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
  /** Le benchmark dont les seuils et les noms ont servi à la correspondance. */
  readonly benchmarkId: BenchmarkId;
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
  benchmarkId: BenchmarkId,
  tier: TierId,
  progress: KovaaksBenchmarkProgress,
): MappedBenchmark {
  const scores: Record<string, number> = {};
  const reasons = new Map<string, MissingScenario["reason"]>();
  const unknown: string[] = [];

  for (const category of Object.values(progress.categories)) {
    for (const [rawName, entry] of Object.entries(category.scenarios)) {
      const scenario = voltaicScenarioName(benchmarkId, tier, rawName);

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
  const missing = listScenariosFor(benchmarkId, tier)
    .filter((scenario) => scores[scenario.name] === undefined)
    .map((scenario) => ({
      scenario: scenario.name,
      reason: reasons.get(scenario.name) ?? "absent",
    }));

  return { tier, benchmarkId, scores, missing, unknown };
}
