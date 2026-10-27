-- F-VTA-16 (MSF-166, épica MSF-135, spec 20261024-130000-ventas-despacho-y-faltantes, FR-022):
-- la forma de envío que exige transporte y guía impide entregar la factura sin ellos.
--
-- Esquema (Principio VII): sin tablas nuevas. El disparador vive sobre `dominio.comprobantes_venta` (dominio,
-- documento de venta) y lee `dominio.formas_envio` (dominio, catálogo de MSF-139). La función del disparador
-- vive en `private` (nadie la ejecuta: solo la llama el disparador).
--
-- Reglas (FR-022):
--   · Disparador `before update of estado_despacho`: al pasar a `entregado`, si la forma de envío de la factura
--     tiene `exige_transporte_guia` y falta el transporte o la guía, la escritura se rechaza (22023) diciendo
--     qué falta.
--   · Guardar el envío no se toca (T014): la exigencia es al ENTREGAR, no al guardar el dato.
--   · «Retiro en local» (o cualquier forma que no lo exija) se entrega sin transporte ni guía.
--   · Solo las facturas: un presupuesto no entra al despacho (no tiene `estado_despacho`).
--   · La forma de envío se resuelve en la organización y la empresa del comprobante; una factura sin forma de
--     envío no tiene exigencia (mismo criterio que el estado inicial, FR-002). Una forma que no es de la empresa
--     de la factura tampoco obliga: la que obliga es la forma de envío de ESA factura.
--   · La regla vive en la BASE, no en la RPC: cualquier camino que marque `entregado` pasa por el disparador.
--     Como `cambiar_estado_despacho` descuenta las reservas «A pedido» en la misma transacción, el rechazo
--     deja la entrega entera sin aplicar (todo o nada): la factura no queda entregada ni con reservas
--     descontadas.
--   · Una guía en blanco es una guía ausente: se normaliza igual que en `guardar_envio_comprobante`.
--   · El mensaje arranca con «Una factura»: el panel muestra el mensaje de la base tal cual y solo reconoce
--     los prefijos de su lista blanca (`apps/web/src/lib/ventasDespacho.ts`); con otro prefijo la persona vería
--     un error genérico y no sabría qué falta.
--
-- Errores: 22023 · falta el transporte o la guía que la forma de envío exige.
--
-- Migración aditiva. Reversión (en una migración posterior; las facturas ya entregadas NO se deshacen solos:
-- exportarlas antes):
--   drop trigger if exists comprobantes_venta_exige_envio_al_entregar on dominio.comprobantes_venta;
--   drop function if exists private.exigir_envio_al_entregar();

create or replace function private.exigir_envio_al_entregar()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_forma text;
  v_exige boolean;
  v_guia text;
begin
  -- Solo cuando el estado de despacho pasa a `entregado`.
  if new.estado_despacho is distinct from 'entregado' then
    return new;
  end if;
  -- Si el estado no cambia (una escritura que repite el mismo), no hay entrega nueva que exigir.
  if old.estado_despacho is not distinct from new.estado_despacho then
    return new;
  end if;
  -- Solo las facturas entran al despacho.
  if new.tipo <> 'factura' then
    return new;
  end if;

  -- La forma de envío, en la organización y la empresa del comprobante.
  select f.nombre, f.exige_transporte_guia into v_forma, v_exige
    from dominio.formas_envio f
   where f.id = new.envio_id
     and f.organizacion_id = new.organizacion_id
     and (new.empresa_id is null or f.empresa_id = new.empresa_id);

  -- Sin forma de envío, o con una que no lo exige: se entrega sin transporte ni guía.
  if not coalesce(v_exige, false) then
    return new;
  end if;

  v_guia := nullif(btrim(coalesce(new.guia, '')), '');

  if new.transporte_id is null and v_guia is null then
    raise exception 'Una factura con la forma de envío «%» no se puede entregar: faltan el transporte y la guía',
      v_forma using errcode = '22023';
  end if;
  if new.transporte_id is null then
    raise exception 'Una factura con la forma de envío «%» no se puede entregar: falta el transporte',
      v_forma using errcode = '22023';
  end if;
  if v_guia is null then
    raise exception 'Una factura con la forma de envío «%» no se puede entregar: falta la guía',
      v_forma using errcode = '22023';
  end if;

  return new;
end;
$$;

comment on function private.exigir_envio_al_entregar() is
  'Disparador de FR-022: rechaza pasar una factura a `entregado` si su forma de envío exige transporte y guía y falta alguno de los dos. Solo el disparador la llama.';

revoke execute on function private.exigir_envio_al_entregar() from public, anon, authenticated;

drop trigger if exists comprobantes_venta_exige_envio_al_entregar on dominio.comprobantes_venta;
create trigger comprobantes_venta_exige_envio_al_entregar
  before update of estado_despacho on dominio.comprobantes_venta
  for each row execute function private.exigir_envio_al_entregar();
