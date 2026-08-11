-- Multi-benchmarks, étape « contract » — NE PAS APPLIQUER avant que le client
-- issu de la branche nuit-2026-08-12 soit déployé en production (il n'écrit et
-- ne lit plus que `benchmark_id`). Une fois le déploiement constaté :
--
--   1. vérifier qu'aucune ligne ne diverge :
--        select count(*) from public.bench_runs where benchmark_id <> season;
--      (doit rendre 0 — le trigger l'a garanti) ;
--   2. appliquer ce fichier.

drop trigger bench_runs_sync_benchmark_id on public.bench_runs;
drop function public.sync_bench_run_benchmark_id();

drop index public.bench_runs_user_season_date;

alter table public.bench_runs drop column season;
