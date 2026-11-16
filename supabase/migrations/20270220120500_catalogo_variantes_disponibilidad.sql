-- F-CAT-15 (MSF-408, épica MSF-229), bloque B: el stock y la disponibilidad de un producto con variantes son la
-- suma de sus variantes ACTIVAS. FR-006, FR-010. Esquema: sin tablas nuevas; solo cambian los CUERPOS de tres
-- funciones `private` (contrato «solo cambia el cuerpo»: firmas, grants, vista del listado y tienda no cambian).
--
-- Regla: un producto «tiene variantes» si existe alguna fila en dominio.producto_variantes (aunque estén todas
-- inactivas → «Sin stock»). Sin variantes, el criterio es idéntico al vigente (cantidad − reservado > 0; en la
-- tienda, cantidad > 0). El reservado de las variantes es 0 hasta que Reservas se adapte (Decisión 5).
--
-- Migración aditiva (solo cuerpos de función). Reversión (migración posterior): restaurar los cuerpos de
-- 20261023130200_disponibilidad_con_reservas.sql (disponibilidad_producto, productos_con_stock) y de
-- 20261023150100_tienda_disponibilidad_publica.sql (disponible_publico).

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
      when exists (select 1 from dominio.producto_variantes v
                    where v.producto_id = p.id and v.organizacion_id = p.organizacion_id)
        then case
          when coalesce((select sum(x.cantidad)
                           from dominio.producto_variantes v
                           join dominio.existencias_variante x
                             on x.variante_id = v.id and x.organizacion_id = v.organizacion_id
                          where v.producto_id = p.id and v.organizacion_id = p.organizacion_id
                            and v.activa), 0) > 0
            then 'stock'
          else 'sin_stock'
        end
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
  'F-CAT-17/F-STK-16/F-CAT-15: disponibilidad del producto (a_pedido | stock_entrante | stock | sin_stock). Manual manda; con variantes, suma de las ACTIVAS > 0; si no, disponible (cantidad − reservado) > 0. Solo la etiqueta, nunca cantidades. Exige lectura en productos.';

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
     and not exists (select 1 from dominio.producto_variantes v
                      where v.producto_id = e.producto_id and v.organizacion_id = e.organizacion_id)
     and (select private.nivel_seccion('productos')) in ('lectura', 'edicion')
  union all
  select v.producto_id
    from dominio.producto_variantes v
    join dominio.existencias_variante x on x.variante_id = v.id and x.organizacion_id = v.organizacion_id
   where v.organizacion_id = (select private.organizacion_id())
     and v.activa
     and (select private.nivel_seccion('productos')) in ('lectura', 'edicion')
   group by v.producto_id
  having sum(x.cantidad) > 0;
$$;

comment on function private.productos_con_stock() is
  'F-CAT-17/F-STK-16/F-CAT-15: ids de los productos de la organización con stock: sin variantes, disponible (cantidad − reservado) > 0; con variantes, suma de las ACTIVAS > 0. Mismo criterio que private.disponibilidad_producto(uuid).';

revoke execute on function private.productos_con_stock() from public, anon;
grant execute on function private.productos_con_stock() to authenticated;

create or replace function private.disponible_publico(p_producto uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when exists (select 1 from dominio.producto_variantes v where v.producto_id = p_producto)
      then coalesce((select sum(x.cantidad)
                       from dominio.producto_variantes v
                       join dominio.existencias_variante x on x.variante_id = v.id
                      where v.producto_id = p_producto and v.activa), 0) > 0
    else exists (select 1 from dominio.existencias e where e.producto_id = p_producto and e.cantidad > 0)
  end;
$$;

comment on function private.disponible_publico(uuid) is
  'F-TDA-18/F-CAT-15: true si el producto tiene unidades disponibles (sin variantes, existencias.cantidad > 0; con variantes, suma de las ACTIVAS > 0). Solo el booleano. Sin acceso para anon/authenticated: la usan las funciones públicas.';

revoke execute on function private.disponible_publico(uuid) from public, anon, authenticated;
