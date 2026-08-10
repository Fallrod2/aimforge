-- Verrou multi-saison (SPEC §5 quinquies).
--
-- Les énergies de sous-catégories et le rang overall d'une passe sont dérivés
-- À LA LECTURE depuis le jeu de données Voltaic courant. Sans saison stockée,
-- publier la S6 réinterpréterait silencieusement tout l'historique S5. La
-- colonne fige l'appartenance d'une passe : une passe S5 restera lue avec les
-- seuils S5, pour toujours.
--
-- Toutes les passes existantes sont S5 par définition (le projet n'a jamais
-- connu d'autre jeu de données), d'où le `default` qui les estampille sans
-- rétro-migration de données.
alter table public.bench_runs
  add column season text not null default 'voltaic-s5'
  check (season ~ '^[a-z0-9-]+$');

-- L'historique et le graphe filtrent par saison : l'index de liste doit la
-- porter, sinon chaque page d'historique refiltrerait après coup.
create index bench_runs_user_season_date
  on public.bench_runs (user_id, season, date desc);
