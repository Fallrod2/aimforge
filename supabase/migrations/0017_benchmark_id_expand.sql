-- Multi-benchmarks, étape « expand » (appliquée au projet Supabase aimforge
-- le 2026-08-12 via MCP ; copie de référence versionnée).
--
-- `bench_runs.season` identifie déjà le jeu de données qui relit une passe
-- (« voltaic-s5 ») : c'est exactement la sémantique de `benchmark_id`. On ne
-- crée donc pas une seconde vérité, on renomme — mais en deux temps
-- (expand/contract), parce que le client déployé lit et écrit encore `season` :
-- un rename sec casserait la production jusqu'au prochain déploiement.
--
-- Étape 1 (ce fichier, appliquée) : `benchmark_id` est ajoutée, remplie depuis
-- `season`, et un trigger garde les deux colonnes identiques quel que soit le
-- client qui écrit (ancien code → season, nouveau code → benchmark_id).
-- Étape 2 (0018, à appliquer APRÈS déploiement du nouveau client) : suppression
-- de `season` et du trigger.
--
-- Le palier demandé par la spec existe déjà : c'est `bench_runs.tier`.

alter table public.bench_runs
  add column benchmark_id text;

update public.bench_runs set benchmark_id = season;

alter table public.bench_runs
  alter column benchmark_id set not null;
alter table public.bench_runs
  alter column benchmark_id set default 'voltaic-s5';
alter table public.bench_runs
  add constraint bench_runs_benchmark_id_check check (benchmark_id ~ '^[a-z0-9-]+$');

-- Un seul écrivain gagne : `benchmark_id` s'il est fourni (nouveau client),
-- sinon `season` (ancien client) ; l'autre colonne est alignée dans tous les
-- cas. Les deux colonnes sont donc indiscernables en lecture.
create function public.sync_bench_run_benchmark_id()
returns trigger
language plpgsql
security definer set search_path = ''
as $$
begin
  new.benchmark_id := coalesce(new.benchmark_id, new.season);
  new.season := new.benchmark_id;
  return new;
end;
$$;

create trigger bench_runs_sync_benchmark_id
  before insert or update on public.bench_runs
  for each row execute procedure public.sync_bench_run_benchmark_id();

-- L'historique filtre par benchmark : même rôle que bench_runs_user_season_date.
create index bench_runs_user_benchmark_date
  on public.bench_runs (user_id, benchmark_id, date desc);
