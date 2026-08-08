import { createApp } from "./app";
import { openDatabase } from "./db/client";

const port = Number(process.env.PORT ?? 3000);

// Ouvre data/aimforge.db (créé au besoin) et applique les migrations en attente.
const app = createApp(openDatabase());

export default {
  port,
  fetch: app.fetch,
};
