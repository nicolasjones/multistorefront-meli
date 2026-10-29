-- F-CLI-05 · Clientes habilitados en empresas/tiendas (spec
-- 20261018-070000-clientes-empresas, historia MSF-180 fidelidad).
--
-- El prototipo (`design/pantallas/Clientes.dc.html` y `ClienteFicha.dc.html`)
-- muestra la columna «Tiendas» y el bloque «Habilitado en» del formulario. Hasta
-- ahora un cliente era solo de la organización; faltaba la relación explícita
-- cliente ↔ empresa (tienda) que el prototipo ya da por sentada.
--
-- Esquemas (Principio VII), verificados tabla por tabla:
--   clientes_empresas   public  (nueva)  relación transversal de plataforma, como
--                                       usuarios_empresas: se lee desde Clientes y
--                                       la escribe solo una RPC.
--   clientes            public  (existente) solo se lee para validar pertenencia.
--   dominio.empresas    dominio (existente) solo se referencia, no se altera.
-- Funciones RPC en `public`; helpers/validación en `private`.
--
-- Migración aditiva: crea una tabla nueva, un disparador y dos funciones; además
-- reemplaza `buscar_clientes` (mismo nombre y firma de entrada; cambia el tipo de
-- retorno para exponer `empresas`, por eso se dropea y recrea). No se borra ni se
-- altera ninguna columna existente.
--
-- Camino de reversión (migración posterior; no se ejecuta en el mismo PR):
--   drop function public.guardar_empresas_de_cliente(uuid, uuid[]);
--   drop function private.validar_cliente_empresa();
--   drop trigger clientes_empresas_validar on public.clientes_empresas;
--   drop table public.clientes_empresas;
--   restaurar public.buscar_clientes(text, text, boolean, integer, integer) a su
--     definición de 20261017120001_clientes_expreso_preferido.sql (sin `empresas`).
-- El drop de la tabla se lleva las asignaciones cliente↔tienda (dato nuevo; no
-- había filas antes de esta migración).

-- ============================================================================
-- Tabla de relación (FR-001). PK compuesta: un cliente no repite tienda.
-- ============================================================================

create table public.clientes_empresas (
  cliente_id uuid not null references public.clientes (id) on delete cascade,
  empresa_id uuid not null references dominio.empresas (id) on delete cascade,
  organizacion_id uuid not null references public.organizaciones (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (cliente_id, empresa_id)
);

-- La relación es explícita y normalizada: un cliente está habilitado en 0..N
-- tiendas de su organización. Ver `docs/clientes.md` § «Relación con empresas».
comment on table public.clientes_empresas is
  'F-CLI-05: empresa (tienda) en la que está habilitado un cliente de la organización. Relación N:M; escritura solo por public.guardar_empresas_de_cliente y lectura por Clientes (RLS por organización y sección). El cliente es único en la organización; esta tabla dice en qué tiendas puede comprar.';

-- Los FK en cascada buscan por estas columnas: sin índice serían scan completo.
create index IF NOT EXISTS clientes_empresas_empresa_id_idx on public.clientes_empresas (empresa_id);
create index IF NOT EXISTS clientes_empresas_organizacion_id_idx on public.clientes_empresas (organizacion_id);

-- FR-002: el cliente y la empresa deben ser de la organización de la fila.
-- La RPC ya valida, pero el disparador protege la tabla ante cualquier otra vía
-- de escritura (mismo patrón que private.validar_usuario_empresa).
create or replace function private.validar_cliente_empresa()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (
    select 1 from public.clientes c
    where c.id = new.cliente_id and c.organizacion_id = new.organizacion_id
  ) then
    raise exception 'El cliente no pertenece a la organización' using errcode = '23514';
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

revoke execute on function private.validar_cliente_empresa() from public, anon, authenticated;

create trigger clientes_empresas_validar
  before insert or update on public.clientes_empresas
  for each row execute function private.validar_cliente_empresa();

-- ============================================================================
-- RLS: lectura por organización y sección; escritura solo por RPC (FR-003).
-- ============================================================================

alter table public.clientes_empresas enable row level security;

create policy clientes_empresas_select on public.clientes_empresas
  for select to authenticated
  using (
    organizacion_id = (select private.organizacion_id())
    and (select private.nivel_seccion('clientes')) in ('lectura', 'edicion')
  );

-- auto_expose_new_tables = false: grants explícitos. Solo lectura para
-- `authenticated`; la escritura llega por la RPC (security definer).
revoke all on public.clientes_empresas from anon, public;
grant select on public.clientes_empresas to authenticated;

-- ============================================================================
-- Lectura en el listado (FR-004): `buscar_clientes` suma `empresas` (jsonb).
-- `create or replace` no puede cambiar el tipo de retorno: se dropea y recrea
-- con la misma firma de entrada y los grants se reponen abajo.
-- ============================================================================

drop function if exists public.buscar_clientes(text, text, boolean, integer, integer);
create function public.buscar_clientes(
  p_texto text default null,
  p_tipo text default null,
  p_archivados boolean default false,
  p_pagina integer default 1,
  p_tamano integer default 25
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
  total bigint
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
         count(*) over () as total
    from public.clientes c, parametros p
   where c.organizacion_id = (select private.organizacion_id())
     and (p_tipo is null or c.tipo = p_tipo)
     and (case when coalesce(p_archivados, false) then c.archivado_en is not null else c.archivado_en is null end)
     and (p.patron is null or lower(coalesce(c.nombre, '') || ' ' || coalesce(c.documento, '') || ' ' || coalesce(c.correo, '') || ' '
          || coalesce(c.telefono, '') || ' ' || coalesce(c.celular, '') || ' ' || coalesce(c.localidad, '') || ' '
          || coalesce(c.expreso_preferido, '') || ' ' || c.numero::text) like p.patron)
   order by lower(c.nombre), c.id
   limit (select tamano from parametros)
  offset (select (pagina - 1) * tamano from parametros)
$$;

revoke execute on function public.buscar_clientes(text, text, boolean, integer, integer) from public, anon;
grant execute on function public.buscar_clientes(text, text, boolean, integer, integer) to authenticated;

-- ============================================================================
-- Escritura (FR-005): reemplaza el conjunto de tiendas de un cliente.
-- Atómica (borra e inserta en la misma transacción) y validada en la base:
-- permiso de edición en Clientes, cliente de la organización y empresas de la
-- organización. `security definer`: un único punto de escritura auditable.
-- ============================================================================

create or replace function public.guardar_empresas_de_cliente(p_cliente_id uuid, p_empresa_ids uuid[])
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
  if v_org is null or (select private.nivel_seccion('clientes')) <> 'edicion' then
    raise exception 'No tenés permiso para editar las tiendas del cliente' using errcode = '42501';
  end if;

  if not exists (
    select 1 from public.clientes c where c.id = p_cliente_id and c.organizacion_id = v_org
  ) then
    raise exception 'El cliente no pertenece a tu organización' using errcode = 'P0002';
  end if;

  -- Sin nulos, sin repetidos y todas las empresas de la organización.
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

  delete from public.clientes_empresas ce where ce.cliente_id = p_cliente_id;

  insert into public.clientes_empresas (cliente_id, empresa_id, organizacion_id)
  select p_cliente_id, distintas.empresa_id, v_org
    from (select distinct unnest(v_empresas) as empresa_id) as distintas;

  get diagnostics v_total = row_count;
  return v_total;
end;
$$;

comment on function public.guardar_empresas_de_cliente(uuid, uuid[]) is
  'F-CLI-05: reemplaza las tiendas (empresas) donde está habilitado un cliente. Exige private.nivel_seccion(clientes) = edicion; valida cliente y empresas de la organización; normaliza (sin nulos ni repetidos); devuelve cuántas tiendas quedaron. Contrato en docs/clientes.md.';

revoke execute on function public.guardar_empresas_de_cliente(uuid, uuid[]) from public, anon;
grant execute on function public.guardar_empresas_de_cliente(uuid, uuid[]) to authenticated;

-- ============================================================================
-- Datos existentes (FR-006): los clientes ya cargados no tenían noción de tienda.
-- Se los habilita en todas las empresas de su organización para conservar el
-- comportamiento previo (sin restricción por tienda). Los clientes nuevos eligen
-- sus tiendas desde el formulario.
-- ============================================================================

insert into public.clientes_empresas (cliente_id, empresa_id, organizacion_id)
select c.id, e.id, c.organizacion_id
  from public.clientes c
  join dominio.empresas e on e.organizacion_id = c.organizacion_id
on conflict do nothing;
