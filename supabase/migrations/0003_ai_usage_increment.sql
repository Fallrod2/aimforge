-- Quota IA (SPEC §4) : incrément atomique du compteur du jour.
--
-- La fonction est le seul chemin d'écriture de `public.ai_usage`. Elle fait
-- l'upsert et l'incrément dans une seule instruction, donc deux requêtes
-- simultanées ne peuvent pas lire toutes les deux « 4 » et passer toutes les
-- deux : `on conflict do update` sérialise sur la clé primaire.
--
-- `p_user_id` est passé en argument plutôt que lu dans `auth.uid()` : la
-- fonction est appelée par la fonction serverless avec la **service key**
-- (l'exécution est d'ailleurs réservée à `service_role`), et une requête
-- service key ne porte pas de JWT utilisateur — `auth.uid()` y vaut null.
-- C'est la fonction serverless qui a vérifié l'identité juste avant, en
-- appelant `getUser()` avec le JWT de l'appelant.
--
-- `security definer` : la table n'a aucune policy d'écriture (seule la lecture
-- de ses propres lignes est ouverte), et il doit en rester ainsi — le compteur
-- ne serait plus un quota si le navigateur pouvait le remettre à zéro.

create function public.increment_ai_usage(p_user_id uuid, p_kind text)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count integer;
begin
  if p_kind not in ('coach', 'routine') then
    raise exception 'kind inconnu: %', p_kind using errcode = '22023';
  end if;

  insert into public.ai_usage as u (user_id, day, coach_count, routine_count)
  values (
    p_user_id,
    (now() at time zone 'utc')::date,
    case when p_kind = 'coach' then 1 else 0 end,
    case when p_kind = 'routine' then 1 else 0 end
  )
  on conflict (user_id, day) do update
    set coach_count = u.coach_count + (case when p_kind = 'coach' then 1 else 0 end),
        routine_count = u.routine_count + (case when p_kind = 'routine' then 1 else 0 end)
  returning (case when p_kind = 'coach' then u.coach_count else u.routine_count end)
  into v_count;

  return v_count;
end;
$$;

-- Personne d'autre que les fonctions serverless : ni le navigateur (`anon`,
-- `authenticated`), ni un rôle futur hérité de `public`.
revoke execute on function public.increment_ai_usage(uuid, text) from public, anon, authenticated;
grant execute on function public.increment_ai_usage(uuid, text) to service_role;
