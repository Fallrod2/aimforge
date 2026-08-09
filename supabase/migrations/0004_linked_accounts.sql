-- Comptes liés & import automatique (SPEC §5 bis, §7-P3b).
--
-- Deux tables et une colonne, pour un seul objectif produit : que la donnée
-- rentre sans saisie. Un compte lié est une **référence publique** (Riot ID ou
-- pseudo KovaaK's), jamais un jeton : aucune de ces lignes ne donne accès à
-- quoi que ce soit, elles disent seulement « va chercher là ». C'est la raison
-- pour laquelle la liaison n'a besoin ni d'OAuth ni de secret côté utilisateur.
--
-- Les écritures viennent des fonctions serverless (`api/valorant/*`,
-- `api/kovaaks/*`) mais **avec le JWT de l'appelant** : la RLS s'applique donc
-- exactement comme depuis le navigateur. Aucune policy n'est écrite pour la
-- service key, et c'est délibéré — une fonction qui se tromperait
-- d'identifiant se ferait refuser par la base, pas par sa propre prudence.

-- Comptes liés : plusieurs Riot IDs possibles (principal + alts), un seul
-- pseudo KovaaK's en pratique, mais le schéma n'a pas à le savoir.
create table public.linked_accounts (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  provider text not null check (provider in ('riot', 'kovaaks')),
  -- Riot : « Nom#TAG » tel que saisi. KovaaK's : le pseudo du Benchmark Tracker.
  external_id text not null,
  -- Renseignés par la fonction de liaison Riot uniquement : le PUUID est
  -- l'identifiant stable (un Riot ID se renomme, le PUUID non), la région
  -- conditionne le point d'entrée de l'API.
  riot_puuid text,
  riot_region text,
  -- Nom donné par l'utilisateur (« smurf », « compte principal »…).
  label text,
  -- Le compte dont le dashboard affiche le rang. Au plus un par utilisateur et
  -- par provider — garanti par l'index partiel ci-dessous.
  is_primary boolean not null default false,
  created_at timestamptz not null default now(),
  -- Lier deux fois le même compte n'a pas de sens : la contrainte le dit, et
  -- l'UI la traduit en « ce compte est déjà lié » plutôt qu'en doublon muet.
  unique (user_id, provider, external_id)
);
create index linked_accounts_user on public.linked_accounts (user_id, provider);
-- « Principal » est une désignation, pas un attribut : deux principaux pour un
-- même provider rendraient le dashboard non déterministe. La base l'interdit.
create unique index linked_accounts_one_primary
  on public.linked_accounts (user_id, provider)
  where is_primary;

-- Cache des matchs importés. Le `payload` est un **résumé** construit par la
-- fonction serverless (map, agent, KDA, ADR, HS%, rounds, résultat), pas la
-- réponse brute de l'API : c'est ce résumé que le coach lira, et c'est lui qui
-- doit survivre à un changement de fournisseur de données.
create table public.imported_matches (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  linked_account_id bigint not null references public.linked_accounts(id) on delete cascade,
  -- Identifiant du match chez le fournisseur (Riot : l'UUID du match).
  match_id text not null,
  played_at timestamptz,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  -- Un match n'est importé qu'une fois par compte lié : c'est cette contrainte
  -- qui rend le rafraîchissement idempotent (insertion « on conflict do nothing »).
  unique (linked_account_id, match_id)
);
create index imported_matches_user_played on public.imported_matches (user_id, played_at desc);
create index imported_matches_account on public.imported_matches (linked_account_id, created_at desc);

-- D'où vient une passe de bench : saisie à la main, ou importée depuis le
-- Benchmark Tracker KovaaK's. Les passes existantes sont manuelles.
alter table public.bench_runs
  add column source text not null default 'manual'
  check (source in ('manual', 'kovaaks'));

-- RLS : mêmes règles que partout ailleurs, chacun chez soi.
alter table public.linked_accounts enable row level security;
alter table public.imported_matches enable row level security;

create policy "linked_accounts_select_own" on public.linked_accounts
  for select using (auth.uid() = user_id);
create policy "linked_accounts_insert_own" on public.linked_accounts
  for insert with check (auth.uid() = user_id);
create policy "linked_accounts_update_own" on public.linked_accounts
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "linked_accounts_delete_own" on public.linked_accounts
  for delete using (auth.uid() = user_id);

-- Pas de policy `update` sur les matchs importés : un match joué ne change
-- plus. Un import répété ne réécrit donc rien, il ignore les doublons.
create policy "imported_matches_select_own" on public.imported_matches
  for select using (auth.uid() = user_id);
create policy "imported_matches_insert_own" on public.imported_matches
  for insert with check (
    auth.uid() = user_id
    and exists (
      select 1 from public.linked_accounts a
      where a.id = linked_account_id and a.user_id = auth.uid()
    )
  );
create policy "imported_matches_delete_own" on public.imported_matches
  for delete using (auth.uid() = user_id);
