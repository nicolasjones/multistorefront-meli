-- F-API-01 (MSF-403, FR-011): eventos de precio y de venta para los avisos.
--
-- Esquema (Principio VII): sin tablas nuevas. Los disparadores escriben en
-- `public.cola_eventos` (infraestructura de plataforma ya existente); el
-- evento `stock.actualizado` no se toca (lo emite `private.emitir_stock_actualizado`).
--
-- D-5: el precio sale de `dominio.productos` (`precio_lista`, `moneda`) y de
-- `dominio.producto_precios_escala` (`precio`); la venta, de
-- `dominio.comprobantes_venta` al pasar a `estado = 'confirmada'` con
-- `tipo = 'factura'`.
--
-- Solo se emite cuando el valor cambia de verdad: un UPDATE que no toca el
-- precio no genera evento, así que el consumidor no recibe ruido.
--
-- Migración aditiva. Reversión (en una migración posterior, no en este PR):
--   drop trigger productos_emitir_precio on dominio.productos;
--   drop trigger producto_precios_escala_emitir_precio on dominio.producto_precios_escala;
--   drop trigger comprobantes_venta_emitir_venta on dominio.comprobantes_venta;
--   drop function private.emitir_precio_actualizado();
--   drop function private.emitir_venta_registrada();
-- (los eventos ya encolados no se borran)

-- ============================================================================
-- private.emitir_precio_actualizado — precio de lista y escalas.
-- Un solo disparador para las dos tablas: los campos se leen del registro
-- nuevo con `to_jsonb`, así la función no depende de qué tabla la dispara.
-- ============================================================================

create or replace function private.emitir_precio_actualizado()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_nuevo jsonb := to_jsonb(new);
  v_viejo jsonb;
  v_escala text;
  v_producto uuid;
  v_precio numeric;
  v_moneda text;
  v_actualizado timestamptz;
begin
  -- `OLD` no existe en un INSERT: se lee solo dentro de la rama UPDATE.
  if tg_op = 'UPDATE' then
    v_viejo := to_jsonb(old);
  end if;

  if tg_table_name = 'productos' then
    if tg_op = 'UPDATE'
      and (v_nuevo->>'precio_lista') is not distinct from (v_viejo->>'precio_lista')
      and (v_nuevo->>'moneda') is not distinct from (v_viejo->>'moneda') then
      return new;
    end if;
    v_escala := 'x1';
    v_producto := (v_nuevo->>'id')::uuid;
    v_precio := (v_nuevo->>'precio_lista')::numeric;
    v_moneda := v_nuevo->>'moneda';
    v_actualizado := (v_nuevo->>'updated_at')::timestamptz;
  else
    if tg_op = 'UPDATE' and (v_nuevo->>'precio') is not distinct from (v_viejo->>'precio') then
      return new;
    end if;
    v_escala := v_nuevo->>'escala';
    v_producto := (v_nuevo->>'producto_id')::uuid;
    v_precio := (v_nuevo->>'precio')::numeric;
    v_moneda := null;
    v_actualizado := (v_nuevo->>'updated_at')::timestamptz;
  end if;

  insert into public.cola_eventos (organizacion_id, tipo, clave_idempotencia, carga, created_at)
  values (
    (v_nuevo->>'organizacion_id')::uuid,
    'precio.actualizado',
    v_producto::text || ':' || v_escala || ':'
      || (extract(epoch from v_actualizado) * 1000000)::bigint::text || ':' || txid_current()::text,
    jsonb_build_object(
      'organizacion_id', (v_nuevo->>'organizacion_id')::uuid,
      'producto_id', v_producto,
      'escala', v_escala,
      'precio', v_precio,
      'moneda', v_moneda,
      'ocurrido_en', clock_timestamp()
    ),
    -- now() es constante en la transacción: con dos cambios en la misma
    -- transacción los dos eventos quedarían con el mismo instante y no se
    -- podría saber cuál es el último.
    clock_timestamp()
  )
  on conflict (organizacion_id, tipo, clave_idempotencia) do nothing;

  return new;
end;
$$;

comment on function private.emitir_precio_actualizado() is
  'F-API-01: encola precio.actualizado cuando cambia el precio de lista o el de una escala. Un evento por cambio real.';

revoke execute on function private.emitir_precio_actualizado() from public, anon, authenticated;

create trigger productos_emitir_precio
  after insert or update of precio_lista, moneda on dominio.productos
  for each row execute function private.emitir_precio_actualizado();

create trigger producto_precios_escala_emitir_precio
  after insert or update of precio on dominio.producto_precios_escala
  for each row execute function private.emitir_precio_actualizado();

-- ============================================================================
-- private.emitir_venta_registrada — factura confirmada.
-- Solo cuando la factura pasa a 'confirmada': una actualización que no cambia
-- el estado (o que la deja confirmada) no genera un evento nuevo.
-- ============================================================================

create or replace function private.emitir_venta_registrada()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_nuevo jsonb := to_jsonb(new);
  v_viejo jsonb;
begin
  -- `OLD` no existe en un INSERT: se lee solo dentro de la rama UPDATE.
  if tg_op = 'UPDATE' then
    v_viejo := to_jsonb(old);
  end if;

  if (v_nuevo->>'tipo') is distinct from 'factura'
    or (v_nuevo->>'estado') is distinct from 'confirmada' then
    return new;
  end if;

  if tg_op = 'UPDATE' and (v_viejo->>'estado') is not distinct from 'confirmada' then
    return new;
  end if;

  insert into public.cola_eventos (organizacion_id, tipo, clave_idempotencia, carga, created_at)
  values (
    (v_nuevo->>'organizacion_id')::uuid,
    'venta.registrada',
    (v_nuevo->>'id')::text,
    jsonb_build_object(
      'organizacion_id', (v_nuevo->>'organizacion_id')::uuid,
      'comprobante_id', (v_nuevo->>'id')::uuid,
      'numero', v_nuevo->>'numero',
      'tipo', v_nuevo->>'tipo',
      'total_sin_iva', (v_nuevo->>'total_sin_iva')::numeric,
      'total_con_iva', (v_nuevo->>'total_con_iva')::numeric,
      'confirmado_en', v_nuevo->>'confirmado_en',
      'ocurrido_en', clock_timestamp()
    ),
    -- now() es constante en la transacción: el instante real de encolado
    -- ordena los eventos del mismo lote.
    clock_timestamp()
  )
  on conflict (organizacion_id, tipo, clave_idempotencia) do nothing;

  return new;
end;
$$;

comment on function private.emitir_venta_registrada() is
  'F-API-01: encola venta.registrada cuando una factura pasa a confirmada. Un evento por comprobante.';

revoke execute on function private.emitir_venta_registrada() from public, anon, authenticated;

create trigger comprobantes_venta_emitir_venta
  after insert or update of estado on dominio.comprobantes_venta
  for each row execute function private.emitir_venta_registrada();
