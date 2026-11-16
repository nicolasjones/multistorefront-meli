-- MSF-319 · F-NOT-01 (FR-004, FR-006, FR-009, SC-002): destinatarios, preferencia apagada y
-- descarte al reclamar. Corre como postgres (las funciones de private no se conceden a la app).
begin;

select plan(18);

insert into organizaciones (id, nombre) values
  ('11111111-1111-1111-1111-111111111111', 'Organización Uno'),
  ('22222222-2222-2222-2222-222222222222', 'Organización Dos');

insert into auth.users (id, email) values
  ('a1000000-0000-0000-0000-000000000001', 'admin1@example.com'),
  ('a1000000-0000-0000-0000-000000000002', 'operador1@example.com'),
  ('a1000000-0000-0000-0000-000000000003', 'deposito1@example.com'),
  ('a1000000-0000-0000-0000-000000000004', 'suspendido1@example.com'),
  ('a2000000-0000-0000-0000-000000000001', 'admin2@example.com');

insert into usuarios_organizacion (user_id, organizacion_id, rol_id, estado) values
  ('a1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'administrador', 'activo'),
  ('a1000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'operador', 'activo'),
  ('a1000000-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111', 'deposito', 'activo'),
  ('a1000000-0000-0000-0000-000000000004', '11111111-1111-1111-1111-111111111111', 'operador', 'suspendido'),
  ('a2000000-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', 'administrador', 'activo');

-- Nivel de otro usuario en la sección del tipo.
select is(private.nivel_seccion_de_usuario('a1000000-0000-0000-0000-000000000002', 'consultas'), 'edicion',
  'el operador tiene edición en consultas');
select is(private.nivel_seccion_de_usuario('a1000000-0000-0000-0000-000000000003', 'consultas'), 'ninguno',
  'depósito no tiene acceso a consultas');
select is(private.nivel_seccion_de_usuario('a1000000-0000-0000-0000-000000000004', 'consultas'), 'ninguno',
  'un usuario suspendido no tiene acceso');

select throws_ok(
  $$select private.emitir_aviso('inexistente', '11111111-1111-1111-1111-111111111111', '{}')$$,
  '22023', null, 'emitir rechaza un tipo desconocido'
);

-- Sin fila de preferencia = encendido: reciben el administrador y el operador activos con acceso
-- (no depósito, ni el suspendido, ni la otra organización).
select is(
  private.emitir_aviso('consulta_nueva', '11111111-1111-1111-1111-111111111111', '{"n": 1}'), 2,
  'sin preferencias se encola a los usuarios activos con acceso'
);
select set_eq(
  $$select user_id::text from public.avisos_pendientes$$,
  $$values ('a1000000-0000-0000-0000-000000000001'), ('a1000000-0000-0000-0000-000000000002')$$,
  'solo reciben el administrador y el operador de la organización'
);

-- El operador apaga el tipo.
insert into preferencias_aviso (user_id, tipo_aviso, activo)
values ('a1000000-0000-0000-0000-000000000002', 'consulta_nueva', false);

select is(
  private.emitir_aviso('consulta_nueva', '11111111-1111-1111-1111-111111111111', '{"n": 2}'), 1,
  'con el tipo apagado ya no se encola para ese usuario'
);
select is(
  (select count(*)::int from public.avisos_pendientes where user_id = 'a1000000-0000-0000-0000-000000000002'), 1,
  'solo queda el aviso pendiente anterior al cambio'
);

-- Vence la ventana: el aviso pendiente del operador se descarta al reclamar.
update public.avisos_pendientes set ventana_vence_en = now() - interval '1 minute' where estado = 'pendiente';
create temp table reclamados1 on commit drop as select * from private.reclamar_avisos_listos(10);

select is((select count(*)::int from reclamados1), 1, 'solo se reclama el grupo del administrador');
select is((select destinatario from reclamados1), 'admin1@example.com', 'el destinatario es el correo del administrador');
select is((select cantidad from reclamados1), 2, 'el grupo del administrador reúne los dos avisos');
select is(
  (select estado from public.avisos_pendientes where user_id = 'a1000000-0000-0000-0000-000000000002'), 'descartado',
  'el aviso pendiente del tipo apagado se descarta antes de enviarse'
);

-- Usuario suspendido entre la emisión y el envío.
delete from public.avisos_pendientes;
select is(
  private.emitir_aviso('consulta_nueva', '11111111-1111-1111-1111-111111111111', '{"n": 3}'), 1,
  'se encola al administrador activo'
);
update public.usuarios_organizacion set estado = 'suspendido' where user_id = 'a1000000-0000-0000-0000-000000000001';
update public.avisos_pendientes set ventana_vence_en = now() - interval '1 minute' where estado = 'pendiente';
create temp table reclamados2 on commit drop as select * from private.reclamar_avisos_listos(10);

select is((select count(*)::int from reclamados2), 0, 'un usuario que quedó inactivo no recibe el aviso');
select is(
  (select estado from public.avisos_pendientes), 'descartado',
  'el aviso de un usuario inactivo se descarta'
);

-- Usuario que pierde el acceso a la sección entre la emisión y el envío.
delete from public.avisos_pendientes;
update public.preferencias_aviso set activo = true where user_id = 'a1000000-0000-0000-0000-000000000002';
select is(
  private.emitir_aviso('consulta_nueva', '11111111-1111-1111-1111-111111111111', '{"n": 4}'), 1,
  'se encola al operador con la preferencia encendida'
);
update public.usuarios_organizacion set rol_id = 'deposito' where user_id = 'a1000000-0000-0000-0000-000000000002';
update public.avisos_pendientes set ventana_vence_en = now() - interval '1 minute' where estado = 'pendiente';
create temp table reclamados3 on commit drop as select * from private.reclamar_avisos_listos(10);

select is((select count(*)::int from reclamados3), 0, 'quien perdió el acceso a la sección no recibe el aviso');
select ok(
  (select error like 'Descartado%' from public.avisos_pendientes),
  'el descarte deja el motivo registrado'
);

select * from finish();
rollback;
