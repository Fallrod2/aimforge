/**
 * Traduction des réponses HenrikDev en résumés exploitables — module **pur** :
 * il connaît la *forme* des données, jamais le réseau ni la clé (ceux-là vivent
 * dans `api/_lib/henrikdev.ts`).
 *
 * Le parti pris tient en une phrase : **on ne stocke pas la réponse brute.**
 * HenrikDev est une API non officielle ; ce qui doit survivre à son
 * remplacement (par l'API Riot officielle, le jour où RSO sera accordé), c'est
 * le résumé — map, agent, KDA, ADR, HS%, rounds, résultat. C'est aussi
 * exactement ce dont le coach a besoin, et rien de plus.
 *
 * Tout est optionnel côté schéma et nullable côté résumé. Une API non
 * officielle a le droit de ne pas renseigner un champ, et un match à moitié
 * décrit vaut mieux qu'un import qui échoue en entier : c'est la différence
 * entre « l'ADR manque sur cette partie » et « l'historique est vide ».
 */

import { z } from "zod";
import type { MatchSummary, MmrSummary } from "../../client/data/linked-accounts-contract.js";

/* ------------------------------------------------------------------ */
/* La forme des données reçues                                         */
/* ------------------------------------------------------------------ */

const statsSchema = z
  .object({
    kills: z.number().int().min(0).nullish(),
    deaths: z.number().int().min(0).nullish(),
    assists: z.number().int().min(0).nullish(),
    headshots: z.number().int().min(0).nullish(),
    bodyshots: z.number().int().min(0).nullish(),
    legshots: z.number().int().min(0).nullish(),
    damage: z.object({ dealt: z.number().min(0).nullish() }).nullish(),
  })
  .nullish();

const playerSchema = z.object({
  puuid: z.string().nullish(),
  team_id: z.string().nullish(),
  agent: z.object({ name: z.string().nullish() }).nullish(),
  stats: statsSchema,
});

const teamSchema = z.object({
  team_id: z.string().nullish(),
  won: z.boolean().nullish(),
  rounds: z
    .object({
      won: z.number().int().min(0).nullish(),
      lost: z.number().int().min(0).nullish(),
    })
    .nullish(),
});

export const henrikMatchSchema = z.object({
  metadata: z.object({
    match_id: z.string().min(1),
    map: z.object({ name: z.string().nullish() }).nullish(),
    /** v4 ; `game_start_iso` est la forme des versions antérieures. */
    started_at: z.string().nullish(),
    game_start_iso: z.string().nullish(),
    queue: z.object({ name: z.string().nullish() }).nullish(),
  }),
  players: z.array(playerSchema).nullish(),
  teams: z.array(teamSchema).nullish(),
});

export type HenrikMatch = z.infer<typeof henrikMatchSchema>;

export const henrikAccountSchema = z.object({
  puuid: z.string().min(1),
  name: z.string().nullish(),
  tag: z.string().nullish(),
  region: z.string().nullish(),
});

export type HenrikAccount = z.infer<typeof henrikAccountSchema>;

export const henrikMmrSchema = z.object({
  current: z
    .object({
      tier: z.object({ name: z.string().nullish() }).nullish(),
      rr: z.number().nullish(),
      last_change: z.number().nullish(),
      elo: z.number().nullish(),
    })
    .nullish(),
});

export type HenrikMmr = z.infer<typeof henrikMmrSchema>;

/* ------------------------------------------------------------------ */
/* Outils                                                              */
/* ------------------------------------------------------------------ */

function nonEmpty(value: string | null | undefined): string | null {
  const trimmed = value?.trim() ?? "";

  return trimmed === "" ? null : trimmed;
}

function count(value: number | null | undefined): number | null {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.max(0, Math.trunc(value))
    : null;
}

/** Un horodatage ISO normalisé, ou `null` si la source n'en a pas donné. */
export function toIsoOrNull(value: string | null | undefined): string | null {
  const raw = nonEmpty(value);

  if (raw === null) return null;

  const time = Date.parse(raw);

  return Number.isNaN(time) ? null : new Date(time).toISOString();
}

/* ------------------------------------------------------------------ */
/* Rang courant                                                        */
/* ------------------------------------------------------------------ */

/**
 * Le rang tel qu'il s'affichera sur le dashboard.
 *
 * Le RR est borné à 0–100 : c'est le contrat, et une valeur hors bornes est un
 * signe que le champ ne veut plus dire la même chose — mieux vaut l'omettre
 * que d'afficher « 4 312 RR ».
 */
export function summarizeMmr(raw: HenrikMmr): MmrSummary {
  const current = raw.current ?? null;
  const rr = count(current?.rr);
  const change = current?.last_change;

  return {
    tier: nonEmpty(current?.tier?.name),
    rr: rr !== null && rr <= 100 ? rr : null,
    lastChange: typeof change === "number" && Number.isFinite(change) ? Math.trunc(change) : null,
    elo: count(current?.elo),
  };
}

/* ------------------------------------------------------------------ */
/* Résumé d'un match                                                   */
/* ------------------------------------------------------------------ */

/** Moyenne par round, arrondie à l'unité. `null` si l'un des deux manque. */
function perRound(total: number | null, rounds: number | null): number | null {
  if (total === null || rounds === null || rounds <= 0) return null;
  return Math.round(total / rounds);
}

function headshotPercent(stats: z.infer<typeof statsSchema>): number | null {
  const head = count(stats?.headshots);
  const body = count(stats?.bodyshots);
  const legs = count(stats?.legshots);

  if (head === null || body === null || legs === null) return null;

  const shots = head + body + legs;

  // Aucun tir enregistré : le pourcentage n'existe pas, il ne vaut pas 0.
  if (shots === 0) return null;
  return Math.round((head / shots) * 100);
}

/**
 * Le résumé d'un match du point de vue d'un joueur donné.
 *
 * Rend `null` si le joueur n'apparaît pas dans le match : c'est une incohérence
 * de la source (on a demandé *son* historique), et un match qu'on ne sait pas
 * rapporter à quelqu'un n'a rien à faire dans `imported_matches`.
 */
export function summarizeMatch(raw: HenrikMatch, puuid: string): MatchSummary | null {
  const player = (raw.players ?? []).find((entry) => entry.puuid === puuid) ?? null;

  if (player === null) return null;

  const team = (raw.teams ?? []).find((entry) => entry.team_id === player.team_id) ?? null;
  const roundsWon = count(team?.rounds?.won);
  const roundsLost = count(team?.rounds?.lost);
  const rounds = roundsWon !== null && roundsLost !== null ? roundsWon + roundsLost : null;

  return {
    matchId: raw.metadata.match_id,
    playedAt: toIsoOrNull(raw.metadata.started_at ?? raw.metadata.game_start_iso),
    map: nonEmpty(raw.metadata.map?.name),
    mode: nonEmpty(raw.metadata.queue?.name),
    agent: nonEmpty(player.agent?.name),
    kills: count(player.stats?.kills),
    deaths: count(player.stats?.deaths),
    assists: count(player.stats?.assists),
    adr: perRound(count(player.stats?.damage?.dealt), rounds),
    headshotPercent: headshotPercent(player.stats),
    roundsWon,
    roundsLost,
    result: matchResult(team?.won, roundsWon, roundsLost),
  };
}

/**
 * Le verdict de la partie. Le champ `won` de l'équipe fait foi quand il est
 * là ; sinon on compare les rounds, ce qui couvre le cas d'une source qui ne
 * renseigne pas le booléen (et distingue le match nul, que `won: false`
 * confondrait avec une défaite).
 */
function matchResult(
  won: boolean | null | undefined,
  roundsWon: number | null,
  roundsLost: number | null,
): MatchSummary["result"] {
  if (roundsWon !== null && roundsLost !== null && roundsWon === roundsLost) return "egalite";
  if (typeof won === "boolean") return won ? "victoire" : "defaite";
  if (roundsWon === null || roundsLost === null) return null;
  return roundsWon > roundsLost ? "victoire" : "defaite";
}

/**
 * Les résumés d'une liste de matchs, dans l'ordre reçu. Les entrées hors forme
 * sont écartées une par une : une partie illisible ne doit pas emporter les
 * neuf autres.
 */
export function summarizeMatches(raw: readonly unknown[], puuid: string): readonly MatchSummary[] {
  const summaries: MatchSummary[] = [];

  for (const entry of raw) {
    const parsed = henrikMatchSchema.safeParse(entry);

    if (!parsed.success) continue;

    const summary = summarizeMatch(parsed.data, puuid);

    if (summary !== null) summaries.push(summary);
  }
  return summaries;
}
