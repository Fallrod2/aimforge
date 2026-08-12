/** Types d'un benchmark d'aim trainer. Lib pure : aucune dépendance externe. */

/**
 * Identifiant d'un palier (`novice`, `intermediate`, `advanced`…).
 *
 * **Volontairement ouvert** (DECISIONS.md D5) : les trois paliers Voltaic sont
 * une structure de *ce* benchmark, pas du domaine. Un autre benchmark peut en
 * avoir d'autres, ou un seul — une union fermée obligerait à retoucher le type
 * à chaque benchmark ajouté, c'est-à-dire à retoucher le code pour ajouter une
 * donnée.
 *
 * Il n'est pas marqué, à la différence de `BenchmarkId` : un palier ne se
 * valide que **contre un benchmark**, et le marquage forcerait un cast dans
 * chaque littéral (`"novice"`) alors que la vérification utile — « ce palier
 * existe-t-il dans ce benchmark ? » — vit dans `toTierId(benchmarkId, value)`.
 */
export type TierId = string;

/**
 * Identifiant d'une formule d'énergie (`voltaic-anchors`…).
 *
 * Une définition de benchmark nomme sa formule ; le registre de `formulas.ts`
 * la résout en implémentation. C'est le point de branchement qui permet à un
 * benchmark d'un autre éditeur de calculer autrement sans toucher au cœur
 * mathématique Voltaic.
 */
export type EnergyFormulaId = string;

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

/** Un palier du benchmark (Voltaic : Novice, Intermediate, Advanced). */
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

/**
 * Les métadonnées du jeu de données lui-même, telles que le fichier source les
 * porte. À ne pas confondre avec les métadonnées **produit** d'un benchmark
 * (nom affichable, éditeur, statut…), qui vivent dans `BenchmarkDefinition` :
 * celles-ci décrivent le fichier, celles-là décrivent le benchmark.
 */
export interface BenchmarkMeta {
  readonly season: string;
  readonly source: string;
  readonly extractedAt: string;
  readonly note: string;
}

/** Le jeu de données complet d'un benchmark : ses paliers et leurs seuils. */
export interface BenchmarkData {
  readonly meta: BenchmarkMeta;
  readonly tiers: readonly Tier[];
}

/** Scores d'une passe de bench, indexés par nom de scénario. */
export type ScoreMap = Readonly<Record<string, number>>;

/** Erreur métier du moteur d'énergie (palier/scénario/score invalides). */
export class EnergyError extends Error {
  override readonly name = "EnergyError";
}
