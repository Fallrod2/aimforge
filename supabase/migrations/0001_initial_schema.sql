-- Migration appliquée au projet Supabase aimforge (xmwdoasyigowvutvmhkl)
-- le 2026-08-08 via l'API de gestion. Copie de référence versionnée.

-- Profils : une ligne par utilisateur, créée automatiquement à l'inscription.
create table public.profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  pseudo text,
  rang_valorant text,
  peak text,
  main_agent text,
  objectif text,
  notes_maps text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = ''
as $$
begin
  insert into public.profiles (user_id, pseudo)
  values (
    new.id,
    coalesce(
      new.raw_user_meta_data->>'full_name',
      new.raw_user_meta_data->>'name',
      split_part(new.email, '@', 1)
    )
  );
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

-- Passes de bench Voltaic.
create table public.bench_runs (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  date timestamptz not null default now(),
  tier text not null check (tier in ('novice', 'intermediate', 'advanced')),
  overall double precision not null check (overall >= 0),
  rank text,
  complete boolean not null default false,
  created_at timestamptz not null default now()
);
create index bench_runs_user_date on public.bench_runs (user_id, date desc);

create table public.scenario_scores (
  id bigint generated always as identity primary key,
  run_id bigint not null references public.bench_runs(id) on delete cascade,
  scenario text not null,
  score double precision not null check (score >= 0),
  energy double precision not null check (energy >= 0)
);
create index scenario_scores_run on public.scenario_scores (run_id);

-- Debriefs coach IA.
create table public.debriefs (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  date timestamptz not null default now(),
  input_raw text not null,
  resume text not null,
  points_forts jsonb not null default '[]'::jsonb,
  axes jsonb not null default '[]'::jsonb,
  focus text
);
create index debriefs_user_date on public.debriefs (user_id, date desc);

-- Routines générées.
create table public.routines (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  date timestamptz not null default now(),
  duree_minutes integer not null check (duree_minutes > 0),
  focus text,
  contenu jsonb not null,
  done boolean not null default false
);
create index routines_user_date on public.routines (user_id, date desc);

-- Quota IA par utilisateur et par jour (écrit uniquement par la service key).
create table public.ai_usage (
  user_id uuid not null references auth.users(id) on delete cascade,
  day date not null,
  coach_count integer not null default 0,
  routine_count integer not null default 0,
  primary key (user_id, day)
);

-- RLS : chaque utilisateur ne voit et ne touche que ses lignes.
alter table public.profiles enable row level security;
alter table public.bench_runs enable row level security;
alter table public.scenario_scores enable row level security;
alter table public.debriefs enable row level security;
alter table public.routines enable row level security;
alter table public.ai_usage enable row level security;

create policy "profiles_select_own" on public.profiles
  for select using (auth.uid() = user_id);
create policy "profiles_update_own" on public.profiles
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy "bench_runs_select_own" on public.bench_runs
  for select using (auth.uid() = user_id);
create policy "bench_runs_insert_own" on public.bench_runs
  for insert with check (auth.uid() = user_id);
create policy "bench_runs_delete_own" on public.bench_runs
  for delete using (auth.uid() = user_id);

create policy "scenario_scores_select_own" on public.scenario_scores
  for select using (
    exists (
      select 1 from public.bench_runs r
      where r.id = run_id and r.user_id = auth.uid()
    )
  );
create policy "scenario_scores_insert_own" on public.scenario_scores
  for insert with check (
    exists (
      select 1 from public.bench_runs r
      where r.id = run_id and r.user_id = auth.uid()
    )
  );

create policy "debriefs_select_own" on public.debriefs
  for select using (auth.uid() = user_id);
create policy "debriefs_insert_own" on public.debriefs
  for insert with check (auth.uid() = user_id);
create policy "debriefs_delete_own" on public.debriefs
  for delete using (auth.uid() = user_id);

create policy "routines_select_own" on public.routines
  for select using (auth.uid() = user_id);
create policy "routines_insert_own" on public.routines
  for insert with check (auth.uid() = user_id);
create policy "routines_update_own" on public.routines
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "routines_delete_own" on public.routines
  for delete using (auth.uid() = user_id);

-- ai_usage : lecture seule pour l'utilisateur ; écritures réservées à la
-- service key (bypass RLS) depuis les fonctions serverless.
create policy "ai_usage_select_own" on public.ai_usage
  for select using (auth.uid() = user_id);
