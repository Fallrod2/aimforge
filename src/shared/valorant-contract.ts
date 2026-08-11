/**
 * Contrat des données Valorant enrichies (SPEC §5 sexies, V1) : le détail d'un
 * match et les agrégats de profil, tels qu'ils circulent entre le navigateur et
 * `api/valorant/match` / `api/valorant/stats`.
 *
 * Deux surfaces, une seule règle : **ce qui sort du serveur est validé par le
 * même schéma que celui qui l'a écrit**. Le serveur valide avant d'insérer en
 * cache, le client valide ce qu'il reçoit ; une ligne de cache écrite par une
 * version antérieure du résumé sera donc écartée à la lecture au lieu de faire
 * planter un écran sur un champ absent.
 *
 * Module pur : Zod et rien d'autre. Il vit dans `src/shared/` — comme
 * `coach-contract` et `admin-contract` — parce qu'il est lu par les deux côtés
 * à parts égales : les fonctions serverless valident leurs sorties avec, les
 * modules purs de `src/server/valorant/` en tirent leurs types.
 *
 * Ce que ce contrat ne porte pas, délibérément : aucun PUUID, aucun tag Riot,
 * aucun identifiant de compte des neuf autres joueurs d'une partie. Le
 * scoreboard sert à se situer dans son propre match, pas à pister des tiers —
 * un nom en jeu et un agent suffisent à s'y retrouver.
 */

import { z } from "zod";

/* ------------------------------------------------------------------ */
/* Vocabulaire commun                                                  */
/* ------------------------------------------------------------------ */

/** Les deux équipes d'une partie, nommées comme la source les nomme. */
export const TEAMS = ["rouge", "bleue"] as const;

export type Team = (typeof TEAMS)[number];

/** Les deux côtés d'un round. Le vocabulaire du jeu, en français. */
export const SIDES = ["attaque", "defense"] as const;

export type Side = (typeof SIDES)[number];

/** Le verdict d'une partie, repris tel quel de `matchSummarySchema`. */
export const RESULTS = ["victoire", "defaite", "egalite"] as const;

export const resultSchema = z.enum(RESULTS);

/**
 * Longueur maximale acceptée pour un identifiant de match.
 *
 * Un UUID Riot en fait 36 ; la marge couvre un fournisseur qui préfixerait, et
 * la borne coupe court à l'envoi d'un roman dans un champ indexé.
 */
export const MATCH_ID_MAX = 100;

/* ------------------------------------------------------------------ */
/* POST /api/valorant/match — le détail d'une partie                   */
/* ------------------------------------------------------------------ */

export const matchDetailRequestSchema = z.object({
  /** `snake_case` comme `api/coach` : c'est la convention des corps de requête. */
  match_id: z.string().trim().min(1).max(MATCH_ID_MAX),
  /**
   * Demande en plus la **mini-analyse** de la partie (SPEC §5 sexies, V4).
   *
   * Facultatif, et faux par défaut : ouvrir une partie ne doit jamais dépenser
   * un quota. C'est le clic sur « Analyser ce match » qui pose ce drapeau, et
   * lui seul.
   */
  analyze: z.boolean().optional(),
});

export type MatchDetailRequest = z.infer<typeof matchDetailRequestSchema>;

/**
 * Longueur maximale acceptée pour une mini-analyse.
 *
 * Le prompt demande deux à quatre phrases (300 à 500 caractères) et le budget
 * de jetons borne déjà la sortie : cette borne-ci n'attrape qu'une réponse
 * manifestement hors format. Elle est **la même** que la contrainte de colonne
 * (migration 0016), pour qu'un texte accepté ici soit toujours enregistrable.
 */
export const MATCH_ANALYSIS_MAX = 800;

/**
 * Une ligne du scoreboard.
 *
 * `isYou` remplace le PUUID : c'est la seule chose que l'écran a besoin de
 * savoir pour surligner sa propre ligne, et elle ne dit rien de personne
 * d'autre. Tout le reste est nullable — une API non officielle a le droit de ne
 * pas renseigner un champ, et un scoreboard à moitié rempli reste plus utile
 * qu'un détail refusé en bloc.
 */
export const scoreboardEntrySchema = z.object({
  /** Nom en jeu, **sans** le tag : de quoi se reconnaître, pas de quoi pister. */
  name: z.string().min(1).nullable(),
  agent: z.string().min(1).nullable(),
  team: z.enum(TEAMS).nullable(),
  isYou: z.boolean(),
  /** Score de combat total tel que la source le donne. */
  score: z.number().int().min(0).nullable(),
  kills: z.number().int().min(0).nullable(),
  deaths: z.number().int().min(0).nullable(),
  assists: z.number().int().min(0).nullable(),
  adr: z.number().min(0).nullable(),
  headshotPercent: z.number().min(0).max(100).nullable(),
});

export type ScoreboardEntry = z.infer<typeof scoreboardEntrySchema>;

/**
 * Un round, du point de vue du joueur : l'a-t-il gagné, et de quel côté ?
 *
 * `side` est `null` quand la source ne permet pas de le déduire — voir
 * `src/server/valorant/detail.ts`, qui explique d'où vient la déduction et
 * pourquoi elle ne devine jamais.
 */
export const roundOutcomeSchema = z.object({
  /** Numéro du round, à partir de 1. */
  index: z.number().int().min(1),
  won: z.boolean().nullable(),
  side: z.enum(SIDES).nullable(),
});

export type RoundOutcome = z.infer<typeof roundOutcomeSchema>;

/** La performance du joueur sur un côté donné, sur l'ensemble de la partie. */
export const sidePerformanceSchema = z.object({
  side: z.enum(SIDES),
  rounds: z.number().int().min(0),
  roundsWon: z.number().int().min(0),
  kills: z.number().int().min(0).nullable(),
  /** Dégâts par round de ce côté, arrondi à l'unité. */
  adr: z.number().min(0).nullable(),
  headshotPercent: z.number().min(0).max(100).nullable(),
});

export type SidePerformance = z.infer<typeof sidePerformanceSchema>;

/**
 * Le détail d'un match, tel qu'il est stocké dans `match_details.payload`.
 *
 * C'est un **résumé structuré**, pas la réponse brute du fournisseur : les
 * champs listés ici sont ceux que l'écran de match affiche, et ce sont eux qui
 * doivent survivre à un changement de source de données.
 */
export const matchDetailSchema = z.object({
  matchId: z.string().min(1),
  playedAt: z.string().min(1).nullable(),
  map: z.string().min(1).nullable(),
  mode: z.string().min(1).nullable(),
  /** L'équipe du joueur ; les autres lignes du scoreboard s'y comparent. */
  team: z.enum(TEAMS).nullable(),
  result: resultSchema.nullable(),
  roundsWon: z.number().int().min(0).nullable(),
  roundsLost: z.number().int().min(0).nullable(),
  scoreboard: z.array(scoreboardEntrySchema),
  rounds: z.array(roundOutcomeSchema),
  /** Au plus deux entrées, et seulement pour les côtés réellement joués. */
  sides: z.array(sidePerformanceSchema),
});

export type MatchDetail = z.infer<typeof matchDetailSchema>;

export const matchDetailResponseSchema = z.object({
  /** `true` quand la réponse vient de `match_details` (aucun appel sortant). */
  cached: z.boolean(),
  detail: matchDetailSchema,
  /**
   * La mini-analyse déjà enregistrée pour cette partie, ou `null` (V4).
   *
   * Elle voyage avec le détail **même sans `analyze`** : c'est ce qui permet à
   * l'écran de match d'afficher une analyse déjà payée sans second appel, et de
   * n'offrir le bouton que lorsqu'il n'y a réellement rien à montrer.
   */
  analysis: z.string().min(1).nullable(),
  /**
   * Messages de coach restants aujourd'hui, quand une génération vient d'être
   * comptée sur la clé de la plateforme. `null` partout ailleurs — une lecture
   * ne décompte rien, et une clé personnelle n'a pas de compteur.
   */
  remaining: z.number().int().min(0).nullable(),
});

export type MatchDetailResponse = z.infer<typeof matchDetailResponseSchema>;

/* ------------------------------------------------------------------ */
/* GET /api/valorant/stats — les agrégats de profil                    */
/* ------------------------------------------------------------------ */

/**
 * Les compteurs d'un ensemble de matchs.
 *
 * Les moyennes sont `null` plutôt que `0` quand aucun match ne porte la donnée :
 * « pas de HS% connu » et « 0 % de tirs à la tête » ne se disent pas pareil, et
 * un graphe qui les confondrait tracerait une chute qui n'a pas eu lieu.
 */
export const statTotalsSchema = z.object({
  matches: z.number().int().min(0),
  wins: z.number().int().min(0),
  losses: z.number().int().min(0),
  draws: z.number().int().min(0),
  /** Pourcentage de victoires sur les matchs au résultat connu. */
  winrate: z.number().min(0).max(100).nullable(),
  kills: z.number().int().min(0),
  deaths: z.number().int().min(0),
  assists: z.number().int().min(0),
  /** Ratio kills/deaths, `null` si aucune mort n'a été enregistrée. */
  kd: z.number().min(0).nullable(),
  headshotPercent: z.number().min(0).max(100).nullable(),
  adr: z.number().min(0).nullable(),
});

export type StatTotals = z.infer<typeof statTotalsSchema>;

/** Les mêmes compteurs, pour un agent ou une map donnés. */
export const statBreakdownSchema = z.object({
  key: z.string().min(1),
  totals: statTotalsSchema,
});

export type StatBreakdown = z.infer<typeof statBreakdownSchema>;

/** Un point de la série temporelle : un match, dans l'ordre où il a été joué. */
export const trendPointSchema = z.object({
  matchId: z.string().min(1),
  playedAt: z.string().min(1).nullable(),
  map: z.string().min(1).nullable(),
  agent: z.string().min(1).nullable(),
  headshotPercent: z.number().min(0).max(100).nullable(),
  adr: z.number().min(0).nullable(),
  result: resultSchema.nullable(),
  /**
   * Variation de RR de la partie, quand elle est connue.
   *
   * Elle ne vient pas du résumé de match (`imported_matches.payload` ne la
   * porte pas) : l'agrégateur accepte une table `matchId → RR` que l'appelant
   * remplit s'il en a une. Aujourd'hui personne n'en a — seul le RR *courant*
   * est stocké, sur le compte lié — donc ce champ vaut `null` partout, et la
   * place est prête pour l'historique de RR du jour où V2 en aura besoin.
   */
  rr: z.number().int().nullable(),
});

export type TrendPoint = z.infer<typeof trendPointSchema>;

/** Les trois fenêtres d'analyse. Les clés sont fixes : l'écran les nomme. */
export const statPeriodsSchema = z.object({
  last7Days: statTotalsSchema,
  last30Days: statTotalsSchema,
  all: statTotalsSchema,
});

export type StatPeriods = z.infer<typeof statPeriodsSchema>;

export const valorantStatsSchema = z.object({
  periods: statPeriodsSchema,
  /** Du plus joué au moins joué, à égalité par ordre alphabétique. */
  byAgent: z.array(statBreakdownSchema),
  byMap: z.array(statBreakdownSchema),
  /** Du plus ancien au plus récent : l'ordre dans lequel un graphe se lit. */
  trend: z.array(trendPointSchema),
});

export type ValorantStats = z.infer<typeof valorantStatsSchema>;

export const valorantStatsResponseSchema = z.object({
  /** Le compte Riot principal dont viennent ces chiffres ; `null` s'il n'y en a pas. */
  accountId: z.number().int().positive().nullable(),
  /** Nombre de matchs pris en compte (après validation des lignes stockées). */
  matchCount: z.number().int().min(0),
  stats: valorantStatsSchema,
});

export type ValorantStatsResponse = z.infer<typeof valorantStatsResponseSchema>;

/* ------------------------------------------------------------------ */
/* Erreurs                                                             */
/* ------------------------------------------------------------------ */

/** La forme d'échec commune aux deux fonctions, comme partout ailleurs. */
export const valorantErrorSchema = z.object({ error: z.string().min(1) });
