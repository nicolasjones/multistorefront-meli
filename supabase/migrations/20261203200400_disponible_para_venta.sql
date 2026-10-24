-- F-VTA-06 (MSF-295, épica MSF-159, spec 20261023-100000-ventas-comprobantes, FR-017):
-- `public.disponible_para_venta`, el stock que se puede vender de un producto en un depósito.
--
-- Esquema (Principio VII): sin tablas nuevas; solo lee `dominio.existencias_deposito` (MSF-292).
--
-- disponible = existencias del depósito − reservado (la misma cuenta que `private.disponibilidad_producto`
-- pero por depósito). Solo lectura. Exige `ventas` en `lectura` o `edicion`; la organización sale de la
-- sesión. Producto o depósito inexistentes o de otra organización → null (no se filtra su existencia). Un
-- par sin fila de existencias es 0, no null: el depósito existe pero no tiene unidades.
--
-- Migración aditiva. Reversión (migración posterior):
--   drop function public.disponible_para_venta(uuid, uuid);

create or replace function public.disponible_para_venta(p_producto_id uuid, p_deposito_id uuid)
returns integer
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_org uuid := (select private.organizacion_id());
begin
  if v_org is null or (select auth.uid()) is null then
    raise exception 'Necesitás una sesión con organización para ver el stock disponible' using errcode = '42501';
  end if;
  if (select private.nivel_seccion('ventas')) not in ('lectura', 'edicion') then
    raise exception 'Tu rol no puede ver el stock disponible para ventas' using errcode = '42501';
  end if;
  if not exists (select 1 from dominio.productos p where p.id = p_producto_id and p.organizacion_id = v_org)
     or not exists (select 1 from dominio.depositos d where d.id = p_deposito_id and d.organizacion_id = v_org) then
    return null;
  end if;

  return coalesce(
    (
      select greatest(e.cantidad - e.reservado, 0)
        from dominio.existencias_deposito e
       where e.producto_id = p_producto_id
         and e.deposito_id = p_deposito_id
         and e.organizacion_id = v_org
    ),
    0
  );
end;
$$;

revoke execute on function public.disponible_para_venta(uuid, uuid) from public, anon;
grant execute on function public.disponible_para_venta(uuid, uuid) to authenticated;

comment on function public.disponible_para_venta(uuid, uuid) is
  'Stock vendible de un producto en un depósito = existencias − reservado (F-VTA-06, FR-017). Solo lectura; null si producto o depósito no son de la organización.';
