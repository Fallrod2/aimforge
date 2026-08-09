-- Panneau d'administration (SPEC §5 quater) : qui est admin, et ce que la
-- plateforme se règle en base plutôt qu'en variables d'environnement.
--
-- Deux tables, et elles ne se ressemblent pas :
--
-- 1. `platform_admins` est une **liste d'habilitation**. Elle n'a aucune
--    policy d'écriture, et il doit en rester ainsi : une table de droits que
--    le navigateur peut compléter n'est pas une table de droits. On s'y ajoute
--    par migration ou avec la service key, jamais depuis l'application. Sa
--    seule policy de lecture est `select own` : un utilisateur peut savoir
--    s'il est admin (l'UI en a besoin pour afficher l'entrée), il ne peut
--    jamais **lister** les autres — la composition de l'équipe d'administration
--    n'est l'affaire de personne ;
-- 2. `platform_settings` est une **ligne unique de configuration**, avec deux
--    secrets dedans. Elle reprend mot pour mot le verrou de la migration 0008 :
--    RLS pour dire qui voit la ligne, **privilèges de colonne** pour dire quelles
--    colonnes. Les deux clés sont write-only *y compris pour l'admin* — il les
--    pose, il ne les relit jamais, et seul `service_role` (donc les fonctions
--    serverless) peut les lire pour appeler le fournisseur.
--
-- Ce que cette migration ne déplace **pas** en base : `SUPABASE_SERVICE_ROLE_KEY`.
-- C'est l'identifiant qui sert justement à lire cette table ; le ranger dedans
-- serait ranger la clé du coffre à l'intérieur du coffre. Elle reste dans
-- l'environnement Vercel, et c'est le seul secret qui y reste.
--
-- Rien de tout cela n'est obligatoire pour que l'application fonctionne : tant
-- que les colonnes sont nulles, le serveur retombe sur les variables
-- d'environnement d'avant (`ANTHROPIC_API_KEY`, `HENRIKDEV_API_KEY`) et sur les
-- constantes de quota d'avant. Une table vide, ou une table injoignable, ne
-- casse aucun chemin existant.

/* ------------------------------------------------------------------ */
/* 1. Qui est admin                                                    */
/* ------------------------------------------------------------------ */

create table public.platform_admins (
  user_id uuid primary key references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);

alter table public.platform_admins enable row level security;

-- « Suis-je admin ? » et rien d'autre. Un `select` rend au plus une ligne :
-- la sienne. Il n'y a donc aucun moyen, depuis le navigateur, de compter ni de
-- nommer les administrateurs.
create policy "platform_admins_select_own" on public.platform_admins
  for select using (auth.uid() = user_id);

-- Aucune policy d'écriture — et, pour que le refus soit net (42501) plutôt que
-- silencieux (0 ligne touchée), on retire aussi les privilèges que Supabase
-- accorde par défaut sur les tables de `public`.
revoke insert, update, delete on public.platform_admins from public, anon, authenticated;

-- Amorce : le compte fondateur. La requête va chercher l'identifiant par
-- l'e-mail plutôt que de le figer en dur — un UUID copié à la main dans une
-- migration est la ligne que personne ne saura vérifier dans six mois.
--
-- `on conflict do nothing` et l'absence de garantie de résultat sont
-- volontaires : si le compte n'existe pas encore au moment où la migration
-- passe, elle ne casse pas ; il suffira de rejouer l'insertion (avec la
-- service key) après la première connexion.
insert into public.platform_admins (user_id)
select id from auth.users where email = 'fallrod2@gmail.com'
on conflict (user_id) do nothing;

/* ------------------------------------------------------------------ */
/* 2. La configuration de la plateforme                                */
/* ------------------------------------------------------------------ */

-- Une seule ligne, garantie par la contrainte `id = 1`. Ce n'est pas une
-- coquetterie : une table de configuration à plusieurs lignes finit toujours
-- par en avoir deux, et par un code qui prend « la première » sans savoir
-- laquelle. Ici, il n'y a rien à choisir.
create table public.platform_settings (
  id integer primary key check (id = 1),

  -- Config IA de la plateforme. Tout est nullable : « non configuré » est un
  -- état normal, et il signifie « retombe sur `ANTHROPIC_API_KEY` ».
  ai_provider text,
  ai_model text,
  ai_base_url text,
  -- Secret. Write-only, y compris pour l'admin (privilèges de colonne, §3).
  ai_api_key text,

  -- Clé HenrikDev, même régime : posée ici, elle prend le pas sur
  -- `HENRIKDEV_API_KEY` et se tourne sans redéploiement.
  henrikdev_api_key text,

  -- Quotas journaliers. Les défauts sont **les constantes d'avant** :
  -- `COACH_DAILY_QUOTA`, `ROUTINE_DAILY_QUOTA` (5 et 5),
  -- `KOVAAKS_IMPORT_DAILY_LIMIT`, `RIOT_LINK_DAILY_LIMIT` (20 et 10). Poser
  -- cette table ne change donc le comportement de personne.
  coach_daily integer not null default 5,
  routine_daily integer not null default 5,
  kovaaks_import_daily integer not null default 20,
  riot_link_daily integer not null default 10,

  -- Plafond journalier d'appels IA **sur la clé de la plateforme**, tous
  -- utilisateurs confondus. `null` = pas de plafond. Les configurations
  -- personnelles (migration 0008) ne sont pas concernées : chacun paie ses
  -- jetons, et rien ne justifie de lui compter les nôtres.
  ai_global_daily_limit integer,

  updated_at timestamptz not null default now(),

  constraint platform_settings_ai_provider check (
    ai_provider is null
    or ai_provider in ('anthropic', 'openrouter', 'openai_compatible', 'mistral', 'chatgpt_subscription')
  ),
  -- Fournisseur et modèle vont ensemble : un fournisseur sans modèle ne
  -- désigne aucun appel possible, un modèle sans fournisseur ne désigne
  -- personne à qui le demander.
  constraint platform_settings_ai_group check ((ai_provider is null) = (ai_model is null)),
  constraint platform_settings_ai_model check (ai_model is null or length(ai_model) > 0),
  -- Même règle qu'en 0008 : l'URL de base n'existe que pour un serveur
  -- OpenAI-compatible. Ailleurs, la laisser traîner ferait croire qu'elle est
  -- lue. Le `case` couvre aussi le fournisseur nul (branche `else`).
  constraint platform_settings_ai_base_url check (
    case when ai_provider = 'openai_compatible'
      then ai_base_url is not null
      else ai_base_url is null
    end
  ),
  -- Les secrets vides n'existent pas : c'est `null` qui veut dire « pas de
  -- clé », et une chaîne vide enregistrée par accident ferait échouer chaque
  -- appel sans jamais déclencher le repli sur l'environnement.
  constraint platform_settings_ai_api_key check (ai_api_key is null or length(ai_api_key) > 0),
  constraint platform_settings_henrikdev_api_key check (
    henrikdev_api_key is null or length(henrikdev_api_key) > 0
  ),
  -- Bornes : elles arrêtent l'absurde (un quota négatif, un zéro glissé dans
  -- un champ), pas l'administrateur. `0` reste permis — c'est la façon de
  -- fermer une fonctionnalité sans la déployer à nouveau.
  constraint platform_settings_quotas check (
    coach_daily between 0 and 1000
    and routine_daily between 0 and 1000
    and kovaaks_import_daily between 0 and 1000
    and riot_link_daily between 0 and 1000
  ),
  constraint platform_settings_global_limit check (
    ai_global_daily_limit is null or ai_global_daily_limit between 0 and 100000
  )
);

-- La ligne existe dès la migration, avec ses défauts. Conséquence voulue :
-- l'application n'a jamais à l'insérer, donc jamais à arbitrer entre `insert`
-- et `update` (le piège de PostgREST documenté en `api/_lib/ai-settings.ts`).
-- Elle ne fait que des `update`.
insert into public.platform_settings (id) values (1) on conflict (id) do nothing;

/* ------------------------------------------------------------------ */
/* 3. Qui voit et qui écrit                                            */
/* ------------------------------------------------------------------ */

alter table public.platform_settings enable row level security;

-- La ligne n'existe que pour les admins. Le `exists` porte sur
-- `platform_admins`, qui est elle-même sous RLS `select own` : la sous-requête
-- s'exécute avec les droits de l'appelant, elle ne peut donc voir que sa
-- propre ligne — ce qui est exactement la question posée (« suis-je admin ? »).
-- Un non-admin n'y trouve rien et la policy le refuse.
create policy "platform_settings_select_admin" on public.platform_settings
  for select using (
    exists (select 1 from public.platform_admins a where a.user_id = auth.uid())
  );

create policy "platform_settings_insert_admin" on public.platform_settings
  for insert with check (
    exists (select 1 from public.platform_admins a where a.user_id = auth.uid())
  );

create policy "platform_settings_update_admin" on public.platform_settings
  for update using (
    exists (select 1 from public.platform_admins a where a.user_id = auth.uid())
  ) with check (
    exists (select 1 from public.platform_admins a where a.user_id = auth.uid())
  );

-- Pas de policy `delete` : la ligne unique ne se supprime pas. Vider une
-- configuration, c'est mettre ses colonnes à `null` — et retomber sur
-- l'environnement, ce qui est un état prévu.

/* Privilèges de colonne : les deux clés en écriture seule ------------ */

-- Le point important de tout ce fichier, et le seul qui ne se voit pas dans
-- les policies : **l'admin lui-même ne relit pas les clés**. Une clé
-- réaffichable est une clé qu'une extension de navigateur, un cache ou une
-- capture d'écran finit par emporter — et celle-ci n'est pas la sienne, c'est
-- celle de la plateforme, donc celle de tous les utilisateurs. L'écran affiche
-- « Enregistrée », pas la valeur ; ce n'est pas une politesse d'affichage,
-- c'est le moteur qui refuse (42501).
revoke select, insert, update, delete on public.platform_settings
  from public, anon, authenticated;

grant select (
  id,
  ai_provider,
  ai_model,
  ai_base_url,
  coach_daily,
  routine_daily,
  kovaaks_import_daily,
  riot_link_daily,
  ai_global_daily_limit,
  updated_at
) on public.platform_settings to authenticated;

-- `updated_at` est absent de l'écriture : il est posé par le trigger ci-dessous,
-- et une date de mise à jour que le client choisit ne date plus rien.
grant insert (
  id,
  ai_provider,
  ai_model,
  ai_base_url,
  ai_api_key,
  henrikdev_api_key,
  coach_daily,
  routine_daily,
  kovaaks_import_daily,
  riot_link_daily,
  ai_global_daily_limit
) on public.platform_settings to authenticated;

grant update (
  ai_provider,
  ai_model,
  ai_base_url,
  ai_api_key,
  henrikdev_api_key,
  coach_daily,
  routine_daily,
  kovaaks_import_daily,
  riot_link_daily,
  ai_global_daily_limit
) on public.platform_settings to authenticated;

-- `service_role` conserve tous ses privilèges, les deux clés comprises : c'est
-- par lui que `api/coach`, `api/routine`, `api/valorant/*` et `api/kovaaks/*`
-- lisent la configuration, après avoir vérifié le JWT de l'appelant.

/* ------------------------------------------------------------------ */
/* 4. `updated_at` : daté par la base                                  */
/* ------------------------------------------------------------------ */

create function public.touch_platform_settings()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger platform_settings_touch
  before insert or update on public.platform_settings
  for each row execute function public.touch_platform_settings();

/* ------------------------------------------------------------------ */
/* 5. Le plafond global : compter sans rapatrier                       */
/* ------------------------------------------------------------------ */

-- Le plafond se vérifie **avant chaque appel IA sur la clé de la plateforme**.
-- Il doit donc coûter un aller-retour et rien de plus : une fonction qui
-- somme en base, plutôt qu'un `select` qui ramènerait une ligne par
-- utilisateur actif pour les additionner en TypeScript.
--
-- `ai_usage` ne compte, par construction (migrations 0003 et SPEC §5 ter), que
-- les appels passés sur **notre** clé : une configuration personnelle
-- n'incrémente rien. La somme ci-dessous est donc exactement la consommation
-- de la plateforme, sans avoir à la distinguer de quoi que ce soit.
create function public.platform_ai_usage_today()
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(sum(coach_count + routine_count), 0)::integer
  from public.ai_usage
  where day = (now() at time zone 'utc')::date;
$$;

revoke execute on function public.platform_ai_usage_today() from public, anon, authenticated;
grant execute on function public.platform_ai_usage_today() to service_role;

-- Les deux compteurs sont désormais lus **par jour, tous utilisateurs
-- confondus** (le plafond global ci-dessus, et le tableau d'usage de
-- l'administration). Leur clé primaire commence par `user_id` : sans ces
-- index, chaque lecture serait un parcours complet de la table.
create index ai_usage_day_idx on public.ai_usage (day);
create index import_usage_day_idx on public.import_usage (day);
