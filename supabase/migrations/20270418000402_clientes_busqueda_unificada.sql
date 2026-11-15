-- MSF-882 (Lote L22 · Clientes): una sola definición del texto buscable del cliente.
--
-- Por qué: el filtro de texto estaba DUPLICADO en tres lugares (`public.buscar_clientes`,
-- `private.exportar_clientes_lote` y `private.clientes_para_correo_masivo`) y cada capa lo copió (o lo
-- recortó). Dos consecuencias, las dos bugs de esta historia:
--   * el índice trigram quedó congelado en la expresión de la primera capa (sin `expreso_preferido`) y el
--     predicado vigente ya no coincidía con la expresión indexada: Postgres exige coincidencia EXACTA, así
--     que el planificador no podía usar el índice y la búsqueda caía en un Seq Scan sobre la tabla;
--   * la exportación usaba un filtro SIN `expreso_preferido`, así que el `.xlsx` podía traer menos filas
--     que el listado con los mismos filtros (el diálogo promete «los que coinciden con la búsqueda y los
--     filtros actuales»).
-- Con un solo ayudante, el filtro es el mismo en las tres RPC y el índice se reconstruye sobre él.
--
-- Esquemas (Principio VII, re-verificado): sin tablas nuevas. El ayudante vive en `private` (infraestructura,
-- sin datos); `clientes` sigue en `dominio` (MSF-505, migración anterior).
--
-- Qué hace:
--   1. `private.texto_busqueda_cliente(...)`: la concatenación en minúsculas (nombre, documento, correo,
--      teléfono, celular, localidad, expreso preferido y número) en UNA sola función INMUTABLE.
--   2. `public.buscar_clientes`, `private.exportar_clientes_lote` y `private.clientes_para_correo_masivo`
--      filtran por ese ayudante: el mismo texto para el listado, para la exportación y para el correo masivo.
--   3. `clientes_busqueda_trgm_idx` se reconstruye sobre la MISMA expresión, con el opclass de `pg_trgm`.
--
-- Lo que NO cambia: la firma ni el resultado de las RPC, los permisos, el patrón de búsqueda (sigue siendo
-- literal, con `\` `%` `_` escapados) y el aislamiento. La exportación ahora trae las mismas filas que el
-- listado (antes podía traer menos); la búsqueda ahora puede encontrar un cliente por su expreso preferido
-- (antes lo encontraba, pero sin poder usar el índice: el resultado era el mismo, la velocidad no).
--
-- Lock: `create index` (no concurrente) bloquea escrituras sobre la tabla mientras construye el índice
-- (unas decenas de segundos sobre ~5.000 clientes; en una base grande, conviene una ventana de
-- mantenimiento). Es el mismo criterio de la creación original (`20261016160000`).
--
-- Reversión (en una migración posterior, NO en este PR):
--   drop index if exists dominio.clientes_busqueda_trgm_idx;
--   create index clientes_busqueda_trgm_idx on dominio.clientes using gin
--     ((lower(coalesce(nombre, '') || ' ' || coalesce(documento, '') || ' ' || coalesce(correo, '') || ' '
--       || coalesce(telefono, '') || ' ' || coalesce(celular, '') || ' ' || coalesce(localidad, '') || ' '
--       || coalesce(expreso_preferido, '') || ' ' || numero::text)) extensions.gin_trgm_ops);
--   drop function private.texto_busqueda_cliente(text, text, text, text, text, text, text, integer);
--   y recrear las tres RPC con el filtro escrito a mano (definiciones de `20261211100250` y `20270201200119`).

-- ============================================================================
-- 1. El ayudante: una sola definición del texto buscable
-- ============================================================================

create or replace function private.texto_busqueda_cliente(
  p_nombre text,
  p_documento text,
  p_correo text,
  p_telefono text,
  p_celular text,
  p_localidad text,
  p_expreso text,
  p_numero integer
)
returns text
language sql
immutable
parallel safe
set search_path = ''
as $$
  -- Con `||` y no con `concat_ws`: `concat_ws` es STABLE (la salida de `timestamptz` depende de la zona
  -- horaria) y una función STABLE no puede ser la expresión de un índice. El texto resultante es EXACTAMENTE
  -- el que armaba cada RPC por su cuenta.
  select lower(
      coalesce(p_nombre, '') || ' ' || coalesce(p_documento, '') || ' ' || coalesce(p_correo, '') || ' ' ||
      coalesce(p_telefono, '') || ' ' || coalesce(p_celular, '') || ' ' || coalesce(p_localidad, '') || ' ' ||
      coalesce(p_expreso, '') || ' ' || coalesce(p_numero::text, ''));
$$;

comment on function private.texto_busqueda_cliente(text, text, text, text, text, text, text, integer) is
  'Texto buscable de un cliente (nombre, documento, correo, teléfono, celular, localidad, expreso preferido y número), en minúsculas. Inmutable: es la expresión del índice trigram `clientes_busqueda_trgm_idx` y la que filtran la búsqueda, la exportación y el correo masivo.';

revoke execute on function private.texto_busqueda_cliente(text, text, text, text, text, text, text, integer) from public, anon;
-- Las RPC que filtran por el ayudante son `security invoker` (heredan la RLS de `clientes`): el ejecutor
-- necesita el privilegio. El ayudante no lee datos: solo junta los valores que le pasa quien llama.
grant execute on function private.texto_busqueda_cliente(text, text, text, text, text, text, text, integer) to authenticated;
-- El índice de búsqueda la evalúa con el rol que escribe (service_role en E2E, siembra y workers).
grant execute on function private.texto_busqueda_cliente(text, text, text, text, text, text, text, integer) to service_role;

-- ============================================================================
-- 2. La búsqueda: mismo texto que la exportación
-- ============================================================================

drop function if exists public.buscar_clientes(text, text, boolean, integer, integer, uuid, boolean);
create function public.buscar_clientes(
  p_texto text default null,
  p_tipo text default null,
  p_archivados boolean default false,
  p_pagina integer default 1,
  p_tamano integer default 25,
  p_empresa_id uuid default null,
  p_con_cuenta_web boolean default false
)
returns table (
  id uuid,
  numero integer,
  nombre text,
  documento text,
  correo text,
  telefono text,
  celular text,
  localidad text,
  expreso_preferido text,
  tipo text,
  es_consumidor_final boolean,
  archivado_en timestamptz,
  empresas jsonb,
  total bigint,
  cuentas_web jsonb
)
language sql
stable
security invoker
set search_path = ''
as $$
  with parametros as (
    select
      -- Escapa \ % _ para que el texto se busque literal (FR-007).
      case when btrim(coalesce(p_texto, '')) = '' then null
        else '%' || replace(replace(replace(lower(btrim(p_texto)), '\', '\\'), '%', '\%'), '_', '\_') || '%'
      end as patron,
      least(greatest(coalesce(p_tamano, 25), 1), 100) as tamano,
      least(greatest(coalesce(p_pagina, 1), 1), 100000) as pagina
  )
  select c.id, c.numero, c.nombre, c.documento, c.correo, c.telefono, c.celular, c.localidad,
         c.expreso_preferido, c.tipo, c.es_consumidor_final, c.archivado_en,
         -- Tiendas del cliente (F-CLI-05): nombre + id, ordenadas por nombre.
         -- Hereda la RLS de clientes_empresas (security invoker).
         coalesce(
           (
             select jsonb_agg(jsonb_build_object('id', e.id, 'nombre', e.nombre) order by e.nombre)
               from public.clientes_empresas ce
               join dominio.empresas e on e.id = ce.empresa_id
              where ce.cliente_id = c.id
           ),
           '[]'::jsonb
         ) as empresas,
         count(*) over () as total,
         -- Cuentas web guardadas (F-CLI-05, FR-014): hereda la RLS de cuentas_cliente.
         coalesce(
           (
             select jsonb_agg(jsonb_build_object('empresa_id', cc.empresa_id, 'estado', cc.estado) order by cc.created_at)
               from public.cuentas_cliente cc
              where cc.cliente_id = c.id
                -- Solo tiendas donde el cliente sigue habilitado: «No habilitado» prevalece (FR-002), como en la ficha.
                and exists (
                  select 1 from public.clientes_empresas ce
                   where ce.cliente_id = c.id and ce.empresa_id = cc.empresa_id)
           ),
           '[]'::jsonb
         ) as cuentas_web
    from dominio.clientes c, parametros p
   where c.organizacion_id = (select private.organizacion_id())
     and (p_tipo is null or c.tipo = p_tipo)
     and (case when coalesce(p_archivados, false) then c.archivado_en is not null else c.archivado_en is null end)
     -- Filtro por tienda (F-CLI-11): solo los clientes habilitados en la elegida.
     and (p_empresa_id is null or exists (
           select 1 from public.clientes_empresas ce
            where ce.cliente_id = c.id and ce.empresa_id = p_empresa_id))
     -- «Con cuenta web» (FR-014): cuenta activa y cliente habilitado en esa tienda.
     and (not coalesce(p_con_cuenta_web, false) or exists (
           select 1 from public.cuentas_cliente cc
            where cc.cliente_id = c.id and cc.estado = 'activa'
              and (p_empresa_id is null or cc.empresa_id = p_empresa_id)
              and exists (
                select 1 from public.clientes_empresas ce
                 where ce.cliente_id = c.id and ce.empresa_id = cc.empresa_id)))
     -- Mismo texto que la exportación y que el correo masivo (un solo ayudante).
     and (p.patron is null or private.texto_busqueda_cliente(
            c.nombre, c.documento, c.correo, c.telefono, c.celular, c.localidad, c.expreso_preferido, c.numero)
          like p.patron)
   order by lower(c.nombre), c.id
   limit (select tamano from parametros)
  offset (select (pagina - 1) * tamano from parametros)
$$;

comment on function public.buscar_clientes(text, text, boolean, integer, integer, uuid, boolean) is
  'Listado de clientes paginado y buscable (F-CLI-02) con las tiendas de cada uno (F-CLI-05), filtro por tienda (F-CLI-11) y cuenta web: `cuentas_web` [{empresa_id, estado}] y filtro `p_con_cuenta_web` (cuenta activa y cliente habilitado). El texto se busca con `private.texto_busqueda_cliente` (mismo filtro que la exportación). RLS por organización y sección. Contrato en docs/clientes.md.';

revoke execute on function public.buscar_clientes(text, text, boolean, integer, integer, uuid, boolean) from public, anon;
grant execute on function public.buscar_clientes(text, text, boolean, integer, integer, uuid, boolean) to authenticated;

-- ============================================================================
-- 3. La exportación: el mismo texto que el listado
-- ============================================================================

create or replace function private.exportar_clientes_lote(
  p_texto text default null,
  p_tipo text default null,
  p_archivados boolean default false,
  p_despues_de uuid default null,
  p_limite integer default 1000,
  p_empresa_id uuid default null,
  p_con_cuenta_web boolean default false
)
returns table (
  id uuid,
  numero integer,
  nombre text,
  documento text,
  tipo text,
  correo text,
  telefono text,
  celular text,
  direccion text,
  codigo_postal text,
  localidad text,
  provincia text,
  expreso_preferido text,
  archivado_en timestamptz,
  total bigint
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_org uuid := (select private.organizacion_id());
  v_patron text;
  v_limite integer := least(greatest(coalesce(p_limite, 1000), 1), 1000);
  v_total bigint;
  v_nombre_cursor text;
begin
  if not (select private.puede_accion('clientes', 'exportar')) or v_org is null then
    raise exception 'No tenés permiso para exportar clientes' using errcode = '42501';
  end if;

  v_patron := case when btrim(coalesce(p_texto, '')) = '' then null
    else '%' || replace(replace(replace(lower(btrim(p_texto)), '\', '\\'), '%', '\%'), '_', '\_') || '%'
  end;

  if p_despues_de is null then
    select count(*) into v_total
      from dominio.clientes c
     where c.organizacion_id = v_org
       and (p_tipo is null or c.tipo = p_tipo)
       and (case when coalesce(p_archivados, false) then c.archivado_en is not null else c.archivado_en is null end)
       and (p_empresa_id is null or exists (
             select 1 from public.clientes_empresas ce
              where ce.cliente_id = c.id and ce.empresa_id = p_empresa_id and ce.organizacion_id = v_org))
       and (not coalesce(p_con_cuenta_web, false) or exists (
             select 1 from public.cuentas_cliente cc
              where cc.cliente_id = c.id and cc.estado = 'activa' and cc.organizacion_id = v_org
                and cc.empresa_id in (select private.empresas_accesibles())
                and (p_empresa_id is null or cc.empresa_id = p_empresa_id)
                and exists (
                  select 1 from public.clientes_empresas ce
                   where ce.cliente_id = c.id and ce.empresa_id = cc.empresa_id)))
       -- Mismo texto que el listado (un solo ayudante): el archivo coincide con la pantalla.
       and (v_patron is null or private.texto_busqueda_cliente(
              c.nombre, c.documento, c.correo, c.telefono, c.celular, c.localidad, c.expreso_preferido, c.numero)
            like v_patron);

    if v_total > 50000 then
      raise exception 'La exportación supera las 50000 filas: afiná la búsqueda' using errcode = '54000';
    end if;
  else
    v_total := 0;
    select lower(c.nombre) into v_nombre_cursor
      from dominio.clientes c where c.id = p_despues_de and c.organizacion_id = v_org;
    if v_nombre_cursor is null then
      raise exception 'El cliente de referencia de la exportación ya no existe: reintentá' using errcode = '40001';
    end if;
  end if;

  return query
  select c.id, c.numero, c.nombre, c.documento, c.tipo, c.correo, c.telefono, c.celular, c.direccion,
         c.codigo_postal, c.localidad, c.provincia, c.expreso_preferido, c.archivado_en, v_total
    from dominio.clientes c
   where c.organizacion_id = v_org
     and (p_tipo is null or c.tipo = p_tipo)
     and (case when coalesce(p_archivados, false) then c.archivado_en is not null else c.archivado_en is null end)
     and (p_empresa_id is null or exists (
           select 1 from public.clientes_empresas ce
            where ce.cliente_id = c.id and ce.empresa_id = p_empresa_id and ce.organizacion_id = v_org))
     and (not coalesce(p_con_cuenta_web, false) or exists (
           select 1 from public.cuentas_cliente cc
            where cc.cliente_id = c.id and cc.estado = 'activa' and cc.organizacion_id = v_org
             and cc.empresa_id in (select private.empresas_accesibles())
             and (p_empresa_id is null or cc.empresa_id = p_empresa_id)
             and exists (
               select 1 from public.clientes_empresas ce
                where ce.cliente_id = c.id and ce.empresa_id = cc.empresa_id)))
     -- Mismo texto que el listado (un solo ayudante).
     and (v_patron is null or private.texto_busqueda_cliente(
            c.nombre, c.documento, c.correo, c.telefono, c.celular, c.localidad, c.expreso_preferido, c.numero)
          like v_patron)
     and (p_despues_de is null or (lower(c.nombre), c.id) > (v_nombre_cursor, p_despues_de))
   order by lower(c.nombre), c.id
   limit v_limite;
end;
$$;

comment on function private.exportar_clientes_lote(text, text, boolean, uuid, integer, uuid, boolean) is
  'Lote de la exportación de clientes (keyset lower(nombre), id). Exige private.puede_accion(clientes, exportar); tope de lote 1000 y total 50000. Filtra por el mismo texto que el listado (private.texto_busqueda_cliente). La auditoría (evento clientes.exportados) vive en el envoltorio public.exportar_clientes.';

revoke execute on function private.exportar_clientes_lote(text, text, boolean, uuid, integer, uuid, boolean) from public, anon, authenticated;

-- ============================================================================
-- 4. El correo masivo: el mismo texto que el listado
-- ============================================================================

create or replace function private.clientes_para_correo_masivo(
  p_texto text,
  p_tipo text,
  p_empresa uuid,
  p_con_cuenta_web boolean,
  p_clientes uuid[]
)
returns setof dominio.clientes
language sql
stable
security invoker
set search_path = ''
as $$
  select c.*
    from dominio.clientes c
   where c.organizacion_id = (select private.organizacion_id())
     and c.archivado_en is null
     -- El Consumidor final es del mostrador, no una persona a quien escribirle.
     and not c.es_consumidor_final
     and (p_tipo is null or c.tipo = p_tipo)
     and (p_clientes is null or c.id = any (p_clientes))
     and (p_empresa is null or exists (
           select 1 from public.clientes_empresas ce
            where ce.cliente_id = c.id and ce.empresa_id = p_empresa))
     and (not coalesce(p_con_cuenta_web, false) or exists (
           select 1 from public.cuentas_cliente cc
            where cc.cliente_id = c.id and cc.estado = 'activa'
              and (p_empresa is null or cc.empresa_id = p_empresa)
              and exists (
                select 1 from public.clientes_empresas ce
                 where ce.cliente_id = c.id and ce.empresa_id = cc.empresa_id)))
     -- Mismo texto que `buscar_clientes` (un solo ayudante): se busca literal (se escapan \ % _).
     and (btrim(coalesce(p_texto, '')) = '' or private.texto_busqueda_cliente(
            c.nombre, c.documento, c.correo, c.telefono, c.celular, c.localidad, c.expreso_preferido, c.numero)
          like '%' || replace(replace(replace(lower(btrim(p_texto)), '\', '\\'), '%', '\%'), '_', '\_') || '%')
$$;

comment on function private.clientes_para_correo_masivo(text, text, uuid, boolean, uuid[]) is
  'Clientes activos que cumplen los filtros del correo masivo (F-CLI-11). Filtra por el mismo texto que el listado (private.texto_busqueda_cliente). Sin chequear aceptación ni correo. Security invoker: hereda la RLS.';

-- authenticated conserva EXECUTE (lo tenía desde 20270201200119): las RPC SECURITY INVOKER
-- public.resumen_/listar_destinatarios_correo_masivo la llaman con el rol del usuario.
revoke execute on function private.clientes_para_correo_masivo(text, text, uuid, boolean, uuid[]) from public, anon;
grant execute on function private.clientes_para_correo_masivo(text, text, uuid, boolean, uuid[]) to authenticated;

-- ============================================================================
-- 5. El índice trigram, sobre la MISMA expresión que filtran las RPC
-- ============================================================================

drop index if exists dominio.clientes_busqueda_trgm_idx;

do $$
declare
  v_esquema text;
begin
  select n.nspname into v_esquema
    from pg_extension e join pg_namespace n on n.oid = e.extnamespace
   where e.extname = 'pg_trgm';
  if v_esquema is null then
    raise exception 'Falta la extensión pg_trgm: no se puede crear clientes_busqueda_trgm_idx (SC-002)';
  end if;
  -- La expresión del índice tiene que ser EXACTAMENTE la que filtran las RPC: si no coincide, el
  -- planificador no puede usar el índice (fue el bug que este lote cierra).
  execute format(
    'create index clientes_busqueda_trgm_idx on dominio.clientes using gin '
    '(private.texto_busqueda_cliente(nombre, documento, correo, telefono, celular, localidad, expreso_preferido, numero) %I.gin_trgm_ops)',
    v_esquema
  );
end;
$$;

comment on index dominio.clientes_busqueda_trgm_idx is
  'Índice trigram del texto buscable del cliente. La expresión es `private.texto_busqueda_cliente(...)`: si el filtro de las RPC cambia, el índice se tiene que reconstruir sobre la misma expresión (si no, el planificador no lo usa).';
