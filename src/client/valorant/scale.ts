/**
 * Le cadrage vertical des graphes de la vue Valorant. Module pur.
 *
 * Une courbe de HS% cadrée de 0 à 100 est une ligne plate : les valeurs réelles
 * vivent entre 10 et 35, et l'écart qui intéresse le joueur — trois points de
 * plus ce mois-ci — disparaît dans le blanc. Cadrer sur la plage observée le
 * rend lisible, au prix connu d'un axe qui ne part pas de zéro.
 *
 * Ce compromis n'est acceptable qu'à trois conditions, tenues ici et dans la
 * légende de chaque figure :
 *
 * 1. **l'axe est toujours gradué et étiqueté** — le lecteur voit la plage ;
 * 2. **les bornes sont arrondies à un pas rond**, jamais collées aux valeurs
 *    extrêmes : une courbe qui touche le haut du cadre exagère son maximum ;
 * 3. **la figure le dit** (« axe cadré sur la plage observée »).
 *
 * Le module ne connaît ni Recharts ni React : il rend deux nombres.
 */

/** Les pas ronds acceptés, par ordre croissant dans chaque décade. */
const STEPS = [1, 2, 2.5, 5, 10] as const;

export interface DomainOptions {
  /** Borne physique basse (0 pour un pourcentage, une énergie, un ADR). */
  readonly lower?: number;
  /** Borne physique haute (100 pour un pourcentage). */
  readonly upper?: number;
  /** Marge autour de la plage observée, en fraction de son amplitude. */
  readonly padding?: number;
}

/**
 * Le plus petit pas rond au moins égal à `raw` (1, 2, 2,5, 5, 10 × 10ⁿ).
 *
 * C'est ce qui donne des graduations lisibles (0, 5, 10…) plutôt que des bornes
 * du genre 13,7 — un axe se lit de tête ou ne se lit pas.
 */
export function niceStep(raw: number): number {
  if (!Number.isFinite(raw) || raw <= 0) return 1;

  const decade = 10 ** Math.floor(Math.log10(raw));

  for (const step of STEPS) {
    if (raw <= step * decade * 1.000_000_1) return step * decade;
  }
  return 10 * decade;
}

/**
 * Le domaine vertical d'une série : la plage observée, élargie puis arrondie.
 *
 * Sans aucune valeur exploitable, le domaine vaut `[lower ?? 0, (lower ?? 0) + 1]` :
 * un cadre neutre, jamais un axe inventé autour de zéro.
 */
export function paddedDomain(
  values: readonly (number | null)[],
  { lower, upper, padding = 0.15 }: DomainOptions = {},
): readonly [number, number] {
  const known = values.filter((value): value is number => value !== null && Number.isFinite(value));
  const floor = lower ?? Number.NEGATIVE_INFINITY;
  const ceiling = upper ?? Number.POSITIVE_INFINITY;

  if (known.length === 0) {
    const base = lower ?? 0;

    return [base, Math.min(base + 1, ceiling)];
  }

  const low = Math.min(...known);
  const high = Math.max(...known);
  // Une seule valeur (ou plusieurs identiques) n'a pas d'amplitude : on lui
  // donne un pas rond de part et d'autre, sinon le domaine serait un point.
  const spread = high - low;
  const margin = spread === 0 ? niceStep(Math.abs(high) / 10 || 1) : spread * padding;
  const step = niceStep(margin);

  return [
    Math.max(floor, Math.floor((low - margin) / step) * step),
    Math.min(ceiling, Math.ceil((high + margin) / step) * step),
  ];
}
