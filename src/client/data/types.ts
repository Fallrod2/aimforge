/**
 * Les types que l'UI manipule. Ils ne sont plus dérivés d'un contrat HTTP :
 * depuis P2 le client parle directement à Postgres (Supabase + RLS), donc
 * c'est ici, à la frontière de la base, qu'on nomme les formes échangées.
 *
 * Les lignes brutes (`Tables<"bench_runs">`…) ne remontent jamais dans les
 * vues : `tier` y est un `text` quelconque, alors que l'UI a besoin d'un
 * `TierId`. La conversion vit dans `mapping.ts`.
 */

import type {
  BenchmarkId,
  ComputedScenarioScore,
  ComputedSubcategory,
  TierId,
} from "../../lib/energy";
import type { GameId } from "../../shared/game-vocab";

/**
 * D'où viennent les scores d'une passe (miroir du `check` de la colonne
 * `bench_runs.source`). Ce n'est pas une décoration : une passe importée n'a
 * pas été relevée à la main, et l'historique doit pouvoir le dire — c'est la
 * seule façon de savoir, plus tard, ce qui a été mesuré et ce qui a été recopié.
 */
export const BENCH_SOURCES = ["manual", "kovaaks"] as const;

export type BenchSource = (typeof BENCH_SOURCES)[number];

/** Une passe telle que l'affiche la liste de l'historique. */
export interface BenchRunSummary {
  readonly id: number;
  /** Horodatage ISO 8601 (`timestamptz` rendu par PostgREST). */
  readonly date: string;
  readonly tier: TierId;
  /**
   * Le benchmark **de la passe** (SPEC §5 quinquies). Il décide des seuils et
   * de la formule avec lesquels la passe se relit : une passe Voltaic S5 garde
   * ses valeurs S5 quel que soit le benchmark courant. Ce n'est pas une
   * décoration d'affichage.
   *
   * Il vient de la colonne `bench_runs.benchmark_id` (migration `0017`) : la
   * traduction se fait dans `mapping.ts`, et nulle part ailleurs.
   */
  readonly benchmarkId: BenchmarkId;
  /** Moyenne harmonique des 9 sous-catégories ; 0 si le bench est incomplet. */
  readonly overall: number;
  /** Rang overall atteint, `null` sous le premier rang du palier. */
  readonly rank: string | null;
  /** Badge « Complete » : les 18 scénarios atteignent le seuil de `rank`. */
  readonly complete: boolean;
  readonly source: BenchSource;
}

/** Le score d'un scénario, avec l'énergie figée en base au moment du calcul. */
export type ScenarioScore = ComputedScenarioScore;

export type SubcategoryEnergy = ComputedSubcategory;

/** Une passe dépliée : ses scénarios renseignés et ses 9 sous-catégories. */
export interface BenchRunDetail extends BenchRunSummary {
  readonly scores: readonly ScenarioScore[];
  readonly subcategories: readonly SubcategoryEnergy[];
}

/** Ce que le tracker envoie : des scores bruts, rien de calculé. */
export interface SaveBenchRunInput {
  readonly tier: TierId;
  /** Scores partiels autorisés ; au moins un scénario renseigné. */
  readonly scores: Readonly<Record<string, number>>;
  /** Date de la passe ; par défaut « maintenant ». */
  readonly date?: string;
  /** Provenance des scores ; « saisis à la main » par défaut. */
  readonly source?: BenchSource;
  /**
   * Le benchmark estampillé. Par défaut le benchmark **courant** de la lib, que
   * le provider de benchmark actif tient aligné sur `profiles.active_benchmark`
   * (DECISIONS.md D6) : le tracker le passe explicitement, parce qu'il l'a sous
   * la main et que le dire vaut mieux que de le supposer.
   */
  readonly benchmarkId?: BenchmarkId;
}

/**
 * Ce que la page Profil enregistre : les six champs libres et le jeu.
 *
 * Le jeu ne pilote que du vocabulaire (DECISIONS.md D7) : les colonnes qui
 * portent ces champs gardent leurs noms (`rang_valorant`, `main_agent`), seuls
 * les libellés affichés changent.
 */
export interface ProfileInput {
  readonly pseudo: string | null;
  readonly rangValorant: string | null;
  readonly peak: string | null;
  readonly mainAgent: string | null;
  readonly objectif: string | null;
  readonly notesMaps: string | null;
  readonly game: GameId;
}

/** Le profil joueur relu, préférence de benchmark comprise. */
export interface Profile extends ProfileInput {
  /**
   * Le benchmark que l'utilisateur a choisi de jouer (`profiles.active_benchmark`,
   * DECISIONS.md D6). Il n'est pas écrit par le formulaire : le sélecteur de
   * benchmark l'écrit seul (`setActiveBenchmark`).
   */
  readonly activeBenchmark: BenchmarkId;
}
