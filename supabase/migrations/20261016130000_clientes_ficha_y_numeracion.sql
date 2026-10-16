-- F-CLI-01 (MSF-262, épica MSF-180): ficha de cliente y número correlativo.
-- Esquema: `public.clientes` ya existe y se mantiene en `public` por excepción
-- documentada (specs/20261016-130000-clientes-alta-y-busqueda/spec.md, Principio
-- VII); no se crean tablas nuevas.
--
-- Migración aditiva: columnas nullable o con default, índices, funciones y
-- disparadores. Los clientes ya cargados reciben `numero` por backfill.
--
-- Reversión (en una migración posterior, no en el mismo PR; las columnas no se
-- borran aquí):
--   drop trigger clientes_normalizar on public.clientes;
--   drop trigger clientes_asignar_numero on public.clientes;
--   drop function private.normalizar_cliente();
--   drop function private.asignar_numero_cliente();
--   drop function private.documento_normalizado(text);
--   drop index public.clientes_org_documento_uq;
--   drop index public.clientes_org_numero_uq;
--   drop index public.clientes_org_nombre_idx;
--   drop index if exists public.clientes_busqueda_trgm_idx;
--   -- y, solo con los datos exportados, un `alter table public.clientes drop column ...`.

-- Pre-chequeo (informativo, no destruye nada): volumen que recorre el backfill.
--   select count(*) from public.clientes;

-- ============================================================================
-- Columnas de la ficha (FR-001, FR-015)
-- ============================================================================

alter table public.clientes
  add column if not exists numero integer,
  add column if not exists documento text,
  add column if not exists correo text,
  add column if not exists telefono text,
  add column if not exists celular text,
  add column if not exists direccion text,
  add column if not exists codigo_postal text,
  add column if not exists localidad text,
  add column if not exists provincia text,
  add column if not exists archivado_en timestamptz,
  add column if not exists updated_at timestamptz not null default now();

alter table public.clientes
  add constraint clientes_largos_ck check (
    length(nombre) <= 200
    and length(documento) <= 40
    and length(correo) <= 200
    and length(telefono) <= 60
    and length(celular) <= 60
    and length(direccion) <= 200
    and length(codigo_postal) <= 20
    and length(localidad) <= 120
    and length(provincia) <= 120
  ) not valid;
-- NOT VALID: rige para altas y ediciones nuevas sin abortar el despliegue si algún
-- cliente heredado supera el tope (nombre no tenía límite). Validar aparte, tras
-- auditar: alter table public.clientes validate constraint clientes_largos_ck;

-- ============================================================================
-- Número correlativo por organización (FR-002)
-- ============================================================================

-- Backfill ANTES de crear los disparadores: ordena por alta, desempata por id.
with ordenados as (
  select id, row_number() over (partition by organizacion_id order by created_at, id) as n
  from public.clientes
)
update public.clientes c
   set numero = o.n
  from ordenados o
 where o.id = c.id
   and c.numero is null;

alter table public.clientes alter column numero set not null;

create unique index clientes_org_numero_uq on public.clientes (organizacion_id, numero);

create or replace function private.asignar_numero_cliente()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.numero is null then
    -- Serializa las altas de la misma organización: sin saltos duplicados bajo
    -- concurrencia ni en inserciones sin sesión (importación, API).
    perform pg_advisory_xact_lock(hashtext(new.organizacion_id::text));
    select coalesce(max(c.numero), 0) + 1
      into new.numero
      from public.clientes c
     where c.organizacion_id = new.organizacion_id;
  end if;
  return new;
end;
$$;

revoke execute on function private.asignar_numero_cliente() from public, anon, authenticated;

create trigger clientes_asignar_numero
  before insert on public.clientes
  for each row execute function private.asignar_numero_cliente();

-- ============================================================================
-- Normalización de campos (FR-001, FR-016)
-- ============================================================================

create or replace function private.normalizar_cliente()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.nombre := btrim(new.nombre);
  if new.nombre = '' then
    raise exception 'El nombre del cliente no puede estar vacío' using errcode = '23514';
  end if;
  new.documento := nullif(btrim(new.documento), '');
  new.correo := nullif(btrim(new.correo), '');
  new.telefono := nullif(btrim(new.telefono), '');
  new.celular := nullif(btrim(new.celular), '');
  new.direccion := nullif(btrim(new.direccion), '');
  new.codigo_postal := nullif(btrim(new.codigo_postal), '');
  new.localidad := nullif(btrim(new.localidad), '');
  new.provincia := nullif(btrim(new.provincia), '');
  if tg_op = 'UPDATE' then
    new.updated_at := now();
  end if;
  return new;
end;
$$;

revoke execute on function private.normalizar_cliente() from public, anon, authenticated;

create trigger clientes_normalizar
  before insert or update on public.clientes
  for each row execute function private.normalizar_cliente();

-- ============================================================================
-- Unicidad de DNI/CUIT por organización (FR-016)
-- ============================================================================

-- Compara solo letras y dígitos (ignora puntos, guiones y espacios). Vacío → nulo.
create or replace function private.documento_normalizado(p_documento text)
returns text
language sql
immutable
set search_path = ''
as $$
  select nullif(regexp_replace(lower(btrim(p_documento)), '[^0-9a-z]', '', 'g'), '');
$$;

revoke execute on function private.documento_normalizado(text) from public, anon;
-- La evalúa el índice con el rol de quien escribe.
grant execute on function private.documento_normalizado(text) to authenticated;

-- Incluye archivados, para que restaurar nunca choque. Columna nueva: sin
-- backfill ni conflicto previo.
create unique index clientes_org_documento_uq
  on public.clientes (organizacion_id, (private.documento_normalizado(documento)))
  where private.documento_normalizado(documento) is not null;

-- ============================================================================
-- Índices de orden y búsqueda (FR-007)
-- ============================================================================

create index clientes_org_nombre_idx on public.clientes (organizacion_id, lower(nombre), id);

-- Búsqueda parcial: GIN trigram solo si pg_trgm está disponible en el Postgres
-- self-hosted; si no, queda el btree y se documenta el volumen (T019 lo mide).
do $$
declare
  v_esquema text;
begin
  select n.nspname into v_esquema
    from pg_extension e join pg_namespace n on n.oid = e.extnamespace
   where e.extname = 'pg_trgm';
  if v_esquema is not null then
    execute format(
      'create index clientes_busqueda_trgm_idx on public.clientes using gin '
      '((lower(coalesce(nombre, '''') || '' '' || coalesce(documento, '''') || '' '' || coalesce(correo, '''') || '' '' '
      '|| coalesce(telefono, '''') || '' '' || coalesce(celular, '''') || '' '' || coalesce(localidad, '''') || '' '' '
      '|| numero::text)) %I.gin_trgm_ops)',
      v_esquema
    );
  end if;
end;
$$;
