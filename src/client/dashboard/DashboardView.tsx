/**
 * Dashboard : les quatre emplacements de la synthèse, dans leur ordre de
 * lecture (où j'en suis · ce qui coince · quoi faire aujourd'hui · ce que
 * disait la dernière partie).
 *
 * Deux emplacements sont déjà branchés sur les vraies données du bench, deux
 * attendent leur module (P3, P4) et affichent un état vide qui annonce la
 * couleur plutôt qu'une carte grise sans explication.
 *
 * Le bench vient de Supabase (`../data`), comme le tracker et l'historique.
 */

import { type ReactNode, useCallback, useEffect, useState } from "react";
import { getTier } from "../../lib/energy";
import { RankBadge } from "../components/RankBadge";
import { type BenchRunDetail, getBenchRunDetail, listBenchRuns } from "../data";
import { rankColorFor } from "../energy-view";
import { formatEnergy, formatRunDate } from "../format";
import { type Route, routeHash } from "../route";
import { latestRun, weakestSubcategories } from "./summary";

type Bench =
  | { readonly status: "loading" }
  /** Aucune passe, ou base injoignable : dans les deux cas, rien à montrer. */
  | { readonly status: "empty"; readonly reason: string | null }
  | { readonly status: "ready"; readonly run: BenchRunDetail };

const TRACKER_HASH = routeHash({ view: "tracker", runId: null });

function historyHash(runId: number | null): string {
  const route: Route = { view: "history", runId };

  return routeHash(route);
}

export function DashboardView() {
  const [bench, setBench] = useState<Bench>({ status: "loading" });

  const load = useCallback(async () => {
    setBench({ status: "loading" });
    try {
      const last = latestRun(await listBenchRuns());

      if (last === null) {
        setBench({ status: "empty", reason: null });
        return;
      }
      setBench({ status: "ready", run: await getBenchRunDetail(last.id) });
    } catch (cause) {
      // Le dashboard n'est pas le bon endroit pour crier : il annonce
      // l'absence de données et laisse le tracker traiter l'erreur en détail.
      setBench({
        status: "empty",
        reason: cause instanceof Error ? cause.message : "Données du bench indisponibles.",
      });
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-lg font-semibold text-steel-100">Tableau de bord</h1>
        <p className="mt-0.5 text-xs text-steel-500">
          Le bench dit où tu en es, les debriefs ce qui coince, la routine quoi travailler.
        </p>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="Dernier bench" action={{ href: historyHash(null), label: "Historique" }}>
          <LastBench bench={bench} onRetry={() => void load()} />
        </Card>

        <Card title="Sous-catégories les plus faibles">
          <Weaknesses bench={bench} />
        </Card>

        <Card title="Routine du jour">
          <Placeholder
            headline="Pas encore de routine."
            detail="La génération de séance arrive avec le module Routine : elle partira des sous-catégories basses de ton dernier bench et des axes de tes derniers debriefs."
          />
        </Card>

        <Card title="Dernier debrief">
          <Placeholder
            headline="Aucun debrief."
            detail="Le coach post-game arrive au module suivant : tu colleras tes stats de partie, il rendra points forts, axes de travail et focus."
          />
        </Card>
      </div>
    </div>
  );
}

interface CardProps {
  readonly title: string;
  readonly action?: { readonly href: string; readonly label: string };
  readonly children: ReactNode;
}

function Card({ title, action, children }: CardProps) {
  return (
    <section className="flex flex-col gap-3 rounded-xl border border-steel-800 bg-steel-900/60 p-4 sm:p-5">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-[11px] font-medium tracking-[0.18em] text-steel-400 uppercase">
          {title}
        </h2>
        {action === undefined ? null : (
          <a
            href={action.href}
            className="text-xs text-steel-500 transition-colors hover:text-steel-200"
          >
            {action.label} →
          </a>
        )}
      </div>
      {children}
    </section>
  );
}

function LastBench({ bench, onRetry }: { readonly bench: Bench; readonly onRetry: () => void }) {
  if (bench.status === "loading") return <Skeleton />;

  if (bench.status === "empty") {
    return (
      <div className="flex flex-col items-start gap-3">
        <Placeholder
          headline="Aucune passe enregistrée."
          detail={bench.reason ?? "Saisis tes 18 scores dans le tracker : le rang suivra."}
        />
        <div className="flex gap-2">
          <a
            href={TRACKER_HASH}
            className="rounded-lg bg-ember-600 px-3 py-2 text-xs font-semibold text-steel-100 transition-colors hover:bg-ember-500"
          >
            Ouvrir le tracker
          </a>
          {bench.reason === null ? null : (
            <button
              type="button"
              onClick={onRetry}
              className="rounded-lg border border-steel-700 px-3 py-2 text-xs font-medium text-steel-300 transition-colors hover:border-steel-600 hover:text-steel-100"
            >
              Réessayer
            </button>
          )}
        </div>
      </div>
    );
  }

  const { run } = bench;

  return (
    <a href={historyHash(run.id)} className="flex items-end gap-4">
      <div>
        <p className="font-mono text-3xl leading-none font-semibold tabular-nums text-steel-100">
          {run.overall > 0 ? formatEnergy(run.overall) : "—"}
        </p>
        <p className="mt-2 text-xs text-steel-500">
          {getTier(run.tier).label} · {formatRunDate(run.date)}
        </p>
      </div>
      <div className="ml-auto shrink-0">
        <RankBadge
          rank={run.rank}
          color={rankColorFor(run.tier, run.overall)}
          complete={run.complete}
        />
      </div>
    </a>
  );
}

function Weaknesses({ bench }: { readonly bench: Bench }) {
  if (bench.status === "loading") return <Skeleton />;
  if (bench.status === "empty") {
    return (
      <Placeholder
        headline="Rien à comparer pour l'instant."
        detail="Les trois sous-catégories les plus basses de ta dernière passe s'afficheront ici."
      />
    );
  }

  const weakest = weakestSubcategories(bench.run.subcategories);

  return (
    <ul className="flex flex-col gap-2">
      {weakest.map((sub) => (
        <li
          key={sub.name}
          className="flex items-baseline justify-between gap-3 rounded-lg bg-steel-950/60 px-3 py-2"
        >
          <span className="min-w-0 truncate text-sm text-steel-200">{sub.name}</span>
          <span className="shrink-0 font-mono text-sm tabular-nums text-steel-400">
            {sub.energy > 0 ? formatEnergy(sub.energy) : "—"}
          </span>
        </li>
      ))}
    </ul>
  );
}

function Placeholder({ headline, detail }: { readonly headline: string; readonly detail: string }) {
  return (
    <div className="rounded-lg border border-dashed border-steel-800 bg-steel-950/40 p-4">
      <p className="text-sm text-steel-300">{headline}</p>
      <p className="mt-1 text-xs leading-relaxed text-steel-500">{detail}</p>
    </div>
  );
}

function Skeleton() {
  return (
    <div aria-hidden="true" className="flex flex-col gap-2">
      <div className="h-8 w-28 rounded bg-steel-800/70" />
      <div className="h-3 w-40 rounded bg-steel-800/50" />
    </div>
  );
}
