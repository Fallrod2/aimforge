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
 * 2. **le benchmark courant** — celui qu'estampillent les écritures et celui
 *    dont les accesseurs non qualifiés servent les données. Il suit le
 *    benchmark actif de l'utilisateur (`profiles.active_benchmark`,
 *    DECISIONS.md D6) : le boot applicatif et le sélecteur l'alignent par
 *    `setCurrentBenchmark`, réexporté sous le nom `syncCurrentBenchmark` ;
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
 * (colonne `bench_runs.benchmark_id`, ou `profiles.active_benchmark`, cf. les
 * migrations 0017 et 0019) doit passer par `toBenchmarkId`, qui la valide.
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
 * `incomplete` désigne un benchmark **sans barème calculable** : ses seuils sont
 * peut-être connus et versionnés (Viscose S2), mais il manque de quoi en tirer
 * une énergie ou un rang, et le registre refuse de faire semblant. L'entrée
 * existe pour être travaillée, citée, complétée — jamais pour calculer :
 * `data` y vaut `null` (invariant vérifié à l'enregistrement) et
 * `listBenchmarks()` ne la rend pas, donc l'UI ne la propose jamais.
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
  /**
   * Les seuils, ou `null` quand il n'y a **rien de calculable**.
   *
   * `data === null` ⟺ `status === "incomplete"` : l'équivalence est vérifiée à
   * l'enregistrement (`checkedBenchmark`), et c'est elle qui rend le `null`
   * sûr. Personne ne lit ce champ directement pour calculer : `benchmarkData`
   * est le seul chemin, et il lève au lieu de rendre `null`.
   */
  readonly data: BenchmarkData | null;
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
 * Viscose S2 — entrée **honnête**, donc muette (DECISIONS.md D8).
 *
 * TODO: formule d'agrégation officielle Viscose non documentée — seuils par
 * scénario vérifiés (API KovaaK's), voir viscose-s2-data.json
 *
 * Ce qui est vérifié : les seuils de score par rang, scénario par scénario, des
 * quatre difficultés (API officielle `player-progress-rank-benchmark`,
 * benchmarkId 2335-2338, recoupée avec le tableur officiel S1). Ils sont
 * versionnés dans `viscose-s2-data.json`.
 *
 * Ce qui manque, et qui interdit tout calcul : la façon dont Viscose agrège un
 * scénario en catégorie puis en rang global n'est publiée nulle part. D'où
 * `data: null` — pas de barème calculable — plutôt qu'un jeu de données
 * partiel qui laisserait `energy.ts` produire des rangs Voltaic sous un nom
 * Viscose. Pour la même raison, `energyFormula` nomme une formule que le
 * registre des formules ne connaît pas : la résoudre lève, au lieu de rendre
 * silencieusement celle d'un autre éditeur.
 *
 * `kovaaks: null` alors que les identifiants de benchmark KovaaK's sont connus
 * (ils sont dans le fichier de données) : l'import fait correspondre les noms
 * ramenés aux scénarios **du barème**, et il n'y en a pas. Un import qui
 * n'aboutit à rien doit lever, pas rendre dix-huit champs vides.
 */
const VISCOSE_S2: BenchmarkDefinition = {
  id: "viscose-s2" as BenchmarkId,
  name: "Viscose S2",
  publisher: "Viscose",
  season: "Season 2",
  status: "incomplete",
  sourceUrl:
    "https://kovaaks.com/webapp-backend/benchmarks/player-progress-rank-benchmark?benchmarkId=2335",
  dataVersion: "2026-08-12",
  aimTrainer: "kovaaks",
  // Volontairement absente du registre des formules : cf. l'en-tête.
  energyFormula: "viscose-inconnue",
  // Les noms de scénarios Viscose n'ont ni marqueur commun ni suffixe de
  // palier : la grammaire est vide plutôt qu'inventée. Rien ne la lit — les
  // accesseurs de nommage lèvent aussi sur un benchmark sans barème.
  naming: {
    scenarioMarker: "",
    displayPrefix: "",
    tierLabelSuffix: false,
  },
  data: null,
  kovaaks: null,
};

/**
 * L'invariant du registre : `data === null` ⟺ `status === "incomplete"`.
 *
 * Les deux moitiés comptent. Un benchmark `incomplete` qui garderait un barème
 * laisserait calculer des énergies sur des seuils qu'on vient de déclarer
 * insuffisants ; un benchmark sans barème qui ne se dirait pas `incomplete`
 * serait proposé par `listBenchmarks()`, donc sélectionnable, donc affiché —
 * et n'échouerait qu'au premier calcul, sous les yeux de l'utilisateur.
 */
function checkedBenchmark(benchmark: BenchmarkDefinition): BenchmarkDefinition {
  if ((benchmark.data === null) !== (benchmark.status === "incomplete")) {
    throw new EnergyError(
      `Benchmark incohérent: "${benchmark.id}" — un benchmark incomplet n'a pas de barème (data: null), et un benchmark sans barème est incomplet (statut: ${benchmark.status}, barème: ${benchmark.data === null ? "absent" : "présent"}).`,
    );
  }
  return benchmark;
}

/**
 * Le registre. Mutable parce qu'un test doit pouvoir y déposer un benchmark
 * factice le temps d'une assertion (cf. `registerBenchmark`) — le code
 * applicatif, lui, n'a accès qu'aux lectures et à l'alignement du courant :
 * `index.ts` n'exporte pas `registerBenchmark`.
 */
const BENCHMARKS = new Map<string, BenchmarkDefinition>(
  [VOLTAIC_S5, VISCOSE_S2].map((benchmark) => [benchmark.id, checkedBenchmark(benchmark)]),
);

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
 * Le barème d'un benchmark. Throw si le benchmark est incomplet.
 *
 * C'est **le** point de passage vers `data` : les accesseurs de `data.ts` et de
 * `naming.ts` s'en servent plutôt que de lire le champ, pour qu'une tentative
 * de calcul sur un benchmark sans barème produise une erreur qui dit ce qui se
 * passe, et non un `TypeError` sur `null` trois appels plus loin.
 */
export function benchmarkData(benchmarkId: BenchmarkId | string): BenchmarkData {
  const definition = getBenchmark(benchmarkId);

  if (definition.data === null) {
    throw new EnergyError(
      `benchmark incomplet : pas de barème calculable pour "${definition.id}" (${definition.name}).`,
    );
  }
  return definition.data;
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
 *
 * Un benchmark **incomplet** est refusé d'emblée (`benchmarkData`) : c'est la
 * porte de tous les calculs qualifiés (`computeBenchRunFor`, `findRankFor`…),
 * et il vaut mieux échouer avant d'entrer que sur le premier seuil manquant.
 */
export function withBenchmark<T>(benchmarkId: BenchmarkId, fn: () => T): T {
  const previous = activeBenchmarkId;
  const definition = getBenchmark(benchmarkId);

  benchmarkData(definition.id);
  activeBenchmarkId = definition.id;
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
/* Alignement du courant, et crochet de test                           */
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
  BENCHMARKS.set(benchmark.id, checkedBenchmark(benchmark));
  return () => {
    BENCHMARKS.delete(benchmark.id);
  };
}

/**
 * Aligne le benchmark courant et rend de quoi rétablir le précédent.
 *
 * **Réservé au boot applicatif et au sélecteur de benchmark** (et aux tests,
 * qui s'en servent pour prouver le verrou). `index.ts` le réexporte sous le nom
 * `syncCurrentBenchmark`, qui dit ce qu'il fait : le benchmark actif est une
 * préférence du profil (DECISIONS.md D6), et tout ce qui parle du « présent »
 * sans nommer de benchmark — la saisie du tracker, l'aperçu live, les rails
 * d'énergie — passe par les accesseurs non qualifiés, donc par ce pointeur.
 * L'appeler ailleurs qu'au chargement du profil ou sur un changement de
 * sélecteur ferait diverger l'écran de la préférence enregistrée.
 */
export function setCurrentBenchmark(benchmarkId: BenchmarkId): () => void {
  const previous = currentBenchmarkId;

  currentBenchmarkId = getBenchmark(benchmarkId).id;
  return () => {
    currentBenchmarkId = previous;
  };
}
