/**
 * Ce que disent les parties classées : vue d'ensemble, tendances, ventilations,
 * pont bench ↔ in-game, liste des parties (SPEC §5 sexies).
 *
 * C'était l'onglet Valorant ; depuis V6, c'est **le fond du bloc Valorant de
 * l'accueil**, ouvert à la demande. Le raisonnement : le rang et les trois
 * dernières parties répondent à « où j'en suis », et c'est ce que l'accueil doit
 * dire tout de suite ; les courbes répondent à « qu'est-ce que ça donne dans le
 * temps », et ça se demande. Un onglet permanent pour cette seconde question
 * faisait payer sa place à tout le monde, tous les jours.
 *
 * ## Ce qui est chargé, et quand
 *
 * Deux lectures indépendantes, dont une peut échouer sans emporter le bloc :
 *
 * - les **agrégats** (`api/valorant/stats`) sont le cœur : leur échec est dit,
 *   avec un « Réessayer » ;
 * - les **passes de bench** ne servent qu'au pont ; leur échec fait disparaître
 *   la section, il n'alarme pas — on n'interrompt pas la lecture des stats de
 *   jeu parce qu'une courbe d'entraînement manque.
 *
 * Les **figures sont elles-mêmes différées** (`ValorantCharts`), pour la même
 * raison que l'historique des perfs : Recharts tire d3 et un store Redux. Ce
 * second découpage garde le chunk du bloc léger, pour que les chiffres
 * s'affichent avant les courbes.
 *
 * Le **rafraîchissement** n'est pas ici mais dans `LinkedAccountsPanel` /
 * `ValorantPanel`, juste au-dessus : c'est lui qui va chercher les parties chez
 * la source. Ce bloc, lui, relit les agrégats à chaque montage — donc à chaque
 * ouverture du repli, après un rafraîchissement.
 */

import { lazy, type ReactNode, Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { type BenchmarkId, getBenchmark } from "../../lib/energy";
import { useActiveBenchmark } from "../app/active-benchmark";
import { Notice } from "../components/Notice";
import {
  type BenchRunSummary,
  debriefedMatches,
  getValorantStats,
  type LinkedAccount,
  listBenchRuns,
  type TrendPoint,
  type ValorantStatsResponse,
} from "../data";
import { BreakdownTables } from "./BreakdownTables";
import { type Bridge, buildBridge } from "./bridge";
import { formatCount } from "./display";
import { MatchList } from "./MatchList";
import { Overview } from "./Overview";
import { PERIOD_CAPTIONS, type PeriodId, totalsFor, trendWithin } from "./periods";
import { paddedDomain } from "./scale";
import { buildTrendSeries, hasValues, metricSeries } from "./series";
import { Empty, Section, Skeleton } from "./ui";

const TrendChart = lazy(async () => ({
  default: (await import("./ValorantCharts")).TrendChart,
}));

const BridgeChart = lazy(async () => ({
  default: (await import("./ValorantCharts")).BridgeChart,
}));

type Stats =
  | { readonly status: "loading" }
  | { readonly status: "error"; readonly message: string }
  | { readonly status: "ready"; readonly response: ValorantStatsResponse };

interface ValorantInsightsProps {
  /** Le compte Riot principal : le bloc n'existe pas sans lui. */
  readonly account: LinkedAccount;
}

export function ValorantInsights({ account }: ValorantInsightsProps) {
  // Le pont bench/in-game ne trace que les passes du benchmark **actif** : deux
  // benchmarks n'ont pas la même échelle d'énergie, et la courbe n'a qu'un axe.
  const { benchmarkId } = useActiveBenchmark();
  const [stats, setStats] = useState<Stats>({ status: "loading" });
  const [period, setPeriod] = useState<PeriodId>("last30Days");
  const [runs, setRuns] = useState<readonly BenchRunSummary[]>([]);
  const [debriefed, setDebriefed] = useState<ReadonlyMap<string, number>>(new Map());

  const load = useCallback(async () => {
    setStats({ status: "loading" });
    try {
      setStats({ status: "ready", response: await getValorantStats() });
    } catch (cause) {
      setStats({
        status: "error",
        message: cause instanceof Error ? cause.message : "Statistiques indisponibles.",
      });
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    let cancelled = false;

    // Deux lectures d'appoint : le pont et les badges. Ni l'une ni l'autre ne
    // doit faire échouer le bloc — leur absence se voit, elle ne s'annonce pas.
    void listBenchRuns()
      .then((loaded) => {
        if (!cancelled) setRuns(loaded);
      })
      .catch(() => {
        /* Pas de pont : la section le dira elle-même. */
      });
    void debriefedMatches()
      .then((byMatch) => {
        if (!cancelled) setDebriefed(byMatch);
      })
      .catch(() => {
        /* Pas de badge, c'est tout. */
      });

    return () => {
      cancelled = true;
    };
  }, []);

  const response = stats.status === "ready" ? stats.response : null;
  const trend = useMemo(
    () => (response === null ? [] : trendWithin(response.stats.trend, period)),
    [response, period],
  );
  const bridge = useMemo(
    () => (response === null ? null : buildBridge(runs, response.stats.trend, benchmarkId)),
    [runs, response, benchmarkId],
  );

  return (
    <div className="flex flex-col gap-4">
      {stats.status === "loading" ? <Skeleton lines={4} /> : null}

      {stats.status === "error" ? (
        <Notice
          tone="error"
          title="Les statistiques n'ont pas pu être chargées."
          onRetry={() => void load()}
        >
          {stats.message}
        </Notice>
      ) : null}

      {response === null ? null : response.matchCount === 0 ? (
        <Notice tone="empty" title="Aucune partie importée pour l'instant.">
          Lance « Rafraîchir » juste au-dessus : les dernières parties classées de{" "}
          {account.externalId} seront importées, puis analysées ici. Sans partie, il n'y a ni
          tendance ni scoreboard à montrer.
        </Notice>
      ) : (
        <>
          <Overview
            totals={totalsFor(response.stats.periods, period)}
            period={period}
            onPeriodChange={setPeriod}
          />
          <Trends trend={trend} period={period} />
          <BreakdownTables byAgent={response.stats.byAgent} byMap={response.stats.byMap} />
          <BridgeSection bridge={bridge} benchmarkId={benchmarkId} />
          <MatchList trend={trend} debriefed={debriefed} />
        </>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Tendances                                                           */
/* ------------------------------------------------------------------ */

/** Le repli du chargement différé : un cadre muet à la hauteur des figures. */
function ChartsLoading({ height }: { readonly height: string }) {
  return <div aria-busy="true" className={`${height} w-full rounded-lg bg-steel-950/40`} />;
}

function Trends({
  trend,
  period,
}: {
  readonly trend: readonly TrendPoint[];
  readonly period: PeriodId;
}) {
  const points = useMemo(() => buildTrendSeries(trend), [trend]);
  const hs = useMemo(() => metricSeries(points, "headshotPercent"), [points]);
  const adr = useMemo(() => metricSeries(points, "adr"), [points]);

  return (
    <Section title="Tendances" caption={`Partie après partie, ${PERIOD_CAPTIONS[period]}.`}>
      {points.length < 2 ? (
        <Empty>
          Il faut au moins deux parties sur la fenêtre pour tracer une tendance
          {points.length === 1 ? " : il n'y en a qu'une" : ""}.
        </Empty>
      ) : (
        <div className="flex flex-col gap-6">
          <Metric
            title="HS%"
            available={hasValues(points, "headshotPercent")}
            missing="Aucune de ces parties ne porte de pourcentage de tirs à la tête."
          >
            <Suspense fallback={<ChartsLoading height="h-52 sm:h-60" />}>
              <TrendChart
                points={hs}
                metric="headshotPercent"
                label="HS%"
                domain={paddedDomain(
                  hs.map((point) => point.value),
                  { lower: 0, upper: 100 },
                )}
              />
            </Suspense>
          </Metric>

          <Metric
            title="ADR"
            available={hasValues(points, "adr")}
            missing="Aucune de ces parties ne porte de dégâts par round."
          >
            <Suspense fallback={<ChartsLoading height="h-52 sm:h-60" />}>
              <TrendChart
                points={adr}
                metric="adr"
                label="ADR"
                domain={paddedDomain(
                  adr.map((point) => point.value),
                  { lower: 0 },
                )}
              />
            </Suspense>
          </Metric>
        </div>
      )}
    </Section>
  );
}

interface MetricProps {
  readonly title: string;
  readonly available: boolean;
  readonly missing: string;
  readonly children: ReactNode;
}

function Metric({ title, available, missing, children }: MetricProps) {
  return (
    <div className="flex flex-col gap-2">
      <p className="text-[11px] font-medium tracking-wide text-steel-400 uppercase">{title}</p>
      {available ? children : <Empty>{missing}</Empty>}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Pont bench ↔ in-game                                                */
/* ------------------------------------------------------------------ */

interface BridgeSectionProps {
  readonly bridge: Bridge | null;
  /** Le benchmark actif : celui des passes tracées, et celui qu'on nomme. */
  readonly benchmarkId: BenchmarkId;
}

function BridgeSection({ bridge, benchmarkId }: BridgeSectionProps) {
  const benchmarkName = getBenchmark(benchmarkId).name;

  return (
    <Section
      title="Ton aim training paie-t-il ?"
      caption={`L'overall ${benchmarkName} et le HS% en partie, sur le même axe du temps.`}
    >
      {bridge === null ? (
        <Empty>
          Il faut au moins deux passes de bench du barème {benchmarkName} et deux parties datées
          avec un HS% connu pour mettre les deux courbes en regard.
        </Empty>
      ) : (
        <div className="flex flex-col gap-3">
          {bridge.overlapDays === 0 ? (
            <p className="rounded-lg border border-dashed border-steel-800 bg-steel-950/40 p-3 text-[11px] leading-relaxed text-steel-500">
              Tes passes de bench et tes parties ne se recouvrent sur aucune journée : les deux
              courbes sont côte à côte dans le temps, pas en regard. N'y lis pas un lien.
            </p>
          ) : (
            <p className="text-[11px] text-steel-500">
              {formatCount(bridge.overlapDays)} jour{bridge.overlapDays > 1 ? "s" : ""} de
              recouvrement entre les deux séries.
            </p>
          )}
          <Suspense fallback={<ChartsLoading height="h-72" />}>
            <BridgeChart
              bridge={bridge}
              benchmarkId={benchmarkId}
              benchDomain={paddedDomain(
                bridge.bench.map((point) => point.value),
                { lower: 0 },
              )}
              ingameDomain={paddedDomain(
                bridge.ingame.map((point) => point.value),
                {
                  lower: 0,
                  upper: 100,
                },
              )}
            />
          </Suspense>
        </div>
      )}
    </Section>
  );
}
