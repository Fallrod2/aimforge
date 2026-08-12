/**
 * La mini-courbe de progression : six points, un SVG écrit à la main.
 *
 * Volontairement **pas** Recharts. La bibliothèque de graphes tire d3 et un
 * store Redux — environ un tiers du bundle — et l'application la charge déjà à
 * la demande, pour l'historique. La faire entrer dans la landing pour dessiner
 * cinq segments serait payer le premier chargement de tous les visiteurs au prix
 * de l'écran le plus lourd de l'application. La vraie courbe, celle qui zoome,
 * survole et compare, reste dans les perfs.
 *
 * Ce qu'elle montre est un **exemple** — la légende le dit à l'écran, ce
 * composant ne s'en charge pas — mais les valeurs, elles, sortent du moteur
 * d'énergie comme les autres (`demo-data.ts`).
 */

import { useId } from "react";
import { formatChartDate, formatEnergy } from "../format";

/** Un point de la courbe : une date, une énergie overall. */
export interface CurvePoint {
  readonly date: string;
  readonly overall: number;
}

interface DemoCurveProps {
  readonly points: readonly CurvePoint[];
  /** Décrit la courbe aux lecteurs d'écran, qui ne voient pas le tracé. */
  readonly label: string;
}

/** Le repère du tracé, en unités du `viewBox`. */
const BOX = { width: 320, height: 104, padX: 10, padY: 12 } as const;

export function DemoCurve({ points, label }: DemoCurveProps) {
  const gradientId = useId();

  if (points.length < 2) return null;

  const values = points.map((point) => point.overall);
  const lowest = Math.min(...values);
  const highest = Math.max(...values);
  // Une amplitude nulle diviserait par zéro : la courbe devient alors plate au
  // milieu du cadre, ce qui est exactement ce qu'elle raconte.
  const span = highest - lowest || 1;
  const innerWidth = BOX.width - 2 * BOX.padX;
  const innerHeight = BOX.height - 2 * BOX.padY;

  const coords = points.map((point, index) => ({
    x: BOX.padX + (innerWidth * index) / (points.length - 1),
    y: BOX.padY + innerHeight * (1 - (point.overall - lowest) / span),
  }));
  const line = coords.map(({ x, y }) => `${x.toFixed(1)},${y.toFixed(1)}`).join(" ");
  const area = `${BOX.padX},${BOX.height - BOX.padY} ${line} ${BOX.width - BOX.padX},${
    BOX.height - BOX.padY
  }`;
  const last = coords.at(-1);
  const first = points[0];
  const latest = points.at(-1);

  return (
    <figure className="m-0 w-full">
      <svg
        viewBox={`0 0 ${BOX.width} ${BOX.height}`}
        role="img"
        aria-label={label}
        className="h-auto w-full text-ember-500"
      >
        <defs>
          <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="currentColor" stopOpacity="0.28" />
            <stop offset="100%" stopColor="currentColor" stopOpacity="0" />
          </linearGradient>
        </defs>
        <polygon points={area} fill={`url(#${gradientId})`} />
        <polyline
          points={line}
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        {coords.map(({ x, y }, index) => (
          <circle
            // biome-ignore lint/suspicious/noArrayIndexKey: la série est une liste ordonnée jamais réordonnée, deux passes peuvent partager une énergie.
            key={index}
            cx={x}
            cy={y}
            r="2"
            fill="currentColor"
            opacity="0.55"
          />
        ))}
        {last === undefined ? null : <circle cx={last.x} cy={last.y} r="3.5" fill="currentColor" />}
      </svg>

      <figcaption className="mt-2 flex items-baseline justify-between gap-3 text-[11px] text-steel-500">
        <span className="font-mono tabular-nums">
          {first === undefined
            ? null
            : `${formatChartDate(first.date)} · ${formatEnergy(first.overall)}`}
        </span>
        <span className="font-mono tabular-nums text-steel-300">
          {latest === undefined
            ? null
            : `${formatChartDate(latest.date)} · ${formatEnergy(latest.overall)}`}
        </span>
      </figcaption>
    </figure>
  );
}
