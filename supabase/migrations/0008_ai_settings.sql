-- Réglages IA par utilisateur (SPEC §5 ter).
--
-- Une ligne par utilisateur : son fournisseur d'IA, son modèle, et sa clé.
-- Poser sa propre configuration **lève le quota** (l'utilisateur paie ses
-- propres jetons) ; ne rien poser laisse la clé de la plateforme et son quota.
--
-- Le point dur de cette table n'est pas son schéma, c'est le sort de
-- `api_key`. Une clé d'API est un secret qui appartient à l'utilisateur, et
-- deux exigences se contredisent en apparence :
--
-- 1. il doit pouvoir la **poser** — sinon la fonctionnalité n'existe pas ;
-- 2. elle ne doit **jamais** ressortir — ni vers son propre navigateur, ni
--    vers un onglet resté ouvert, ni dans une réponse PostgREST. Une clé
--    réaffichable est une clé qu'une extension, un cache ou une capture
--    d'écran finit par emporter.
--
-- Postgres sait exprimer exactement cela, et sans fonction intermédiaire : les
-- **privilèges de colonne** distinguent l'écriture de la lecture. On accorde
-- donc `insert`/`update` sur `api_key` et on retire `select` — la colonne
-- devient *write-only* pour le navigateur. C'est le comportement « saisie une
-- fois, jamais réaffichée » de tous les gestionnaires de clés sérieux, obtenu
-- par le moteur plutôt que par la discipline du code applicatif.
--
-- Le verrou est posé en privilèges de colonne et non en policy RLS, pour la
-- même raison qu'en migration 0007 : une policy voit la ligne, pas les
-- colonnes touchées, et il faudrait comparer chaque colonne à son ancienne
-- valeur dans un `with check` illisible. Ici le refus est net (42501) au lieu
-- d'être silencieux.
--
-- Conséquence assumée : le chemin nominal de l'application passe malgré tout
-- par `api/ai-settings` (validation Zod, test de connexion, message rédigé).
-- Les privilèges ci-dessous ne sont pas ce chemin — ils sont ce qui reste vrai
-- quand on court-circuite l'application et qu'on parle à PostgREST avec son
-- propre JWT.

create table public.ai_settings (
  user_id uuid primary key references auth.users(id) on delete cascade,
  provider text not null check (
    provider in ('anthropic', 'openrouter', 'openai_compatible', 'mistral', 'chatgpt_subscription')
  ),
  -- Identifiant de modèle tel que le fournisseur l'attend. Texte libre à
  -- dessein : la liste des modèles change plus vite qu'une migration, et une
  -- énumération figée périmerait avant la fin du trimestre.
  model text not null,
  -- Uniquement pour `openai_compatible` (OpenAI, vLLM, Ollama distant…) : les
  -- autres fournisseurs ont un point d'entrée connu, et laisser une URL de
  -- base traîner sur eux ferait croire qu'elle est lue.
  base_url text,
  -- Le secret. Voir l'en-tête : écrit par son propriétaire, jamais relu par
  -- lui, lu seulement par les fonctions serverless (service_role).
  api_key text not null check (length(api_key) > 0),
  updated_at timestamptz not null default now(),
  constraint ai_settings_base_url_scope check (
    (provider = 'openai_compatible' and base_url is not null)
    or (provider <> 'openai_compatible' and base_url is null)
  )
);

/* ------------------------------------------------------------------ */
/* 1. RLS : chacun chez soi                                            */
/* ------------------------------------------------------------------ */

alter table public.ai_settings enable row level security;

create policy "ai_settings_select_own" on public.ai_settings
  for select using (auth.uid() = user_id);

create policy "ai_settings_insert_own" on public.ai_settings
  for insert with check (auth.uid() = user_id);

create policy "ai_settings_update_own" on public.ai_settings
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- Retirer sa configuration doit rester possible à tout moment, et sans passer
-- par le serveur : c'est le geste qu'on veut le plus fiable de tous.
create policy "ai_settings_delete_own" on public.ai_settings
  for delete using (auth.uid() = user_id);

/* ------------------------------------------------------------------ */
/* 2. Privilèges de colonne : `api_key` en écriture seule              */
/* ------------------------------------------------------------------ */

-- Supabase accorde `all` sur les nouvelles tables de `public` à `anon` et
-- `authenticated` (privilèges par défaut du projet) : sans ce `revoke`, un
-- simple `select api_key` sous RLS rendrait la clé à son propriétaire — donc à
-- n'importe quel script tournant dans son navigateur.
revoke select on public.ai_settings from public, anon, authenticated;
grant select (user_id, provider, model, base_url, updated_at)
  on public.ai_settings to authenticated;

-- L'écriture, elle, doit inclure `api_key` : c'est tout l'objet de l'écran de
-- réglages. `updated_at` en est exclu — il est posé par le trigger ci-dessous,
-- et une date de mise à jour que le client choisit ne date plus rien.
revoke insert, update on public.ai_settings from public, anon, authenticated;
grant insert (user_id, provider, model, base_url, api_key)
  on public.ai_settings to authenticated;
grant update (provider, model, base_url, api_key)
  on public.ai_settings to authenticated;

-- `delete` n'a pas de granularité de colonne : c'est la ligne entière, et la
-- policy ci-dessus la borne à la sienne. Répété ici pour que la lecture de
-- cette migration suffise à savoir ce que le navigateur peut faire.
grant delete on public.ai_settings to authenticated;

-- `service_role` conserve tous ses privilèges, `api_key` comprise : c'est par
-- lui que `api/coach`, `api/routine` et `api/ai-settings` lisent la clé, après
-- avoir vérifié le JWT de l'appelant et toujours avec un `user_id` qui vient
-- de `getUser()`, jamais du corps de la requête.

/* ------------------------------------------------------------------ */
/* 3. `updated_at` : daté par la base                                  */
/* ------------------------------------------------------------------ */

create function public.touch_ai_settings()
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

create trigger ai_settings_touch
  before insert or update on public.ai_settings
  for each row execute function public.touch_ai_settings();
