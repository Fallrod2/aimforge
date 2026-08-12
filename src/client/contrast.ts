/**
 * Mesure de contraste WCAG 2.1 (formule 1.4.3 / 1.4.11).
 *
 * Elle existe pour une raison précise : **on ne peut pas estimer un contraste à
 * l'œil**, et l'application a déjà payé cette illusion (une teinte crue « assez
 * claire » à 3,08:1, un pied de page à 2,0:1). Les paires réellement affichées
 * sont donc calculées, pas jugées — cf. `contrast.test.ts`, qui lit les jetons
 * dans `index.css` et refuse une régression.
 *
 * Le piège du thème sombre est la **transparence** : presque toutes les cartes
 * sont des `bg-…/60`, donc la couleur derrière le texte n'est jamais celle du
 * jeton, mais sa composition sur le fond. `composite` sert exactement à ça, et
 * c'est elle qui fait la différence entre une mesure juste et une mesure
 * flatteuse.
 *
 * Module pur, sans dépendance : il tourne en test comme dans un script.
 */

/** Une couleur sRGB opaque, canaux 0–255. */
export interface Rgb {
  readonly r: number;
  readonly g: number;
  readonly b: number;
}

/** `#rgb` ou `#rrggbb`. Lève sur toute autre écriture : c'est une faute de saisie. */
export function parseHex(hex: string): Rgb {
  const raw = hex.trim().replace(/^#/, "");
  const full =
    raw.length === 3
      ? raw
          .split("")
          .map((char) => char + char)
          .join("")
      : raw;

  if (!/^[0-9a-fA-F]{6}$/.test(full)) throw new Error(`Couleur hexadécimale invalide : ${hex}`);
  return {
    r: Number.parseInt(full.slice(0, 2), 16),
    g: Number.parseInt(full.slice(2, 4), 16),
    b: Number.parseInt(full.slice(4, 6), 16),
  };
}

/** `#rrggbb`, canaux arrondis — la forme qu'on recopie dans le CSS. */
export function toHex({ r, g, b }: Rgb): string {
  const channel = (value: number) =>
    Math.round(Math.min(255, Math.max(0, value)))
      .toString(16)
      .padStart(2, "0");

  return `#${channel(r)}${channel(g)}${channel(b)}`;
}

/**
 * La couleur réellement peinte quand `front` est posée à `alpha` sur `back`.
 *
 * Composition simple, canal par canal : c'est ce que fait le navigateur pour un
 * `bg-steel-900/60`, et c'est la seule couleur dont un texte se détache.
 */
export function composite(front: Rgb, alpha: number, back: Rgb): Rgb {
  const mix = (a: number, b: number) => a * alpha + b * (1 - alpha);

  return { r: mix(front.r, back.r), g: mix(front.g, back.g), b: mix(front.b, back.b) };
}

/** Luminance relative WCAG. */
export function relativeLuminance({ r, g, b }: Rgb): number {
  const linear = (channel: number) => {
    const value = channel / 255;

    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  };

  return 0.2126 * linear(r) + 0.7152 * linear(g) + 0.0722 * linear(b);
}

/** Le ratio de contraste, toujours ≥ 1, dans l'ordre qu'on veut. */
export function contrastRatio(a: Rgb, b: Rgb): number {
  const first = relativeLuminance(a);
  const second = relativeLuminance(b);
  const lighter = Math.max(first, second);
  const darker = Math.min(first, second);

  return (lighter + 0.05) / (darker + 0.05);
}

/** Le ratio de deux couleurs hexadécimales, arrondi au centième (celui qu'on rapporte). */
export function ratioOf(foreground: string, background: string): number {
  return Math.round(contrastRatio(parseHex(foreground), parseHex(background)) * 100) / 100;
}

/**
 * Les jetons `--color-<nom>: #hex;` d'une feuille de style.
 *
 * Lire le CSS plutôt que recopier ses valeurs : `index.css` reste la seule
 * source, et un jeton retouché sans mesure fait tomber le test qui l'utilise.
 */
export function readColorTokens(css: string): ReadonlyMap<string, string> {
  const tokens = new Map<string, string>();

  for (const match of css.matchAll(/--color-([a-z0-9-]+)\s*:\s*(#[0-9a-fA-F]{3,8})\s*;/g)) {
    const [, name, value] = match;

    if (name !== undefined && value !== undefined) tokens.set(name, value);
  }
  return tokens;
}
