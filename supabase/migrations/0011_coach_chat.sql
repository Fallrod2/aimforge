-- Auto-debrief & chat coach (SPEC §5 ter bis).
--
-- Trois choses, et une seule idée derrière : le debrief cesse d'être une
-- feuille isolée. Il peut naître d'un match importé (donc être **rattaché** à
-- ce match), et il peut se prolonger en conversation (donc porter des
-- messages). Le reste — quota, remboursement, RLS — reprend à l'identique les
-- patrons déjà en place, parce qu'un patron recopié se relit, alors qu'un
-- patron réinventé se vérifie.

/* ------------------------------------------------------------------ */
/* 1. Le match débriefé                                                */
/* ------------------------------------------------------------------ */

-- La référence du match importé qui a servi d'entrée, quand il y en a un.
-- Nullable : le collage manuel reste le chemin des parties non importées, et
-- tous les debriefs déjà enregistrés sont dans ce cas.
--
-- `text` et non une clé étrangère vers `imported_matches` : l'identifiant qui
-- compte est celui du **fournisseur** (l'UUID de match Riot), pas la ligne de
-- cache. Un match ré-importé après une purge change de `id` mais pas de
-- `match_id` — et le badge « débriefé » doit survivre à ça. C'est aussi la
-- raison pour laquelle on ne met pas `on delete cascade` : effacer le cache
-- des matchs n'a pas à effacer les debriefs qu'il a inspirés.
alter table public.debriefs add column match_id text;

-- Un match ne se débriefe qu'une fois : c'est cette contrainte, et non l'UI,
-- qui l'empêche — deux clics rapides sur « Débriefer » partent en parallèle et
-- consommeraient deux fois le quota. L'index est **partiel** : les debriefs
-- collés à la main n'ont pas de `match_id`, et `null` ne doit pas entrer en
-- collision avec `null` (Postgres l'autoriserait, mais l'index partiel dit
-- l'intention plutôt que de s'en remettre à ce détail de sémantique).
create unique index debriefs_user_match
  on public.debriefs (user_id, match_id)
  where match_id is not null;

/* ------------------------------------------------------------------ */
/* 2. La conversation                                                  */
/* ------------------------------------------------------------------ */

-- Les messages échangés sous un debrief. `role` distingue les deux voix ;
-- « coach » plutôt qu'« assistant » parce que c'est le vocabulaire du produit,
-- et que la table n'a pas à ressembler à l'API d'un fournisseur — la
-- traduction vers les rôles du modèle se fait dans la fonction serverless.
create table public.coach_messages (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  debrief_id bigint not null references public.debriefs(id) on delete cascade,
  role text not null check (role in ('user', 'coach')),
  -- La borne haute est un garde-fou de stockage, pas un contrat : le contrat
  -- (2 000 caractères pour l'utilisateur) est appliqué par la fonction, qui
  -- refuse avant de dépenser un jeton. Ici on borne large, pour que la table
  -- ne puisse pas devenir un dépôt de texte.
  content text not null check (char_length(content) between 1 and 8000),
  created_at timestamptz not null default now()
);

-- La conversation se lit dans l'ordre, debrief par debrief : c'est le seul
-- accès qui existe, et l'`id` (monotone) sert de tri stable — deux messages
-- insérés dans la même milliseconde doivent quand même s'afficher dans l'ordre
-- où ils ont été dits.
create index coach_messages_debrief on public.coach_messages (debrief_id, id);

alter table public.coach_messages enable row level security;

create policy "coach_messages_select_own" on public.coach_messages
  for select using (auth.uid() = user_id);

-- L'insertion vérifie **deux** choses, et la seconde n'est pas redondante :
-- le message doit m'appartenir, et le debrief auquel il s'accroche aussi.
-- Sans elle, un utilisateur pourrait poser ses propres messages sous le
-- debrief de quelqu'un d'autre : il ne les lirait pas (la policy de lecture
-- filtre sur `user_id`), mais il ferait grossir une conversation qui n'est pas
-- la sienne, et la fonction serverless lirait ce contexte au tour suivant.
-- Même patron que `scenario_scores` et `imported_matches` (migrations 0001 et
-- 0004).
create policy "coach_messages_insert_own" on public.coach_messages
  for insert with check (
    auth.uid() = user_id
    and exists (
      select 1 from public.debriefs d
      where d.id = debrief_id and d.user_id = auth.uid()
    )
  );

-- Aucune policy `update`, délibérément : un message dit est dit. Réécrire un
-- tour passé changerait le contexte que le modèle relit au tour suivant, et
-- l'historique cesserait d'être la trace de ce qui s'est réellement échangé.
create policy "coach_messages_delete_own" on public.coach_messages
  for delete using (auth.uid() = user_id);

/* ------------------------------------------------------------------ */
/* 3. Le quota du chat                                                 */
/* ------------------------------------------------------------------ */

-- Un troisième compteur dans `ai_usage`, pas une table de plus : les trois
-- mesurent la même chose — des jetons payés par la plateforme — et le plafond
-- global les additionne. `import_usage` est séparée pour la raison inverse
-- (elle mesure la politesse envers une API tierce, migration 0007).
alter table public.ai_usage add column chat_count integer not null default 0;

-- `create or replace` : même signature, mêmes privilèges (l'ACL survit au
-- remplacement), un seul genre de plus. Le reste du corps est celui de la
-- migration 0003, au mot près.
create or replace function public.increment_ai_usage(p_user_id uuid, p_kind text)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count integer;
begin
  if p_kind not in ('coach', 'routine', 'chat') then
    raise exception 'kind inconnu: %', p_kind using errcode = '22023';
  end if;

  insert into public.ai_usage as u (user_id, day, coach_count, routine_count, chat_count)
  values (
    p_user_id,
    (now() at time zone 'utc')::date,
    case when p_kind = 'coach' then 1 else 0 end,
    case when p_kind = 'routine' then 1 else 0 end,
    case when p_kind = 'chat' then 1 else 0 end
  )
  on conflict (user_id, day) do update
    set coach_count = u.coach_count + (case when p_kind = 'coach' then 1 else 0 end),
        routine_count = u.routine_count + (case when p_kind = 'routine' then 1 else 0 end),
        chat_count = u.chat_count + (case when p_kind = 'chat' then 1 else 0 end)
  returning (
    case p_kind
      when 'coach' then u.coach_count
      when 'routine' then u.routine_count
      else u.chat_count
    end
  )
  into v_count;

  return v_count;
end;
$$;

-- Le pendant exact (migration 0010) : plancher à zéro, ligne du jour UTC
-- uniquement, aucune ligne créée.
create or replace function public.refund_ai_usage(p_user_id uuid, p_kind text)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count integer;
begin
  if p_kind not in ('coach', 'routine', 'chat') then
    raise exception 'kind inconnu: %', p_kind using errcode = '22023';
  end if;

  update public.ai_usage as u
     set coach_count = greatest(0, u.coach_count - (case when p_kind = 'coach' then 1 else 0 end)),
         routine_count = greatest(0, u.routine_count - (case when p_kind = 'routine' then 1 else 0 end)),
         chat_count = greatest(0, u.chat_count - (case when p_kind = 'chat' then 1 else 0 end))
   where u.user_id = p_user_id
     and u.day = (now() at time zone 'utc')::date
  returning (
    case p_kind
      when 'coach' then u.coach_count
      when 'routine' then u.routine_count
      else u.chat_count
    end
  )
  into v_count;

  return coalesce(v_count, 0);
end;
$$;

-- Rien d'autre que les fonctions serverless, comme en 0003 et 0010. Les
-- privilèges survivent au `create or replace` ; on les réécrit pour que la
-- lecture de cette migration seule suffise à savoir qui peut appeler quoi.
revoke execute on function public.increment_ai_usage(uuid, text) from public, anon, authenticated;
grant execute on function public.increment_ai_usage(uuid, text) to service_role;
revoke execute on function public.refund_ai_usage(uuid, text) from public, anon, authenticated;
grant execute on function public.refund_ai_usage(uuid, text) to service_role;

-- Le plafond **global** de la plateforme compte désormais les trois : un
-- message de chat consomme la clé de la plateforme exactement comme un
-- debrief, et l'oublier ferait fuir le budget par la porte la moins chère à
-- l'unité mais la plus facile à répéter.
--
-- Le tableau d'usage de l'administration (`api/admin/usage`), lui, continue de
-- ventiler coach et routine seulement : ajouter une colonne à cet écran est un
-- geste d'administration, pas de sécurité, et il n'appartient pas à cette
-- migration.
create or replace function public.platform_ai_usage_today()
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(sum(coach_count + routine_count + chat_count), 0)::integer
  from public.ai_usage
  where day = (now() at time zone 'utc')::date;
$$;

revoke execute on function public.platform_ai_usage_today() from public, anon, authenticated;
grant execute on function public.platform_ai_usage_today() to service_role;
