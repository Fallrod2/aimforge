/**
 * L'onglet Valorant (SPEC §5 sexies, V2) : vue d'ensemble, tendances,
 * ventilations, pont bench ↔ in-game, liste des parties — et, derrière
 * `#/valorant?match=<id>`, la page d'une partie.
 *
 * ## Ce qui est chargé, et quand
 *
 * Trois lectures, indépendantes, dont deux peuvent échouer sans emporter
 * l'écran :
 *
 * - les **comptes liés** décident de tout : sans Riot ID lié, la vue n'est pas
 *   vide, elle invite à en lier un (patron `LinkInvite`, comme le tracker et le
 *   dashboard) ;
 * - les **agrégats** (`api/valorant/stats`) sont le cœur : leur échec est dit,
 *   avec un « Réessayer » ;
 * - les **passes de bench** ne servent qu'au pont ; leur échec fait disparaître
 *   la section, il n'alarme pas — on n'interrompt pas la lecture des stats de
 *   jeu parce qu'une courbe d'entraînement manque.
 *
 * Les **figures sont chargées à la demande** (`ValorantCharts`), pour la même
 * raison que l'historique : Recharts tire d3 et un store Redux, et le tableau
 * de bord n'a aucune raison de les télécharger. La vue elle-même est déjà
 * derrière un `lazy` dans `App.tsx` ; ce second découpage garde le chunk de la
 * vue léger, pour que les chiffres s'affichent avant les courbes.
 *
 * ## Le rafraîchissement
 *
 * Le bouton relance `api/valorant/refresh` (l'import des parties depuis la
 * source) **puis** relit les agrégats. L'ordre compte : relire les agrégats
 * seuls ne montrerait jamais une partie jouée depuis la dernière ouverture.
 */

import { lazy, type ReactNode, Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { DEFAULT_BENCHMARK_ID } from "../../lib/energy";
import { Notice } from "../components/Notice";
import {
  type BenchRunSummary,
  debriefedMatches,
  getValorantStats,
  type LinkedAccount,
  listBenchRuns,
  primaryAccount,
  refreshRiotAccount,
  type TrendPoint,
  type ValorantStatsResponse,
} from "../data";
import { LinkInvite } from "../linked/LinkInvite";
import { useLinkedAccounts } from "../linked/useLinkedAccounts";
import { BreakdownTables } from "./BreakdownTables";
import { type Bridge, buildBridge } from "./bridge";
import { formatCount } from "./display";
import { MatchList } from "./MatchList";
import { MatchView } from "./MatchView";
import { Overview, RankHeader } from "./Overview";
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

interface ValorantViewProps {
  /** Partie ouverte, portée par la route ; `null` = la vue d'ensemble. */
  readonly matchId: string | null;
  readonly onOpenMatch: (matchId: string | null) => void;
}

export function ValorantView({ matchId, onOpenMatch }: ValorantViewProps) {
  // Deux écrans, deux composants : la page de match n'a aucune raison de lire
  // les comptes liés, et un `useLinkedAccounts` appelé pour être ignoré ferait
  // une requête à chaque ouverture de partie.
  if (matchId !== null) {
    return <MatchView matchId={matchId} onBack={() => onOpenMatch(null)} />;
  }
  return <ProfileScreen />;
}

/** La vue d'ensemble : elle commence par savoir s'il y a un compte Riot lié. */
function ProfileScreen() {
  const linked = useLinkedAccounts();

  if (linked.state.status === "loading") {
    return (
      <div className="flex flex-col gap-4">
        <Header />
        <Skeleton lines={4} />
      </div>
    );
  }

  if (linked.state.status === "error") {
    return (
      <div className="flex flex-col gap-4">
        <Header />
        <Notice tone="error" title="Comptes liés indisponibles." onRetry={linked.reload}>
          {linked.state.message}
        </Notice>
      </div>
    );
  }

  const account = primaryAccount(linked.state.accounts, "riot");

  if (account === null) {
    return (
      <div className="flex flex-col gap-4">
        <Header />
        <LinkInvite title="Suis tes parties sans rien saisir">
          Lie ton Riot ID : ton rang, tes parties classées, ton HS% et ton ADR partie après partie
          apparaîtront ici, et le coach pourra débriefer un match sans que tu colles quoi que ce
          soit.
        </LinkInvite>
      </div>
    );
  }

  return <Live account={account} />;
}

function Header() {
  return (
    <div>
      <h1 className="text-lg font-semibold text-steel-100">Valorant</h1>
      <p className="mt-0.5 text-xs text-steel-500">
        Ce que disent tes parties classées — et ce que ton entraînement y change.
      </p>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* La vue, une fois le compte connu                                    */
/* ------------------------------------------------------------------ */

function Live({ account }: { readonly account: LinkedAccount }) {
  const [stats, setStats] = useState<Stats>({ status: "loading" });
  const [period, setPeriod] = useState<PeriodId>("last30Days");
  const [refreshing, setRefreshing] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
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
    // doit faire échouer l'écran — leur absence se voit, elle ne s'annonce pas.
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

  const refresh = useCallback(async () => {
    setRefreshing(true);
    setNotice(null);
    try {
      await refreshRiotAccount(account.id);
      await load();
    } catch (cause) {
      // Une source non configurée ou injoignable n'est pas une panne de l'écran :
      // on le dit en petit et on laisse à l'affichage ce qu'on avait déjà.
      setNotice(
        cause instanceof Error ? cause.message : "Rang et parties n'ont pas pu être mis à jour.",
      );
    } finally {
      setRefreshing(false);
    }
  }, [account.id, load]);

  const response = stats.status === "ready" ? stats.response : null;
  const trend = useMemo(
    () => (response === null ? [] : trendWithin(response.stats.trend, period)),
    [response, period],
  );
  const bridge = useMemo(
    () =>
      response === null ? null : buildBridge(runs, response.stats.trend, DEFAULT_BENCHMARK_ID),
    [runs, response],
  );

  return (
    <div className="flex flex-col gap-6">
      <Header />
      <RankHeader
        account={account}
        refreshing={refreshing}
        onRefresh={() => void refresh()}
        notice={notice}
      />

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
          Lance « Rafraîchir » : les dernières parties classées de {account.externalId} seront
          importées, puis analysées ici. Sans partie, il n'y a ni tendance ni scoreboard à montrer.
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
          <BridgeSection bridge={bridge} />
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

function BridgeSection({ bridge }: { readonly bridge: Bridge | null }) {
  return (
    <Section
      title="Ton aim training paie-t-il ?"
      caption="L'overall Voltaic et le HS% en partie, sur le même axe du temps."
    >
      {bridge === null ? (
        <Empty>
          Il faut au moins deux passes de bench de la saison courante et deux parties datées avec un
          HS% connu pour mettre les deux courbes en regard.
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
              benchmarkId={DEFAULT_BENCHMARK_ID}
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
