-- Quota IA (SPEC §4) : remboursement du compteur du jour.
--
-- Le pendant exact de `increment_ai_usage` (migration 0003), et il existe pour
-- la raison qui rend cet incrément anticipé acceptable : on incrémente **avant**
-- l'appel au modèle pour qu'aucune paire de requêtes simultanées ne passe sur le
-- dernier debrief disponible, mais quand l'appel échoue pour une raison qui
-- appartient à la PLATEFORME (modèle injoignable, délai dépassé, sortie hors
-- contrat), l'utilisateur n'a rien reçu. Lui compter la panne serait lui faire
-- payer notre configuration. La règle tenue par les fonctions serverless :
-- incrément consommé + rien de persisté ⇒ remboursement.
--
-- Trois précautions, dans l'ordre où elles comptent :
--
-- 1. le plancher `greatest(0, …)` — un remboursement de trop ne doit jamais
--    offrir un debrief gratuit, et un compteur négatif rendrait `remaining`
--    supérieur à la limite ;
-- 2. la ligne visée est celle du **jour UTC courant**, comme à l'incrément. Un
--    appel commencé à 23:59 et remboursé à 00:00 ne trouve pas de ligne : c'est
--    voulu, on préfère ne rien rembourser plutôt que d'entamer le quota du
--    lendemain ;
-- 3. aucune ligne mise à jour ⇒ 0. La fonction ne crée jamais de ligne : il n'y
--    a rien à rembourser là où rien n'a été consommé.
--
-- Même patron d'accès que 0003 : `p_user_id` en argument (la service key ne
-- porte pas de JWT, `auth.uid()` y vaut null — l'identité a été vérifiée par la
-- fonction serverless juste avant), `security definer` parce que la table n'a
-- aucune policy d'écriture, et exécution réservée à `service_role`.

create function public.refund_ai_usage(p_user_id uuid, p_kind text)
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

  update public.ai_usage as u
     set coach_count = greatest(0, u.coach_count - (case when p_kind = 'coach' then 1 else 0 end)),
         routine_count = greatest(0, u.routine_count - (case when p_kind = 'routine' then 1 else 0 end))
   where u.user_id = p_user_id
     and u.day = (now() at time zone 'utc')::date
  returning (case when p_kind = 'coach' then u.coach_count else u.routine_count end)
  into v_count;

  return coalesce(v_count, 0);
end;
$$;

-- Personne d'autre que les fonctions serverless : ni le navigateur (`anon`,
-- `authenticated`), ni un rôle futur hérité de `public`.
revoke execute on function public.refund_ai_usage(uuid, text) from public, anon, authenticated;
grant execute on function public.refund_ai_usage(uuid, text) to service_role;
