# AimForge — Spécification v2 (plateforme multi-utilisateurs)

> Pivot acté le 2026-08-08. Remplace l'architecture v1 (mono-utilisateur, SQLite,
> auto-hébergé). La logique métier Voltaic (moteur d'énergie, `src/lib/energy/`)
> et l'UI Tracker restent la base — seules l'authentification, la persistance et
> la structure générale changent.

## 1. Vision

Plateforme web publique d'entraînement Valorant/KovaaK's. Chaque joueur crée un
compte et retrouve trois outils qui partagent leurs données :

1. **Tracker Voltaic** — saisie des benchs S5, énergie/rang/complete, historique, progression.
2. **Coach post-game** — debrief IA structuré à partir des stats de partie collées.
3. **Routine du jour** — session générée par IA à partir des faiblesses mesurées + axes des debriefs.

Le fil rouge est inchangé : bench + debriefs alimentent la routine.

## 2. Architecture cible

| Couche | Choix |
|---|---|
| Front | React 18 + Vite + Tailwind v4, hébergé sur Vercel (statique) |
| Données | Supabase Postgres, accès direct depuis le client via `@supabase/supabase-js`, RLS strict |
| Auth | Supabase Auth : Discord OAuth, Google OAuth, email + mot de passe (Riot/RSO différé : soumis à approbation Riot, non supporté nativement par Supabase) |
| IA | Endpoints serverless Vercel (`api/coach`, `api/routine`) — seuls détenteurs de `ANTHROPIC_API_KEY` ; vérifient le JWT Supabase et le quota avant chaque appel |
| Moteur d'énergie | `src/lib/energy/` inchangé, importé côté client (calcul live) et côté fonctions IA (résumé bench) |

Ce qui disparaît : l'API CRUD Hono, SQLite/Drizzle, le déploiement Mac mini/launchd.
Les schémas Zod des contrats IA restent (validation des réponses Anthropic).

## 3. Modèle de données (Postgres + RLS)

Toutes les tables portent `user_id uuid references auth.users` ; RLS : chaque
utilisateur ne lit/écrit que ses lignes (`auth.uid() = user_id`).

- `profiles` (user_id PK, pseudo, rang_valorant, peak, main_agent, objectif, notes_maps, created_at)
  — créée automatiquement à l'inscription (trigger sur `auth.users`).
- `bench_runs` (id, user_id, date, tier, overall, rank, complete, created_at)
- `scenario_scores` (id, run_id FK cascade, scenario, score, energy)
- `debriefs` (id, user_id, date, input_raw, resume, points_forts jsonb, axes jsonb, focus)
- `routines` (id, user_id, date, duree_minutes, focus, contenu jsonb, done)
- `ai_usage` (user_id, day, coach_count, routine_count) — support du quota.

Les énergies restent calculées côté client à l'écriture (lib pure) ; les
fonctions IA relisent les données via le client Supabase **avec le JWT de
l'utilisateur** (jamais la service key pour les lectures métier).

## 4. Quota IA (obligatoire avant ouverture publique)

- Par utilisateur et par jour (UTC) : **5 debriefs coach, 5 routines** (valeurs par défaut, ajustables).
- Compteur incrémenté côté serveur (fonction IA) via la service key, AVANT l'appel Anthropic ; refus propre (`429`) au-delà.
- Modèle : `claude-sonnet-4-6`, réponses JSON strictes validées Zod, une relance corrective max.

## 5. Structure de l'application

- **Landing publique** (`/`) : présentation courte + connexion/inscription.
- **App authentifiée** :
  - **Dashboard** (accueil post-login) : dernier bench (rang, overall, badge), 3 sous-catégories les plus faibles, routine du jour (ou CTA « générer »), dernier debrief, navigation permanente.
  - **Tracker** : l'UI Phase 3 existante, rebranchée sur Supabase.
  - **Coach** : formulaire de collage de stats → debrief structuré + historique.
  - **Routine** : génération (durée + focus optionnel), cases à cocher, « marquer comme faite », historique.
  - **Profil** : infos joueur + préférences.
- Navigation : header + onglets (desktop), bottom bar (mobile). Mobile-first inchangé.
- Direction visuelle inchangée : thème forge sombre, accent braise parcimonieux, énergie en mono, couleurs de rang officielles du JSON.

## 6. Sécurité

- RLS activé sur toutes les tables, policies testées (un utilisateur A ne voit jamais les données de B).
- `ANTHROPIC_API_KEY` et `SUPABASE_SERVICE_ROLE_KEY` : uniquement en variables d'environnement Vercel (serverless), jamais dans le bundle client.
- Le client n'embarque que `SUPABASE_URL` + `SUPABASE_ANON_KEY` (publiques par conception, protégées par RLS).
- Validation Zod aux frontières des fonctions IA (entrées ET sorties).

## 7. Phases de livraison v2

- **P1 — Socle Supabase** : projet Supabase, schéma + RLS + trigger profiles, client typé, auth complète (Discord, Google, email), landing + garde d'authentification, layout app + dashboard squelette.
- **P2 — Migration Tracker** : Tracker Phase 3 branché sur Supabase (saisie live inchangée, sauvegarde/historique/graphe), suppression de l'API Hono CRUD et de SQLite.
- **P3 — Coach IA** : fonction serverless `api/coach` (JWT + quota + Zod), UI debrief + historique.
- **P4 — Routine IA** : fonction `api/routine` (faiblesses dernier bench + axes des 3 derniers debriefs), UI avec cases à cocher.
- **P5 — Dashboard complet & polish** : synthèse réelle, états vides soignés, responsive final, revue sécurité (RLS, quotas, secrets).

Chaque phase : `bun run check` vert, revue adversariale, commit, push (→ déploiement auto).

## 8. Hors périmètre v2

Riot OAuth (en attente d'approbation RSO), scraping Tracker.gg, app mobile native,
partage public de profils, classements entre utilisateurs.
