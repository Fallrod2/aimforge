/**
 * Dashboard : les quatre emplacements de la synthèse, dans leur ordre de
 * lecture (où j'en suis · ce qui coince · quoi faire aujourd'hui · ce que
 * disait la dernière partie).
 *
 * Le bench et la routine viennent de Supabase (`../data`), comme le tracker et
 * l'historique. Le dernier debrief attend encore son branchement.
 *
 * La routine affichée est celle **du jour et pas encore faite**
 * (`../routine/today.ts`) : le dashboard répond à « qu'est-ce que je fais
 * maintenant ? », pas « qu'ai-je fait ». Sans routine ouverte aujourd'hui, il
 * renvoie vers la page qui en génère une — un appel au modèle se déclenche sur
 * décision du joueur, jamais parce qu'il a ouvert son accueil.
 */

import { type ReactNode, useCallback, useEffect, useState } from "react";
import { getTier } from "../../lib/energy";
import type { StoredRoutine } from "../../shared/routine-contract";
import { RankBadge } from "../components/RankBadge";
import { type BenchRunDetail, getBenchRunDetail, listBenchRuns, listRoutines } from "../data";
import { rankColorFor } from "../energy-view";
import { formatEnergy, formatRunDate } from "../format";
import { useLinkedAccounts } from "../linked/useLinkedAccounts";
import { ValorantPanel } from "../linked/ValorantPanel";
import { type Route, routeHash } from "../route";
import { formatDuration } from "../routine/duration";
import { routineOfToday } from "../routine/today";
import { latestRun, weakestSubcategories } from "./summary";

type Bench =
  | { readonly status: "loading" }
  /** Aucune passe, ou base injoignable : dans les deux cas, rien à montrer. */
  | { readonly status: "empty"; readonly reason: string | null }
  | { readonly status: "ready"; readonly run: BenchRunDetail };

/**
 * L'état de la routine du jour. `empty` couvre les deux cas où il n'y a rien à
 * montrer — aucune routine ouverte aujourd'hui, ou lecture impossible : dans
 * les deux cas, le bon geste proposé est le même (ouvrir la page Routine).
 */
type Today =
  | { readonly status: "loading" }
  | { readonly status: "empty"; readonly reason: string | null }
  | { readonly status: "ready"; readonly routine: StoredRoutine };

const TRACKER_HASH = routeHash({ view: "tracker", runId: null });

const ROUTINE_HASH = routeHash({ view: "routine", runId: null });

function historyHash(runId: number | null): string {
  const route: Route = { view: "history", runId };

  return routeHash(route);
}

export function DashboardView() {
  const [bench, setBench] = useState<Bench>({ status: "loading" });
  const [today, setToday] = useState<Today>({ status: "loading" });
  const linked = useLinkedAccounts();

  const loadRoutine = useCallback(async () => {
    setToday({ status: "loading" });
    try {
      // Une poignée de lignes suffit : la routine du jour est forcément dans
      // les plus récentes, et le dashboard n'a pas à charger tout l'historique.
      const routine = routineOfToday(await listRoutines(10));

      setToday(routine === null ? { status: "empty", reason: null } : { status: "ready", routine });
    } catch (cause) {
      setToday({
        status: "empty",
        reason: cause instanceof Error ? cause.message : "Routines indisponibles.",
      });
    }
  }, []);

  useEffect(() => {
    void loadRoutine();
  }, [loadRoutine]);

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

        {/* Le rang Valorant tient sur toute la largeur : c'est le seul
            emplacement qui porte une liste (les dernières parties). */}
        <div className="lg:col-span-2 lg:order-last">
          <Card title="Valorant">
            <ValorantPanel state={linked.state} />
          </Card>
        </div>

        <Card title="Sous-catégories les plus faibles">
          <Weaknesses bench={bench} />
        </Card>

        <Card title="Routine du jour" action={{ href: ROUTINE_HASH, label: "Routine" }}>
          <TodayRoutine today={today} />
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

/**
 * La routine du jour : son titre, ses blocs en une ligne, et le geste suivant.
 *
 * Sans routine ouverte, la carte ne montre pas un vide : elle porte le CTA vers
 * la page qui en génère une. C'est le seul endroit du dashboard qui appelle à
 * dépenser un quota, et il le fait par un lien — pas par un bouton qui
 * lancerait la génération depuis l'accueil.
 */
function TodayRoutine({ today }: { readonly today: Today }) {
  if (today.status === "loading") return <Skeleton />;

  if (today.status === "empty") {
    return (
      <div className="flex flex-col items-start gap-3">
        <Placeholder
          headline="Pas de routine ouverte aujourd'hui."
          detail={
            today.reason ??
            "Dis combien de temps tu as : la séance partira des sous-catégories basses de ton dernier bench et des axes de tes derniers debriefs."
          }
        />
        <a
          href={ROUTINE_HASH}
          className="rounded-lg bg-ember-600 px-3 py-2 text-xs font-semibold text-steel-100 transition-colors hover:bg-ember-500"
        >
          Générer une routine
        </a>
      </div>
    );
  }

  const { routine } = today;

  return (
    <a href={ROUTINE_HASH} className="flex flex-col gap-2">
      <div className="flex items-baseline justify-between gap-3">
        <p className="min-w-0 text-sm text-steel-100">{routine.titre}</p>
        <p className="shrink-0 font-mono text-sm tabular-nums text-steel-400">
          {formatDuration(routine.duree_totale)}
        </p>
      </div>
      <ul className="flex flex-col gap-1">
        {routine.blocs.map((bloc, index) => (
          <li
            // biome-ignore lint/suspicious/noArrayIndexKey: liste statique jamais réordonnée, deux blocs peuvent partager un nom — l'index évite la collision de clés.
            key={`${index}-${bloc.nom}`}
            className="flex items-baseline justify-between gap-3 rounded-lg bg-steel-950/60 px-3 py-2"
          >
            <span className="min-w-0 truncate text-sm text-steel-200">{bloc.nom}</span>
            <span className="shrink-0 font-mono text-xs tabular-nums text-steel-500">
              {formatDuration(bloc.duree)}
            </span>
          </li>
        ))}
      </ul>
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
