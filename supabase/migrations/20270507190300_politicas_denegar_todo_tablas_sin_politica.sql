-- MSF-918 (lote 33): tablas con RLS activado y SIN ninguna política. Con RLS y sin política, `anon` y `authenticated` ya no ven
-- ni escriben nada (deniegan por omisión): el comportamiento NO cambia. Pero la ausencia de política es indistinguible de un olvido
-- (el advisor de Supabase la marca «RLS enabled, no policy»). Se declara la intención: política explícita que deniega todo a
-- `anon` y `authenticated`. Estas tablas las usan solo funciones `security definer`, el rol de servicio (bypassrls) o los
-- workers; ninguna se abre a un cliente. Nunca se otorga acceso: si una pantalla necesita leer una de ellas, va por RPC.
--
-- Migración aditiva (solo políticas; no se toca ningún dato ni grant). Reversión (migración posterior):
--   drop policy if exists <tabla>_denegar_todo on <esquema>.<tabla>;   -- por cada tabla listada abajo; vuelve al estado
--   «RLS sin política» (mismo efecto: denegar todo).

drop policy if exists resumen_semanal_config_denegar_todo on public.resumen_semanal_config;
create policy resumen_semanal_config_denegar_todo on public.resumen_semanal_config
  as permissive for all to anon, authenticated using (false) with check (false);
drop policy if exists resumen_semanal_envios_denegar_todo on public.resumen_semanal_envios;
create policy resumen_semanal_envios_denegar_todo on public.resumen_semanal_envios
  as permissive for all to anon, authenticated using (false) with check (false);
drop policy if exists opiniones_producto_denegar_todo on dominio.opiniones_producto;
create policy opiniones_producto_denegar_todo on dominio.opiniones_producto
  as permissive for all to anon, authenticated using (false) with check (false);
drop policy if exists clientes_exportaciones_ventana_denegar_todo on private.clientes_exportaciones_ventana;
create policy clientes_exportaciones_ventana_denegar_todo on private.clientes_exportaciones_ventana
  as permissive for all to anon, authenticated using (false) with check (false);
drop policy if exists clientes_exportaciones_entregas_denegar_todo on private.clientes_exportaciones_entregas;
create policy clientes_exportaciones_entregas_denegar_todo on private.clientes_exportaciones_entregas
  as permissive for all to anon, authenticated using (false) with check (false);
drop policy if exists limite_pedidos_publicos_denegar_todo on public.limite_pedidos_publicos;
create policy limite_pedidos_publicos_denegar_todo on public.limite_pedidos_publicos
  as permissive for all to anon, authenticated using (false) with check (false);
drop policy if exists correo_masivo_pruebas_denegar_todo on dominio.correo_masivo_pruebas;
create policy correo_masivo_pruebas_denegar_todo on dominio.correo_masivo_pruebas
  as permissive for all to anon, authenticated using (false) with check (false);
drop policy if exists procesos_masivos_errores_claves_denegar_todo on public.procesos_masivos_errores_claves;
create policy procesos_masivos_errores_claves_denegar_todo on public.procesos_masivos_errores_claves
  as permissive for all to anon, authenticated using (false) with check (false);
drop policy if exists consultas_publicas_intentos_denegar_todo on public.consultas_publicas_intentos;
create policy consultas_publicas_intentos_denegar_todo on public.consultas_publicas_intentos
  as permissive for all to anon, authenticated using (false) with check (false);
drop policy if exists exportaciones_actividad_denegar_todo on private.exportaciones_actividad;
create policy exportaciones_actividad_denegar_todo on private.exportaciones_actividad
  as permissive for all to anon, authenticated using (false) with check (false);
drop policy if exists comprobantes_venta_numeracion_denegar_todo on dominio.comprobantes_venta_numeracion;
create policy comprobantes_venta_numeracion_denegar_todo on dominio.comprobantes_venta_numeracion
  as permissive for all to anon, authenticated using (false) with check (false);
drop policy if exists reparacion_enlaces_consulta_denegar_todo on dominio.reparacion_enlaces_consulta;
create policy reparacion_enlaces_consulta_denegar_todo on dominio.reparacion_enlaces_consulta
  as permissive for all to anon, authenticated using (false) with check (false);
drop policy if exists eventos_membresia_denegar_todo on public.eventos_membresia;
create policy eventos_membresia_denegar_todo on public.eventos_membresia
  as permissive for all to anon, authenticated using (false) with check (false);
drop policy if exists intentos_acceso_denegar_todo on public.intentos_acceso;
create policy intentos_acceso_denegar_todo on public.intentos_acceso
  as permissive for all to anon, authenticated using (false) with check (false);
drop policy if exists avisos_pendientes_denegar_todo on public.avisos_pendientes;
create policy avisos_pendientes_denegar_todo on public.avisos_pendientes
  as permissive for all to anon, authenticated using (false) with check (false);
drop policy if exists favoritos_cliente_denegar_todo on dominio.favoritos_cliente;
create policy favoritos_cliente_denegar_todo on dominio.favoritos_cliente
  as permissive for all to anon, authenticated using (false) with check (false);
