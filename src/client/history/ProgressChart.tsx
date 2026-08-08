/**
 * Progression dans le temps : overall du palier, plus l'énergie d'une
 * sous-catégorie au choix. L'échelle Y est celle du palier (0 → maxEnergy) et
 * les rangs officiels sont posés en lignes de repère à leur couleur du JSON.
 *
 * Un seul axe des ordonnées : les deux courbes sont des énergies du même
 * palier, donc de la même échelle. Deux échelles superposées mentiraient sur
 * l'écart réel entre l'overall et la sous-catégorie.
 *
 * Le couple de couleurs des séries est fixé dans le thème
 * (`--color-ember-600` / `--color-quench-500`) et validé pour la vision des
 * couleurs ; les couleurs de rang, elles, viennent toujours du JSON Voltaic.
 */

import {
  CartesianGrid,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { getTier, type TierId } from "../../lib/energy";
import { formatEnergy } from "../format";
import { themeColor } from "../theme";
import type { SeriesPoint } from "./series";

interface ProgressChartProps {
  readonly tier: TierId;
  readonly points: readonly SeriesPoint[];
  readonly subcategory: string | null;
}

const OVERALL_LABEL = "Overall";

export function ProgressChart({ tier, points, subcategory }: ProgressChartProps) {
  const { maxEnergy, overallRanks } = getTier(tier);
  const axis = themeColor("steel-700");
  const muted = themeColor("steel-400");
  const surface = themeColor("steel-950");
  const overallColor = themeColor("ember-600");
  const subColor = themeColor("quench-500");

  return (
    <figure className="m-0">
      <div className="h-64 w-full sm:h-80">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={[...points]} margin={{ top: 8, right: 8, bottom: 4, left: -12 }}>
            <CartesianGrid stroke={axis} strokeDasharray="2 5" vertical={false} />
            <XAxis
              dataKey="label"
              tick={{ fill: muted, fontSize: 11 }}
              tickLine={false}
              axisLine={{ stroke: axis }}
              minTickGap={16}
            />
            <YAxis
              domain={[0, maxEnergy]}
              // Graduations calées sur les seuils de rang : la grille tombe
              // pile sur les repères colorés au lieu de les croiser.
              ticks={[0, ...overallRanks.map((rank) => rank.minEnergy), maxEnergy]}
              tick={{ fill: muted, fontSize: 11 }}
              tickLine={false}
              axisLine={false}
              width={52}
            />
            {overallRanks.map((rank) => (
              <ReferenceLine
                key={rank.name}
                y={rank.minEnergy}
                stroke={rank.color}
                strokeOpacity={0.35}
                strokeDasharray="4 4"
                label={{
                  value: rank.name,
                  position: "insideTopRight",
                  fill: rank.color,
                  fillOpacity: 0.8,
                  fontSize: 10,
                }}
              />
            ))}
            <Tooltip
              cursor={{ stroke: axis, strokeWidth: 1 }}
              contentStyle={{
                background: themeColor("steel-900"),
                border: `1px solid ${axis}`,
                borderRadius: 8,
                fontSize: 12,
              }}
              labelStyle={{ color: themeColor("steel-200"), marginBottom: 4 }}
              itemStyle={{ padding: 0 }}
              formatter={(value) => (typeof value === "number" ? formatEnergy(value) : "—")}
            />
            <Line
              type="monotone"
              dataKey="overall"
              name={OVERALL_LABEL}
              stroke={overallColor}
              strokeWidth={2}
              dot={{ r: 4, fill: overallColor, stroke: surface, strokeWidth: 2 }}
              activeDot={{ r: 6, stroke: surface, strokeWidth: 2 }}
            />
            {subcategory !== null ? (
              <Line
                type="monotone"
                dataKey="sub"
                name={subcategory}
                stroke={subColor}
                strokeWidth={2}
                strokeDasharray="5 4"
                dot={{ r: 4, fill: subColor, stroke: surface, strokeWidth: 2 }}
                activeDot={{ r: 6, stroke: surface, strokeWidth: 2 }}
              />
            ) : null}
          </LineChart>
        </ResponsiveContainer>
      </div>

      <figcaption className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-2 text-xs text-steel-400">
        <LegendItem color={overallColor} label={OVERALL_LABEL} />
        {subcategory !== null ? <LegendItem color={subColor} label={subcategory} dashed /> : null}
        <span className="text-steel-500">
          Repères : rangs {getTier(tier).label} aux couleurs officielles Voltaic.
        </span>
      </figcaption>
    </figure>
  );
}

interface LegendItemProps {
  readonly color: string;
  readonly label: string;
  readonly dashed?: boolean;
}

function LegendItem({ color, label, dashed = false }: LegendItemProps) {
  return (
    <span className="inline-flex items-center gap-2">
      <svg aria-hidden="true" viewBox="0 0 24 8" className="h-2 w-6 shrink-0">
        <line
          x1="0"
          y1="4"
          x2="24"
          y2="4"
          stroke={color}
          strokeWidth="2"
          strokeDasharray={dashed ? "5 4" : undefined}
        />
      </svg>
      {label}
    </span>
  );
}
