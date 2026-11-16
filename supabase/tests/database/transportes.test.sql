-- F-VTA-04 (MSF-251, épica MSF-139, SC-007): transportes y terminales de retiro.
-- Cubre dominio.transportes y dominio.transportes_empresas: RLS por organización y sección
-- `ventas` (lectura), escritura solo del Administrador, CUIT opcional validado, rangos de
-- comisión y plazo, unicidad de nombre por organización, empresas de otra organización,
-- bloqueo optimista, estado idempotente, sin DELETE y `anon` sin acceso.
-- El fixture corre como postgres (RLS no aplica); las verificaciones, como "authenticated".
-- Roles de la matriz inicial para `ventas`: administrador E, operador E, consulta L.
begin;

select plan(42);

insert into organizaciones (id, nombre) values
  ('11111111-1111-1111-1111-111111111111', 'Organización Uno'),
  ('22222222-2222-2222-2222-222222222222', 'Organización Dos');

insert into auth.users (id, email) values
  ('d1000000-0000-0000-0000-000000000011', 'admin-uno@example.com'),
  ('d1000000-0000-0000-0000-000000000012', 'operador-uno@example.com'),
  ('d1000000-0000-0000-0000-000000000013', 'consulta-uno@example.com'),
  ('d2000000-0000-0000-0000-000000000011', 'admin-dos@example.com');

insert into usuarios_organizacion (user_id, organizacion_id, rol_id) values
  ('d1000000-0000-0000-0000-000000000011', '11111111-1111-1111-1111-111111111111', 'administrador'),
  ('d1000000-0000-0000-0000-000000000012', '11111111-1111-1111-1111-111111111111', 'operador'),
  ('d1000000-0000-0000-0000-000000000013', '11111111-1111-1111-1111-111111111111', 'consulta'),
  ('d2000000-0000-0000-0000-000000000011', '22222222-2222-2222-2222-222222222222', 'administrador');

insert into dominio.empresas (id, organizacion_id, nombre) values
  ('a1000000-0000-0000-0000-0000000000a1', '11111111-1111-1111-1111-111111111111', 'San Javucho'),
  ('a1000000-0000-0000-0000-0000000000a2', '11111111-1111-1111-1111-111111111111', 'Mundo JC'),
  ('a2000000-0000-0000-0000-0000000000a1', '22222222-2222-2222-2222-222222222222', 'Empresa Dos');

-- Un transporte de la Dos para verificar aislamiento.
insert into dominio.transportes (id, organizacion_id, nombre, tipo) values
  ('b2000000-0000-0000-0000-0000000000b1', '22222222-2222-2222-2222-222222222222', 'Transporte De La Dos', 'correo');

create function pg_temp.como(p_user uuid) returns void language plpgsql as $$
begin
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
  set local role authenticated;
end $$;

-- Edita «Expreso Ejemplo del Sur» con datos fijos; lee el updated_at vigente salvo que se pase uno.
create function pg_temp.act(p_localidad text, p_empresas uuid[], p_ts timestamptz default null)
returns dominio.transportes language sql as $$
  select public.actualizar_transporte(
    (select t.id from dominio.transportes t where t.nombre = 'Expreso Ejemplo del Sur'),
    coalesce(p_ts, (select t.updated_at from dominio.transportes t where t.nombre = 'Expreso Ejemplo del Sur')),
    'Expreso Ejemplo del Sur', 'expreso', '20123456786', 'Terminal Sur, Rosario', p_localidad,
    '0341 000-0000', 'cobranzas@expreso.example', 'Ana', 'Calle 1 100', true, 2.5, 7, 1, true, p_empresas);
$$;

-- ============================================================================
-- Administrador de la Uno: alta, validaciones y listado
-- ============================================================================

select pg_temp.como('d1000000-0000-0000-0000-000000000011');

select is(
  (public.crear_transporte(
    'Expreso Ejemplo del Sur', 'expreso', '20123456786', 'Terminal Sur, Rosario', 'Rosario',
    '0341 000-0000', 'cobranzas@expreso.example', 'Ana', 'Calle 1 100', true, 2.5, 7, 1, true,
    array['a1000000-0000-0000-0000-0000000000a1']::uuid[])).nombre,
  'Expreso Ejemplo del Sur',
  'el Administrador crea un transporte'
);

select is(
  (select count(*)::int from dominio.transportes_empresas te
    join dominio.transportes t on t.id = te.transporte_id
   where t.nombre = 'Expreso Ejemplo del Sur'),
  1,
  'queda marcada la empresa donde se usa'
);

select is(
  (public.crear_transporte(
    'Correo Uno', 'correo', '30-70123456-8', null, null, null, null, null, null, false, 100, 0, 2, true,
    array['a1000000-0000-0000-0000-0000000000a2']::uuid[])).cuit,
  '30701234568',
  'el CUIT se acepta con guiones y se guarda normalizado'
);

select is(
  (select comision_pct from dominio.transportes where nombre = 'Correo Uno'),
  100.00::numeric,
  'la comisión 100 está en el rango'
);

select is(
  (public.crear_transporte('Moto propia', 'moto_propia')).cuit,
  null,
  'el CUIT es opcional (la moto propia no tiene)'
);

select throws_ok(
  $$select public.crear_transporte('Con CUIT malo', 'expreso', '20123456787')$$,
  '22023', null,
  'un CUIT con dígito verificador incorrecto se rechaza'
);

select throws_ok(
  $$select public.crear_transporte('Con CUIT corto', 'expreso', '2012345678')$$,
  '22023', null,
  'un CUIT que no tiene 11 dígitos se rechaza'
);

select throws_ok(
  $$select public.crear_transporte('Comisión alta', 'expreso', null, null, null, null, null, null, null, true, 101, 0)$$,
  '23514', null,
  'una comisión mayor a 100 se rechaza'
);

select throws_ok(
  $$select public.crear_transporte('Comisión negativa', 'expreso', null, null, null, null, null, null, null, true, -1, 0)$$,
  '23514', null,
  'una comisión negativa se rechaza'
);

select throws_ok(
  $$select public.crear_transporte('Plazo negativo', 'expreso', null, null, null, null, null, null, null, true, 0, -1)$$,
  '23514', null,
  'un plazo de rendición negativo se rechaza'
);

select throws_ok(
  $$select public.crear_transporte('  expreso EJEMPLO del sur ', 'correo')$$,
  '23505', null,
  'el nombre repetido en la organización se rechaza sin distinguir mayúsculas ni espacios'
);

select throws_ok(
  $$select public.crear_transporte('Con empresa ajena', 'correo', null, null, null, null, null, null, null,
      false, 0, 0, 0, true, array['a2000000-0000-0000-0000-0000000000a1']::uuid[])$$,
  '42501', null,
  'una empresa de otra organización se rechaza'
);

select throws_ok(
  $$select public.crear_transporte('Tipo raro', 'paloma')$$,
  '22023', null,
  'un tipo fuera de la lista se rechaza'
);

select is(
  (select total_organizacion::int from public.listar_transportes() limit 1),
  3,
  'listar_transportes cuenta los transportes de la organización (M), sin los de la Dos'
);

select is(
  (select count(*)::int from public.listar_transportes('a1000000-0000-0000-0000-0000000000a1')),
  1,
  'el filtro por tienda devuelve solo los transportes usados en San Javucho'
);

select is(
  (select nombre from public.listar_transportes('a1000000-0000-0000-0000-0000000000a2')),
  'Correo Uno',
  'el filtro por Mundo JC devuelve su transporte y no el de San Javucho'
);

select is(
  (select count(*)::int from public.listar_transportes('a2000000-0000-0000-0000-0000000000a1')),
  0,
  'filtrar por una tienda de otra organización no devuelve nada'
);

-- ============================================================================
-- Edición: bloqueo optimista y estado
-- ============================================================================

create temp table ts_previo as
  select updated_at as ts from dominio.transportes where nombre = 'Expreso Ejemplo del Sur';

select is(
  (pg_temp.act('Buenos Aires', array['a1000000-0000-0000-0000-0000000000a1']::uuid[])).localidad,
  'Buenos Aires',
  'el Administrador edita un transporte con el updated_at que leyó'
);

select ok(
  (select updated_at from dominio.transportes where nombre = 'Expreso Ejemplo del Sur') > (select ts from ts_previo),
  'un cambio de datos avanza updated_at'
);

select throws_ok(
  $$select pg_temp.act('Otra', array['a1000000-0000-0000-0000-0000000000a1']::uuid[], '2000-01-01'::timestamptz)$$,
  '40001', null,
  'un updated_at viejo es un conflicto y no pisa nada'
);

update ts_previo set ts = (select updated_at from dominio.transportes where nombre = 'Expreso Ejemplo del Sur');

select pg_temp.act('Buenos Aires', array['a1000000-0000-0000-0000-0000000000a1', 'a1000000-0000-0000-0000-0000000000a2']::uuid[]);

select ok(
  (select updated_at from dominio.transportes where nombre = 'Expreso Ejemplo del Sur') > (select ts from ts_previo),
  'un cambio solo de empresas también avanza updated_at'
);

select is(
  (select count(*)::int from dominio.transportes_empresas te
    join dominio.transportes t on t.id = te.transporte_id
   where t.nombre = 'Expreso Ejemplo del Sur'),
  2,
  'la edición reemplaza el conjunto de empresas'
);

select is(
  (public.cambiar_estado_transporte(
    (select id from dominio.transportes where nombre = 'Expreso Ejemplo del Sur'), false)).activa,
  false,
  'el Administrador marca el transporte como no activo'
);

update ts_previo set ts = (select updated_at from dominio.transportes where nombre = 'Expreso Ejemplo del Sur');

select is(
  (public.cambiar_estado_transporte(
    (select id from dominio.transportes where nombre = 'Expreso Ejemplo del Sur'), false)).updated_at,
  (select ts from ts_previo),
  'repetir el mismo estado es idempotente (no cambia nada)'
);

select is(
  (public.cambiar_estado_transporte(
    (select id from dominio.transportes where nombre = 'Expreso Ejemplo del Sur'), true)).activa,
  true,
  'reactivar vuelve a dejarlo activo'
);

select throws_ok(
  $$delete from dominio.transportes where nombre = 'Moto propia'$$,
  '42501', null,
  'no hay DELETE sobre transportes: se desactiva, no se borra'
);

select throws_ok(
  $$insert into dominio.transportes (organizacion_id, nombre, tipo)
    values ('22222222-2222-2222-2222-222222222222', 'Intruso', 'correo')$$,
  '42501', null,
  'el Administrador de la Uno no inserta en la organización Dos'
);

-- ============================================================================
-- Operador (edición en ventas, pero no Administrador): lee, no escribe
-- ============================================================================

select pg_temp.como('d1000000-0000-0000-0000-000000000012');

select is(
  (select count(*)::int from public.listar_transportes()),
  3,
  'quien tiene ventas ve los transportes de su organización'
);

select throws_ok(
  $$select public.crear_transporte('Del operador', 'correo')$$,
  '42501', null,
  'quien no es Administrador no crea transportes'
);

select throws_ok(
  $$select pg_temp.act('Del operador', array[]::uuid[])$$,
  '42501', null,
  'quien no es Administrador no edita transportes'
);

select throws_ok(
  $$select public.cambiar_estado_transporte((select id from dominio.transportes where nombre = 'Moto propia'), false)$$,
  '42501', null,
  'quien no es Administrador no cambia el estado'
);

update dominio.transportes set localidad = 'Hackeada' where nombre = 'Moto propia';

select isnt(
  (select localidad from dominio.transportes where nombre = 'Moto propia'),
  'Hackeada',
  'la RLS no deja actualizar directo sobre la tabla'
);

select throws_ok(
  $$insert into dominio.transportes (nombre, tipo) values ('Directo', 'correo')$$,
  '42501', null,
  'tampoco hay inserción directa para quien no es Administrador'
);

-- ============================================================================
-- Consulta (solo lectura)
-- ============================================================================

select pg_temp.como('d1000000-0000-0000-0000-000000000013');

select is(
  (select count(*)::int from dominio.transportes),
  3,
  'un rol de lectura en ventas ve los transportes'
);

select throws_ok(
  $$select public.crear_transporte('De consulta', 'correo')$$,
  '42501', null,
  'un rol de lectura no crea transportes'
);

-- ============================================================================
-- Otra organización: aislamiento
-- ============================================================================

select pg_temp.como('d2000000-0000-0000-0000-000000000011');

select is(
  (select array_agg(nombre order by nombre) from dominio.transportes),
  array['Transporte De La Dos'],
  'la otra organización solo ve sus propios transportes (RLS)'
);

select is(
  (select count(*)::int from dominio.transportes_empresas),
  0,
  'la otra organización no ve las empresas de la Uno (RLS)'
);

select throws_ok(
  $$select pg_temp.act('Cruzada', array[]::uuid[])$$,
  'P0002', null,
  'editar un transporte de otra organización responde que no existe'
);

-- ============================================================================
-- Disparador: protege la tabla ante escrituras que no pasan por la RPC
-- ============================================================================

reset role;

select throws_ok(
  $$insert into dominio.transportes_empresas (transporte_id, empresa_id, organizacion_id)
    values ((select id from dominio.transportes where nombre = 'Moto propia'),
            'a2000000-0000-0000-0000-0000000000a1', '11111111-1111-1111-1111-111111111111')$$,
  '23514', null,
  'el disparador rechaza una empresa de otra organización'
);

select throws_ok(
  $$insert into dominio.transportes_empresas (transporte_id, empresa_id, organizacion_id)
    values ((select id from dominio.transportes where nombre = 'Moto propia'),
            'a2000000-0000-0000-0000-0000000000a1', '22222222-2222-2222-2222-222222222222')$$,
  '23503', null,
  'el FK compuesto rechaza un transporte de otra organización'
);

-- ============================================================================
-- anon: sin ejecución ni acceso
-- ============================================================================

select is(
  has_function_privilege('anon', 'public.listar_transportes(uuid, integer, integer)', 'execute')
    or has_function_privilege('anon', 'public.cambiar_estado_transporte(uuid, boolean)', 'execute')
    or has_function_privilege('anon', 'public.crear_transporte(text, text, text, text, text, text, text, text, text, boolean, numeric, integer, integer, boolean, uuid[])', 'execute')
    or has_function_privilege('anon', 'public.actualizar_transporte(uuid, timestamptz, text, text, text, text, text, text, text, text, text, boolean, numeric, integer, integer, boolean, uuid[])', 'execute'),
  false,
  'anon no ejecuta las RPC de transportes'
);

select is(
  has_table_privilege('anon', 'dominio.transportes', 'select')
    or has_table_privilege('anon', 'dominio.transportes_empresas', 'select'),
  false,
  'anon no tiene privilegios sobre las tablas'
);

select * from finish();
rollback;
