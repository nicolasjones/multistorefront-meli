-- MSF-656: las políticas SELECT de `dominio.comprobantes_venta`, `comprobantes_venta_lineas`, `rma` y `rma_items`
-- filtraban solo por organización y sección `ventas`: una persona limitada a una tienda leía por /rest/v1/ los
-- datos de las otras tiendas de su organización. Se agrega el segundo eje de aislamiento (empresa accesible),
-- igual que `cobros_comprobante`, `formas_pago` y `contrarreembolsos`.
--
-- Las hijas no tienen `empresa_id`: lo heredan de la cabecera (`comprobante_id` / `rma_id`, FK compuesto con la
-- organización). Un comprobante heredado sin empresa (`empresa_id` nulo, anterior a F-VTA-04) no pertenece a
-- ninguna otra tienda y sigue visible para la organización, como hasta ahora.
-- Esquema: `dominio` (sin cambios, Principio VII). Solo se reemplazan políticas SELECT; no cambia ninguna tabla.
--
-- Migración aditiva. Reversión (migración posterior): volver a crear cada política solo con
--   organizacion_id = (select private.organizacion_id())
--   and (select private.nivel_seccion('ventas')) in ('lectura', 'edicion')
-- (definiciones originales en 20261018100000, 20261203200100 y 20270113100000).

drop policy if exists comprobantes_venta_select on dominio.comprobantes_venta;
create policy comprobantes_venta_select on dominio.comprobantes_venta
  for select to authenticated
  using (
    organizacion_id = (select private.organizacion_id())
    and (select private.nivel_seccion('ventas')) in ('lectura', 'edicion')
    and (empresa_id is null or empresa_id in (select private.empresas_accesibles()))
  );

drop policy if exists comprobantes_venta_lineas_select on dominio.comprobantes_venta_lineas;
create policy comprobantes_venta_lineas_select on dominio.comprobantes_venta_lineas
  for select to authenticated
  using (
    organizacion_id = (select private.organizacion_id())
    and (select private.nivel_seccion('ventas')) in ('lectura', 'edicion')
    and exists (
      select 1 from dominio.comprobantes_venta c
      where c.id = comprobante_id
        and c.organizacion_id = comprobantes_venta_lineas.organizacion_id
        and (c.empresa_id is null or c.empresa_id in (select private.empresas_accesibles()))
    )
  );

drop policy if exists rma_select on dominio.rma;
create policy rma_select on dominio.rma
  for select to authenticated
  using (
    organizacion_id = (select private.organizacion_id())
    and (select private.nivel_seccion('ventas')) in ('lectura', 'edicion')
    and empresa_id in (select private.empresas_accesibles())
  );

drop policy if exists rma_items_select on dominio.rma_items;
create policy rma_items_select on dominio.rma_items
  for select to authenticated
  using (
    organizacion_id = (select private.organizacion_id())
    and (select private.nivel_seccion('ventas')) in ('lectura', 'edicion')
    and exists (
      select 1 from dominio.rma r
      where r.id = rma_id
        and r.organizacion_id = rma_items.organizacion_id
        and r.empresa_id in (select private.empresas_accesibles())
    )
  );
