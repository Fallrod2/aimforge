/**
 * Schéma Drizzle (SQLite). Les migrations versionnées de `drizzle/` sont
 * générées depuis ce fichier : `bun run db:generate`.
 *
 * Conventions :
 * - dates : chaîne ISO 8601 UTC (`Date#toISOString`), triable lexicographiquement ;
 * - booléens : entier 0/1 exposé en `boolean` par Drizzle ;
 * - champs « JSON » : `text` contenant du JSON sérialisé (mode `json` de Drizzle).
 */

import { integer, real, sqliteTable, text } from "drizzle-orm/sqlite-core";
import { TIER_IDS } from "../../lib/energy";

/** Une passe de bench : un palier, une date, le résultat calculé par le moteur. */
export const benchRuns = sqliteTable("bench_runs", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  date: text("date").notNull(),
  tier: text("tier", { enum: TIER_IDS }).notNull(),
  /** Moyenne harmonique des 9 sous-catégories ; 0 si le bench est incomplet. */
  overall: real("overall").notNull(),
  /** Rang overall atteint, `null` sous le premier rang du palier. */
  rank: text("rank"),
  /** Badge « Complete » : les 18 scénarios atteignent le seuil de `rank`. */
  complete: integer("complete", { mode: "boolean" }).notNull(),
});

/** Le score d'un scénario dans une passe, avec l'énergie figée au moment du calcul. */
export const scenarioScores = sqliteTable("scenario_scores", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  runId: integer("run_id")
    .notNull()
    .references(() => benchRuns.id, { onDelete: "cascade" }),
  scenario: text("scenario").notNull(),
  score: real("score").notNull(),
  energy: real("energy").notNull(),
});

/** Debrief post-game produit par le coach IA (Phase 4 : table seule ici). */
export const debriefs = sqliteTable("debriefs", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  date: text("date").notNull(),
  /** Les stats collées telles quelles par le joueur. */
  input: text("input").notNull(),
  resume: text("resume").notNull(),
  pointsForts: text("points_forts", { mode: "json" }).$type<string[]>().notNull(),
  axes: text("axes", { mode: "json" }).$type<{ titre: string; detail: string }[]>().notNull(),
  focus: text("focus").notNull(),
});

/** Bloc de contenu d'une routine générée. */
export interface RoutineBloc {
  readonly nom: string;
  readonly duree: number;
  readonly items: readonly { readonly texte: string; readonly detail: string }[];
}

/** Routine du jour générée par l'IA (Phase 5 : table seule ici). */
export const routines = sqliteTable("routines", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  date: text("date").notNull(),
  /** Durée disponible, en minutes. */
  duree: integer("duree").notNull(),
  focus: text("focus"),
  contenu: text("contenu", { mode: "json" }).$type<RoutineBloc[]>().notNull(),
  done: integer("done", { mode: "boolean" }).notNull().default(false),
});

/** Profil du joueur. Singleton : une seule ligne, `id` valant toujours 1. */
export const profile = sqliteTable("profile", {
  id: integer("id").primaryKey(),
  pseudo: text("pseudo"),
  currentRank: text("current_rank"),
  peakRank: text("peak_rank"),
  mainAgent: text("main_agent"),
  goal: text("goal"),
  weakMapsNotes: text("weak_maps_notes"),
});

/** Identifiant de l'unique ligne de `profile`. */
export const PROFILE_ID = 1;
