-- MSF-170 (revisión independiente, hallazgos 2 y 3): inalterabilidad que no se puede saltear.
--
--   2. Los triggers de inalterabilidad de `public.registro_actividad` (20270207100001) eran comunes: un
--      `set session_replication_role = replica` o un `alter table ... disable trigger` los saltea. Pasan a
--      ENABLE ALWAYS (mismo precedente que `dominio.cotizaciones`, 20261023140400). La depuración
--      (`msf.depurando_actividad`) y el borrado en cascada de la organización no dependen de
--      `session_replication_role`, así que siguen funcionando.
--   3. `public.superadmin_entradas` (bitácora duradera del acceso de soporte) no tenía nada que impidiera
--      editarla o borrarla. Se agrega un trigger de inalterabilidad (update, delete, truncate) con ENABLE ALWAYS
--      y se revoca explícitamente la escritura a todos los roles de la API, service_role incluido.
--      Únicas excepciones del DELETE: el borrado en cascada cuando la organización ya no existe (igual que el
--      registro de actividad) o cuando la cuenta de la persona de soporte ya no existe (la FK a `auth.users`
--      es `on delete cascade`; sin esta salida no se podría eliminar a un superadmin).
--
-- Esquemas (Principio VII): no crea tablas; una función en `private` y triggers sobre tablas de `public`
-- (plataforma). Migración aditiva.
--
-- REVERSIÓN (migración posterior):
--   alter table public.registro_actividad enable trigger registro_actividad_inalterable_fila;
--   alter table public.registro_actividad enable trigger registro_actividad_inalterable_truncate;
--   drop trigger if exists superadmin_entradas_inalterable_fila on public.superadmin_entradas;
--   drop trigger if exists superadmin_entradas_inalterable_truncate on public.superadmin_entradas;
--   drop function private.bloquear_alteracion_soporte();

-- ============================================================================
-- 2. registro_actividad: los triggers valen aunque session_replication_role = replica
-- ============================================================================

alter table public.registro_actividad enable always trigger registro_actividad_inalterable_fila;
alter table public.registro_actividad enable always trigger registro_actividad_inalterable_truncate;

-- ============================================================================
-- 3. superadmin_entradas: append-only
-- ============================================================================

create or replace function private.bloquear_alteracion_soporte()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    -- Borrado en cascada: cuando se dispara, la organización (o la cuenta) ya no existe.
    if not exists (select 1 from public.organizaciones o where o.id = old.organizacion_id)
       or not exists (select 1 from auth.users u where u.id = old.user_id) then
      return old;
    end if;
  end if;
  raise exception 'La bitácora de accesos de soporte es inalterable: no se puede % ', lower(tg_op) using errcode = '42501';
end;
$$;

revoke execute on function private.bloquear_alteracion_soporte() from public, anon, authenticated;

comment on function private.bloquear_alteracion_soporte() is
  'Trigger de inalterabilidad de superadmin_entradas (MSF-170, hallazgo 3): rechaza update, delete y truncate salvo el borrado en cascada de la organización o de la cuenta.';

drop trigger if exists superadmin_entradas_inalterable_fila on public.superadmin_entradas;
create trigger superadmin_entradas_inalterable_fila
  before update or delete on public.superadmin_entradas
  for each row execute function private.bloquear_alteracion_soporte();

drop trigger if exists superadmin_entradas_inalterable_truncate on public.superadmin_entradas;
create trigger superadmin_entradas_inalterable_truncate
  before truncate on public.superadmin_entradas
  for each statement execute function private.bloquear_alteracion_soporte();

alter table public.superadmin_entradas enable always trigger superadmin_entradas_inalterable_fila;
alter table public.superadmin_entradas enable always trigger superadmin_entradas_inalterable_truncate;

-- Solo las funciones security definer (entrar/salir/cerrar accesos) escriben la bitácora, como su dueño.
revoke insert, update, delete, truncate on public.superadmin_entradas from public, anon, authenticated;

do $$
begin
  if exists (select 1 from pg_catalog.pg_roles where rolname = 'service_role') then
    revoke insert, update, delete, truncate on public.superadmin_entradas from service_role;
  end if;
end;
$$;
