-- F-VTA-31 (MSF-329, épica MSF-193, spec 20261027-100000-ventas-mejoras, FR-001): RPC
-- `public.buscar_producto_por_codigo_barras`, con la que la Venta de mostrador resuelve un producto
-- al escanear su código de barras EAN-13.
--
-- Esquemas (Principio VII): no se crea ni altera ninguna tabla. La RPC es de plataforma (`public`) y
-- solo lee `dominio.productos` (índice único `productos_org_codigo_barras_uidx`).
--
-- Reglas (FR-001):
-- · `security definer` + `set search_path = ''`; el aislamiento lo hacen el filtro por organización
--   de la sesión y el gate de sección, no la RLS del llamador.
-- · Exige `ventas` en `edicion` en la empresa activa (`private.nivel_seccion('ventas')`): mostrador
--   escribe un comprobante, quien solo lee no escanea para vender.
-- · Valida EAN-13 (13 dígitos): otro formato se rechaza con 22023 y `hint = 'codigo_barras'`.
-- · Solo productos activos de la organización. Sin coincidencia no devuelve filas (el cliente muestra
--   «Producto no encontrado», CA-VTA-31-1).
--
-- Migración aditiva. Reversión (en una migración posterior; no se ejecuta en este PR):
--   drop function public.buscar_producto_por_codigo_barras(text);

create or replace function public.buscar_producto_por_codigo_barras(p_codigo_barras text)
returns table (producto_id uuid, nombre text, sku text, codigo_barras text)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_org uuid := (select private.organizacion_id());
  v_codigo text := btrim(coalesce(p_codigo_barras, ''));
begin
  if v_org is null or (select auth.uid()) is null then
    raise exception 'Necesitás una sesión con organización para vender en el mostrador' using errcode = '42501';
  end if;
  if (select private.nivel_seccion('ventas')) <> 'edicion' then
    raise exception 'Tu rol no puede vender en el mostrador de esta tienda' using errcode = '42501';
  end if;
  if v_codigo !~ '^[0-9]{13}$' then
    raise exception 'El código de barras debe tener 13 dígitos (EAN-13)' using errcode = '22023', hint = 'codigo_barras';
  end if;

  return query
  select p.id, p.nombre, p.sku, p.codigo_barras
    from dominio.productos p
   where p.organizacion_id = v_org
     and p.codigo_barras = v_codigo
     and p.activo;
end;
$$;

revoke execute on function public.buscar_producto_por_codigo_barras(text) from public, anon;
grant execute on function public.buscar_producto_por_codigo_barras(text) to authenticated;

comment on function public.buscar_producto_por_codigo_barras(text) is
  'F-VTA-31 (FR-001): resuelve un producto activo de la organización por su EAN-13 para la Venta de mostrador. Exige ventas en edición en la empresa activa; sin coincidencia no devuelve filas.';
