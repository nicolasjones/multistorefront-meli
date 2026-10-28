-- F-SVC-10 (MSF-390, épica MSF-217, FR-007): el libro de stock sabe cuándo un movimiento nace de una reparación.
-- Esquema (Principio VII): columnas nuevas de `dominio.movimientos_stock` → `dominio` (la tabla ya vive ahí).
--
-- `origen` (por ahora solo `service`; nulo en todos los movimientos existentes), `reparacion_id` (FK compuesta
-- `(reparacion_id, organizacion_id)` a `dominio.reparaciones`: un movimiento no apunta a una reparación de otra
-- organización) y `referencia` (clave de idempotencia). El índice único parcial por `(organizacion_id, referencia)`
-- solo rige para `origen = 'service'`: el segundo intento de un mismo descuento o devolución no inserta nada.
-- No se tocan los movimientos existentes ni los grants (el libro sigue siendo de solo agregado).
--
-- VERSIONES: al integrar la base `dokploy` (2026-10-28) esta banda se renumeró de
-- `20270114100100`…`20270114110200` a `20270114130100`…`20270114130800` para no compartir
-- versión con las migraciones de cobros/pagos. El orden relativo se conserva.
--
-- Migración aditiva. Reversión (migración posterior; exportar antes los movimientos con origen `service`:
-- el libro es de solo agregado):
--   alter table dominio.movimientos_stock
--     drop column referencia, drop column reparacion_id, drop column origen;   -- caen la FK, los checks y el índice

alter table dominio.movimientos_stock
  add column if not exists origen text,
  add column if not exists reparacion_id uuid,
  add column if not exists referencia text;

alter table dominio.movimientos_stock
  add constraint movimientos_stock_origen_check check (origen in ('service')),
  add constraint movimientos_stock_service_check
    check (origen is null or (reparacion_id is not null and referencia is not null)),
  add constraint movimientos_stock_reparacion_fk foreign key (reparacion_id, organizacion_id)
    references dominio.reparaciones (id, organizacion_id);

create unique index if not exists movimientos_stock_service_referencia_uq
  on dominio.movimientos_stock (organizacion_id, referencia)
  where origen = 'service';

create index if not exists movimientos_stock_reparacion_idx
  on dominio.movimientos_stock (reparacion_id)
  where reparacion_id is not null;

comment on column dominio.movimientos_stock.origen is
  'F-SVC-10: de dónde nace el movimiento (`service` = repuesto de una reparación). Nulo en los demás.';
comment on column dominio.movimientos_stock.reparacion_id is
  'F-SVC-10: reparación que originó el movimiento (solo con origen `service`).';
comment on column dominio.movimientos_stock.referencia is
  'F-SVC-10: clave de idempotencia del movimiento de Service: reparacion:<id>:item:<item>:salida|devolucion.';
