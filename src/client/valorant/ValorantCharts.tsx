/**
 * Les figures de la vue Valorant. **Ce module est chargé à la demande** — il
 * est le seul de `src/client/valorant/` à importer Recharts, qui pèse à lui
 * seul un tiers du bundle historique (Recharts tire d3 et un store Redux). La
 * vue d'ensemble, les tableaux et la page de match s'affichent sans lui ; il
 * n'arrive qu'avec la section « Tendances ».
 *
 * ## Les deux figures, et pourquoi elles sont dessinées ainsi
 *
 * **Tendance d'une mesure** (HS%, ADR) : une ligne grise qui relie les valeurs
 * — elle porte la tendance, pas l'identité — et un point par partie, coloré par
 * le **résultat**. Le choix de dépenser la couleur sur le résultat plutôt que
 * sur la mesure est délibéré : il y a une figure par mesure (le titre la nomme,
 * une série n'a pas besoin de légende), alors que le résultat est l'information
 * qui n'existe nulle part ailleurs sur la courbe.
 *
 * Trois issues, deux couleurs : le projet n'a que deux teintes de série
 * validées pour la vision des couleurs (`--color-ember-600` et
 * `--color-quench-500`, cf. `index.css`). Un gris ajouté comme troisième
 * catégorie tombe sous le seuil de séparation face au bleu (ΔE 8,6 en vision
 * normale, sous le plancher de 15). L'égalité et le résultat inconnu prennent
 * donc un point **creux** : une forme, pas une troisième couleur.
 *
 * **Pont bench ↔ in-game** : deux mini-graphes empilés qui partagent le même
 * axe du temps — pas un graphe à deux axes des ordonnées. Superposer une
 * énergie Voltaic et un pourcentage de tirs à la tête sur deux échelles
 * fabrique un point de croisement qui ne dépend que du cadrage choisi : la
 * corrélation serait dessinée, pas mesurée. Ici les deux courbes gardent leur
 * unité, leur axe étiqueté et leur propre cadre ; ce que l'œil compare, c'est
 * la position dans le temps — la seule chose réellement commune.
 *
 * Les axes des ordonnées sont cadrés sur la plage observée (`scale.ts`), ce que
 * chaque légende annonce.
 */

import type { ReactNode } from "react";
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  type TooltipContentProps,
  XAxis,
  YAxis,
} from "recharts";
import { getTierFor, type SeasonId } from "../../lib/energy";
import { formatChartDate, formatEnergy } from "../format";
import { themeColor } from "../theme";
import type { Bridge } from "./bridge";
import { formatAdr, formatPercent, resultLabel, UNKNOWN } from "./display";
import type { MatchMetric, MetricPoint } from "./series";

/* ------------------------------------------------------------------ */
/* Vocabulaire commun aux figures                                      */
/* ------------------------------------------------------------------ */

const AXIS_WIDTH = 46;

const CHART_MARGIN = { top: 8, right: 12, bottom: 0, left: 0 } as const;

const DOT_RADIUS = 4;

/** L'anneau de 2 px qui détache un point de la ligne qu'il croise. */
const RING_WIDTH = 2;

function tooltipStyle(border: string) {
  return {
    background: themeColor("steel-900"),
    border: `1px solid ${border}`,
    borderRadius: 8,
    fontSize: 12,
    padding: "8px 10px",
  };
}

/** Le cadre d'une infobulle : même boîte pour les deux figures. */
function TooltipBox({ children }: { readonly children: ReactNode }) {
  return (
    <div
      style={tooltipStyle(themeColor("steel-700"))}
      className="max-w-56 text-steel-200 shadow-lg"
    >
      {children}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Tendance d'une mesure, match après match                            */
/* ------------------------------------------------------------------ */

interface TrendChartProps {
  readonly points: readonly MetricPoint[];
  readonly metric: MatchMetric;
  /** Domaine vertical, calculé par `paddedDomain` chez l'appelant. */
  readonly domain: readonly [number, number];
  /** Nom de la mesure, repris dans l'infobulle. */
  readonly label: string;
}

function formatMetric(value: number | null, metric: MatchMetric): string {
  return metric === "adr" ? formatAdr(value) : formatPercent(value);
}

/** L'infobulle : la valeur d'abord, le contexte de la partie ensuite. */
function trendTooltip(props: TooltipContentProps, metric: MatchMetric, label: string): ReactNode {
  if (!props.active) return null;

  const point = props.payload?.[0]?.payload as MetricPoint | undefined;

  if (point === undefined) return null;

  const context = [point.map, point.agent].filter((value) => value !== null).join(" · ");

  return (
    <TooltipBox>
      <p className="font-mono text-sm tabular-nums text-steel-100">
        {formatMetric(point.value, metric)}
        <span className="ml-1.5 font-sans text-[11px] text-steel-400">{label}</span>
      </p>
      <p className="mt-1 text-[11px] text-steel-400">
        {point.label}
        {context === "" ? null : ` · ${context}`}
      </p>
      <p className="text-[11px] text-steel-400">{resultLabel(point.result)}</p>
    </TooltipBox>
  );
}

export function TrendChart({ points, metric, domain, label }: TrendChartProps) {
  const axis = themeColor("steel-700");
  const muted = themeColor("steel-400");
  const surface = themeColor("steel-950");
  const win = themeColor("quench-500");
  const loss = themeColor("ember-600");

  return (
    <figure className="m-0">
      <div className="h-52 w-full sm:h-60">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={[...points]} margin={{ ...CHART_MARGIN }}>
            <CartesianGrid stroke={axis} vertical={false} />
            <XAxis
              dataKey="label"
              tick={{ fill: muted, fontSize: 11 }}
              tickLine={false}
              axisLine={{ stroke: axis }}
              minTickGap={24}
            />
            <YAxis
              domain={[...domain]}
              tick={{ fill: muted, fontSize: 11 }}
              tickLine={false}
              axisLine={false}
              width={AXIS_WIDTH}
              tickFormatter={(value: number) => formatMetric(value, metric)}
            />
            <Tooltip
              cursor={{ stroke: axis, strokeWidth: 1 }}
              content={(props: TooltipContentProps) => trendTooltip(props, metric, label)}
            />
            {/* La ligne relie, elle n'identifie pas : elle reste en gris. */}
            <Line
              type="monotone"
              dataKey="value"
              name={label}
              stroke={muted}
              strokeWidth={2}
              dot={false}
              activeDot={false}
              connectNulls={false}
              isAnimationActive={false}
            />
            <ResultDots dataKey="win" fill={win} ring={surface} />
            <ResultDots dataKey="loss" fill={loss} ring={surface} />
            {/* Point creux : une forme, pas une troisième couleur (cf. en-tête). */}
            <ResultDots dataKey="other" fill={surface} ring={muted} ringWidth={1.5} />
          </LineChart>
        </ResponsiveContainer>
      </div>

      <figcaption className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-[11px] text-steel-400">
        <LegendItem color={win} label="Victoire" />
        <LegendItem color={loss} label="Défaite" />
        <LegendItem color={surface} ring={muted} label="Égalité ou inconnu" />
        <span className="text-steel-500">Axe vertical cadré sur la plage observée.</span>
      </figcaption>
    </figure>
  );
}

interface ResultDotsProps {
  readonly dataKey: "win" | "loss" | "other";
  readonly fill: string;
  /** Contour du point : l'anneau qui le détache de la ligne qu'il croise. */
  readonly ring: string;
  readonly ringWidth?: number;
}

/**
 * Une série de points sans ligne : `strokeWidth={0}` efface le trait, les
 * points restent. C'est ce qui permet de colorer l'issue de chaque partie sans
 * jamais recolorer la courbe qui les relie.
 */
function ResultDots({ dataKey, fill, ring, ringWidth = RING_WIDTH }: ResultDotsProps) {
  return (
    <Line
      dataKey={dataKey}
      stroke={fill}
      strokeWidth={0}
      connectNulls={false}
      isAnimationActive={false}
      legendType="none"
      dot={{ r: DOT_RADIUS, fill, stroke: ring, strokeWidth: ringWidth }}
      activeDot={{ r: DOT_RADIUS + 2, fill, stroke: ring, strokeWidth: ringWidth }}
    />
  );
}

interface LegendItemProps {
  readonly color: string;
  readonly label: string;
  /** Contour, pour le point creux qui n'a pas de couleur de remplissage. */
  readonly ring?: string;
}

function LegendItem({ color, label, ring }: LegendItemProps) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <svg aria-hidden="true" viewBox="0 0 10 10" className="size-2.5 shrink-0">
        <circle cx="5" cy="5" r="4" fill={color} stroke={ring ?? "none"} strokeWidth="1.5" />
      </svg>
      {label}
    </span>
  );
}

/* ------------------------------------------------------------------ */
/* Pont bench ↔ in-game                                                */
/* ------------------------------------------------------------------ */

interface BridgeChartProps {
  readonly bridge: Bridge;
  readonly season: SeasonId;
  /** Domaines verticaux des deux cadres, calculés chez l'appelant. */
  readonly benchDomain: readonly [number, number];
  readonly ingameDomain: readonly [number, number];
  readonly timeZone?: string;
}

/**
 * Les deux cadres, empilés et calés sur le même axe du temps.
 *
 * L'alignement au pixel tient à trois réglages identiques d'un cadre à
 * l'autre : la largeur de l'axe des ordonnées, les marges gauche/droite, et le
 * domaine de l'abscisse. Le cadre du haut n'affiche pas ses graduations
 * horizontales — un seul axe du temps se lit, celui du bas les porte pour les
 * deux.
 */
export function BridgeChart({
  bridge,
  season,
  benchDomain,
  ingameDomain,
  timeZone,
}: BridgeChartProps) {
  const tier = getTierFor(season, bridge.tier);
  const ticks = timeTicks(bridge.from, bridge.to);
  const formatTime = (value: number) => formatChartDate(new Date(value).toISOString(), timeZone);

  return (
    <figure className="m-0 flex flex-col gap-1">
      <BridgePane
        title={`Overall Voltaic · ${tier.label}`}
        color={themeColor("ember-600")}
        points={bridge.bench}
        domain={benchDomain}
        from={bridge.from}
        to={bridge.to}
        ticks={ticks}
        formatTime={formatTime}
        formatValue={(value) => formatEnergy(value)}
        showTimeAxis={false}
      />
      <BridgePane
        title="HS% en partie"
        color={themeColor("quench-500")}
        points={bridge.ingame}
        domain={ingameDomain}
        from={bridge.from}
        to={bridge.to}
        ticks={ticks}
        formatTime={formatTime}
        formatValue={(value) => formatPercent(value)}
        showTimeAxis
      />

      <figcaption className="mt-2 text-[11px] leading-relaxed text-steel-500">
        Deux cadres, un seul axe du temps — et jamais deux échelles superposées : une énergie
        Voltaic et un pourcentage de tirs à la tête ne se comparent pas, seule leur position dans le
        temps est commune. Chaque axe vertical est cadré sur sa propre plage observée.
      </figcaption>
    </figure>
  );
}

interface BridgePaneProps {
  readonly title: string;
  readonly color: string;
  readonly points: Bridge["bench"];
  readonly domain: readonly [number, number];
  readonly from: number;
  readonly to: number;
  readonly ticks: readonly number[];
  readonly formatTime: (value: number) => string;
  readonly formatValue: (value: number) => string;
  readonly showTimeAxis: boolean;
}

function BridgePane({
  title,
  color,
  points,
  domain,
  from,
  to,
  ticks,
  formatTime,
  formatValue,
  showTimeAxis,
}: BridgePaneProps) {
  const axis = themeColor("steel-700");
  const muted = themeColor("steel-400");
  const surface = themeColor("steel-950");

  return (
    <div>
      <p className="mb-1 text-[11px] font-medium tracking-wide text-steel-400 uppercase">{title}</p>
      <div className={showTimeAxis ? "h-36 w-full" : "h-28 w-full"}>
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={[...points]} margin={{ ...CHART_MARGIN }}>
            <CartesianGrid stroke={axis} vertical={false} />
            <XAxis
              dataKey="t"
              type="number"
              domain={[from, to]}
              ticks={[...ticks]}
              tickFormatter={formatTime}
              tick={showTimeAxis ? { fill: muted, fontSize: 11 } : false}
              tickLine={false}
              axisLine={{ stroke: axis }}
              height={showTimeAxis ? 24 : 8}
            />
            <YAxis
              domain={[...domain]}
              tick={{ fill: muted, fontSize: 11 }}
              tickLine={false}
              axisLine={false}
              width={AXIS_WIDTH}
              tickFormatter={formatValue}
            />
            <Tooltip
              cursor={{ stroke: axis, strokeWidth: 1 }}
              content={(props: TooltipContentProps) => {
                if (!props.active) return null;

                const entry = props.payload?.[0];

                if (entry === undefined) return null;

                return (
                  <TooltipBox>
                    <p className="font-mono text-sm tabular-nums text-steel-100">
                      {typeof entry.value === "number" ? formatValue(entry.value) : UNKNOWN}
                    </p>
                    <p className="mt-1 text-[11px] text-steel-400">
                      {typeof props.label === "number" ? formatTime(props.label) : ""}
                    </p>
                  </TooltipBox>
                );
              }}
            />
            <Line
              type="monotone"
              dataKey="value"
              name={title}
              stroke={color}
              strokeWidth={2}
              connectNulls={false}
              isAnimationActive={false}
              dot={{ r: DOT_RADIUS, fill: color, stroke: surface, strokeWidth: RING_WIDTH }}
              activeDot={{ r: DOT_RADIUS + 2, stroke: surface, strokeWidth: RING_WIDTH }}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

/**
 * Quatre graduations réparties sur la fenêtre, bornes comprises.
 *
 * Elles sont calculées une fois et **passées aux deux cadres** : deux axes qui
 * choisiraient chacun leurs graduations ne tomberaient pas en face, et
 * l'alignement — la seule chose que cette figure demande à l'œil de croire —
 * serait faux.
 */
function timeTicks(from: number, to: number, count = 4): readonly number[] {
  if (to <= from) return [from];

  const step = (to - from) / (count - 1);

  return Array.from({ length: count }, (_, index) => Math.round(from + index * step));
}
