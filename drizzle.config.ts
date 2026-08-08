import { defineConfig } from "drizzle-kit";

// `bun run db:generate` écrit les migrations versionnées dans drizzle/ ;
// elles sont appliquées automatiquement à l'ouverture de la DB (db/client.ts).
export default defineConfig({
  dialect: "sqlite",
  schema: "./src/server/db/schema.ts",
  out: "./drizzle",
  dbCredentials: { url: "file:./data/aimforge.db" },
});
