-- MSF-319 · F-NOT-01 (FR-008, FR-010, SC-004): reclamo sin doble toma, reclamo vencido,
-- reintentos con espera creciente, `fallido` con error útil y envío idempotente.
begin;

select plan(28);

insert into organizaciones (id, nombre) values
  ('11111111-1111-1111-1111-111111111111', 'Organización Uno');

insert into auth.users (id, email) values
  ('a1000000-0000-0000-0000-000000000001', 'admin1@example.com');

insert into usuarios_organizacion (user_id, organizacion_id, rol_id, estado) values
  ('a1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'administrador', 'activo');

select is(private.emitir_aviso('consulta_nueva', '11111111-1111-1111-1111-111111111111', '{"n": 1}'), 1, 'se encola el aviso');
update public.avisos_pendientes set ventana_vence_en = now() - interval '1 minute';

-- Sin doble toma.
create temp table q1 on commit drop as select * from private.reclamar_avisos_listos(10);
select is((select count(*)::int from q1), 1, 'el primer reclamo toma el grupo');
select is((select count(*)::int from private.reclamar_avisos_listos(10)), 0, 'un segundo reclamo no toma el mismo grupo');
select is((select estado from public.avisos_pendientes), 'enviando', 'el grupo reclamado queda enviando');

-- Reclamo vencido: vuelve a estar disponible.
update public.avisos_pendientes set reclamado_hasta = now() - interval '1 minute' where estado = 'enviando';
create temp table q2 on commit drop as select * from private.reclamar_avisos_listos(10);
select is((select count(*)::int from q2), 1, 'un reclamo vencido vuelve a estar disponible');
select is((select grupo_id from q2), (select grupo_id from q1), 'es el mismo grupo, no uno duplicado');

-- Primer fallo: espera de 1 minuto.
create temp table f1 on commit drop as
  select * from private.registrar_fallo_aviso((select grupo_id from q1), 'SMTP 535: credenciales rechazadas');
select is((select estado from f1), 'pendiente', 'tras el primer fallo quedan reintentos');
select is((select proximo_intento from f1), now() + interval '1 minute', 'el primer reintento espera 1 minuto');
select is((select count(*)::int from private.reclamar_avisos_listos(10)), 0, 'mientras espera no se reclama');

-- Segundo fallo: espera de 2 minutos.
update public.avisos_pendientes set proximo_intento = now() - interval '1 minute' where estado = 'pendiente';
select is((select count(*)::int from private.reclamar_avisos_listos(10)), 1, 'cumplida la espera se vuelve a reclamar');
create temp table f2 on commit drop as
  select * from private.registrar_fallo_aviso((select grupo_id from q1), 'SMTP 535: credenciales rechazadas');
select is((select proximo_intento from f2), now() + interval '2 minutes', 'la espera crece: 2 minutos');

-- Tercer fallo: 4 minutos.
update public.avisos_pendientes set proximo_intento = now() - interval '1 minute' where estado = 'pendiente';
select is((select count(*)::int from private.reclamar_avisos_listos(10)), 1, 'tercer reclamo');
create temp table f3 on commit drop as
  select * from private.registrar_fallo_aviso((select grupo_id from q1), 'SMTP 535: credenciales rechazadas');
select is((select proximo_intento from f3), now() + interval '4 minutes', 'la espera crece: 4 minutos');

-- Cuarto fallo: 8 minutos.
update public.avisos_pendientes set proximo_intento = now() - interval '1 minute' where estado = 'pendiente';
select is((select count(*)::int from private.reclamar_avisos_listos(10)), 1, 'cuarto reclamo');
create temp table f4 on commit drop as
  select * from private.registrar_fallo_aviso((select grupo_id from q1), 'SMTP 535: credenciales rechazadas');
select is((select proximo_intento from f4), now() + interval '8 minutes', 'la espera crece: 8 minutos');

-- Quinto fallo: agota los reintentos.
update public.avisos_pendientes set proximo_intento = now() - interval '1 minute' where estado = 'pendiente';
select is((select count(*)::int from private.reclamar_avisos_listos(10)), 1, 'quinto reclamo');
create temp table f5 on commit drop as
  select * from private.registrar_fallo_aviso((select grupo_id from q1), 'SMTP 535: credenciales rechazadas');
select is((select estado from f5), 'fallido', 'agotados los reintentos queda fallido');
select is((select proximo_intento from f5), null, 'un grupo fallido no se reprograma');
select is((select intentos from public.avisos_pendientes), 5, 'se contaron los cinco intentos');
select is((select error from public.avisos_pendientes), 'SMTP 535: credenciales rechazadas', 'queda el error útil');
update public.avisos_pendientes set ventana_vence_en = now() - interval '1 hour', proximo_intento = now() - interval '1 hour';
select is((select count(*)::int from private.reclamar_avisos_listos(10)), 0, 'un grupo fallido no vuelve a reclamarse');

-- Envío idempotente.
delete from public.avisos_pendientes;
select private.emitir_aviso('consulta_nueva', '11111111-1111-1111-1111-111111111111', '{"n": 2}');
update public.avisos_pendientes set ventana_vence_en = now() - interval '1 minute';
create temp table q3 on commit drop as select * from private.reclamar_avisos_listos(10);
select private.marcar_aviso_enviado((select grupo_id from q3));
select is((select estado from public.avisos_pendientes), 'enviado', 'marcar enviado cierra el grupo');
update public.avisos_pendientes set enviado_en = now() - interval '1 hour';
select lives_ok(
  format('select private.marcar_aviso_enviado(%L)', (select grupo_id from q3)),
  'marcar enviado dos veces no falla'
);
select is(
  (select enviado_en from public.avisos_pendientes), now() - interval '1 hour',
  'repetir la marca no cambia el momento del envío'
);
select is(
  (select estado from private.registrar_fallo_aviso((select grupo_id from q3), 'tarde')), 'enviado',
  'un fallo tardío no reabre un grupo ya enviado'
);

-- Fallo sin detalle: igual deja un error útil.
delete from public.avisos_pendientes;
select private.emitir_aviso('consulta_nueva', '11111111-1111-1111-1111-111111111111', '{"n": 3}');
update public.avisos_pendientes set ventana_vence_en = now() - interval '1 minute';
create temp table q4 on commit drop as select * from private.reclamar_avisos_listos(10);
select private.registrar_fallo_aviso((select grupo_id from q4), null);
select is((select error from public.avisos_pendientes), 'Error de envío sin detalle', 'un fallo sin mensaje deja un error genérico');

-- Privilegio mínimo del rol de Kestra.
select ok(
  has_function_privilege('kestra_orquestacion', 'private.reclamar_avisos_listos(integer)', 'execute')
  and has_function_privilege('kestra_orquestacion', 'private.marcar_aviso_enviado(uuid)', 'execute')
  and has_function_privilege('kestra_orquestacion', 'private.registrar_fallo_aviso(uuid, text)', 'execute'),
  'el rol de Kestra ejecuta las tres funciones de avisos'
);
select ok(
  not has_table_privilege('kestra_orquestacion', 'public.avisos_pendientes', 'select')
  and not has_function_privilege('authenticated', 'private.reclamar_avisos_listos(integer)', 'execute')
  and not has_function_privilege('anon', 'private.reclamar_avisos_listos(integer)', 'execute'),
  'sin acceso directo a la cola ni a las funciones desde la app'
);

select * from finish();
rollback;
