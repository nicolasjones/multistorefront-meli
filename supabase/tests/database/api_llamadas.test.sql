-- F-API-01 (MSF-403, FR-007, FR-008): auditoría de las llamadas y límite de uso.
--
-- Comprueba que toda llamada (incluidas las rechazadas) queda auditada sin el
-- token, que el límite de 60 por minuto corta con `reintentar_en_seg` y que la
-- retención de 90 días borra solo lo vencido.
begin;

select no_plan();

insert into organizaciones (id, nombre) values
  ('a1000000-0000-0000-0000-000000000001', 'Organización A'),
  ('a1000000-0000-0000-0000-000000000002', 'Organización B');

insert into auth.users (id, email) values
  ('f1000000-0000-0000-0000-000000000001', 'admin-api-a@example.com'),
  ('f2000000-0000-0000-0000-000000000001', 'admin-api-b@example.com');

insert into usuarios_organizacion (user_id, organizacion_id, rol_id, estado) values
  ('f1000000-0000-0000-0000-000000000001', 'a1000000-0000-0000-0000-000000000001', 'administrador', 'activo'),
  ('f2000000-0000-0000-0000-000000000001', 'a1000000-0000-0000-0000-000000000002', 'administrador', 'activo');

create temporary table claves (
  clave text primary key,
  id uuid not null
);
grant all on claves to authenticated, service_role;

-- Una clave real (creada por la RPC) para auditar contra ella.
select set_config(
  'request.jwt.claims',
  json_build_object('sub', 'f1000000-0000-0000-0000-000000000001', 'role', 'authenticated')::text,
  true
);
set local role authenticated;

with creada as (
  select public.crear_clave_api('Clave de auditoría', array['productos'], null) as c
)
insert into claves (clave, id) select 'principal', (c).id from creada;

reset role;

-- ============================================================================
-- Tabla, RLS y privilegios
-- ============================================================================

select has_table('public', 'api_llamadas', 'existe la tabla public.api_llamadas');

select is(
  (select relrowsecurity from pg_class where oid = 'public.api_llamadas'::regclass),
  true,
  'RLS habilitada en api_llamadas'
);

select is(
  has_table_privilege('authenticated', 'public.api_llamadas', 'INSERT'),
  false,
  'authenticated no puede auditar llamadas directo'
);

select is(
  has_table_privilege('service_role', 'public.api_llamadas', 'INSERT'),
  true,
  'service_role puede auditar llamadas'
);

select is(
  has_function_privilege('authenticated', 'public.api_registrar_llamada(uuid, uuid, text, text, text, integer, integer)', 'EXECUTE'),
  false,
  'authenticated no puede registrar llamadas'
);

select is(
  has_function_privilege('service_role', 'public.api_registrar_llamada(uuid, uuid, text, text, text, integer, integer)', 'EXECUTE'),
  true,
  'service_role registra llamadas'
);

select is(
  has_function_privilege('service_role', 'public.api_controlar_limite(uuid)', 'EXECUTE'),
  true,
  'service_role controla el límite'
);

-- ============================================================================
-- Auditoría de una llamada (FR-008)
-- ============================================================================

set local role service_role;

select lives_ok(
  $$select public.api_registrar_llamada(
    (select id from claves where clave = 'principal'),
    'a1000000-0000-0000-0000-000000000001',
    'GET', '/api-v1/v1/productos', 'v1', 200, 42)$$,
  'una llamada autenticada se audita'
);

reset role;

select is(
  (select count(*)::int from public.api_llamadas where clave_id = (select id from claves where clave = 'principal')),
  1,
  'la llamada queda registrada'
);

select is(
  (select metodo from public.api_llamadas where clave_id = (select id from claves where clave = 'principal')),
  'GET',
  'la auditoría guarda el método'
);

select is(
  (select ruta from public.api_llamadas where clave_id = (select id from claves where clave = 'principal')),
  '/api-v1/v1/productos',
  'la auditoría guarda la ruta'
);

select is(
  (select version from public.api_llamadas where clave_id = (select id from claves where clave = 'principal')),
  'v1',
  'la auditoría guarda la versión'
);

select is(
  (select estado_http from public.api_llamadas where clave_id = (select id from claves where clave = 'principal')),
  200,
  'la auditoría guarda el estado'
);

select is(
  (select duracion_ms from public.api_llamadas where clave_id = (select id from claves where clave = 'principal')),
  42,
  'la auditoría guarda la duración'
);

select ok(
  (select ultimo_uso_en is not null from public.api_claves where id = (select id from claves where clave = 'principal')),
  'la clave registra el último uso'
);

select is(
  (select count(*)::int from public.api_llamadas
     where ruta like '%token%' or metodo like '%msf_%'),
  0,
  'la auditoría no guarda el token'
);

-- Una llamada con prefijo desconocido se audita sin organización.
set local role service_role;

select lives_ok(
  $$select public.api_registrar_llamada(null, null, 'GET', '/api-v1/v1/productos', 'v1', 401, 3)$$,
  'una llamada con token inválido se audita'
);

reset role;

select is(
  (select count(*)::int from public.api_llamadas where organizacion_id is null and estado_http = 401),
  1,
  'la llamada rechazada queda auditada sin organización'
);

-- ============================================================================
-- Límite de uso (FR-007)
-- ============================================================================

-- Se baja el límite de la clave a 3 para no registrar 60 llamadas.
update public.api_claves set limite_por_minuto = 3 where id = (select id from claves where clave = 'principal');

set local role service_role;

-- Se completan las tres llamadas de la ventana (una ya estaba auditada).
select lives_ok(
  $$select public.api_registrar_llamada(
    (select id from claves where clave = 'principal'),
    'a1000000-0000-0000-0000-000000000001',
    'GET', '/api-v1/v1/stock', 'v1', 200, 12)$$,
  'la segunda llamada de la ventana se audita'
);

select lives_ok(
  $$select public.api_registrar_llamada(
    (select id from claves where clave = 'principal'),
    'a1000000-0000-0000-0000-000000000001',
    'GET', '/api-v1/v1/precios', 'v1', 200, 13)$$,
  'la tercera llamada de la ventana se audita'
);

select is(
  (select permitido from public.api_controlar_limite((select id from claves where clave = 'principal'))),
  false,
  'con el límite alcanzado la llamada se rechaza'
);

select ok(
  (select reintentar_en_seg > 0 from public.api_controlar_limite((select id from claves where clave = 'principal'))),
  'el rechazo dice en cuántos segundos reintentar'
);

select is(
  (select restantes from public.api_controlar_limite((select id from claves where clave = 'principal'))),
  0,
  'el rechazo no deja llamadas restantes'
);

-- La llamada rechazada también queda auditada.
select lives_ok(
  $$select public.api_registrar_llamada(
    (select id from claves where clave = 'principal'),
    'a1000000-0000-0000-0000-000000000001',
    'GET', '/api-v1/v1/stock', 'v1', 429, 1)$$,
  'el rechazo por límite se audita'
);

reset role;

select is(
  (select count(*)::int from public.api_llamadas where estado_http = 429),
  1,
  'la llamada con 429 queda auditada'
);

-- Con la ventana vencida, la llamada vuelve a pasar.
update public.api_llamadas
   set creada_en = now() - interval '2 minutes'
 where clave_id = (select id from claves where clave = 'principal');

set local role service_role;

select is(
  (select permitido from public.api_controlar_limite((select id from claves where clave = 'principal'))),
  true,
  'pasada la ventana de 60 s la llamada vuelve a permitirse'
);

select is(
  (select restantes from public.api_controlar_limite((select id from claves where clave = 'principal'))),
  3,
  'con la ventana vencida quedan las 3 llamadas del límite'
);

reset role;

-- ============================================================================
-- Retención de 90 días (D-10)
-- ============================================================================

insert into public.api_llamadas (organizacion_id, metodo, ruta, version, estado_http, duracion_ms, creada_en)
values ('a1000000-0000-0000-0000-000000000001', 'GET', '/api-v1/v1/ventas', 'v1', 200, 10, now() - interval '91 days');

select is(
  (select private.purgar_api_llamadas(90)),
  1,
  'la purga borra la llamada vencida'
);

select is(
  (select count(*)::int from public.api_llamadas where creada_en < now() - interval '90 days'),
  0,
  'no queda ninguna llamada fuera de la retención'
);

select ok(
  (select count(*)::int from public.api_llamadas where creada_en >= now() - interval '90 days') > 0,
  'la purga respeta las llamadas recientes'
);

select throws_ok(
  $$select private.purgar_api_llamadas(0)$$,
  '22023',
  null,
  'una retención inválida se rechaza'
);

-- ============================================================================
-- Aislamiento de la auditoría por organización
-- ============================================================================

select set_config(
  'request.jwt.claims',
  json_build_object('sub', 'f2000000-0000-0000-0000-000000000001', 'role', 'authenticated')::text,
  true
);
set local role authenticated;

select is(
  (select count(*)::int from public.api_llamadas),
  0,
  'el administrador de otra organización no ve la auditoría ajena'
);

reset role;

select set_config(
  'request.jwt.claims',
  json_build_object('sub', 'f1000000-0000-0000-0000-000000000001', 'role', 'authenticated')::text,
  true
);
set local role authenticated;

select ok(
  (select count(*)::int from public.api_llamadas) > 0,
  'el administrador de la organización ve su auditoría'
);

reset role;

select * from finish();
rollback;
