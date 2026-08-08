# AimForge

Hub d'entraînement Valorant mono-utilisateur, auto-hébergé. Trois modules qui partagent leurs
données :

- **Tracker Voltaic** — saisie des scores par scénario, énergie calculée (scénario / sous-catégorie /
  overall), rang atteint, badge « Complete », historique et graphes de progression.
- **Coach post-game** — colle tes stats de partie, l'IA rend un debrief structuré : ce qui a marché,
  axes de travail concrets.
- **Routine du jour** — à partir du temps disponible, des sous-catégories faibles du dernier bench et
  des axes des derniers debriefs, l'IA génère une session ciblée.

## Stack

Bun + Hono (API REST) · TypeScript strict · SQLite + Drizzle · React 18 + Vite + Tailwind ·
Recharts · Zod · `@anthropic-ai/sdk` (serveur uniquement) · Vitest · Biome.

## Démarrage

```sh
bun install
cp .env.example .env   # renseigner ANTHROPIC_API_KEY
bun dev                # API Hono (:3000) + client Vite (:5273)
```

## Commandes

| Commande            | Effet                                             |
| ------------------- | ------------------------------------------------- |
| `bun dev`           | serveur + client en parallèle                     |
| `bun run dev:server`| API Hono seule, en hot reload (`:3000`)           |
| `bun run dev:client`| client Vite seul (`:5273`, proxy `/api` → `:3000`)|
| `bun test`          | tests Vitest                                      |
| `bun run typecheck` | `tsc --noEmit`                                    |
| `bun run lint`      | `biome check`                                     |
| `bun run check`     | typecheck + lint + tests (à passer avant commit)   |
| `bun run build`     | typecheck + build client                          |

## Données

`voltaic-s5-data.json` (racine) est la **source de vérité métier** : seuils officiels des 3 paliers ×
18 scénarios, énergies d'ancrage, rangs overall et couleurs. Aucun seuil ne doit être écrit en dur
ailleurs ni « retrouvé de tête ».

La base SQLite vit dans `data/aimforge.db` (ignorée par git — c'est la donnée utilisateur, à
sauvegarder séparément).
