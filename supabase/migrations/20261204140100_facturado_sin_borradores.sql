-- F-VTA-07 (MSF-317, épica MSF-159, spec 20261023-100000-ventas-comprobantes, FR-036): una factura en
-- `borrador` todavía no se vendió (no descontó stock ni es un documento firme), así que no suma al ranking
-- de clientes ni a sus compras. Ajuste previsto por F-CLI-08 (20261018100100): este predicado es el ÚNICO lugar
-- donde se decide qué comprobantes cuentan como facturados.
--
-- Esquema (Principio VII): sin tablas; solo reemplaza una función de `private`. Mismos grants que antes
-- (`create or replace` los conserva).
--
-- CAMBIO DE CONTRATO (interno, alto riesgo → gate humano): antes contaba toda factura no anulada; ahora excluye
-- también `borrador`.
--
-- Migración aditiva. Reversión (migración posterior): restaurar el cuerpo anterior
--   select p_tipo = 'factura' and p_estado <> 'anulada'
-- de 20261018100100_clientes_ranking.sql.

create or replace function private.comprobante_cuenta_como_facturado(p_tipo text, p_estado text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select p_tipo = 'factura' and p_estado not in ('borrador', 'anulada')
$$;
