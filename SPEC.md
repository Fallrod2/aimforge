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

## 5 bis. Comptes liés & import automatique (acté 2026-08-09)

**Principe produit : la donnée rentre toute seule.** La saisie manuelle existe
toujours mais devient un repli discret — l'app guide vers la liaison de comptes
(onboarding, états vides, dashboard), jamais l'inverse. Lier son compte doit
paraître naturel et gratifiant, pas une corvée de configuration.

- **Comptes Riot** : liaison par Riot ID (`Nom#TAG`), PLUSIEURS comptes possibles
  (principal + alts), stockés dans `linked_accounts`. Pas de login Riot (RSO
  inaccessible sans approbation) : les données publiques suffisent.
- **Données Valorant** : API HenrikDev (non officielle, mature) appelée UNIQUEMENT
  côté serveur (clé `HENRIKDEV_API_KEY` en env Vercel), avec cache en base
  (`imported_matches`) et dégradation propre si l'API casse. MMR, historique de
  rang, détails des derniers matchs par compte lié.
- **Compte KovaaK's** : liaison par pseudo KovaaK's ; import des scores de
  scénarios Voltaic via l'API du Benchmark Tracker kovaaks.com (non officielle,
  instable : cache, retries, dégradation). Le tracker propose « Importer mes
  scores » qui pré-remplit les 18 champs ; l'utilisateur vérifie puis
  sauvegarde. La saisie manuelle reste disponible mais visuellement secondaire.
- **Pont vers l'IA** : le Coach peut débriefer un match importé (pré-remplissage
  de son entrée depuis `imported_matches`) ; la Routine lit les vrais benchs.
- Dépendances externes isolées chacune derrière un module serveur unique,
  remplaçables (ex. migration future vers l'API officielle Riot) sans toucher l'UI.

## 5 ter. Réglages IA par utilisateur (acté 2026-08-09)

Chaque utilisateur peut configurer SON provider IA dans les réglages (page
Profil ou section dédiée), sur le modèle d'un sélecteur provider + modèle +
clé, avec « Tester la connexion » :

- **Par défaut** (aucune config) : la clé Anthropic de la plateforme, quota
  5 debriefs + 5 routines/jour (inchangé). Configurer son propre provider
  **lève le quota** (l'utilisateur paie ses propres jetons).
- **Providers v1** : Anthropic, OpenRouter, OpenAI-compatible (URL de base +
  clé — couvre OpenAI, Ollama distant, vLLM…), Mistral, ChatGPT (subscription)
  — ce dernier marqué Expérimental avec avertissement (dépend de la tolérance
  d'OpenAI, peut cesser de fonctionner).
- **ChatGPT (subscription) ne prend PAS de clé** : c'est une **liaison de
  compte** (flux OAuth du Codex CLI, comme engram) — bouton « Lier mon compte
  ChatGPT », l'utilisateur autorise chez OpenAI, les jetons (accès + refresh)
  sont stockés côté serveur dans le même champ write-only et rafraîchis par les
  fonctions ; l'UI affiche « Compte lié » et un bouton « Délier ». Référence
  d'implémentation : le code engram (`apps/web/src/features/ai/codex-link-*`
  et son pendant serveur).
- **Stockage des clés** : côté serveur uniquement, jamais réaffichées après
  enregistrement (write-only pour le client — le même verrou de privilèges de
  colonne que `linked_accounts`), lisibles seulement par les fonctions
  serverless (service role). Suppression possible à tout moment.
- **Abstraction** : les fonctions coach/routine passent par un port unique
  (le `AskModel` existant) ; chaque provider est un adaptateur derrière ce
  port. La sortie reste du JSON strict validé Zod quel que soit le provider.
- Le « Tester la connexion » consomme un mini-appel et rend un verdict clair
  sans jamais renvoyer la clé.

## 5 quater. Panneau d'administration (acté 2026-08-09)

Section « Administration » dans l'app, visible et utilisable uniquement par les
admins (table `platform_admins`, amorcée avec le compte fondateur). Tout ce qui
se gérait par variables d'environnement devient géré en base — À L'EXCEPTION de
`SUPABASE_SERVICE_ROLE_KEY`, identifiant d'infrastructure qui reste dans Vercel.

- **Config IA plateforme** : provider + modèle + clé servis aux utilisateurs
  sans config perso — même machinerie que les réglages perso (§5 ter), portée
  plateforme. Repli sur `ANTHROPIC_API_KEY` d'environnement si non configurée.
- **Clé HenrikDev** : gérée en base, repli sur l'env. Rotation sans redéploiement.
- **Quotas ajustables** : les limites journalières (debriefs, routines, imports
  KovaaK's, liaisons Riot) deviennent des réglages modifiables en direct ;
  les constantes actuelles deviennent les valeurs par défaut.
- **Tableau d'usage + plafond global** : agrégats de consommation (IA et
  imports, tous utilisateurs, sans données personnelles au-delà du nécessaire)
  et plafond global journalier d'appels IA plateforme — au-delà, refus propre
  pour tout le monde (les configs perso ne sont pas concernées : chacun paie
  ses jetons).
- Sécurité : vérification d'admin CÔTÉ SERVEUR dans chaque endpoint admin (la
  visibilité UI n'est qu'un confort) ; secrets write-only (privilèges de
  colonne, patron §5 ter) ; lecture des secrets réservée au service role.

## 6. Sécurité

- RLS activé sur toutes les tables, policies testées (un utilisateur A ne voit jamais les données de B).
- `ANTHROPIC_API_KEY` et `SUPABASE_SERVICE_ROLE_KEY` : uniquement en variables d'environnement Vercel (serverless), jamais dans le bundle client.
- Le client n'embarque que `SUPABASE_URL` + `SUPABASE_ANON_KEY` (publiques par conception, protégées par RLS).
- Validation Zod aux frontières des fonctions IA (entrées ET sorties).

## 7. Phases de livraison v2

- **P1 — Socle Supabase** : projet Supabase, schéma + RLS + trigger profiles, client typé, auth complète (Discord, Google, email), landing + garde d'authentification, layout app + dashboard squelette.
- **P2 — Migration Tracker** : Tracker Phase 3 branché sur Supabase (saisie live inchangée, sauvegarde/historique/graphe), suppression de l'API Hono CRUD et de SQLite.
- **P3a — Coach IA** (parallèle à P3b) : fonction serverless `api/coach` (JWT + quota + Zod), UI debrief + historique. Entrée v1 = texte collé ; conçue pour être pré-remplie depuis un match importé dès que P3b livre.
- **P3b — Comptes liés & import** (parallèle à P3a) : schéma `linked_accounts` + `imported_matches` (+ `bench_runs.source`), fonctions serverless HenrikDev et KovaaK's, UI de liaison (profil + onboarding), import de bench pré-rempli, rang/MMR sur le dashboard.
- **P4 — Routine IA** : fonction `api/routine` (faiblesses dernier bench + axes des 3 derniers debriefs), UI avec cases à cocher.
- **P5 — Dashboard complet & polish** : synthèse réelle, états vides soignés, responsive final, revue sécurité (RLS, quotas, secrets).

Périmètres P3a/P3b disjoints : P3a possède `api/coach.ts`, `src/shared/coach-contract.ts`, `src/client/coach/**`, `src/client/data/debriefs.ts` ; P3b possède les migrations, `api/valorant|kovaaks/**`, `src/client/data/linked-accounts*`, le profil, le tracker et le dashboard. Conflits arbitrés par l'orchestrateur au merge.

Chaque phase : `bun run check` vert, revue adversariale, commit, push (→ déploiement auto).

## 8. Hors périmètre v2

Riot OAuth (en attente d'approbation RSO — la liaison par Riot ID le remplace),
scraping Tracker.gg, app mobile native, partage public de profils, classements
entre utilisateurs.
