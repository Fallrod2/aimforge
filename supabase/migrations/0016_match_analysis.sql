-- La mini-analyse d'un match, mise en cache (SPEC §5 sexies, V4).
--
-- `match_details.payload` garde ce que la source dit d'une partie : scoreboard,
-- rounds, performance par side. V4 y ajoute ce que **le coach** en dit — deux
-- à quatre phrases lues sur la page du match : le fait saillant, un point fort,
-- un point à corriger.
--
-- Une colonne sur `match_details` plutôt qu'une table : l'analyse a exactement
-- la durée de vie, la clé et le propriétaire du détail dont elle est tirée
-- (`unique (user_id, match_id)`), elle n'existe jamais sans lui, et elle
-- disparaît avec lui quand on purge le cache. Une table de plus aurait rejoué
-- la même clé, la même RLS et le même `on delete cascade` pour un seul texte.
--
-- Trois décisions, et une seule idée derrière : une analyse coûte un appel au
-- modèle, donc elle ne se paie qu'une fois.
--
-- 1. **Le cache est à vie**, comme le détail. Un match joué ne changera plus,
--    l'analyse qui en est tirée non plus. La relecture est gratuite : la
--    fonction rend la colonne sans toucher ni au quota ni au modèle.
-- 2. **Le client n'écrit pas cette colonne** — et il ne le peut pas : il n'y a
--    toujours aucune policy `update` sur `match_details` (décision de la 0013),
--    donc la seule écriture possible est celle de la fonction serverless, sous
--    la service key, après avoir vérifié l'identité de l'appelant avec
--    `auth.getUser`. Même partage des rôles qu'en 0015 pour les messages du
--    coach : ce que l'utilisateur n'a pas autorité à écrire, il ne peut pas
--    l'écrire. Sans cette règle, `supabase.from('match_details').update(...)`
--    depuis la console du navigateur permettrait d'écrire sous la signature du
--    coach un texte que la page présente comme une analyse générée — et de
--    s'offrir des « analyses » sans jamais entamer son quota.
-- 3. **Une analyse écrite ne se réécrit pas.** La fonction n'écrit que sur une
--    ligne dont `analysis` est encore `null` ; deux clics simultanés sur le même
--    match ne laissent donc qu'un texte, et le premier gagne — exactement le
--    pendant du `ignoreDuplicates` qui protège déjà le détail.
--
-- La policy `select` de la 0013 couvre déjà la lecture : `select *` rend la
-- nouvelle colonne à son propriétaire et à personne d'autre. Rien à ajouter.
alter table public.match_details
  -- `text` et non `jsonb` : c'est du texte libre, pas un contrat de forme. Le
  -- chat du coach a tranché la même question de la même façon (migration 0011),
  -- et pour la même raison — un objet JSON imposerait au modèle une structure
  -- que deux à quatre phrases n'ont pas.
  add column analysis text
    -- La borne haute est celle du contrat partagé (`MATCH_ANALYSIS_MAX`), pour
    -- qu'un texte accepté par la fonction soit toujours enregistrable ; elle
    -- vaut environ le double de ce que le prompt demande, donc elle n'attrape
    -- qu'une sortie manifestement hors format. La borne basse interdit la chaîne
    -- vide : une analyse vide n'est pas une analyse, et la colonne doit pouvoir
    -- répondre « pas encore analysé » d'une seule façon (`null`).
    constraint match_details_analysis_length
      check (analysis is null or char_length(analysis) between 1 and 800);

comment on column public.match_details.analysis is
  'Mini-analyse générée du match (SPEC §5 sexies, V4). Écrite une seule fois, par la fonction serverless sous la service key ; null tant que le joueur ne l''a pas demandée.';
