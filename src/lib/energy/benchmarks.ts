/**
 * Registre des **benchmarks** — le verrou de relecture (SPEC §5 quinquies,
 * DECISIONS.md D4).
 *
 * Le problème qu'il résout : les énergies de sous-catégories et le rang overall
 * d'une passe ne sont **pas** stockés, ils sont dérivés à la lecture depuis le
 * jeu de données. Tant qu'il n'existait qu'un jeu de données, cette dérivation
 * était sans risque. Le jour où la Voltaic S6 remplace la S5 — ou le jour où un
 * autre benchmark, d'un autre éditeur, entre dans l'application — la même passe
 * se relit avec d'autres seuils et l'historique change de valeurs sans que
 * personne ne l'ait demandé. Un benchmark n'est donc pas une étiquette
 * d'affichage : c'est ce qui décide *avec quels seuils et quelle formule* une
 * passe se relit, pour toujours.
 *
 * Trois pièces, et pas une de plus :
 *
 * 1. **le registre** `BENCHMARKS` — un identifiant → une définition complète
 *    (métadonnées produit, grammaire de nommage, formule d'énergie, seuils,
 *    métadonnées d'import KovaaK's) ;
 * 2. **le benchmark courant** — celui qu'estampillent les écritures. Un seul à
 *    la fois : la sélection par l'utilisateur est un autre chantier
 *    (DECISIONS.md D6), ici il y a le benchmark publié et l'historique ;
 * 3. **le benchmark actif en résolution** (`withBenchmark`) — celui dont les
 *    accesseurs non qualifiés de `data.ts` servent les données pendant un
 *    calcul. C'est l'unique moyen de faire tourner le cœur mathématique
 *    (`energy.ts`, figé au caractère près) sur un autre benchmark que le
 *    courant, sans dupliquer une seule ligne d'interpolation.
 *
 * `BenchmarkId` est un `string` **marqué**, pas une union fermée : un nouveau
 * benchmark arrivera par un ajout de données ici, pas par un élargissement de
 * type qui obligerait à retoucher chaque signature du projet. Le marquage force
 * en revanche à passer par `toBenchmarkId` pour transformer une valeur venue de
 * la base — c'est là, et nulle part ailleurs, qu'un benchmark inconnu est
 * refusé.
 */

import rawVoltaicS5 from "../../../voltaic-s5-data.json" with { type: "json" };
import { type BenchmarkData, EnergyError, type EnergyFormulaId, type TierId } from "./types.js";

/**
 * Identifiant d'un benchmark (`voltaic-s5`, `viscose-…`).
 *
 * Marqué pour qu'un `string` quelconque ne s'y glisse pas : une valeur brute
 * (colonne `bench_runs.season`, cf. la migration 0017) doit passer par
 * `toBenchmarkId`, qui la valide.
 */
declare const benchmarkBrand: unique symbol;

export type BenchmarkId = string & { readonly [benchmarkBrand]: true };

/**
 * L'aim trainer sur lequel le benchmark se joue.
 *
 * Ce n'est pas une décoration : les noms de scénarios, les échelles de scores
 * et les mécanismes d'import diffèrent d'un trainer à l'autre.
 */
export type AimTrainer = "kovaaks" | "aimlabs";

/**
 * Où en est le benchmark chez son éditeur.
 *
 * `incomplete` désigne un benchmark dont le jeu de données n'est pas fini
 * (seuils partiels, paliers manquants) : il reste enregistrable — pour être
 * travaillé, testé, comparé — mais `listBenchmarks()` ne le rend pas, donc
 * l'UI ne le propose jamais.
 */
export type BenchmarkStatus = "stable" | "beta" | "incomplete";

/**
 * La grammaire de nommage des scénarios du benchmark.
 *
 * Trois endroits du projet en dépendaient en dur (police anti-hallucination des
 * citations, libellé d'affichage, correspondance des noms importés). Ils la
 * tirent maintenant d'ici : un benchmark qui ne préfixerait pas ses scénarios,
 * ou qui n'y répéterait pas le palier, n'a rien à corriger dans le code.
 */
export interface BenchmarkNaming {
  /**
   * Le mot par lequel s'ouvre tout nom de scénario du benchmark (`VT`).
   *
   * C'est le repère de la police des citations : une mention de ce marqueur
   * dans une réponse de modèle doit être le début exact d'un nom autorisé.
   */
  readonly scenarioMarker: string;
  /**
   * Le préfixe retiré à l'affichage (`VT` → « VT Pasu Novice » s'écrit
   * « Pasu »). Le séparateur (blancs) n'en fait pas partie.
   */
  readonly displayPrefix: string;
  /**
   * Le nom d'un scénario se termine-t-il par le libellé de son palier
   * (« VT Pasu **Novice** ») ? Si oui, l'affichage le retire : le palier est
   * déjà à l'écran, et il est sur les 18 lignes.
   */
  readonly tierLabelSuffix: boolean;
}

/**
 * Ce que l'import KovaaK's doit savoir d'un benchmark.
 *
 * Ces deux valeurs changent à chaque publication et n'ont rien à faire en dur
 * dans le module d'import : le Benchmark Tracker republie des benchmarks sous
 * de nouveaux identifiants, et suffixe les noms de scénarios du marqueur de
 * saison (`VT Pasu Novice S5`).
 */
export interface KovaaksImport {
  /** Identifiant du benchmark officiel du Benchmark Tracker, par palier. */
  readonly benchmarkIds: Readonly<Record<TierId, number>>;
  /** Ce que KovaaK's ajoute au nom du tableur (`" S5"`). */
  readonly scenarioSuffix: string;
}

/** Un benchmark : son identité, sa grammaire, sa formule, ses seuils. */
export interface BenchmarkDefinition {
  readonly id: BenchmarkId;
  /** Nom affichable (« Voltaic S5 »). */
  readonly name: string;
  /** Qui le publie (« Voltaic »). */
  readonly publisher: string;
  /** Saison de l'éditeur, `null` pour un benchmark qui n'en a pas. */
  readonly season: string | null;
  readonly status: BenchmarkStatus;
  /** Le document officiel dont les seuils sont extraits. */
  readonly sourceUrl: string;
  /** Date d'extraction du jeu de données (`meta.extractedAt` du fichier). */
  readonly dataVersion: string;
  readonly aimTrainer: AimTrainer;
  readonly energyFormula: EnergyFormulaId;
  readonly naming: BenchmarkNaming;
  readonly data: BenchmarkData;
  /** `null` pour un benchmark qui ne s'importe pas depuis KovaaK's. */
  readonly kovaaks: KovaaksImport | null;
}

/**
 * `voltaic-s5-data.json` est la source de vérité versionnée du repo : on le
 * type ici plutôt que de le valider au runtime (la lib reste sans dépendance,
 * donc sans Zod). Les invariants de structure sont verrouillés par
 * `data.test.ts`.
 */
const voltaicS5Data = rawVoltaicS5 as unknown as BenchmarkData;

/** Le benchmark publié par défaut. Toute écriture l'estampille. */
export const DEFAULT_BENCHMARK_ID = "voltaic-s5" as BenchmarkId;

/**
 * Voltaic S5.
 *
 * Les métadonnées produit vivent ici, dans le littéral TS, et non dans
 * `voltaic-s5-data.json` : ce fichier est la source de vérité **métier** des
 * seuils, on ne l'édite pas pour y loger de l'identité applicative. `sourceUrl`
 * et `dataVersion` reprennent donc `meta.source` et `meta.extractedAt` du
 * fichier plutôt que de les redire autrement.
 */
const VOLTAIC_S5: BenchmarkDefinition = {
  id: DEFAULT_BENCHMARK_ID,
  name: "Voltaic S5",
  publisher: "Voltaic",
  season: "Season 5",
  // Voltaic publie la S5 en BETA : le dire est plus honnête que de la présenter
  // comme figée, et l'UI peut le signaler.
  status: "beta",
  sourceUrl: "https://docs.google.com/spreadsheets/d/1RjVJi9AdWLXIOkKR8z6mhmRo_SNokJPxKtLXHWk12Z4",
  dataVersion: "2026-08-08",
  aimTrainer: "kovaaks",
  energyFormula: "voltaic-anchors",
  naming: {
    scenarioMarker: "VT",
    displayPrefix: "VT",
    tierLabelSuffix: true,
  },
  data: voltaicS5Data,
  kovaaks: {
    /**
     * Les benchmarks Voltaic S5 officiels du Benchmark Tracker (auteur
     * « Tammas »). Ce sont les seuls dont les 18 scénarios correspondent au
     * tableur ; les innombrables copies communautaires ne sont pas des sources
     * de vérité.
     */
    benchmarkIds: { novice: 432, intermediate: 431, advanced: 427 },
    scenarioSuffix: " S5",
  },
};

/**
 * Le registre. Mutable parce qu'un test doit pouvoir y déposer un benchmark
 * factice le temps d'une assertion (cf. `registerBenchmark`) — le code
 * applicatif, lui, n'a accès qu'aux lectures : `index.ts` n'exporte ni
 * `registerBenchmark` ni `setCurrentBenchmark`.
 */
const BENCHMARKS = new Map<string, BenchmarkDefinition>([[DEFAULT_BENCHMARK_ID, VOLTAIC_S5]]);

/** Le benchmark courant effectif ; `DEFAULT_BENCHMARK_ID` hors surcharge de test. */
let currentBenchmarkId: BenchmarkId = DEFAULT_BENCHMARK_ID;

/**
 * Le benchmark dont `data.ts` sert les données pour un accès non qualifié.
 * `null` = « suis le benchmark courant » ; renseigné seulement pendant un
 * `withBenchmark`.
 */
let activeBenchmarkId: BenchmarkId | null = null;

/* ------------------------------------------------------------------ */
/* Lecture du registre                                                 */
/* ------------------------------------------------------------------ */

/**
 * Les benchmarks connus, dans l'ordre d'enregistrement.
 *
 * Les définitions complètes, et pas seulement leurs identifiants : c'est cette
 * liste qui alimentera le sélecteur, lequel a besoin du nom affichable, de
 * l'éditeur et du statut.
 *
 * Un benchmark `incomplete` est **exclu par défaut** : il existe pour être
 * travaillé, pas pour être proposé à quelqu'un qui y enregistrerait des passes
 * relues avec des seuils partiels.
 */
export function listBenchmarks(includeIncomplete = false): readonly BenchmarkDefinition[] {
  const all = [...BENCHMARKS.values()];

  return includeIncomplete ? all : all.filter((benchmark) => benchmark.status !== "incomplete");
}

/** Les identifiants des benchmarks connus, mêmes règles que `listBenchmarks`. */
export function listBenchmarkIds(includeIncomplete = false): readonly BenchmarkId[] {
  return listBenchmarks(includeIncomplete).map((benchmark) => benchmark.id);
}

/**
 * Le benchmark demandé. Throw s'il est inconnu.
 *
 * Jamais de repli sur le benchmark courant : relire une passe Voltaic S5 avec
 * les seuils d'un autre benchmark parce que « voltaic-s5 » n'a pas été trouvé
 * produirait des valeurs fausses *silencieusement*, ce qui est exactement le
 * risque contre lequel ce module existe. Mieux vaut une erreur lisible.
 *
 * `getBenchmark` sert aussi les benchmarks `incomplete` : ils sont absents de
 * la liste proposée, pas du registre — une passe qui en porterait un doit
 * pouvoir se relire.
 */
export function getBenchmark(benchmarkId: BenchmarkId | string): BenchmarkDefinition {
  const found = BENCHMARKS.get(benchmarkId);

  if (found === undefined) {
    throw new EnergyError(
      `Benchmark inconnu: "${benchmarkId}" (connus: ${[...BENCHMARKS.keys()].join(", ")})`,
    );
  }
  return found;
}

/**
 * Une valeur brute (colonne `bench_runs.season`) → un `BenchmarkId` validé.
 * C'est la frontière : au-delà, un benchmark est forcément connu du registre.
 */
export function toBenchmarkId(value: string): BenchmarkId {
  return getBenchmark(value).id;
}

/** Le benchmark qu'estampillent les écritures. */
export function currentBenchmark(): BenchmarkId {
  return currentBenchmarkId;
}

/** Le benchmark servi par les accesseurs non qualifiés de `data.ts`. */
export function activeBenchmark(): BenchmarkId {
  return activeBenchmarkId ?? currentBenchmarkId;
}

/* ------------------------------------------------------------------ */
/* Résolution qualifiée                                                */
/* ------------------------------------------------------------------ */

/**
 * Exécute `fn` en résolvant les données de `benchmarkId`.
 *
 * C'est le pivot du verrou. `energy.ts` — le cœur mathématique, figé au
 * caractère près après audit — appelle `getTier`/`getScenario`/`getSubcategory`
 * sans savoir qu'un registre existe. Plutôt que de dupliquer son interpolation
 * dans une variante « par benchmark » (deux implémentations qui dériveraient,
 * sur le seul code du projet qu'on ne peut pas se permettre de voir diverger),
 * on déplace le point de résolution : le temps de l'appel, ces accesseurs
 * servent les données du benchmark demandé.
 *
 * La portée est **synchrone et rétablie en `finally`**, y compris imbriquée.
 * Une continuation `await` sortirait de la portée sans qu'on le voie : un `fn`
 * qui rend un thenable est donc refusé, plutôt que de laisser passer un calcul
 * dont la moitié aurait été résolue dans le mauvais benchmark.
 */
export function withBenchmark<T>(benchmarkId: BenchmarkId, fn: () => T): T {
  const previous = activeBenchmarkId;

  activeBenchmarkId = getBenchmark(benchmarkId).id;
  try {
    const result = fn();

    if (typeof (result as { then?: unknown } | null)?.then === "function") {
      throw new EnergyError(
        "withBenchmark n'accepte qu'un calcul synchrone (la portée ne survit pas à un await).",
      );
    }
    return result;
  } finally {
    activeBenchmarkId = previous;
  }
}

/* ------------------------------------------------------------------ */
/* Crochets de test — jamais réexportés par index.ts                   */
/* ------------------------------------------------------------------ */

/**
 * Dépose un benchmark dans le registre et rend de quoi l'en retirer.
 *
 * **Réservé aux tests** (cf. `fixtures.ts`) : la seule façon honnête de prouver
 * le verrou est de faire exister un second benchmark. Il n'est pas exporté par
 * `index.ts`, donc hors d'atteinte du code applicatif.
 */
export function registerBenchmark(benchmark: BenchmarkDefinition): () => void {
  if (BENCHMARKS.has(benchmark.id)) {
    throw new EnergyError(`Benchmark déjà enregistré: "${benchmark.id}"`);
  }
  BENCHMARKS.set(benchmark.id, benchmark);
  return () => {
    BENCHMARKS.delete(benchmark.id);
  };
}

/**
 * Force le benchmark courant et rend de quoi rétablir le précédent.
 * **Réservé aux tests** : en production, le courant est `DEFAULT_BENCHMARK_ID`.
 */
export function setCurrentBenchmark(benchmarkId: BenchmarkId): () => void {
  const previous = currentBenchmarkId;

  currentBenchmarkId = getBenchmark(benchmarkId).id;
  return () => {
    currentBenchmarkId = previous;
  };
}
