-- MSF-853 (gate): el camino directo del aviso de consulta quedó sin uso y se elimina.
--
-- Qué pasó: desde la migración 20261210130300 el alta de una consulta NO encola en
-- `dominio.consultas_avisos`: el disparador `consultas_encolar_aviso` llama a
-- `private.encolar_aviso_consulta()`, que emite con `private.emitir_aviso('consulta_nueva', …)`; el aviso
-- sale por la cola de plataforma (`public.avisos_pendientes`) y lo manda el flow `enviar-avisos`
-- (docs/avisos-por-correo.md). La Edge Function `enviar-aviso-consulta` y la tabla
-- `dominio.consultas_avisos` quedaron sin uso: su único consumidor era el flow de Kestra
-- `avisos-consultas`, que barre esa cola vieja, y ese flow se borra en el mismo cambio. La revisión de
-- los E2E lo confirmó: no sale correo SMTP de «nueva consulta» por esa vía.
--
-- Se borran:
--   * `dominio.consultas_avisos`: la cola vieja. No quedan avisos por enviar (el alta ya no encola en
--     ella); solo quedaban filas de avisos ya cerrados, que son histórico y no se exportan.
--   * `public.avisos_consulta_pendientes`, `public.tomar_aviso_consulta` y `public.cerrar_aviso_consulta`:
--     las tres RPC (solo `service_role`) que usaba la función.
--   * `private.correo_avisos_consulta(uuid)`: el ayudante que resolvía el destinatario efectivo
--     (dirección de avisos de la empresa o correo de contacto) solo para esas RPC; queda huérfano.
--
-- NO se toca: el disparador `consultas_encolar_aviso` sobre `dominio.consultas` ni
-- `private.encolar_aviso_consulta()`: su cuerpo actual (20261210130300) emite por `private.emitir_aviso`
-- y sigue siendo el camino vigente. Tampoco se toca `dominio.consultas_configuracion` ni
-- `public.guardar_correo_avisos_consultas` (la dirección que edita la ficha de la empresa).
--
-- La lista de exclusiones de la exportación total nombraba la tabla borrada: se redefine sin ella (la
-- prueba de completitud exige que toda exclusión nombre una tabla que existe).
--
-- Verificación previa (obligatoria): antes de borrar la tabla se comprueba que no quede ningún aviso
-- sin enviar. Si quedara uno en 'pendiente' o 'fallido', ese correo nunca sale (nadie barre la cola
-- vieja: su único consumidor, el flow `avisos-consultas`, se retira en este mismo cambio), así que
-- la migración ABORTA y avisa en vez de perderlo. Para ver la cola antes de aplicar:
--   select estado, count(*) from dominio.consultas_avisos group by 1;
-- Los avisos 'enviado' y 'sin_destinatario' son histórico: no bloquean el retiro.
-- Si la migración aborta, esos avisos hay que resolverlos a mano (revisar con el equipo: el aviso
-- nuevo sale por la cola de plataforma) y volver a aplicar; no se borran solos.
--
-- Retiro en los entornos (no lo hace esta migración): el flow `platform.consultas/avisos-consultas`
-- ya publicado en cada Kestra sigue disparando aunque su RPC ya no existan (una ejecución fallida por
-- minuto) y la Edge Function `enviar-aviso-consulta` desplegada queda viva con su secreto. Por eso el
-- repo borra el flow retirado (`infra/kestra/flows-retirados.txt` + `desplegar-flow.mjs --retirar`) y
-- el runbook de `docs/deployment.md` da los pasos para bajar la función y sus secretos, entorno por
-- entorno. El orden importa: primero el flow y la función, después esta migración.
--
-- Reversión (migración posterior):
--   1. recrear `dominio.consultas_avisos` y las tres RPC con el cuerpo de `20261205200100` y
--      `20261205200200`, y `private.correo_avisos_consulta(uuid)` con el de `20261205200000`;
--   2. volver a excluir `('dominio', 'consultas_avisos', …)` en `private.exclusiones_exportacion_total()`;
--   3. reponer el código: la Edge Function `enviar-aviso-consulta` y el flow `avisos-consultas`
--      (Git: `git revert -m 1 <merge del PR>` deja el código como estaba);
--   4. solo si además se quiere volver al envío directo, restaurar el cuerpo de
--      `private.encolar_aviso_consulta()` de `20261205200100` (eso apaga el camino vigente).

-- Verificación previa: si la cola vieja tuviera avisos sin enviar, aborta (ver el encabezado).
-- Va PRIMERO, antes de borrar nada: si el aplicador no envuelve la migración en una transacción,
-- que aborte sin haber dropped nada (la cola sigue viva y se puede revisar).
do $$
declare
  vivos integer;
begin
  if to_regclass('dominio.consultas_avisos') is not null then
    select count(*) into vivos
    from dominio.consultas_avisos
    where estado in ('pendiente', 'fallido');
    if vivos > 0 then
      raise exception 'MSF-853: la cola vieja tiene % aviso(s) sin enviar (pendiente/fallido); se aborta el retiro para no perderlos.', vivos;
    end if;
  end if;
end;
$$;

drop function if exists public.avisos_consulta_pendientes(integer, integer);
drop function if exists public.tomar_aviso_consulta(uuid, integer);
drop function if exists public.cerrar_aviso_consulta(uuid, boolean, text);
drop function if exists private.correo_avisos_consulta(uuid);

drop table if exists dominio.consultas_avisos;

-- Misma definición que 20270224110206, sin la fila de la tabla borrada.
create or replace function private.exclusiones_exportacion_total()
returns table (esquema text, tabla text, motivo text)
language sql
immutable
set search_path = ''
as $$
  select v.esquema, v.tabla, v.motivo
  from (values
    ('dominio', 'alertas_inicio', 'cola interna de avisos o correo'),
    ('dominio', 'alertas_inicio_calculos', 'cola interna de avisos o correo'),
    ('dominio', 'comprobante_documentos', 'dato derivado o registro de proceso (no es dato de negocio)'),
    ('dominio', 'comprobante_envios_correo', 'cola interna de avisos o correo'),
    ('dominio', 'correo_masivo_pruebas', 'cola interna de avisos o correo'),
    ('dominio', 'faltantes_avisos', 'cola interna de avisos o correo'),
    ('dominio', 'importaciones_productos', 'dato derivado o registro de proceso (no es dato de negocio)'),
    ('dominio', 'importaciones_productos_filas', 'dato derivado o registro de proceso (no es dato de negocio)'),
    ('dominio', 'reparacion_avisos', 'cola interna de avisos o correo'),
    ('dominio', 'reparacion_enlaces_consulta', 'credenciales, conexiones o accesos de plataforma'),
    ('dominio', 'stock_alertas_avisadas', 'cola interna de avisos o correo'),
    ('dominio', 'stock_avisos_reposicion', 'cola interna de avisos o correo'),
    ('public', 'api_claves', 'credenciales, conexiones o accesos de plataforma'),
    ('public', 'api_entregas', 'cola interna de avisos o correo'),
    ('public', 'api_llamadas', 'registro operativo o configuración de plataforma'),
    ('public', 'api_suscripciones', 'credenciales, conexiones o accesos de plataforma'),
    ('public', 'alertas', 'registro operativo o configuración de plataforma'),
    ('public', 'alertas_monitoreo', 'registro operativo o configuración de plataforma'),
    ('public', 'avisos_pendientes', 'cola interna de avisos o correo'),
    ('public', 'capacidades_ejecucion', 'registro operativo o configuración de plataforma'),
    ('public', 'cola_eventos', 'cola interna de avisos o correo'),
    ('public', 'conexiones', 'credenciales, conexiones o accesos de plataforma'),
    ('public', 'conexiones_oauth', 'credenciales, conexiones o accesos de plataforma'),
    ('public', 'conversaciones_chat_ia', 'dato derivado o registro de proceso (no es dato de negocio)'),
    ('public', 'credenciales_mcp', 'credenciales, conexiones o accesos de plataforma'),
    ('public', 'despachos_ejecucion', 'cola interna de avisos o correo'),
    ('public', 'ejecuciones_worker', 'registro operativo o configuración de plataforma'),
    ('public', 'eventos_features', 'registro operativo o configuración de plataforma'),
    ('public', 'eventos_membresia', 'registro operativo o configuración de plataforma'),
    ('public', 'eventos_monitoreo', 'registro operativo o configuración de plataforma'),
    ('public', 'eventos_proveedor_capacidad', 'registro operativo o configuración de plataforma'),
    ('public', 'eventos_reportes', 'registro operativo o configuración de plataforma'),
    ('public', 'excepciones_flow_generico', 'registro operativo o configuración de plataforma'),
    ('public', 'fragmentos_indexados', 'dato derivado o registro de proceso (no es dato de negocio)'),
    ('public', 'invitaciones_organizacion', 'credenciales, conexiones o accesos de plataforma'),
    ('public', 'migracion_cargas', 'dato derivado o registro de proceso (no es dato de negocio)'),
    ('public', 'organizaciones_features', 'registro operativo o configuración de plataforma'),
    ('public', 'procesos_masivos', 'registro operativo o configuración de plataforma'),
    ('public', 'procesos_masivos_errores', 'registro operativo o configuración de plataforma'),
    ('public', 'programacion_ejecucion', 'registro operativo o configuración de plataforma'),
    ('public', 'proveedor_capacidad_cliente', 'registro operativo o configuración de plataforma'),
    ('public', 'proveedor_capacidad_organizacion', 'registro operativo o configuración de plataforma'),
    ('public', 'registro_actividad', 'registro operativo o configuración de plataforma'),
    ('public', 'reportes_organizaciones', 'registro operativo o configuración de plataforma'),
    ('public', 'reportes_organizaciones_roles', 'registro operativo o configuración de plataforma'),
    ('public', 'servidores_organizacion', 'credenciales, conexiones o accesos de plataforma'),
    ('public', 'solicitudes_acceso', 'credenciales, conexiones o accesos de plataforma'),
    ('public', 'superadmin_entradas', 'credenciales, conexiones o accesos de plataforma'),
    ('public', 'superadmin_organizacion_activa', 'credenciales, conexiones o accesos de plataforma')
  ) as v (esquema, tabla, motivo);
$$;
