-- Verificación de ejecución en curso antes de abrir el navegador (bug
-- reintentos-credencial-invalida, capacidad worker-execution-cycle).
--
-- Mismo criterio que ciclo_ejecuciones_workers.test.sql: en Supabase local
-- postgres no es superusuario y session_user no puede ser un worker_*, así
-- que la lógica de estado se prueba en private.estado_ejecucion_vigente (sin
-- grants) y la autorización real del rol worker se valida en
-- infra/kestra/validar-reintentos-e2e.mjs. Acá se fija además que el wrapper
-- rechaza a cualquier llamante que no sea worker y que los grants son exactos.
begin;

select plan(21);

insert into organizaciones (id, nombre) values
  ('f1111111-1111-1111-1111-111111111111', 'Organización en curso');

-- Fixture de catálogo (spec catálogo-sistemas-externos): conexiones.sistema_externo
-- ahora tiene FK a sistemas_externos.
insert into sistemas_externos (id, descripcion) values
  ('sistema-en-curso', 'Sistema en curso (fixture de test, sin valor de negocio)');

insert into conexiones (id, organizacion_id, sistema_externo, credencial_vault_id) values
  ('f1111111-1111-1111-1111-111111111112', 'f1111111-1111-1111-1111-111111111111', 'sistema-en-curso', gen_random_uuid());

insert into capacidades_ejecucion (id, organizacion_id, conexion_id, clave, tiempo_max_seg) values
  ('f1111111-1111-1111-1111-111111111113', 'f1111111-1111-1111-1111-111111111111', 'f1111111-1111-1111-1111-111111111112', 'reporte-en-curso', 600),
  ('f1111111-1111-1111-1111-111111111114', 'f1111111-1111-1111-1111-111111111111', 'f1111111-1111-1111-1111-111111111112', 'reporte-vencido', 600),
  ('f1111111-1111-1111-1111-111111111115', 'f1111111-1111-1111-1111-111111111111', 'f1111111-1111-1111-1111-111111111112', 'reporte-cerrado', 600);

insert into ejecuciones_worker (id, organizacion_id, conexion_id, capacidad_id, origen, estado, iniciada_en, finalizada_en) values
  ('f1000000-0000-0000-0000-000000000001', 'f1111111-1111-1111-1111-111111111111', 'f1111111-1111-1111-1111-111111111112', 'f1111111-1111-1111-1111-111111111113', 'kestra', 'en_curso', now(), null),
  ('f1000000-0000-0000-0000-000000000002', 'f1111111-1111-1111-1111-111111111111', 'f1111111-1111-1111-1111-111111111112', 'f1111111-1111-1111-1111-111111111114', 'kestra', 'en_curso', now() - interval '11 minutes', null),
  ('f1000000-0000-0000-0000-000000000003', 'f1111111-1111-1111-1111-111111111111', 'f1111111-1111-1111-1111-111111111112', 'f1111111-1111-1111-1111-111111111115', 'kestra', 'fallida', now() - interval '1 minute', now()),
  ('f1000000-0000-0000-0000-000000000004', 'f1111111-1111-1111-1111-111111111111', 'f1111111-1111-1111-1111-111111111112', 'f1111111-1111-1111-1111-111111111115', 'kestra', 'exitosa', now() - interval '2 minutes', now()),
  ('f1000000-0000-0000-0000-000000000005', 'f1111111-1111-1111-1111-111111111111', 'f1111111-1111-1111-1111-111111111112', 'f1111111-1111-1111-1111-111111111115', 'kestra', 'timeout', now() - interval '3 minutes', now());

-- ============================================================================
-- Lógica de estado
-- ============================================================================

select has_function('private', 'estado_ejecucion_vigente', array['uuid'], 'existe la lógica de estado vigente');
select has_function('private', 'ejecucion_worker_en_curso', array['uuid'], 'existe la verificación para workers');

select is(
  (select organizacion_id from private.estado_ejecucion_vigente('f1000000-0000-0000-0000-000000000001')),
  'f1111111-1111-1111-1111-111111111111'::uuid,
  'devuelve la organización dueña para autorizar'
);
select ok(
  (select en_curso from private.estado_ejecucion_vigente('f1000000-0000-0000-0000-000000000001')),
  'en_curso dentro de su tiempo máximo: sigue vigente'
);
select ok(
  not (select en_curso from private.estado_ejecucion_vigente('f1000000-0000-0000-0000-000000000002')),
  'en_curso con tiempo_max_seg vencido: ya no está vigente (el reintento no abre el navegador)'
);
select ok(
  not (select en_curso from private.estado_ejecucion_vigente('f1000000-0000-0000-0000-000000000003')),
  'fallida: no vigente'
);
select ok(
  not (select en_curso from private.estado_ejecucion_vigente('f1000000-0000-0000-0000-000000000004')),
  'exitosa: no vigente'
);
select ok(
  not (select en_curso from private.estado_ejecucion_vigente('f1000000-0000-0000-0000-000000000005')),
  'timeout: no vigente'
);
select is(
  (select count(*) from private.estado_ejecucion_vigente('f1000000-0000-0000-0000-0000000000ff')),
  0::bigint,
  'ejecución desconocida: sin fila'
);
select is(
  (select estado from ejecuciones_worker where id = 'f1000000-0000-0000-0000-000000000002'),
  'en_curso',
  'la verificación es de solo lectura: no cierra la vencida'
);

-- ============================================================================
-- Autorización del wrapper y grants
-- ============================================================================

select throws_ok(
  $$select private.ejecucion_worker_en_curso('f1000000-0000-0000-0000-000000000001')$$,
  'P0001',
  'NO_AUTORIZADO: solo un worker consulta el estado de su ejecución',
  'un llamante que no es worker_* (postgres) es rechazado'
);

select ok(
  has_function_privilege('workers_orquestacion', 'private.ejecucion_worker_en_curso(uuid)', 'execute'),
  'workers_orquestacion puede verificar su ejecución'
);
select ok(
  not has_function_privilege('authenticated', 'private.ejecucion_worker_en_curso(uuid)', 'execute')
  and not has_function_privilege('anon', 'private.ejecucion_worker_en_curso(uuid)', 'execute'),
  'authenticated y anon no pueden llamar la verificación de workers'
);
select ok(
  not has_function_privilege('workers_orquestacion', 'private.estado_ejecucion_vigente(uuid)', 'execute')
  and not has_function_privilege('authenticated', 'private.estado_ejecucion_vigente(uuid)', 'execute')
  and not has_function_privilege('kestra_orquestacion', 'private.estado_ejecucion_vigente(uuid)', 'execute'),
  'la lógica sin autorización no tiene grants'
);

-- ============================================================================
-- Resultado del despacho (única tarea posterior a despacho_ssh)
-- ============================================================================

select has_function('private', 'resolver_resultado_despacho', array['uuid', 'text'], 'existe el resultado del despacho');

update conexiones set estado = 'credencial_invalida' where id = 'f1111111-1111-1111-1111-111111111112';
select lives_ok(
  $$select private.resolver_resultado_despacho('f1111111-1111-1111-1111-111111111112', '')$$,
  'sin motivo no reintentable el despacho se resuelve'
);
select is(
  (select estado from conexiones where id = 'f1111111-1111-1111-1111-111111111112'),
  'activa',
  'sin motivo marca la conexión activa (FR-013)'
);

update conexiones set estado = 'error' where id = 'f1111111-1111-1111-1111-111111111112';
select throws_ok(
  $$select private.resolver_resultado_despacho('f1111111-1111-1111-1111-111111111112', 'CREDENCIAL_INVALIDA')$$,
  'P0001',
  'CREDENCIAL_INVALIDA:f1111111-1111-1111-1111-111111111112',
  'con motivo falla con la marca que clasifica el handler'
);
select is(
  (select estado from conexiones where id = 'f1111111-1111-1111-1111-111111111112'),
  'error',
  'con motivo no toca la conexión'
);
select throws_ok(
  $$select private.resolver_resultado_despacho('f1111111-1111-1111-1111-111111111112', 'token=abc')$$,
  'P0001',
  'MOTIVO_INVALIDO',
  'un motivo fuera de la lista no se refleja en el error'
);
select ok(
  has_function_privilege('kestra_orquestacion', 'private.resolver_resultado_despacho(uuid, text)', 'execute')
  and not has_function_privilege('authenticated', 'private.resolver_resultado_despacho(uuid, text)', 'execute')
  and not has_function_privilege('workers_orquestacion', 'private.resolver_resultado_despacho(uuid, text)', 'execute'),
  'solo kestra_orquestacion resuelve el despacho'
);

select * from finish();
rollback;
