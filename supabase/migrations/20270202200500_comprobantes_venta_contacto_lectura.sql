-- MSF-768 · `authenticated` vuelve a poder leer `dominio.comprobantes_venta.contacto_id`.
--
-- Esquema (Principio VII): sin tablas nuevas; `dominio.comprobantes_venta` ya es de dominio.
-- 20270112140500 (F-VTA-16) cambió el privilegio de lectura de tabla por uno POR COLUMNA, y 20270201100100
-- (F-CON-05) agregó `contacto_id` sin concederlo: la columna quedó ilegible y el pgTAP de contactos
-- (`permission denied for table comprobantes_venta`) dejó el job `database` en rojo.
--
-- La RLS de siempre (organización + sección `ventas`) sigue rigiendo la fila; solo se concede la columna.
-- No se toca ninguna otra columna (las del envío siguen sin privilegio).
--
-- Migración aditiva. Reversión (en una migración posterior):
--   revoke select (contacto_id) on table dominio.comprobantes_venta from authenticated;

grant select (contacto_id) on table dominio.comprobantes_venta to authenticated;
