/**
 * Formatage d'affichage (français). Aucune règle métier ici : les valeurs
 * arrivent déjà calculées par le moteur d'énergie, et la grammaire des noms de
 * scénarios est lue dans la définition du benchmark plutôt que réécrite.
 */

import { type BenchmarkId, currentBenchmark, scenarioDisplayName } from "../lib/energy";

const energyFormat = new Intl.NumberFormat("fr-FR", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

const scoreFormat = new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 2 });

/** Une énergie, toujours à 2 décimales (ex. « 451,96 »). */
export function formatEnergy(energy: number): string {
  return energyFormat.format(energy);
}

/** Un score de scénario : entier si possible, 2 décimales sinon. */
export function formatScore(score: number): string {
  return scoreFormat.format(score);
}

/** Un écart signé, pour « il te manque X » ou « +X au prochain palier ». */
export function formatDelta(delta: number): string {
  return `${delta > 0 ? "+" : ""}${scoreFormat.format(delta)}`;
}

/** Date d'une passe, format court avec l'heure (ex. « 1 mars 2026, 13:00 »). */
export function formatRunDate(iso: string, timeZone?: string): string {
  return new Intl.DateTimeFormat("fr-FR", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZone,
  }).format(new Date(iso));
}

/**
 * Nom de scénario allégé pour l'affichage : le palier est déjà à l'écran et le
 * préfixe du benchmark est sur les 18 lignes (« VT Pasu Novice » → « Pasu »).
 *
 * Ce qu'il faut retirer n'est pas une règle d'affichage mais la **grammaire de
 * nommage du benchmark** : elle vit dans sa définition, et c'est de là qu'elle
 * est lue. Le benchmark est explicite là où l'appelant le connaît (une passe
 * d'historique porte le sien) ; le tracker, qui parle du présent, laisse le
 * défaut.
 */
export function scenarioLabel(
  scenarioName: string,
  tierLabel: string,
  benchmarkId: BenchmarkId = currentBenchmark(),
): string {
  return scenarioDisplayName(benchmarkId, scenarioName, tierLabel);
}

/**
 * Date de version d'un jeu de données de benchmark (`dataVersion`, « 2026-08-08 »
 * → « 8 août 2026 »).
 *
 * Le fuseau est **UTC** par défaut, et ce n'est pas un détail : la chaîne est un
 * jour civil sans heure, que `Date` lit à minuit UTC. La rendre dans le fuseau
 * du navigateur ferait afficher la veille à l'ouest de Greenwich — un barème
 * daté d'un jour de moins que ce que dit sa source.
 */
export function formatDataVersion(date: string, timeZone = "UTC"): string {
  return new Intl.DateTimeFormat("fr-FR", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone,
  }).format(new Date(date));
}

/** Date d'une passe sans l'heure, pour l'axe du graphe. */
export function formatChartDate(iso: string, timeZone?: string): string {
  return new Intl.DateTimeFormat("fr-FR", {
    day: "numeric",
    month: "short",
    timeZone,
  }).format(new Date(iso));
}
