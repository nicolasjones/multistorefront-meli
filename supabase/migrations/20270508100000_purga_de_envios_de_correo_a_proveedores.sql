-- Lote 92 (MSF-731, seguimiento del lote 91): purga por antigüedad del registro de envíos de correo a proveedores.
--
-- El lote 91 creó `private.correo_proveedor_envios` (quién, a qué proveedor, cuándo y resultado; sin contenido) y dejó la retención como
-- seguimiento. Esta migración agrega SOLO la función de purga; NO la agenda (agendar es infraestructura: pg_cron o un flow de Kestra, ver
-- docs/funciones-edge-endurecimiento.md, sección «Pendientes»).
--
--   `private.purgar_correo_proveedor_envios(p_dias int default 365)`: borra las filas con más de `p_dias` días de antigüedad (`creado_en`
--   estrictamente anterior a `now() - p_dias días`: una fila de exactamente `p_dias` días se conserva) y devuelve cuántas borró
--   (idempotente). `p_dias` nulo, menor que 30 o mayor que 36500 (100 años: evita el desborde de fecha) se rechaza con `22023` y no borra
--   nada. El piso de 30 días impide vaciar por error un rastro que es evidencia (un `0` o un `1` tecleado a mano). El defecto de 365 días
--   es una decisión de retención reversible: la función no borra a quien la agenda con otro valor.
--
-- ACL (mismo patrón que `private.purgar_cupo_ia`, lote 90): `security definer` con `search_path = ''`; `revoke all ... from public, anon,
-- authenticated` y `grant execute` solo a `service_role`. `service_role` no tiene `delete` sobre la tabla: borra únicamente a través de esta
-- función.
--
-- Reaplicable: `create or replace`, los `revoke` y `grant` son idempotentes.
--
-- Reversión (migración posterior; los pasos son reales). Solo quita la función: no toca la tabla ni sus filas, y si ya hay una purga agendada
-- hay que quitar primero el agendado (por ejemplo `select cron.unschedule('purgar-correo-proveedor-envios');` o desactivar el flow de Kestra), o
-- su próxima ejecución fallará:
--   drop function if exists private.purgar_correo_proveedor_envios(int);
--   Lo ya purgado no se recupera (para eso hay que restaurar un respaldo de la tabla).

create or replace function private.purgar_correo_proveedor_envios(p_dias int default 365)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_borradas bigint;
begin
  if p_dias is null or p_dias < 30 or p_dias > 36500 then
    raise exception 'purgar_correo_proveedor_envios: los días deben ser un entero entre 30 y 36500' using errcode = '22023';
  end if;
  delete from private.correo_proveedor_envios
   where creado_en < now() - make_interval(days => p_dias);
  get diagnostics v_borradas = row_count;
  return v_borradas;
end;
$$;

comment on function private.purgar_correo_proveedor_envios(int) is
  'Borra los envíos de correo a proveedores con más de p_dias días (30 a 36500, defecto 365; idempotente; devuelve cuántas filas borró). Sin agendar: invocar como service_role.';

revoke all on function private.purgar_correo_proveedor_envios(int) from public, anon, authenticated;
grant execute on function private.purgar_correo_proveedor_envios(int) to service_role;
