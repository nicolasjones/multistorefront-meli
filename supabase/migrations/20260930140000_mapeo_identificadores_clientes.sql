-- Mapeo de identificadores externos de clientes (spec sin número secuencial,
-- ver specs/20260930-135541-mapeo-identificadores-clientes/). Pieza genérica
-- de plataforma: vincula una fila de clientes (spec 003) con su identidad en
-- cualquier sistema/integración externa, sin acoplarse a ningún sistema
-- puntual ni a ninguna lógica de negocio de un producto derivado.
--
-- Reversión (migración aditiva, no toca nada existente):
--   drop function if exists public.desvincular_identificador_externo(uuid);
--   drop function if exists public.vincular_identificador_externo(uuid, text, text);
--   drop table if exists public.clientes_identificadores_externos;

-- ============================================================================
-- Tabla
-- ============================================================================

create table clientes_identificadores_externos (
  id uuid primary key default gen_random_uuid(),
  cliente_id uuid not null references clientes (id) on delete cascade,
  sistema text not null,
  identificador_externo text not null,
  created_at timestamptz not null default now(),
  constraint clientes_identificadores_externos_no_vacio
    check (btrim(sistema) <> '' and btrim(identificador_externo) <> ''),
  constraint clientes_identificadores_externos_sistema_identificador_key
    unique (sistema, identificador_externo)
);

comment on table clientes_identificadores_externos is
  'Mapeo genérico entre un cliente (spec 003) y su identidad en un sistema externo. sistema es texto libre: hoy no existe catálogo de sistemas externos en esta plataforma (ver research.md, Decisión 3, de la spec de esta tabla). Sin organizacion_id propia a propósito: se resuelve siempre vía cliente_id -> clientes.organizacion_id para que no pueda desincronizarse (ver research.md, Decisión 2).';

create index clientes_identificadores_externos_cliente_id_idx
  on clientes_identificadores_externos (cliente_id);

-- ============================================================================
-- RLS
-- ============================================================================

alter table clientes_identificadores_externos enable row level security;

-- Lectura: acotada a quien puede ver el cliente dueño del vínculo, mismo
-- criterio que el resto de tablas de negocio de esta plataforma. El
-- private.organizacion_id() va envuelto en un select escalar para que
-- Postgres lo evalúe una sola vez por consulta (initplan) en vez de una vez
-- por fila candidata — mismo patrón que private.es_administrador_de() en
-- 20260914150000_orquestacion_multi_organizacion.sql.
create policy clientes_identificadores_externos_select on clientes_identificadores_externos
  for select to authenticated
  using (
    exists (
      select 1 from clientes c
      where c.id = cliente_id
        and c.organizacion_id = (select private.organizacion_id())
    )
  );

-- Sin GRANT de insert/update/delete a authenticated (más abajo): toda
-- escritura pasa por las funciones SECURITY DEFINER de esta migración
-- (mismo patrón que conexiones en 20260914150000_orquestacion_multi_organizacion.sql,
-- no el de clientes en 20260908172920_fundacion_multitenant.sql) porque la
-- invariante de unicidad global (FR-002) y el comportamiento idempotente de
-- la re-vinculación (FR-004) no se pueden expresar solo con RLS. Las
-- policies de insert/delete se definen igual, como cinturón de seguridad,
-- por si algún día se otorgara el grant de tabla por error — mismo patrón
-- que conexiones_insert/conexiones_delete en esa misma migración.
create policy clientes_identificadores_externos_insert on clientes_identificadores_externos
  for insert to authenticated
  with check (
    exists (
      select 1 from clientes c
      where c.id = cliente_id
        and (select private.es_administrador_de(c.organizacion_id))
    )
  );

create policy clientes_identificadores_externos_delete on clientes_identificadores_externos
  for delete to authenticated
  using (
    exists (
      select 1 from clientes c
      where c.id = cliente_id
        and (select private.es_administrador_de(c.organizacion_id))
    )
  );

-- ============================================================================
-- Funciones (public, SECURITY DEFINER, search_path = '')
-- ============================================================================

create or replace function public.vincular_identificador_externo(
  p_cliente_id uuid,
  p_sistema text,
  p_identificador_externo text
)
returns public.clientes_identificadores_externos
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_organizacion_id uuid;
  v_vinculo public.clientes_identificadores_externos;
begin
  select c.organizacion_id into v_organizacion_id
  from public.clientes c
  where c.id = p_cliente_id;

  if v_organizacion_id is null then
    raise exception 'El cliente % no existe', p_cliente_id using errcode = 'P0002';
  end if;

  if not (select private.es_administrador_de(v_organizacion_id)) then
    raise exception 'No puede gestionar identificadores externos de esta organización' using errcode = '42501';
  end if;

  insert into public.clientes_identificadores_externos (cliente_id, sistema, identificador_externo)
  values (p_cliente_id, p_sistema, p_identificador_externo)
  on conflict (sistema, identificador_externo) do nothing
  returning * into v_vinculo;

  if v_vinculo is null then
    select * into v_vinculo
    from public.clientes_identificadores_externos
    where sistema = p_sistema and identificador_externo = p_identificador_externo;

    if v_vinculo.cliente_id <> p_cliente_id then
      raise exception 'El identificador externo ya está vinculado a otro cliente' using errcode = '23505';
    end if;
  end if;

  return v_vinculo;
end;
$$;

comment on function public.vincular_identificador_externo(uuid, text, text) is
  'Contrato: specs/20260930-135541-mapeo-identificadores-clientes/contracts/mapeo-identificadores-externos.md. Único camino para crear un vínculo (nunca un insert directo del cliente): resuelve la organización dueña vía cliente_id, valida permiso de escritura, e inserta de forma idempotente (FR-004) — re-vincular el mismo par al mismo cliente es un no-op, vincularlo a otro cliente falla con 23505 sin modificar el vínculo original (FR-002, FR-010).';

revoke execute on function public.vincular_identificador_externo(uuid, text, text) from public;
grant execute on function public.vincular_identificador_externo(uuid, text, text) to authenticated;

create or replace function public.desvincular_identificador_externo(p_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_organizacion_id uuid;
begin
  select c.organizacion_id into v_organizacion_id
  from public.clientes_identificadores_externos v
  join public.clientes c on c.id = v.cliente_id
  where v.id = p_id;

  if v_organizacion_id is null then
    return;
  end if;

  if not (select private.es_administrador_de(v_organizacion_id)) then
    raise exception 'No puede gestionar identificadores externos de esta organización' using errcode = '42501';
  end if;

  delete from public.clientes_identificadores_externos where id = p_id;
end;
$$;

comment on function public.desvincular_identificador_externo(uuid) is
  'Contrato: specs/20260930-135541-mapeo-identificadores-clientes/contracts/mapeo-identificadores-externos.md. Único camino para eliminar un vínculo. Si el id ya no existe, no-op (FR-007) — eliminar algo que ya no está no es un error.';

revoke execute on function public.desvincular_identificador_externo(uuid) from public;
grant execute on function public.desvincular_identificador_externo(uuid) to authenticated;

-- ============================================================================
-- Grants (auto_expose_new_tables = false: hacen falta explícitos)
-- ============================================================================

grant select on clientes_identificadores_externos to authenticated;
