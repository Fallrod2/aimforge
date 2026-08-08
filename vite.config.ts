import { fileURLToPath } from "node:url";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const apiPort = Number(process.env.PORT ?? 3000);

export default defineConfig({
  root: fileURLToPath(new URL("./src/client", import.meta.url)),
  plugins: [react(), tailwindcss()],
  server: {
    // Port dédié : 5173 est déjà pris par un autre projet sur cette machine.
    // strictPort pour échouer bruyamment plutôt que de glisser sur un port voisin
    // (le proxy pointerait alors vers la mauvaise API sans le dire).
    port: 5273,
    strictPort: true,
    // Le client parle à l'API Hono en dev sans CORS.
    proxy: { "/api": `http://localhost:${apiPort}` },
  },
  build: {
    outDir: fileURLToPath(new URL("./dist/client", import.meta.url)),
    emptyOutDir: true,
  },
});
