-- MSF-661 / MSF-600 (lote 32, MSF-647): `public.anular_comprobante` rechaza anular una factura ya entregada y una factura
-- con cobros parciales registrados.
--
-- Parte de la definición vigente (20261212120200_anular_comprobante.sql) y solo agrega dos guardas, después de la de
-- «ya cobrada» y antes de la de nota de crédito:
--   · `estado_despacho = 'entregado'` → 55000 «La factura ya fue entregada: corregí con nota de crédito o RMA» (MSF-661).
--   · cobrado neto > 0 (suma del libro de cobros, con las reversiones de `revertir_cobro` ya restadas) → 55000
--     «La factura tiene cobros registrados: revertí el cobro o corregila con una nota de crédito» (MSF-600).
-- Una factura anulada sigue devolviéndose idempotente (la guarda de «anulada» va antes). Sin cambios de firma, grants ni
-- seguridad: `security definer`, `search_path = ''`, permiso `anular` en la empresa del comprobante.
--
-- Migración aditiva (create or replace). Reversión: volver a la definición de 20261212120200_anular_comprobante.sql
-- (create or replace de `public.anular_comprobante(uuid, text, timestamptz)` sin las dos guardas nuevas).

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
  -- MSF-661: una factura ya entregada movió mercadería al cliente: anularla dejaría el stock y el despacho incoherentes.
  if v_c.estado_despacho = 'entregado' then
    raise exception 'La factura ya fue entregada: corregí con nota de crédito o RMA' using errcode = '55000';
  end if;
  -- MSF-600: con cobros registrados (aunque sean parciales, netos de reversiones) la plata cobrada quedaría huérfana.
  if (select s.cobrado from private.saldo_comprobante(v_c.id) s) > 0 then
    raise exception 'La factura tiene cobros registrados: revertí el cobro o corregila con una nota de crédito' using errcode = '55000';
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
  'Anula una factura confirmada con motivo obligatorio: revierte el stock y libera las reservas «A pedido», todo o nada e idempotente (F-VTA-11, FR-040/FR-041). Rechaza la factura entregada (MSF-661) y la que tiene cobros registrados (MSF-600). Exige ventas en edición y la acción anular en la empresa del comprobante.';
