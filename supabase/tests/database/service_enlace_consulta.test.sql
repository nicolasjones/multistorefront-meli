-- F-SVC-22 (MSF-157, épica MSF-124): enlace de consulta pública (SC-006).
-- Cubre FR-040 (token idempotente, único y de 192 bits; tabla sin acceso; permisos), FR-042/FR-043 (funciones
-- internas solo para service_role; límite de tasa atómico con ventana y purga acotada) y FR-044 (claves exactas de
-- la lista blanca, token ajeno o mal formado sin fila, aislamiento entre dos organizaciones).
begin;

select no_plan();


insert into organizaciones (id, nombre) values
  ('11111111-1111-1111-1111-111111111111', 'Organización Uno'),
  ('22222222-2222-2222-2222-222222222222', 'Organización Dos');

insert into auth.users (id, email) values
  ('e1000000-0000-0000-0000-000000000001', 'administrador@example.com'),
  ('e1000000-0000-0000-0000-000000000002', 'operador@example.com'),
  ('e1000000-0000-0000-0000-000000000003', 'consulta@example.com'),
  ('e1000000-0000-0000-0000-000000000005', 'deposito@example.com'),
  ('e2000000-0000-0000-0000-000000000001', 'admin-dos@example.com');

insert into usuarios_organizacion (user_id, organizacion_id, rol_id, estado) values
  ('e1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'administrador', 'activo'),
  ('e1000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'operador', 'activo'),
  ('e1000000-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111', 'consulta', 'activo'),
  ('e1000000-0000-0000-0000-000000000005', '11111111-1111-1111-1111-111111111111', 'deposito', 'activo'),
  ('e2000000-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', 'administrador', 'activo');

insert into dominio.empresas (id, organizacion_id, nombre) values
  ('a1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'San Javucho'),
  ('a1000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'Mundo JC'),
  ('a2000000-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', 'Empresa Dos');

-- El operador y la consulta solo acceden a San Javucho.
insert into usuarios_empresas (user_id, empresa_id, organizacion_id, rol_id) values
  ('e1000000-0000-0000-0000-000000000002', 'a1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'operador'),
  ('e1000000-0000-0000-0000-000000000003', 'a1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'consulta');

insert into clientes (id, organizacion_id, numero, nombre, tipo, archivado_en) values
  ('c5000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 10, 'Distribuidora Norte', 'mayorista', null),
  ('c6000000-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', 10, 'Cliente de la Dos', 'minorista', null);

create function pg_temp.como(p_user uuid) returns void language plpgsql as $$
begin
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
  set local role authenticated;
end $$;

create temp table datos as
  select
    (select id from dominio.modelos_equipo where organizacion_id = '11111111-1111-1111-1111-111111111111' and equipo = 'Nintendo Switch' and modelo = 'Estándar') as modelo_uno,
    (select id from dominio.estados_reparacion where organizacion_id = '11111111-1111-1111-1111-111111111111' and cierra order by orden limit 1) as cierra_uno;
grant select on datos to public;



create temp table rg (clave text primary key, id uuid, token text);
grant select, insert, update on rg to public;

-- ============================================================================
-- Diseño y privilegios (FR-040, FR-042, FR-043, FR-044)
-- ============================================================================

select has_table('dominio', 'reparacion_enlaces_consulta', 'existe dominio.reparacion_enlaces_consulta');
select has_table('public', 'consultas_publicas_intentos', 'existe public.consultas_publicas_intentos');
select ok((select relrowsecurity from pg_class where oid = 'dominio.reparacion_enlaces_consulta'::regclass),
  'RLS habilitada en reparacion_enlaces_consulta');
select ok((select relrowsecurity from pg_class where oid = 'public.consultas_publicas_intentos'::regclass),
  'RLS habilitada en consultas_publicas_intentos');
select is((select count(*) from pg_policy where polrelid in
    ('dominio.reparacion_enlaces_consulta'::regclass, 'public.consultas_publicas_intentos'::regclass))::int,
  0, 'ninguna de las dos tablas tiene políticas');
select ok(not has_table_privilege('authenticated', 'dominio.reparacion_enlaces_consulta', 'select')
      and not has_table_privilege('authenticated', 'dominio.reparacion_enlaces_consulta', 'insert')
      and not has_table_privilege('anon', 'dominio.reparacion_enlaces_consulta', 'select'),
  'authenticated y anon sin acceso a reparacion_enlaces_consulta');
select ok(not has_table_privilege('authenticated', 'public.consultas_publicas_intentos', 'select')
      and not has_table_privilege('authenticated', 'public.consultas_publicas_intentos', 'insert')
      and not has_table_privilege('anon', 'public.consultas_publicas_intentos', 'select'),
  'authenticated y anon sin acceso a consultas_publicas_intentos');
select ok(exists (select 1 from pg_constraint where conrelid = 'dominio.reparacion_enlaces_consulta'::regclass
    and contype = 'f' and pg_get_constraintdef(oid) like 'FOREIGN KEY (reparacion_id, organizacion_id)%'),
  'FK compuesta (reparacion_id, organizacion_id)');
select ok(exists (select 1 from pg_constraint where conrelid = 'dominio.reparacion_enlaces_consulta'::regclass
    and contype = 'u' and pg_get_constraintdef(oid) = 'UNIQUE (reparacion_id)'), 'unique (reparacion_id)');
select ok(exists (select 1 from pg_constraint where conrelid = 'dominio.reparacion_enlaces_consulta'::regclass
    and contype = 'u' and pg_get_constraintdef(oid) = 'UNIQUE (token)'), 'unique (token)');

select is((select has_function_privilege('anon', 'public.obtener_enlace_consulta(uuid)', 'execute')), false,
  'anon no ejecuta obtener_enlace_consulta');
select is((select has_function_privilege('authenticated', 'public.obtener_enlace_consulta(uuid)', 'execute')), true,
  'authenticated ejecuta obtener_enlace_consulta');
select is(
  (select count(*) from unnest(array[
    'public.registrar_consulta_publica(text,integer,integer)',
    'public.obtener_estado_publico_reparacion(text)',
    'private.estado_publico_reparacion(text)'
  ]) f where has_function_privilege('anon', f::regprocedure, 'execute')
          or has_function_privilege('authenticated', f::regprocedure, 'execute'))::int,
  0, 'anon y authenticated no ejecutan las funciones internas del enlace público');
select is(
  (select count(*) from unnest(array[
    'public.registrar_consulta_publica(text,integer,integer)',
    'public.obtener_estado_publico_reparacion(text)'
  ]) f where has_function_privilege('service_role', f::regprocedure, 'execute'))::int,
  2, 'service_role ejecuta las dos funciones del enlace público');

-- ============================================================================
-- Token (FR-040)
-- ============================================================================

select pg_temp.como('e1000000-0000-0000-0000-000000000001');

insert into rg (clave, id)
select 'a', (public.crear_reparacion('a1000000-0000-0000-0000-000000000001', 'c5000000-0000-0000-0000-000000000001',
  (select modelo_uno from datos), 'Ana 11-5555', 'SN-SECRETO-123', 'Cargador', 'No enciende', 100, 50)->>'id')::uuid;
insert into rg (clave, id)
select 'b', (public.crear_reparacion('a1000000-0000-0000-0000-000000000001', 'c5000000-0000-0000-0000-000000000001',
  (select modelo_uno from datos))->>'id')::uuid;
insert into rg (clave, id)
select 'tienda_b', (public.crear_reparacion('a1000000-0000-0000-0000-000000000002', 'c5000000-0000-0000-0000-000000000001',
  (select modelo_uno from datos))->>'id')::uuid;

update rg set token = public.obtener_enlace_consulta(id)->>'token' where clave in ('a', 'b');

select matches((select token from rg where clave = 'a'), '^[A-Za-z0-9_-]{32}$', 'el token es base64url de 32 caracteres (192 bits)');
select isnt((select token from rg where clave = 'a'), (select token from rg where clave = 'b'), 'cada reparación tiene su propio token');
select is(public.obtener_enlace_consulta((select id from rg where clave = 'a'))->>'token', (select token from rg where clave = 'a'),
  'es idempotente: el segundo pedido devuelve el mismo token');
reset role;
select is((select count(*) from public.registro_actividad where tipo = 'reparacion.enlace_generado')::int, 2,
  'la actividad se registra solo al crear (2 enlaces, 3 pedidos)');

-- Permisos y alcance.
select pg_temp.como('e1000000-0000-0000-0000-000000000003');
select throws_ok(format($$select public.obtener_enlace_consulta(%L)$$, (select id from rg where clave = 'a')),
  '42501', null, 'un rol de consulta no genera el enlace');
select pg_temp.como('e1000000-0000-0000-0000-000000000002');
select throws_ok(format($$select public.obtener_enlace_consulta(%L)$$, (select id from rg where clave = 'tienda_b')),
  '42501', null, 'una tienda inaccesible no genera el enlace');
select throws_ok($$select public.obtener_enlace_consulta(gen_random_uuid())$$, 'P0002', null, 'una reparación inexistente es P0002');
select pg_temp.como('e2000000-0000-0000-0000-000000000001');
select throws_ok(format($$select public.obtener_enlace_consulta(%L)$$, (select id from rg where clave = 'a')),
  'P0002', null, 'una reparación de otra organización es P0002');

select pg_temp.como('e1000000-0000-0000-0000-000000000001');
select throws_ok($$select token from dominio.reparacion_enlaces_consulta$$, '42501', null,
  'authenticated no lee la tabla de enlaces');

-- ============================================================================
-- Estado público (FR-044) — como service_role
-- ============================================================================

reset role;
set local role service_role;

select is((select jsonb_object_keys_count from (select count(*)::int as jsonb_object_keys_count
    from jsonb_object_keys(public.obtener_estado_publico_reparacion((select token from rg where clave = 'a')))) k), 7,
  'la respuesta tiene exactamente 7 claves');
select is(
  (select array_agg(k order by k) from jsonb_object_keys(public.obtener_estado_publico_reparacion((select token from rg where clave = 'a'))) k),
  array['codigo', 'entrega_prevista', 'equipo', 'estado', 'linea_de_tiempo', 'modelo', 'tienda'],
  'claves exactas de la lista blanca');
select is(
  (select array_agg(k order by k) from jsonb_object_keys(public.obtener_estado_publico_reparacion((select token from rg where clave = 'a'))->'estado') k),
  array['descripcion', 'nombre'], 'el estado solo trae nombre y descripción');
select is(
  (select array_agg(distinct k order by k) from jsonb_array_elements(public.obtener_estado_publico_reparacion((select token from rg where clave = 'a'))->'linea_de_tiempo') e,
     jsonb_object_keys(e) k),
  array['estado', 'fecha'], 'la línea de tiempo solo trae estado y fecha');
select is(public.obtener_estado_publico_reparacion((select token from rg where clave = 'a'))->>'tienda', 'San Javucho', 'trae la tienda');
select matches(public.obtener_estado_publico_reparacion((select token from rg where clave = 'a'))->>'codigo', '^R-[0-9]{4,}$', 'trae el código R-xxxx');
select ok(jsonb_array_length(public.obtener_estado_publico_reparacion((select token from rg where clave = 'a'))->'linea_de_tiempo') >= 1,
  'la línea de tiempo trae al menos el alta');
select ok(public.obtener_estado_publico_reparacion((select token from rg where clave = 'a'))::text
    !~ '(Distribuidora|Ana 11|SN-SECRETO|Cargador|No enciende)',
  'no filtra cliente, contacto, serie, accesorios ni falla');

-- Token inventado, mal formado o vacío: null (sin distinguir).
select is(public.obtener_estado_publico_reparacion(repeat('A', 32)), null, 'token inexistente → null');
select is(public.obtener_estado_publico_reparacion('corto'), null, 'token mal formado → null');
select is(public.obtener_estado_publico_reparacion(''), null, 'token vacío → null');
select is(public.obtener_estado_publico_reparacion(null), null, 'token nulo → null');

-- Aislamiento entre organizaciones: el token de una nunca devuelve datos de la otra.
reset role;
insert into dominio.modelos_equipo (organizacion_id, equipo, modelo) values ('22222222-2222-2222-2222-222222222222', 'Equipo Dos', 'Modelo Dos');
select pg_temp.como('e2000000-0000-0000-0000-000000000001');
insert into rg (clave, id)
select 'dos', (public.crear_reparacion('a2000000-0000-0000-0000-000000000001', 'c6000000-0000-0000-0000-000000000001',
  (select id from dominio.modelos_equipo where organizacion_id = '22222222-2222-2222-2222-222222222222' limit 1))->>'id')::uuid;
update rg set token = public.obtener_enlace_consulta(id)->>'token' where clave = 'dos';
reset role;
set local role service_role;
select is(public.obtener_estado_publico_reparacion((select token from rg where clave = 'dos'))->>'tienda', 'Empresa Dos',
  'el token de la organización Dos devuelve su propia tienda');
select is(public.obtener_estado_publico_reparacion((select token from rg where clave = 'dos'))->>'equipo', 'Equipo Dos',
  'y su propio equipo, nunca el de la Uno');
select isnt(public.obtener_estado_publico_reparacion((select token from rg where clave = 'a'))->>'tienda', 'Empresa Dos',
  'el token de la Uno no devuelve la tienda de la Dos');

-- ============================================================================
-- Límite de tasa (FR-043)
-- ============================================================================

select is(public.registrar_consulta_publica('hash-1', 600, 3)->>'permitido', 'true', '1.ª consulta permitida');
select is(public.registrar_consulta_publica('hash-1', 600, 3)->>'restantes', '1', 'quedan 1 tras la 2.ª');
select is(public.registrar_consulta_publica('hash-1', 600, 3)->>'permitido', 'true', '3.ª consulta permitida (= límite)');
select is(public.registrar_consulta_publica('hash-1', 600, 3)->>'permitido', 'false', '4.ª consulta bloqueada');
select ok((public.registrar_consulta_publica('hash-1', 600, 3)->>'reintentar_en')::int between 1 and 600,
  'reintentar_en entre 1 y la ventana');
select is(public.registrar_consulta_publica('hash-2', 600, 3)->>'permitido', 'true', 'otra IP tiene su propio contador');
select is((select cuenta from public.consultas_publicas_intentos where ip_hash = 'hash-1'), 5, 'el contador cuenta toda consulta, también las bloqueadas');
select throws_ok($$select public.registrar_consulta_publica('', 600, 3)$$, '22023', null, 'hash vacío rechazado');
select throws_ok($$select public.registrar_consulta_publica('h', 0, 3)$$, '22023', null, 'ventana inválida rechazada');
select throws_ok($$select public.registrar_consulta_publica('h', 600, 0)$$, '22023', null, 'límite inválido rechazado');

-- Purga acotada de ventanas vencidas.
reset role;
insert into public.consultas_publicas_intentos (ip_hash, ventana, cuenta)
  select 'viejo-' || g, now() - interval '3 hours', 1 from generate_series(1, 150) g;
set local role service_role;
select public.registrar_consulta_publica('hash-3', 600, 3);
reset role;
select is((select count(*) from public.consultas_publicas_intentos where ip_hash like 'viejo-%')::int, 50,
  'la purga borra a lo sumo 100 filas vencidas por llamada');

select * from finish();
rollback;
