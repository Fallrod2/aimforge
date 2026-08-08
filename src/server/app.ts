import { Hono } from "hono";

/**
 * Application Hono. Exportée séparément du point d'entrée pour être
 * testable via `app.request()` sans ouvrir de socket.
 */
export const app = new Hono();

app.get("/api/health", (c) => c.json({ ok: true }));
