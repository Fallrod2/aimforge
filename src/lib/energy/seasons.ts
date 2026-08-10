/**
 * Registre des saisons du benchmark Voltaic — le verrou multi-saison
 * (SPEC §5 quinquies).
 *
 * Le problème qu'il résout : les énergies de sous-catégories et le rang overall
 * d'une passe ne sont **pas** stockés, ils sont dérivés à la lecture depuis le
 * jeu de données. Tant qu'il n'existait qu'un jeu de données, cette dérivation
 * était sans risque. Le jour où la S6 remplace la S5, la même passe se relit
 * avec d'autres seuils et l'historique change de valeurs sans que personne ne
 * l'ait demandé. Une saison n'est donc pas une étiquette d'affichage : c'est ce
 * qui décide *avec quels seuils* une passe se relit, pour toujours.
 *
 * Trois pièces, et pas une de plus :
 *
 * 1. **le registre** `SEASONS` — un identifiant → un jeu de données complet
 *    (seuils Voltaic + métadonnées d'import KovaaK's) ;
 * 2. **la saison courante** — celle qu'estampillent les écritures. Une seule à
 *    la fois : il n'y a pas de « saison choisie par l'utilisateur », il y a la
 *    saison publiée et l'historique ;
 * 3. **la saison active en résolution** (`withSeason`) — la saison dont les
 *    accesseurs non qualifiés de `data.ts` servent les données pendant un
 *    calcul. C'est l'unique moyen de faire tourner le cœur mathématique
 *    (`energy.ts`, figé au caractère près) sur une autre saison que la
 *    courante, sans dupliquer une seule ligne d'interpolation.
 *
 * `SeasonId` est un `string` **marqué**, pas une union fermée : la S6 arrivera
 * par un ajout de données ici, pas par un élargissement de type qui obligerait
 * à retoucher chaque signature du projet. Le marquage force en revanche à
 * passer par `toSeasonId` pour transformer une valeur venue de la base — c'est
 * là, et nulle part ailleurs, qu'une saison inconnue est refusée.
 */

import rawVoltaicS5 from "../../../voltaic-s5-data.json" with { type: "json" };
import { EnergyError, type TierId, type VoltaicData } from "./types.js";

/**
 * Identifiant d'une saison (`voltaic-s5`, `voltaic-s6`…).
 *
 * Marqué pour qu'un `string` quelconque ne s'y glisse pas : une valeur brute
 * (colonne `bench_runs.season`) doit passer par `toSeasonId`, qui la valide.
 */
declare const seasonBrand: unique symbol;

export type SeasonId = string & { readonly [seasonBrand]: true };

/**
 * Ce que l'import KovaaK's doit savoir d'une saison.
 *
 * Ces deux valeurs changent à chaque saison Voltaic et n'ont rien à faire en
 * dur dans le module d'import : le Benchmark Tracker republie des benchmarks
 * sous de nouveaux identifiants, et suffixe les noms de scénarios du marqueur
 * de saison (`VT Pasu Novice S5`).
 */
export interface KovaaksSeason {
  /** Identifiant du benchmark officiel du Benchmark Tracker, par palier. */
  readonly benchmarkIds: Readonly<Record<TierId, number>>;
  /** Ce que KovaaK's ajoute au nom du tableur (`" S5"`). */
  readonly scenarioSuffix: string;
}

/** Une saison : son identifiant, ses seuils, ses métadonnées d'import. */
export interface SeasonDefinition {
  readonly id: SeasonId;
  readonly data: VoltaicData;
  readonly kovaaks: KovaaksSeason;
}

/**
 * `voltaic-s5-data.json` est la source de vérité versionnée du repo : on le
 * type ici plutôt que de le valider au runtime (la lib reste sans dépendance,
 * donc sans Zod). Les invariants de structure sont verrouillés par
 * `data.test.ts`.
 */
const voltaicS5 = rawVoltaicS5 as unknown as VoltaicData;

/** La saison publiée. Toute écriture l'estampille (SPEC §5 quinquies). */
export const CURRENT_SEASON = "voltaic-s5" as SeasonId;

const S5: SeasonDefinition = {
  id: CURRENT_SEASON,
  data: voltaicS5,
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
 * Le registre. Mutable parce qu'un test doit pouvoir y déposer une saison
 * factice le temps d'une assertion (cf. `registerSeason`) — le code applicatif,
 * lui, n'a accès qu'aux lectures : `index.ts` n'exporte ni `registerSeason` ni
 * `setCurrentSeason`.
 */
const SEASONS = new Map<string, SeasonDefinition>([[CURRENT_SEASON, S5]]);

/** La saison courante effective ; `CURRENT_SEASON` hors surcharge de test. */
let currentSeasonId: SeasonId = CURRENT_SEASON;

/**
 * La saison dont `data.ts` sert les données pour un accès non qualifié.
 * `null` = « suis la saison courante » ; renseignée seulement pendant un
 * `withSeason`.
 */
let activeSeasonId: SeasonId | null = null;

/* ------------------------------------------------------------------ */
/* Lecture du registre                                                 */
/* ------------------------------------------------------------------ */

/** Les identifiants de saison connus, dans l'ordre d'enregistrement. */
export function listSeasons(): readonly SeasonId[] {
  return [...SEASONS.values()].map((season) => season.id);
}

/**
 * La saison demandée. Throw si elle est inconnue.
 *
 * Jamais de repli sur la saison courante : relire une passe S5 avec les seuils
 * S6 parce que « voltaic-s5 » n'a pas été trouvé produirait des valeurs fausses
 * *silencieusement*, ce qui est exactement le risque contre lequel ce module
 * existe. Mieux vaut une erreur lisible.
 */
export function getSeason(season: SeasonId | string): SeasonDefinition {
  const found = SEASONS.get(season);

  if (found === undefined) {
    throw new EnergyError(
      `Saison inconnue: "${season}" (connues: ${[...SEASONS.keys()].join(", ")})`,
    );
  }
  return found;
}

/**
 * Une valeur brute (colonne `bench_runs.season`) → un `SeasonId` validé.
 * C'est la frontière : au-delà, une saison est forcément connue du registre.
 */
export function toSeasonId(value: string): SeasonId {
  return getSeason(value).id;
}

/** La saison qu'estampillent les écritures. */
export function currentSeason(): SeasonId {
  return currentSeasonId;
}

/** La saison servie par les accesseurs non qualifiés de `data.ts`. */
export function activeSeason(): SeasonId {
  return activeSeasonId ?? currentSeasonId;
}

/* ------------------------------------------------------------------ */
/* Résolution qualifiée                                                */
/* ------------------------------------------------------------------ */

/**
 * Exécute `fn` en résolvant les données de `season`.
 *
 * C'est le pivot du verrou. `energy.ts` — le cœur mathématique, figé au
 * caractère près après audit — appelle `getTier`/`getScenario`/`getSubcategory`
 * sans savoir qu'une saison existe. Plutôt que de dupliquer son interpolation
 * dans une variante « par saison » (deux implémentations qui dériveraient, sur
 * le seul code du projet qu'on ne peut pas se permettre de voir diverger), on
 * déplace le point de résolution : le temps de l'appel, ces accesseurs servent
 * les données de la saison demandée.
 *
 * La portée est **synchrone et rétablie en `finally`**, y compris imbriquée.
 * Une continuation `await` sortirait de la portée sans qu'on le voie : un `fn`
 * qui rend un thenable est donc refusé, plutôt que de laisser passer un calcul
 * dont la moitié aurait été résolue dans la mauvaise saison.
 */
export function withSeason<T>(season: SeasonId, fn: () => T): T {
  const previous = activeSeasonId;

  activeSeasonId = getSeason(season).id;
  try {
    const result = fn();

    if (typeof (result as { then?: unknown } | null)?.then === "function") {
      throw new EnergyError(
        "withSeason n'accepte qu'un calcul synchrone (la portée ne survit pas à un await).",
      );
    }
    return result;
  } finally {
    activeSeasonId = previous;
  }
}

/* ------------------------------------------------------------------ */
/* Crochets de test — jamais réexportés par index.ts                   */
/* ------------------------------------------------------------------ */

/**
 * Dépose une saison dans le registre et rend de quoi l'en retirer.
 *
 * **Réservé aux tests** (cf. `fixtures.ts`) : la seule façon honnête de prouver
 * le verrou est de faire exister une seconde saison. Elle n'est pas exportée
 * par `index.ts`, donc hors d'atteinte du code applicatif.
 */
export function registerSeason(season: SeasonDefinition): () => void {
  if (SEASONS.has(season.id)) {
    throw new EnergyError(`Saison déjà enregistrée: "${season.id}"`);
  }
  SEASONS.set(season.id, season);
  return () => {
    SEASONS.delete(season.id);
  };
}

/**
 * Force la saison courante et rend de quoi rétablir la précédente.
 * **Réservé aux tests** : en production, la saison courante est `CURRENT_SEASON`.
 */
export function setCurrentSeason(season: SeasonId): () => void {
  const previous = currentSeasonId;

  currentSeasonId = getSeason(season).id;
  return () => {
    currentSeasonId = previous;
  };
}
