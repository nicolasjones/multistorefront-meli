-- F-TDA-01 (MSF-241, épica MSF-147): una tienda por empresa, resuelta por dominio.
-- Cubre SC-001 (aislamiento entre dos organizaciones), SC-002 (acceso anónimo: `anon`
-- solo ejecuta `publico`, `publico` no tiene tablas) y SC-004 (mismo resultado para
-- dominio desconocido y tienda desactivada). Verifica FR-001…FR-006 y FR-011/FR-012.
begin;

select plan(34);

-- ============================================================================
-- Fixture (como postgres)
-- ============================================================================

insert into organizaciones (id, nombre) values
  ('11111111-1111-1111-1111-111111111111', 'Organización Uno'),
  ('22222222-2222-2222-2222-222222222222', 'Organización Dos');

insert into auth.users (id, email) values
  ('d1000000-0000-0000-0000-000000000001', 'admin-uno@example.com'),
  ('d2000000-0000-0000-0000-000000000001', 'admin-dos@example.com');

insert into usuarios_organizacion (user_id, organizacion_id, rol_id) values
  ('d1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'administrador'),
  ('d2000000-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', 'administrador');

insert into dominio.empresas (id, organizacion_id, nombre) values
  ('e1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'Uno A'),
  ('e1000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'Uno B'),
  ('e1000000-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111', 'Uno C'),
  ('e1000000-0000-0000-0000-000000000004', '11111111-1111-1111-1111-111111111111', 'Uno D'),
  ('e1000000-0000-0000-0000-000000000005', '11111111-1111-1111-1111-111111111111', 'Uno E'),
  ('e1000000-0000-0000-0000-000000000006', '11111111-1111-1111-1111-111111111111', 'Uno F'),
  ('e2000000-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', 'Dos A'),
  ('e2000000-0000-0000-0000-000000000002', '22222222-2222-2222-2222-222222222222', 'Dos B');

insert into dominio.tiendas (organizacion_id, empresa_id, dominio) values
  ('11111111-1111-1111-1111-111111111111', 'e1000000-0000-0000-0000-000000000001', 'uno-a.ejemplo.com'),
  ('11111111-1111-1111-1111-111111111111', 'e1000000-0000-0000-0000-000000000002', 'uno-b.ejemplo.com'),
  ('22222222-2222-2222-2222-222222222222', 'e2000000-0000-0000-0000-000000000001', 'dos-a.ejemplo.com');

-- ============================================================================
-- Estructura y privilegios (FR-005, SC-002)
-- ============================================================================

select ok(
  exists (select 1 from pg_namespace where nspname = 'publico'),
  'existe el esquema publico'
);
select is(
  (select count(*)::int
     from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'publico' and c.relkind in ('r', 'p')),
  0,
  'el esquema publico no contiene tablas'
);
select is(
  (select relrowsecurity from pg_class where oid = 'dominio.tiendas'::regclass),
  true,
  'dominio.tiendas tiene RLS activado'
);
select is(has_table_privilege('anon', 'dominio.tiendas', 'select'), false, 'anon no lee dominio.tiendas');
select is(has_table_privilege('anon', 'dominio.tiendas', 'insert'), false, 'anon no inserta en dominio.tiendas');
select is(
  has_function_privilege('anon', 'publico.tienda_por_dominio(text)', 'execute'),
  true,
  'anon ejecuta publico.tienda_por_dominio'
);
select is(
  has_function_privilege('authenticated', 'publico.tienda_por_dominio(text)', 'execute'),
  true,
  'authenticated ejecuta publico.tienda_por_dominio'
);
select is(
  has_function_privilege('anon', 'public.empresas_para_selector()', 'execute'),
  false,
  'anon no ejecuta una RPC de public'
);

-- ============================================================================
-- Resolución de los dominios del seed y normalización del host (FR-002, FR-004, FR-011)
-- ============================================================================

select is(
  (select empresa_nombre from publico.tienda_por_dominio('mundojc.localhost')),
  'Mundo JC',
  'el dominio de prueba de Mundo JC resuelve'
);
select is(
  (select empresa_nombre from publico.tienda_por_dominio('sanjavucho.localhost')),
  'San Javucho',
  'el dominio de prueba de San Javucho resuelve'
);
select is(
  (select count(*)::int from publico.tienda_por_dominio('MundoJC.LocalHost:443.')),
  1,
  'el host se normaliza (mayúsculas, puerto y punto final)'
);

-- ============================================================================
-- Dominio desconocido y tienda desactivada: la misma respuesta (FR-003, SC-004)
-- ============================================================================

select is(
  (select count(*)::int from publico.tienda_por_dominio('no-existe.ejemplo.com')),
  0,
  'un dominio desconocido no devuelve filas'
);

update dominio.empresas set activa = false where id = '0f5eed01-0000-4000-8000-000000000002';

select is(
  (select count(*)::int from publico.tienda_por_dominio('sanjavucho.localhost')),
  0,
  'una empresa desactivada no devuelve filas'
);
select is(
  (select count(*)::int from publico.tienda_por_dominio('sanjavucho.localhost')),
  (select count(*)::int from publico.tienda_por_dominio('no-existe.ejemplo.com')),
  'la respuesta es idéntica para dominio desconocido y tienda desactivada'
);

-- ============================================================================
-- Validaciones de la tabla (FR-001, FR-006): unicidad, normalización y FK compuesta
-- ============================================================================

select throws_ok(
  $$insert into dominio.tiendas (organizacion_id, empresa_id, dominio)
      values ('11111111-1111-1111-1111-111111111111', 'e1000000-0000-0000-0000-000000000001', 'otra.ejemplo.com')$$,
  '23505', null,
  'una segunda tienda para la misma empresa se rechaza'
);
select throws_ok(
  $$insert into dominio.tiendas (organizacion_id, empresa_id, dominio)
      values ('11111111-1111-1111-1111-111111111111', 'e1000000-0000-0000-0000-000000000003', 'uno-a.ejemplo.com')$$,
  '23505', null,
  'un dominio repetido se rechaza'
);
select lives_ok(
  $$insert into dominio.tiendas (organizacion_id, empresa_id, dominio)
      values ('11111111-1111-1111-1111-111111111111', 'e1000000-0000-0000-0000-000000000004', 'Otro.Ejemplo.Com:8080.')$$,
  'un dominio con mayúsculas, puerto y punto final se acepta'
);
select is(
  (select dominio from dominio.tiendas where empresa_id = 'e1000000-0000-0000-0000-000000000004'),
  'otro.ejemplo.com',
  'el dominio queda guardado normalizado'
);
select throws_ok(
  $$insert into dominio.tiendas (organizacion_id, empresa_id, dominio)
      values ('11111111-1111-1111-1111-111111111111', 'e1000000-0000-0000-0000-000000000005', 'sin-punto')$$,
  '23514', null,
  'un dominio con formato inválido se rechaza'
);
select throws_ok(
  $$insert into dominio.tiendas (organizacion_id, empresa_id, dominio)
      values ('11111111-1111-1111-1111-111111111111', 'e2000000-0000-0000-0000-000000000002', 'cruzada.ejemplo.com')$$,
  '23503', null,
  'la FK compuesta impide cruzar la tienda con una empresa de otra organización'
);

-- ============================================================================
-- Aislamiento por organización (FR-006, SC-001)
-- ============================================================================

select set_config(
  'request.jwt.claims',
  json_build_object('sub', 'd1000000-0000-0000-0000-000000000001', 'role', 'authenticated')::text,
  true
);
set local role authenticated;

select is(
  (select count(*)::int from dominio.tiendas),
  3,
  'el administrador de la organización Uno ve solo sus tiendas'
);
select is(
  (select count(*)::int from dominio.tiendas where dominio = 'dos-a.ejemplo.com'),
  0,
  'la tienda de la otra organización no es visible'
);
reset role;

select set_config(
  'request.jwt.claims',
  json_build_object('sub', 'd2000000-0000-0000-0000-000000000001', 'role', 'authenticated')::text,
  true
);
set local role authenticated;

select is(
  (select count(*)::int from dominio.tiendas),
  1,
  'el administrador de la organización Dos ve solo su tienda'
);
select is(
  (select count(*)::int from dominio.tiendas where dominio = 'uno-a.ejemplo.com'),
  0,
  'la tienda de la organización Uno no es visible'
);
reset role;

-- ============================================================================
-- Auditoría: tienda.dominio_configurado (FR-012)
-- ============================================================================

select is(
  (select count(*)::int from public.registro_actividad
    where tipo = 'tienda.dominio_configurado' and empresa_id = 'e1000000-0000-0000-0000-000000000001'),
  1,
  'la creación de la tienda registra tienda.dominio_configurado'
);

update dominio.tiendas set dominio = 'uno-a-nuevo.ejemplo.com'
 where empresa_id = 'e1000000-0000-0000-0000-000000000001';

select is(
  (select count(*)::int from public.registro_actividad
    where tipo = 'tienda.dominio_configurado' and empresa_id = 'e1000000-0000-0000-0000-000000000001'),
  2,
  'el cambio de dominio registra otro tienda.dominio_configurado'
);
select is(
  (select organizacion_id::text || '|' || (creado_en is not null)::text
     from public.registro_actividad
    where tipo = 'tienda.dominio_configurado' and empresa_id = 'e1000000-0000-0000-0000-000000000001'
    order by creado_en desc limit 1),
  '11111111-1111-1111-1111-111111111111|true',
  'el evento lleva organización y fecha'
);

select set_config(
  'request.jwt.claims',
  json_build_object('sub', 'd1000000-0000-0000-0000-000000000001', 'role', 'authenticated')::text,
  true
);

insert into dominio.tiendas (organizacion_id, empresa_id, dominio)
values ('11111111-1111-1111-1111-111111111111', 'e1000000-0000-0000-0000-000000000006', 'actor.ejemplo.com');

select is(
  (select actor_id::text from public.registro_actividad
    where tipo = 'tienda.dominio_configurado' and empresa_id = 'e1000000-0000-0000-0000-000000000006'),
  'd1000000-0000-0000-0000-000000000001',
  'el evento guarda el actor de la sesión'
);
select is(
  (select tipo from public.registro_actividad
    where empresa_id = 'e1000000-0000-0000-0000-000000000006' and tipo = 'tienda.dominio_configurado'),
  'tienda.dominio_configurado',
  'el tipo del evento es tienda.dominio_configurado'
);

-- ============================================================================
-- Acceso anónimo (FR-005, SC-002)
-- ============================================================================

select is(has_schema_privilege('anon', 'publico', 'usage'), true, 'anon tiene usage sobre publico');
select is(has_schema_privilege('anon', 'dominio', 'usage'), false, 'anon no tiene usage sobre dominio');

select set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);
set local role anon;

select lives_ok(
  $$select * from publico.tienda_por_dominio('mundojc.localhost')$$,
  'anon resuelve la tienda por su dominio'
);
select throws_ok(
  $$select * from dominio.tiendas$$,
  '42501', null,
  'anon no puede leer dominio.tiendas'
);
select throws_ok(
  $$select * from public.empresas_para_selector()$$,
  '42501', null,
  'anon no puede ejecutar una RPC de public'
);
reset role;

select * from finish();

rollback;
