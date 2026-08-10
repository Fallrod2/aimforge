-- Coach conversationnel global : le fil (SPEC §5 sexies, V3).
--
-- L'onglet Coach cesse d'être une liste de debriefs isolés pour devenir **une**
-- conversation continue. Le choix de schéma tient en une phrase, et c'est une
-- migration **douce** :
--
--   `coach_messages` (migration 0011) n'est pas touchée. Les fils par debrief
--   déjà écrits restent lisibles exactement comme avant — mêmes colonnes,
--   mêmes policies, même contrainte `debrief_id not null`. C'est l'UI qui
--   cesse d'y écrire (bandeau « la conversation continue dans le fil du
--   coach »), pas la base qui l'interdit.
--
-- L'alternative — rendre `coach_messages.debrief_id` nullable et y mêler les
-- deux sortes de messages — a été écartée pour trois raisons :
--
-- 1. **la policy d'insertion y perdrait sa moitié utile**. Aujourd'hui elle
--    vérifie que le debrief appartient à l'appelant (`exists (…)`). Rendre la
--    colonne nullable obligerait à écrire `debrief_id is null or exists (…)`,
--    c'est-à-dire à faire dépendre le contrôle d'accès d'un `null` ;
-- 2. **la lecture d'un ancien fil deviendrait ambiguë**. `where debrief_id = ?`
--    marcherait encore, mais « tout le fil global » s'écrirait
--    `where debrief_id is null` — une requête qui ne dit pas ce qu'elle veut ;
-- 3. **rien à migrer**. Aucune ligne à déplacer, donc aucune migration de
--    données à vérifier, donc rien qui puisse échouer à moitié.
--
-- Le prix assumé : deux tables qui se ressemblent. Il est payé une fois, ici,
-- et il achète le fait qu'un déploiement raté ne perd aucune conversation.

/* ------------------------------------------------------------------ */
/* Le fil global                                                       */
/* ------------------------------------------------------------------ */

create table public.coach_thread_messages (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  -- « coach » plutôt qu'« assistant », comme en 0011 : c'est le vocabulaire du
  -- produit, et la table n'a pas à ressembler à l'API d'un fournisseur.
  role text not null check (role in ('user', 'coach')),
  -- Le debrief rendu **dans** le fil, quand ce message est une carte debrief.
  -- Nullable : l'immense majorité des messages sont du texte.
  --
  -- `on delete set null` et non `cascade` : supprimer un debrief depuis
  -- l'historique ne doit pas trouer la conversation qui l'a produit. Le message
  -- survit, sa carte devient un message ordinaire — le client sait rendre les
  -- deux, et une conversation trouée se relirait comme un tour que le coach
  -- aurait ignoré.
  debrief_id bigint references public.debriefs(id) on delete set null,
  -- Même borne que `coach_messages` : garde-fou de stockage, pas contrat. Le
  -- contrat (2 000 caractères pour l'utilisateur) est appliqué par la fonction
  -- serverless, qui refuse avant de dépenser un jeton.
  content text not null check (char_length(content) between 1 and 8000),
  created_at timestamptz not null default now()
);

-- Le fil se lit dans l'ordre, utilisateur par utilisateur : c'est le seul accès
-- qui existe. L'`id` (monotone) sert de tri stable — la question et la réponse
-- d'un même tour sont insérées dans la même instruction et partagent la
-- milliseconde, seul l'identifiant dit laquelle a été dite en premier.
create index coach_thread_messages_user on public.coach_thread_messages (user_id, id);

alter table public.coach_thread_messages enable row level security;

create policy "coach_thread_messages_select_own" on public.coach_thread_messages
  for select using (auth.uid() = user_id);

-- L'insertion vérifie **deux** choses, et la seconde n'est pas redondante : le
-- message doit m'appartenir, et le debrief qu'il porte aussi quand il en porte
-- un. Sans elle, un utilisateur pourrait accrocher à son propre fil la
-- référence du debrief de quelqu'un d'autre ; il n'en lirait pas le contenu
-- (la RLS de `debriefs` filtre sur `user_id`), mais le client afficherait une
-- carte vide et la fonction relirait cette référence au tour suivant. Même
-- patron que `coach_messages` (migration 0011).
create policy "coach_thread_messages_insert_own" on public.coach_thread_messages
  for insert with check (
    auth.uid() = user_id
    and (
      debrief_id is null
      or exists (
        select 1 from public.debriefs d
        where d.id = debrief_id and d.user_id = auth.uid()
      )
    )
  );

-- Aucune policy `update`, délibérément — comme en 0011 : un message dit est
-- dit. Réécrire un tour passé changerait le contexte que le modèle relit au
-- tour suivant, et l'historique cesserait d'être la trace de ce qui s'est
-- réellement échangé.
--
-- La suppression, elle, existe : « effacer le fil » est un geste que
-- l'utilisateur doit pouvoir faire sur ses propres données, et il s'écrit
-- `delete … where user_id = auth.uid()` depuis le navigateur.
create policy "coach_thread_messages_delete_own" on public.coach_thread_messages
  for delete using (auth.uid() = user_id);
