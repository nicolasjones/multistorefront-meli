-- F-VTA-30 (MSF-320, épica MSF-178, spec 20261027-100000-ventas-rma-devoluciones, FR-020): vínculo del RMA con su
-- resolución. `dominio.rma.nota_credito_id` apunta a la nota de crédito emitida para la devolución.
--
-- Esquema (Principio VII): `dominio.rma` ya existe en `dominio` (20270113100000); solo se le agregan columnas. No se
-- altera `dominio.comprobantes_venta`.
--
-- Columnas nuevas (ambas nullable, sin default: filas existentes quedan "sin resolver"):
--   · nota_credito_id      uuid         FK compuesta (nota_credito_id, organizacion_id) → comprobantes_venta (id, organizacion_id).
--   · stock_reingresado_en timestamptz  marca del reingreso de stock (FR-022). La spec nombra solo `nota_credito_id`; esta
--                                       segunda columna es el marcador de idempotencia/lectura del reingreso (sin ella habría
--                                       que adivinarlo leyendo notas de texto de `movimientos_stock`). Desvío anotado en el PR.
--
-- RLS: sin cambios. `rma` ya tiene RLS por organización y sección `ventas`; sigue sin escritura directa.
--
-- Migración aditiva. Reversión (migración posterior; exportar antes si Ventas ya resolvió devoluciones):
--   alter table dominio.rma drop column stock_reingresado_en;
--   alter table dominio.rma drop column nota_credito_id;

alter table dominio.rma
  add column if not exists nota_credito_id uuid,
  add column if not exists stock_reingresado_en timestamptz;

alter table dominio.rma
  add constraint rma_nota_credito_fk
  foreign key (nota_credito_id, organizacion_id) references dominio.comprobantes_venta (id, organizacion_id);

create index if not exists rma_nota_credito_idx on dominio.rma (nota_credito_id) where nota_credito_id is not null;

comment on column dominio.rma.nota_credito_id is 'Nota de crédito emitida para resolver la devolución (F-VTA-30). Solo la asigna vincular_nota_credito_rma.';
comment on column dominio.rma.stock_reingresado_en is 'Momento en que reingresar_stock_rma devolvió los ítems al stock (F-VTA-30). Nulo = sin reingreso.';
