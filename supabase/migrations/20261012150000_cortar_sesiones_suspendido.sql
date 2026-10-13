-- F-ACC-03 (FR-010): al pasar un usuario a `suspendido` se invalidan sus sesiones.
-- Lee `estado` vía to_jsonb para no depender de que la columna (F-ACC-01, T001)
-- exista al aplicar esta migración; sin la columna el trigger no hace nada.
-- Reversión (en un PR posterior): quitar el trigger cortar_sesiones_suspendido
-- de public.usuarios_organizacion y la función private.cortar_sesiones_suspendido().
create or replace function private.cortar_sesiones_suspendido()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if to_jsonb(new) ->> 'estado' = 'suspendido'
     and (to_jsonb(old) ->> 'estado') is distinct from 'suspendido' then
    delete from auth.sessions where user_id = new.user_id;
  end if;
  return new;
end;
$$;

revoke all on function private.cortar_sesiones_suspendido() from public, anon, authenticated;

create trigger cortar_sesiones_suspendido
  after update on public.usuarios_organizacion
  for each row execute function private.cortar_sesiones_suspendido();
