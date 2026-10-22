-- F-CAT-01 (MSF-252): índices de búsqueda y orden del listado sobre `dominio.productos`.
-- Esquema (Principio VII): índices de una tabla de `dominio`; no se crean tablas.
-- Requiere pg_trgm (habilitada en 20261016160000_clientes_habilitar_pg_trgm.sql).
-- Migración aditiva. Reversión (en una migración posterior, no en este PR):
--   drop index dominio.productos_nombre_trgm_idx;
--   drop index dominio.productos_sku_trgm_idx;
--   drop index dominio.productos_org_nombre_orden_idx;
--   drop index dominio.productos_org_sku_orden_idx;
-- Nota de diseño: la app consulta la vista por PostgREST, que expresa `ilike` y `order` sobre la
-- columna cruda (no sobre `lower(col)`); por eso los índices son sobre `nombre`/`sku` tal cual.
-- Lock: `create index` no es concurrente (bloquea escrituras en productos mientras se arma).

create extension if not exists pg_trgm with schema extensions;

do $$
declare
  v_esquema text;
begin
  select n.nspname into v_esquema
    from pg_extension e join pg_namespace n on n.oid = e.extnamespace
   where e.extname = 'pg_trgm';
  if v_esquema is null then
    raise exception 'Falta pg_trgm: el listado de productos no puede indexar la búsqueda (SC-001)';
  end if;
  execute format(
    'create index productos_nombre_trgm_idx on dominio.productos using gin (nombre %I.gin_trgm_ops)',
    v_esquema);
  execute format(
    'create index productos_sku_trgm_idx on dominio.productos using gin (sku %I.gin_trgm_ops)',
    v_esquema);
end;
$$;

-- Orden por nombre / SKU con desempate estable por id (FR-005).
create index productos_org_nombre_orden_idx on dominio.productos (organizacion_id, nombre, id);
create index productos_org_sku_orden_idx on dominio.productos (organizacion_id, sku, id);
