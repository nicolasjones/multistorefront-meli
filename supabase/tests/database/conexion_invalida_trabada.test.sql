-- Conexión en credencial_invalida o error no queda trabada (bug
-- conexion-invalida-trabada, FR-013 de la spec 013, capacidad
-- worker-execution-cycle). Ver
-- .specify/bugs/conexion-invalida-trabada/assessment.md.
begin;

select plan(16);

insert into organizaciones (id, nombre) values
  ('c1111111-1111-1111-1111-111111111111', 'Organización trabada'),
  ('c2222222-2222-2222-2222-222222222222', 'Organización en error');

insert into auth.users (id, email) values
  ('c1000000-0000-0000-0000-000000000001', 'admin-trabada@example.com'),
  ('c2000000-0000-0000-0000-000000000001', 'admin-error@example.com');

insert into usuarios_organizacion (user_id, organizacion_id, rol_id) values
  ('c1000000-0000-0000-0000-000000000001', 'c1111111-1111-1111-1111-111111111111', 'administrador'),
  ('c2000000-0000-0000-0000-000000000001', 'c2222222-2222-2222-2222-222222222222', 'administrador');

-- Fixture de catálogo (spec catálogo-sistemas-externos): conexiones.sistema_externo
-- ahora tiene FK a sistemas_externos.
insert into sistemas_externos (id, descripcion) values
  ('sistema-trabado', 'Sistema trabado (fixture de test, sin valor de negocio)');

insert into conexiones (id, organizacion_id, sistema_externo, estado, credencial_vault_id) values
  ('c1111111-1111-1111-1111-111111111112', 'c1111111-1111-1111-1111-111111111111', 'sistema-trabado', 'credencial_invalida',
   vault.create_secret('credencial-vieja', 'conexion-trabada-' || gen_random_uuid())),
  ('c2222222-2222-2222-2222-222222222223', 'c2222222-2222-2222-2222-222222222222', 'sistema-trabado', 'error', gen_random_uuid());

insert into capacidades_ejecucion (id, organizacion_id, conexion_id, clave) values
  ('c1111111-1111-1111-1111-111111111113', 'c1111111-1111-1111-1111-111111111111', 'c1111111-1111-1111-1111-111111111112', 'reporte-trabado'),
  ('c2222222-2222-2222-2222-222222222224', 'c2222222-2222-2222-2222-222222222222', 'c2222222-2222-2222-2222-222222222223', 'reporte-error');

-- ============================================================================
-- Recorrido del genérico: error no bloquea, credencial_invalida se saltea
-- ============================================================================

select is(
  (select array_agg(organizacion_id order by organizacion_id) from private.organizaciones_activas_para_conector('sistema-trabado')),
  array['c2222222-2222-2222-2222-222222222222'::uuid],
  'el genérico recorre la conexión en error y saltea la de credencial_invalida'
);

-- ============================================================================
-- Disparos de un administrador autenticado
-- ============================================================================

select set_config(
  'request.jwt.claims',
  json_build_object('sub', 'c1000000-0000-0000-0000-000000000001', 'role', 'authenticated')::text,
  true
);
set local role authenticated;

select throws_ok(
  $$select iniciar_ejecucion_worker('c1111111-1111-1111-1111-111111111112', 'reporte-trabado', 'programada')$$,
  'P0001',
  'CONEXION_CREDENCIAL_INVALIDA: la conexión c1111111-1111-1111-1111-111111111112 tiene la credencial rechazada; actualizala o iniciá la ejecución manualmente',
  'credencial_invalida: un origen programado no reintenta el login'
);

select throws_ok(
  $$select iniciar_ejecucion_worker('c1111111-1111-1111-1111-111111111112', 'reporte-trabado', 'kestra')$$,
  'P0001',
  'CONEXION_CREDENCIAL_INVALIDA: la conexión c1111111-1111-1111-1111-111111111112 tiene la credencial rechazada; actualizala o iniciá la ejecución manualmente',
  'credencial_invalida: un origen kestra no reintenta el login'
);

select lives_ok(
  $$select iniciar_ejecucion_worker('c1111111-1111-1111-1111-111111111112', 'reporte-trabado', 'manual', 'c1000000-0000-0000-0000-000000000001')$$,
  'credencial_invalida: el administrador puede disparar a mano (un intento)'
);

reset role;

select is(
  (select count(*) from despachos_ejecucion d join ejecuciones_worker e on e.id = d.ejecucion_id
   where e.conexion_id = 'c1111111-1111-1111-1111-111111111112' and e.origen = 'manual'),
  1::bigint,
  'el disparo manual crea su orden de despacho'
);

select is(
  (select estado from conexiones where id = 'c1111111-1111-1111-1111-111111111112'),
  'credencial_invalida',
  'disparar no cambia el estado: lo limpia la ejecución exitosa'
);

update ejecuciones_worker set estado = 'fallida', finalizada_en = now()
where conexion_id = 'c1111111-1111-1111-1111-111111111112' and estado = 'en_curso';

-- Sin sesión authenticated (worker, Kestra u otro rol): no puede forzarlo
-- aunque diga manual.
select set_config('request.jwt.claims', '', true);
select throws_ok(
  $$select iniciar_ejecucion_worker('c1111111-1111-1111-1111-111111111112', 'reporte-trabado', 'manual', 'c1000000-0000-0000-0000-000000000001')$$,
  'P0001',
  'CONEXION_CREDENCIAL_INVALIDA: la conexión c1111111-1111-1111-1111-111111111112 tiene la credencial rechazada; actualizala o iniciá la ejecución manualmente',
  'credencial_invalida: un manual sin sesión authenticated se rechaza'
);

-- ============================================================================
-- error no bloquea ningún origen
-- ============================================================================

select set_config(
  'request.jwt.claims',
  json_build_object('sub', 'c2000000-0000-0000-0000-000000000001', 'role', 'authenticated')::text,
  true
);
set local role authenticated;

select lives_ok(
  $$select iniciar_ejecucion_worker('c2222222-2222-2222-2222-222222222223', 'reporte-error', 'programada')$$,
  'error: el programado vuelve a correr'
);

reset role;
update ejecuciones_worker set estado = 'fallida', finalizada_en = now()
where conexion_id = 'c2222222-2222-2222-2222-222222222223' and estado = 'en_curso';
set local role authenticated;

select lives_ok(
  $$select iniciar_ejecucion_worker('c2222222-2222-2222-2222-222222222223', 'reporte-error', 'manual', 'c2000000-0000-0000-0000-000000000001')$$,
  'error: el manual vuelve a correr'
);

-- ============================================================================
-- Actualizar la credencial destraba credencial_invalida
-- ============================================================================

reset role;
select set_config(
  'request.jwt.claims',
  json_build_object('sub', 'c1000000-0000-0000-0000-000000000001', 'role', 'authenticated')::text,
  true
);
set local role authenticated;

select lives_ok(
  $$select public.actualizar_credencial_conexion('c1111111-1111-1111-1111-111111111112', 'credencial-nueva')$$,
  'el administrador actualiza la credencial'
);

reset role;

select is(
  (select estado from conexiones where id = 'c1111111-1111-1111-1111-111111111112'),
  'activa',
  'actualizar la credencial devuelve la conexión a activa (se presume válida, como al crearla)'
);

select is(
  (select decrypted_secret from vault.decrypted_secrets s join conexiones c on c.credencial_vault_id = s.id
   where c.id = 'c1111111-1111-1111-1111-111111111112'),
  'credencial-nueva',
  'la credencial se rotó'
);

select is(
  (select array_agg(organizacion_id order by organizacion_id) from private.organizaciones_activas_para_conector('sistema-trabado')),
  array['c1111111-1111-1111-1111-111111111111'::uuid, 'c2222222-2222-2222-2222-222222222222'::uuid],
  'tras actualizar la credencial el genérico vuelve a recorrer la conexión'
);

update conexiones set estado = 'error' where id = 'c1111111-1111-1111-1111-111111111112';
select set_config(
  'request.jwt.claims',
  json_build_object('sub', 'c1000000-0000-0000-0000-000000000001', 'role', 'authenticated')::text,
  true
);
set local role authenticated;
select lives_ok(
  $$select public.actualizar_credencial_conexion('c1111111-1111-1111-1111-111111111112', 'otra-credencial')$$,
  'actualizar la credencial de una conexión en error'
);
reset role;
select is(
  (select estado from conexiones where id = 'c1111111-1111-1111-1111-111111111112'),
  'error',
  'actualizar la credencial no toca error (lo limpia la próxima ejecución exitosa)'
);

-- FR-013: la ejecución exitosa la limpia por el camino del flow.
select lives_ok(
  $$select private.marcar_conexion_activa('c1111111-1111-1111-1111-111111111112')$$,
  'la ejecución exitosa marca la conexión activa'
);

select * from finish();
rollback;
