-- MSF-816 / F-1 (spec 20261113-120000-precio-promocional-en-pos-y-comprobantes, FR-006, FR-007, FR-023):
-- snapshot del precio promocional en la línea del comprobante.
--
-- Qué hace (solo esquema; no escribe ninguna fila existente):
--   · `dominio.promociones_precio`: `unique (id, organizacion_id)` (`promociones_precio_id_organizacion_uk`),
--     soporte de la FK compuesta de la línea (hoy la tabla solo tiene `PK(id)`).
--   · `dominio.comprobantes_venta_lineas`: dos columnas aditivas y nulables.
--       - `precio_referencia numeric(14,2)`: el precio normal DEL CLIENTE (con su escala y su descuento) sin
--         promoción; solo se guarda cuando la promoción ganó. Es el «tachado».
--       - `promocion_id uuid`: la promoción aplicada (trazabilidad). FK compuesta `(promocion_id,
--         organizacion_id)` con `no action`, como las FK de la línea a productos y depósitos: `restrict` rompería
--         la baja de una organización (ver #902/MSF-844 y docs/e2e-app.md). Con `no action` la comprobación va
--         al final de la sentencia y la cascada de la organización se lleva ambas tablas.
--       - `check` de que las dos van juntas (ambas nulas o ambas con valor) y de que `precio_referencia >=
--         precio_unitario` (la promoción solo gana si es MENOR que el normal).
--     Índice parcial por `promocion_id` (soporta la FK y la búsqueda de líneas de una promoción).
--
-- Esquema (Constitución, Principio VII): `dominio.comprobantes_venta_lineas` y `dominio.promociones_precio` ya
-- son dominio del producto (qué se cobró y contra qué precio); no se crea ninguna tabla y NADA va a `public`.
-- RLS vigente de la línea (organización + sección `ventas`); `anon` sin privilegios; las escribe solo la RPC
-- `guardar_lineas_comprobante` (`authenticated` solo tiene `select`). Sin políticas nuevas.
--
-- Idempotente (guard de migraciones): `add column if not exists`, `drop constraint if exists` + `add
-- constraint`, `create index if not exists`. El orden respeta las dependencias: primero se suelta la FK de la
-- línea (depende del unique), después el unique, y se recrean en el orden inverso. Pasa
-- `node scripts/verificar-migraciones.mjs --estricto` y el guard de DDL (`pnpm docs:check`).
--
-- Reversión (migración POSTERIOR, nunca en el PR que las crea; exportar antes las dos columnas si ya hay datos):
--   alter table dominio.comprobantes_venta_lineas
--     drop constraint if exists comprobantes_venta_lineas_promocion_fk,
--     drop constraint if exists comprobantes_venta_lineas_promocion_juntas_chk,
--     drop constraint if exists comprobantes_venta_lineas_precio_referencia_chk,
--     drop column if exists promocion_id,
--     drop column if exists precio_referencia;
--   alter table dominio.promociones_precio drop constraint if exists promociones_precio_id_organizacion_uk;
--   y restaurar los cuerpos anteriores de las cuatro RPC y de `private.copiar_costo_linea_nota` (cada migración
--   que las cambia nombra la versión a restaurar). Reversión operativa inmediata, SIN migrar: apagar la bandera
--   `promociones_precio` (la función de precio deja de ver promociones y todo vuelve al precio normal).

-- 1. La FK de la línea depende del unique: se suelta primero para que la migración se pueda repetir.
alter table dominio.comprobantes_venta_lineas
  drop constraint if exists comprobantes_venta_lineas_promocion_fk;

alter table dominio.promociones_precio
  drop constraint if exists promociones_precio_id_organizacion_uk;
alter table dominio.promociones_precio
  add constraint promociones_precio_id_organizacion_uk unique (id, organizacion_id);

-- 2. Columnas del snapshot (nulas para todo lo emitido hasta hoy).
alter table dominio.comprobantes_venta_lineas
  add column if not exists precio_referencia numeric(14, 2);
alter table dominio.comprobantes_venta_lineas
  add column if not exists promocion_id uuid;

alter table dominio.comprobantes_venta_lineas
  drop constraint if exists comprobantes_venta_lineas_promocion_juntas_chk;
alter table dominio.comprobantes_venta_lineas
  add constraint comprobantes_venta_lineas_promocion_juntas_chk
  check ((precio_referencia is null) = (promocion_id is null));

alter table dominio.comprobantes_venta_lineas
  drop constraint if exists comprobantes_venta_lineas_precio_referencia_chk;
alter table dominio.comprobantes_venta_lineas
  add constraint comprobantes_venta_lineas_precio_referencia_chk
  check (precio_referencia is null or precio_referencia >= precio_unitario);

alter table dominio.comprobantes_venta_lineas
  add constraint comprobantes_venta_lineas_promocion_fk
  foreign key (promocion_id, organizacion_id)
  references dominio.promociones_precio (id, organizacion_id) on delete no action;

create index if not exists comprobantes_venta_lineas_promocion_idx
  on dominio.comprobantes_venta_lineas (promocion_id)
  where promocion_id is not null;

comment on column dominio.comprobantes_venta_lineas.precio_referencia is
  'MSF-816: precio normal del cliente (con su escala y su descuento) sin promoción; solo si ganó la promoción (el «tachado»). Null sin promoción. Snapshot: no se recalcula nunca.';
comment on column dominio.comprobantes_venta_lineas.promocion_id is
  'MSF-816: promoción de precio aplicada a la línea (trazabilidad; FK compuesta no action). Null sin promoción. No se expone al cliente web.';
comment on constraint promociones_precio_id_organizacion_uk on dominio.promociones_precio is
  'MSF-816: soporte de la FK compuesta de comprobantes_venta_lineas.promocion_id; no cambia datos ni RLS.';
