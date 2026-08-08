import { Hono } from "hono";
import { EnergyError } from "../lib/energy";
import { benchRunRoutes } from "./api/bench-runs";
import { profileRoutes } from "./api/profile";
import type { AppDatabase } from "./db/client";

/**
 * Routes sans persistance. Exportées séparément pour être testables via
 * `app.request()` sans base ni socket — y compris sous vitest (Node), qui ne
 * sait pas charger `bun:sqlite`.
 */
export const app = new Hono().get("/api/health", (c) => c.json({ ok: true }));

/**
 * L'application complète : les routes ci-dessus plus l'API persistée.
 * La base est injectée (fichier en dev/prod, `:memory:` dans les tests).
 */
export function createApp(db: AppDatabase): Hono {
  return new Hono()
    .route("/", app)
    .route("/api/bench-runs", benchRunRoutes(db))
    .route("/api/profile", profileRoutes(db))
    .onError((error, c) => {
      // Filet de sécurité : les entrées sont déjà validées en amont, une
      // EnergyError qui remonte reste une saisie refusée, pas une panne.
      if (error instanceof EnergyError) return c.json({ error: error.message }, 400);

      console.error(error);
      return c.json({ error: "Erreur interne" }, 500);
    });
}
