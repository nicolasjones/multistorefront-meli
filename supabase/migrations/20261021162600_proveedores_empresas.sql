-- MSF-524 (seguimiento de MSF-205, T029/FR-020): «Compra para» en el proveedor.
-- El prototipo (`design/pantallas/Proveedores.dc.html`) muestra, por proveedor, las
-- tiendas (empresas) para las que se le compra: selector en Nuevo/Editar, columna con
-- chips y filtro por tienda en el listado. Es un dato INFORMATIVO (no restringe el
-- ingreso de mercadería; eso, si se pide, es otra historia).
--
-- Esquemas (Principio VII), verificados tabla por tabla:
--   dominio.proveedores_empresas  dominio (nueva)     relación del negocio (a qué tienda
--                                                     se le compra a quién), junto a
--                                                     dominio.proveedores.
--   dominio.proveedores           dominio (existente) solo se lee para validar pertenencia.
--   dominio.empresas              dominio (existente) solo se referencia.
-- RPC en `public`; el disparador de validación en `private`.
--
-- Migración aditiva: tabla, índices, disparador y función nuevos; reemplaza
-- `listar_proveedores` (se dropea y recrea: cambia el tipo de retorno y suma un
-- parámetro con default, los llamadores por nombre siguen funcionando).
-- Los proveedores existentes quedan sin tiendas marcadas (no se inventa un dato).
--
-- Camino de reversión (migración posterior; no se ejecuta en este PR):
--   drop function public.guardar_empresas_de_proveedor(uuid, uuid[]);
--   drop trigger proveedores_empresas_validar on dominio.proveedores_empresas;
--   drop function private.validar_proveedor_empresa();
--   drop table dominio.proveedores_empresas;
--   restaurar public.listar_proveedores(text, text, integer, integer) a su definición de
--     20261021161900_proveedores_listar.sql (sin `empresas` ni filtro por tienda).
-- El drop de la tabla se lleva las marcas «Compra para» (dato nuevo de este PR).

-- ============================================================================
-- Relación proveedor ↔ tienda. PK compuesta: un proveedor no repite tienda.
-- ============================================================================

create table dominio.proveedores_empresas (
  proveedor_id uuid not null references dominio.proveedores (id) on delete cascade,
  empresa_id uuid not null references dominio.empresas (id) on delete cascade,
  organizacion_id uuid not null references public.organizaciones (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (proveedor_id, empresa_id)
);

comment on table dominio.proveedores_empresas is
  'MSF-524: tiendas (empresas) para las que se le compra a un proveedor («Compra para»). Relación N:M informativa; escritura solo por public.guardar_empresas_de_proveedor, lectura por RLS de organización y sección proveedores.';

-- Los FK en cascada buscan por estas columnas: sin índice serían scan completo.
create index IF NOT EXISTS proveedores_empresas_empresa_id_idx on dominio.proveedores_empresas (empresa_id);
create index IF NOT EXISTS proveedores_empresas_organizacion_id_idx on dominio.proveedores_empresas (organizacion_id);

-- El proveedor y la empresa deben ser de la organización de la fila. La RPC ya valida,
-- pero el disparador protege la tabla ante cualquier otra vía de escritura.
create or replace function private.validar_proveedor_empresa()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (
    select 1 from dominio.proveedores p
    where p.id = new.proveedor_id and p.organizacion_id = new.organizacion_id
  ) then
    raise exception 'El proveedor no pertenece a la organización' using errcode = '23514';
  end if;
  if not exists (
    select 1 from dominio.empresas e
    where e.id = new.empresa_id and e.organizacion_id = new.organizacion_id
  ) then
    raise exception 'La empresa no pertenece a la organización' using errcode = '23514';
  end if;
  return new;
end;
$$;

revoke execute on function private.validar_proveedor_empresa() from public, anon, authenticated;

create trigger proveedores_empresas_validar
  before insert or update on dominio.proveedores_empresas
  for each row execute function private.validar_proveedor_empresa();

-- ============================================================================
-- RLS: lectura por organización y sección; escritura solo por RPC.
-- ============================================================================

alter table dominio.proveedores_empresas enable row level security;

create policy proveedores_empresas_select on dominio.proveedores_empresas
  for select to authenticated
  using (
    organizacion_id = (select private.organizacion_id())
    and (select private.nivel_seccion('proveedores')) in ('lectura', 'edicion')
  );

revoke all on dominio.proveedores_empresas from public, anon, authenticated;
grant select on dominio.proveedores_empresas to authenticated;

-- ============================================================================
-- Escritura: reemplaza el conjunto de tiendas de un proveedor (atómica).
-- ============================================================================

create or replace function public.guardar_empresas_de_proveedor(p_proveedor_id uuid, p_empresa_ids uuid[])
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid := (select private.organizacion_id());
  v_empresas uuid[] := coalesce(p_empresa_ids, '{}'::uuid[]);
  v_total integer;
begin
  if v_org is null or (select private.nivel_seccion('proveedores')) <> 'edicion' then
    raise exception 'No tenés permiso para editar las tiendas del proveedor' using errcode = '42501';
  end if;

  if not exists (
    select 1 from dominio.proveedores p where p.id = p_proveedor_id and p.organizacion_id = v_org
  ) then
    raise exception 'El proveedor no pertenece a tu organización' using errcode = 'P0002';
  end if;

  -- Sin nulos y todas las empresas de la organización.
  if exists (
    select 1
      from unnest(v_empresas) as x(empresa_id)
     where empresa_id is null
        or not exists (
          select 1 from dominio.empresas e
          where e.id = empresa_id and e.organizacion_id = v_org
        )
  ) then
    raise exception 'Alguna de las tiendas no pertenece a tu organización' using errcode = '42501';
  end if;

  delete from dominio.proveedores_empresas pe where pe.proveedor_id = p_proveedor_id;

  insert into dominio.proveedores_empresas (proveedor_id, empresa_id, organizacion_id)
  select p_proveedor_id, distintas.empresa_id, v_org
    from (select distinct unnest(v_empresas) as empresa_id) as distintas;

  get diagnostics v_total = row_count;
  return v_total;
end;
$$;

comment on function public.guardar_empresas_de_proveedor(uuid, uuid[]) is
  'MSF-524: reemplaza las tiendas «Compra para» de un proveedor. Exige private.nivel_seccion(proveedores) = edicion; valida proveedor y empresas de la organización; normaliza repetidos; devuelve cuántas quedaron.';

revoke execute on function public.guardar_empresas_de_proveedor(uuid, uuid[]) from public, anon;
grant execute on function public.guardar_empresas_de_proveedor(uuid, uuid[]) to authenticated;

-- ============================================================================
-- Listado: suma `empresas` (jsonb id+nombre) y el filtro opcional por tienda.
-- security invoker: hereda la RLS de proveedores y de proveedores_empresas.
-- ============================================================================

drop function if exists public.listar_proveedores(text, text, integer, integer);
create function public.listar_proveedores(
  p_busqueda text default null,
  p_estado text default 'activos',
  p_pagina integer default 1,
  p_tamano integer default 25,
  p_empresa_id uuid default null
)
returns table (
  id uuid,
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
  select p.id, p.razon_social, p.cuit, p.correo, p.telefono, p.activo,
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
     and (p_empresa_id is null
          or exists (
            select 1 from dominio.proveedores_empresas pf
             where pf.proveedor_id = p.id and pf.empresa_id = p_empresa_id
          ))
   order by lower(p.razon_social), p.id
   limit v_tamano
  offset (v_pagina - 1) * v_tamano;
end;
$$;

comment on function public.listar_proveedores(text, text, integer, integer, uuid) is
  'Listado paginado de proveedores de la organización (F-PRV-02) con sus tiendas «Compra para» y filtro opcional por tienda (MSF-524). Rige la RLS de dominio.proveedores.';

revoke execute on function public.listar_proveedores(text, text, integer, integer, uuid) from public, anon;
grant execute on function public.listar_proveedores(text, text, integer, integer, uuid) to authenticated;
