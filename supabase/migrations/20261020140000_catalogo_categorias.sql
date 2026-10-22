-- F-CAT-08 (MSF-298, épica MSF-160): categorías del catálogo (árbol de 2 niveles) y su visibilidad por tienda.
-- Esquemas (Principio VII), verificados tabla por tabla:
--   dominio.categorias          dominio (nueva)  estructura de negocio del catálogo (menú de cada tienda).
--   dominio.categorias_empresa  dominio (nueva)  visibilidad de una categoría por empresa (tienda).
-- Ninguna tabla va a `public`. RLS por organización y por la sección de permisos `categorias`
-- (nunca `puede_escribir()`), FKs compuestas con `organizacion_id` (una fila no cruza organizaciones),
-- `anon` sin privilegios.
--
-- Reglas que garantiza la BASE aunque la pantalla falle (FR-015, FR-016):
--   * nombre recortado, no vacío, único por nivel `(organizacion_id, padre, lower(btrim(nombre)))`;
--   * máximo 2 niveles: el padre debe ser raíz, una categoría con hijos no puede tener padre y nadie es
--     su propio padre (sin ciclos). Se valida sobre el estado FINAL de la transacción (disparador de
--     restricción diferido), así un reordenado válido no falla por estados intermedios;
--   * toda escritura toma un candado asesor por organización que dura hasta el commit: dos
--     reordenados/ediciones simultáneos se serializan y el segundo valida contra lo ya confirmado.
--
-- Migración aditiva. Reversión (migración posterior, solo mientras no haya datos productivos):
--   drop table dominio.categorias_empresa;
--   drop table dominio.categorias;
--   drop function private.normalizar_categoria();
--   drop function private.validar_categorias_dos_niveles();

create table dominio.categorias (
  id uuid primary key default gen_random_uuid(),
  organizacion_id uuid not null references public.organizaciones (id) on delete cascade,
  nombre text not null check (btrim(nombre) <> '' and length(nombre) <= 100),
  padre_id uuid,
  posicion integer not null default 0 check (posicion >= 0),
  creado_en timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, organizacion_id),
  -- El padre es de la misma organización. Si se borra el padre, el hijo sube a raíz.
  foreign key (padre_id, organizacion_id)
    references dominio.categorias (id, organizacion_id) on delete set null (padre_id)
);

comment on table dominio.categorias is
  'F-CAT-08: categorías del catálogo, hasta 2 niveles (raíz y subcategoría). Escritura por public.guardar_categoria / reordenar_categorias / eliminar_categoria; lectura por RLS de organización y sección categorias.';

-- Nombre único por nivel, sin distinguir mayúsculas ni espacios extremos (raíz = padre nulo).
create unique index categorias_nombre_nivel_uk
  on dominio.categorias (organizacion_id, coalesce(padre_id, '00000000-0000-0000-0000-000000000000'::uuid), lower(btrim(nombre)));
create index categorias_orden_idx on dominio.categorias (organizacion_id, padre_id, posicion, id);

-- Normaliza al escribir y serializa las escrituras por organización (la base es la autoridad).
create or replace function private.normalizar_categoria()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.nombre := btrim(new.nombre);
  if new.nombre = '' then
    raise exception 'El nombre de la categoría no puede estar vacío' using errcode = '23514';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('categorias:' || new.organizacion_id::text, 0));
  if tg_op = 'UPDATE' then
    new.updated_at := clock_timestamp();
  end if;
  return new;
end;
$$;

revoke execute on function private.normalizar_categoria() from public, anon, authenticated;

create trigger categorias_normalizar
  before insert or update on dominio.categorias
  for each row execute function private.normalizar_categoria();

-- Máximo 2 niveles y sin ciclos, sobre el estado final (diferido hasta el commit o hasta
-- `set constraints categorias_dos_niveles immediate`, que usan las RPC para fallar con su mensaje).
create or replace function private.validar_categorias_dos_niveles()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_padre uuid;
begin
  select c.padre_id into v_padre from dominio.categorias c where c.id = new.id;
  if not found or v_padre is null then
    -- Raíz (o ya borrada): nada que validar desde esta fila.
    return null;
  end if;
  if v_padre = new.id then
    raise exception 'Una categoría no puede ser su propia categoría padre' using errcode = '23514';
  end if;
  if exists (select 1 from dominio.categorias p where p.id = v_padre and p.padre_id is not null) then
    raise exception 'Las categorías admiten hasta 2 niveles: elegí una categoría raíz como padre' using errcode = '23514';
  end if;
  if exists (select 1 from dominio.categorias h where h.padre_id = new.id) then
    raise exception 'Una categoría con subcategorías no puede tener categoría padre (máximo 2 niveles)' using errcode = '23514';
  end if;
  return null;
end;
$$;

revoke execute on function private.validar_categorias_dos_niveles() from public, anon, authenticated;

create constraint trigger categorias_dos_niveles
  after insert or update of padre_id on dominio.categorias
  deferrable initially deferred
  for each row execute function private.validar_categorias_dos_niveles();

alter table dominio.categorias enable row level security;

create policy categorias_select on dominio.categorias
  for select to authenticated
  using (
    organizacion_id = (select private.organizacion_id())
    and (select private.nivel_seccion('categorias')) in ('lectura', 'edicion')
  );

create policy categorias_insert on dominio.categorias
  for insert to authenticated
  with check (
    organizacion_id = (select private.organizacion_id())
    and (select private.nivel_seccion('categorias')) = 'edicion'
  );

create policy categorias_update on dominio.categorias
  for update to authenticated
  using (
    organizacion_id = (select private.organizacion_id())
    and (select private.nivel_seccion('categorias')) = 'edicion'
  )
  with check (
    organizacion_id = (select private.organizacion_id())
    and (select private.nivel_seccion('categorias')) = 'edicion'
  );

create policy categorias_delete on dominio.categorias
  for delete to authenticated
  using (
    organizacion_id = (select private.organizacion_id())
    and (select private.nivel_seccion('categorias')) = 'edicion'
  );

-- ============================================================================
-- Visibilidad por tienda (FR-017): una categoría sin filas no se ve en ninguna tienda.
-- ============================================================================

create table dominio.categorias_empresa (
  categoria_id uuid not null,
  empresa_id uuid not null,
  organizacion_id uuid not null references public.organizaciones (id) on delete cascade,
  creado_en timestamptz not null default now(),
  primary key (categoria_id, empresa_id),
  foreign key (categoria_id, organizacion_id)
    references dominio.categorias (id, organizacion_id) on delete cascade,
  foreign key (empresa_id, organizacion_id)
    references dominio.empresas (id, organizacion_id) on delete cascade
);

comment on table dominio.categorias_empresa is
  'F-CAT-08: tiendas (empresas) donde se ve una categoría. Sin UPDATE: se agrega o se quita. Escritura por public.guardar_categoria.';

create index categorias_empresa_empresa_idx on dominio.categorias_empresa (empresa_id, categoria_id);
create index categorias_empresa_org_idx on dominio.categorias_empresa (organizacion_id);

alter table dominio.categorias_empresa enable row level security;

create policy categorias_empresa_select on dominio.categorias_empresa
  for select to authenticated
  using (
    organizacion_id = (select private.organizacion_id())
    and (select private.nivel_seccion('categorias')) in ('lectura', 'edicion')
  );

create policy categorias_empresa_insert on dominio.categorias_empresa
  for insert to authenticated
  with check (
    organizacion_id = (select private.organizacion_id())
    and (select private.nivel_seccion('categorias')) = 'edicion'
  );

create policy categorias_empresa_delete on dominio.categorias_empresa
  for delete to authenticated
  using (
    organizacion_id = (select private.organizacion_id())
    and (select private.nivel_seccion('categorias')) = 'edicion'
  );

-- Sin privilegios para anon, columnas explícitas y sin UPDATE en categorias_empresa.
revoke all on dominio.categorias, dominio.categorias_empresa from public, anon, authenticated;
grant select, delete on dominio.categorias to authenticated;
grant insert (id, organizacion_id, nombre, padre_id, posicion) on dominio.categorias to authenticated;
grant update (nombre, padre_id, posicion) on dominio.categorias to authenticated;
grant select, delete on dominio.categorias_empresa to authenticated;
grant insert (categoria_id, empresa_id, organizacion_id) on dominio.categorias_empresa to authenticated;
