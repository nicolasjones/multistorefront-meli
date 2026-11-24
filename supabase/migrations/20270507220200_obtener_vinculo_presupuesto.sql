-- Lote 39 (decisión de producto de MSF-668): «Facturar presupuesto». Parte 3: lectura del vínculo presupuesto <-> factura.
--
-- `public.obtener_vinculo_presupuesto(p_id)`: para un comprobante devuelve su vínculo:
--   * si es un presupuesto convertido: los datos de la factura generada (`factura_id`, `factura_numero`, `factura_estado`);
--   * si es una factura nacida de un presupuesto: los del presupuesto de origen (`presupuesto_id`, `presupuesto_numero`).
-- Sin vínculo (o sin acceso) devuelve cero filas: no distingue «no existe» de «ajeno». Exige `ventas` en `lectura` o `edicion` en la
-- tienda del comprobante (como `obtener_comprobante`) y el vínculo debe ser de la misma organización.
--
-- Seguridad: `stable security definer`, `search_path = ''`; revoke de public y anon, grant a authenticated.
-- Esquema (Principio VII): sin tablas; solo lee `dominio.comprobantes_venta`.
-- Migración aditiva. Reversión (migración posterior): drop function public.obtener_vinculo_presupuesto(uuid);

create or replace function public.obtener_vinculo_presupuesto(p_id uuid)
returns table (
  presupuesto_id uuid,
  presupuesto_numero text,
  factura_id uuid,
  factura_numero text,
  factura_estado text
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_org uuid := (select private.organizacion_id());
  v_c dominio.comprobantes_venta;
begin
  if v_org is null or (select auth.uid()) is null then
    raise exception 'Necesitás una sesión con organización para ver comprobantes' using errcode = '42501';
  end if;
  select * into v_c
    from dominio.comprobantes_venta c
   where c.id = p_id and c.organizacion_id = v_org;
  if not found or v_c.empresa_id is null
     or (select private.nivel_ventas_en_empresa(v_c.empresa_id)) not in ('lectura', 'edicion') then
    return;
  end if;

  if v_c.tipo = 'factura' and v_c.origen_presupuesto_id is not null then
    return query
    select p.id, p.numero, v_c.id, v_c.numero, v_c.estado
      from dominio.comprobantes_venta p
     where p.id = v_c.origen_presupuesto_id and p.organizacion_id = v_org;
  elsif v_c.tipo = 'presupuesto' then
    return query
    select v_c.id, v_c.numero, f.id, f.numero, f.estado
      from dominio.comprobantes_venta f
     where f.origen_presupuesto_id = v_c.id and f.organizacion_id = v_org;
  end if;
end;
$$;

revoke execute on function public.obtener_vinculo_presupuesto(uuid) from public, anon;
grant execute on function public.obtener_vinculo_presupuesto(uuid) to authenticated;

comment on function public.obtener_vinculo_presupuesto(uuid) is
  'Vínculo presupuesto <-> factura de un comprobante (Facturar presupuesto): la factura de un presupuesto convertido o el presupuesto de origen de una factura. Cero filas si no hay vínculo o acceso.';
