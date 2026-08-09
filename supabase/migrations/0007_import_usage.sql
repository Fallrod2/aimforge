-- Freins sur les imports, et verrou sur les colonnes serveur des comptes liés.
--
-- Deux trous que l'authentification seule ne bouche pas :
--
-- 1. `api/kovaaks/import` et `api/valorant/link` appellent des sources tierces
--    (kovaaks.com, HenrikDev). Un compte authentifié pouvait les marteler sans
--    aucun frein : quota HenrikDev épuisé en quelques minutes, IP de la
--    plateforme bannie de kovaaks.com. Le compteur ci-dessous leur donne la
--    même laisse qu'à l'IA (migration 0003) ;
-- 2. `linked_accounts_update_own` (migration 0004) autorise l'utilisateur à
--    écrire *toutes* les colonnes de sa ligne, y compris celles que seul le
--    serveur renseigne : `riot_puuid`, `riot_region`, `riot_mmr`,
--    `last_refreshed_at`, `provider`, `external_id`. Écrire
--    `last_refreshed_at = null` en boucle depuis le navigateur suffisait à
--    annuler le cache de 5 minutes du rafraîchissement — donc à rappeler la
--    source à volonté, quota compris ; écrire `riot_mmr` permettait d'afficher
--    n'importe quel rang.

/* ------------------------------------------------------------------ */
/* 1. Compteur d'imports                                               */
/* ------------------------------------------------------------------ */

-- Table dédiée plutôt qu'une extension de `ai_usage` : les deux compteurs ne
-- mesurent pas la même chose (des jetons payants d'un côté, la politesse
-- envers une API tierce de l'autre) et n'auront pas la même durée de vie. Une
-- table séparée se supprime le jour où l'un des deux imports disparaît, sans
-- toucher au quota IA.
create table public.import_usage (
  user_id uuid not null references auth.users(id) on delete cascade,
  -- Jour UTC, comme `ai_usage` : une seule horloge dans toute l'application.
  day date not null,
  kovaaks_count integer not null default 0,
  riot_link_count integer not null default 0,
  primary key (user_id, day)
);

-- Lecture de ses propres lignes ; aucune policy d'écriture, et il doit en
-- rester ainsi — un compteur que le navigateur peut remettre à zéro n'est plus
-- une limite.
alter table public.import_usage enable row level security;

create policy "import_usage_select_own" on public.import_usage
  for select using (auth.uid() = user_id);

-- Incrément atomique du compteur du jour, calqué sur `increment_ai_usage`
-- (migration 0003) : l'upsert et l'incrément sont une seule instruction, donc
-- deux requêtes simultanées ne peuvent pas lire toutes les deux « 19 » et
-- passer toutes les deux — `on conflict do update` sérialise sur la clé
-- primaire.
--
-- `p_user_id` en argument plutôt que `auth.uid()` : la fonction est appelée
-- avec la service key (l'exécution y est réservée), et une requête service key
-- ne porte pas de JWT — `auth.uid()` y vaut null. C'est la fonction serverless
-- qui a vérifié l'identité juste avant, via `getUser()`.
create function public.increment_import_usage(p_user_id uuid, p_kind text)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count integer;
begin
  if p_kind not in ('kovaaks_import', 'riot_link') then
    raise exception 'kind inconnu: %', p_kind using errcode = '22023';
  end if;

  insert into public.import_usage as u (user_id, day, kovaaks_count, riot_link_count)
  values (
    p_user_id,
    (now() at time zone 'utc')::date,
    case when p_kind = 'kovaaks_import' then 1 else 0 end,
    case when p_kind = 'riot_link' then 1 else 0 end
  )
  on conflict (user_id, day) do update
    set kovaaks_count = u.kovaaks_count + (case when p_kind = 'kovaaks_import' then 1 else 0 end),
        riot_link_count = u.riot_link_count + (case when p_kind = 'riot_link' then 1 else 0 end)
  returning (case when p_kind = 'kovaaks_import' then u.kovaaks_count else u.riot_link_count end)
  into v_count;

  return v_count;
end;
$$;

revoke execute on function public.increment_import_usage(uuid, text)
  from public, anon, authenticated;
grant execute on function public.increment_import_usage(uuid, text) to service_role;

/* ------------------------------------------------------------------ */
/* 2. Colonnes serveur de `linked_accounts`                            */
/* ------------------------------------------------------------------ */

-- Le verrou est posé en **privilèges de colonne**, pas en policy : une policy
-- RLS voit la ligne, pas les colonnes touchées, et il faudrait comparer chaque
-- colonne à son ancienne valeur dans un `with check` illisible. Postgres sait
-- faire ça nativement, et le refus est net (42501) au lieu d'être silencieux.
--
-- Ce que l'utilisateur garde : `is_primary` (désigner son compte principal) et
-- `label` (le renommer). Ce sont les deux seules écritures que l'UI fait
-- vraiment (`setPrimaryAccount`, `unlinkAccount`).
revoke update on public.linked_accounts from public, anon, authenticated;
grant update (is_primary, label) on public.linked_accounts to authenticated;

-- Même raisonnement à l'insertion, sinon le verrou se contourne en créant la
-- ligne directement : un `riot_puuid` choisi par le navigateur ferait pointer
-- le rafraîchissement vers le compte de quelqu'un d'autre, et surtout ferait
-- exister un compte Riot « lié » sans jamais passer par `api/valorant/link` —
-- donc sans le compteur ci-dessus.
--
-- La liaison KovaaK's, elle, reste un simple insert sous RLS : elle ne
-- renseigne aucune colonne Riot et ne demande aucun secret.
revoke insert on public.linked_accounts from public, anon, authenticated;
grant insert (user_id, provider, external_id, label, is_primary)
  on public.linked_accounts to authenticated;

-- `service_role` conserve tous ses privilèges : c'est par lui que passent
-- désormais l'insertion d'un compte Riot (`api/valorant/link`) et la datation
-- du rafraîchissement (`api/valorant/refresh`), après vérification du JWT par
-- `getUser()` et avec `user_id` toujours porté explicitement dans l'écriture.
