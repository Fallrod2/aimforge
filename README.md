# AimForge

Plateforme web d'entraînement Valorant / KovaaK's. Chaque joueur crée un compte et retrouve trois
modules qui partagent leurs données :

- **Tracker Voltaic** — saisie des scores par scénario, énergie calculée (scénario / sous-catégorie /
  overall), rang atteint, badge « Complete », historique et courbes de progression.
- **Coach post-game** — colle tes stats de partie, l'IA rend un debrief structuré : ce qui a marché,
  axes de travail concrets, focus du lendemain.
- **Routine du jour** — à partir du temps disponible, des sous-catégories faibles du dernier bench et
  des axes des derniers debriefs, l'IA génère une séance ciblée.

Le fil rouge : le bench mesure, les debriefs qualifient, la routine décide quoi travailler.

## Architecture

Application **100 % statique + Supabase**. Il n'y a pas de serveur applicatif à faire tourner : le
client parle directement à Postgres, et c'est la RLS qui isole les comptes.

| Couche       | Choix                                                                       |
| ------------ | --------------------------------------------------------------------------- |
| Front        | React 18 + Vite + Tailwind v4 + Recharts, TypeScript strict                  |
| Hébergement  | Vercel (build statique, déploiement automatique au push)                     |
| Données      | Supabase Postgres via `@supabase/supabase-js`, **RLS stricte** sur toutes les tables |
| Auth         | Supabase Auth : Discord, Google, email + mot de passe (flux PKCE)            |
| IA (P3/P4)   | Vercel Functions — seules détentrices de `ANTHROPIC_API_KEY`, JWT + quota vérifiés |
| Moteur métier| `src/lib/energy/` : lib pure, sans dépendance ni I/O, 100 % testée           |

Le calcul d'une passe (`computeBenchRun`) vit dans la lib pure : l'aperçu live du tracker et
l'écriture en base appellent la même fonction, donc les deux ne peuvent pas diverger.

## Démarrage

```sh
bun install
bun dev            # client Vite sur http://localhost:5273
```

Rien d'autre : pas de base locale à provisionner, pas de `.env` requis pour le développement. Les
coordonnées du projet Supabase (URL + clé publiable) sont volontairement en dur dans
`src/client/supabase/config.ts` — elles sont publiques par conception, ce qui protège les données
c'est la RLS. Les vrais secrets (`ANTHROPIC_API_KEY`, `SUPABASE_SERVICE_ROLE_KEY`) n'existent que
dans l'environnement Vercel des fonctions serverless.

## Commandes

| Commande            | Effet                                            |
| ------------------- | ------------------------------------------------ |
| `bun dev`           | client Vite en hot reload (`:5273`)              |
| `bun test`          | tests Vitest                                     |
| `bun run typecheck` | `tsc --noEmit`                                   |
| `bun run lint`      | `biome check`                                    |
| `bun run check`     | typecheck + lint + tests (à passer avant commit)  |
| `bun run build`     | typecheck + build statique dans `dist/client`     |

## Base de données

Le schéma versionné vit dans `supabase/migrations/` (copie de référence des migrations appliquées au
projet Supabase). Tables : `profiles`, `bench_runs`, `scenario_scores`, `debriefs`, `routines`,
`ai_usage`. Toutes portent `user_id` et une policy `auth.uid() = user_id` ; `profiles` est créée
automatiquement à l'inscription par un trigger sur `auth.users`.

Les types TypeScript de la base sont générés dans `src/client/supabase/database-types.ts` et ne sont
pas édités à la main.

## Données métier

`voltaic-s5-data.json` (racine) est la **source de vérité métier** : seuils officiels des 3 paliers ×
18 scénarios, énergies d'ancrage, rangs overall et couleurs. Aucun seuil ne doit être écrit en dur
ailleurs ni « retrouvé de tête ». Les énergies stockées en base sont figées au moment de la saisie ;
les énergies par sous-catégorie sont, elles, dérivées à la lecture.

## Déploiement

Push sur la branche suivie → Vercel construit (`bun run build`) et publie `dist/client`. Aucune étape
manuelle, aucun serveur à redémarrer.
