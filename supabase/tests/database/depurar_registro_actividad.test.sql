-- F-AUD-02 (MSF-259, épica MSF-170): depuración por retención del registro de actividad.
-- Cubre FR-008 y SC-003. Las fechas son relativas al reloj de la base (sin fechas absolutas).
begin;

select plan(18);

insert into organizaciones (id, nombre) values
  ('11111111-1111-1111-1111-111111111111', 'Organización Uno'),
  ('22222222-2222-2222-2222-222222222222', 'Organización Dos');

insert into auth.users (id, email) values
  ('b1000000-0000-0000-0000-000000000001', 'administrador@example.com');
insert into usuarios_organizacion (user_id, organizacion_id, rol_id) values
  ('b1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'administrador');

insert into registro_actividad (organizacion_id, actor_id, actor_nombre, tipo, detalle, creado_en) values
  ('11111111-1111-1111-1111-111111111111', null, null, 'otra.cosa', 'Viejo uno A', now() - interval '25 months'),
  ('11111111-1111-1111-1111-111111111111', null, null, 'otra.cosa', 'Viejo uno B', now() - interval '30 months'),
  ('11111111-1111-1111-1111-111111111111', null, null, 'otra.cosa', 'Reciente uno', now() - interval '23 months'),
  ('22222222-2222-2222-2222-222222222222', null, null, 'otra.cosa', 'Viejo dos', now() - interval '36 months'),
  ('22222222-2222-2222-2222-222222222222', null, null, 'otra.cosa', 'Hoy dos', now());

insert into private.exportaciones_actividad (id, organizacion_id, usuario_id, creado_en, cerrada) values
  ('c0000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'b1000000-0000-0000-0000-000000000001', now() - interval '31 days', true),
  ('c0000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'b1000000-0000-0000-0000-000000000001', now() - interval '29 days', true),
  ('c0000000-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111', 'b1000000-0000-0000-0000-000000000001', now() - interval '60 days', false);

-- El rol de Sistema no ve las funciones de pgTAP: sus resultados se guardan en una tabla temporal
create temp table resultado_depuracion (corrida int, borrados int);
grant all on resultado_depuracion to workers_orquestacion;

-- Estructura y privilegios
select is(has_function_privilege('authenticated', 'private.depurar_registro_actividad(timestamptz)', 'execute'), false, 'authenticated no ejecuta la depuración');
select is(has_function_privilege('anon', 'private.depurar_registro_actividad(timestamptz)', 'execute'), false, 'anon no ejecuta la depuración');
select is(has_function_privilege('workers_orquestacion', 'private.depurar_registro_actividad(timestamptz)', 'execute'), true, 'workers_orquestacion ejecuta la depuración');

-- Un rol no autorizado la rechaza y no borra nada
set local role authenticated;
select throws_ok($$select private.depurar_registro_actividad()$$, '42501', null, 'un usuario autenticado no depura');
reset role;
select is((select count(*)::int from registro_actividad where tipo = 'otra.cosa'), 5, 'el rechazo no borra nada');

-- Corrida del rol de Sistema
set local role workers_orquestacion;
insert into resultado_depuracion values (1, private.depurar_registro_actividad());
reset role;
select is((select borrados from resultado_depuracion where corrida = 1), 3, 'borra los 3 eventos con más de 24 meses');

select is((select count(*)::int from registro_actividad where detalle like 'Viejo%'), 0, 'no queda ningún evento viejo');
select is((select count(*)::int from registro_actividad where detalle in ('Reciente uno', 'Hoy dos')), 2, 'los de menos de 24 meses se conservan');
select is(
  (select detalle from registro_actividad where tipo = 'sistema.depurada' and organizacion_id = '11111111-1111-1111-1111-111111111111'),
  'Depuró 2 eventos con más de 24 meses', 'queda un evento de Sistema con la cantidad en la organización Uno'
);
select is(
  (select detalle from registro_actividad where tipo = 'sistema.depurada' and organizacion_id = '22222222-2222-2222-2222-222222222222'),
  'Depuró 1 evento con más de 24 meses', 'y otro en la organización Dos'
);
select is((select actor_id from registro_actividad where tipo = 'sistema.depurada' and organizacion_id = '11111111-1111-1111-1111-111111111111'), null, 'el evento de Sistema no tiene actor');

-- Las exportaciones de más de 30 días se purgan (abiertas o cerradas); las recientes se conservan
select is((select count(*)::int from private.exportaciones_actividad), 1, 'la depuración purga las exportaciones de actividad con más de 30 días');
select is((select id from private.exportaciones_actividad), 'c0000000-0000-0000-0000-000000000002'::uuid, 'y conserva la de 29 días');

-- Idempotencia
set local role workers_orquestacion;
insert into resultado_depuracion values (2, private.depurar_registro_actividad());
reset role;
select is((select borrados from resultado_depuracion where corrida = 2), 0, 'una segunda corrida no borra nada');
select is((select count(*)::int from registro_actividad where tipo = 'sistema.depurada' and organizacion_id in ('11111111-1111-1111-1111-111111111111', '22222222-2222-2222-2222-222222222222')), 2, 'y no suma eventos de Sistema');

-- p_hasta no puede adelantar el corte: una fecha futura no borra lo que tiene menos de 24 meses
set local role workers_orquestacion;
insert into resultado_depuracion values (3, private.depurar_registro_actividad(now() + interval '100 years'));
reset role;
select is((select borrados from resultado_depuracion where corrida = 3), 0, 'p_hasta futuro se limita a now(): no borra eventos recientes');

-- El corte de 30 días tampoco se adelanta con p_hasta futuro
select is((select count(*)::int from private.exportaciones_actividad), 1, 'p_hasta futuro no purga exportaciones recientes');

-- La excepción de la depuración no queda abierta: el borrado directo sigue bloqueado
select throws_ok($$delete from registro_actividad$$, '42501', null, 'tras depurar, el borrado directo sigue rechazado');

select * from finish();
rollback;
