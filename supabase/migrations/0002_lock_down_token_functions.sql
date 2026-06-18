-- =============================================================
-- Lock down the pgsodium token helpers.
--
-- encrypt_token / decrypt_token are SECURITY DEFINER, so Postgres'
-- default grant of EXECUTE to PUBLIC would let any PostgREST caller
-- (anon, authenticated) invoke them via /rest/v1/rpc — turning
-- decrypt_token into a decryption oracle. Revoke that and grant
-- EXECUTE only to service_role (the key the edge functions use).
-- =============================================================

revoke execute on function public.encrypt_token(text)  from public;
revoke execute on function public.decrypt_token(bytea) from public;

grant execute on function public.encrypt_token(text)  to service_role;
grant execute on function public.decrypt_token(bytea) to service_role;
