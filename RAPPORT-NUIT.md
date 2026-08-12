# Rapport de nuit — 2026-08-12

État à 09 h 15 (rapport maintenu en continu ; voir DECISIONS.md pour chaque arbitrage).
Branche : `nuit-2026-08-12` (aucun push sur `main` — D1). `bun run check` : VERT (1431 tests).

## Réalité du calendrier

La Vague 1 (architecture multi-benchmarks) a consommé la nuit entière : les
relectures adversariales ont pris plusieurs heures chacune. Les Vagues 2 à 5
sont entamées dans la matinée, dans l'ordre, tant que la session vit. Ce
rapport reflète toujours l'état réel au moment de sa dernière ligne.

## Vague 1 — Architecture multi-aim-trainers : FAITE (commits `662666f` → en cours)

### Fait et vérifié
- **Registre déclaratif de benchmarks** (`src/lib/energy/benchmarks.ts`) :
  métadonnées produit (nom, éditeur, saison, statut stable/beta/incomplete,
  source, date de version, aim trainer), formule d'énergie branchable
  (`formulas.ts`), grammaire de nommage pilotée par la donnée (`naming.ts` —
  plus de « VT » en dur), paliers ouverts validés par benchmark (`toTierId`).
  Le code de production ne contient plus un seul nom de scénario ni seuil en
  dur (inventaire exhaustif préalable + grep de contrôle).
- **Le cœur mathématique n'a pas bougé** : `energy.ts` byte-identique
  (SHA-256 vérifié). Audit adversarial indépendant en arithmétique rationnelle
  exacte : ~30 000 points comparés, 0 écart ; verrou de relecture prouvé
  (une passe archivée se relit toujours avec SES seuils).
- **Migrations SQL appliquées** au projet Supabase (données vérifiées après
  coup) : `bench_runs.benchmark_id` en expand/contract avec trigger de
  synchronisation (0017 appliquée ; **0018 à appliquer APRÈS déploiement**,
  instructions dans le fichier), `profiles.active_benchmark`, `profiles.game`,
  contrainte de palier généralisée (0019 appliquée). L'historique existant est
  rattaché à `voltaic-s5` sans perte (requête de contrôle exécutée) et la
  production déployée continue de fonctionner pendant la transition.
- **Sélecteur de benchmark** dans le profil (unique, sobre, désactivé tant
  qu'il n'y a qu'un benchmark visible) ; tracker, historique, contexte du
  coach suivent le benchmark actif ; les archives gardent leur barème.
- **Statut des barèmes affiché depuis le registre** (« Barème Voltaic S5 ·
  BETA · version du 8 août 2026 ») dans tracker et historique — plus de
  « seuils officiels » en dur (la landing dit désormais « telle que son
  éditeur la publie aujourd'hui (en bêta) »).
- **Couche jeu** : `profiles.game` (valorant/cs2/apex/overwatch/other) pilote
  uniquement le vocabulaire (libellés du profil, phrase d'identité des 5
  prompts IA). Testé jeu par jeu.
- **Marque découplée** : « AimForge » seul dans le header ; kicker landing
  générique « Entraînement aim · FPS compétitifs » ; le nom du benchmark
  n'apparaît que là où il est pertinent.
- **Viscose : intégré honnêtement en `incomplete`, masqué** (D8). Les seuils
  S2 (4 difficultés × 39 scénarios), rangs et couleurs officiels sont
  **vérifiés** (API officielle KovaaK's, 1248 valeurs recoupées, 0 écart,
  recoupement spreadsheet S1) et versionnés dans `viscose-s2-data.json`. Ce
  qui manque et qui interdit l'activation : la **formule officielle
  d'agrégation du rang global Viscose n'est documentée nulle part** — aucune
  valeur inventée, TODO explicite dans le registre. Bonus de la recherche :
  l'API `player-progress-rank-benchmark` de kovaaks.com expose ~117
  benchmarks complets (Revosect, Aimerz+, …) — intégrations futures faciles.

### Vérifications de vague
- 2 revues adversariales (diffs W1-A et W1-B) : APPROVE après 1 finding réel
  (faux positif sandbox documenté D9) ; 2 audits du moteur d'énergie :
  « aucun écart » / « non réfuté ».
- Correctifs latents des audits appliqués et prouvés par tests rouges→verts
  (deps de memos TrackerView, cohérence calcul/estampillage bench-runs).
- Captures d'écran de contrôle : à faire en clôture de vague (ui-reviewer).

### Points ouverts assumés (Vague 1)
- `api/kovaaks/import.ts` et le contrat linked-accounts valident contre le
  benchmark par défaut : sans conséquence tant qu'un seul benchmark est
  importable ; à étendre avec le second (commenté dans le code).
- Migration 0018 (drop de l'ancienne colonne) : à appliquer après déploiement.
- Divergence à vérifier (préexistante) : `voltaic-s5-data.json` porte
  `kovaaksBenchmarkId` 459/458/460 alors que le registre utilise 432/431/427
  (« Tammas ») pour l'import — le catalogue public relevé cette nuit indique
  459/458/460 pour Voltaic S5. L'import fonctionne aujourd'hui avec 432/431/427
  d'après l'historique du produit ; je n'ai PAS pu tester un import réel
  (compte KovaaK's requis). À trancher avec un import réel avant de toucher.

## Vague 2 — Navigation 3 sections : FAITE (commits `87fc2f3`)

- Accueil / Perfs (segments Saisie·Historique portés par l'URL) / Coach
  (routine du jour + fil) ; profil par l'icône du header ; bloc Valorant sur
  l'Accueil seulement si compte Riot lié, détail de match sur
  `#/accueil?match=` ; barre mobile 3 cibles ≥ 44 px.
- Redirections testées une par une depuis les 5 anciennes URLs (TDD), zéro
  lien orphelin (grep), Recharts toujours hors du bundle initial (vérifié sur
  le build). Revue adversariale : APPROVE. Tableau complet des interactions
  dans le rapport de l'agent ; deux chemins à 3 clics assumés (D10).
- Vérification visuelle : redirections et écrans publics validés ; la passe
  authentifiée a été interrompue deux fois (incident D12 puis limite de
  session) — relancée, résultat attendu.

## Vague 3 — Crédibilité : EN COURS (13 h)

- **3.1 Français IA** : cause racine identifiée et documentée (D11) — la prod
  sert `deepseek/deepseek-v4-flash-0731` via OpenRouter. Mesure réelle sur ce
  chemin : routine 7/20 sans faute, fil 16/20 ; analyse sur pièces : la vraie
  faute est le motif « citation en position sujet » (« [HS% 25.1] est »),
  le reste = faux positifs du détecteur (impératifs, imparfait, phrases
  nominales). Détecteur recalibré (0 faux positif sur les deux campagnes,
  fautes réelles conservées) ; durcissement ciblé du prompt routine en cours,
  puis re-mesure ×20. Découverte annexe à traiter : 2/20 routines en JSON
  invalide et 1/20 en budget de raisonnement — fiabilité de prod, pas du
  français.
- **3.6 Templates email FR** : faits (commit `7074f0e`), à appliquer via le
  README de `supabase/templates/`.
- **3.2 Statut des barèmes** : fait en Vague 1 (affiché depuis le registre).
- **3.4 Quotas** et **3.5 Pages légales + consentement** : agents relancés
  après l'interruption de 12 h (limite de session), en cours.
- **3.3 Promesses d'import** et **3.7 Métadonnées/OG** : à faire.

## Incidents de la matinée

- **Limite de session à ~11 h** : quatre agents interrompus en vol, travail
  repris à 13 h sans perte (l'arbre portait l'état intermédiaire du seul
  agent qui écrivait).
- **D12** : l'authentification du compte de test a cassé (500) après sa
  création par INSERT — colonnes tokens NULL. Confiné au compte de test,
  les comptes réels vérifiés sains ; corrigé, login re-testé 200.

## Vagues 4 et 5 : non entamées à ce stade.

## Templates email (Vague 3.6, fait en avance car sans conflit)
`supabase/templates/` : 5 templates FR aux couleurs AimForge (contrastes
mesurés ≥ 4,5:1, lisibles sur fond forcé blanc) + README d'application
(Dashboard et API de gestion). Non appliqués au projet Supabase (accès
dashboard requis) — procédure pas à pas fournie.

## Ce que je n'ai pas pu vérifier
- Envoi réel des emails (aucun envoi possible d'ici) ; rendu Outlook desktop.
- Import KovaaK's réel (compte requis) — cf. divergence d'IDs ci-dessus.
- L'application de la migration 0018 (volontairement différée).
