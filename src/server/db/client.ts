/**
 * Ouverture de la base SQLite locale + application des migrations.
 *
 * Ce module est le seul à importer `bun:sqlite` : il n'est jamais chargé par
 * les tests vitest (qui tournent sous Node) — voir `src/server/app.ts`.
 */

import { Database } from "bun:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { type BunSQLiteDatabase, drizzle } from "drizzle-orm/bun-sqlite";
import { migrate } from "drizzle-orm/bun-sqlite/migrator";
import * as schema from "./schema";

/** Chemin par défaut du fichier de base (surchargeable par `AIMFORGE_DB_PATH`). */
export const DEFAULT_DB_PATH = "data/aimforge.db";

/** Base en mémoire : utilisée par les tests, jamais persistée sur disque. */
export const MEMORY_DB_PATH = ":memory:";

const MIGRATIONS_FOLDER = fileURLToPath(new URL("../../../drizzle", import.meta.url));

/** La base typée par le schéma : passée aux routes, jamais globale. */
export type AppDatabase = BunSQLiteDatabase<typeof schema>;

/**
 * Ouvre la base au chemin donné, applique les migrations en attente et rend
 * le handle Drizzle. Chaque appel avec `:memory:` rend une base neuve et isolée.
 */
export function openDatabase(
  path: string = process.env.AIMFORGE_DB_PATH ?? DEFAULT_DB_PATH,
): AppDatabase {
  if (path !== MEMORY_DB_PATH) {
    mkdirSync(dirname(path), { recursive: true });
  }

  const sqlite = new Database(path, { create: true });

  // Sans ce pragma (désactivé par défaut en SQLite), le ON DELETE CASCADE de
  // scenario_scores ne s'applique pas.
  sqlite.exec("PRAGMA foreign_keys = ON;");

  const db = drizzle(sqlite, { schema });

  migrate(db, { migrationsFolder: MIGRATIONS_FOLDER });
  return db;
}
