/**
 * Les agrégats de profil Valorant (SPEC §5 sexies, V1) — module **pur** : il ne
 * connaît ni Supabase, ni le réseau, ni HenrikDev. Il prend une liste de
 * résumés de matchs (ce que `imported_matches.payload` contient) et rend ce
 * qu'un profil affiche : winrate, K/D, HS%, ADR — par période, par agent, par
 * map — plus la série temporelle des parties.
 *
 * Pourquoi ici et pas dans une requête SQL : parce que les chiffres sont
 * **testables** sans base. Les cas qui font mal — zéro match, un seul match,
 * une partie sans ADR, une partie sans date, zéro mort — se prouvent en une
 * ligne de fixture, et la même fonction sert `api/valorant/stats` aujourd'hui
 * et l'écran de tendances de V2 demain.
 *
 * Trois règles de lecture, tenues partout :
 *
 * 1. **`null` n'est pas `0`.** Une moyenne rendue sur zéro donnée vaut `null` :
 *    « HS% inconnu » et « 0 % » ne se disent pas pareil, et un graphe qui les
 *    confondrait tracerait une chute qui n'a pas eu lieu.
 * 2. **Une donnée manquante n'annule pas les autres.** L'ADR moyen se calcule
 *    sur les matchs qui ont un ADR ; un match sans ADR ne fait pas tomber la
 *    moyenne, il n'y participe pas.
 * 3. **Ce qui n'est pas daté n'entre dans aucune fenêtre.** Un match sans
 *    `playedAt` compte dans « tout », jamais dans « 7 jours » : le placer
 *    d'office dans la fenêtre récente inventerait une activité.
 */

import type { MatchSummary } from "../../client/data/linked-accounts-contract.js";
import type {
  StatBreakdown,
  StatTotals,
  TrendPoint,
  ValorantStats,
} from "../../shared/valorant-contract.js";

const DAY_MS = 86_400_000;

/** Les deux fenêtres glissantes du profil, en jours. */
export const RECENT_WINDOW_DAYS = 7;
export const MONTH_WINDOW_DAYS = 30;

/** Options d'agrégation. Tout est injectable : un module pur ne lit pas l'horloge. */
export interface AggregateOptions {
  /** L'instant de référence des fenêtres glissantes. Par défaut : maintenant. */
  readonly now?: Date;
  /**
   * Variation de RR par match, quand l'appelant en dispose.
   *
   * Le résumé de match ne porte pas le RR (seul le RR *courant* est stocké, sur
   * le compte lié), donc cette table est vide aujourd'hui et la série sort avec
   * `rr: null`. Elle existe pour que l'historique de RR, le jour où il sera
   * importé, se branche sans toucher à ce module ni au contrat.
   */
  readonly rrByMatch?: ReadonlyMap<string, number>;
}

/* ------------------------------------------------------------------ */
/* Outils                                                             */
/* ------------------------------------------------------------------ */

/** Une décimale : assez pour un winrate ou un K/D, jamais de fausse précision. */
function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

/** La moyenne des valeurs renseignées, `null` s'il n'y en a aucune. */
function mean(values: readonly (number | null)[]): number | null {
  const known = values.filter((value): value is number => value !== null);

  if (known.length === 0) return null;
  return round1(known.reduce((total, value) => total + value, 0) / known.length);
}

/** La somme des valeurs renseignées ; les absentes valent zéro. */
function total(matches: readonly MatchSummary[], pick: (match: MatchSummary) => number | null) {
  return matches.reduce((sum, match) => sum + (pick(match) ?? 0), 0);
}

/** L'instant d'un match, ou `null` si la source ne l'a pas daté. */
function playedTime(match: MatchSummary): number | null {
  if (match.playedAt === null) return null;

  const time = Date.parse(match.playedAt);

  return Number.isNaN(time) ? null : time;
}

/* ------------------------------------------------------------------ */
/* Compteurs                                                          */
/* ------------------------------------------------------------------ */

/** Les compteurs d'un ensemble de matchs. Le cœur du module. */
export function totalsOf(matches: readonly MatchSummary[]): StatTotals {
  const wins = matches.filter((match) => match.result === "victoire").length;
  const losses = matches.filter((match) => match.result === "defaite").length;
  const draws = matches.filter((match) => match.result === "egalite").length;
  // Les matchs au résultat inconnu ne pèsent pas sur le winrate : ils ne
  // peuvent ni le monter ni le descendre, seulement le diluer.
  const decided = wins + losses + draws;
  const kills = total(matches, (match) => match.kills);
  const deaths = total(matches, (match) => match.deaths);

  return {
    matches: matches.length,
    wins,
    losses,
    draws,
    winrate: decided === 0 ? null : round1((wins / decided) * 100),
    kills,
    deaths,
    assists: total(matches, (match) => match.assists),
    // Aucune mort enregistrée : le ratio n'existe pas (division par zéro), et
    // afficher les kills à sa place mentirait sur ce qu'on mesure.
    kd: deaths === 0 ? null : round1(kills / deaths),
    headshotPercent: mean(matches.map((match) => match.headshotPercent)),
    adr: mean(matches.map((match) => match.adr)),
  };
}

/* ------------------------------------------------------------------ */
/* Fenêtres                                                           */
/* ------------------------------------------------------------------ */

/**
 * Les matchs joués dans les `days` derniers jours.
 *
 * Fenêtre glissante à la milliseconde, et non journée civile : le fuseau de
 * l'utilisateur n'a pas à décider si sa partie d'hier soir compte encore.
 */
export function within(
  matches: readonly MatchSummary[],
  days: number,
  now: Date = new Date(),
): readonly MatchSummary[] {
  const floor = now.getTime() - days * DAY_MS;

  return matches.filter((match) => {
    const time = playedTime(match);

    return time !== null && time >= floor;
  });
}

/**
 * Combien de parties compétitives récentes ?
 *
 * C'est le chiffre sur lequel V5 décide d'ancrer — ou non — une routine dans
 * les données du jeu. Il est ici parce qu'il se calcule exactement comme les
 * autres agrégats, et qu'un second endroit qui compterait « à peu près pareil »
 * finirait par ne plus dire la même chose que le tableau affiché juste à côté.
 *
 * Le mode est traité avec prudence : `api/valorant/refresh` n'importe que du
 * compétitif, donc un mode **absent** compte (la source n'a pas rempli le
 * champ), et seul un mode explicitement autre est écarté.
 */
export function recentCompetitiveCount(
  matches: readonly MatchSummary[],
  days: number,
  now: Date = new Date(),
): number {
  return within(matches, days, now).filter((match) => isCompetitive(match.mode)).length;
}

/**
 * « Competitive », « Compétitif », « Compétitive »… ou rien du tout.
 *
 * Le préfixe suffit et se lit : la source nomme la file dans la langue du
 * compte, et les deux orthographes se distinguent d'une lettre. Une comparaison
 * exacte à une liste close casserait au premier libellé localisé.
 */
function isCompetitive(mode: string | null): boolean {
  const normalized = mode?.trim().toLowerCase() ?? "";

  if (normalized === "") return true;
  return normalized.startsWith("competit") || normalized.startsWith("compétit");
}

/* ------------------------------------------------------------------ */
/* Ventilations                                                       */
/* ------------------------------------------------------------------ */

/**
 * Les compteurs par clé (agent, map), du plus joué au moins joué.
 *
 * Les matchs dont la clé manque sont écartés : une ligne « inconnu » dans un
 * tableau d'agents n'apprend rien et prend la place du dixième agent.
 */
function breakdown(
  matches: readonly MatchSummary[],
  key: (match: MatchSummary) => string | null,
): StatBreakdown[] {
  const groups = new Map<string, MatchSummary[]>();

  for (const match of matches) {
    const value = key(match);

    if (value === null) continue;

    const bucket = groups.get(value);

    if (bucket === undefined) groups.set(value, [match]);
    else bucket.push(match);
  }

  return [...groups.entries()]
    .map(([value, bucket]) => ({ key: value, totals: totalsOf(bucket) }))
    .sort(
      (left, right) => right.totals.matches - left.totals.matches || compare(left.key, right.key),
    );
}

/** Ordre alphabétique stable, insensible à la casse et aux accents. */
function compare(left: string, right: string): number {
  return left.localeCompare(right, "fr");
}

/* ------------------------------------------------------------------ */
/* Série temporelle                                                   */
/* ------------------------------------------------------------------ */

/**
 * Un point par match, du plus ancien au plus récent : l'ordre dans lequel un
 * graphe se lit. Les matchs non datés ferment la marche — ils existent, mais
 * on ne peut pas les placer sur un axe du temps.
 */
function trendOf(
  matches: readonly MatchSummary[],
  rrByMatch: ReadonlyMap<string, number>,
): TrendPoint[] {
  return [...matches]
    .sort((left, right) => {
      const leftTime = playedTime(left);
      const rightTime = playedTime(right);

      if (leftTime === null) return rightTime === null ? 0 : 1;
      if (rightTime === null) return -1;
      return leftTime - rightTime;
    })
    .map((match) => ({
      matchId: match.matchId,
      playedAt: match.playedAt,
      map: match.map,
      agent: match.agent,
      headshotPercent: match.headshotPercent,
      adr: match.adr,
      result: match.result,
      rr: rrByMatch.get(match.matchId) ?? null,
    }));
}

/* ------------------------------------------------------------------ */
/* L'agrégat complet                                                  */
/* ------------------------------------------------------------------ */

/** Tout ce que le profil affiche, calculé en une passe sur les mêmes matchs. */
export function aggregateValorant(
  matches: readonly MatchSummary[],
  options: AggregateOptions = {},
): ValorantStats {
  const now = options.now ?? new Date();
  const rrByMatch = options.rrByMatch ?? new Map<string, number>();

  return {
    periods: {
      last7Days: totalsOf(within(matches, RECENT_WINDOW_DAYS, now)),
      last30Days: totalsOf(within(matches, MONTH_WINDOW_DAYS, now)),
      all: totalsOf(matches),
    },
    byAgent: breakdown(matches, (match) => match.agent),
    byMap: breakdown(matches, (match) => match.map),
    trend: trendOf(matches, rrByMatch),
  };
}
