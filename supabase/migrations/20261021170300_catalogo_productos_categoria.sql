-- F-CAT-08 (MSF-298, épica MSF-160): categoría de cada producto.
-- Esquemas (Principio VII), verificados objeto por objeto:
--   dominio.productos.categoria_id  dominio (columna aditiva)  la tabla ya vive en `dominio`; FK compuesta
--                                                              (categoria_id, organizacion_id) a dominio.categorias.
--   public.v_productos_listado      public (VISTA, no tabla)   se reemplaza con `create or replace view`
--                                                              conservando TODAS las columnas previas y
--                                                              agregando las de categoría AL FINAL.
--   public.v_categorias_productos   public (VISTA, no tabla)   conteo de productos por categoría.
-- No se crea ninguna tabla. Ambas vistas son `security_invoker = true` (rige la RLS de las tablas base),
-- sin `anon` y sin costo.
--
-- `on delete set null (categoria_id)`: al borrar una categoría el producto queda sin categoría (FR-021);
-- la acción referencial solo toca `categoria_id` (no `organizacion_id`, que es NOT NULL). Soportado desde
-- Postgres 15 (el self-hosted usa 17, supabase/config.toml).
--
-- `actualizar_producto`/`crear_producto` NO se alteran: la categoría se asigna con la RPC
-- `public.asignar_categoria_producto`. Cambiar solo `categoria_id` no avanza `updated_at` del producto
-- (`conservar_updated_at_producto` lo conserva) ni deja `producto.editado`: el evento propio es
-- `producto.categoria_asignada`.
--
-- Migración aditiva. Reversión (migración posterior):
--   create or replace view public.v_productos_listado ... (definición de 20261021165800, sin categoría);
--   drop view public.v_categorias_productos;
--   drop trigger productos_actividad_categoria on dominio.productos;
--   drop function private.registrar_actividad_producto_categoria();
--   drop function public.asignar_categoria_producto(uuid, uuid);
--   alter table dominio.productos drop column categoria_id;   (pierde la asignación: exportarla antes)

alter table dominio.productos add column IF NOT EXISTS categoria_id uuid;

alter table dominio.productos
  add constraint productos_categoria_fk
  foreign key (categoria_id, organizacion_id)
  references dominio.categorias (id, organizacion_id) on delete set null (categoria_id);

comment on column dominio.productos.categoria_id is
  'F-CAT-08: categoría del producto (opcional, raíz o subcategoría). Se asigna con public.asignar_categoria_producto; al borrar la categoría queda en null.';

-- Filtro por categoría del listado y conteos del árbol.
create index IF NOT EXISTS productos_categoria_idx on dominio.productos (organizacion_id, categoria_id) where categoria_id is not null;

grant update (categoria_id) on dominio.productos to authenticated;

-- ============================================================================
-- RPC: asignar (o quitar) la categoría de un producto
-- ============================================================================

create or replace function public.asignar_categoria_producto(p_producto_id uuid, p_categoria_id uuid)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_org uuid := (select private.organizacion_id());
begin
  if v_org is null or (select private.nivel_seccion('productos')) <> 'edicion' then
    raise exception 'Tu rol no puede editar productos' using errcode = '42501';
  end if;
  if not exists (select 1 from dominio.productos p where p.id = p_producto_id and p.organizacion_id = v_org) then
    raise exception 'El producto no existe' using errcode = 'P0002';
  end if;
  if p_categoria_id is not null and not exists (
    select 1 from dominio.categorias c where c.id = p_categoria_id and c.organizacion_id = v_org
  ) then
    raise exception 'La categoría no existe' using errcode = 'P0002';
  end if;

  -- Solo si cambia: repetir la misma categoría no escribe ni deja evento (idempotente).
  update dominio.productos p
     set categoria_id = p_categoria_id
   where p.id = p_producto_id and p.organizacion_id = v_org
     and p.categoria_id is distinct from p_categoria_id;

  return p_categoria_id;
end;
$$;

comment on function public.asignar_categoria_producto(uuid, uuid) is
  'F-CAT-08: asigna (o quita, con null) la categoría de un producto. Exige edición en productos; P0002 producto o categoría inexistentes. Idempotente.';

revoke execute on function public.asignar_categoria_producto(uuid, uuid) from public, anon;
grant execute on function public.asignar_categoria_producto(uuid, uuid) to authenticated;

-- Actividad: `producto.categoria_asignada` solo ante un cambio real. La baja de una categoría
-- (eliminar_categoria marca `catalogo.cat_ctx = 'eliminar'`) la cubre `categoria.eliminada`.
create or replace function private.registrar_actividad_producto_categoria()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := (select auth.uid());
  v_ruta text;
begin
  if v_actor is null
     or new.categoria_id is not distinct from old.categoria_id
     or coalesce(current_setting('catalogo.cat_ctx', true), '') = 'eliminar' then
    return new;
  end if;
  v_ruta := case when new.categoria_id is null then null else private.ruta_categoria(new.categoria_id) end;
  perform private.insertar_actividad(
    new.organizacion_id, v_actor, 'producto.categoria_asignada',
    format('%s %s%s',
      case when v_ruta is null then 'Quitó la categoría del producto' else 'Asignó la categoría ' || v_ruta || ' al producto' end,
      new.nombre,
      case when new.sku is null then '' else format(' (SKU %s)', new.sku) end),
    null
  );
  return new;
end;
$$;

revoke execute on function private.registrar_actividad_producto_categoria() from public, anon, authenticated;

create trigger productos_actividad_categoria
  after update of categoria_id on dominio.productos
  for each row execute function private.registrar_actividad_producto_categoria();

-- ============================================================================
-- Vistas
-- ============================================================================

create or replace view public.v_productos_listado
with (security_invoker = true) as
select
  p.id,
  p.organizacion_id,
  p.nombre,
  p.sku,
  p.activo,
  (select i.ruta
     from dominio.producto_imagenes i
    where i.producto_id = p.id and i.organizacion_id = p.organizacion_id
    order by i.posicion
    limit 1) as imagen_ruta,
  p.updated_at,
  coalesce(
    (select array_agg(pe.empresa_id order by pe.empresa_id)
       from dominio.producto_empresa pe
      where pe.producto_id = p.id and pe.organizacion_id = p.organizacion_id),
    '{}'::uuid[]
  ) as empresa_ids,
  -- F-CAT-08: categoría (id, ruta «Padre > Hija» y [id, padre] para que el filtro de una raíz incluya sus subcategorías).
  p.categoria_id,
  (select case when cp.id is null then c.nombre else cp.nombre || ' > ' || c.nombre end
     from dominio.categorias c
     left join dominio.categorias cp on cp.id = c.padre_id and cp.organizacion_id = c.organizacion_id
    where c.id = p.categoria_id and c.organizacion_id = p.organizacion_id) as categoria_ruta,
  (select array_remove(array[c.id, c.padre_id], null)
     from dominio.categorias c
    where c.id = p.categoria_id and c.organizacion_id = p.organizacion_id) as categoria_ids
from dominio.productos p;

comment on view public.v_productos_listado is
  'F-CAT-01/07/08: listado de productos (id, nombre, SKU, estado, imagen principal, empresa_ids, categoría). security_invoker: rige la RLS de las tablas base. Sin costo. Las historias siguientes agregan columnas al final.';

-- Los privilegios de la vista no cambian (20261021160030); se reafirman por si se recreara.
revoke all on public.v_productos_listado from public, anon;
grant select on public.v_productos_listado to authenticated;

-- Conteo de productos por categoría (directos; el árbol suma los de las subcategorías en la app).
create or replace view public.v_categorias_productos
with (security_invoker = true) as
select p.organizacion_id, p.categoria_id, count(*)::integer as productos
  from dominio.productos p
 where p.categoria_id is not null
 group by p.organizacion_id, p.categoria_id;

comment on view public.v_categorias_productos is
  'F-CAT-08: cantidad de productos asignados directamente a cada categoría. security_invoker: rige la RLS de dominio.productos.';

revoke all on public.v_categorias_productos from public, anon;
grant select on public.v_categorias_productos to authenticated;
