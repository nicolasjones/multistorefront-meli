-- F-CLI-19 / F-VTA-12 / F-VTA-14 (MSF-450 ∩ MSF-195): una nota de crédito que se emite (o se anula) deja de dejar atrás
-- el estado de la factura y el importe de sus contrarreembolsos.
--
-- Hallazgo de la revisión independiente de #851: desde 20270227140000 el saldo de una factura resta sus notas, pero el
-- saldo se recalcula al leer y dos cosas solo se calculaban al cobrar o al abrir:
--   1. el ESTADO: una factura con un cobro parcial y una nota posterior que deja el saldo en 0 seguía en «Deuda» (y no
--      se podía cobrar: `registrar_cobro` rechaza todo importe sobre saldo 0);
--   2. el IMPORTE de un contrarreembolso ya abierto: `marcar_contrarreembolso_cobrado` cobra el importe fijado al abrir
--      y fallaba con «El importe supera el saldo pendiente» si después se emitía una nota.
--
-- Qué hace: un disparador sobre `dominio.comprobantes_venta` (solo filas `nota_credito`), después de insertar la nota o de
-- cambiar su estado o su total, llama a `private.sincronizar_efectos_nota_credito(factura)`:
--   · Si el saldo neto queda en 0 y la factura TIENE cobros (lo cobrado más las notas cubren el total), la pasa a
--     «Cobrado» por `private.marcar_estado_cobro_comprobante`, igual que un cobro. Solo si la transición existe para el
--     actor `sistema` en la matriz de la organización: si no, no hace nada (nunca aborta la emisión de la nota).
--     Una factura cubierta entera por notas y SIN cobros queda como está (no hay plata cobrada que justifique «Cobrado»).
--   · Si el saldo neto sigue siendo positivo, los contrarreembolsos PENDIENTES de la factura pasan a ese saldo (sube o
--     baja con la nota, también cuando se anula) y dejan el evento `contrarreembolso.importe_ajustado`. El importe de un
--     contrarreembolso es siempre mayor que 0: con saldo 0 se deja como está (marcarlo cobrado fallará con el mensaje de
--     tope, que ya dice el saldo).
--   · Es idempotente y la emisión de una nota la dispara varias veces (se inserta con total 0 y después se completa): sin
--     efecto cuando nada cambia.
--
-- Lo que NO hace (límite documentado en docs/cobros-por-comprobante.md): si se anula una nota después de que la factura
-- pasó a «Cobrado», el estado no vuelve a «Deuda» (una factura cobrada en mostrador, anterior al libro de cobros, puede
-- estar en «Cobrado» sin cobros y no hay forma segura de distinguirla).
--
-- Seguridad: funciones `private`, `security definer` con `search_path = ''`, sin execute para `public`/`anon`/`authenticated`.
-- Esquema (Principio VII): sin tablas nuevas; escribe `dominio.comprobantes_venta` (por la función de estado) y
-- `dominio.contrarreembolsos`.
--
-- Reversión (en una migración posterior): drop trigger comprobantes_venta_nota_credito_efectos on
-- dominio.comprobantes_venta; drop function private.trg_nota_credito_efectos(); drop function
-- private.sincronizar_efectos_nota_credito(uuid);

create or replace function private.sincronizar_efectos_nota_credito(p_factura_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_f dominio.comprobantes_venta;
  v_s record;
  v_cr record;
begin
  select * into v_f from dominio.comprobantes_venta f where f.id = p_factura_id for update;
  if not found or v_f.tipo <> 'factura' or v_f.estado in ('borrador', 'anulada') then
    return;
  end if;

  select * into v_s from private.saldo_comprobante(p_factura_id);

  -- 1) Estado: lo cobrado más las notas cubren la factura → Cobrado (si la matriz de la organización lo permite).
  if v_s.saldo = 0 and v_s.cobrado > 0 and v_f.estado <> 'cobrado'
     and exists (
       select 1 from dominio.transiciones_estado_comprobante t
        where t.organizacion_id = v_f.organizacion_id and t.tipo = v_f.tipo
          and t.estado_desde = v_f.estado and t.estado_hasta = 'cobrado' and t.rol_id = 'sistema'
     ) then
    perform private.marcar_estado_cobro_comprobante(p_factura_id, 'cobrado');
  end if;

  -- 2) Contrarreembolsos pendientes: pasan al saldo neto vigente.
  if v_s.saldo > 0 then
    for v_cr in
      select c.id, c.importe, c.guia, c.actualizado_en
        from dominio.contrarreembolsos c
       where c.comprobante_id = p_factura_id
         and c.organizacion_id = v_f.organizacion_id
         and c.estado = 'pendiente'
         and c.importe <> v_s.saldo
       for update
    loop
      update dominio.contrarreembolsos
         set importe = v_s.saldo,
             -- Avanza el bloqueo optimista del «Marcar cobrado»: quien tenga la pantalla abierta ve el importe viejo.
             actualizado_en = greatest(clock_timestamp(), v_cr.actualizado_en + interval '1 microsecond')
       where id = v_cr.id;

      perform private.insertar_actividad(
        v_f.organizacion_id,
        null,
        'contrarreembolso.importe_ajustado',
        format('Contrarreembolso de la guía %s: importe %s → %s por una nota de crédito en la factura %s',
          v_cr.guia, v_cr.importe, v_s.saldo, v_f.numero),
        v_f.empresa_id
      );
    end loop;
  end if;
end;
$$;

revoke execute on function private.sincronizar_efectos_nota_credito(uuid) from public, anon, authenticated;

comment on function private.sincronizar_efectos_nota_credito(uuid) is
  'Tras emitir o anular una nota de crédito: pasa la factura a Cobrado si lo cobrado más las notas cubren el total y ajusta los contrarreembolsos pendientes al saldo neto. Idempotente; no ejecutable por authenticated.';

create or replace function private.trg_nota_credito_efectos()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.comprobante_origen_id is not null then
    perform private.sincronizar_efectos_nota_credito(new.comprobante_origen_id);
  end if;
  return null;
end;
$$;

revoke execute on function private.trg_nota_credito_efectos() from public, anon, authenticated;

comment on function private.trg_nota_credito_efectos() is
  'Disparador de notas de crédito (alta, cambio de estado o de total): sincroniza la factura de origen. Ver sincronizar_efectos_nota_credito.';

create trigger comprobantes_venta_nota_credito_efectos
  after insert or update of estado, total_con_iva on dominio.comprobantes_venta
  for each row
  when (new.tipo = 'nota_credito')
  execute function private.trg_nota_credito_efectos();
