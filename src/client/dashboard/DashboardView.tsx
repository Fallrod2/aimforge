/**
 * Dashboard : les quatre emplacements de la synthèse, dans leur ordre de
 * lecture (où j'en suis · ce qui coince · quoi faire aujourd'hui · ce que
 * disait la dernière partie).
 *
 * Les quatre viennent de Supabase (`../data`), comme le tracker et
 * l'historique.
 *
 * Sur un compte neuf, l'emplacement « dernier bench » ne montre pas un vide
 * mais **le chemin le plus court vers une passe** : lier son pseudo KovaaK's,
 * qui remplit les 18 scores tout seuls (SPEC §5 bis). La saisie manuelle vient
 * juste derrière — elle marche toujours, et redevient le seul chemin dès qu'un
 * compte est lié.
 *
 * La routine affichée est celle **du jour et pas encore faite**
 * (`../routine/today.ts`) : le dashboard répond à « qu'est-ce que je fais
 * maintenant ? », pas « qu'ai-je fait ». Sans routine ouverte aujourd'hui, il
 * renvoie vers la page qui en génère une — un appel au modèle se déclenche sur
 * décision du joueur, jamais parce qu'il a ouvert son accueil.
 */

import { type ReactNode, useCallback, useEffect, useState } from "react";
import { getTierFor } from "../../lib/energy";
import type { StoredDebrief } from "../../shared/coach-contract";
import type { StoredRoutine } from "../../shared/routine-contract";
import { RankBadge } from "../components/RankBadge";
import {
  accountsOf,
  type BenchRunDetail,
  getBenchRunDetail,
  listBenchRuns,
  listDebriefs,
  listRoutines,
} from "../data";
import { rankColorForSeason } from "../energy-view";
import { formatEnergy, formatRunDate } from "../format";
import { LinkInvite } from "../linked/LinkInvite";
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

/** Le dernier debrief du coach. Mêmes trois états, pour les mêmes raisons. */
type Latest =
  | { readonly status: "loading" }
  | { readonly status: "empty"; readonly reason: string | null }
  | { readonly status: "ready"; readonly debrief: StoredDebrief };

const TRACKER_HASH = routeHash({ view: "tracker", runId: null });

const ROUTINE_HASH = routeHash({ view: "routine", runId: null });

const COACH_HASH = routeHash({ view: "coach", runId: null });

/** Le geste principal d'un emplacement vide. Un seul par carte, jamais deux. */
const PRIMARY_ACTION =
  "rounded-lg bg-ember-600 px-3 py-2 text-xs font-semibold text-steel-100 transition-colors hover:bg-ember-500";

function historyHash(runId: number | null): string {
  const route: Route = { view: "history", runId };

  return routeHash(route);
}

export function DashboardView() {
  const [bench, setBench] = useState<Bench>({ status: "loading" });
  const [today, setToday] = useState<Today>({ status: "loading" });
  const [latest, setLatest] = useState<Latest>({ status: "loading" });
  const linked = useLinkedAccounts();
  /**
   * Un compte KovaaK's est-il lié ? `null` tant qu'on ne sait pas : proposer
   * une liaison à quelqu'un qui en a déjà une serait pire qu'attendre deux
   * cents millisecondes.
   */
  const kovaaksLinked =
    linked.state.status === "ready"
      ? accountsOf(linked.state.accounts, "kovaaks").length > 0
      : null;

  const loadLatest = useCallback(async () => {
    setLatest({ status: "loading" });
    try {
      // Un seul debrief : c'est un emplacement de synthèse, pas l'historique
      // du coach. La page Coach porte le reste.
      const [debrief] = await listDebriefs(1);

      setLatest(
        debrief === undefined ? { status: "empty", reason: null } : { status: "ready", debrief },
      );
    } catch (cause) {
      setLatest({
        status: "empty",
        reason: cause instanceof Error ? cause.message : "Debriefs indisponibles.",
      });
    }
  }, []);

  useEffect(() => {
    void loadLatest();
  }, [loadLatest]);

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
          <LastBench bench={bench} kovaaksLinked={kovaaksLinked} onRetry={() => void load()} />
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

        <Card title="Dernier debrief" action={{ href: COACH_HASH, label: "Coach" }}>
          <LastDebrief latest={latest} />
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

interface LastBenchProps {
  readonly bench: Bench;
  /** Un compte KovaaK's est-il lié ? `null` tant qu'on ne sait pas. */
  readonly kovaaksLinked: boolean | null;
  readonly onRetry: () => void;
}

function LastBench({ bench, kovaaksLinked, onRetry }: LastBenchProps) {
  if (bench.status === "loading") return <Skeleton />;

  if (bench.status === "empty") {
    // Une lecture en échec n'est pas un compte neuf : on dit ce qui s'est
    // passé et on propose de réessayer, sans inviter à lier quoi que ce soit.
    if (bench.reason !== null) {
      return (
        <div className="flex flex-col items-start gap-3">
          <Placeholder headline="Aucune passe enregistrée." detail={bench.reason} />
          <div className="flex gap-2">
            <a href={TRACKER_HASH} className={PRIMARY_ACTION}>
              Ouvrir le tracker
            </a>
            <button
              type="button"
              onClick={onRetry}
              className="rounded-lg border border-steel-700 px-3 py-2 text-xs font-medium text-steel-300 transition-colors hover:border-steel-600 hover:text-steel-100"
            >
              Réessayer
            </button>
          </div>
        </div>
      );
    }

    // Compte neuf, aucun pseudo KovaaK's lié : le chemin premier est la
    // liaison, qui remplit les 18 scores d'un coup. Le tracker reste offert
    // juste dessous, en second — c'est le seul chemin quand rien n'est lié à
    // aller chercher, et il ne doit jamais disparaître.
    if (kovaaksLinked === false) {
      return (
        <div className="flex flex-col gap-3">
          <LinkInvite title="Tes 18 scores peuvent arriver tout seuls" action="Lier KovaaK's">
            Lie ton pseudo kovaaks.com une fois : le tracker ira chercher tes scores du benchmark
            Voltaic, tu vérifies, tu enregistres.
          </LinkInvite>
          <a
            href={TRACKER_HASH}
            className="self-start text-xs text-steel-400 underline-offset-2 transition-colors hover:text-steel-200 hover:underline"
          >
            Ou saisis tes 18 scores à la main →
          </a>
        </div>
      );
    }

    return (
      <div className="flex flex-col items-start gap-3">
        <Placeholder
          headline="Aucune passe enregistrée."
          detail="Ouvre le tracker : tes scores KovaaK's s'y importent en un clic, et la saisie manuelle reste là pour les corriger."
        />
        <a href={TRACKER_HASH} className={PRIMARY_ACTION}>
          Ouvrir le tracker
        </a>
      </div>
    );
  }

  const { run } = bench;

  // Libellé de palier et couleur de rang lus dans la saison **de la passe** :
  // le dashboard montre la dernière passe, quelle que soit sa saison, et ne
  // doit pas la repeindre aux couleurs de la saison courante (SPEC §5 quinquies).
  return (
    <a href={historyHash(run.id)} className="flex items-end gap-4">
      <div>
        <p className="font-mono text-3xl leading-none font-semibold tabular-nums text-steel-100">
          {run.overall > 0 ? formatEnergy(run.overall) : "—"}
        </p>
        <p className="mt-2 text-xs text-steel-500">
          {getTierFor(run.season, run.tier).label} · {formatRunDate(run.date)}
        </p>
      </div>
      <div className="ml-auto shrink-0">
        <RankBadge
          rank={run.rank}
          color={rankColorForSeason(run.season, run.tier, run.overall)}
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
        <a href={ROUTINE_HASH} className={PRIMARY_ACTION}>
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

/**
 * Le dernier debrief : sa date, son résumé, et le focus qu'il a laissé.
 *
 * Le focus est repris en entier, jamais tronqué : c'est la seule phrase du
 * debrief qui dit quoi faire, et un dashboard qui la coupe au milieu ne sert
 * plus à rien. Le résumé, lui, se contente de trois lignes — le détail vit sur
 * la page Coach, où le lien de la carte mène.
 */
function LastDebrief({ latest }: { readonly latest: Latest }) {
  if (latest.status === "loading") return <Skeleton />;

  if (latest.status === "empty") {
    return (
      <div className="flex flex-col items-start gap-3">
        <Placeholder
          headline="Aucun debrief."
          detail={
            latest.reason ??
            "Colle les stats de ta prochaine partie : le coach en tire tes points forts, tes axes de travail et un focus."
          }
        />
        <a href={COACH_HASH} className={PRIMARY_ACTION}>
          Ouvrir le coach
        </a>
      </div>
    );
  }

  const { debrief } = latest;

  return (
    <a href={COACH_HASH} className="flex flex-col gap-2">
      <p className="text-xs text-steel-500">{formatRunDate(debrief.date)}</p>
      <p className="line-clamp-3 text-sm leading-relaxed text-steel-200">{debrief.resume}</p>
      <p className="rounded-lg bg-steel-950/60 px-3 py-2 text-xs leading-relaxed text-steel-300">
        <span className="font-medium text-ember-400">Focus · </span>
        {debrief.focus}
      </p>
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
