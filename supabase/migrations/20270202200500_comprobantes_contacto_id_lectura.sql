-- MSF-748 (bug): `dominio.comprobantes_venta.contacto_id` (F-CON-05, 20270201100100) quedó sin privilegio de lectura.
--
-- Esquema (Principio VII): sin tablas nuevas; `dominio.comprobantes_venta` ya es dominio del producto y conserva su RLS.
-- Desde 20270112140500 el privilegio de lectura de esa tabla es POR COLUMNA: una columna nueva no es legible por
-- `authenticated` hasta que una migración la conceda. `contacto_id` no es del envío (no es dato sensible de
-- transporte), así que se concede como el resto de la factura. `origen_tipo`/`origen_id` siguen sin conceder a propósito.
--
-- Migración aditiva. Reversión (migración posterior):
--   revoke select (contacto_id) on table dominio.comprobantes_venta from authenticated;

grant select (contacto_id) on table dominio.comprobantes_venta to authenticated;
