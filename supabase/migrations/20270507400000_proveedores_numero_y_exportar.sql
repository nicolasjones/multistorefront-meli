-- MSF-663 (seguimientos MSF-527 y MSF-526 de la épica MSF-205): número correlativo de proveedor y
-- exportación del listado, tal como los muestra el prototipo `design/pantallas/Proveedores.dc.html`
-- (columna «N.º» y botón «Exportar»).
--
-- Esquema (Principio VII): `dominio.proveedores` ya existe; se le agrega la columna `numero`.
-- `public.listar_proveedores` y `public.exportar_proveedores` son RPC de plataforma.
--
-- Número correlativo (MSF-527):
--   * Es por organización, entero, único (`proveedores_org_numero_uq`) y lo asigna la base en un
--     disparador BEFORE INSERT, nunca el llamador: la columna no entra en los grants de
--     `authenticated` (ni de insert ni de update), así que un número no se reescribe.
--   * Concurrencia: el disparador toma un lock advisory transaccional por organización antes de
--     leer el máximo, de modo que dos altas simultáneas de la misma organización no repiten número
--     (si algo fallara, el índice único aborta la segunda en vez de duplicar). También rige para
--     altas sin sesión (importación, migración de datos): todas pasan por el disparador.
--   * Los proveedores no se borran (sin política ni grant DELETE), así que un número nunca se
--     reutiliza; puede haber huecos solo si una alta se revierte.
--   * Los ya cargados se numeran una sola vez al migrar: por organización, en orden de alta
--     (`creado_en`) y, ante empate, por `id`. El orden es estable y no depende del listado.
--
-- Exportación (MSF-526): `public.exportar_proveedores` es security definer, exige
-- `private.puede_accion('proveedores', 'exportar')` (la misma acción que Clientes; exige además
-- al menos lectura en Proveedores, así que con la matriz inicial exportan Administrador y Administración:
-- el Operador tiene la acción pero «ninguno» en la sección), acota a la organización de la sesión (nunca a un
-- parámetro) y pagina por keyset `(lower(razon_social), id)`. Tope de 50000 filas por exportación
-- (54000 al superarlo, en cada llamada). Registra la actividad `proveedores.exportados` en cada
-- llamada que devuelve filas (el primer lote declara el total; los siguientes, su continuación), así
-- un cursor suelto tampoco baja datos sin rastro. Sin topes acumulados por persona.
--
-- `public.listar_proveedores` suma `numero` a lo que devuelve: cambia el tipo de retorno, por eso se
-- recrea (DROP FUNCTION + CREATE) con los mismos privilegios; el cuerpo es el de
-- 20261021233000_proveedores_sin_tienda.sql.
--
-- Reversión (en una migración posterior, no en este PR; exportar antes los datos):
--   drop function public.exportar_proveedores(text, text, uuid, uuid, integer);
--   -- recrear public.listar_proveedores(text, text, integer, integer, uuid) con la definición de
--   -- 20261021233000_proveedores_sin_tienda.sql (sin `numero`)
--   drop trigger proveedores_asignar_numero on dominio.proveedores;
--   drop function private.asignar_numero_proveedor();
--   drop index dominio.proveedores_org_numero_uq;
--   alter table dominio.proveedores drop column numero;

-- Pre-chequeo (informativo, no destruye nada): volumen que recorre el backfill.
--   select count(*) from dominio.proveedores;

-- ============================================================================
-- Número correlativo por organización (MSF-527)
-- ============================================================================

alter table dominio.proveedores add column if not exists numero integer;

comment on column dominio.proveedores.numero is
  'Número correlativo dentro de la organización (1, 2, 3…). Lo asigna el disparador proveedores_asignar_numero; no se edita.';

-- Backfill ANTES del disparador: orden de alta, desempate por id. El disparador de
-- normalización conserva `updated_at` cuando no cambian los datos del proveedor.
with ordenados as (
  select id, row_number() over (partition by organizacion_id order by creado_en, id) as n
    from dominio.proveedores
)
update dominio.proveedores p
   set numero = o.n
  from ordenados o
 where o.id = p.id
   and p.numero is null;

alter table dominio.proveedores alter column numero set not null;

create unique index if not exists proveedores_org_numero_uq on dominio.proveedores (organizacion_id, numero);

-- security definer: el máximo se lee sobre todos los proveedores de la organización, sin que la RLS
-- del llamador recorte lo que ve.
create or replace function private.asignar_numero_proveedor()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.numero is null then
    -- Serializa las altas de la misma organización (prefijo propio: no comparte clave con Clientes).
    perform pg_advisory_xact_lock(hashtext('proveedores:' || new.organizacion_id::text));
    select coalesce(max(p.numero), 0) + 1
      into new.numero
      from dominio.proveedores p
     where p.organizacion_id = new.organizacion_id;
  end if;
  return new;
end;
$$;

revoke execute on function private.asignar_numero_proveedor() from public, anon, authenticated;

drop trigger if exists proveedores_asignar_numero on dominio.proveedores;
create trigger proveedores_asignar_numero
  before insert on dominio.proveedores
  for each row execute function private.asignar_numero_proveedor();

-- ============================================================================
-- Listado con número (MSF-527)
-- ============================================================================

drop function if exists public.listar_proveedores(text, text, integer, integer, uuid);

create function public.listar_proveedores(
  p_busqueda text default null,
  p_estado text default 'activos',
  p_pagina integer default 1,
  p_tamano integer default 25,
  p_empresa_id uuid default null
)
returns table (
  id uuid,
  numero integer,
  razon_social text,
  cuit text,
  correo text,
  telefono text,
  activo boolean,
  empresas jsonb,
  total_filas bigint
)
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  v_texto text := btrim(coalesce(p_busqueda, ''));
  v_estado text := coalesce(p_estado, 'activos');
  v_patron text;
  v_patron_cuit text;
  v_tamano integer := least(greatest(coalesce(p_tamano, 25), 1), 200);
  v_pagina integer := least(greatest(coalesce(p_pagina, 1), 1), 100000);
begin
  if v_estado not in ('activos', 'inactivos', 'todos') then
    raise exception 'Estado no válido: usá activos, inactivos o todos' using errcode = '22023';
  end if;

  if v_texto <> '' then
    -- Escapa \ % _ para que el texto se busque literal.
    v_patron := '%' || replace(replace(replace(translate(lower(v_texto), 'áéíóúü', 'aeiouu'), '\', '\\'), '%', '\%'), '_', '\_') || '%';
    -- Solo un texto numérico (con guiones, puntos o espacios) busca también por CUIT.
    if v_texto ~ '^[0-9][0-9\s.\-]*$' then
      v_patron_cuit := '%' || regexp_replace(v_texto, '[^0-9]', '', 'g') || '%';
    end if;
  end if;

  return query
  select p.id, p.numero, p.razon_social, p.cuit, p.correo, p.telefono, p.activo,
         coalesce(
           (
             select jsonb_agg(jsonb_build_object('id', e.id, 'nombre', e.nombre) order by e.nombre)
               from dominio.proveedores_empresas pe
               join dominio.empresas e on e.id = pe.empresa_id
              where pe.proveedor_id = p.id
           ),
           '[]'::jsonb
         ) as empresas,
         count(*) over () as total_filas
    from dominio.proveedores p
   where p.organizacion_id = (select private.organizacion_id())
     and (v_estado = 'todos' or p.activo = (v_estado = 'activos'))
     and (v_patron is null
          or translate(lower(p.razon_social), 'áéíóúü', 'aeiouu') like v_patron
          or (v_patron_cuit is not null and p.cuit like v_patron_cuit))
     and (
       p_empresa_id is null
       or (
         -- La tienda pedida tiene que ser de la organización: un id ajeno sigue dando 0 filas.
         exists (
           select 1 from dominio.empresas e
            where e.id = p_empresa_id
              and e.organizacion_id = (select private.organizacion_id())
         )
         and (
           -- Sin «Compra para»: transversal a todas las tiendas de la organización.
           not exists (
             select 1 from dominio.proveedores_empresas pe
              where pe.proveedor_id = p.id
           )
           -- Con tiendas: solo aparece en las que tiene asignadas.
           or exists (
             select 1 from dominio.proveedores_empresas pf
              where pf.proveedor_id = p.id and pf.empresa_id = p_empresa_id
           )
         )
       )
     )
   order by lower(p.razon_social), p.id
   limit v_tamano
  offset (v_pagina - 1) * v_tamano;
end;
$$;

comment on function public.listar_proveedores(text, text, integer, integer, uuid) is
  'Listado paginado de proveedores de la organización (F-PRV-02) con su número, sus tiendas «Compra para» y filtro opcional por tienda (MSF-524). Un proveedor sin tiendas asignadas se muestra en el filtro de cualquier tienda de la organización. Rige la RLS de dominio.proveedores.';

revoke execute on function public.listar_proveedores(text, text, integer, integer, uuid) from public, anon;
grant execute on function public.listar_proveedores(text, text, integer, integer, uuid) to authenticated;

-- ============================================================================
-- Exportación del listado (MSF-526)
-- ============================================================================

create or replace function public.exportar_proveedores(
  p_texto text default null,
  p_estado text default 'activos',
  p_empresa_id uuid default null,
  p_despues_de uuid default null,
  p_limite integer default 1000
)
returns table (
  id uuid,
  numero integer,
  razon_social text,
  cuit text,
  compra_para text,
  correo text,
  telefono text,
  activo boolean,
  total bigint
)
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_org uuid := (select private.organizacion_id());
  v_texto text := btrim(coalesce(p_texto, ''));
  v_estado text := coalesce(p_estado, 'activos');
  v_limite integer := least(greatest(coalesce(p_limite, 1000), 1), 1000);
  v_patron text;
  v_patron_cuit text;
  v_total bigint;
  v_cursor text;
  v_filas integer;
  v_filtros text[] := '{}';
  v_tienda text;
begin
  if v_org is null or not (select private.puede_accion('proveedores', 'exportar')) then
    raise exception 'No tenés permiso para exportar proveedores' using errcode = '42501';
  end if;
  if v_estado not in ('activos', 'inactivos', 'todos') then
    raise exception 'Estado no válido: usá activos, inactivos o todos' using errcode = '22023';
  end if;

  -- Misma búsqueda que listar_proveedores (razón social sin mayúsculas ni tildes; CUIT si el texto es numérico).
  if v_texto <> '' then
    v_patron := '%' || replace(replace(replace(translate(lower(v_texto), 'áéíóúü', 'aeiouu'), '\', '\\'), '%', '\%'), '_', '\_') || '%';
    if v_texto ~ '^[0-9][0-9\s.\-]*$' then
      v_patron_cuit := '%' || regexp_replace(v_texto, '[^0-9]', '', 'g') || '%';
    end if;
  end if;

  -- Un cursor de otra organización o inexistente no trunca el archivo en silencio: se rechaza.
  if p_despues_de is not null then
    select lower(p.razon_social) into v_cursor
      from dominio.proveedores p where p.id = p_despues_de and p.organizacion_id = v_org;
    if v_cursor is null then
      raise exception 'El proveedor de referencia de la exportación ya no existe: reintentá' using errcode = '40001';
    end if;
  end if;

  -- El tope se valida en cada llamada (un cursor suelto tampoco evita el límite).
  select count(*) into v_total
    from dominio.proveedores p
   where p.organizacion_id = v_org
     and (v_estado = 'todos' or p.activo = (v_estado = 'activos'))
     and (v_patron is null
          or translate(lower(p.razon_social), 'áéíóúü', 'aeiouu') like v_patron
          or (v_patron_cuit is not null and p.cuit like v_patron_cuit))
     and (
       p_empresa_id is null
       or (
         exists (select 1 from dominio.empresas e where e.id = p_empresa_id and e.organizacion_id = v_org)
         and (
           not exists (select 1 from dominio.proveedores_empresas pe where pe.proveedor_id = p.id)
           or exists (select 1 from dominio.proveedores_empresas pf where pf.proveedor_id = p.id and pf.empresa_id = p_empresa_id)
         )
       )
     );
  if v_total > 50000 then
    raise exception 'La exportación supera las 50000 filas: afiná la búsqueda' using errcode = '54000';
  end if;

  return query
  select p.id, p.numero, p.razon_social, p.cuit,
         coalesce(
           (select string_agg(e.nombre, ', ' order by e.nombre)
              from dominio.proveedores_empresas pe
              join dominio.empresas e on e.id = pe.empresa_id
             where pe.proveedor_id = p.id),
           ''
         ) as compra_para,
         p.correo, p.telefono, p.activo, v_total
    from dominio.proveedores p
   where p.organizacion_id = v_org
     and (v_estado = 'todos' or p.activo = (v_estado = 'activos'))
     and (v_patron is null
          or translate(lower(p.razon_social), 'áéíóúü', 'aeiouu') like v_patron
          or (v_patron_cuit is not null and p.cuit like v_patron_cuit))
     and (
       p_empresa_id is null
       or (
         exists (select 1 from dominio.empresas e where e.id = p_empresa_id and e.organizacion_id = v_org)
         and (
           not exists (select 1 from dominio.proveedores_empresas pe where pe.proveedor_id = p.id)
           or exists (select 1 from dominio.proveedores_empresas pf where pf.proveedor_id = p.id and pf.empresa_id = p_empresa_id)
         )
       )
     )
     and (p_despues_de is null or (lower(p.razon_social), p.id) > (v_cursor, p_despues_de))
   order by lower(p.razon_social), p.id
   limit v_limite;

  get diagnostics v_filas = row_count;

  -- Actividad: el primer lote declara el total (con los filtros, sin el texto buscado); los
  -- siguientes dejan su propia constancia. Sin filas no hay evento.
  if v_filas > 0 then
    if p_despues_de is null then
      if v_estado <> 'activos' then v_filtros := v_filtros || ('estado ' || v_estado); end if;
      if p_empresa_id is not null then
        select e.nombre into v_tienda from dominio.empresas e where e.id = p_empresa_id and e.organizacion_id = v_org;
        v_filtros := v_filtros || ('tienda ' || coalesce(v_tienda, 'no disponible'));
      end if;
      if v_texto <> '' then v_filtros := v_filtros || 'con texto'::text; end if;
      perform private.registrar_actividad(
        'proveedores.exportados',
        left(
          format('Exportó %s %s a Excel%s',
            v_total,
            case when v_total = 1 then 'proveedor' else 'proveedores' end,
            case when cardinality(v_filtros) = 0 then '' else ' (filtros: ' || array_to_string(v_filtros, ', ') || ')' end),
          480)
      );
    else
      perform private.registrar_actividad(
        'proveedores.exportados',
        format('Continuó la exportación de proveedores (%s %s)', v_filas, case when v_filas = 1 then 'fila' else 'filas' end)
      );
    end if;
  end if;
end;
$$;

comment on function public.exportar_proveedores(text, text, uuid, uuid, integer) is
  'Exportación del listado de proveedores por lotes (keyset lower(razon_social), id). Exige private.puede_accion(proveedores, exportar); acota a la organización de la sesión; tope de lote 1000 y total 50000 en cada llamada; cursor inexistente => 40001. Registra proveedores.exportados por llamada con filas. MSF-526.';

revoke execute on function public.exportar_proveedores(text, text, uuid, uuid, integer) from public, anon;
grant execute on function public.exportar_proveedores(text, text, uuid, uuid, integer) to authenticated;
