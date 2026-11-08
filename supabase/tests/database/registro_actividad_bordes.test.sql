-- MSF-170 (revisión independiente, hallazgos 2 y 9): inalterabilidad que no se puede saltear y casos de borde del
-- registro de actividad: triggers ENABLE ALWAYS, TRUNCATE ... CASCADE, service_role, valores de exactamente 8192 y
-- 8193 bytes y borrado en cascada de la organización con los triggers en ALWAYS.
begin;

select plan(19);

insert into organizaciones (id, nombre) values
  ('11111111-1111-1111-1111-111111111111', 'Organización Uno'),
  ('33333333-3333-3333-3333-333333333333', 'Organización Tres');

insert into registro_actividad (id, organizacion_id, tipo, detalle) values
  ('a0000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'otra.cosa', 'Evento uno'),
  ('a0000000-0000-0000-0000-000000000003', '33333333-3333-3333-3333-333333333333', 'otra.cosa', 'Evento tres');

-- ============================================================================
-- Triggers ENABLE ALWAYS (hallazgo 2)
-- ============================================================================

select is(
  (select tgenabled::text from pg_trigger where tgrelid = 'public.registro_actividad'::regclass and tgname = 'registro_actividad_inalterable_fila'),
  'A', 'el trigger de fila está en ENABLE ALWAYS');
select is(
  (select tgenabled::text from pg_trigger where tgrelid = 'public.registro_actividad'::regclass and tgname = 'registro_actividad_inalterable_truncate'),
  'A', 'el trigger de truncate está en ENABLE ALWAYS');

set local session_replication_role = replica;
select throws_ok($$update registro_actividad set detalle = 'x'$$, '42501', null, 'con session_replication_role = replica el UPDATE sigue fallando');
select throws_ok($$delete from registro_actividad where id = 'a0000000-0000-0000-0000-000000000001'$$, '42501', null, 'con session_replication_role = replica el DELETE sigue fallando');
select throws_ok($$truncate registro_actividad$$, '42501', null, 'con session_replication_role = replica el TRUNCATE sigue fallando');
reset session_replication_role;

-- TRUNCATE ... CASCADE (también desde la tabla padre) no vacía el registro.
select throws_ok($$truncate registro_actividad cascade$$, '42501', null, 'TRUNCATE ... CASCADE sobre el registro falla');
select throws_ok($$truncate organizaciones cascade$$, null, null, 'TRUNCATE de organizaciones CASCADE no arrastra el registro');
select is((select count(*)::int from registro_actividad), 2, 'el registro conserva sus eventos');

-- service_role no puede alterar el registro.
set local role service_role;
select throws_ok($$delete from registro_actividad$$, '42501', null, 'service_role no borra');
select throws_ok($$update registro_actividad set detalle = 'x'$$, '42501', null, 'service_role no actualiza');
select throws_ok($$truncate registro_actividad$$, '42501', null, 'service_role no trunca');
reset role;

-- Borrado en cascada de la organización: sigue funcionando con los triggers en ALWAYS.
delete from organizaciones where id = '33333333-3333-3333-3333-333333333333';
select is((select count(*)::int from registro_actividad where organizacion_id = '33333333-3333-3333-3333-333333333333'), 0,
  'eliminar la organización borra su historial en cascada (excepción del trigger)');
select is((select count(*)::int from registro_actividad where organizacion_id = '11111111-1111-1111-1111-111111111111'), 1,
  'y no toca el de las demás');

-- ============================================================================
-- Valores antes/después en el borde de 8 KB (hallazgo 9)
-- ============================================================================

-- `{"k": "` (7) + valor + `"}` (2): 8183 caracteres dan exactamente 8192 bytes.
select is(octet_length(jsonb_build_object('k', repeat('x', 8183))::text), 8192, 'el valor de prueba mide exactamente 8192 bytes');
select lives_ok(
  $$select private.insertar_cambio_actividad('11111111-1111-1111-1111-111111111111', null, 'otra.cosa', 'borde 8192',
      jsonb_build_object('k', repeat('x', 8183)), jsonb_build_object('k', repeat('x', 8183)))$$,
  'un valor anterior y nuevo de exactamente 8192 bytes se acepta');
select throws_ok(
  $$select private.insertar_cambio_actividad('11111111-1111-1111-1111-111111111111', null, 'otra.cosa', 'borde 8193',
      jsonb_build_object('k', repeat('x', 8184)), null)$$,
  '22023', null, 'un valor anterior de 8193 bytes se rechaza');
select throws_ok(
  $$select private.insertar_cambio_actividad('11111111-1111-1111-1111-111111111111', null, 'otra.cosa', 'borde 8193',
      null, jsonb_build_object('k', repeat('x', 8184)))$$,
  '22023', null, 'un valor nuevo de 8193 bytes se rechaza');
select throws_ok(
  $$insert into registro_actividad (organizacion_id, tipo, detalle, valor_nuevo)
    values ('11111111-1111-1111-1111-111111111111', 'otra.cosa', 'directo', jsonb_build_object('k', repeat('x', 8184)))$$,
  '23514', null, 'el check de la tabla también rechaza 8193 bytes en un INSERT directo');
select is((select count(*)::int from registro_actividad where detalle like 'borde 8193'), 0, 'los rechazados no dejan filas');

select * from finish();
rollback;
