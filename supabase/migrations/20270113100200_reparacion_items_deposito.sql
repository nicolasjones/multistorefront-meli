-- F-SVC-10 (MSF-390, épica MSF-217, FR-001): cada repuesto sabe de qué depósito salió y en qué estado de stock está.
-- Esquema (Principio VII): columnas nuevas de `dominio.reparacion_items` → `dominio` (la tabla ya vive ahí).
--
-- `deposito_id` (FK compuesta `(deposito_id, organizacion_id)` a `dominio.depositos`) solo se completa en un repuesto
-- con producto del catálogo que mueve stock. `stock_estado` es la fuente de verdad de la devolución (F-SVC-11):
-- `sin_movimiento` (por defecto: mano de obra, repuesto libre, «a pedido» e ítems anteriores a esta épica),
-- `descontado`, `pendiente`, `consumido` o `devuelto`. Los ítems existentes quedan `sin_movimiento`
-- (sin retroactivo). Sin grants nuevos: la tabla sigue sin escritura directa; solo la tocan las RPC.
--
-- Migración aditiva. Reversión (migración posterior):
--   alter table dominio.reparacion_items drop column stock_estado, drop column deposito_id;

alter table dominio.reparacion_items
  add column deposito_id uuid,
  add column stock_estado text not null default 'sin_movimiento';

alter table dominio.reparacion_items
  add constraint reparacion_items_stock_estado_check
    check (stock_estado in ('sin_movimiento', 'descontado', 'pendiente', 'consumido', 'devuelto')),
  add constraint reparacion_items_deposito_solo_repuesto_check
    check (deposito_id is null or (tipo = 'repuesto' and producto_id is not null)),
  add constraint reparacion_items_deposito_fk foreign key (deposito_id, organizacion_id)
    references dominio.depositos (id, organizacion_id);

create index reparacion_items_deposito_idx
  on dominio.reparacion_items (deposito_id)
  where deposito_id is not null;

comment on column dominio.reparacion_items.deposito_id is
  'F-SVC-10: depósito del que se descontó el repuesto. Nulo si el ítem no mueve stock.';
comment on column dominio.reparacion_items.stock_estado is
  'F-SVC-10: sin_movimiento | descontado | pendiente | consumido | devuelto. Solo se devuelve lo descontado.';
