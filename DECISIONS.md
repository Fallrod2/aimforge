# Décisions — chantier multi-benchmarks (2026-08-12)

Journal des arbitrages pris pendant le chantier, avec leur raison. Chaque entrée : contexte → décision → pourquoi.

## D1 — Branche de travail : `nuit-2026-08-12`, pas de push sur `main`
`main` déclenche le déploiement Vercel en production. Tout le travail du chantier
vit sur `nuit-2026-08-12` (créée depuis `phase-0-setup`), commits atomiques, à
relire puis merger. La migration DB est appliquée en mode expand/contract pour
que la production déployée continue de fonctionner d'ici là (voir D2).

## D2 — `benchmark_id` = généralisation de `season`, pas une colonne à côté
`bench_runs.season` (`voltaic-s5`) identifie déjà *le jeu de données qui relit la
passe* — c'est exactement la sémantique demandée pour `benchmark_id` (un
benchmark versionné : `voltaic-s5`, `viscose-…`). Deux colonnes porteraient la
même vérité et divergeraient. Décision : renommer `season` → `benchmark_id` (le
rename préserve les données, l'historique reste rattaché à `voltaic-s5`), et le
registre code passe de « saisons Voltaic » à « benchmarks » avec formule
d'énergie branchable. `palier` existe déjà (`bench_runs.tier`).

## D3 — Qualification des scénarios : par la passe, pas par une colonne dupliquée
`scenario_scores` est lié à `bench_runs` par `run_id`, et la passe porte
`benchmark_id` : un scénario homonyme entre deux benchmarks est donc déjà
désambiguïsé par jointure. Ajouter une colonne `benchmark_id` sur
`scenario_scores` dupliquerait une vérité et pourrait diverger de la passe
parente. Décision : pas de colonne dupliquée ; les requêtes « meilleur score par
scénario » joignent `bench_runs` (l'index existant `scenario_scores_run` +
`bench_runs_user_season_date` suffisent à l'échelle mono-utilisateur actuelle).
