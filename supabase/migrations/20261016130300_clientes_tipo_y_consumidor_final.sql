-- F-CLI-03 (MSF-301, épica MSF-180): tipo de cliente y Consumidor final.
-- Esquema: `public.clientes` se mantiene en `public` por excepción documentada
-- (specs/20261016-130000-clientes-alta-y-busqueda/spec.md, Principio VII); no se
-- crean tablas nuevas. Va DESPUÉS de M3 (20261016130200) porque M3 reinicia los
-- grants por columna y acá se agregan los de `tipo`.
--
-- Migración aditiva: columnas con default, índice, funciones y disparadores.
--
-- Reversión (en una migración posterior, no en el mismo PR; las columnas no se
-- borran aquí):
--   drop function public.escala_de_cliente(uuid);
--   drop trigger organizaciones_crear_consumidor_final on public.organizaciones;
--   drop function private.crear_consumidor_final();
--   drop trigger clientes_proteger_consumidor_final on public.clientes;
--   drop function private.proteger_consumidor_final();
--   drop index public.clientes_consumidor_final_uq;
--   alter table public.clientes drop constraint clientes_consumidor_final_ck;
--   alter table public.clientes drop constraint clientes_tipo_ck;
--   revoke insert (tipo), update (tipo) on public.clientes from authenticated;
--   -- y, solo con los datos exportados, `drop column tipo, es_consumidor_final`.
--   -- Las filas «Consumidor final» creadas quedan como clientes comunes: borrarlas
--   -- requiere antes `update ... set es_consumidor_final = false` como postgres.

-- ============================================================================
-- Tipo y marca de Consumidor final (FR-008, FR-009)
-- ============================================================================

alter table public.clientes
  add column if not exists tipo text not null default 'minorista',
  add column if not exists es_consumidor_final boolean not null default false;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'clientes_tipo_ck' and conrelid = 'public.clientes'::regclass
  ) then
    alter table public.clientes
      add constraint clientes_tipo_ck check (tipo in ('minorista', 'mayorista'));
  end if;
  -- El Consumidor final nace minorista y activo; la base lo exige además del disparador.
  if not exists (
    select 1 from pg_constraint
    where conname = 'clientes_consumidor_final_ck' and conrelid = 'public.clientes'::regclass
  ) then
    alter table public.clientes
      add constraint clientes_consumidor_final_ck
      check (not es_consumidor_final or (tipo = 'minorista' and archivado_en is null));
  end if;
end
$$;

-- Uno por organización (FR-009).
create unique index if not exists clientes_consumidor_final_uq
  on public.clientes (organizacion_id)
  where es_consumidor_final;

-- `tipo` lo elige quien edita; `es_consumidor_final` nunca lo toca el llamador (M3
-- no lo concede). Se agrega solo `tipo` a los grants por columna.
grant insert (tipo) on public.clientes to authenticated;
grant update (tipo) on public.clientes to authenticated;

-- ============================================================================
-- Consumidor final inmutable (FR-009): ni se edita, ni se archiva, ni cambia de
-- tipo, ni se borra. Alcanza también a postgres/service_role (no depende de RLS).
-- El borrado solo se permite en cascada al borrar la organización.
-- ============================================================================

create or replace function private.proteger_consumidor_final()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    if old.es_consumidor_final
       and exists (select 1 from public.organizaciones o where o.id = old.organizacion_id) then
      raise exception 'El Consumidor final no se puede eliminar' using errcode = '42501';
    end if;
    return old;
  end if;

  if old.es_consumidor_final then
    raise exception 'El Consumidor final no se puede modificar ni archivar' using errcode = '42501';
  end if;
  if new.es_consumidor_final then
    raise exception 'Un cliente no puede pasar a ser el Consumidor final' using errcode = '42501';
  end if;
  return new;
end;
$$;

revoke execute on function private.proteger_consumidor_final() from public, anon, authenticated;

create trigger clientes_proteger_consumidor_final
  before update or delete on public.clientes
  for each row execute function private.proteger_consumidor_final();

-- ============================================================================
-- Consumidor final por organización: backfill + disparador (FR-009)
-- ============================================================================

create or replace function private.crear_consumidor_final()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.clientes (organizacion_id, nombre, tipo, es_consumidor_final)
  values (new.id, 'Consumidor final', 'minorista', true)
  on conflict do nothing;
  return new;
end;
$$;

revoke execute on function private.crear_consumidor_final() from public, anon, authenticated;

-- Existentes: idempotente (el índice único parcial evita duplicar al reintentar).
insert into public.clientes (organizacion_id, nombre, tipo, es_consumidor_final)
select o.id, 'Consumidor final', 'minorista', true
  from public.organizaciones o
 where not exists (
   select 1 from public.clientes c
    where c.organizacion_id = o.id and c.es_consumidor_final
 )
on conflict do nothing;

create trigger organizaciones_crear_consumidor_final
  after insert on public.organizaciones
  for each row execute function private.crear_consumidor_final();

-- ============================================================================
-- Escala de precios por tipo (FR-010): contrato de lectura para Ventas y Service
-- técnico. Regla provisoria hasta que Precios decida; si cambia, solo cambia el
-- cuerpo. Security invoker: hereda RLS (nulo si el cliente no es visible).
-- ============================================================================

create or replace function public.escala_de_cliente(p_cliente_id uuid)
returns text
language sql
stable
security invoker
set search_path = ''
as $$
  select case c.tipo when 'minorista' then 'x1' when 'mayorista' then 'por_cantidad' end
    from public.clientes c
   where c.id = p_cliente_id;
$$;

revoke execute on function public.escala_de_cliente(uuid) from public, anon;
grant execute on function public.escala_de_cliente(uuid) to authenticated;
