-- Corrige el permiso de lectura de `dominio.comprobantes_venta.contacto_id` para `authenticated`.
--
-- Por qué: la migración 20270201100100_contactos_vinculos.sql agregó la columna `contacto_id` a la
-- factura, pero NO le concedió `SELECT`. El privilegio de tabla quedó revocado por
-- 20270112140500_envio_aislamiento.sql (los permisos son POR COLUMNA: cada columna legible se
-- concede a mano), así que la columna nueva quedó sin leer para `authenticated`.
--
-- Consecuencia: el contrato de la tabla falla
-- (supabase/tests/database/envio_transporte.test.sql, test 11: "toda columna de la factura que no
-- es del envío se puede leer" → have: contacto_id) y, como el test vive en la base, el check
-- `database` cae en TODOS los PRs: nada se puede mergear.
--
-- El permiso es aditivo: Postgres acumula los `grant select (columna)` sobre una tabla a la que se le
-- revocó el `select` de tabla, así que alcanza con conceder esta columna (no hay que repetir la
-- lista completa de la tabla, que seguiría creciendo con cada columna nueva).

grant select (contacto_id) on table dominio.comprobantes_venta to authenticated;

comment on column dominio.comprobantes_venta.contacto_id is
  'Contacto asociado a la factura (F-SVC-13). Se lee como el resto de las columnas de la cabecera, con la RLS de siempre (organización + sección `ventas`).';

-- Reversión (migración posterior):
--   revoke select (contacto_id) on table dominio.comprobantes_venta from authenticated;
--   comment on column dominio.comprobantes_venta.contacto_id is null;
