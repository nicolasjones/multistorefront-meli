-- MSF-692: remover a un miembro (public.remover_miembro hace DELETE sobre
-- usuarios_organizacion) debe cortar sus sesiones, igual que suspenderlo
-- (20261012150000). Se hace con un trigger AFTER DELETE para cubrir cualquier
-- camino de borrado de la membresía, no solo la RPC.
-- Aditiva. Reversión: drop trigger cortar_sesiones_miembro_removido on
-- public.usuarios_organizacion; drop function private.cortar_sesiones_miembro_removido();
create or replace function private.cortar_sesiones_miembro_removido()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  delete from auth.sessions where user_id = old.user_id;
  return old;
end;
$$;

revoke all on function private.cortar_sesiones_miembro_removido() from public, anon, authenticated;

create trigger cortar_sesiones_miembro_removido
  after delete on public.usuarios_organizacion
  for each row execute function private.cortar_sesiones_miembro_removido();
