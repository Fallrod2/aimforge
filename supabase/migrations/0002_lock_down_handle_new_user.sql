-- La fonction ne doit être appelée que par le trigger sur auth.users,
-- jamais via l'API REST (/rest/v1/rpc/).
revoke execute on function public.handle_new_user() from public, anon, authenticated;
