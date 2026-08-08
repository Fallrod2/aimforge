import { defineConfig } from "vitest/config";

// Config séparée de vite.config.ts : celui-ci a `root` sur src/client,
// ce qui empêcherait vitest de découvrir les tests serveur et lib.
export default defineConfig({
  test: {
    include: ["src/**/*.test.ts", "src/**/*.test.tsx"],
    environment: "node",
  },
});
