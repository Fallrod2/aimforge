# TODO

## Findings de la revue high du 2026-08-12 (10, vérifiés indépendamment)

Bugs actifs, par gravité :
1. [ ] `src/client/coach/thread-generation.ts:39` (+ `generation-store.ts:92`) —
   réinitialiser les stores de génération à la déconnexion (fuite du contenu
   IA d'un compte vers le suivant dans le même onglet).
2. [ ] `src/client/components/useConfirm.ts:196` — une suppression confirmée
   doit survivre à F5/fermeture d'onglet pendant la fenêtre d'annulation
   (commit sur `pagehide` en plus du démontage).
3. [ ] `src/client/history/HistoryView.tsx:311` — l'échec serveur d'une
   suppression différée commitée au démontage est avalé (setDeleteError sur
   composant démonté) ; l'erreur doit resurgir quelque part.
4. [ ] `api/coach.ts:379` (+ `scenarios.ts:69`, `coach-context.ts:138`) —
   `scenarioCatalog` doit être qualifié par le benchmark actif de
   l'utilisateur côté serveur (aujourd'hui : benchmark par défaut de la lib) ;
   et `loadContext` doit entrer dans la fenêtre de remboursement du quota.
5. [ ] `api/routine.ts:510` (+ coach:549, coach-chat:318, coach-thread:209) —
   un échec de parse du compteur APRÈS incrément réussi doit rembourser
   (construire le refund avant le parse).

Latents (s'activent avec un 2ᵉ benchmark ou du volume) :
6. [ ] `api/kovaaks/import.ts:110` — l'import serveur doit résoudre le
   benchmark actif du profil, pas `currentBenchmark()` (jamais synchronisé
   côté serveur) ; à faire porter par le contrat de requête.
7. [ ] `api/_lib/match-analysis.ts:90` — brancher le budget modèle partagé
   (2 × 25 s sous maxDuration 60 s = le bug pré-V4-C) et ajouter
   `api/valorant/match.ts` au miroir de timings.
8. [ ] `src/client/data/bench-runs.ts:277` — paginer `listScenarioScores`
   (plafond PostgREST 1000 lignes = export CSV tronqué en silence).

Nettoyages :
9. [ ] Factoriser le câblage du budget modèle (4 copies → helper dans
   `api/_lib/model-budget.ts`).
10. [ ] Factoriser `failWithQuota`/`usageCountSchema` (5 copies →
    `api/_lib/request.ts`), en préservant « remaining omis, jamais null ».

## Reste à faire hors findings (voir RAPPORT-NUIT.md pour le détail)

- [ ] Appliquer la migration `0018` (drop de `season`) APRÈS avoir constaté le
  déploiement du nouveau client — instructions dans le fichier.
- [ ] Appliquer les templates email FR (`supabase/templates/README.md`).
- [ ] Relecture juridique des 3 pages légales ; coordonnées d'hébergeurs.
- [ ] Vérifier la clé HenrikDev en prod ; trancher la divergence d'IDs de
  benchmarks KovaaK's (459/458/460 vs 432/431/427) par un import réel.
- [ ] Routing history + prerender de la landing (D17) ; `trailingSlash` ;
  redirection `/connexion`.
- [ ] Bordures de champs (1,43:1) et `disabled:opacity-50` préexistants ;
  `text-ember-300` (classe morte) ; visibilité du toast Annuler depuis
  l'autre onglet de Perfs.
- [ ] Budget de jetons face aux non-livraisons `reasoning_budget` (1/20) ;
  envisager un modèle plateforme au français plus sûr (mesures dans le
  rapport). `chat_daily` en réglage de plateforme.
- [ ] Partage coach↔élève : à concevoir (implications RLS) — voir DECISIONS.md.
