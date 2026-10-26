-- F-VTA-03 (MSF-240, épica MSF-139): RPC de alta, edición, estado y listado de cuentas de cobro.
-- Esquema: sin tablas nuevas (usa `dominio.cuentas_cobro` y `dominio.cuentas_cobro_empresas`; Principio VII).
--
-- Alta, edición y estado son SECURITY INVOKER: rige la RLS del llamador (escritura solo Administrador) y además
-- cada una rechaza de forma explícita (42501) a quien no es Administrador. La organización sale de la sesión
-- (default de la columna), nunca del llamador. `actualizar_cuenta_cobro` usa bloqueo optimista: el llamador envía
-- el `updated_at` que leyó y, si cambió, se rechaza con 40001 sin pisar nada. `cambiar_estado_cuenta_cobro`
-- («No usar» / reactivar) es idempotente y conserva todos los datos.
-- La habilitación por empresa («Disponible en») se reemplaza en la misma transacción mediante un ayudante
-- `security definer` (la tabla no tiene grants de escritura) que vuelve a validar Administrador y organización.
-- `listar_cuentas_cobro` es SECURITY INVOKER (RLS de lectura con `ventas`), pagina y filtra en el servidor.
--
-- Migración aditiva. Reversión (migración posterior):
--   drop function public.listar_cuentas_cobro(uuid, text, integer, integer);
--   drop function public.cambiar_estado_cuenta_cobro(uuid, boolean);
--   drop function public.actualizar_cuenta_cobro(uuid, timestamptz, text, text, text, text, text, text, text, text, integer, boolean, text, uuid[]);
--   drop function public.crear_cuenta_cobro(text, text, text, text, text, text, text, text, integer, boolean, text, uuid[]);
--   drop function private.guardar_empresas_cuenta_cobro(uuid, uuid[]);

-- Reemplaza el conjunto de empresas de una cuenta. Devuelve true si el conjunto cambió.
create or replace function private.guardar_empresas_cuenta_cobro(p_cuenta_id uuid, p_empresa_ids uuid[])
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid := (select private.organizacion_id());
  v_nuevas uuid[];
  v_actuales uuid[];
begin
  if v_org is null or not (select private.es_administrador_de(v_org)) then
    raise exception 'Tu rol no puede habilitar cuentas de cobro por empresa' using errcode = '42501';
  end if;
  if not exists (
    select 1 from dominio.cuentas_cobro c where c.id = p_cuenta_id and c.organizacion_id = v_org
  ) then
    raise exception 'La cuenta de cobro no existe' using errcode = 'P0002';
  end if;

  -- Sin nulos y todas las empresas de la organización.
  if exists (
    select 1
      from unnest(coalesce(p_empresa_ids, '{}'::uuid[])) as x(empresa_id)
     where x.empresa_id is null
        or not exists (
          select 1 from dominio.empresas e
          where e.id = x.empresa_id and e.organizacion_id = v_org
        )
  ) then
    raise exception 'Alguna de las empresas no pertenece a tu organización' using errcode = '42501';
  end if;

  select coalesce(array_agg(distinct x.empresa_id order by x.empresa_id), '{}'::uuid[])
    into v_nuevas
    from unnest(coalesce(p_empresa_ids, '{}'::uuid[])) as x(empresa_id);
  select coalesce(array_agg(ce.empresa_id order by ce.empresa_id), '{}'::uuid[])
    into v_actuales
    from dominio.cuentas_cobro_empresas ce
   where ce.cuenta_id = p_cuenta_id;

  if v_nuevas = v_actuales then
    return false;
  end if;

  delete from dominio.cuentas_cobro_empresas ce where ce.cuenta_id = p_cuenta_id;
  insert into dominio.cuentas_cobro_empresas (cuenta_id, empresa_id, organizacion_id)
  select p_cuenta_id, e, v_org from unnest(v_nuevas) as e;
  return true;
end;
$$;

revoke execute on function private.guardar_empresas_cuenta_cobro(uuid, uuid[]) from public, anon;
grant execute on function private.guardar_empresas_cuenta_cobro(uuid, uuid[]) to authenticated;

create or replace function public.crear_cuenta_cobro(
  p_nombre text,
  p_titular text,
  p_cuit text,
  p_banco text,
  p_alias text,
  p_cbu text,
  p_tipo text,
  p_moneda text,
  p_orden integer default 0,
  p_activa boolean default true,
  p_notas text default null,
  p_empresa_ids uuid[] default '{}'
)
returns dominio.cuentas_cobro
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_org uuid := (select private.organizacion_id());
  v_fila dominio.cuentas_cobro;
begin
  if v_org is null or not (select private.es_administrador_de(v_org)) then
    raise exception 'Solo un Administrador puede crear cuentas de cobro' using errcode = '42501';
  end if;
  if btrim(coalesce(p_nombre, '')) = '' then
    raise exception 'El nombre de la cuenta es obligatorio' using errcode = '22023';
  end if;
  if btrim(coalesce(p_titular, '')) = '' then
    raise exception 'El titular es obligatorio' using errcode = '22023';
  end if;
  if btrim(coalesce(p_cuit, '')) = '' then
    raise exception 'El CUIT del titular es obligatorio' using errcode = '22023';
  end if;
  if btrim(coalesce(p_cbu, '')) = '' then
    raise exception 'El CBU / CVU es obligatorio' using errcode = '22023';
  end if;

  -- El disparador normaliza y valida CBU y CUIT; los checks rechazan tipo, moneda y orden fuera de rango.
  insert into dominio.cuentas_cobro (nombre, titular, cuit, banco, alias, cbu, tipo, moneda, orden, activa, notas)
  values (p_nombre, p_titular, p_cuit, p_banco, p_alias, p_cbu,
          coalesce(p_tipo, 'cuenta_corriente'), coalesce(p_moneda, 'ARS'),
          coalesce(p_orden, 0), coalesce(p_activa, true), p_notas)
  returning * into v_fila;

  perform private.guardar_empresas_cuenta_cobro(v_fila.id, p_empresa_ids);
  return v_fila;
end;
$$;

comment on function public.crear_cuenta_cobro(text, text, text, text, text, text, text, text, integer, boolean, text, uuid[]) is
  'F-VTA-03: alta de cuenta de cobro con CBU/CVU y CUIT validados y su habilitación por empresa en la misma transacción; solo Administrador.';

revoke execute on function public.crear_cuenta_cobro(text, text, text, text, text, text, text, text, integer, boolean, text, uuid[]) from public, anon;
grant execute on function public.crear_cuenta_cobro(text, text, text, text, text, text, text, text, integer, boolean, text, uuid[]) to authenticated;

create or replace function public.actualizar_cuenta_cobro(
  p_id uuid,
  p_actualizado_en timestamptz,
  p_nombre text,
  p_titular text,
  p_cuit text,
  p_banco text,
  p_alias text,
  p_cbu text,
  p_tipo text,
  p_moneda text,
  p_orden integer default 0,
  p_activa boolean default true,
  p_notas text default null,
  p_empresa_ids uuid[] default '{}'
)
returns dominio.cuentas_cobro
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_org uuid := (select private.organizacion_id());
  v_actual dominio.cuentas_cobro;
  v_fila dominio.cuentas_cobro;
  v_cambio_empresas boolean;
begin
  if v_org is null or not (select private.es_administrador_de(v_org)) then
    raise exception 'Solo un Administrador puede editar cuentas de cobro' using errcode = '42501';
  end if;
  if btrim(coalesce(p_nombre, '')) = '' then
    raise exception 'El nombre de la cuenta es obligatorio' using errcode = '22023';
  end if;
  if btrim(coalesce(p_titular, '')) = '' then
    raise exception 'El titular es obligatorio' using errcode = '22023';
  end if;
  if btrim(coalesce(p_cuit, '')) = '' then
    raise exception 'El CUIT del titular es obligatorio' using errcode = '22023';
  end if;
  if btrim(coalesce(p_cbu, '')) = '' then
    raise exception 'El CBU / CVU es obligatorio' using errcode = '22023';
  end if;

  -- Serializa ediciones concurrentes de la misma cuenta; RLS acota a la organización.
  select * into v_actual from dominio.cuentas_cobro where id = p_id for update;
  if not found then
    raise exception 'La cuenta de cobro no existe' using errcode = 'P0002';
  end if;
  if p_actualizado_en is null or v_actual.updated_at <> p_actualizado_en then
    raise exception 'La cuenta de cobro fue modificada por otra persona' using errcode = '40001';
  end if;

  -- Avisa al disparador de normalización que un cambio solo de empresas también avanza `updated_at`.
  v_cambio_empresas := private.guardar_empresas_cuenta_cobro(p_id, p_empresa_ids);
  if v_cambio_empresas then
    perform set_config('cuentas_cobro.tocar', p_id::text, true);
  end if;

  update dominio.cuentas_cobro
     set nombre = p_nombre,
         titular = p_titular,
         cuit = p_cuit,
         banco = p_banco,
         alias = p_alias,
         cbu = p_cbu,
         tipo = coalesce(p_tipo, tipo),
         moneda = coalesce(p_moneda, moneda),
         orden = coalesce(p_orden, orden),
         activa = coalesce(p_activa, activa),
         notas = p_notas
   where id = p_id
  returning * into v_fila;

  perform set_config('cuentas_cobro.tocar', '', true);
  return v_fila;
end;
$$;

comment on function public.actualizar_cuenta_cobro(uuid, timestamptz, text, text, text, text, text, text, text, text, integer, boolean, text, uuid[]) is
  'F-VTA-03: edita una cuenta de cobro y su habilitación por empresa con bloqueo optimista por updated_at (40001 ante conflicto); solo Administrador.';

revoke execute on function public.actualizar_cuenta_cobro(uuid, timestamptz, text, text, text, text, text, text, text, text, integer, boolean, text, uuid[]) from public, anon;
grant execute on function public.actualizar_cuenta_cobro(uuid, timestamptz, text, text, text, text, text, text, text, text, integer, boolean, text, uuid[]) to authenticated;

create or replace function public.cambiar_estado_cuenta_cobro(p_id uuid, p_activa boolean)
returns dominio.cuentas_cobro
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_org uuid := (select private.organizacion_id());
  v_fila dominio.cuentas_cobro;
begin
  if v_org is null or not (select private.es_administrador_de(v_org)) then
    raise exception 'Solo un Administrador puede cambiar el estado de las cuentas de cobro' using errcode = '42501';
  end if;
  if p_activa is null then
    raise exception 'El estado es obligatorio' using errcode = '22023';
  end if;

  select * into v_fila from dominio.cuentas_cobro where id = p_id for update;
  if not found then
    raise exception 'La cuenta de cobro no existe' using errcode = 'P0002';
  end if;
  if v_fila.activa = p_activa then
    return v_fila;
  end if;

  update dominio.cuentas_cobro set activa = p_activa where id = p_id returning * into v_fila;
  return v_fila;
end;
$$;

comment on function public.cambiar_estado_cuenta_cobro(uuid, boolean) is
  'F-VTA-03: marca «No usar» o reactiva una cuenta de cobro sin tocar sus datos ni su historial; idempotente; no existe borrado.';

revoke execute on function public.cambiar_estado_cuenta_cobro(uuid, boolean) from public, anon;
grant execute on function public.cambiar_estado_cuenta_cobro(uuid, boolean) to authenticated;

-- Listado paginado en el servidor. Rige la RLS de lectura (sección `ventas`); `p_estado`: todas | activas | no_usar.
create or replace function public.listar_cuentas_cobro(
  p_empresa_id uuid default null,
  p_estado text default 'todas',
  p_pagina integer default 1,
  p_tamano integer default 10
)
returns table (
  id uuid,
  nombre text,
  titular text,
  banco text,
  cbu text,
  cuit text,
  alias text,
  tipo text,
  moneda text,
  orden integer,
  activa boolean,
  notas text,
  updated_at timestamptz,
  empresas jsonb,
  total_filas bigint
)
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  v_estado text := coalesce(p_estado, 'todas');
  v_tamano integer := least(greatest(coalesce(p_tamano, 10), 1), 200);
  v_pagina integer := least(greatest(coalesce(p_pagina, 1), 1), 100000);
begin
  if v_estado not in ('todas', 'activas', 'no_usar') then
    raise exception 'Estado no válido: usá todas, activas o no_usar' using errcode = '22023';
  end if;

  return query
  select c.id, c.nombre, c.titular, c.banco, c.cbu, c.cuit, c.alias, c.tipo, c.moneda, c.orden, c.activa,
         c.notas, c.updated_at,
         coalesce(
           (
             select jsonb_agg(jsonb_build_object('id', e.id, 'nombre', e.nombre) order by e.nombre)
               from dominio.cuentas_cobro_empresas ce
               join dominio.empresas e on e.id = ce.empresa_id
              where ce.cuenta_id = c.id
           ),
           '[]'::jsonb
         ) as empresas,
         count(*) over () as total_filas
    from dominio.cuentas_cobro c
   where c.organizacion_id = (select private.organizacion_id())
     and (v_estado = 'todas' or c.activa = (v_estado = 'activas'))
     and (p_empresa_id is null
          or exists (
            select 1 from dominio.cuentas_cobro_empresas cf
             where cf.cuenta_id = c.id and cf.empresa_id = p_empresa_id
          ))
   order by c.orden, lower(c.nombre), c.id
   limit v_tamano
  offset (v_pagina - 1) * v_tamano;
end;
$$;

comment on function public.listar_cuentas_cobro(uuid, text, integer, integer) is
  'F-VTA-03: listado paginado de cuentas de cobro de la organización con sus empresas («Disponible en») y filtros por tienda y estado. Rige la RLS de lectura con ventas.';

revoke execute on function public.listar_cuentas_cobro(uuid, text, integer, integer) from public, anon;
grant execute on function public.listar_cuentas_cobro(uuid, text, integer, integer) to authenticated;
