-- MSF-816 / F-1 (spec 20261113-120000-precio-promocional-en-pos-y-comprobantes, FR-001, FR-002, FR-003, FR-013):
-- la función ÚNICA de precio de línea de venta y la lectura acotada de la promoción vigente.
--
-- Qué hace:
--   · `private.promocion_vigente_fila(producto, empresa, ahora)`: la promoción vigente de ESA tienda
--     (`security definer`, `search_path = ''`). Misma regla que `private.promocion_vigente` (bandera
--     `promociones_precio` encendida, no anulada, `desde <= ahora < hasta`, la más reciente) pero devuelve
--     también el `id` y FILTRA ADEMÁS por `organizacion_id` (la de la empresa). Es la única puerta de lectura de
--     la promoción para ventas; `private.promocion_vigente` (la tienda) queda intacta.
--   · `private.precio_linea_venta(producto, empresa, tipo_cliente, cantidad, descuento, ahora, aplicar_descuento)`:
--     envuelve `private.precio_para` + `private.escala_para_linea` SIN modificarlos y aplica «gana el más bajo,
--     sin acumular»: `precio normal = round(neto × (1 − descuento/100), 2)` (la MISMA expresión de hoy, así con
--     la bandera apagada el resultado es idéntico) contra la promoción de la tienda del comprobante; gana la
--     promoción solo si es ESTRICTAMENTE menor (una promoción >= normal se ignora) y entonces
--     `descuento_aplicado = 0`, `precio_referencia` = el normal y `promocion_id`. `security invoker` (hereda la
--     compuerta de `precio_para`: `empresas` o `ventas` en lectura/edición). El precio manual NO pasa por acá: lo
--     resuelve el llamador.
--
-- Esquema (Constitución, Principio VII): lógica de cálculo sin datos en `private`; no se crea ninguna tabla.
-- Grants: `revoke execute ... from public, anon, authenticated` en las dos (las ejecutan las RPC `security
-- definer` en nombre del dueño, sin grant a `authenticated`; el pgTAP lo comprueba).
--
-- Migración aditiva (funciones nuevas). Pasa `node scripts/verificar-migraciones.mjs --estricto` y el guard de DDL.
-- Reversión (migración posterior; antes restaurar las RPC que la usan, de 20270310100200 en adelante):
--   drop function private.precio_linea_venta(uuid, uuid, text, integer, numeric, timestamptz, boolean);
--   drop function private.promocion_vigente_fila(uuid, uuid, timestamptz);

create or replace function private.promocion_vigente_fila(
  p_producto uuid,
  p_empresa uuid,
  p_ahora timestamptz default now()
)
returns table (promocion_id uuid, precio numeric)
language sql
stable
security definer
set search_path = ''
as $$
  select x.id, x.precio_promocional
    from dominio.promociones_precio x
   where private.bandera_activa('promociones_precio')
     and x.producto_id = p_producto
     and x.empresa_id = p_empresa
     and x.organizacion_id = (select e.organizacion_id from dominio.empresas e where e.id = p_empresa)
     and x.anulada_at is null
     and x.desde <= p_ahora
     and p_ahora < x.hasta
   order by x.desde desc, x.id
   limit 1;
$$;

revoke execute on function private.promocion_vigente_fila(uuid, uuid, timestamptz) from public, anon, authenticated;

comment on function private.promocion_vigente_fila(uuid, uuid, timestamptz) is
  'MSF-816: promoción vigente de la tienda (id y precio), solo con la bandera promociones_precio encendida; filtra por organización, empresa y producto. Única lectura de promociones para ventas.';

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
  v_p record;
  v_pr_id uuid;
  v_pr_precio numeric;
  v_d numeric;
  v_normal numeric;
begin
  select * into v_p
    from private.precio_para(p_producto, p_empresa, private.escala_para_linea(p_tipo_cliente, p_cantidad));
  if not found then
    return;
  end if;

  -- Precio normal de la línea: la misma expresión que calculaba guardar_lineas_comprobante antes de la promoción.
  v_d := case when p_aplicar_descuento then coalesce(p_descuento, 0) else 0 end;
  v_normal := round(v_p.neto * (1 - v_d / 100), 2);

  -- La promoción solo se consulta cuando el precio normal existe (una sola búsqueda indexada por línea).
  if v_normal is not null then
    select f.promocion_id, f.precio into v_pr_id, v_pr_precio
      from private.promocion_vigente_fila(p_producto, p_empresa, p_ahora) f;
  end if;

  if v_normal is not null and v_pr_precio is not null and v_pr_precio < v_normal then
    return query select v_p.escala_usada, v_pr_precio, v_normal, v_pr_id, 0::numeric,
      v_p.alicuota_id, v_p.alicuota_porcentaje, v_p.alicuota_exenta;
  else
    return query select v_p.escala_usada, v_normal, null::numeric, null::uuid, v_d,
      v_p.alicuota_id, v_p.alicuota_porcentaje, v_p.alicuota_exenta;
  end if;
end;
$$;

revoke execute on function private.precio_linea_venta(uuid, uuid, text, integer, numeric, timestamptz, boolean)
  from public, anon, authenticated;

comment on function private.precio_linea_venta(uuid, uuid, text, integer, numeric, timestamptz, boolean) is
  'MSF-816: precio de línea de venta. Gana el más bajo sin acumular: precio normal (escala/propio/lista con su descuento) o promoción vigente de la tienda del comprobante (bandera promociones_precio). Devuelve referencia y promoción solo si ganó la promoción. No pasa por acá el precio manual.';
