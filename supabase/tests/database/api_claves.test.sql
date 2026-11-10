-- F-API-01 (MSF-403, FR-001, FR-002): claves de API por organización.
--
-- Comprueba que el valor de la clave se ve una sola vez (solo queda el hash),
-- que los alcances se validan, que la rotación deja la clave anterior con 24 h
-- de gracia y que la revocación es inmediata. El aislamiento por organización
-- y el límite de uso están en api_aislamiento.test.sql y api_llamadas.test.sql.
begin;

select no_plan();

insert into organizaciones (id, nombre) values
  ('a1000000-0000-0000-0000-000000000001', 'Organización A'),
  ('a1000000-0000-0000-0000-000000000002', 'Organización B');

insert into auth.users (id, email) values
  ('f1000000-0000-0000-0000-000000000001', 'admin-api-a@example.com'),
  ('f1000000-0000-0000-0000-000000000002', 'miembro-api-a@example.com'),
  ('f2000000-0000-0000-0000-000000000001', 'admin-api-b@example.com');

insert into usuarios_organizacion (user_id, organizacion_id, rol_id, estado) values
  ('f1000000-0000-0000-0000-000000000001', 'a1000000-0000-0000-0000-000000000001', 'administrador', 'activo'),
  ('f1000000-0000-0000-0000-000000000002', 'a1000000-0000-0000-0000-000000000001', 'miembro', 'activo'),
  ('f2000000-0000-0000-0000-000000000001', 'a1000000-0000-0000-0000-000000000002', 'administrador', 'activo');

create temporary table claves (
  clave text primary key,
  id uuid not null,
  valor text not null
);
grant all on claves to authenticated, service_role;

-- ============================================================================
-- Tabla, RLS y privilegios
-- ============================================================================

select has_table('public', 'api_claves', 'existe la tabla public.api_claves');

select is(
  (select relrowsecurity from pg_class where oid = 'public.api_claves'::regclass),
  true,
  'RLS habilitada en api_claves'
);

select is(
  has_column_privilege('authenticated', 'public.api_claves', 'hash', 'SELECT'),
  false,
  'authenticated no puede leer el hash de la clave'
);

select is(
  has_column_privilege('authenticated', 'public.api_claves', 'prefijo', 'SELECT'),
  true,
  'authenticated puede leer el prefijo de la clave'
);

select is(
  has_table_privilege('authenticated', 'public.api_claves', 'INSERT'),
  false,
  'authenticated no puede insertar claves directo (solo por RPC)'
);

select is(
  has_function_privilege('anon', 'public.crear_clave_api(text, text[], timestamptz)', 'EXECUTE'),
  false,
  'anon no puede crear claves'
);

select is(
  has_function_privilege('authenticated', 'public.crear_clave_api(text, text[], timestamptz)', 'EXECUTE'),
  true,
  'authenticated puede crear claves'
);

-- ============================================================================
-- Crear la clave (FR-001)
-- ============================================================================

select set_config(
  'request.jwt.claims',
  json_build_object('sub', 'f1000000-0000-0000-0000-000000000001', 'role', 'authenticated')::text,
  true
);
set local role authenticated;

with creada as (
  select public.crear_clave_api('Integración del cliente', array['productos', 'stock'], null) as c
)
insert into claves (clave, id, valor)
select 'principal', (c).id, (c).valor from creada;

reset role;

select is(
  (select count(*)::int from public.api_claves where organizacion_id = 'a1000000-0000-0000-0000-000000000001'),
  1,
  'crear_clave_api deja una sola clave en la organización'
);

select is(
  (select hash = extensions.digest(valor, 'sha256') from public.api_claves where id = (select id from claves where clave = 'principal')),
  true,
  'solo se persiste el hash SHA-256 del valor entregado'
);

select matches(
  (select valor from claves where clave = 'principal'),
  '^msf_[0-9a-f]{8}_[A-Za-z0-9_-]{40,}$',
  'el valor tiene el formato msf_<prefijo>_<secreto>'
);

select is(
  (select prefijo from public.api_claves where id = (select id from claves where clave = 'principal')),
  (select split_part(split_part(valor, '_', 2), '_', 1) from claves where clave = 'principal'),
  'el prefijo guardado es el del valor entregado'
);

select is(
  (select array_to_string(alcances, ',') from public.api_claves where id = (select id from claves where clave = 'principal')),
  'productos,stock',
  'la clave guarda los alcances pedidos'
);

select is(
  (select limite_por_minuto from public.api_claves where id = (select id from claves where clave = 'principal')),
  60,
  'la clave nace con el límite de 60 por minuto'
);

select is(
  (select count(*)::int from public.api_claves where organizacion_id = 'a1000000-0000-0000-0000-000000000001'
     and hash::text = (select valor from claves where clave = 'principal')),
  0,
  'el valor en claro no queda guardado en ninguna columna'
);

-- Un miembro que no es Administrador no crea claves.
select set_config(
  'request.jwt.claims',
  json_build_object('sub', 'f1000000-0000-0000-0000-000000000002', 'role', 'authenticated')::text,
  true
);
set local role authenticated;

select throws_ok(
  $$select public.crear_clave_api('Clave de un miembro', array['productos'], null)$$,
  '42501',
  null,
  'un miembro sin rol administrador no puede crear claves'
);

reset role;

-- Alcances inválidos.
select set_config(
  'request.jwt.claims',
  json_build_object('sub', 'f1000000-0000-0000-0000-000000000001', 'role', 'authenticated')::text,
  true
);
set local role authenticated;

select throws_ok(
  $$select public.crear_clave_api('Alcance inválido', array['productos', 'facturacion'], null)$$,
  '22023',
  null,
  'un alcance fuera de la lista se rechaza'
);

select throws_ok(
  $$select public.crear_clave_api('Sin alcances', array[]::text[], null)$$,
  '22023',
  null,
  'una clave sin alcances se rechaza'
);

select throws_ok(
  $$select public.crear_clave_api('  ', array['productos'], null)$$,
  '22023',
  null,
  'una clave sin nombre se rechaza'
);

select throws_ok(
  $$select public.crear_clave_api('Vencida', array['productos'], now() - interval '1 hour')$$,
  '22023',
  null,
  'un vencimiento en el pasado se rechaza'
);

reset role;

-- ============================================================================
-- Rotar (FR-002): la anterior vence en 24 h y la nueva conserva los alcances.
-- ============================================================================

select set_config(
  'request.jwt.claims',
  json_build_object('sub', 'f1000000-0000-0000-0000-000000000001', 'role', 'authenticated')::text,
  true
);
set local role authenticated;

with rotada as (
  select public.rotar_clave_api((select id from claves where clave = 'principal')) as c
)
insert into claves (clave, id, valor)
select 'rotada', (c).id, (c).valor from rotada;

reset role;

select is(
  (select count(*)::int from public.api_claves where organizacion_id = 'a1000000-0000-0000-0000-000000000001'),
  2,
  'rotar deja la clave nueva junto a la anterior'
);

select is(
  (select array_to_string(alcances, ',') from public.api_claves where id = (select id from claves where clave = 'rotada')),
  'productos,stock',
  'la clave rotada conserva los alcances'
);

select is(
  (select hash = extensions.digest(valor, 'sha256') from public.api_claves where id = (select id from claves where clave = 'rotada')),
  true,
  'la clave rotada también guarda solo el hash'
);

select ok(
  (select vence_en between now() + interval '23 hours 55 minutes' and now() + interval '24 hours 5 minutes'
     from public.api_claves where id = (select id from claves where clave = 'principal')),
  'la clave anterior vence en 24 h (D-3)'
);

select is(
  (select vence_en from public.api_claves where id = (select id from claves where clave = 'rotada')),
  null,
  'la clave nueva no vence'
);

-- El Administrador de otra organización no rota ni revoca.
select set_config(
  'request.jwt.claims',
  json_build_object('sub', 'f2000000-0000-0000-0000-000000000001', 'role', 'authenticated')::text,
  true
);
set local role authenticated;

select throws_ok(
  $$select public.rotar_clave_api((select id from claves where clave = 'principal'))$$,
  '42501',
  null,
  'el administrador de otra organización no puede rotar la clave'
);

select throws_ok(
  $$select public.revocar_clave_api((select id from claves where clave = 'principal'))$$,
  'P0002',
  null,
  'el administrador de otra organización no puede revocar la clave'
);

reset role;

-- ============================================================================
-- Revocar (FR-002): efecto inmediato.
-- ============================================================================

select set_config(
  'request.jwt.claims',
  json_build_object('sub', 'f1000000-0000-0000-0000-000000000001', 'role', 'authenticated')::text,
  true
);
set local role authenticated;

select lives_ok(
  $$select public.revocar_clave_api((select id from claves where clave = 'rotada'))$$,
  'el administrador revoca su propia clave'
);

reset role;

select ok(
  (select revocada_en is not null from public.api_claves where id = (select id from claves where clave = 'rotada')),
  'la clave revocada queda con revocada_en'
);

select is(
  (select valida from public.api_validar_clave((select valor from claves where clave = 'rotada'))),
  false,
  'una clave revocada no valida'
);

select is(
  (select motivo from public.api_validar_clave((select valor from claves where clave = 'rotada'))),
  'clave_revocada',
  'el motivo distingue la clave revocada'
);

-- Un valor con prefijo válido pero secreto equivocado se audita contra esa
-- organización, pero no valida.
select is(
  (select valida from public.api_validar_clave('msf_' || (select prefijo from public.api_claves where id = (select id from claves where clave = 'principal')) || '_secreto-incorrecto')),
  false,
  'un token con prefijo conocido y secreto equivocado no valida'
);

select is(
  (select organizacion_id from public.api_validar_clave('msf_' || (select prefijo from public.api_claves where id = (select id from claves where clave = 'principal')) || '_secreto-incorrecto')),
  'a1000000-0000-0000-0000-000000000001',
  'el intento fallido se resuelve contra la organización de la clave'
);

select is(
  (select organizacion_id from public.api_validar_clave('msf_abcdef01_secreto')),
  null,
  'un prefijo desconocido no resuelve organización'
);

select * from finish();
rollback;
