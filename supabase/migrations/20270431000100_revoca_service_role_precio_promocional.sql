-- MSF-816 (hallazgo menor de la revisión retroactiva de #944/#957/#950): `private.promocion_vigente_fila` y
-- `private.precio_linea_venta` se crearon con `revoke execute ... from public, anon, authenticated` y NO nombraron
-- `service_role`, a diferencia de `precio_linea_venta_calculo` y `lineas_con_promocion_desactualizada` (que sí lo hacen).
--
-- Hoy `service_role` no tiene `execute` sobre ellas (la base no otorga privilegios por defecto a las funciones de
-- `private`: el ACL es solo el del dueño), así que esto NO cambia ningún permiso. Lo que corrige es que el
-- `revoke` quede explícito y sobreviva a un `grant execute on all functions in schema private to service_role` (o a un privilegio por defecto) futuro:
-- ambas funciones calculan precios de venta y no deben ser ejecutables por la API de administración.
--
-- Sin romper la convención de `service_role_privilegios` (docs y pgTAP): esa convención da `execute` a `service_role` solo sobre
-- los helpers puros que evalúan los defaults, CHECK, columnas generadas o disparadores no `security definer` de `dominio`.
-- Estas dos funciones no son ninguna de esas cosas (las llaman las RPC `security definer` de ventas y la guarda de la confirmación)
-- y el guard por catálogo de `service_role_privilegios.test.sql` lo verifica.
--
-- Migración aditiva e idempotente (`revoke` sobre un privilegio que ya no está no falla). Reversión: no aplica (no hay nada que
-- restaurar; para darle `execute` a `service_role` habría que decidirlo y probarlo de nuevo).

revoke execute on function private.promocion_vigente_fila(uuid, uuid, timestamptz)
  from public, anon, authenticated, service_role;

revoke execute on function private.precio_linea_venta(uuid, uuid, text, integer, numeric, timestamptz, boolean, uuid)
  from public, anon, authenticated, service_role;
