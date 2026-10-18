-- F-STK-05 (MSF-194, épica MSF-136, spec 20261017-120000-stock-movimientos,
-- FR-013, FR-014): stock mínimo por producto y vista de estados.
--
-- Esquema (Principio VII): sin tablas nuevas. `minimo` es una columna de
-- `dominio.existencias` (dominio del producto, ya con RLS por organización y por
-- `nivel_seccion('stock')`). La vista `public.stock_estados` es una vista de lectura
-- sobre tablas de `dominio`, expuesta en `public` por ser el contrato consumido por
-- otras pantallas (Inicio, MSF-156; MSF-231); no almacena datos, hereda la RLS.
--
-- `definir_minimo_stock` es SECURITY DEFINER (existencias no tiene escritura directa)
-- con `search_path = ''`: exige sesión, organización activa y
-- `nivel_seccion('stock') = 'edicion'`; la organización sale de la sesión.
-- Registra el evento `stock.minimo` solo si el valor cambia.
--
-- CONTRATO de `public.stock_estados` (security_invoker: aplica la RLS de quien consulta;
-- `anon` sin acceso; una fila por producto de la organización activa):
--   producto_id           uuid        id del producto
--   organizacion_id       uuid        organización dueña
--   nombre, sku           text        identidad visible del producto
--   activo                boolean     producto activo en el catálogo
--   cantidad              integer     stock vigente (>= 0)
--   minimo                integer     stock mínimo definido (>= 0, por defecto 0)
--   estado                text        'sin_stock'  : cantidad = 0
--                                     'stock_bajo' : cantidad > 0 y cantidad <= minimo
--                                     'disponible' : cantidad > minimo (con minimo 0, cualquier cantidad > 0)
--   ultimo_movimiento_en  timestamptz último movimiento registrado (null si nunca tuvo)
-- Orden de severidad: sin_stock > stock_bajo > disponible. El estado se calcula en la
-- vista; ningún consumidor debe recalcularlo.
--
-- Migración aditiva. Reversión (migración posterior; exportar antes los mínimos):
--   drop view public.stock_estados;
--   drop function public.definir_minimo_stock(uuid, integer);
--   alter table dominio.existencias drop column minimo;

alter table dominio.existencias
  add column minimo integer not null default 0 check (minimo >= 0);

comment on column dominio.existencias.minimo is
  'Stock mínimo del producto (F-STK-05). Por debajo o igual se considera stock bajo. Lo escribe solo definir_minimo_stock.';

create or replace function public.definir_minimo_stock(p_producto uuid, p_minimo integer)
returns dominio.existencias
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_organizacion uuid := (select private.organizacion_id());
  v_actor uuid := (select auth.uid());
  v_anterior integer;
  v_producto text;
  v_fila dominio.existencias;
begin
  if v_actor is null or v_organizacion is null
     or (select private.nivel_seccion('stock')) <> 'edicion' then
    raise exception 'Tu rol no puede definir el stock mínimo' using errcode = '42501';
  end if;
  if p_minimo is null or p_minimo < 0 then
    raise exception 'El mínimo debe ser un entero de cero o más' using errcode = '22023';
  end if;

  select e.minimo into v_anterior
    from dominio.existencias e
   where e.producto_id = p_producto and e.organizacion_id = v_organizacion
   for update;
  if not found then
    raise exception 'No encontramos ese producto' using errcode = '22023';
  end if;

  update dominio.existencias
     set minimo = p_minimo, updated_at = now()
   where producto_id = p_producto and organizacion_id = v_organizacion
  returning * into v_fila;

  if v_anterior is distinct from p_minimo then
    select p.nombre || case when p.sku is null then '' else ' (SKU ' || p.sku || ')' end
      into v_producto
      from dominio.productos p
     where p.id = p_producto;

    perform private.registrar_actividad(
      'stock.minimo',
      format('Mínimo de %s: de %s a %s unidades', v_producto, v_anterior, p_minimo)
    );
  end if;

  return v_fila;
end;
$$;

comment on function public.definir_minimo_stock(uuid, integer) is
  'F-STK-05: define el stock mínimo de un producto. Exige edición en Stock; la organización sale de la sesión.';

revoke execute on function public.definir_minimo_stock(uuid, integer) from public, anon;
grant execute on function public.definir_minimo_stock(uuid, integer) to authenticated;

create view public.stock_estados
with (security_invoker = true) as
select
  p.id as producto_id,
  p.organizacion_id,
  p.nombre,
  p.sku,
  p.activo,
  e.cantidad,
  e.minimo,
  case
    when e.cantidad = 0 then 'sin_stock'
    when e.cantidad <= e.minimo then 'stock_bajo'
    else 'disponible'
  end as estado,
  e.ultimo_movimiento_en
from dominio.productos p
join dominio.existencias e
  on e.producto_id = p.id and e.organizacion_id = p.organizacion_id;

comment on view public.stock_estados is
  'F-STK-05: stock, mínimo y estado (sin_stock / stock_bajo / disponible) por producto. security_invoker; contrato para Inicio (MSF-156) y MSF-231.';

revoke all on public.stock_estados from public, anon, authenticated;
grant select on public.stock_estados to authenticated;
