-- F-SVC-10 (MSF-390, épica MSF-217, FR-006): `depositos_para_repuesto`, el selector de depósito del diálogo
-- «Agregar repuesto».
--
-- Esquema: sin tablas nuevas (solo lee `dominio.depositos` y `dominio.existencias_deposito`; Principio VII).
--
-- Devuelve los depósitos ACTIVOS de la organización con `cantidad`, `reservado` y `disponible` (cantidad −
-- reservado) del producto, ordenados con el depósito por defecto primero. Gate: `service_tecnico` en `lectura` o
-- `edicion` — el técnico no necesita acceso a Stock, por eso no se usa `stock_por_deposito`. Producto de otra
-- organización o inexistente: `P0002`. `security definer`, `search_path = ''`, sin `anon`.
--
-- Migración aditiva. Reversión (migración posterior):
--   drop function public.depositos_para_repuesto(uuid);

create or replace function public.depositos_para_repuesto(p_producto_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_org uuid := (select private.organizacion_id());
begin
  if v_org is null or (select auth.uid()) is null
     or (select private.nivel_seccion('service_tecnico')) not in ('lectura', 'edicion') then
    raise exception 'Tu rol no puede consultar los depósitos de Service' using errcode = '42501';
  end if;
  if not exists (select 1 from dominio.productos p where p.id = p_producto_id and p.organizacion_id = v_org) then
    raise exception 'El producto no existe' using errcode = 'P0002';
  end if;

  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'deposito_id', d.id,
      'nombre', d.nombre,
      'por_defecto', d.por_defecto,
      'cantidad', coalesce(x.cantidad, 0),
      'reservado', coalesce(x.reservado, 0),
      'disponible', coalesce(x.cantidad, 0) - coalesce(x.reservado, 0)
    ) order by d.por_defecto desc, lower(d.nombre), d.id)
    from dominio.depositos d
    left join dominio.existencias_deposito x
      on x.deposito_id = d.id and x.producto_id = p_producto_id and x.organizacion_id = d.organizacion_id
    where d.organizacion_id = v_org and d.activo
  ), '[]'::jsonb);
end;
$$;

comment on function public.depositos_para_repuesto(uuid) is
  'F-SVC-10: depósitos activos con cantidad, reservado y disponible de un producto, para el selector de «Agregar repuesto». Gate service_tecnico lectura/edicion.';

revoke execute on function public.depositos_para_repuesto(uuid) from public, anon;
grant execute on function public.depositos_para_repuesto(uuid) to authenticated;
