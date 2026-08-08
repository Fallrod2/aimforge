/** Types du benchmark Voltaic S5. Lib pure : aucune dépendance externe. */

export type TierId = "novice" | "intermediate" | "advanced";

/** Un scénario KovaaK's et ses seuils, un par ancre d'énergie du palier. */
export interface Scenario {
  readonly name: string;
  readonly thresholds: readonly number[];
}

/** Une sous-catégorie (Dynamic, Static…) : toujours 2 scénarios. */
export interface Subcategory {
  readonly name: string;
  readonly scenarios: readonly Scenario[];
}

/** Une catégorie : Clicking, Tracking ou Switching. */
export interface Category {
  readonly name: string;
  readonly subcategories: readonly Subcategory[];
}

/** Un rang overall et sa couleur officielle (utilisée telle quelle par l'UI). */
export interface Rank {
  readonly name: string;
  readonly minEnergy: number;
  readonly color: string;
}

/** Un palier : Novice, Intermediate ou Advanced. */
export interface Tier {
  readonly id: TierId;
  readonly label: string;
  /** Identifiant du benchmark KovaaK's ; `null` quand le JSON ne le fournit pas. */
  readonly kovaaksBenchmarkId: number | null;
  readonly sharecode: string;
  /** Libellés des ancres, du plus bas au plus haut (ex. "Iron", "Iron II"…). */
  readonly anchorLabels: readonly string[];
  /** Énergie de chaque ancre ; la dernière vaut `maxEnergy`. */
  readonly anchorEnergies: readonly number[];
  /** Rangs overall du palier, par énergie minimale croissante. */
  readonly overallRanks: readonly Rank[];
  readonly maxEnergy: number;
  readonly categories: readonly Category[];
}

export interface VoltaicMeta {
  readonly season: string;
  readonly source: string;
  readonly extractedAt: string;
  readonly note: string;
}

export interface VoltaicData {
  readonly meta: VoltaicMeta;
  readonly tiers: readonly Tier[];
}

/** Scores d'une passe de bench, indexés par nom de scénario. */
export type ScoreMap = Readonly<Record<string, number>>;

/** Erreur métier du moteur d'énergie (palier/scénario/score invalides). */
export class EnergyError extends Error {
  override readonly name = "EnergyError";
}
