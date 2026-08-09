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

Application **statique + Supabase**, plus une poignée de fonctions serverless pour l'IA. Il n'y a
pas de serveur applicatif à faire tourner : le client parle directement à Postgres, et c'est la RLS
qui isole les comptes. Les fonctions (`api/`) n'existent que parce qu'une clé Anthropic ne peut pas
vivre dans un navigateur.

| Couche       | Choix                                                                       |
| ------------ | --------------------------------------------------------------------------- |
| Front        | React 18 + Vite + Tailwind v4 + Recharts, TypeScript strict                  |
| Hébergement  | Vercel (build statique, déploiement automatique au push)                     |
| Données      | Supabase Postgres via `@supabase/supabase-js`, **RLS stricte** sur toutes les tables |
| Auth         | Supabase Auth : Discord, Google, email + mot de passe (flux PKCE)            |
| IA           | Vercel Functions (`api/`) — seules détentrices de `ANTHROPIC_API_KEY`, JWT + quota vérifiés |
| Moteur métier| `src/lib/energy/` : lib pure, sans dépendance ni I/O, 100 % testée           |

Le calcul d'une passe (`computeBenchRun`) vit dans la lib pure : l'aperçu live du tracker et
l'écriture en base appellent la même fonction, donc les deux ne peuvent pas diverger.

## Démarrage

```sh
bun install
bun dev            # client Vite sur http://localhost:5273
```

Rien d'autre : pas de base locale à provisionner, pas de `.env` requis pour travailler sur le
client. Les coordonnées du projet Supabase (URL + clé publiable) sont volontairement en dur dans
`src/shared/supabase-config.ts` — elles sont publiques par conception, ce qui protège les données
c'est la RLS. Les vrais secrets (`ANTHROPIC_API_KEY`, `SUPABASE_SERVICE_ROLE_KEY`) n'existent que
dans l'environnement Vercel des fonctions serverless (gabarit : `.env.example`).

**`bun dev` ne sert que le client** : rien ne répond derrière `/api/coach`, et la vue Coach affiche
l'erreur en conséquence. Pour exercer les fonctions en local :

```sh
cp .env.example .env.local   # puis remplir les deux clés
bunx vercel dev --listen 3210
```

Sans les clés, `POST /api/coach` répond `503 {"error":"IA non configurée"}` — c'est le comportement
attendu, pas une panne.

## Commandes

| Commande            | Effet                                            |
| ------------------- | ------------------------------------------------ |
| `bun dev`           | client Vite en hot reload (`:5273`)              |
| `bun test`          | tests Vitest                                     |
| `bun run typecheck` | `tsc --noEmit`                                   |
| `bun run lint`      | `biome check`                                    |
| `bun run check`     | typecheck + lint + tests (à passer avant commit)  |
| `bun run build`     | typecheck + build statique dans `dist/client`     |
| `bunx vercel dev`   | client **+ fonctions `api/`** (nécessite `.env.local`) |

## Coach post-game (`api/coach`)

`POST /api/coach`, `Authorization: Bearer <jwt supabase>`, corps `{ "stats": "…" }` (8 000
caractères au maximum). Réponse : `{ debrief: { id, date, resume, points_forts[], axes: [{titre,
detail}], focus }, remaining }`.

La fonction est le seul détenteur des secrets, et le seul endroit du projet où la service key est
utilisée — uniquement pour incrémenter le quota (5 debriefs / jour / utilisateur, UTC) via
`public.increment_ai_usage`, dont l'exécution est réservée à `service_role`. Tout le reste (profil,
dernier bench, écriture du debrief) passe par le JWT de l'appelant, donc sous RLS.

Les schémas Zod du contrat vivent dans `src/shared/coach-contract.ts` : la fonction valide avec eux
la sortie du modèle, le client valide avec les mêmes ce qu'il reçoit et ce qu'il relit en base. La
logique testable (prompt, parsing, relance corrective, quota, résumé du bench) est en modules purs
dans `src/server/coach/`.

Codes de retour : `401` sans JWT valide · `400`/`413` entrée vide ou trop longue · `503` clés
absentes (`IA non configurée`) · `429` quota atteint · `502` sortie hors contrat après relance.
La fonction est exportée en `export async function POST(request: Request)` : c'est la seule forme
que le runtime Node de Vercel traite comme un gestionnaire web (un `export default` reçoit la
signature historique `(req, res)` et casse à la première requête).

**Pré-remplir le formulaire depuis ailleurs** (un match importé, par exemple) : déposer le texte
puis naviguer vers `#/coach`. Le message est consommé au montage de la vue, une seule fois.

```ts
import { setCoachPrefill } from "./coach/prefill";

setCoachPrefill(resumeDuMatch);
navigate({ view: "coach", runId: null });
```

`CoachView` accepte aussi une prop `initialStats` pour un usage direct.

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
