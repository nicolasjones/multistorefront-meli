-- MSF-720 (lote 32, MSF-647): `private.aplicar_iva` redondea AL CENTAVO, igual que el total del comprobante.
--
-- Hallazgo: la fórmula única del IVA (20261022140200_precios_empresa_iva.sql) redondeaba el precio final al peso
-- entero (`round(neto * (1 + porcentaje / 100))`), mientras que el total con IVA del comprobante se redondea a 2
-- decimales: el precio que ve el cliente en la lista o en la tienda no coincidía con el de la línea del comprobante.
-- Decisión tomada: redondeo al centavo (`round(…, 2)`), migración nueva, SIN recalcular lo ya emitido (los comprobantes
-- confirmados guardan sus importes; la función solo calcula precios de lista, de la tienda, de promociones y los que
-- se copian a una línea nueva).
--
-- La cotización del dólar ya admite hasta 4 decimales en SQL (`dominio.cotizaciones.valor numeric(14, 4)` y la
-- validación de `cargar_cotizacion`), y `private.a_pesos` redondea a 2: no hay nada que cambiar ahí.
--
-- Mismo contrato: `immutable`, mismos argumentos, Exento ⇒ final = neto, nulo si falta neto o porcentaje. Grants como
-- antes (revoke de public y anon; execute para authenticated, que la usan las vistas security invoker).
--
-- Migración aditiva (create or replace). Reversión: volver a la definición de 20261022140200_precios_empresa_iva.sql
-- (`round(p_neto * (1 + p_porcentaje / 100))`, al peso entero).

create or replace function private.aplicar_iva(p_neto numeric, p_porcentaje numeric, p_exento boolean)
returns numeric
language sql
immutable
set search_path = ''
as $$
  select case
    when p_neto is null or p_porcentaje is null then null
    when p_exento then p_neto
    else round(p_neto * (1 + p_porcentaje / 100), 2)
  end;
$$;

comment on function private.aplicar_iva(numeric, numeric, boolean) is
  'F-PRE-12 / MSF-720: precio final al centavo desde el neto (igual que el total del comprobante); Exento ⇒ final = neto. Única fórmula del IVA.';

revoke execute on function private.aplicar_iva(numeric, numeric, boolean) from public, anon;
grant execute on function private.aplicar_iva(numeric, numeric, boolean) to authenticated;
