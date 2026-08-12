/**
 * Accueil : les quatre emplacements de la synthèse, dans leur ordre de
 * lecture (où j'en suis · ce qui coince · quoi faire aujourd'hui · ce que
 * disait la dernière partie), plus le bloc Valorant.
 *
 * Les quatre viennent de Supabase (`../data`), comme les perfs.
 *
 * **Le bloc Valorant n'apparaît que pour un Riot ID lié** (V6). C'est la
 * contrepartie de la disparition de l'onglet : sans compte lié il n'y avait rien
 * à montrer, et une carte qui n'aurait porté qu'une invitation à lier ferait de
 * l'accueil une page de réglages. L'invitation vit au Profil, avec les autres
 * comptes. Tant que la lecture des comptes n'a pas répondu, le bloc reste en
 * place : le faire apparaître après coup ferait sauter la grille.
 *
 * Sur un compte neuf, l'emplacement « dernier bench » ne montre pas un vide
 * mais **le chemin le plus court vers une passe** : lier son pseudo KovaaK's,
 * qui va chercher les scénarios déjà joués (SPEC §5 bis). Ce qu'il promet est
 * borné à ce que la source rend — un palier entamé revient incomplet, et
 * l'invitation le dit. La saisie manuelle vient juste derrière : elle marche
 * toujours, et reste le seul chemin pour ce que l'import n'a pas ramené.
 *
 * La routine affichée est celle **du jour et pas encore faite**
 * (`../routine/today.ts`) : le dashboard répond à « qu'est-ce que je fais
 * maintenant ? », pas « qu'ai-je fait ». Sans routine ouverte aujourd'hui, il
 * renvoie vers la page qui en génère une — un appel au modèle se déclenche sur
 * décision du joueur, jamais parce qu'il a ouvert son accueil.
 */

import { type ReactNode, useCallback, useEffect, useState } from "react";
import { getTierFor, partialEnergy } from "../../lib/energy";
import type { StoredDebrief } from "../../shared/coach-contract";
import type { StoredRoutine } from "../../shared/routine-contract";
import { DeltaBadge } from "../components/Delta";
import { RankBadge } from "../components/RankBadge";
import {
  accountsOf,
  type BenchRunDetail,
  getBenchRunDetail,
  listBenchRuns,
  listDebriefs,
  listRoutines,
  primaryAccount,
} from "../data";
import { rankColorForBenchmark } from "../energy-view";
import { formatEnergy, formatRunDate } from "../format";
import { LinkInvite } from "../linked/LinkInvite";
import { useLinkedAccounts } from "../linked/useLinkedAccounts";
import { ValorantPanel } from "../linked/ValorantPanel";
import { type RouteTarget, routeHash } from "../route";
import { formatDuration } from "../routine/duration";
import { routineOfToday } from "../routine/today";
import { deltaOf, previousRun, subcategoryDeltas } from "../run-delta";
import { ValorantInsightsPanel } from "../valorant/InsightsPanel";
import { latestRun, weakestSubcategories } from "./summary";

/**
 * L'état de l'emplacement « dernier bench ».
 *
 * Exporté depuis V4-B pour la **démonstration publique** (`demo/DemoView`), qui
 * rend les mêmes cartes avec des données calculées localement : la démo montre
 * le produit, elle ne montre pas une copie du produit.
 */
export type Bench =
  | { readonly status: "loading" }
  /** Aucune passe, ou base injoignable : dans les deux cas, rien à montrer. */
  | { readonly status: "empty"; readonly reason: string | null }
  | {
      readonly status: "ready";
      readonly run: BenchRunDetail;
      /**
       * La passe précédente du même palier et du même benchmark (§4.4), `null`
       * quand c'est la première — ou quand son détail n'a pas pu être lu. Un
       * écart est un supplément : son absence ne doit jamais empêcher la carte
       * d'afficher la passe elle-même.
       */
      readonly previous: BenchRunDetail | null;
    };

/**
 * L'état de la routine du jour. `empty` couvre les deux cas où il n'y a rien à
 * montrer — aucune routine ouverte aujourd'hui, ou lecture impossible : dans
 * les deux cas, le bon geste proposé est le même (ouvrir l'espace Coach).
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

const TRACKER_HASH = routeHash({ view: "perfs", tab: "saisie" });

/** La routine vit dans l'espace Coach depuis V6 : une seule adresse pour deux. */
const COACH_HASH = routeHash({ view: "coach" });

/** Le geste principal d'un emplacement vide. Un seul par carte, jamais deux. */
const PRIMARY_ACTION =
  "rounded-lg bg-ember-600 px-3 py-2 text-xs font-semibold text-steel-100 transition-colors hover:bg-ember-500";

function historyHash(runId: number | null): string {
  const route: RouteTarget = { view: "perfs", tab: "historique", runId };

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
  /**
   * Le compte Riot principal, `null` tant qu'on ne sait pas — ou s'il n'y en a
   * pas. Il commande deux choses : l'existence du bloc Valorant (voir plus bas)
   * et celle de son repli d'analyse, qui n'a de sens que rattaché à un compte.
   */
  const riot =
    linked.state.status === "ready" ? primaryAccount(linked.state.accounts, "riot") : null;
  // Le bloc disparaît quand on **sait** qu'aucun Riot ID n'est lié. Pendant le
  // chargement et en cas d'échec de lecture, il reste : le panneau dit lui-même
  // où il en est, et c'est mieux qu'une grille qui se réorganise après coup.
  const showValorant = linked.state.status !== "ready" || riot !== null;

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
      const runs = await listBenchRuns();
      const last = latestRun(runs);

      if (last === null) {
        setBench({ status: "empty", reason: null });
        return;
      }
      // La passe précédente est choisie sur la **liste** (une lecture déjà
      // faite) ; seul son détail coûte une requête de plus, et cette requête est
      // facultative : un échec la ramène à `null`, l'écart disparaît, la carte
      // reste.
      const earlier = previousRun(runs, last);
      const [run, previous] = await Promise.all([
        getBenchRunDetail(last.id),
        earlier === null ? null : getBenchRunDetail(earlier.id).catch(() => null),
      ]);

      setBench({ status: "ready", run, previous });
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
            emplacement qui porte une liste (les trois dernières parties, chacune
            un lien vers son scoreboard). Le reste — tendances, ventilations,
            pont bench ↔ in-game — est dans le repli en pied de carte : l'accueil
            résume, et il n'analyse que si on le lui demande. */}
        {showValorant ? (
          <div className="lg:col-span-2 lg:order-last">
            <Card title="Valorant">
              <ValorantPanel state={linked.state} />
              {riot === null ? null : <ValorantInsightsPanel account={riot} />}
            </Card>
          </div>
        ) : null}

        <Card title="Sous-catégories les plus faibles">
          <Weaknesses bench={bench} />
        </Card>

        <Card title="Routine du jour" action={{ href: COACH_HASH, label: "Coach" }}>
          <TodayRoutine today={today} />
        </Card>

        <Card title="Dernier debrief" action={{ href: COACH_HASH, label: "Coach" }}>
          <LastDebrief latest={latest} />
        </Card>
      </div>
    </div>
  );
}

export interface CardProps {
  readonly title: string;
  readonly action?: { readonly href: string; readonly label: string };
  readonly children: ReactNode;
}

/** La coque d'un emplacement du tableau de bord ; la démonstration la reprend. */
export function Card({ title, action, children }: CardProps) {
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

export interface LastBenchProps {
  readonly bench: Bench;
  /** Un compte KovaaK's est-il lié ? `null` tant qu'on ne sait pas. */
  readonly kovaaksLinked: boolean | null;
  readonly onRetry: () => void;
}

/**
 * L'emplacement « dernier bench », exporté pour le rendu statique des tests :
 * c'est lui qui porte l'invitation à lier KovaaK's, donc la promesse d'import
 * de l'accueil — et la page entière demanderait une session pour être rendue.
 */
export function LastBench({ bench, kovaaksLinked, onRetry }: LastBenchProps) {
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
              Saisir une passe
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
    // liaison, qui remplit d'un coup les scénarios déjà joués. Le tracker reste
    // offert juste dessous, en second — c'est le seul chemin quand rien n'est
    // lié à aller chercher, et il ne doit jamais disparaître.
    if (kovaaksLinked === false) {
      return (
        <div className="flex flex-col gap-3">
          {/* Le titre ne promet pas dix-huit chiffres : l'import ne ramène que
              les scénarios déjà joués, et un palier entamé en rend la moitié.
              Annoncer « tes 18 scores » ferait passer le cas fréquent — un
              import partiel, complété à la main — pour une panne. */}
          <LinkInvite title="Tes scores peuvent arriver tout seuls" action="Lier KovaaK's">
            Lie ton pseudo kovaaks.com une fois : la saisie ira chercher les scénarios du benchmark
            Voltaic que tu as déjà joués, tu vérifies, tu enregistres. Ce que la source ne rend pas
            se tape à la main, dans la même grille.
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
          detail="Ouvre la saisie des perfs : l'import de tes scores KovaaK's y part tout seul, et la saisie manuelle reste là pour compléter ce qu'il n'a pas ramené ou corriger le reste."
        />
        <a href={TRACKER_HASH} className={PRIMARY_ACTION}>
          Saisir une passe
        </a>
      </div>
    );
  }

  const { run, previous } = bench;
  /**
   * L'énergie partielle de la passe (§4.1a), quand son overall vaut 0 : une
   * passe enregistrée incomplète affichait un tiret, exactement comme une
   * absence de passe. Elle n'est ni enregistrée ni classée — c'est une lecture
   * des sous-catégories déjà dérivées à la lecture (`mapping.ts`).
   */
  const partial =
    run.overall > 0 ? null : partialEnergy(run.subcategories.map((sub) => sub.energy));
  // L'écart ne se calcule que sur des overalls réels : comparer deux benchs
  // incomplets (0 contre 0) afficherait « stable » pour deux passes qui n'ont
  // rien mesuré.
  const delta =
    previous === null || run.overall === 0 || previous.overall === 0
      ? null
      : deltaOf(run.overall, previous.overall);

  // Libellé de palier et couleur de rang lus dans la saison **de la passe** :
  // le dashboard montre la dernière passe, quelle que soit sa saison, et ne
  // doit pas la repeindre aux couleurs de la saison courante (SPEC §5 quinquies).
  return (
    <a href={historyHash(run.id)} className="flex items-end gap-4">
      <div>
        <p className="flex items-baseline gap-2">
          <span
            className={`font-mono text-3xl leading-none font-semibold tabular-nums ${
              partial === null ? "text-steel-100" : "text-steel-300"
            }`}
          >
            {run.overall > 0
              ? formatEnergy(run.overall)
              : partial
                ? formatEnergy(partial.energy)
                : "—"}
          </span>
          {partial === null ? (
            <DeltaBadge delta={delta} label="Énergie overall" />
          ) : (
            <span className="text-[10px] font-medium tracking-wide text-steel-500 uppercase">
              Partiel {partial.counted}/{partial.total}
            </span>
          )}
        </p>
        <p className="mt-2 text-xs text-steel-500">
          {getTierFor(run.benchmarkId, run.tier).label} · {formatRunDate(run.date)}
        </p>
      </div>
      <div className="ml-auto shrink-0">
        <RankBadge
          rank={run.rank}
          color={rankColorForBenchmark(run.benchmarkId, run.tier, run.overall)}
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
        <a href={COACH_HASH} className={PRIMARY_ACTION}>
          Générer une routine
        </a>
      </div>
    );
  }

  const { routine } = today;

  return (
    <a href={COACH_HASH} className="flex flex-col gap-2">
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

/** Les trois sous-catégories les plus basses et leur écart ; reprise par la démo. */
export function Weaknesses({ bench }: { readonly bench: Bench }) {
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
  /**
   * L'écart par sous-catégorie vs la passe précédente (§4.4).
   *
   * C'est ici qu'il a le plus de sens, et pas seulement parce que c'est ici que
   * les sous-catégories sont affichées : une faiblesse qui progresse et une
   * faiblesse qui stagne demandent deux décisions d'entraînement différentes, et
   * le chiffre seul ne les distingue pas.
   */
  const deltas = new Map(
    subcategoryDeltas(bench.run.subcategories, bench.previous?.subcategories ?? []).map((entry) => [
      entry.name,
      entry.delta,
    ]),
  );

  return (
    <ul className="flex flex-col gap-2">
      {weakest.map((sub) => (
        <li
          key={sub.name}
          className="flex items-baseline justify-between gap-3 rounded-lg bg-steel-950/60 px-3 py-2"
        >
          <span className="min-w-0 truncate text-sm text-steel-200">{sub.name}</span>
          <span className="flex shrink-0 items-baseline gap-2">
            <DeltaBadge delta={deltas.get(sub.name) ?? null} label={sub.name} size="sm" />
            <span className="font-mono text-sm tabular-nums text-steel-400">
              {sub.energy > 0 ? formatEnergy(sub.energy) : "—"}
            </span>
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
