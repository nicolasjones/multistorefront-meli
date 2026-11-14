-- MSF-816 (gate MSF-834 · MSF-363 decisión 6): el precio promocional, fijado en la línea del comprobante.
--
-- Qué cambia (aditivo, no toca filas existentes):
--   * `dominio.comprobantes_venta_lineas` suma dos columnas: `precio_referencia` (el precio normal DEL CLIENTE,
--     con su escala y su descuento, sin promoción: el «tachado») y `promocion_id` (la promoción que se aplicó).
--     El importe cobrado sigue siendo `precio_unitario`: ahora es el precio promocional cuando la promoción
--     gana. Las dos columnas van juntas o no van (check) y la referencia nunca es menor que lo cobrado.
--   * `dominio.promociones_precio` suma el `unique (id, organizacion_id)` que exige la FK compuesta de la línea.
--
-- Esquema (Principio VII): se ALTERAN dos tablas del esquema `dominio` (dato de negocio: qué se cobró y contra
-- qué precio). No hay tablas nuevas ni objetos en `public`. La RLS vigente de `comprobantes_venta_lineas`
-- (organización + sección `ventas`) y de `promociones_precio` (organización + permiso por tienda) no cambia:
-- las columnas nuevas las escribe solo la RPC `guardar_lineas_comprobante` (`security definer`), como las demás.
--
-- La FK es `no action` (como las de la línea a productos y depósitos) para no romper la baja de una
-- organización con una línea promocional (ver #902/MSF-844 y docs/e2e-app.md).
--
-- Migración aditiva e idempotente (guard de migraciones: el aplicador puede detenerse y reintentar).
-- Reversión (migración posterior, NUNCA en el mismo PR): exportar antes las dos columnas si ya hay datos y luego
--   alter table dominio.comprobantes_venta_lineas
--     drop constraint comprobantes_venta_lineas_promocion_fk,
--     drop constraint comprobantes_venta_lineas_promocion_check,
--     drop column promocion_id,
--     drop column precio_referencia,
--     drop index comprobantes_venta_lineas_promocion_idx;
--   alter table dominio.promociones_precio drop constraint promociones_precio_id_organizacion_uk;
-- Reversión operativa inmediata, sin migrar: apagar la bandera `promociones_precio` (el local vuelve al precio
-- normal); las líneas ya emitidas conservan su precio.

-- La FK compuesta de la línea necesita un `unique (id, organizacion_id)` en la promoción (hoy solo hay `PK(id)`).
alter table dominio.promociones_precio
  drop constraint if exists promociones_precio_id_organizacion_uk;
alter table dominio.promociones_precio
  add constraint promociones_precio_id_organizacion_uk unique (id, organizacion_id);

comment on constraint promociones_precio_id_organizacion_uk on dominio.promociones_precio is
  'MSF-816: habilita la FK compuesta de la línea del comprobante a la promoción (trazabilidad del precio cobrado).';

-- Snapshot del precio en la línea: qué se cobró y contra qué precio.
alter table dominio.comprobantes_venta_lineas
  add column if not exists precio_referencia numeric(14, 2);
alter table dominio.comprobantes_venta_lineas
  add column if not exists promocion_id uuid;

comment on column dominio.comprobantes_venta_lineas.precio_referencia is
  'MSF-816: precio normal del cliente (con su escala y su descuento) sin promoción, cuando la promoción ganó. Es el precio de referencia que se muestra tachado; null si la línea no está en promoción.';
comment on column dominio.comprobantes_venta_lineas.promocion_id is
  'MSF-816: promoción que se aplicó a la línea (trazabilidad). null si la línea no está en promoción.';

alter table dominio.comprobantes_venta_lineas
  drop constraint if exists comprobantes_venta_lineas_promocion_fk;
alter table dominio.comprobantes_venta_lineas
  add constraint comprobantes_venta_lineas_promocion_fk
  foreign key (promocion_id, organizacion_id)
  references dominio.promociones_precio (id, organizacion_id) on delete no action;

alter table dominio.comprobantes_venta_lineas
  drop constraint if exists comprobantes_venta_lineas_promocion_check;
alter table dominio.comprobantes_venta_lineas
  add constraint comprobantes_venta_lineas_promocion_check
  check (
    (precio_referencia is null) = (promocion_id is null)
    and (precio_referencia is null or precio_referencia >= precio_unitario)
  );

comment on constraint comprobantes_venta_lineas_promocion_check on dominio.comprobantes_venta_lineas is
  'MSF-816: la referencia y la promoción van juntas, y la referencia no puede ser menor que el precio cobrado.';

-- Índice parcial por promoción: la baja de una organización y las consultas por promoción no arrastran las líneas sin promoción.
create index if not exists comprobantes_venta_lineas_promocion_idx
  on dominio.comprobantes_venta_lineas (promocion_id)
  where promocion_id is not null;
