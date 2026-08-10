-- Le détail d'un match Valorant, mis en cache (SPEC §5 sexies, V1).
--
-- `imported_matches` garde le **résumé** d'une partie : ce qui tient sur une
-- ligne d'historique (map, agent, KDA, ADR, HS%, rounds, résultat). Le tracker
-- v2 demande autre chose, et seulement quand on ouvre une partie : le
-- scoreboard des dix joueurs, le déroulé des rounds, la performance par side.
-- C'est plus gros, ça ne sert qu'à un écran, et ça coûte un appel de plus à une
-- source non officielle — donc une table à part, remplie **à la demande**.
--
-- Trois décisions, et une seule idée derrière : un match joué ne change plus.
--
-- 1. **Le cache est à vie.** Il n'y a pas de `fetched_at` qui périme :
--    `fetched_at` date la lecture, il ne l'invalide pas. Une partie terminée
--    n'aura jamais un autre scoreboard, et la seule raison de redemander serait
--    un changement de *notre* forme de résumé — auquel cas on purge, ce qui est
--    un geste d'exploitation, pas une politique d'expiration.
-- 2. **Pas de policy `update`**, exactement comme `imported_matches` : ce qui
--    est écrit ici est écrit une fois. Une réécriture ne pourrait qu'être une
--    falsification ou un bug.
-- 3. **Le frein d'appels est structurel, pas un compteur.** La fonction
--    `api/valorant/match` n'accepte que des matchs déjà présents dans les
--    `imported_matches` de l'appelant — au plus dix par rafraîchissement, et
--    ceux-là sont eux-mêmes bornés par `import_usage`. Chaque match ne peut
--    donc être cherché qu'**une seule fois dans sa vie**, et l'ensemble des
--    matchs atteignables est celui que l'utilisateur a déjà importé. Ajouter un
--    compteur quotidien de plus mesurerait une pression qui ne peut pas
--    exister ; détourner un compteur voisin (`kovaaks_import`, `riot_link`)
--    ferait mentir les deux. La contrainte d'unicité ci-dessous est le vrai
--    garde-fou : deux clics simultanés sur la même partie ne peuvent laisser
--    qu'une ligne.
create table public.match_details (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  -- Identifiant du match chez le fournisseur (Riot : l'UUID du match), comme
  -- `imported_matches.match_id` et `debriefs.match_id`. Pas de clé étrangère
  -- vers `imported_matches` : c'est l'identifiant du fournisseur qui fait le
  -- lien, et un match ré-importé après une purge change de `id` mais pas de
  -- `match_id`.
  match_id text not null,
  -- Le détail structuré, jamais la réponse brute : scoreboard des dix joueurs
  -- réduit à l'utile (nom, agent, équipe, score, KDA, ADR, HS%), rounds
  -- (résultat et side), performance par side du joueur. Ni PUUID, ni tag, ni
  -- identifiant de compte — le scoreboard sert à se situer dans une partie,
  -- pas à pister les neuf autres.
  payload jsonb not null default '{}'::jsonb,
  fetched_at timestamptz not null default now(),
  -- Un détail par match et par utilisateur : deux joueurs d'AimForge dans la
  -- même partie gardent chacun le sien (le résumé par side est calculé de leur
  -- point de vue), et personne ne lit la ligne de l'autre.
  unique (user_id, match_id)
);

-- Le seul accès qui existe en dehors du couple (user_id, match_id) : « qu'ai-je
-- déjà en cache ? », pour un écran d'historique ou une purge.
create index match_details_user_fetched on public.match_details (user_id, fetched_at desc);

alter table public.match_details enable row level security;

create policy "match_details_select_own" on public.match_details
  for select using (auth.uid() = user_id);

-- L'insertion vérifie **deux** choses, et la seconde n'est pas redondante avec
-- le contrôle fait par la fonction serverless : le détail doit m'appartenir, et
-- porter sur un match que j'ai réellement importé. C'est ce qui rend la borne
-- du point 3 structurelle — sans elle, un appel direct à PostgREST pourrait
-- semer des lignes sur des identifiants inventés, et le cache deviendrait un
-- dépôt de texte arbitraire. Même patron que `imported_matches` (0004) et
-- `coach_messages` (0011) ; la référence à la table est qualifiée
-- (`match_details.match_id`) parce que le nom de colonne existe des deux côtés
-- de la jointure — non qualifié, il désignerait celui de la sous-requête et la
-- condition serait toujours vraie.
create policy "match_details_insert_own" on public.match_details
  for insert with check (
    auth.uid() = user_id
    and exists (
      select 1 from public.imported_matches im
      where im.user_id = auth.uid()
        and im.match_id = match_details.match_id
    )
  );

-- Aucune policy `update`, délibérément (point 2). La suppression, elle, reste
-- ouverte : purger son cache est un droit, et le détail se retrouve d'un appel.
create policy "match_details_delete_own" on public.match_details
  for delete using (auth.uid() = user_id);
