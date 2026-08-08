import rawData from "../../../voltaic-s5-data.json";
import {
  EnergyError,
  type Scenario,
  type Subcategory,
  type Tier,
  type TierId,
  type VoltaicData,
} from "./types";

// voltaic-s5-data.json est la source de vérité versionnée du repo : on le type
// ici plutôt que de le valider au runtime (la lib reste sans dépendance, donc
// sans Zod). Les invariants de structure sont verrouillés par data.test.ts.
const data = rawData as unknown as VoltaicData;

export const TIER_IDS = ["novice", "intermediate", "advanced"] as const satisfies readonly TierId[];

/** Les 3 paliers, dans l'ordre de progression. */
export const TIERS: readonly Tier[] = data.tiers;

export const META = data.meta;

const tiersById = new Map<string, Tier>(TIERS.map((tier) => [tier.id, tier]));

const subcategoriesByTier = new Map<string, Map<string, Subcategory>>(
  TIERS.map((tier) => [
    tier.id,
    new Map(
      tier.categories.flatMap((category) =>
        category.subcategories.map((sub) => [sub.name, sub] as const),
      ),
    ),
  ]),
);

const scenariosByTier = new Map<string, Map<string, Scenario>>(
  TIERS.map((tier) => [
    tier.id,
    new Map(
      tier.categories.flatMap((category) =>
        category.subcategories.flatMap((sub) =>
          sub.scenarios.map((scenario) => [scenario.name, scenario] as const),
        ),
      ),
    ),
  ]),
);

/** Le palier demandé. Throw si l'identifiant est inconnu. */
export function getTier(tierId: TierId): Tier {
  const tier = tiersById.get(tierId);

  if (!tier) {
    throw new EnergyError(`Palier inconnu: "${tierId}" (attendu: ${TIER_IDS.join(", ")})`);
  }
  return tier;
}

/** La sous-catégorie du palier. Throw si le palier ou le nom est inconnu. */
export function getSubcategory(tierId: TierId, subcategoryName: string): Subcategory {
  getTier(tierId);
  const sub = subcategoriesByTier.get(tierId)?.get(subcategoryName);

  if (!sub) {
    throw new EnergyError(`Sous-catégorie inconnue: "${subcategoryName}" (palier ${tierId})`);
  }
  return sub;
}

/** Le scénario du palier. Throw si le palier ou le nom est inconnu. */
export function getScenario(tierId: TierId, scenarioName: string): Scenario {
  getTier(tierId);
  const scenario = scenariosByTier.get(tierId)?.get(scenarioName);

  if (!scenario) {
    throw new EnergyError(`Scénario inconnu: "${scenarioName}" (palier ${tierId})`);
  }
  return scenario;
}

/** Les 18 scénarios du palier, dans l'ordre du tableur. */
export function listScenarios(tierId: TierId): readonly Scenario[] {
  return getTier(tierId).categories.flatMap((category) =>
    category.subcategories.flatMap((sub) => sub.scenarios),
  );
}

/** Les 9 sous-catégories du palier, dans l'ordre du tableur. */
export function listSubcategories(tierId: TierId): readonly Subcategory[] {
  return getTier(tierId).categories.flatMap((category) => category.subcategories);
}
