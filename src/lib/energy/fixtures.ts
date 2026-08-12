/**
 * Helpers de **test** partagés (jamais importés par le code applicatif).
 * Construit des jeux de scores dérivés de `voltaic-s5-data.json` : jamais de
 * seuil écrit en dur ici (règle du projet : le JSON est la source de vérité).
 */

import { type BenchmarkDefinition, type BenchmarkId, getBenchmark } from "./benchmarks.js";
import { getTier, listScenarios } from "./data.js";
import type { TierId } from "./types.js";

/**
 * Une définition de benchmark factice, dérivée de celle du benchmark de
 * référence.
 *
 * Trois fichiers de test ont besoin d'un second benchmark (le verrou de
 * relecture, le branchement de formule, l'exclusion des `incomplete`). Écrire
 * trois littéraux complets, c'est trois endroits à retoucher au prochain champ
 * ajouté à `BenchmarkDefinition` — et deux occasions de laisser un test mentir
 * en oubliant d'en mettre un à jour.
 */
export function benchmarkLike(
  base: BenchmarkId,
  id: BenchmarkId,
  overrides: Partial<BenchmarkDefinition> = {},
): BenchmarkDefinition {
  return { ...getBenchmark(base), id, ...overrides };
}

/**
 * Les 18 scores d'un palier posés **pile** sur le seuil d'une ancre
 * (ex. "Gold" pour Novice) : chaque scénario vaut alors exactement
 * `anchorEnergies[i]`, donc l'overall aussi (moyenne harmonique de 9 valeurs
 * identiques) et le badge « Complete » est atteint.
 */
export function scoresAtAnchor(tier: TierId, anchorLabel: string): Record<string, number> {
  const anchorIndex = getTier(tier).anchorLabels.indexOf(anchorLabel);

  if (anchorIndex < 0) {
    throw new Error(`Ancre inconnue: "${anchorLabel}" (palier ${tier})`);
  }

  const scores: Record<string, number> = {};
  for (const scenario of listScenarios(tier)) {
    const threshold = scenario.thresholds[anchorIndex];

    if (threshold === undefined) {
      throw new Error(`Seuil ${anchorIndex} absent pour "${scenario.name}"`);
    }
    scores[scenario.name] = threshold;
  }
  return scores;
}

/** L'énergie exacte de l'ancre visée par `scoresAtAnchor`. */
export function anchorEnergy(tier: TierId, anchorLabel: string): number {
  const tierData = getTier(tier);
  const energy = tierData.anchorEnergies[tierData.anchorLabels.indexOf(anchorLabel)];

  if (energy === undefined) {
    throw new Error(`Ancre inconnue: "${anchorLabel}" (palier ${tier})`);
  }
  return energy;
}
