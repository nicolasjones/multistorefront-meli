-- F-STK-16 (MSF-337, épica MSF-292, spec 20261022-180000-stock-depositos-y-reservas, FR-036):
-- la disponibilidad del producto se deriva del DISPONIBLE (cantidad − reservado > 0), no de la cantidad.
-- Esquema: sin tablas nuevas; solo se reemplazan los cuerpos de dos funciones `private` de MSF-179
-- (`20261022120900_catalogo_disponibilidad.sql`), con el mismo contrato de salida.
--
-- Efecto: la etiqueta manual («A pedido» / «Stock entrante en breve») sigue mandando aun con reservas
-- activas; los productos derivados pasan a «Sin stock» cuando el disponible llega a 0. La vista
-- `public.v_productos_listado` no cambia: usa `private.productos_con_stock()`.
--
-- Migración aditiva (solo cuerpos de función). Reversión (migración posterior): restaurar los cuerpos
-- de `private.disponibilidad_producto(uuid)` y `private.productos_con_stock()` de
-- `20261022120900_catalogo_disponibilidad.sql` (`e.cantidad > 0`).

create or replace function private.disponibilidad_producto(p_producto_id uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    p.disponibilidad_manual,
    case
      when coalesce((select e.cantidad - e.reservado
                       from dominio.existencias e
                      where e.producto_id = p.id and e.organizacion_id = p.organizacion_id), 0) > 0
        then 'stock'
      else 'sin_stock'
    end
  )
    from dominio.productos p
   where p.id = p_producto_id
     and p.organizacion_id = (select private.organizacion_id())
     and (select private.nivel_seccion('productos')) in ('lectura', 'edicion');
$$;

comment on function private.disponibilidad_producto(uuid) is
  'F-CAT-17/F-STK-16: disponibilidad del producto (a_pedido | stock_entrante | stock | sin_stock) en la organización de la sesión. Manual manda; si no, disponible (existencias.cantidad − reservado) > 0. Solo la etiqueta, nunca cantidades. Exige lectura en productos; nulo si no existe o es de otra organización.';

revoke execute on function private.disponibilidad_producto(uuid) from public, anon;
grant execute on function private.disponibilidad_producto(uuid) to authenticated;

create or replace function private.productos_con_stock()
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $$
  select e.producto_id
    from dominio.existencias e
   where e.organizacion_id = (select private.organizacion_id())
     and e.cantidad - e.reservado > 0
     and (select private.nivel_seccion('productos')) in ('lectura', 'edicion');
$$;

comment on function private.productos_con_stock() is
  'F-CAT-17/F-STK-16: ids de los productos de la organización con disponible (existencias.cantidad − reservado) > 0. Para la vista del listado; mismo criterio que private.disponibilidad_producto(uuid).';

revoke execute on function private.productos_con_stock() from public, anon;
grant execute on function private.productos_con_stock() to authenticated;
