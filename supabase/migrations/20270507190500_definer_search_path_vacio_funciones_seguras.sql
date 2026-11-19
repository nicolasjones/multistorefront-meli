-- MSF-899 / MSF-917 (lote 33): `security definer` con `search_path` distinto de '' -> '' en las funciones que el análisis
-- reproducible (`node scripts/analizar-definer-search-path.mjs`) marca SEGURAS: todo su cuerpo ya califica los objetos
-- (`public.eventos_seguridad_usuario`, `private.hash_correo_acceso`, `private.registrar_alerta`...) o no referencia ninguno.
-- Con '' solo se resuelve `pg_catalog` (jsonb, now(), btrim, length...), que alcanza para estas seis.
-- NO se tocan las tres que el análisis marca «a revisar» (private.is_superadmin, private.organizacion_id, private.puede_escribir:
-- leen `superadmins` / `usuarios_organizacion` sin calificar y están en el camino caliente de toda política RLS); su plan está en
-- docs/higiene-base-datos.md. En esta base (migraciones del repo) solo quedan estas nueve funciones; el resto del conteo que ve el
-- DEV (462-750) es deriva del entorno, no del código (ver el runbook).
-- `alter function ... set search_path` no redefine el cuerpo: conserva firma, ACL y atributos.
--
-- Migración aditiva. Reversión (migración posterior), restaurar el search_path anterior:
--   alter function private.registrar_cambios_seguridad_usuario() set search_path = public;
--   alter function public.registrar_inicio_sesion(jsonb) set search_path = public;
--   alter function private.procesar_falla_orquestacion(uuid, uuid, text) set search_path = public, private, pg_temp;
--   alter function public.bloqueo_acceso_hasta(text) set search_path = public;
--   alter function private.purgar_evidencias_ia(timestamptz) set search_path = private, public;
--   alter function public.limpiar_intentos_acceso() set search_path = public;

alter function private.registrar_cambios_seguridad_usuario() set search_path = '';
alter function public.registrar_inicio_sesion(jsonb) set search_path = '';
alter function private.procesar_falla_orquestacion(uuid, uuid, text) set search_path = '';
alter function public.bloqueo_acceso_hasta(text) set search_path = '';
alter function private.purgar_evidencias_ia(timestamptz) set search_path = '';
alter function public.limpiar_intentos_acceso() set search_path = '';
