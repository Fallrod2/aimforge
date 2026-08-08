import { fileURLToPath } from "node:url";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  root: fileURLToPath(new URL("./src/client", import.meta.url)),
  plugins: [react(), tailwindcss()],
  server: {
    // Port dédié : 5173 est déjà pris par un autre projet sur cette machine.
    // strictPort pour échouer bruyamment plutôt que de glisser sur un port
    // voisin sans le dire.
    port: 5273,
    strictPort: true,
    // Aucun proxy : depuis P2 le client parle directement à Supabase (CORS
    // ouvert côté projet), il n'y a plus d'API locale à joindre.
  },
  build: {
    outDir: fileURLToPath(new URL("./dist/client", import.meta.url)),
    emptyOutDir: true,
  },
});
