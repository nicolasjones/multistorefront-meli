-- Las mutaciones pasan exclusivamente por RPCs SECURITY DEFINER autorizados.
revoke all on table public.usuarios_organizacion from anon, authenticated;
grant select on table public.usuarios_organizacion to authenticated;

revoke all on table public.eventos_membresia from anon, authenticated;
grant select on table public.eventos_membresia to authenticated;
