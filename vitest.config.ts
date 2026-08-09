import { defineConfig } from "vitest/config";

// Config séparée de vite.config.ts : celui-ci a `root` sur src/client,
// ce qui empêcherait vitest de découvrir les tests de `src/lib`.
export default defineConfig({
  test: {
    // `api/**` est inclus depuis que les écritures de `ai_settings` ont leurs
    // propres tests (bascule de fournisseur : le contrat et la base laissaient
    // chacun passer ce que l'autre croyait vérifier).
    include: ["src/**/*.test.ts", "src/**/*.test.tsx", "api/**/*.test.ts"],
    environment: "node",
  },
});
