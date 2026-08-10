/**
 * Contrat de la Routine du jour : la forme des échanges entre le navigateur et
 * la fonction serverless `api/routine`, et la forme de la séance attendue du
 * modèle (AIMFORGE_KICKOFF §3, SPEC §7-P4).
 *
 * Un seul module pour les deux côtés, comme `coach-contract.ts` : la fonction
 * valide avec ces schémas ce qu'elle reçoit du modèle, le client valide avec
 * les mêmes ce qu'il reçoit de la fonction et ce qu'il relit en base. Deux
 * copies dériveraient — et la dérive ne se verrait qu'en production, sur une
 * routine à moitié affichée.
 *
 * Module pur : Zod et rien d'autre. Ni React, ni Supabase, ni SDK Anthropic.
 */

import { z } from "zod";

/** Routines autorisées par utilisateur et par jour UTC (SPEC §4). */
export const ROUTINE_DAILY_QUOTA = 5;

/**
 * Bornes de la durée demandée.
 *
 * Le bas : en dessous de 10 minutes, il n'y a pas de séance à structurer, juste
 * un échauffement. Le haut : 240 minutes est déjà une session très longue, et
 * la borne existe surtout pour qu'un appel direct à la fonction ne demande pas
 * une routine de 10 000 minutes que le modèle essaierait d'écrire.
 */
export const MIN_DUREE_MINUTES = 10;
export const MAX_DUREE_MINUTES = 240;

/** Durées proposées d'un geste dans l'UI ; la saisie libre reste possible. */
export const DUREE_PRESETS: readonly number[] = [30, 45, 60, 90];

/**
 * Taille maximale du focus optionnel. C'est du texte libre écrit par le
 * joueur : il traverse le modèle, donc il est borné ici comme les stats du
 * coach le sont dans `coach-contract.ts`.
 */
export const MAX_FOCUS_LENGTH = 200;

/**
 * Ce que le navigateur envoie à `POST /api/routine`.
 *
 * Le focus est facultatif : absent, chaîne vide ou blancs valent tous « pas de
 * focus ». Le détourage vient avant la borne haute pour que « 200 espaces »
 * soit lu comme vide plutôt que refusé.
 */
export const routineRequestSchema = z.object({
  duree_minutes: z.number().int().min(MIN_DUREE_MINUTES).max(MAX_DUREE_MINUTES),
  focus: z
    .string()
    .trim()
    .max(MAX_FOCUS_LENGTH)
    .transform((value) => (value === "" ? null : value))
    .nullish()
    .transform((value) => value ?? null),
});

export type RoutineRequest = z.infer<typeof routineRequestSchema>;

/** Une ligne de la séance : ce qu'on fait, et comment on le fait. */
export const routineItemSchema = z.object({
  texte: z.string().min(1).max(200),
  detail: z.string().min(1).max(600),
});

export type RoutineItem = z.infer<typeof routineItemSchema>;

/** Un bloc de la séance (échauffement, travail ciblé, mise en jeu…). */
export const routineBlocSchema = z.object({
  nom: z.string().min(1).max(80),
  /** Durée du bloc en minutes. */
  duree: z.number().int().min(1).max(MAX_DUREE_MINUTES),
  items: z.array(routineItemSchema).min(1).max(8),
});

export type RoutineBloc = z.infer<typeof routineBlocSchema>;

/**
 * La séance telle que le modèle doit la rendre.
 *
 * Les bornes hautes sont larges à dessein (même raisonnement que pour le
 * debrief) : elles attrapent une sortie manifestement hors format, pas une
 * rédaction un peu longue — un refus coûte une relance, donc de la latence,
 * pour un défaut que le joueur n'aurait pas remarqué.
 *
 * `duree_totale` n'est **pas** contraint à égaler la somme des blocs : le
 * modèle arrondit, et refuser une routine parce qu'il manque une minute serait
 * dépenser une relance pour rien. L'UI affiche les deux, le joueur tranche.
 */
export const routineContentSchema = z.object({
  titre: z.string().min(1).max(120),
  /** Durée totale annoncée, en minutes. */
  duree_totale: z.number().int().min(1).max(MAX_DUREE_MINUTES),
  blocs: z.array(routineBlocSchema).min(1).max(6),
  objectif_game: z.string().min(1).max(600),
  conseil: z.string().min(1).max(600),
});

export type RoutineContent = z.infer<typeof routineContentSchema>;

/* ------------------------------------------------------------------ */
/* Ancrage : mode de génération et sources citées (SPEC §5 sexies, V5) */
/* ------------------------------------------------------------------ */

/**
 * Sur quoi la séance a été construite.
 *
 * `full` : le contexte incluait les agrégats in-game (le joueur a assez de
 * parties classées récentes). `bench_only` : la routine a été produite **sans
 * aucune stat in-game**, et l'écran doit le dire — une routine bâtie sur le seul
 * bench reste utile, mais elle ne prétend pas connaître les parties.
 */
/**
 * Fenêtre de « récence » des parties classées, en jours.
 *
 * « Récent » ne veut pas dire « éternel » : une routine du jour ne doit pas
 * s'appuyer sur des parties d'il y a trois mois, jouées sur un autre patch avec
 * une autre sensibilité. Quatorze jours couvrent deux week-ends — donc le rythme
 * d'un joueur qui ne joue pas tous les soirs — sans remonter à une période dont
 * il ne se souvient plus. C'est un choix, pas une mesure.
 */
export const ROUTINE_RECENT_WINDOW_DAYS = 14;

/**
 * Parties classées récentes exigées pour une routine ancrée in-game.
 *
 * En dessous, la moyenne d'un HS% ou d'un ADR se déplace de plusieurs points sur
 * une seule partie : une routine bâtie dessus prescrirait du tracking parce
 * qu'une soirée s'est mal passée. Cinq n'est pas un seuil statistique, c'est le
 * minimum en dessous duquel on préfère l'admettre — d'où le mode « bench seul »
 * plutôt qu'un refus : la routine se génère quand même, elle le dit.
 *
 * Les deux constantes vivent dans le contrat, et non côté serveur, parce que
 * les deux côtés en ont besoin : la fonction pour trancher, l'écran pour écrire
 * « joue N parties classées ». Deux copies finiraient par annoncer un seuil que
 * le serveur n'applique pas.
 */
export const ROUTINE_MIN_RECENT_MATCHES = 5;

export const ROUTINE_MODES = ["bench_only", "full"] as const;

export const routineModeSchema = z.enum(ROUTINE_MODES);

export type RoutineMode = z.infer<typeof routineModeSchema>;

/**
 * Une donnée citée par le modèle **et vérifiée par le serveur**, telle que
 * l'écran la rend en puce « source ».
 *
 * Les deux champs sont du texte déjà mis en forme : l'unité et l'arrondi sont
 * décidés côté serveur, là où la donnée est connue, pas dans le composant.
 */
export const routineSourceSchema = z.object({
  label: z.string().min(1).max(120),
  value: z.string().min(1).max(40),
});

export type RoutineSource = z.infer<typeof routineSourceSchema>;

/** Sources affichées au maximum : au-delà, c'est un tableau, pas une note. */
export const MAX_ROUTINE_SOURCES = 20;

/**
 * Une routine enregistrée : le contenu, ce que la base y a ajouté, et
 * l'ancrage que la fonction a calculé.
 *
 * `mode`, `matchesUsed` et `sources` sont **facultatifs**, et c'est une
 * compatibilité, pas une hésitation : les routines écrites avant V5 n'en
 * portent pas, et leur relecture ne doit pas échouer pour autant (le contenu
 * vit dans une colonne `jsonb`, il n'y a pas de migration qui les remplirait).
 * Absents, l'écran n'affiche ni bandeau ni sources — ce qui est exact : cette
 * routine-là n'a jamais été ancrée.
 *
 * Le nommage mélange les deux conventions du projet, et délibérément : ce que
 * le **modèle** rend garde le `snake_case` qu'il a produit (`duree_minutes`,
 * `objectif_game`), ce que le **serveur** calcule garde le `camelCase` des
 * agrégats d'où il sort (`valorant-contract.ts` : `matchCount`,
 * `headshotPercent`). La casse dit d'où vient le champ.
 */
export const storedRoutineSchema = routineContentSchema.extend({
  id: z.number().int().positive(),
  /** Horodatage ISO 8601 de l'enregistrement. */
  date: z.string().min(1),
  /** La durée demandée, qui n'est pas forcément celle que le modèle a rendue. */
  duree_minutes: z.number().int().min(MIN_DUREE_MINUTES).max(MAX_DUREE_MINUTES),
  focus: z.string().max(MAX_FOCUS_LENGTH).nullable(),
  done: z.boolean(),
  mode: routineModeSchema.optional(),
  /** Parties classées récentes prises en compte pour décider du mode. */
  matchesUsed: z.number().int().min(0).optional(),
  sources: z.array(routineSourceSchema).max(MAX_ROUTINE_SOURCES).optional(),
});

export type StoredRoutine = z.infer<typeof storedRoutineSchema>;

/** La réponse de `POST /api/routine` en cas de succès. */
export const routineResponseSchema = z.object({
  routine: storedRoutineSchema,
  /**
   * Routines restantes aujourd'hui, après celle-ci — ou `null` quand il n'y a
   * rien à compter : l'utilisateur a configuré son propre fournisseur (SPEC
   * §5 ter), donc le quota AimForge ne le concerne plus. `null` est un état,
   * pas une absence de mesure : l'écran l'affiche comme « quota levé ».
   */
  remaining: z.number().int().min(0).nullable(),
});

export type RoutineResponse = z.infer<typeof routineResponseSchema>;

/**
 * La réponse d'erreur de `POST /api/routine`.
 *
 * `remaining` n'est renseigné que là où il veut dire quelque chose : le quota
 * atteint (429), et les échecs qui ont **remboursé** l'incrément (migration
 * 0010) — le compteur y a bougé, l'écran doit le savoir. Ailleurs, l'appel n'a
 * pas atteint le compteur, et la clé est absente plutôt que nulle : facultative
 * ne veut pas dire nullable, un `null` ferait échouer cette relecture.
 */
export const routineErrorSchema = z.object({
  error: z.string().min(1),
  remaining: z.number().int().min(0).optional(),
});

export type RoutineError = z.infer<typeof routineErrorSchema>;
