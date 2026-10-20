-- F-VTA-04 (MSF-251, épica MSF-139, FR-017): RPC de alta, edición, estado y listado de
-- transportes. Esquema: sin tablas nuevas (usa `dominio.transportes` y
-- `dominio.transportes_empresas`; Principio VII). Las RPC viven en `public`.
--
-- Las cuatro son SECURITY INVOKER: rige la RLS del llamador (escritura solo del
-- Administrador, lectura con la sección `ventas`). La organización sale de la sesión
-- (default de la columna), nunca del llamador. `actualizar_transporte` usa bloqueo
-- optimista: el llamador envía el `updated_at` que leyó; si cambió se rechaza con 40001 y no
-- se pisa nada. `cambiar_estado_transporte` es idempotente. El CUIT (opcional) lo normaliza y
-- valida el disparador con `private.cuit_valido`; comisión y plazo, los CHECK de la tabla.
-- Las empresas se reemplazan en la misma transacción que los datos.
--
-- Migración aditiva. Reversión (migración posterior):
--   drop function public.listar_transportes(uuid, integer, integer);
--   drop function public.cambiar_estado_transporte(uuid, boolean);
--   drop function public.actualizar_transporte(uuid, timestamptz, text, text, text, text, text, text, text, text, text, boolean, numeric, integer, integer, boolean, uuid[]);
--   drop function public.crear_transporte(text, text, text, text, text, text, text, text, text, boolean, numeric, integer, integer, boolean, uuid[]);
--   drop function private.asegurar_empresas_de_transporte(uuid, uuid, uuid[]);

-- Reemplaza el conjunto de empresas de un transporte (atómico, normaliza repetidos y exige que
-- todas sean de la organización). Devuelve true si el conjunto cambió.
-- security invoker: la escritura la sigue acotando la RLS de transportes_empresas.
create or replace function private.asegurar_empresas_de_transporte(
  p_transporte_id uuid,
  p_organizacion_id uuid,
  p_empresa_ids uuid[]
)
returns boolean
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_nuevas uuid[];
  v_actuales uuid[];
begin
  if exists (select 1 from unnest(coalesce(p_empresa_ids, '{}'::uuid[])) as x(empresa_id) where x.empresa_id is null) then
    raise exception 'Alguna de las empresas no es válida' using errcode = '22023';
  end if;

  select coalesce(array_agg(distinct x.empresa_id), '{}'::uuid[])
    into v_nuevas
    from unnest(coalesce(p_empresa_ids, '{}'::uuid[])) as x(empresa_id);

  if exists (
    select 1
      from unnest(v_nuevas) as x(empresa_id)
     where not exists (
       select 1 from dominio.empresas e
       where e.id = x.empresa_id and e.organizacion_id = p_organizacion_id
     )
  ) then
    raise exception 'Alguna de las empresas no pertenece a tu organización' using errcode = '42501';
  end if;

  select coalesce(array_agg(te.empresa_id order by te.empresa_id), '{}'::uuid[])
    into v_actuales
    from dominio.transportes_empresas te
   where te.transporte_id = p_transporte_id;

  if v_actuales = (select coalesce(array_agg(n order by n), '{}'::uuid[]) from unnest(v_nuevas) as n) then
    return false;
  end if;

  delete from dominio.transportes_empresas te where te.transporte_id = p_transporte_id;
  insert into dominio.transportes_empresas (transporte_id, empresa_id, organizacion_id)
  select p_transporte_id, x.empresa_id, p_organizacion_id from unnest(v_nuevas) as x(empresa_id);
  return true;
end;
$$;

revoke execute on function private.asegurar_empresas_de_transporte(uuid, uuid, uuid[]) from public, anon;
grant execute on function private.asegurar_empresas_de_transporte(uuid, uuid, uuid[]) to authenticated;

create or replace function public.crear_transporte(
  p_nombre text,
  p_tipo text,
  p_cuit text default null,
  p_terminal_retiro text default null,
  p_localidad text default null,
  p_telefono text default null,
  p_correo text default null,
  p_persona_contacto text default null,
  p_direccion text default null,
  p_cobra_contrarreembolso boolean default false,
  p_comision_pct numeric default 0,
  p_plazo_rendicion_dias integer default 0,
  p_orden integer default 0,
  p_activa boolean default true,
  p_empresa_ids uuid[] default '{}'
)
returns dominio.transportes
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_org uuid := (select private.organizacion_id());
  v_fila dominio.transportes;
begin
  if v_org is null or not (select private.es_administrador_de(v_org)) then
    raise exception 'Solo un Administrador puede crear transportes' using errcode = '42501';
  end if;
  if btrim(coalesce(p_nombre, '')) = '' then
    raise exception 'El nombre es obligatorio' using errcode = '22023';
  end if;
  if p_tipo is null or p_tipo not in ('expreso', 'correo', 'moto_propia') then
    raise exception 'El tipo no es válido: usá expreso, correo o moto_propia' using errcode = '22023';
  end if;

  -- El disparador normaliza y valida el CUIT; el índice único rechaza el nombre repetido (23505).
  insert into dominio.transportes (
    nombre, tipo, cuit, terminal_retiro, localidad, telefono, correo, persona_contacto, direccion,
    cobra_contrarreembolso, comision_pct, plazo_rendicion_dias, orden, activa
  )
  values (
    p_nombre, p_tipo, p_cuit, p_terminal_retiro, p_localidad, p_telefono, p_correo, p_persona_contacto, p_direccion,
    coalesce(p_cobra_contrarreembolso, false), coalesce(p_comision_pct, 0), coalesce(p_plazo_rendicion_dias, 0),
    coalesce(p_orden, 0), coalesce(p_activa, true)
  )
  returning * into v_fila;

  perform private.asegurar_empresas_de_transporte(v_fila.id, v_fila.organizacion_id, p_empresa_ids);
  return v_fila;
end;
$$;

comment on function public.crear_transporte(text, text, text, text, text, text, text, text, text, boolean, numeric, integer, integer, boolean, uuid[]) is
  'F-VTA-04: alta de transporte con CUIT opcional validado y empresas donde se usa; solo Administrador; organización de la sesión.';

revoke execute on function public.crear_transporte(text, text, text, text, text, text, text, text, text, boolean, numeric, integer, integer, boolean, uuid[]) from public, anon;
grant execute on function public.crear_transporte(text, text, text, text, text, text, text, text, text, boolean, numeric, integer, integer, boolean, uuid[]) to authenticated;

create or replace function public.actualizar_transporte(
  p_id uuid,
  p_actualizado_en timestamptz,
  p_nombre text,
  p_tipo text,
  p_cuit text default null,
  p_terminal_retiro text default null,
  p_localidad text default null,
  p_telefono text default null,
  p_correo text default null,
  p_persona_contacto text default null,
  p_direccion text default null,
  p_cobra_contrarreembolso boolean default false,
  p_comision_pct numeric default 0,
  p_plazo_rendicion_dias integer default 0,
  p_orden integer default 0,
  p_activa boolean default true,
  p_empresa_ids uuid[] default '{}'
)
returns dominio.transportes
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_org uuid := (select private.organizacion_id());
  v_actual dominio.transportes;
  v_fila dominio.transportes;
  v_empresas_cambiaron boolean;
begin
  if v_org is null or not (select private.es_administrador_de(v_org)) then
    raise exception 'Solo un Administrador puede editar transportes' using errcode = '42501';
  end if;
  if btrim(coalesce(p_nombre, '')) = '' then
    raise exception 'El nombre es obligatorio' using errcode = '22023';
  end if;
  if p_tipo is null or p_tipo not in ('expreso', 'correo', 'moto_propia') then
    raise exception 'El tipo no es válido: usá expreso, correo o moto_propia' using errcode = '22023';
  end if;

  -- Serializa ediciones concurrentes del mismo transporte; RLS acota a la organización.
  select * into v_actual from dominio.transportes where id = p_id for update;
  if not found then
    raise exception 'El transporte no existe' using errcode = 'P0002';
  end if;
  if p_actualizado_en is null or v_actual.updated_at <> p_actualizado_en then
    raise exception 'El transporte fue modificado por otra persona' using errcode = '40001';
  end if;

  update dominio.transportes
     set nombre = p_nombre,
         tipo = p_tipo,
         cuit = p_cuit,
         terminal_retiro = p_terminal_retiro,
         localidad = p_localidad,
         telefono = p_telefono,
         correo = p_correo,
         persona_contacto = p_persona_contacto,
         direccion = p_direccion,
         cobra_contrarreembolso = coalesce(p_cobra_contrarreembolso, false),
         comision_pct = coalesce(p_comision_pct, 0),
         plazo_rendicion_dias = coalesce(p_plazo_rendicion_dias, 0),
         orden = coalesce(p_orden, 0),
         activa = coalesce(p_activa, true)
   where id = p_id
  returning * into v_fila;

  v_empresas_cambiaron := private.asegurar_empresas_de_transporte(v_fila.id, v_fila.organizacion_id, p_empresa_ids);
  if v_empresas_cambiaron and v_fila.updated_at = v_actual.updated_at then
    -- Cambió solo el conjunto de empresas: el bloqueo optimista también debe avanzar.
    update dominio.transportes
       set updated_at = greatest(clock_timestamp(), v_actual.updated_at + interval '1 microsecond')
     where id = p_id
    returning * into v_fila;
  end if;
  return v_fila;
end;
$$;

comment on function public.actualizar_transporte(uuid, timestamptz, text, text, text, text, text, text, text, text, text, boolean, numeric, integer, integer, boolean, uuid[]) is
  'F-VTA-04: edita un transporte y sus empresas con bloqueo optimista por updated_at (40001 ante conflicto); solo Administrador.';

revoke execute on function public.actualizar_transporte(uuid, timestamptz, text, text, text, text, text, text, text, text, text, boolean, numeric, integer, integer, boolean, uuid[]) from public, anon;
grant execute on function public.actualizar_transporte(uuid, timestamptz, text, text, text, text, text, text, text, text, text, boolean, numeric, integer, integer, boolean, uuid[]) to authenticated;

create or replace function public.cambiar_estado_transporte(p_id uuid, p_activa boolean)
returns dominio.transportes
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_org uuid := (select private.organizacion_id());
  v_fila dominio.transportes;
begin
  if v_org is null or not (select private.es_administrador_de(v_org)) then
    raise exception 'Solo un Administrador puede cambiar el estado de los transportes' using errcode = '42501';
  end if;
  if p_activa is null then
    raise exception 'El estado es obligatorio' using errcode = '22023';
  end if;

  select * into v_fila from dominio.transportes where id = p_id for update;
  if not found then
    raise exception 'El transporte no existe' using errcode = 'P0002';
  end if;
  if v_fila.activa = p_activa then
    return v_fila;
  end if;

  update dominio.transportes set activa = p_activa where id = p_id returning * into v_fila;
  return v_fila;
end;
$$;

comment on function public.cambiar_estado_transporte(uuid, boolean) is
  'F-VTA-04: desactiva o reactiva un transporte sin tocar sus datos; idempotente; no existe borrado.';

revoke execute on function public.cambiar_estado_transporte(uuid, boolean) from public, anon;
grant execute on function public.cambiar_estado_transporte(uuid, boolean) to authenticated;

-- Listado paginado con las empresas donde se usa y el filtro opcional por tienda.
-- `total_filas` = filas que cumplen el filtro (N); `total_organizacion` = todos los transportes
-- de la organización (M), para el recuento «N de M empresas de transporte».
-- Contrato: los totales viajan en cada fila, así que una página fuera de rango devuelve 0 filas y
-- NO trae totales; el cliente debe volver a la página 1 para recuperarlos (lo hace list.tsx).
-- security invoker: hereda la RLS (sección ventas) de transportes y transportes_empresas.
create or replace function public.listar_transportes(
  p_empresa_id uuid default null,
  p_pagina integer default 1,
  p_tamano integer default 25
)
returns table (
  id uuid,
  organizacion_id uuid,
  nombre text,
  tipo text,
  cuit text,
  terminal_retiro text,
  localidad text,
  telefono text,
  correo text,
  persona_contacto text,
  direccion text,
  cobra_contrarreembolso boolean,
  comision_pct numeric,
  plazo_rendicion_dias integer,
  orden integer,
  activa boolean,
  updated_at timestamptz,
  empresas jsonb,
  total_filas bigint,
  total_organizacion bigint
)
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  v_tamano integer := least(greatest(coalesce(p_tamano, 25), 1), 200);
  v_pagina integer := least(greatest(coalesce(p_pagina, 1), 1), 100000);
  v_total_org bigint;
begin
  select count(*) into v_total_org
    from dominio.transportes t
   where t.organizacion_id = (select private.organizacion_id());

  return query
  select t.id, t.organizacion_id, t.nombre, t.tipo, t.cuit, t.terminal_retiro, t.localidad, t.telefono,
         t.correo, t.persona_contacto, t.direccion, t.cobra_contrarreembolso, t.comision_pct,
         t.plazo_rendicion_dias, t.orden, t.activa, t.updated_at,
         coalesce(
           (
             select jsonb_agg(jsonb_build_object('id', e.id, 'nombre', e.nombre) order by e.nombre)
               from dominio.transportes_empresas te
               join dominio.empresas e on e.id = te.empresa_id
              where te.transporte_id = t.id
           ),
           '[]'::jsonb
         ) as empresas,
         count(*) over () as total_filas,
         v_total_org as total_organizacion
    from dominio.transportes t
   where t.organizacion_id = (select private.organizacion_id())
     and (p_empresa_id is null
          or exists (
            select 1 from dominio.transportes_empresas tf
             where tf.transporte_id = t.id and tf.empresa_id = p_empresa_id
          ))
   order by t.orden, lower(t.nombre), t.id
   limit v_tamano
  offset (v_pagina - 1) * v_tamano;
end;
$$;

comment on function public.listar_transportes(uuid, integer, integer) is
  'F-VTA-04: listado paginado de transportes de la organización con sus empresas y filtro opcional por tienda. Rige la RLS (sección ventas).';

revoke execute on function public.listar_transportes(uuid, integer, integer) from public, anon;
grant execute on function public.listar_transportes(uuid, integer, integer) to authenticated;
