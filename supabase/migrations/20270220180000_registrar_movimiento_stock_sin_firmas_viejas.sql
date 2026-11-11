-- Hallazgo al verificar MSF-229 en dev (2026-11-09): la base de dev tenía DOS firmas de `public.registrar_movimiento_stock`: la
-- de 6 parámetros (resto de 20261017140100, con el cuerpo original de 3.420 caracteres) y la vigente de 9 (20270220120400).
-- Las migraciones 20261023120200, 20261202100100 y 20270220120400 borran cada una la firma anterior, así que una base armada
-- desde cero (CI, pgTAP `catalogo_variantes_stock` «queda una sola firma») solo tiene la de 9; la de dev quedó de un camino de
-- armado distinto. Con las dos presentes, CUALQUIER llamada de 6 argumentos (como `registrar_ingreso_mercaderia`, que pasa los
-- 6 posicionales) falla con «function … is not unique», porque la de 9 tiene valores por defecto y las dos aplican.
--
-- Esta migración borra las firmas viejas SI EXISTEN. Es idempotente y no hace nada en una base que ya tiene solo la vigente
-- (CI, stg, producción si están al día). No cambia la firma vigente ni sus permisos.
--
-- Esquemas (Principio VII): sin tablas ni columnas; solo `drop function if exists` sobre funciones de `public`.
-- Migración aditiva en el sentido del proyecto: no destruye datos. Reversión (migración posterior): no corresponde recrear las
-- firmas viejas (eran ambiguas con la vigente); la definición vigente está en `20270220120400_catalogo_variantes_movimientos.sql`.

drop function if exists public.registrar_movimiento_stock(uuid, text, integer, uuid, text, date);
drop function if exists public.registrar_movimiento_stock(uuid, text, integer, uuid, text, date, uuid);
drop function if exists public.registrar_movimiento_stock(uuid, text, integer, uuid, text, date, uuid, uuid);
