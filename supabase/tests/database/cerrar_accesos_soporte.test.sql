-- MSF-170 (revisión independiente, hallazgo 4): cierre automático de los accesos de soporte vencidos.
begin;

select plan(15);

insert into organizaciones (id, nombre) values
  ('11111111-1111-1111-1111-111111111111', 'Organización Uno'),
  ('22222222-2222-2222-2222-222222222222', 'Organización Dos');
insert into auth.users (id, email) values
  ('a5000000-0000-0000-0000-000000000001', 'soporte@example.com'),
  ('a5000000-0000-0000-0000-000000000002', 'soporte-dos@example.com'),
  ('a5000000-0000-0000-0000-000000000003', 'soporte-tres@example.com');
insert into superadmins (user_id) values
  ('a5000000-0000-0000-0000-000000000001'), ('a5000000-0000-0000-0000-000000000002'), ('a5000000-0000-0000-0000-000000000003');

-- Uno: vencido y no volvió. Dos: vencido pero ya salió por su cuenta. Tres: vigente.
insert into superadmin_organizacion_activa (user_id, organizacion_id, entrado_en, vence_en) values
  ('a5000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', now() - interval '5 hours', now() - interval '1 hour'),
  ('a5000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', now() - interval '5 hours', now() - interval '1 hour'),
  ('a5000000-0000-0000-0000-000000000003', '22222222-2222-2222-2222-222222222222', now(), now() + interval '4 hours');

create temp table resultado_cierre (corrida int, cerrados int);
grant all on resultado_cierre to workers_orquestacion;

-- Privilegios (service_role es miembro de workers_orquestacion, igual que con la depuración: es la llave de servidor, no la de la API pública)
select is(has_function_privilege('authenticated', 'private.cerrar_accesos_soporte_vencidos()', 'execute'), false, 'authenticated no ejecuta el cierre');
select is(has_function_privilege('anon', 'private.cerrar_accesos_soporte_vencidos()', 'execute'), false, 'anon no ejecuta el cierre');
select is(has_function_privilege('workers_orquestacion', 'private.cerrar_accesos_soporte_vencidos()', 'execute'), true, 'workers_orquestacion ejecuta el cierre');
select is(pg_has_role('service_role', 'workers_orquestacion', 'member'), true, 'service_role es miembro de workers_orquestacion (20261005000000)');
select is(has_function_privilege('service_role', 'private.cerrar_accesos_soporte_vencidos()', 'execute'), true, 'por esa membresía service_role (llave de servidor, no pública) también la ejecuta');
set local role authenticated;
select throws_ok($$select private.cerrar_accesos_soporte_vencidos()$$, '42501', null, 'un usuario autenticado no cierra accesos');
reset role;
select is((select count(*)::int from superadmin_organizacion_activa), 3, 'los rechazos no cierran nada');

-- La persona 2 sale por su cuenta antes de que corra el cierre: no debe duplicarse el evento.
select set_config('request.jwt.claims', json_build_object('sub', 'a5000000-0000-0000-0000-000000000002', 'role', 'authenticated')::text, true);
set local role authenticated;
select public.salir_de_organizacion();
reset role;

-- Corrida del rol de Sistema
set local role workers_orquestacion;
insert into resultado_cierre values (1, private.cerrar_accesos_soporte_vencidos());
reset role;
select is((select cerrados from resultado_cierre where corrida = 1), 1, 'cierra solo el acceso vencido que nadie había cerrado');
select is(
  (select count(*)::int from registro_actividad where tipo = 'soporte.vencido' and organizacion_id = '11111111-1111-1111-1111-111111111111'
     and actor_id = 'a5000000-0000-0000-0000-000000000001'),
  1, 'registra soporte.vencido en la organización visitada, a nombre de quien estaba adentro');
select is(
  (select count(*)::int from registro_actividad where tipo = 'soporte.vencido' and actor_id = 'a5000000-0000-0000-0000-000000000002'),
  1, 'quien salió por su cuenta tiene un solo soporte.vencido (no se duplica)');
select is(
  (select count(*)::int from superadmin_entradas where accion = 'salida' and user_id = 'a5000000-0000-0000-0000-000000000001'),
  1, 'deja la salida en superadmin_entradas');
select is((select count(*)::int from superadmin_organizacion_activa where user_id = 'a5000000-0000-0000-0000-000000000001'), 0, 'limpia el contexto');
select is((select count(*)::int from superadmin_organizacion_activa where user_id = 'a5000000-0000-0000-0000-000000000003'), 1, 'el acceso vigente no se toca');

-- Idempotencia
set local role workers_orquestacion;
insert into resultado_cierre values (2, private.cerrar_accesos_soporte_vencidos());
reset role;
select is((select cerrados from resultado_cierre where corrida = 2), 0, 'una segunda corrida no cierra nada');
select is((select count(*)::int from registro_actividad where tipo = 'soporte.vencido'), 2, 'y no duplica eventos');

select * from finish();
rollback;
