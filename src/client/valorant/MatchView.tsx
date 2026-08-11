/**
 * La page d'une partie (SPEC §5 sexies, V2) : scoreboard des dix joueurs,
 * performance par side, déroulé des rounds.
 *
 * Elle vit derrière `#/valorant?match=<id>` — une **adresse**, pas un panneau
 * déplié : un lien vers une partie doit survivre au rechargement.
 *
 * Trois partis pris :
 *
 * 1. **Ce que la source n'a pas dit ne s'invente pas.** Chaque colonne du
 *    scoreboard est nullable dans le contrat (une API non officielle a le droit
 *    de ne pas remplir un champ) et un tiret vaut mieux qu'un zéro. Quand le
 *    détail ne porte aucune performance par side, la section **disparaît** avec
 *    une phrase sobre plutôt qu'un tableau vide.
 * 2. **Le scoreboard sert à se situer, pas à pister.** Le contrat ne transporte
 *    ni PUUID ni tag Riot : un nom en jeu et un agent, c'est tout. La seule
 *    ligne mise en avant est la sienne (`isYou`).
 * 3. **Le debrief est un geste explicite.** Le bouton dépense un quota et une
 *    génération ; la page ne le déclenche jamais toute seule. Un match déjà
 *    débriefé porte un lien vers son debrief, pas un second bouton.
 *
 * La **mini-analyse** (V4) suit la même règle que le debrief, en plus léger :
 * elle s'affiche seule quand elle a déjà été payée (la fonction la rend avec le
 * détail), et sinon la page n'offre qu'un bouton. C'est la différence qui
 * compte : une analyse coûte un message de coach, et rien de ce que la page fait
 * toute seule ne doit coûter quoi que ce soit.
 */

import { useCallback, useEffect, useState } from "react";
import { CoachError, requestDebriefForMatch } from "../coach/coach-api";
import { setCoachDebriefFocus, setCoachPrefill } from "../coach/prefill";
import { Notice } from "../components/Notice";
import {
  analyzeMatch,
  debriefedMatches,
  getMatchDetail,
  type MatchDetail,
  type RoundOutcome,
  type ScoreboardEntry,
  type SidePerformance,
  type Team,
  ValorantError,
} from "../data";
import { formatRunDate } from "../format";
import { routeHash, viewRoute } from "../route";
import { coachPrefillForMatch } from "./analysis-prefill";
import { formatAdr, formatPercent, resultLabel, UNKNOWN } from "./display";
import { Empty, Section, Skeleton } from "./ui";

const COACH_HASH = routeHash(viewRoute("coach"));

const SIDE_LABELS: Readonly<Record<SidePerformance["side"], string>> = {
  attaque: "Attaque",
  defense: "Défense",
};

const TEAM_LABELS: Readonly<Record<Team, string>> = {
  bleue: "Équipe bleue",
  rouge: "Équipe rouge",
};

type Detail =
  | { readonly status: "loading" }
  | { readonly status: "error"; readonly message: string; readonly retryable: boolean }
  | { readonly status: "ready"; readonly detail: MatchDetail };

interface MatchViewProps {
  readonly matchId: string;
  /** Retour à la vue d'ensemble ; le routeur reste maître de l'adresse. */
  readonly onBack: () => void;
}

export function MatchView({ matchId, onBack }: MatchViewProps) {
  const [state, setState] = useState<Detail>({ status: "loading" });
  const [debriefId, setDebriefId] = useState<number | null>(null);
  const [debriefing, setDebriefing] = useState(false);
  const [debriefError, setDebriefError] = useState<string | null>(null);
  const [analysis, setAnalysis] = useState<string | null>(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [analysisError, setAnalysisError] = useState<string | null>(null);
  const [remaining, setRemaining] = useState<number | null>(null);

  const load = useCallback(async () => {
    setState({ status: "loading" });
    setAnalysis(null);
    setAnalysisError(null);
    setRemaining(null);
    try {
      const { detail, analysis: stored } = await getMatchDetail(matchId);

      setState({ status: "ready", detail });
      // L'analyse voyage avec le détail : une partie déjà analysée s'affiche
      // sans second appel, et le bouton ne réapparaît jamais.
      setAnalysis(stored);
    } catch (cause) {
      // Une partie inconnue ou une clé absente ne se réessaient pas : proposer
      // « Réessayer » là où rien ne changera est une fausse promesse.
      const known = cause instanceof ValorantError;

      setState({
        status: "error",
        message: cause instanceof Error ? cause.message : "Détail indisponible.",
        retryable: !known || !(cause.notFound || cause.notConfigured),
      });
    }
  }, [matchId]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    let cancelled = false;

    setDebriefId(null);
    void debriefedMatches()
      .then((byMatch) => {
        if (!cancelled) setDebriefId(byMatch.get(matchId) ?? null);
      })
      .catch(() => {
        /* Pas de badge, c'est tout : le serveur refusera un second debrief du
           même match (409) et la page saura quoi en faire. */
      });

    return () => {
      cancelled = true;
    };
  }, [matchId]);

  /**
   * Débriefe la partie, puis ouvre le fil du coach dessus.
   *
   * `thread: true` : la carte de debrief est posée dans le fil par la fonction
   * elle-même (SPEC §5 sexies). Un 409 n'est pas un échec — il dit que le
   * debrief existe déjà : on va le lire, comme si la génération venait
   * d'aboutir.
   */
  const debrief = useCallback(async () => {
    setDebriefing(true);
    setDebriefError(null);
    try {
      const { debrief: created } = await requestDebriefForMatch(matchId, { thread: true });

      setDebriefId(created.id);
      openCoach(created.id);
    } catch (cause) {
      if (cause instanceof CoachError && cause.alreadyDebriefed && cause.debriefId !== null) {
        setDebriefId(cause.debriefId);
        openCoach(cause.debriefId);
        return;
      }
      setDebriefError(
        cause instanceof Error ? cause.message : "Le debrief n'a pas pu être généré.",
      );
    } finally {
      setDebriefing(false);
    }
  }, [matchId]);

  /**
   * Demande la mini-analyse de la partie.
   *
   * Un geste volontaire, et un seul appel : le serveur rend l'analyse déjà en
   * base sans rien dépenser, donc un second clic (ou un double-clic) ne coûte
   * rien. `remaining` n'est annoncé que lorsque le serveur l'a compté.
   */
  const analyse = useCallback(async () => {
    setAnalyzing(true);
    setAnalysisError(null);
    try {
      const result = await analyzeMatch(matchId);

      setAnalysis(result.analysis);
      setRemaining(result.remaining);
    } catch (cause) {
      setAnalysisError(
        cause instanceof Error ? cause.message : "L'analyse n'a pas pu être générée.",
      );
    } finally {
      setAnalyzing(false);
    }
  }, [matchId]);

  return (
    <div className="flex flex-col gap-6">
      <div>
        <button
          type="button"
          onClick={onBack}
          className="text-xs text-steel-500 transition-colors hover:text-steel-200"
        >
          ← Toutes les parties
        </button>
        <h1 className="mt-2 text-lg font-semibold text-steel-100">
          {state.status === "ready" ? (state.detail.map ?? "Partie") : "Partie"}
        </h1>
        {state.status === "ready" ? <Subtitle detail={state.detail} /> : null}
      </div>

      {state.status === "loading" ? <MatchSkeleton /> : null}

      {state.status === "error" ? (
        <Notice
          tone="error"
          title="Le détail de cette partie n'a pas pu être chargé."
          onRetry={state.retryable ? () => void load() : undefined}
        >
          {state.message}
        </Notice>
      ) : null}

      {state.status === "ready" ? (
        <>
          <DebriefAction
            debriefId={debriefId}
            generating={debriefing}
            error={debriefError}
            onDebrief={() => void debrief()}
          />
          <Analysis
            analysis={analysis}
            detail={state.detail}
            generating={analyzing}
            error={analysisError}
            remaining={remaining}
            onAnalyze={() => void analyse()}
          />
          <Scoreboard entries={state.detail.scoreboard} />
          <Sides sides={state.detail.sides} />
          <Rounds rounds={state.detail.rounds} />
        </>
      ) : null}
    </div>
  );
}

/** Ouvre la vue Coach sur un debrief précis (même pont que le dashboard). */
function openCoach(id: number): void {
  setCoachDebriefFocus(id);
  window.location.hash = COACH_HASH;
}

function Subtitle({ detail }: { readonly detail: MatchDetail }) {
  const score =
    detail.roundsWon === null || detail.roundsLost === null
      ? null
      : `${detail.roundsWon}–${detail.roundsLost}`;

  return (
    <p className="mt-1 flex flex-wrap items-baseline gap-x-2 text-xs text-steel-500">
      <span className="font-medium text-steel-300">{resultLabel(detail.result)}</span>
      {score === null ? null : <span className="font-mono tabular-nums">{score}</span>}
      {detail.mode === null ? null : <span>· {detail.mode}</span>}
      {detail.playedAt === null ? null : <span>· {formatRunDate(detail.playedAt)}</span>}
    </p>
  );
}

/* ------------------------------------------------------------------ */
/* Debrief                                                             */
/* ------------------------------------------------------------------ */

interface DebriefActionProps {
  readonly debriefId: number | null;
  readonly generating: boolean;
  readonly error: string | null;
  readonly onDebrief: () => void;
}

function DebriefAction({ debriefId, generating, error, onDebrief }: DebriefActionProps) {
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-3">
        {debriefId === null ? (
          <button
            type="button"
            disabled={generating}
            onClick={onDebrief}
            className="rounded-lg bg-ember-600 px-3 py-2 text-xs font-semibold text-steel-100 transition-colors hover:bg-ember-500 disabled:cursor-not-allowed disabled:bg-steel-800 disabled:text-steel-500"
          >
            {generating ? "Le coach lit ta partie…" : "Débriefer ce match"}
          </button>
        ) : (
          // Un lien et non un bouton : c'est une navigation, et elle doit
          // s'ouvrir dans un nouvel onglet comme n'importe quel lien.
          <a
            href={COACH_HASH}
            onClick={() => setCoachDebriefFocus(debriefId)}
            className="rounded-lg border border-quench-600/50 px-3 py-2 text-xs font-semibold text-quench-500 transition-colors hover:border-quench-500 hover:text-quench-400"
          >
            Débriefé · ouvrir dans le coach →
          </a>
        )}
        <p className="text-[11px] text-steel-500">
          {debriefId === null
            ? "Le coach lit la partie côté serveur : rien à coller."
            : "Cette partie a déjà été débriefée."}
        </p>
      </div>
      {error === null ? null : (
        <p aria-live="polite" className="text-[11px] leading-relaxed text-ember-400">
          {error}
        </p>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Mini-analyse                                                        */
/* ------------------------------------------------------------------ */

interface AnalysisProps {
  /** Le texte déjà généré, ou `null` tant que personne ne l'a demandé. */
  readonly analysis: string | null;
  /** Le détail affiché : il ne sert ici qu'à nommer la partie dans l'amorce. */
  readonly detail: MatchDetail;
  readonly generating: boolean;
  readonly error: string | null;
  /** Messages de coach restants aujourd'hui, quand le serveur vient de compter. */
  readonly remaining: number | null;
  readonly onAnalyze: () => void;
}

/**
 * La section « Analyse » : trois états, jamais deux à la fois.
 *
 * 1. **rien** — un bouton, et le coût annoncé discrètement. La page ne génère
 *    jamais d'elle-même : ce serait dépenser le quota de quelqu'un qui a
 *    seulement ouvert une partie ;
 * 2. **en cours** — le bouton se désarme et le dit ;
 * 3. **une analyse** — le texte, puis le pont vers le fil du coach. Le bouton
 *    disparaît définitivement : le serveur ne regénérera pas, l'offrir serait
 *    une promesse fausse.
 *
 * `Approfondir` est un lien et non un bouton, comme le lien de debrief juste
 * au-dessus : c'est une navigation, et elle doit s'ouvrir dans un nouvel onglet
 * comme n'importe quel lien.
 */
export function Analysis({
  analysis,
  detail,
  generating,
  error,
  remaining,
  onAnalyze,
}: AnalysisProps) {
  return (
    <Section
      title="Analyse"
      caption="Quelques phrases du coach sur cette partie, lues sur le scoreboard et les sides."
    >
      {analysis === null ? (
        <div className="flex flex-col gap-2">
          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              disabled={generating}
              onClick={onAnalyze}
              className="rounded-lg border border-quench-600/50 px-3 py-2 text-xs font-semibold text-quench-500 transition-colors hover:border-quench-500 hover:text-quench-400 disabled:cursor-not-allowed disabled:border-steel-800 disabled:text-steel-500"
            >
              {generating ? "Le coach lit ta partie…" : "Analyser ce match"}
            </button>
            <p className="text-[11px] text-steel-500">
              Compte pour un message de coach sur ton quota du jour. Une fois faite, la relecture
              est gratuite.
            </p>
          </div>
          {generating ? <Skeleton lines={2} /> : null}
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          <p className="text-sm leading-relaxed whitespace-pre-line text-steel-200">{analysis}</p>
          <div className="flex flex-wrap items-center gap-3">
            <a
              href={COACH_HASH}
              onClick={() => setCoachPrefill(coachPrefillForMatch(detail))}
              className="rounded-lg bg-ember-600 px-3 py-2 text-xs font-semibold text-steel-100 transition-colors hover:bg-ember-500"
            >
              Approfondir avec le coach →
            </a>
            {remaining === null ? null : (
              <p className="text-[11px] text-steel-500">
                {remaining === 0
                  ? "Plus de message de coach aujourd'hui : le compteur repart demain."
                  : `Il te reste ${remaining} message${remaining > 1 ? "s" : ""} de coach aujourd'hui.`}
              </p>
            )}
          </div>
        </div>
      )}
      {error === null ? null : (
        <p aria-live="polite" className="text-[11px] leading-relaxed text-ember-400">
          {error}
        </p>
      )}
    </Section>
  );
}

/* ------------------------------------------------------------------ */
/* Scoreboard                                                          */
/* ------------------------------------------------------------------ */

/** Les équipes, la sienne d'abord ; les joueurs sans équipe ferment la marche. */
function groupByTeam(
  entries: readonly ScoreboardEntry[],
): readonly { readonly team: Team | null; readonly entries: readonly ScoreboardEntry[] }[] {
  const mine = entries.find((entry) => entry.isYou)?.team ?? null;
  const teams: (Team | null)[] =
    mine === null ? ["bleue", "rouge", null] : [mine, other(mine), null];

  return teams
    .map((team) => ({
      team,
      entries: entries
        .filter((entry) => entry.team === team)
        .sort((left, right) => (right.score ?? -1) - (left.score ?? -1)),
    }))
    .filter((group) => group.entries.length > 0);
}

function other(team: Team): Team {
  return team === "bleue" ? "rouge" : "bleue";
}

/**
 * Les trois sections du détail sont exportées : elles ne dépendent que de leurs
 * props, et c'est la seule façon de prouver hors ligne ce que chacune fait
 * d'une donnée absente — la page complète, elle, a besoin de la source.
 */
export function Scoreboard({ entries }: { readonly entries: readonly ScoreboardEntry[] }) {
  if (entries.length === 0) {
    return (
      <Section title="Scoreboard">
        <Empty>La source n'a pas renvoyé le tableau des joueurs pour cette partie.</Empty>
      </Section>
    );
  }

  return (
    <Section title="Scoreboard">
      <div className="-mx-4 overflow-x-auto px-4 sm:mx-0 sm:px-0">
        <table className="w-full min-w-[30rem] border-collapse text-sm">
          <thead>
            <tr className="text-[11px] tracking-wide text-steel-500 uppercase">
              <th scope="col" className="py-1.5 pr-2 text-left font-medium">
                Joueur
              </th>
              <th scope="col" className="py-1.5 px-2 text-right font-medium">
                K / D / A
              </th>
              <th scope="col" className="py-1.5 px-2 text-right font-medium">
                ADR
              </th>
              <th scope="col" className="py-1.5 pl-2 text-right font-medium">
                HS%
              </th>
            </tr>
          </thead>
          {groupByTeam(entries).map((group) => (
            <tbody key={group.team ?? "sans-equipe"}>
              <tr>
                <th
                  scope="colgroup"
                  colSpan={4}
                  className="pt-3 pb-1 text-left text-[11px] font-medium tracking-wide text-steel-500 uppercase"
                >
                  {group.team === null ? "Équipe inconnue" : TEAM_LABELS[group.team]}
                </th>
              </tr>
              {group.entries.map((entry, index) => (
                <PlayerRow
                  // Le contrat ne porte aucun identifiant de joueur (et deux
                  // pseudos peuvent se ressembler) : la position dans l'équipe
                  // est la seule clé stable dont on dispose.
                  // biome-ignore lint/suspicious/noArrayIndexKey: aucune identité de joueur dans le contrat, par conception
                  key={`${group.team ?? "?"}-${index}`}
                  entry={entry}
                />
              ))}
            </tbody>
          ))}
        </table>
      </div>
    </Section>
  );
}

function PlayerRow({ entry }: { readonly entry: ScoreboardEntry }) {
  const kda =
    entry.kills === null || entry.deaths === null || entry.assists === null
      ? UNKNOWN
      : `${entry.kills} / ${entry.deaths} / ${entry.assists}`;

  return (
    <tr
      className={
        entry.isYou
          ? "bg-ember-600/10 shadow-[inset_2px_0_0_0_var(--color-ember-500)]"
          : "border-t border-steel-800/60"
      }
    >
      <td className="py-1.5 pr-2">
        <span className={entry.isYou ? "font-medium text-steel-100" : "text-steel-300"}>
          {entry.name ?? "Joueur inconnu"}
        </span>
        {entry.agent === null ? null : <span className="text-steel-500"> · {entry.agent}</span>}
        {entry.isYou ? <span className="ml-1.5 text-[11px] text-ember-400">toi</span> : null}
      </td>
      <td className="px-2 py-1.5 text-right font-mono tabular-nums text-steel-300">{kda}</td>
      <td className="px-2 py-1.5 text-right font-mono tabular-nums text-steel-400">
        {formatAdr(entry.adr)}
      </td>
      <td className="py-1.5 pl-2 text-right font-mono tabular-nums text-steel-400">
        {formatPercent(entry.headshotPercent)}
      </td>
    </tr>
  );
}

/* ------------------------------------------------------------------ */
/* Sides et rounds                                                     */
/* ------------------------------------------------------------------ */

/**
 * La performance par side, **si la source l'a donnée**.
 *
 * Elle se déduit du déroulé des rounds ; quand ce déroulé n'est pas exploitable,
 * `sides` arrive vide et il n'y a rien à dire de plus qu'une phrase. Un tableau
 * de zéros laisserait croire à une partie jouée sans tirer.
 */
export function Sides({ sides }: { readonly sides: readonly SidePerformance[] }) {
  if (sides.length === 0) {
    return (
      <Section title="Par side">
        <Empty>La source n'a pas permis de rattacher les rounds à un side pour cette partie.</Empty>
      </Section>
    );
  }

  return (
    <Section title="Par side">
      <div className="grid gap-2 sm:grid-cols-2">
        {sides.map((side) => (
          <div key={side.side} className="rounded-lg bg-steel-950/60 p-3">
            <p className="text-xs font-medium text-steel-200">{SIDE_LABELS[side.side]}</p>
            <p className="mt-1 font-mono text-sm tabular-nums text-steel-100">
              {side.roundsWon} / {side.rounds}
              <span className="ml-1.5 font-sans text-[11px] text-steel-500">rounds gagnés</span>
            </p>
            <p className="mt-1.5 font-mono text-[11px] tabular-nums text-steel-400">
              {side.kills === null ? UNKNOWN : `${side.kills} kills`} · {formatAdr(side.adr)} ADR ·{" "}
              {formatPercent(side.headshotPercent)} HS
            </p>
          </div>
        ))}
      </div>
    </Section>
  );
}

/**
 * Le déroulé des rounds : une case par round, dans l'ordre.
 *
 * La couleur dit l'issue (les deux mêmes teintes que les graphes de tendance),
 * mais elle ne la dit **pas seule** : le numéro reste lisible et le titre de
 * chaque case porte le side quand il est connu.
 */
export function Rounds({ rounds }: { readonly rounds: readonly RoundOutcome[] }) {
  if (rounds.length === 0) {
    return (
      <Section title="Rounds">
        <Empty>La source n'a pas renvoyé le déroulé des rounds pour cette partie.</Empty>
      </Section>
    );
  }

  return (
    <Section title="Rounds">
      <ol className="flex flex-wrap gap-1">
        {rounds.map((round) => (
          <li key={round.index}>
            <span
              title={roundTitle(round)}
              className={`flex size-7 items-center justify-center rounded font-mono text-[11px] tabular-nums ${roundClasses(round.won)}`}
            >
              {round.index}
            </span>
          </li>
        ))}
      </ol>
      <p className="mt-2 text-[11px] text-steel-500">
        Bleu : round gagné · braise : round perdu · gris : issue inconnue. Le side de chaque round
        s'affiche au survol quand la source l'a donné.
      </p>
    </Section>
  );
}

function roundTitle(round: RoundOutcome): string {
  const outcome = round.won === null ? "Issue inconnue" : round.won ? "Gagné" : "Perdu";

  return round.side === null
    ? `Round ${round.index} · ${outcome}`
    : `Round ${round.index} · ${outcome} · ${SIDE_LABELS[round.side]}`;
}

function roundClasses(won: boolean | null): string {
  if (won === null) return "bg-steel-800 text-steel-400";
  return won ? "bg-quench-500/25 text-quench-500" : "bg-ember-600/25 text-ember-400";
}

/* ------------------------------------------------------------------ */
/* Habillage                                                           */
/* ------------------------------------------------------------------ */

function MatchSkeleton() {
  return (
    <div aria-busy="true" className="flex flex-col gap-4">
      {[0, 1].map((index) => (
        <div
          key={index}
          className="flex flex-col gap-2 rounded-xl border border-steel-800 bg-steel-900/60 p-4 sm:p-5"
        >
          <div aria-hidden="true" className="h-3 w-24 rounded bg-steel-800/70" />
          <Skeleton />
        </div>
      ))}
    </div>
  );
}
