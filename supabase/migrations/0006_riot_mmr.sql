-- Dernier rang connu d'un compte Riot lié.
--
-- Le dashboard doit afficher un rang à l'ouverture. Sans cette colonne, il n'y
-- a que deux façons d'y arriver, et les deux sont mauvaises : appeler la source
-- Valorant à chaque affichage (ce que le cache de 5 minutes existe justement
-- pour éviter), ou n'afficher aucun rang tant que le cache est chaud — c'est-à-
-- dire précisément pendant les cinq minutes qui suivent un rafraîchissement.
--
-- Le rang appartient au compte, pas aux matchs : il se range donc à côté de
-- `last_refreshed_at`, écrit par le même appel et sous la même policy
-- (`linked_accounts_update_own`, migration 0004).
--
-- Le contenu est un résumé validé côté fonction (`mmrSummarySchema` :
-- tier, rr, lastChange, elo), pas la réponse brute de la source — comme pour
-- `imported_matches.payload`, c'est le résumé qui doit survivre à un
-- changement de fournisseur de données.
alter table public.linked_accounts
  add column riot_mmr jsonb;
