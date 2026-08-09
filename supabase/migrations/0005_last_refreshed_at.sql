-- Horodatage du dernier rafraîchissement d'un compte lié.
--
-- Sans cette colonne, la seule trace d'un rafraîchissement serait le
-- `created_at` des matchs importés — une mesure fausse dans les deux sens :
-- un compte qui ne joue plus n'a plus de ligne récente et serait rafraîchi à
-- chaque appel, alors qu'un appel qui n'a rien rapporté (aucun match nouveau)
-- serait quand même « récent » tant qu'un import précédent l'était.
--
-- On date donc l'événement là où il a lieu : sur le compte. La policy
-- `linked_accounts_update_own` existe déjà (migration 0004), la fonction de
-- rafraîchissement écrit cette colonne avec le JWT de l'utilisateur.
alter table public.linked_accounts
  add column last_refreshed_at timestamptz;
