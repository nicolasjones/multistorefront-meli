-- MSF-145 (Ventas motos), decisión de Nicolás del 2026-11-12 (6): una nota de crédito posterior sobre la factura ajusta el
-- `abono` de los envíos en moto pendientes, con el mismo patrón que los contrarreembolsos (20270227150000).
--
-- Qué hace: reemplaza `private.sincronizar_efectos_nota_credito(factura)` (la llama el disparador
-- `comprobantes_venta_nota_credito_efectos` al emitir una nota, o cambiar su estado o su total) para que, además de pasar la
-- factura a Cobrado y ajustar los contrarreembolsos, BAJE el `abono` de cada envío en moto SIN RENDIR de esa factura cuando supera
-- el saldo neto (`private.saldo_comprobante`: total − cobros − notas de crédito).
--   · Solo baja y puede quedar en 0: el abono es lo que el mensajero cobra al entregar y no puede ser más que lo que falta cobrar.
--   · Los envíos ya rendidos NO se tocan (su cobro ya está en el libro).
--   · Bloqueo: la factura primero (`for update`, ya tomada) y los envíos con `skip locked`: `rendir_envios_moto` toma el envío y
--     después la factura, y pedir el envío acá invertiría el orden (deadlock). Si alguien lo está rindiendo, se omite y su cobro se
--     topa contra el saldo vigente (`least(abono, saldo)` en la rendición).
--   · Avanza `updated_at` del envío: quien tenga el diálogo de edición abierto recibe un conflicto (`40001`) y recarga.
--   · Deja el evento `envio_moto.abono_ajustado` (actor nulo: lo hace el sistema) con el mensajero, el abono anterior y el nuevo.
--   · Idempotente: sin efecto cuando el abono ya no supera el saldo.
--   · Límite (documentado): si se anula la nota el abono no sube de nuevo.
-- El resto de la función (estado Cobrado, contrarreembolsos) es idéntico a 20270227150000.
--
-- Seguridad: `security definer`, `search_path = ''`, sin execute para `public`/`anon`/`authenticated` (la función no se
-- expone; solo la llama el disparador). Esquema (Principio VII): sin tablas ni columnas nuevas; escribe `dominio.envios_moto` y
-- el registro de actividad por `private.insertar_actividad`.
--
-- Reversión (en una migración posterior; no se ejecuta en este PR): restaurar la definición de
-- `private.sincronizar_efectos_nota_credito(uuid)` de 20270227150000_notas_credito_sincronizan_estado_y_contrarreembolso.sql.

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
  v_em record;
begin
  select * into v_f from dominio.comprobantes_venta f where f.id = p_factura_id for update;
  if not found or v_f.tipo <> 'factura' or v_f.estado in ('borrador', 'anulada') then
    return;
  end if;

  select * into v_s from private.saldo_comprobante(p_factura_id);

  -- 1) Estado: lo cobrado más las notas cubren la factura → Cobrado (si la matriz de la organización lo permite).
  if v_s.saldo = 0 and v_s.cobrado > 0 and v_f.estado <> 'cobrado' and v_f.empresa_id is not null
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
       -- `skip locked`: `marcar_contrarreembolso_cobrado` toma el contrarreembolso y DESPUÉS la factura; esta función ya
       -- tiene la factura y pedir el contrarreembolso invertiría el orden (deadlock). Si alguien lo está cobrando, se
       -- deja como está: su cobro se valida contra el saldo vigente y falla con el mensaje de tope.
       for update skip locked
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
        format('Contrarreembolso de la guía %s: importe %s → %s al recalcular el saldo tras una nota de crédito en la factura %s',
          v_cr.guia, v_cr.importe, v_s.saldo, v_f.numero),
        v_f.empresa_id
      );
    end loop;
  end if;

  -- 3) Envíos en moto PENDIENTES (sin rendir): el abono no puede superar el saldo neto vigente (decisión de Nicolás, 2026-11-12).
  --    Solo baja (una nota de crédito reduce lo que falta cobrar) y puede quedar en 0 (a diferencia del contrarreembolso, el
  --    abono admite 0). Los envíos ya rendidos no se tocan: su cobro ya está en el libro. Si se anula una nota el abono no se
  --    restituye: no se sabe si el valor original era el saldo o un importe menor a propósito.
  for v_em in
    select e.id, e.abono, e.mensajero, e.updated_at
      from dominio.envios_moto e
     where e.comprobante_id = p_factura_id
       and e.organizacion_id = v_f.organizacion_id
       and not e.rendido
       and e.abono > v_s.saldo
     -- `skip locked`, por el mismo motivo que arriba: `rendir_envios_moto` toma el envío y DESPUÉS la factura, y esta función ya
     -- tiene la factura. Si alguien lo está rindiendo se deja como está: su cobro se topa contra el saldo vigente.
     for update skip locked
  loop
    update dominio.envios_moto
       set abono = v_s.saldo,
           -- Avanza el bloqueo optimista de «Editar»: quien tenga el diálogo abierto ve el abono viejo.
           updated_at = greatest(clock_timestamp(), v_em.updated_at + interval '1 microsecond')
     where id = v_em.id;

    perform private.insertar_actividad(
      v_f.organizacion_id,
      null,
      'envio_moto.abono_ajustado',
      format('Envío en moto del mensajero %s: abono %s → %s al recalcular el saldo tras una nota de crédito en la factura %s',
        v_em.mensajero, v_em.abono, v_s.saldo, v_f.numero),
      v_f.empresa_id
    );
  end loop;
end;
$$;

revoke execute on function private.sincronizar_efectos_nota_credito(uuid) from public, anon, authenticated;

comment on function private.sincronizar_efectos_nota_credito(uuid) is
  'Tras emitir o anular una nota de crédito: pasa la factura a Cobrado si lo cobrado más las notas cubren el total, ajusta los contrarreembolsos pendientes al saldo neto y baja el abono de los envíos en moto sin rendir que lo superen. Idempotente; no ejecutable por authenticated.';
