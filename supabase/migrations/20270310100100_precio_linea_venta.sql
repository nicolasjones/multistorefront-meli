-- MSF-816 (gate MSF-834 · MSF-363 decisión 6): el precio de venta en el servidor, con la promoción vigente.
--
-- Una sola función de precio de línea (`private.precio_linea_venta`) que ENVUELVE `private.precio_para` sin
-- tocarlo: la lista, las escalas, el precio propio por empresa (F-PRE-08) y la regla de precio de la empresa
-- siguen siendo los de siempre. Lo único nuevo es la promoción vigente de la TIENDA del comprobante.
--
-- Regla de precedencia (Decisión tomada 1 de la spec, Nicolás 2026-11-13): «gana el más bajo, sin acumular».
--   1. `precio_manual` manda siempre (lo resuelve el llamador, como hoy: la promoción no interviene).
--   2. Precio normal de la línea = escala por tipo de cliente y cantidad, o precio propio, o lista con la regla
--      de la empresa, MENOS el descuento del cliente: `round(neto * (1 - d/100), 2)` (la MISMA expresión de hoy).
--   3. Precio de la promoción vigente de la tienda (si hay).
--   4. Cobra `least(normal, promoción)`. Si gana la promoción, la línea guarda `precio_referencia` = el normal
--      (el «tachado») y `descuento_aplicado` = 0 (el descuento no se aplicó). Si gana el normal, la línea queda
--      como hoy, sin referencia.
--
-- La promoción solo se evalúa con la bandera `promociones_precio` ENCENDIDA (la misma que apaga la tienda,
-- MSF-363 decisión 15): apagada, el resultado es idéntico bit a bit al de hoy.
--
-- Seguridad (FR-013): `private.promocion_vigente_fila` es `security definer` con `search_path = ''` y es la ÚNICA
-- puerta de lectura de la promoción para ventas: filtra por producto, empresa Y organización (la de la empresa),
-- y no se le deja ejecutar a `public`, `anon` ni `authenticated`. Quien edita ventas en la tienda cobra la
-- promoción sin necesitar el permiso `productos` (que es el que permite leer `dominio.promociones_precio`).
-- `private.precio_linea_venta` es `security invoker`: hereda la compuerta de `private.precio_para` (`empresas` o
-- `ventas` en lectura o edición) y la ejecutan las RPC `security definer` en nombre del dueño de la función.
--
-- El instante: `now()` es el inicio de la transacción; las RPC toman `clock_timestamp()` DESPUÉS del
-- `for update` del comprobante y lo pasan como `p_ahora`. El parámetro existe para los pgTAP (bordes de
-- `desde`/`hasta` y medianoche de Buenos Aires).
--
-- Esquema (Principio VII): sin objetos en `public`; solo funciones de cálculo en `private` (no almacenan datos).
-- Migración aditiva (`create or replace`, sin tablas). Reversión (migración posterior):
--   drop function private.precio_linea_venta(uuid, uuid, text, integer, numeric, timestamptz, boolean);
--   drop function private.promocion_vigente_fila(uuid, uuid, timestamptz);
-- o, sin migrar, apagar la bandera `promociones_precio`.

-- La promoción vigente de una tienda, con su id para la trazabilidad. Filtra por organización (la de la empresa):
-- `private.promocion_vigente` (la de la tienda) filtra solo por producto y empresa.
create or replace function private.promocion_vigente_fila(p_producto uuid, p_empresa uuid, p_ahora timestamptz default now())
returns table (
  promocion_id uuid,
  precio numeric
)
language sql
stable
security definer
set search_path = ''
as $$
  select x.id, x.precio_promocional
    from dominio.promociones_precio x
    join dominio.empresas e on e.id = p_empresa and e.organizacion_id = x.organizacion_id
   where private.bandera_activa('promociones_precio')
     and x.producto_id = p_producto
     and x.empresa_id = p_empresa
     and x.anulada_at is null
     and x.desde <= p_ahora
     and p_ahora < x.hasta
   order by x.desde desc
   limit 1;
$$;

revoke execute on function private.promocion_vigente_fila(uuid, uuid, timestamptz) from public, anon, authenticated;

comment on function private.promocion_vigente_fila(uuid, uuid, timestamptz) is
  'MSF-816: promoción vigente (no anulada) de la empresa, con su id. Filtra por producto, empresa y organización; null si la bandera promociones_precio está apagada.';

-- El precio de una línea de venta: el normal (escala/precio propio/lista con la regla de la empresa, menos el
-- descuento del cliente) y, si hay, el de la promoción vigente de la tienda. Gana el más bajo, sin acumular.
create or replace function private.precio_linea_venta(
  p_producto uuid,
  p_empresa uuid,
  p_tipo_cliente text,
  p_cantidad integer,
  p_descuento numeric default 0,
  p_ahora timestamptz default now(),
  p_aplicar_descuento boolean default true
)
returns table (
  escala_usada text,
  neto_unitario numeric,
  precio_referencia numeric,
  promocion_id uuid,
  descuento_aplicado numeric,
  alicuota_id uuid,
  alicuota_porcentaje numeric,
  alicuota_exenta boolean
)
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  v_escala text;
  v_precio record;
  v_promo record;
  v_desc numeric;
  v_normal numeric;
  v_gana boolean;
begin
  v_escala := private.escala_para_linea(p_tipo_cliente, p_cantidad);
  select * into v_precio from private.precio_para(p_producto, p_empresa, v_escala);
  if not found then
    return;
  end if;

  v_desc := case when p_aplicar_descuento then coalesce(p_descuento, 0) else 0 end;
  v_normal := round(v_precio.neto * (1 - v_desc / 100), 2);

  select * into v_promo from private.promocion_vigente_fila(p_producto, p_empresa, p_ahora);
  v_gana := v_promo.precio is not null and v_normal is not null and v_promo.precio < v_normal;

  return query
  select
    v_precio.escala_usada,
    case when v_gana then least(v_normal, v_promo.precio) else v_normal end,
    case when v_gana then v_normal else null end,
    case when v_gana then v_promo.promocion_id else null end,
    case when v_gana then 0 else v_desc end,
    v_precio.alicuota_id,
    v_precio.alicuota_porcentaje,
    v_precio.alicuota_exenta;
end;
$$;

revoke execute on function private.precio_linea_venta(uuid, uuid, text, integer, numeric, timestamptz, boolean) from public, anon, authenticated;

comment on function private.precio_linea_venta(uuid, uuid, text, integer, numeric, timestamptz, boolean) is
  'MSF-816: precio de una línea de venta (neto sin IVA). Envuelve private.precio_para y le suma la promoción vigente de la tienda: gana el más bajo, sin acumular. Sin filas si el precio no se puede calcular.';
