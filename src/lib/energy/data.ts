/**
 * Accès aux données Voltaic, **toujours qualifiés par une saison en interne**
 * (SPEC §5 quinquies).
 *
 * Deux familles d'accesseurs, et il faut savoir laquelle on veut :
 *
 * - **qualifiées** (`getTierFor(season, …)`) — les chemins de *lecture* d'une
 *   passe déjà enregistrée. Ils résolvent les seuils de la saison **de la
 *   passe** : une passe S5 se relit en S5, même après la sortie de la S6 ;
 * - **non qualifiées** (`getTier(…)`) — la saisie, l'aperçu live, tout ce qui
 *   parle du présent. Elles résolvent la saison *active* (la courante, sauf
 *   pendant un `withSeason`), ce qui laisse `energy.ts` inchangé : le cœur
 *   mathématique n'a jamais eu à connaître les saisons, et n'a pas à
 *   l'apprendre.
 *
 * Les index (palier → sous-catégories → scénarios) sont construits à la
 * demande, une fois par saison, et gardés : une saison, c'est ~54 scénarios,
 * et l'historique en interroge des centaines de fois par affichage.
 */

import { activeSeason, CURRENT_SEASON, getSeason, type SeasonId } from "./seasons.js";
import {
  EnergyError,
  type Scenario,
  type Subcategory,
  type Tier,
  type TierId,
  type VoltaicData,
} from "./types.js";

export const TIER_IDS = ["novice", "intermediate", "advanced"] as const satisfies readonly TierId[];

/**
 * Les 3 paliers de la saison **publiée**, dans l'ordre de progression, et ses
 * métadonnées. Ce sont des constantes de la saison `CURRENT_SEASON` : pour les
 * données d'une passe d'archive, passer par `getTierFor(run.season, …)`.
 */
export const TIERS: readonly Tier[] = getSeason(CURRENT_SEASON).data.tiers;

export const META = getSeason(CURRENT_SEASON).data.meta;

interface SeasonIndex {
  readonly tiersById: ReadonlyMap<string, Tier>;
  readonly subcategoriesByTier: ReadonlyMap<string, ReadonlyMap<string, Subcategory>>;
  readonly scenariosByTier: ReadonlyMap<string, ReadonlyMap<string, Scenario>>;
}

function buildIndex(data: VoltaicData): SeasonIndex {
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

// Clé = la définition de saison elle-même : une saison retirée du registre
// (fixture de test) laisse partir son index avec elle.
const indexes = new WeakMap<object, SeasonIndex>();

function indexOf(season: SeasonId): SeasonIndex {
  const definition = getSeason(season);
  const cached = indexes.get(definition);

  if (cached !== undefined) return cached;

  const built = buildIndex(definition.data);

  indexes.set(definition, built);
  return built;
}

/* ------------------------------------------------------------------ */
/* Accès qualifiés par saison                                          */
/* ------------------------------------------------------------------ */

/** Les 3 paliers d'une saison, dans l'ordre de progression. */
export function listTiersFor(season: SeasonId): readonly Tier[] {
  return getSeason(season).data.tiers;
}

/** Le palier d'une saison. Throw si la saison ou l'identifiant est inconnu. */
export function getTierFor(season: SeasonId, tierId: TierId): Tier {
  const tier = indexOf(season).tiersById.get(tierId);

  if (!tier) {
    throw new EnergyError(`Palier inconnu: "${tierId}" (attendu: ${TIER_IDS.join(", ")})`);
  }
  return tier;
}

/** La sous-catégorie du palier. Throw si le palier ou le nom est inconnu. */
export function getSubcategoryFor(
  season: SeasonId,
  tierId: TierId,
  subcategoryName: string,
): Subcategory {
  getTierFor(season, tierId);
  const sub = indexOf(season).subcategoriesByTier.get(tierId)?.get(subcategoryName);

  if (!sub) {
    throw new EnergyError(`Sous-catégorie inconnue: "${subcategoryName}" (palier ${tierId})`);
  }
  return sub;
}

/** Le scénario du palier. Throw si le palier ou le nom est inconnu. */
export function getScenarioFor(season: SeasonId, tierId: TierId, scenarioName: string): Scenario {
  getTierFor(season, tierId);
  const scenario = indexOf(season).scenariosByTier.get(tierId)?.get(scenarioName);

  if (!scenario) {
    throw new EnergyError(`Scénario inconnu: "${scenarioName}" (palier ${tierId})`);
  }
  return scenario;
}

/** Les 18 scénarios du palier, dans l'ordre du tableur. */
export function listScenariosFor(season: SeasonId, tierId: TierId): readonly Scenario[] {
  return getTierFor(season, tierId).categories.flatMap((category) =>
    category.subcategories.flatMap((sub) => sub.scenarios),
  );
}

/** Les 9 sous-catégories du palier, dans l'ordre du tableur. */
export function listSubcategoriesFor(season: SeasonId, tierId: TierId): readonly Subcategory[] {
  return getTierFor(season, tierId).categories.flatMap((category) => category.subcategories);
}

/* ------------------------------------------------------------------ */
/* Accès à la saison active (API publique historique, inchangée)       */
/* ------------------------------------------------------------------ */

/** Le palier demandé. Throw si l'identifiant est inconnu. */
export function getTier(tierId: TierId): Tier {
  return getTierFor(activeSeason(), tierId);
}

/** La sous-catégorie du palier. Throw si le palier ou le nom est inconnu. */
export function getSubcategory(tierId: TierId, subcategoryName: string): Subcategory {
  return getSubcategoryFor(activeSeason(), tierId, subcategoryName);
}

/** Le scénario du palier. Throw si le palier ou le nom est inconnu. */
export function getScenario(tierId: TierId, scenarioName: string): Scenario {
  return getScenarioFor(activeSeason(), tierId, scenarioName);
}

/** Les 18 scénarios du palier, dans l'ordre du tableur. */
export function listScenarios(tierId: TierId): readonly Scenario[] {
  return listScenariosFor(activeSeason(), tierId);
}

/** Les 9 sous-catégories du palier, dans l'ordre du tableur. */
export function listSubcategories(tierId: TierId): readonly Subcategory[] {
  return listSubcategoriesFor(activeSeason(), tierId);
}
