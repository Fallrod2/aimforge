-- Préférences multi-benchmarks du profil (DECISIONS.md D5, D6, D7).
-- Appliquée au projet Supabase aimforge le 2026-08-12 via MCP ; copie de
-- référence versionnée.

-- Le benchmark actif est une préférence durable : le tracker, l'historique et
-- le contexte du coach la suivent, sur tous les appareils. Serveur compris
-- (les endpoints IA lisent le profil), donc en base et pas en localStorage.
alter table public.profiles
  add column active_benchmark text not null default 'voltaic-s5'
  check (active_benchmark ~ '^[a-z0-9-]+$');

-- Le jeu ne pilote que le vocabulaire (libellés du profil, phrase d'identité
-- des prompts IA). Aucune logique par jeu.
alter table public.profiles
  add column game text not null default 'valorant'
  check (game in ('valorant', 'cs2', 'apex', 'overwatch', 'other'));

-- Les paliers cessent d'être les trois valeurs Voltaic : un autre benchmark
-- a les siens. Le registre applicatif valide désormais l'appartenance du
-- palier au benchmark de la passe ; la base ne garde qu'une contrainte de
-- forme (mêmes caractères que benchmark_id).
alter table public.bench_runs drop constraint bench_runs_tier_check;
alter table public.bench_runs
  add constraint bench_runs_tier_check check (tier ~ '^[a-z0-9_-]+$');
