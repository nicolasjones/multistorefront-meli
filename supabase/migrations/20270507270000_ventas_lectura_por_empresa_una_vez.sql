-- Lote 44 (menor del lote 42, MSF-737): las políticas SELECT de `comprobantes_venta`, `comprobantes_venta_lineas`, `rma` y
-- `rma_items` llamaban a `private.puede_leer_ventas_empresa(empresa_id)` UNA VEZ POR FILA (la llamada depende de la fila: no es un
-- InitPlan), y cada llamada resuelve empresa, `empresas_accesibles()`, rol y matriz. En lecturas directas o de IA sobre miles de
-- comprobantes se nota.
--
-- Ahora las políticas preguntan `empresa_id in (select private.empresas_con_ventas_lectura())`: una subconsulta que NO depende de
-- la fila, que Postgres evalúa UNA vez por consulta (SubPlan en hash) y contra la que compara cada fila. La función devuelve el
-- conjunto de empresas de la organización donde la persona tiene Ventas en `lectura` o `edicion`, calculado con el mismo
-- `private.nivel_ventas_en_empresa` de siempre: la semántica no cambia (empresa de otra organización o sin acceso: 'ninguno', fuera
-- del conjunto; `empresa_id` nulo: `null in (...)` no es verdadero, igual que antes).
--
--   · `private.empresas_con_ventas_lectura()`: `security definer`, `search_path = ''`, `stable`; EXECUTE solo para `authenticated`
--     (`nivel_ventas_en_empresa` también lo tiene concedido a `authenticated` desde `20261213100200`; el envoltorio sigue siendo
--     válido y mantiene la función auxiliar fuera de la API).
--   · `private.puede_leer_ventas_empresa(uuid)` (240200) se conserva sin cambios: ya no la usan las políticas, pero puede haber
--     consumidores futuros y sacarla no aporta.
--
-- Esquema: `dominio` sin cambios (Principio VII); solo políticas SELECT y una función de `private`. Migración aditiva.
-- Reversión (migración posterior): recrear las cuatro políticas como en `20270507240200` y
--   drop function private.empresas_con_ventas_lectura();

create or replace function private.empresas_con_ventas_lectura()
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $$
  select e.id
    from dominio.empresas e
   where e.organizacion_id = (select private.organizacion_id())
     and (select private.nivel_ventas_en_empresa(e.id)) in ('lectura', 'edicion');
$$;

comment on function private.empresas_con_ventas_lectura() is
  'Empresas de la organización activa donde la persona actual tiene Ventas al menos en lectura. Las políticas SELECT de comprobantes y RMA la usan como subconsulta no correlacionada (se evalúa una vez por consulta, no por fila).';

revoke execute on function private.empresas_con_ventas_lectura() from public, anon;
grant execute on function private.empresas_con_ventas_lectura() to authenticated;

drop policy if exists comprobantes_venta_select on dominio.comprobantes_venta;
create policy comprobantes_venta_select on dominio.comprobantes_venta
  for select to authenticated
  using (
    organizacion_id = (select private.organizacion_id())
    and (
      (empresa_id is null and (select private.nivel_seccion('ventas')) in ('lectura', 'edicion'))
      or empresa_id in (select private.empresas_con_ventas_lectura())
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
          or c.empresa_id in (select private.empresas_con_ventas_lectura())
        )
    )
  );

drop policy if exists rma_select on dominio.rma;
create policy rma_select on dominio.rma
  for select to authenticated
  using (
    organizacion_id = (select private.organizacion_id())
    and empresa_id in (select private.empresas_con_ventas_lectura())
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
        and r.empresa_id in (select private.empresas_con_ventas_lectura())
    )
  );

-- Corrección de un comentario impreciso de 20270507240200 (esa migración ya está aplicada y no se edita): `nivel_ventas_en_empresa`
-- NO tiene hoy el EXECUTE revocado a `authenticated`: `20261203100400` se lo revocó y `20261213100200` se lo volvió a conceder.
-- El envoltorio `puede_leer_ventas_empresa` sigue siendo válido (mantiene la función auxiliar fuera de la API), pero no es imprescindible.
comment on function private.puede_leer_ventas_empresa(uuid) is
  'true si la persona actual tiene Ventas al menos en lectura en esa empresa concreta (no en la organización). Envoltorio security definer de nivel_ventas_en_empresa (que authenticated puede ejecutar desde 20261213100200). Las políticas SELECT de comprobantes y RMA usan ahora private.empresas_con_ventas_lectura().';
