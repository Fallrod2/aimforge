/**
 * Le registre des **formules d'énergie** — le point de branchement du calcul
 * (DECISIONS.md D4).
 *
 * Une énergie n'est pas une grandeur universelle : c'est une convention de son
 * éditeur. Voltaic interpole entre des ancres, plafonne au palier, prend le max
 * des deux scénarios d'une sous-catégorie et fait la moyenne **harmonique** des
 * neuf. Un autre benchmark peut noter autrement, et il le fera un jour ; le
 * verrou de relecture (`benchmarks.ts`) ne servirait à rien si la formule,
 * elle, restait appelée en dur.
 *
 * Ce module ne calcule rien. Il nomme ce qu'une formule doit savoir faire, et
 * dit quelle implémentation répond à quel identifiant. La formule
 * `voltaic-anchors` **est** `energy.ts` — le cœur mathématique audité, qui n'a
 * pas bougé d'un caractère : il est enveloppé, pas réécrit.
 *
 * Il n'existe qu'une formule aujourd'hui, et le registre est donc minuscule.
 * C'est voulu : ce qui doit exister avant le second benchmark, c'est le point
 * de branchement, pas une abstraction spéculative. Il est prouvé par
 * `formulas.test.ts`, qui fait résoudre une formule factice.
 */

import { type BenchmarkId, getBenchmark } from "./benchmarks.js";
import {
  findRank,
  isComplete,
  overallEnergy,
  rankFor,
  scenarioEnergy,
  subcategoryEnergy,
} from "./energy.js";
import {
  EnergyError,
  type EnergyFormulaId,
  type Rank,
  type ScoreMap,
  type TierId,
} from "./types.js";

/**
 * Ce qu'une formule d'énergie sait faire.
 *
 * C'est exactement la surface qu'appelle `compute.ts` — ni plus (une méthode
 * que personne n'appelle serait une invention), ni moins. Les paliers, les
 * scénarios et les sous-catégories sont désignés **par leur nom** : la formule
 * lit les données du benchmark actif via `data.ts`, comme `energy.ts` l'a
 * toujours fait, ce qui laisse la résolution au seul `withBenchmark`.
 */
export interface EnergyFormula {
  readonly id: EnergyFormulaId;
  /** Énergie d'un scénario pour un score donné. */
  readonly scenarioEnergy: (tierId: TierId, scenarioName: string, score: number) => number;
  /** Énergie d'une sous-catégorie, d'après les scores de ses scénarios. */
  readonly subcategoryEnergy: (tierId: TierId, subcategoryName: string, scores: ScoreMap) => number;
  /** Énergie overall à partir des énergies de sous-catégories. */
  readonly overallEnergy: (subcategoryEnergies: readonly number[]) => number;
  /** Le rang overall atteint (objet complet, couleur incluse), ou `null`. */
  readonly findRank: (tierId: TierId, overall: number) => Rank | null;
  /** Le nom du rang overall atteint, ou `null`. */
  readonly rankFor: (tierId: TierId, overall: number) => string | null;
  /** Badge « Complete » : chaque scénario atteint individuellement le rang. */
  readonly isComplete: (tierId: TierId, rankName: string, scores: ScoreMap) => boolean;
}

/**
 * L'énergie Voltaic : interpolation linéaire par morceaux entre les ancres du
 * palier, max des 2 scénarios d'une sous-catégorie, moyenne harmonique des 9.
 */
export const VOLTAIC_ANCHORS: EnergyFormulaId = "voltaic-anchors";

/**
 * `energy.ts` tel quel. Aucune adaptation de signature : si une enveloppe
 * devait convertir quoi que ce soit, la conversion deviendrait un endroit où le
 * calcul peut changer — précisément ce que l'audit du cœur interdit.
 */
const voltaicAnchors: EnergyFormula = {
  id: VOLTAIC_ANCHORS,
  scenarioEnergy,
  subcategoryEnergy,
  overallEnergy,
  findRank,
  rankFor,
  isComplete,
};

/**
 * Le registre. Mutable pour la même raison que celui des benchmarks : un test
 * doit pouvoir y déposer une formule factice (cf. `registerEnergyFormula`).
 * `index.ts` n'exporte pas ce crochet.
 */
const FORMULAS = new Map<string, EnergyFormula>([[VOLTAIC_ANCHORS, voltaicAnchors]]);

/** La formule demandée. Throw si elle est inconnue. */
export function getEnergyFormula(id: EnergyFormulaId): EnergyFormula {
  const found = FORMULAS.get(id);

  if (found === undefined) {
    throw new EnergyError(
      `Formule d'énergie inconnue: "${id}" (connues: ${[...FORMULAS.keys()].join(", ")})`,
    );
  }
  return found;
}

/**
 * La formule d'un benchmark.
 *
 * C'est le seul chemin par lequel `compute.ts` obtient de quoi calculer : une
 * passe se relit avec la formule **de son benchmark**, comme elle se relit avec
 * ses seuils. Les deux résolutions partent de la même définition, donc elles ne
 * peuvent pas se contredire.
 */
export function formulaFor(benchmarkId: BenchmarkId): EnergyFormula {
  return getEnergyFormula(getBenchmark(benchmarkId).energyFormula);
}

/* ------------------------------------------------------------------ */
/* Crochet de test — jamais réexporté par index.ts                     */
/* ------------------------------------------------------------------ */

/**
 * Dépose une formule dans le registre et rend de quoi l'en retirer.
 * **Réservé aux tests** : prouver que le branchement existe demande une seconde
 * formule, et il n'y en a qu'une de réelle.
 */
export function registerEnergyFormula(formula: EnergyFormula): () => void {
  if (FORMULAS.has(formula.id)) {
    throw new EnergyError(`Formule d'énergie déjà enregistrée: "${formula.id}"`);
  }
  FORMULAS.set(formula.id, formula);
  return () => {
    FORMULAS.delete(formula.id);
  };
}
