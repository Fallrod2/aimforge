/**
 * Formatage d'affichage (français). Aucune règle métier ici : les valeurs
 * arrivent déjà calculées par le moteur d'énergie.
 */

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
 * préfixe « VT » est sur les 18 lignes (« VT Pasu Novice » → « Pasu »).
 */
export function scenarioLabel(scenarioName: string, tierLabel: string): string {
  return scenarioName
    .replace(/^VT\s+/, "")
    .replace(new RegExp(`\\s+${tierLabel}$`), "")
    .trim();
}

/** Date d'une passe sans l'heure, pour l'axe du graphe. */
export function formatChartDate(iso: string, timeZone?: string): string {
  return new Intl.DateTimeFormat("fr-FR", {
    day: "numeric",
    month: "short",
    timeZone,
  }).format(new Date(iso));
}
