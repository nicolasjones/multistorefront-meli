-- F-VTA-15 (MSF-152, épica MSF-135, spec 20261024-130000-ventas-despacho-y-faltantes, FR-002):
-- estado de despacho inicial al confirmar la factura.
--
-- Esquema (Principio VII): sin tablas nuevas. Escribe `dominio.comprobantes_venta` (dominio, documento de
-- venta) y lee `dominio.formas_envio` (dominio, catálogo de MSF-139). La función vive en `private`.
--
-- Reglas:
--   · Corre al pasar una factura a `confirmada` (disparador `AFTER UPDATE OF estado`), sin tocar
--     `confirmar_comprobante` (FR-002).
--   · Toma `estado_despacho_inicial` de la forma de envío elegida (`envio_id`) si resuelve en la misma
--     organización y empresa; si no resuelve, `sin_armar`.
--   · Una sola vez: si la factura ya tiene estado de despacho, no se vuelve a fijar (ni la re-confirmación
--     ni un cambio de estado posterior lo pisan).
--   · Un presupuesto nunca entra al despacho: `tipo <> 'factura'` no hace nada.
--   · No toca `updated_at`: el bloqueo optimista de `cambiar_estado_comprobante` (MSF-177) y de
--     `cambiar_estado_despacho` (T005) siguen viendo la fecha que puso la RPC que escribió la fila.
--
-- Nota de integración: el disparador corre DESPUÉS del `RETURNING` de la escritura, así que el valor que
-- devuelve `confirmar_comprobante` todavía no incluye `estado_despacho`. La pantalla recarga el comprobante
-- después de confirmar (FR-010).
--
-- Migración aditiva. Reversión (en una migración posterior; las facturas ya confirmadas quedan sin estado
-- de despacho, lo que la pantalla muestra como «Sin armar»):
--   drop trigger if exists comprobantes_venta_estado_despacho_inicial on dominio.comprobantes_venta;
--   drop function if exists private.asignar_estado_despacho_inicial();

create or replace function private.asignar_estado_despacho_inicial()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_inicial text;
begin
  -- Solo las facturas entran al despacho.
  if new.tipo <> 'factura' then
    return new;
  end if;

  -- Solo cuando el estado documental cambia.
  if old.estado is not distinct from new.estado then
    return new;
  end if;

  -- El disparador es del paso a `confirmada`; el resto de los estados no lo toca.
  if new.estado <> 'confirmada' then
    return new;
  end if;

  -- Una sola vez: si ya tiene estado de despacho, no se pisa.
  if new.estado_despacho is not null then
    return new;
  end if;

  select f.estado_despacho_inicial into v_inicial
    from dominio.formas_envio f
   where f.id = new.envio_id
     and f.organizacion_id = new.organizacion_id
     and (new.empresa_id is null or f.empresa_id = new.empresa_id);

  update dominio.comprobantes_venta
     set estado_despacho = coalesce(v_inicial, 'sin_armar')
   where id = new.id
     and organizacion_id = new.organizacion_id
     and estado_despacho is null;

  return new;
end;
$$;

comment on function private.asignar_estado_despacho_inicial() is
  'Fija el estado de despacho inicial de una factura al pasar a `confirmada` (F-VTA-15, FR-002): el de su forma de envío o `sin_armar`. Solo el disparador la llama.';

revoke execute on function private.asignar_estado_despacho_inicial() from public, anon, authenticated;

drop trigger if exists comprobantes_venta_estado_despacho_inicial on dominio.comprobantes_venta;
create trigger comprobantes_venta_estado_despacho_inicial
  after update of estado on dominio.comprobantes_venta
  for each row execute function private.asignar_estado_despacho_inicial();
