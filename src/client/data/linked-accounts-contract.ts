/**
 * Contrat des comptes liés : la forme des échanges entre le navigateur et les
 * fonctions serverless `api/valorant/*` et `api/kovaaks/*` (SPEC §5 bis).
 *
 * Un seul module pour les deux côtés — la fonction valide ce qu'elle reçoit,
 * le client valide ce qu'il reçoit, avec les mêmes schémas. Deux copies
 * dériveraient, et la dérive ne se verrait qu'en production.
 *
 * Module pur : Zod et le moteur d'énergie (lui-même sans dépendance). Ni React,
 * ni Supabase, ni `fetch`.
 *
 * Il vit dans `src/client/data/` parce que son consommateur principal est la
 * couche données du client ; les fonctions le lisent par chemin relatif, comme
 * elles lisent déjà `src/client/supabase/database-types`.
 */

import { z } from "zod";
import { DEFAULT_BENCHMARK_ID, type TierId, toTierId } from "../../lib/energy";

/** Les fournisseurs qu'un compte peut lier (miroir du `check` de la table). */
export const PROVIDERS = ["riot", "kovaaks"] as const;

export type Provider = (typeof PROVIDERS)[number];

/* ------------------------------------------------------------------ */
/* Freins quotidiens                                                   */
/* ------------------------------------------------------------------ */

/**
 * Les deux compteurs de `public.import_usage` (migration 0007), miroir du
 * `check` de `increment_import_usage`.
 *
 * Ils existent parce que les deux fonctions concernées appellent des **sources
 * tierces** : le Benchmark Tracker de kovaaks.com (non officiel, sans contrat)
 * et HenrikDev (quota mensuel). L'authentification dit qui appelle, elle ne dit
 * pas combien de fois — et un seul compte qui martèle suffit à faire bannir
 * l'IP de la plateforme ou à épuiser le quota de tout le monde.
 */
export const IMPORT_USAGE_KINDS = ["kovaaks_import", "riot_link"] as const;

export type ImportUsageKind = (typeof IMPORT_USAGE_KINDS)[number];

/**
 * Imports KovaaK's autorisés par utilisateur et par jour UTC.
 *
 * Large exprès : un import légitime se compte en unités par session (un par
 * palier, plus les reprises après un score manquant), pas en dizaines. La
 * limite ne se voit donc jamais en usage normal, et coupe court au martèlement.
 */
export const KOVAAKS_IMPORT_DAILY_LIMIT = 20;

/**
 * Liaisons Riot autorisées par utilisateur et par jour UTC.
 *
 * Plus basse : lier un compte est un geste rare (un principal, quelques alts),
 * et chaque tentative — même ratée sur un Riot ID mal tapé — coûte un appel au
 * quota HenrikDev.
 */
export const RIOT_LINK_DAILY_LIMIT = 10;

/* ------------------------------------------------------------------ */
/* Rang courant                                                        */
/* ------------------------------------------------------------------ */

/** Le rang courant d'un compte Riot, tel qu'il s'affiche sur le dashboard. */
export const mmrSummarySchema = z.object({
  /** « Ascendant 2 », « Immortel 1 »… tel que le nomme la source. */
  tier: z.string().min(1).nullable(),
  /** Rank Rating dans le palier (0–100), `null` si la source ne le donne pas. */
  rr: z.number().int().min(0).max(100).nullable(),
  /** Variation de RR de la dernière partie classée. */
  lastChange: z.number().int().nullable(),
  elo: z.number().int().min(0).nullable(),
});

export type MmrSummary = z.infer<typeof mmrSummarySchema>;

/* ------------------------------------------------------------------ */
/* Un compte lié                                                       */
/* ------------------------------------------------------------------ */

/**
 * Un compte lié tel que l'UI le manipule.
 *
 * `externalId` porte la référence publique : « Nom#TAG » côté Riot, le pseudo
 * du Benchmark Tracker côté KovaaK's. Rien ici n'est un secret — c'est ce qui
 * permet de lier un compte sans OAuth.
 */
export const linkedAccountSchema = z.object({
  id: z.number().int().positive(),
  provider: z.enum(PROVIDERS),
  externalId: z.string().min(1),
  riotPuuid: z.string().min(1).nullable(),
  riotRegion: z.string().min(1).nullable(),
  label: z.string().min(1).nullable(),
  isPrimary: z.boolean(),
  createdAt: z.string().min(1),
  /** Dernier rafraîchissement réussi ; `null` tant qu'il n'y en a pas eu. */
  lastRefreshedAt: z.string().min(1).nullable(),
  /**
   * Le dernier rang connu, tel que le dernier rafraîchissement l'a laissé.
   *
   * Stocké plutôt que redemandé : le dashboard peut ainsi afficher un rang dès
   * la première image, sans attendre un aller-retour vers une source non
   * officielle — et continue de l'afficher quand cette source est en panne.
   */
  riotMmr: mmrSummarySchema.nullable(),
});

export type LinkedAccount = z.infer<typeof linkedAccountSchema>;

/* ------------------------------------------------------------------ */
/* POST /api/valorant/link                                             */
/* ------------------------------------------------------------------ */

/**
 * Bornes d'un Riot ID. Riot impose 3–16 caractères pour le nom et 3–5 pour le
 * tag ; on garde un peu de marge basse pour ne pas refuser un compte valide au
 * cas où ces règles bougeraient — l'API HenrikDev reste l'arbitre final.
 */
export const RIOT_NAME_MAX = 32;
export const RIOT_TAG_MAX = 8;

export const riotLinkRequestSchema = z.object({
  name: z.string().trim().min(1).max(RIOT_NAME_MAX),
  /** Sans le `#` : le client le retire avant d'envoyer. */
  tag: z.string().trim().min(1).max(RIOT_TAG_MAX),
  /** `eu`, `na`, `ap`, `kr`… Laissé libre : HenrikDev tranche. */
  region: z.string().trim().min(2).max(8).optional(),
  label: z.string().trim().min(1).max(60).optional(),
  /** Faire de ce compte le compte affiché sur le dashboard. */
  isPrimary: z.boolean().optional(),
});

export type RiotLinkRequest = z.infer<typeof riotLinkRequestSchema>;

export const riotLinkResponseSchema = z.object({ account: linkedAccountSchema });

export type RiotLinkResponse = z.infer<typeof riotLinkResponseSchema>;

/* ------------------------------------------------------------------ */
/* POST /api/valorant/refresh                                          */
/* ------------------------------------------------------------------ */

/**
 * Le résumé d'un match, tel qu'il est stocké dans `imported_matches.payload`.
 *
 * C'est **un résumé, pas la réponse brute** : ce sont ces champs-là que le
 * coach lira, et ce sont eux qui doivent survivre à un changement de source de
 * données. Tout est nullable parce qu'une API non officielle a le droit de ne
 * pas renseigner un champ — un match à moitié décrit vaut mieux qu'un import
 * qui échoue en entier.
 */
export const matchSummarySchema = z.object({
  matchId: z.string().min(1),
  playedAt: z.string().min(1).nullable(),
  map: z.string().min(1).nullable(),
  mode: z.string().min(1).nullable(),
  agent: z.string().min(1).nullable(),
  kills: z.number().int().min(0).nullable(),
  deaths: z.number().int().min(0).nullable(),
  assists: z.number().int().min(0).nullable(),
  /** Dégâts moyens par round, arrondi à l'unité. */
  adr: z.number().min(0).nullable(),
  /** Pourcentage de tirs à la tête, arrondi à l'unité. */
  headshotPercent: z.number().min(0).max(100).nullable(),
  roundsWon: z.number().int().min(0).nullable(),
  roundsLost: z.number().int().min(0).nullable(),
  result: z.enum(["victoire", "defaite", "egalite"]).nullable(),
});

export type MatchSummary = z.infer<typeof matchSummarySchema>;

/** Matchs demandés par rafraîchissement. Au-delà, on paie du quota pour rien. */
export const MATCH_HISTORY_SIZE = 10;

/** Fenêtre pendant laquelle un rafraîchissement récent est resservi tel quel. */
export const REFRESH_CACHE_MS = 5 * 60 * 1000;

export const refreshRequestSchema = z.object({
  linkedAccountId: z.number().int().positive(),
});

export type RefreshRequest = z.infer<typeof refreshRequestSchema>;

export const refreshResponseSchema = z.object({
  /** `true` quand la réponse vient du cache (aucun appel à la source). */
  cached: z.boolean(),
  mmr: mmrSummarySchema.nullable(),
  matches: z.array(matchSummarySchema),
});

export type RefreshResponse = z.infer<typeof refreshResponseSchema>;

/* ------------------------------------------------------------------ */
/* POST /api/kovaaks/import                                            */
/* ------------------------------------------------------------------ */

/**
 * Le palier demandé à l'import, validé **contre le registre**.
 *
 * Il redisait les trois paliers Voltaic en dur, à côté du jeu de données qui les
 * définit : deux vérités pour une, dont l'une aurait fini par mentir. La
 * validation passe donc par `toTierId`, qui interroge le benchmark — Zod reste
 * la frontière, le registre reste la référence (DECISIONS.md D5).
 *
 * Le benchmark de référence est celui **par défaut**, et non le benchmark actif
 * de l'utilisateur (qui existe depuis W1-B, DECISIONS.md D6) : le contrat de
 * cet endpoint ne porte pas de `benchmarkId`, donc le palier reçu ne peut être
 * validé que contre un benchmark connu des deux côtés. C'est sans conséquence
 * aujourd'hui — le seul benchmark importable depuis KovaaK's est le benchmark
 * par défaut — et c'est à étendre (champ `benchmarkId` dans la requête, de part
 * et d'autre) le jour où un second benchmark s'importe.
 */
export const tierSchema: z.ZodType<TierId> = z.string().superRefine((value, ctx) => {
  try {
    toTierId(DEFAULT_BENCHMARK_ID, value);
  } catch {
    ctx.addIssue({ code: "custom", message: `Palier inconnu du benchmark : « ${value} ».` });
  }
});

/**
 * Pourquoi un des 18 scénarios n'a pas de score exploitable.
 *
 * `incoherent` mérite une explication : le Benchmark Tracker renvoie ses
 * scores en centièmes, et renvoie aussi, pour chaque scénario, le rang atteint
 * et les seuils de rangs. On recoupe les deux. Si le score divisé par cent ne
 * tombe pas dans la tranche du rang annoncé, c'est que l'échelle a changé —
 * auquel cas on préfère ne rien pré-remplir plutôt que pré-remplir cent fois
 * trop.
 */
export const MISSING_REASONS = ["absent", "sans-score", "incoherent"] as const;

export type MissingReason = (typeof MISSING_REASONS)[number];

export const missingScenarioSchema = z.object({
  scenario: z.string().min(1),
  reason: z.enum(MISSING_REASONS),
});

export type MissingScenario = z.infer<typeof missingScenarioSchema>;

export const kovaaksImportRequestSchema = z.object({
  username: z.string().trim().min(1).max(60),
  tier: tierSchema,
});

export type KovaaksImportRequest = z.infer<typeof kovaaksImportRequestSchema>;

/**
 * Ce que l'import rend : des scores à pré-remplir, et l'inventaire de ce qui
 * manque. Rien n'est écrit en base — l'utilisateur vérifie puis sauvegarde.
 */
export const kovaaksImportResponseSchema = z.object({
  username: z.string().min(1),
  steamId: z.string().min(1),
  tier: tierSchema,
  /** Nom de scénario Voltaic → score, dans l'unité du tableur. */
  scores: z.record(z.string(), z.number().nonnegative()),
  missing: z.array(missingScenarioSchema),
  /** Scénarios renvoyés par la source qu'on n'a pas su rattacher au palier. */
  unknown: z.array(z.string()),
});

export type KovaaksImportResponse = z.infer<typeof kovaaksImportResponseSchema>;

/* ------------------------------------------------------------------ */
/* Erreurs                                                             */
/* ------------------------------------------------------------------ */

/** La forme d'échec commune aux trois fonctions, comme pour `api/coach`. */
export const linkedAccountsErrorSchema = z.object({ error: z.string().min(1) });
