-- F-VTA-16 (MSF-166, épica MSF-135, spec 20261024-130000-ventas-despacho-y-faltantes, FR-021):
-- `public.obtener_envio_comprobante`: la lectura del transporte, la guía y la fecha de envío de un comprobante.
--
-- Por qué una RPC y no leer la tabla: la RLS de `dominio.comprobantes_venta`
-- (`supabase/migrations/20261018100000_ventas_contrato_comprobantes.sql:46-51`) resuelve organización + nivel de
-- Ventas contra la **empresa activa** de la barra superior, no contra la empresa del comprobante. Con una
-- lectura directa de la tabla, una persona con Ventas en lectura en la tienda A podía leer el envío
-- (transporte, guía y fecha) de un comprobante de la tienda B de la misma organización con solo pasarle el id
-- (BOLA entre tiendas). Filtrar por `empresa_id` en el navegador no cierra el hueco: ese parámetro también lo
-- elige quien llama. La frontera va del lado de la base.
--
-- Es el mismo patrón que `obtener_despacho_comprobante` (F-VTA-15) y `detalle_anulacion_nota_credito` (F-VTA-11):
-- RPC de lectura aparte, `security definer` (`stable`), `search_path = ''`, organización de la sesión y permiso
-- resuelto en la **empresa del comprobante** (`private.nivel_ventas_en_empresa`).
--
-- Esquema (Principio VII): sin tablas nuevas; solo lee `dominio.comprobantes_venta` (`dominio`). No cambia la
-- RLS ni los grants de la tabla: la sigue leyendo solo `authenticated` y `anon` no tiene acceso.
--
-- Devuelve (jsonb): transporte_id · guia · fecha_envio · updated_at (el bloqueo optimista del guardado).
--
-- Errores: 42501 sin sesión o sin ver la tienda del comprobante · P0002 no existe.
--
-- Migración aditiva. Reversión (en una migración posterior):
--   drop function public.obtener_envio_comprobante(uuid);

create or replace function public.obtener_envio_comprobante(p_id uuid)
returns jsonb
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
    raise exception 'Necesitás una sesión con organización para ver el envío de un comprobante' using errcode = '42501';
  end if;
  select * into v_c
    from dominio.comprobantes_venta c
   where c.id = p_id and c.organizacion_id = v_org;
  if not found or v_c.empresa_id is null then
    raise exception 'El comprobante no existe' using errcode = 'P0002';
  end if;
  -- El permiso se resuelve en la empresa DEL COMPROBANTE: no en la empresa activa de la barra superior.
  if (select private.nivel_ventas_en_empresa(v_c.empresa_id)) not in ('lectura', 'edicion') then
    raise exception 'Tu rol no puede ver los comprobantes de esta tienda' using errcode = '42501';
  end if;

  return jsonb_build_object(
    'transporte_id', v_c.transporte_id,
    'guia', v_c.guia,
    'fecha_envio', v_c.fecha_envio,
    'updated_at', v_c.updated_at
  );
end;
$$;

comment on function public.obtener_envio_comprobante(uuid) is
  'Transporte, guía y fecha de envío de un comprobante (F-VTA-16, FR-021). Exige Ventas en lectura o edición en la empresa del comprobante: el envío de una factura de otra tienda no se lee.';

revoke execute on function public.obtener_envio_comprobante(uuid) from public, anon;
grant execute on function public.obtener_envio_comprobante(uuid) to authenticated;
