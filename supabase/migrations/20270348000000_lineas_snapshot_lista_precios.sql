-- F-CLI-21 (MSF-453, épica MSF-450, spec 20270327-100000-listas-de-precios-por-cliente, Fase 3, T014, D12): snapshot de la lista de
-- precios en la línea de venta.
--
-- Esquema (Principio VII): son datos de la venta (qué lista y qué porcentaje se usaron para cobrar la línea) y viven junto a
-- `descuento_pct`, `precio_referencia` y `promocion_id` en `dominio.comprobantes_venta_lineas`; no hay tabla nueva ni política nueva
-- (RLS vigente por organización y sección `ventas`). Las escribe solo `public.guardar_lineas_comprobante`, `copiar_presupuesto`,
-- `crear_presupuesto_tienda` y el disparador que copia el snapshot a las notas de crédito (`20270348000200` y `20270348000300`).
--
-- Columnas (ambas nulas para todo lo emitido hasta hoy y para toda línea que no rige por una lista):
--   · `lista_precio_id uuid`: la lista que fijó el precio normal de la línea (FK compuesta `(lista_precio_id, organizacion_id)` a
--     `dominio.listas_precios`, `no action`: una lista no se borra, se archiva).
--   · `lista_ajuste_pct numeric(5,2)`: el porcentaje que tenía la lista cuando se cobró. Cambiar la lista o reasignar al cliente no
--     cambia lo ya vendido (D12).
--   · `check` de que las dos van juntas y de que el porcentaje respeta los topes de la lista (−90 a +100).
-- Sin `grant` nuevo: como `precio_referencia` y `promocion_id`, los roles de panel leen la línea por `obtener_comprobante`
-- (`security definer`); `authenticated` no recibe `select` de columna sobre estas dos y `service_role` no gana nada.
--
-- Migración aditiva e idempotente (todas las filas existentes quedan en nulo: nada cambia).
-- Reversión (migración posterior; recién cuando ninguna función lea las columnas):
--   alter table dominio.comprobantes_venta_lineas
--     drop constraint comprobantes_venta_lineas_lista_fk,
--     drop constraint comprobantes_venta_lineas_lista_chk,
--     drop column lista_ajuste_pct, drop column lista_precio_id;

alter table dominio.comprobantes_venta_lineas
  add column if not exists lista_precio_id uuid;
alter table dominio.comprobantes_venta_lineas
  add column if not exists lista_ajuste_pct numeric(5, 2);

alter table dominio.comprobantes_venta_lineas
  drop constraint if exists comprobantes_venta_lineas_lista_chk;
alter table dominio.comprobantes_venta_lineas
  add constraint comprobantes_venta_lineas_lista_chk
  check (
    (lista_precio_id is null) = (lista_ajuste_pct is null)
    and (lista_ajuste_pct is null or lista_ajuste_pct between -90.00 and 100.00)
  );

alter table dominio.comprobantes_venta_lineas
  drop constraint if exists comprobantes_venta_lineas_lista_fk;
alter table dominio.comprobantes_venta_lineas
  add constraint comprobantes_venta_lineas_lista_fk
  foreign key (lista_precio_id, organizacion_id)
  references dominio.listas_precios (id, organizacion_id) on delete no action;

create index if not exists comprobantes_venta_lineas_lista_idx
  on dominio.comprobantes_venta_lineas (organizacion_id, lista_precio_id)
  where lista_precio_id is not null;

comment on column dominio.comprobantes_venta_lineas.lista_precio_id is
  'F-CLI-21 (D12): lista de precios que fijó el precio normal de la línea (FK compuesta no action). Null si no rigió una lista. Snapshot: no se recalcula nunca.';
comment on column dominio.comprobantes_venta_lineas.lista_ajuste_pct is
  'F-CLI-21 (D12): porcentaje de ajuste de la lista al momento de cobrar la línea. Va junto con lista_precio_id. Snapshot: cambiar la lista no cambia lo vendido.';
