/**
 * Traduction du **détail** d'un match HenrikDev en résumé structuré — module
 * **pur**, jumeau de `./summary.ts` : il connaît la *forme* des données, jamais
 * le réseau ni la clé (ceux-là vivent dans `api/_lib/henrikdev.ts`).
 *
 * Là où `summary.ts` produit la ligne d'historique (une partie = une ligne),
 * celui-ci produit ce qu'on regarde quand on **ouvre** une partie : le
 * scoreboard des dix joueurs, le déroulé des rounds, et la performance du
 * joueur par côté.
 *
 * Trois partis pris, dans l'ordre où ils comptent :
 *
 * 1. **Défensif de bout en bout.** Tout est optionnel côté schéma et nullable
 *    côté résumé, exactement comme pour le résumé de match. Un champ manquant
 *    fait un trou dans l'affichage, jamais un import raté.
 * 2. **Réduit à l'utile, et anonymisé.** Ni PUUID, ni tag, ni identifiant de
 *    compte des neuf autres joueurs : un nom en jeu, un agent, une équipe, des
 *    chiffres. Le joueur courant est marqué d'un `isYou`, ce qui suffit à
 *    surligner sa ligne sans garder de quoi le retrouver ailleurs.
 * 3. **Le côté d'un round se déduit, il ne se devine pas.** Voir `sidesByRound`
 *    plus bas : la seule preuve acceptée est un événement du round lui-même
 *    (une pose ou un désamorçage), et l'absence de preuve donne `null`.
 */

import { z } from "zod";
import type {
  MatchDetail,
  RoundOutcome,
  ScoreboardEntry,
  Side,
  SidePerformance,
  Team,
} from "../../shared/valorant-contract.js";
import { toIsoOrNull } from "./summary.js";

/* ------------------------------------------------------------------ */
/* La forme des données reçues                                         */
/* ------------------------------------------------------------------ */

const shotsSchema = {
  headshots: z.number().int().min(0).nullish(),
  bodyshots: z.number().int().min(0).nullish(),
  legshots: z.number().int().min(0).nullish(),
};

const playerStatsSchema = z
  .object({
    score: z.number().min(0).nullish(),
    kills: z.number().int().min(0).nullish(),
    deaths: z.number().int().min(0).nullish(),
    assists: z.number().int().min(0).nullish(),
    ...shotsSchema,
    damage: z.object({ dealt: z.number().min(0).nullish() }).nullish(),
  })
  .nullish();

const detailPlayerSchema = z.object({
  puuid: z.string().nullish(),
  name: z.string().nullish(),
  team_id: z.string().nullish(),
  agent: z.object({ name: z.string().nullish() }).nullish(),
  stats: playerStatsSchema,
});

const detailTeamSchema = z.object({
  team_id: z.string().nullish(),
  won: z.boolean().nullish(),
  rounds: z
    .object({
      won: z.number().int().min(0).nullish(),
      lost: z.number().int().min(0).nullish(),
    })
    .nullish(),
});

/** Le porteur d'un événement de round : celui qui pose, celui qui désamorce. */
const eventPlayerSchema = z
  .object({
    player: z
      .object({
        puuid: z.string().nullish(),
        team: z.string().nullish(),
      })
      .nullish(),
  })
  .nullish();

const roundPlayerSchema = z.object({
  player: z.object({ puuid: z.string().nullish(), team: z.string().nullish() }).nullish(),
  stats: z
    .object({
      kills: z.number().int().min(0).nullish(),
      damage: z.number().min(0).nullish(),
      ...shotsSchema,
    })
    .nullish(),
});

const detailRoundSchema = z.object({
  winning_team: z.string().nullish(),
  plant: eventPlayerSchema,
  defuse: eventPlayerSchema,
  stats: z.array(roundPlayerSchema).nullish(),
});

/**
 * La réponse de `/v4/match/{region}/{matchId}`, réduite à ce qu'on en lit.
 *
 * `metadata.match_id` est la seule exigence stricte : un détail qu'on ne sait
 * pas rattacher à une partie n'a rien à faire en cache.
 */
export const henrikMatchDetailSchema = z.object({
  metadata: z.object({
    match_id: z.string().min(1),
    map: z.object({ name: z.string().nullish() }).nullish(),
    started_at: z.string().nullish(),
    game_start_iso: z.string().nullish(),
    queue: z.object({ name: z.string().nullish() }).nullish(),
  }),
  players: z.array(detailPlayerSchema).nullish(),
  teams: z.array(detailTeamSchema).nullish(),
  rounds: z.array(detailRoundSchema).nullish(),
});

export type HenrikMatchDetail = z.infer<typeof henrikMatchDetailSchema>;

/* ------------------------------------------------------------------ */
/* Outils                                                              */
/* ------------------------------------------------------------------ */

/**
 * Rounds d'une mi-temps en compétitif. Sert **uniquement** à savoir quels rounds
 * partagent un même côté : les côtés ne changent qu'à la mi-temps, c'est une
 * règle du jeu et non un seuil réglable.
 */
const HALF_ROUNDS = 12;

/** Le début des prolongations, où les côtés s'échangent à chaque round. */
const OVERTIME_START = HALF_ROUNDS * 2;

function nonEmpty(value: string | null | undefined): string | null {
  const trimmed = value?.trim() ?? "";

  return trimmed === "" ? null : trimmed;
}

function count(value: number | null | undefined): number | null {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.max(0, Math.trunc(value))
    : null;
}

/** Le nom d'équipe de la source (`Red`, `blue`…) ramené au vocabulaire du contrat. */
export function toTeam(value: string | null | undefined): Team | null {
  const raw = nonEmpty(value)?.toLowerCase() ?? null;

  if (raw === null) return null;
  if (raw === "red") return "rouge";
  if (raw === "blue") return "bleue";
  return null;
}

/** L'autre équipe. Une partie n'en compte que deux : le contraire est total. */
function opposite(team: Team): Team {
  return team === "rouge" ? "bleue" : "rouge";
}

/** Pourcentage de tirs à la tête, `null` si aucun tir n'a été enregistré. */
function headshotPercent(head: number | null, body: number | null, legs: number | null) {
  if (head === null || body === null || legs === null) return null;

  const shots = head + body + legs;

  // Aucun tir enregistré : le pourcentage n'existe pas, il ne vaut pas 0.
  if (shots === 0) return null;
  return Math.round((head / shots) * 100);
}

/** Moyenne par round, arrondie à l'unité. `null` si l'un des deux manque. */
function perRound(total: number | null, rounds: number | null): number | null {
  if (total === null || rounds === null || rounds <= 0) return null;
  return Math.round(total / rounds);
}

/* ------------------------------------------------------------------ */
/* Le côté joué à chaque round                                         */
/* ------------------------------------------------------------------ */

/**
 * Quelle équipe attaque à chaque round ?
 *
 * La source ne le dit pas directement en v4. Deux façons de répondre :
 * appliquer une convention (« l'équipe rouge attaque en première mi-temps »),
 * ou **le déduire des faits du round**. La première est une devinette : elle
 * inverserait la moitié des tableaux le jour où la convention change ou se
 * révèle fausse. On prend donc la seconde.
 *
 * La preuve acceptée : la Spike ne se pose que par un attaquant, et ne se
 * désamorce que par un défenseur. Un round qui contient l'un ou l'autre désigne
 * donc son équipe attaquante sans ambiguïté.
 *
 * La déduction s'étend ensuite à la **mi-temps** entière, et pas plus loin :
 * les côtés sont constants du round 1 au round 12, puis du 13 au 24 ; en
 * prolongation ils s'échangent à chaque round, donc chaque round de
 * prolongation ne répond que de lui-même. Une mi-temps sans le moindre
 * événement (partie très courte, source incomplète) reste sans côté : `null`
 * s'affiche comme « inconnu », ce qui est vrai, plutôt qu'à moitié faux.
 */
function attackingTeams(rounds: readonly z.infer<typeof detailRoundSchema>[]): (Team | null)[] {
  const evidence = rounds.map((round) => {
    const planter = toTeam(round.plant?.player?.team);

    if (planter !== null) return planter;

    const defuser = toTeam(round.defuse?.player?.team);

    return defuser === null ? null : opposite(defuser);
  });
  // Une mi-temps (ou un round de prolongation) partage un même côté : le
  // premier fait connu du groupe vaut pour tout le groupe.
  const groups = new Map<number, Team>();

  evidence.forEach((team, index) => {
    if (team === null) return;

    const group = groupOf(index);

    if (!groups.has(group)) groups.set(group, team);
  });

  return evidence.map((team, index) => team ?? groups.get(groupOf(index)) ?? null);
}

/** Le groupe de rounds qui partagent un côté : mi-temps, puis round par round. */
function groupOf(index: number): number {
  if (index < HALF_ROUNDS) return 0;
  if (index < OVERTIME_START) return 1;
  return 2 + (index - OVERTIME_START);
}

/* ------------------------------------------------------------------ */
/* Le détail                                                           */
/* ------------------------------------------------------------------ */

/** Le verdict de la partie — mêmes règles que `summarizeMatch`. */
function matchResult(
  won: boolean | null | undefined,
  roundsWon: number | null,
  roundsLost: number | null,
): MatchDetail["result"] {
  if (roundsWon !== null && roundsLost !== null && roundsWon === roundsLost) return "egalite";
  if (typeof won === "boolean") return won ? "victoire" : "defaite";
  if (roundsWon === null || roundsLost === null) return null;
  return roundsWon > roundsLost ? "victoire" : "defaite";
}

/** Le scoreboard : une ligne par joueur, dans l'ordre où la source les donne. */
function scoreboard(
  players: readonly z.infer<typeof detailPlayerSchema>[],
  puuid: string,
  rounds: number | null,
): ScoreboardEntry[] {
  return players.map((player) => ({
    name: nonEmpty(player.name),
    agent: nonEmpty(player.agent?.name),
    team: toTeam(player.team_id),
    isYou: player.puuid === puuid,
    score: count(player.stats?.score),
    kills: count(player.stats?.kills),
    deaths: count(player.stats?.deaths),
    assists: count(player.stats?.assists),
    adr: perRound(count(player.stats?.damage?.dealt), rounds),
    headshotPercent: headshotPercent(
      count(player.stats?.headshots),
      count(player.stats?.bodyshots),
      count(player.stats?.legshots),
    ),
  }));
}

/** Ce que le joueur a fait dans un round donné, quand la source le détaille. */
interface RoundStats {
  readonly kills: number | null;
  readonly damage: number | null;
  readonly headshots: number | null;
  readonly bodyshots: number | null;
  readonly legshots: number | null;
}

function roundStatsOf(round: z.infer<typeof detailRoundSchema>, puuid: string): RoundStats | null {
  const entry = (round.stats ?? []).find((row) => row.player?.puuid === puuid) ?? null;

  if (entry === null) return null;
  return {
    kills: count(entry.stats?.kills),
    damage: count(entry.stats?.damage),
    headshots: count(entry.stats?.headshots),
    bodyshots: count(entry.stats?.bodyshots),
    legshots: count(entry.stats?.legshots),
  };
}

/** Somme d'une colonne, `null` si aucune valeur n'a été renseignée. */
function sum(values: readonly (number | null)[]): number | null {
  const known = values.filter((value): value is number => value !== null);

  return known.length === 0 ? null : known.reduce((total, value) => total + value, 0);
}

/**
 * La performance par côté : une entrée par côté réellement joué.
 *
 * Les rounds sans côté connu ne comptent nulle part — les rattacher à l'un des
 * deux fausserait précisément la comparaison que ce tableau existe pour faire.
 */
function sidePerformances(
  outcomes: readonly RoundOutcome[],
  stats: readonly (RoundStats | null)[],
): SidePerformance[] {
  const performances: SidePerformance[] = [];

  for (const side of ["attaque", "defense"] as const satisfies readonly Side[]) {
    const indexes = outcomes
      .map((outcome, index) => (outcome.side === side ? index : -1))
      .filter((index) => index >= 0);

    if (indexes.length === 0) continue;

    const played = indexes.map((index) => stats[index] ?? null);
    const damage = sum(played.map((entry) => entry?.damage ?? null));

    performances.push({
      side,
      rounds: indexes.length,
      roundsWon: indexes.filter((index) => outcomes[index]?.won === true).length,
      kills: sum(played.map((entry) => entry?.kills ?? null)),
      adr: perRound(damage, indexes.length),
      headshotPercent: headshotPercent(
        sum(played.map((entry) => entry?.headshots ?? null)),
        sum(played.map((entry) => entry?.bodyshots ?? null)),
        sum(played.map((entry) => entry?.legshots ?? null)),
      ),
    });
  }
  return performances;
}

/**
 * Le détail d'un match du point de vue d'un joueur donné.
 *
 * Rend `null` si le joueur n'apparaît pas dans la partie : c'est une
 * incohérence de la source (on a demandé un match de *son* historique), et un
 * détail qu'on ne sait pas rapporter à quelqu'un n'a rien à faire en cache.
 */
export function summarizeDetail(raw: HenrikMatchDetail, puuid: string): MatchDetail | null {
  const players = raw.players ?? [];
  const player = players.find((entry) => entry.puuid === puuid) ?? null;

  if (player === null) return null;

  const team = toTeam(player.team_id);
  const ownTeam = (raw.teams ?? []).find((entry) => entry.team_id === player.team_id) ?? null;
  const roundsWon = count(ownTeam?.rounds?.won);
  const roundsLost = count(ownTeam?.rounds?.lost);
  const rawRounds = raw.rounds ?? [];
  // Le nombre de rounds sert de dénominateur aux ADR du scoreboard : le déroulé
  // fait foi quand il est là, le score des équipes prend le relais sinon.
  const totalRounds =
    rawRounds.length > 0
      ? rawRounds.length
      : roundsWon !== null && roundsLost !== null
        ? roundsWon + roundsLost
        : null;
  const attackers = attackingTeams(rawRounds);
  const outcomes: RoundOutcome[] = rawRounds.map((round, index) => {
    const winner = toTeam(round.winning_team);
    const attacker = attackers[index] ?? null;

    return {
      index: index + 1,
      won: winner === null || team === null ? null : winner === team,
      side: attacker === null || team === null ? null : attacker === team ? "attaque" : "defense",
    };
  });

  return {
    matchId: raw.metadata.match_id,
    playedAt: toIsoOrNull(raw.metadata.started_at ?? raw.metadata.game_start_iso),
    map: nonEmpty(raw.metadata.map?.name),
    mode: nonEmpty(raw.metadata.queue?.name),
    team,
    result: matchResult(ownTeam?.won, roundsWon, roundsLost),
    roundsWon,
    roundsLost,
    scoreboard: scoreboard(players, puuid, totalRounds),
    rounds: outcomes,
    sides: sidePerformances(
      outcomes,
      rawRounds.map((round) => roundStatsOf(round, puuid)),
    ),
  };
}

/**
 * Le détail d'une réponse brute, ou `null` si elle n'a pas la forme attendue.
 *
 * Le point d'entrée de la fonction serverless : elle reçoit du `unknown` de
 * `api/_lib/henrikdev.ts` et n'a pas à connaître les schémas.
 */
export function parseMatchDetail(raw: unknown, puuid: string): MatchDetail | null {
  const parsed = henrikMatchDetailSchema.safeParse(raw);

  if (!parsed.success) return null;
  return summarizeDetail(parsed.data, puuid);
}
