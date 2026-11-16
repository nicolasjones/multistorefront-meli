-- F-VTA-11 (MSF-377, épica MSF-177, FR-040): `public.anular_comprobante`, la anulación de una factura emitida por error.
--
-- Esquema (Principio VII): sin tablas nuevas. Escribe `dominio.comprobantes_venta` (estado `anulada`, `anulado_en/por`,
-- `motivo_anulacion`), el stock por `private.revertir_venta_comprobante` y, por `private.registrar_actividad`,
-- `public.registro_actividad` (todo `dominio` salvo la actividad, de plataforma).
--
-- Seguridad: `security definer`, `search_path = ''`; la organización y el actor salen de la sesión (nunca de un
-- argumento). Exige `ventas` en `edicion` y la acción `anular` EN LA EMPRESA del comprobante
-- (`private.puede_accion_comprobante`), verificadas en la RPC, no solo en la UI. `revoke … from public, anon` y
-- `grant execute … to authenticated` explícitos.
--
-- Reglas:
--   · Solo `factura` confirmada y no anulada, en cualquier estado operativo salvo Cobrado. Un borrador no se anula
--     (no movió nada), un presupuesto y una nota de crédito tampoco (55000 / 22023).
--   · Motivo obligatorio (hasta 300 caracteres).
--   · Con una nota de crédito emitida, o ya cobrada, se rechaza: se corrige con nota de crédito (55000).
--   · Idempotente: una factura ya anulada devuelve el comprobante sin tocar el stock ni duplicar el evento.
--   · Bloqueo optimista por `updated_at` (40001) y fila `for update`: dos anulaciones simultáneas no revierten dos
--     veces (la segunda ve `anulada`).
--   · Todo o nada: si la reversión falla, nada cambia. El número NO se reutiliza (la fila sigue existiendo).
--   · Registra `comprobante.anulado` («Anuló la factura N: motivo»), que el historial muestra.
--
-- Errores: 42501 permiso · P0002 no existe · 22023 dato inválido · 55000 estado no válido · 40001 conflicto.
--
-- Migración aditiva. Reversión (migración posterior; las anulaciones hechas no se deshacen solas):
--   drop function public.anular_comprobante(uuid, text, timestamptz);

create or replace function public.anular_comprobante(
  p_id uuid,
  p_motivo text,
  p_actualizado_en timestamptz
)
returns dominio.comprobantes_venta
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid := (select private.organizacion_id());
  v_actor uuid := (select auth.uid());
  v_c dominio.comprobantes_venta;
  v_fila dominio.comprobantes_venta;
  v_motivo text := btrim(coalesce(p_motivo, ''));
begin
  if v_org is null or v_actor is null then
    raise exception 'Necesitás una sesión con organización para anular comprobantes' using errcode = '42501';
  end if;

  select * into v_c
    from dominio.comprobantes_venta c
   where c.id = p_id and c.organizacion_id = v_org
   for update;
  if not found or v_c.empresa_id is null then
    raise exception 'El comprobante no existe' using errcode = 'P0002';
  end if;
  if not (select private.puede_accion_comprobante(v_c.empresa_id, 'anular')) then
    raise exception 'Tu rol no puede anular comprobantes de esta tienda' using errcode = '42501';
  end if;
  if v_c.tipo = 'nota_credito' then
    raise exception 'Una nota de crédito no se anula' using errcode = '22023';
  end if;
  if v_c.tipo <> 'factura' then
    raise exception 'Un presupuesto no se anula: solo las facturas confirmadas' using errcode = '22023';
  end if;

  -- Idempotente: el reintento devuelve la anulación ya hecha, sin movimientos ni evento nuevos.
  if v_c.estado = 'anulada' then
    return v_c;
  end if;

  if v_motivo = '' then
    raise exception 'Escribí el motivo de la anulación' using errcode = '22023', hint = 'motivo';
  end if;
  if length(v_motivo) > 300 then
    raise exception 'El motivo de la anulación no puede superar los 300 caracteres' using errcode = '22023', hint = 'motivo';
  end if;
  if v_c.estado = 'borrador' then
    raise exception 'La factura está en borrador: no movió stock, no hace falta anularla' using errcode = '55000';
  end if;
  if v_c.estado = 'cobrado' then
    raise exception 'La factura ya está cobrada: corregila con una nota de crédito' using errcode = '55000';
  end if;
  if exists (
    select 1 from dominio.comprobantes_venta n
     where n.organizacion_id = v_org and n.comprobante_origen_id = v_c.id and n.tipo = 'nota_credito'
  ) then
    raise exception 'La factura ya tiene una nota de crédito: corregila con otra nota de crédito' using errcode = '55000';
  end if;
  if p_actualizado_en is distinct from v_c.updated_at then
    raise exception 'Alguien modificó este comprobante mientras lo mirabas: recargalo y volvé a intentar' using errcode = '40001';
  end if;

  perform private.revertir_venta_comprobante(v_c.id);

  update dominio.comprobantes_venta
     set estado = 'anulada',
         anulado_en = now(),
         anulado_por = v_actor,
         motivo_anulacion = v_motivo,
         updated_at = clock_timestamp()
   where id = v_c.id
  returning * into v_fila;

  perform private.registrar_actividad(
    'comprobante.anulado',
    format('Anuló la factura %s: %s', v_fila.numero, v_motivo),
    v_fila.empresa_id
  );
  return v_fila;
end;
$$;

revoke execute on function public.anular_comprobante(uuid, text, timestamptz) from public, anon;
grant execute on function public.anular_comprobante(uuid, text, timestamptz) to authenticated;

comment on function public.anular_comprobante(uuid, text, timestamptz) is
  'Anula una factura confirmada con motivo obligatorio: revierte el stock y libera las reservas «A pedido», todo o nada e idempotente (F-VTA-11, FR-040/FR-041). Exige ventas en edición y la acción anular en la empresa del comprobante.';
