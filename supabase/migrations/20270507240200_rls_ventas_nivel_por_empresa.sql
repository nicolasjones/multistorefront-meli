-- Lote 42 (MSF-737, residual de MSF-656): las políticas SELECT de `comprobantes_venta`, `comprobantes_venta_lineas`,
-- `rma` y `rma_items` pedían empresa accesible y el nivel de Ventas «de la organización» (el mejor entre sus empresas).
-- Una persona con Ventas en la tienda A y un rol sin Ventas en la B leía los comprobantes y RMA de la B por /rest/v1/.
-- Ahora se exige el nivel de Ventas EN ESA empresa.
--
--   · `private.puede_leer_ventas_empresa(uuid)`: envoltorio `security definer` de `private.nivel_ventas_en_empresa`, como
--     `puede_leer_faltantes_empresa`. `true` si el nivel es lectura o edición. (`20261203100400` le revocó el EXECUTE a
--     `authenticated` a `nivel_ventas_en_empresa`, pero `20261213100200` se lo volvió a conceder: el envoltorio no es
--     imprescindible para poder llamarla, mantiene la función auxiliar fuera de la API.)
--   · Comprobante sin empresa (`empresa_id` nulo, anterior a F-VTA-04): conserva la regla vigente (Ventas de la
--     organización); no pertenece a ninguna tienda.
--
-- Esquema: `dominio` (sin cambios, Principio VII); solo políticas SELECT y una función de `private`.
-- Migración aditiva. Reversión (migración posterior): recrear las cuatro políticas como en `20270507000300` y
--   drop function private.puede_leer_ventas_empresa(uuid).

create or replace function private.puede_leer_ventas_empresa(p_empresa_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select p_empresa_id is not null
    and (select private.nivel_ventas_en_empresa(p_empresa_id)) in ('lectura', 'edicion');
$$;

comment on function private.puede_leer_ventas_empresa(uuid) is
  'true si la persona actual tiene Ventas al menos en lectura en esa empresa concreta (no en la organización). La usan las políticas SELECT de comprobantes y RMA.';

revoke execute on function private.puede_leer_ventas_empresa(uuid) from public, anon;
grant execute on function private.puede_leer_ventas_empresa(uuid) to authenticated;

drop policy if exists comprobantes_venta_select on dominio.comprobantes_venta;
create policy comprobantes_venta_select on dominio.comprobantes_venta
  for select to authenticated
  using (
    organizacion_id = (select private.organizacion_id())
    and (
      (empresa_id is null and (select private.nivel_seccion('ventas')) in ('lectura', 'edicion'))
      or (select private.puede_leer_ventas_empresa(empresa_id))
    )
  );

drop policy if exists comprobantes_venta_lineas_select on dominio.comprobantes_venta_lineas;
create policy comprobantes_venta_lineas_select on dominio.comprobantes_venta_lineas
  for select to authenticated
  using (
    organizacion_id = (select private.organizacion_id())
    and exists (
      select 1 from dominio.comprobantes_venta c
      where c.id = comprobante_id
        and c.organizacion_id = comprobantes_venta_lineas.organizacion_id
        and (
          (c.empresa_id is null and (select private.nivel_seccion('ventas')) in ('lectura', 'edicion'))
          or (select private.puede_leer_ventas_empresa(c.empresa_id))
        )
    )
  );

drop policy if exists rma_select on dominio.rma;
create policy rma_select on dominio.rma
  for select to authenticated
  using (
    organizacion_id = (select private.organizacion_id())
    and (select private.puede_leer_ventas_empresa(empresa_id))
  );

drop policy if exists rma_items_select on dominio.rma_items;
create policy rma_items_select on dominio.rma_items
  for select to authenticated
  using (
    organizacion_id = (select private.organizacion_id())
    and exists (
      select 1 from dominio.rma r
      where r.id = rma_id
        and r.organizacion_id = rma_items.organizacion_id
        and (select private.puede_leer_ventas_empresa(r.empresa_id))
    )
  );
