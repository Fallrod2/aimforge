/**
 * Accès aux données d'un benchmark, **toujours qualifiés en interne**
 * (SPEC §5 quinquies).
 *
 * Deux familles d'accesseurs, et il faut savoir laquelle on veut :
 *
 * - **qualifiées** (`getTierFor(benchmarkId, …)`) — les chemins de *lecture*
 *   d'une passe déjà enregistrée. Ils résolvent les seuils du benchmark **de la
 *   passe** : une passe Voltaic S5 se relit en S5, quel que soit le benchmark
 *   courant ;
 * - **non qualifiées** (`getTier(…)`) — la saisie, l'aperçu live, tout ce qui
 *   parle du présent. Elles résolvent le benchmark *actif* (le courant, sauf
 *   pendant un `withBenchmark`), ce qui laisse `energy.ts` inchangé : le cœur
 *   mathématique n'a jamais eu à connaître le registre, et n'a pas à
 *   l'apprendre.
 *
 * C'est aussi ici que vit la validation d'un **palier** : `TierId` est un
 * `string` ouvert (DECISIONS.md D5), donc « ce palier existe-t-il ? » est une
 * question qui n'a de sens que rapportée à un benchmark. `toTierId` est la
 * frontière, comme `toBenchmarkId` l'est pour le benchmark.
 *
 * Les index (palier → sous-catégories → scénarios) sont construits à la
 * demande, une fois par benchmark, et gardés : un benchmark, c'est ~54
 * scénarios, et l'historique en interroge des centaines de fois par affichage.
 */

import {
  activeBenchmark,
  type BenchmarkId,
  DEFAULT_BENCHMARK_ID,
  getBenchmark,
} from "./benchmarks.js";
import {
  type BenchmarkData,
  EnergyError,
  type Scenario,
  type Subcategory,
  type Tier,
  type TierId,
} from "./types.js";

/**
 * Les paliers du benchmark **par défaut**, dans l'ordre de progression, et ses
 * métadonnées. Ce sont des constantes de `DEFAULT_BENCHMARK_ID` : pour les
 * données d'une passe d'archive, passer par `getTierFor(run.benchmarkId, …)`.
 */
export const TIERS: readonly Tier[] = getBenchmark(DEFAULT_BENCHMARK_ID).data.tiers;

export const META = getBenchmark(DEFAULT_BENCHMARK_ID).data.meta;

interface BenchmarkIndex {
  readonly tiersById: ReadonlyMap<string, Tier>;
  readonly subcategoriesByTier: ReadonlyMap<string, ReadonlyMap<string, Subcategory>>;
  readonly scenariosByTier: ReadonlyMap<string, ReadonlyMap<string, Scenario>>;
}

function buildIndex(data: BenchmarkData): BenchmarkIndex {
  const tiers = data.tiers;

  return {
    tiersById: new Map(tiers.map((tier) => [tier.id, tier])),
    subcategoriesByTier: new Map(
      tiers.map((tier) => [
        tier.id,
        new Map(
          tier.categories.flatMap((category) =>
            category.subcategories.map((sub) => [sub.name, sub] as const),
          ),
        ),
      ]),
    ),
    scenariosByTier: new Map(
      tiers.map((tier) => [
        tier.id,
        new Map(
          tier.categories.flatMap((category) =>
            category.subcategories.flatMap((sub) =>
              sub.scenarios.map((scenario) => [scenario.name, scenario] as const),
            ),
          ),
        ),
      ]),
    ),
  };
}

// Clé = la définition de benchmark elle-même : un benchmark retiré du registre
// (fixture de test) laisse partir son index avec lui.
const indexes = new WeakMap<object, BenchmarkIndex>();

function indexOf(benchmarkId: BenchmarkId): BenchmarkIndex {
  const definition = getBenchmark(benchmarkId);
  const cached = indexes.get(definition);

  if (cached !== undefined) return cached;

  const built = buildIndex(definition.data);

  indexes.set(definition, built);
  return built;
}

/* ------------------------------------------------------------------ */
/* Accès qualifiés par benchmark                                       */
/* ------------------------------------------------------------------ */

/** Les paliers d'un benchmark, dans l'ordre de progression. */
export function listTiersFor(benchmarkId: BenchmarkId): readonly Tier[] {
  return getBenchmark(benchmarkId).data.tiers;
}

/** Les identifiants des paliers d'un benchmark, dans l'ordre de progression. */
export function tierIdsFor(benchmarkId: BenchmarkId): readonly TierId[] {
  return listTiersFor(benchmarkId).map((tier) => tier.id);
}

/**
 * Le palier le plus bas d'un benchmark — celui par lequel on commence.
 *
 * C'est le repli de tout ce qui doit désigner un palier sans rien savoir du
 * joueur (tracker vierge, contexte de coach sans passe). L'ordre du tableau
 * fait foi : un benchmark ordonne ses paliers, il n'y a rien à trier.
 */
export function firstTierFor(benchmarkId: BenchmarkId): TierId {
  const first = listTiersFor(benchmarkId)[0];

  if (first === undefined) {
    throw new EnergyError(`Benchmark sans palier: "${benchmarkId}"`);
  }
  return first.id;
}

/** Le palier d'un benchmark. Throw si le benchmark ou l'identifiant est inconnu. */
export function getTierFor(benchmarkId: BenchmarkId, tierId: TierId): Tier {
  const tier = indexOf(benchmarkId).tiersById.get(tierId);

  if (!tier) {
    throw new EnergyError(
      `Palier inconnu: "${tierId}" (attendu: ${tierIdsFor(benchmarkId).join(", ")})`,
    );
  }
  return tier;
}

/**
 * Une valeur brute (colonne `bench_runs.tier`, champ d'un contrat HTTP) → un
 * `TierId` validé **contre ce benchmark**. Throw si le palier n'y existe pas.
 *
 * Même patron que `toBenchmarkId` : au-delà de cette frontière, un palier est
 * forcément un palier du benchmark auquel il est rapporté.
 */
export function toTierId(benchmarkId: BenchmarkId, value: string): TierId {
  return getTierFor(benchmarkId, value).id;
}

/** La sous-catégorie du palier. Throw si le palier ou le nom est inconnu. */
export function getSubcategoryFor(
  benchmarkId: BenchmarkId,
  tierId: TierId,
  subcategoryName: string,
): Subcategory {
  getTierFor(benchmarkId, tierId);
  const sub = indexOf(benchmarkId).subcategoriesByTier.get(tierId)?.get(subcategoryName);

  if (!sub) {
    throw new EnergyError(`Sous-catégorie inconnue: "${subcategoryName}" (palier ${tierId})`);
  }
  return sub;
}

/** Le scénario du palier. Throw si le palier ou le nom est inconnu. */
export function getScenarioFor(
  benchmarkId: BenchmarkId,
  tierId: TierId,
  scenarioName: string,
): Scenario {
  getTierFor(benchmarkId, tierId);
  const scenario = indexOf(benchmarkId).scenariosByTier.get(tierId)?.get(scenarioName);

  if (!scenario) {
    throw new EnergyError(`Scénario inconnu: "${scenarioName}" (palier ${tierId})`);
  }
  return scenario;
}

/** Les scénarios du palier, dans l'ordre du tableur. */
export function listScenariosFor(benchmarkId: BenchmarkId, tierId: TierId): readonly Scenario[] {
  return getTierFor(benchmarkId, tierId).categories.flatMap((category) =>
    category.subcategories.flatMap((sub) => sub.scenarios),
  );
}

/** Les sous-catégories du palier, dans l'ordre du tableur. */
export function listSubcategoriesFor(
  benchmarkId: BenchmarkId,
  tierId: TierId,
): readonly Subcategory[] {
  return getTierFor(benchmarkId, tierId).categories.flatMap((category) => category.subcategories);
}

/* ------------------------------------------------------------------ */
/* Accès au benchmark actif (API publique historique, inchangée)       */
/* ------------------------------------------------------------------ */

/** Le palier demandé. Throw si l'identifiant est inconnu. */
export function getTier(tierId: TierId): Tier {
  return getTierFor(activeBenchmark(), tierId);
}

/** La sous-catégorie du palier. Throw si le palier ou le nom est inconnu. */
export function getSubcategory(tierId: TierId, subcategoryName: string): Subcategory {
  return getSubcategoryFor(activeBenchmark(), tierId, subcategoryName);
}

/** Le scénario du palier. Throw si le palier ou le nom est inconnu. */
export function getScenario(tierId: TierId, scenarioName: string): Scenario {
  return getScenarioFor(activeBenchmark(), tierId, scenarioName);
}

/** Les scénarios du palier, dans l'ordre du tableur. */
export function listScenarios(tierId: TierId): readonly Scenario[] {
  return listScenariosFor(activeBenchmark(), tierId);
}

/** Les sous-catégories du palier, dans l'ordre du tableur. */
export function listSubcategories(tierId: TierId): readonly Subcategory[] {
  return listSubcategoriesFor(activeBenchmark(), tierId);
}
