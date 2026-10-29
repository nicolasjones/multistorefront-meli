-- F-VTA-03 (MSF-240, épica MSF-139, SC-005): cuentas de cobro.
-- Cubre RLS por organización y sección `ventas`, escritura solo Administrador (RPC y tabla), CBU/CVU y CUIT
-- válidos e inválidos (mismos vectores que apps/web/src/lib/ventas/cbu.ts y cuit.ts), habilitación por empresa
-- (también de otra organización), bloqueo optimista, «No usar» idempotente, eventos de actividad sin CBU
-- completo, sin `delete` y `anon` sin acceso.
-- El fixture corre como postgres (RLS no aplica); las verificaciones, como "authenticated".
begin;

select plan(56);

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

create function pg_temp.como(p_user uuid) returns void language plpgsql as $$
begin
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
  set local role authenticated;
end $$;

-- ============================================================================
-- Vectores de CBU/CVU (la función es privada: se prueba como postgres)
-- ============================================================================

select is(private.cbu_valido('0170099220000067797370'), true, 'CBU válido (vector 1)');
select is(private.cbu_valido('2850590940090418135201'), true, 'CBU válido (vector 2)');
select is(private.cbu_valido('0170099220000067797371'), false, 'CBU con el verificador del segundo bloque mal');
select is(private.cbu_valido('0170099120000067797370'), false, 'CBU con el primer bloque alterado (verificador no coincide)');
select is(private.cbu_valido('017009922000006779737'), false, 'CBU de 21 dígitos');
select is(private.cbu_valido(null), false, 'CBU nulo');

-- ============================================================================
-- Administrador de la Uno: alta, normalización y habilitación por empresa
-- ============================================================================

select pg_temp.como('d1000000-0000-0000-0000-000000000011');

select is(
  (select (public.crear_cuenta_cobro(
    'Banco Uno ···7370', 'Comercial Uno SRL', '30-70123456-8', 'Banco Uno', 'uno.cobros',
    '0170 0992 2000 0067 7973 70', 'cuenta_corriente', 'ARS', 1, true, null,
    array['a1000000-0000-0000-0000-0000000000a1', 'a1000000-0000-0000-0000-0000000000a2']::uuid[]
  )).cbu),
  '0170099220000067797370',
  'el administrador crea la cuenta y el CBU se guarda solo con dígitos'
);

select is(
  (select cuit from dominio.cuentas_cobro where nombre = 'Banco Uno ···7370'),
  '30701234568',
  'el CUIT se guarda sin guiones'
);

select is(
  (select count(*)::int from dominio.cuentas_cobro_empresas
    where cuenta_id = (select id from dominio.cuentas_cobro where nombre = 'Banco Uno ···7370')),
  2,
  'la habilitación por empresa se guarda en la misma transacción'
);

select is(
  (select count(*)::int from public.listar_cuentas_cobro('a1000000-0000-0000-0000-0000000000a1')),
  1,
  'el filtro por tienda devuelve las cuentas disponibles en esa empresa'
);

select is(
  (select empresas from public.listar_cuentas_cobro() where nombre = 'Banco Uno ···7370'),
  '[{"id": "a1000000-0000-0000-0000-0000000000a2", "nombre": "Mundo JC"}, {"id": "a1000000-0000-0000-0000-0000000000a1", "nombre": "San Javucho"}]'::jsonb,
  'el listado expone «Disponible en» (id y nombre), ordenado por nombre'
);

select lives_ok(
  $$select public.crear_cuenta_cobro(
      'Billetera USD', 'Comercial Uno SRL', '20123456786', 'Billetera', null,
      '2850590940090418135201', 'billetera_virtual', 'USD', 2, true, 'Solo mayoristas', '{}')$$,
  'una cuenta sin empresas habilitadas se permite (queda sin disponibilidad)'
);

select is(
  (select count(*)::int from public.listar_cuentas_cobro() where nombre = 'Billetera USD' and empresas = '[]'::jsonb),
  1,
  'una cuenta sin empresas aparece con empresas = [] (nunca null)'
);

-- Validaciones de la base
select throws_ok(
  $$select public.crear_cuenta_cobro('X', 'T', '30701234568', 'B', null, '0170099220000067797371', 'caja_ahorro', 'ARS')$$,
  '22023', null, 'CBU con dígito verificador inválido (segundo bloque)'
);
select throws_ok(
  $$select public.crear_cuenta_cobro('X', 'T', '30701234568', 'B', null, '0170099120000067797370', 'caja_ahorro', 'ARS')$$,
  '22023', null, 'CBU con dígito verificador inválido (primer bloque)'
);
select throws_ok(
  $$select public.crear_cuenta_cobro('X', 'T', '30701234568', 'B', null, '017009922000006779737', 'caja_ahorro', 'ARS')$$,
  '22023', null, 'CBU de 21 dígitos'
);
select throws_ok(
  $$select public.crear_cuenta_cobro('X', 'T', '30701234568', 'B', null, '01700992200000677973AB', 'caja_ahorro', 'ARS')$$,
  '22023', null, 'CBU con letras'
);
select throws_ok(
  $$select public.crear_cuenta_cobro('X', 'T', '20123456787', 'B', null, '0170099220000067797370', 'caja_ahorro', 'ARS')$$,
  '22023', null, 'CUIT con dígito verificador inválido'
);
select throws_ok(
  $$select public.crear_cuenta_cobro('X', 'T', '30-7012345X-8', 'B', null, '0170099220000067797370', 'caja_ahorro', 'ARS')$$,
  '22023', null, 'CUIT con letras'
);
select throws_ok(
  $$select public.crear_cuenta_cobro('   ', 'T', '30701234568', 'B', null, '0170099220000067797370', 'caja_ahorro', 'ARS')$$,
  '22023', null, 'el nombre es obligatorio'
);
select throws_ok(
  $$select public.crear_cuenta_cobro('X', 'T', '30701234568', 'B', null, '0170099220000067797370', 'cheque', 'ARS')$$,
  '23514', null, 'tipo de cuenta fuera de la lista'
);
select throws_ok(
  $$select public.crear_cuenta_cobro('X', 'T', '30701234568', 'B', null, '0170099220000067797370', 'caja_ahorro', 'EUR')$$,
  '23514', null, 'moneda fuera de la lista'
);
select throws_ok(
  $$select public.crear_cuenta_cobro('X', 'T', '30701234568', 'B', null, '0170099220000067797370', 'caja_ahorro', 'ARS', 0, true, null,
      array['a2000000-0000-0000-0000-0000000000a1']::uuid[])$$,
  '42501', null, 'no acepta una empresa de otra organización'
);
select is(
  (select count(*)::int from dominio.cuentas_cobro where nombre = 'X'),
  0,
  'las altas rechazadas no dejan filas (la transacción de la RPC se revierte)'
);

-- ============================================================================
-- Edición: bloqueo optimista, cambio solo de empresas y «No usar» idempotente
-- ============================================================================

select is(
  (select (public.actualizar_cuenta_cobro(
    c.id, c.updated_at, 'Banco Uno ···7370', 'Comercial Uno SRL', '30701234568', 'Banco Uno', 'uno.cobros',
    '0170099220000067797370', 'cuenta_corriente', 'ARS', 5, true, null,
    array['a1000000-0000-0000-0000-0000000000a1', 'a1000000-0000-0000-0000-0000000000a2']::uuid[]
  )).orden
  from dominio.cuentas_cobro c where c.nombre = 'Banco Uno ···7370'),
  5,
  'edición con el updated_at leído'
);

select throws_ok(
  $$select public.actualizar_cuenta_cobro(
      (select id from dominio.cuentas_cobro where nombre = 'Banco Uno ···7370'),
      '2000-01-01 00:00:00+00', 'Banco Uno ···7370', 'Comercial Uno SRL', '30701234568', 'Banco Uno', null,
      '0170099220000067797370', 'cuenta_corriente', 'ARS', 5, true, null, '{}')$$,
  '40001', null, 'un updated_at viejo se rechaza (conflicto de edición) sin pisar nada'
);

-- Guarda el updated_at previo en una variable de transacción (sin tablas auxiliares).
select set_config(
  'test.updated_at_antes',
  (select updated_at::text from dominio.cuentas_cobro where nombre = 'Banco Uno ···7370'),
  true
);

select lives_ok(
  $$select public.actualizar_cuenta_cobro(
      c.id, c.updated_at, c.nombre, c.titular, c.cuit, c.banco, c.alias, c.cbu, c.tipo, c.moneda, c.orden, c.activa, c.notas,
      array['a1000000-0000-0000-0000-0000000000a1']::uuid[])
    from dominio.cuentas_cobro c where c.nombre = 'Banco Uno ···7370'$$,
  'editar solo «Disponible en» funciona'
);

select ok(
  (select c.updated_at > current_setting('test.updated_at_antes')::timestamptz
     from dominio.cuentas_cobro c where c.nombre = 'Banco Uno ···7370'),
  'un cambio solo de empresas avanza updated_at (el bloqueo optimista lo ve)'
);

select is(
  (select count(*)::int from dominio.cuentas_cobro_empresas
    where cuenta_id = (select id from dominio.cuentas_cobro where nombre = 'Banco Uno ···7370')),
  1,
  'la edición reemplaza el conjunto de empresas (no acumula)'
);

select is(
  (select (public.cambiar_estado_cuenta_cobro(id, false)).activa from dominio.cuentas_cobro where nombre = 'Billetera USD'),
  false,
  'marcar «No usar» deja la cuenta inactiva'
);
select lives_ok(
  $$select public.cambiar_estado_cuenta_cobro(id, false) from dominio.cuentas_cobro where nombre = 'Billetera USD'$$,
  'repetir «No usar» no falla (idempotente)'
);
select throws_ok(
  $$select public.cambiar_estado_cuenta_cobro(id, null) from dominio.cuentas_cobro where nombre = 'Billetera USD'$$,
  '22023', null, 'el estado es obligatorio'
);
select is(
  (select count(*)::int from public.listar_cuentas_cobro(null, 'no_usar')),
  1,
  'el filtro «No usar» lista solo las cuentas marcadas'
);
select is(
  (select count(*)::int from public.listar_cuentas_cobro(null, 'activas')),
  1,
  'el filtro «Activas» excluye las marcadas «No usar»'
);
select is(
  (select (public.cambiar_estado_cuenta_cobro(id, true)).activa from dominio.cuentas_cobro where nombre = 'Billetera USD'),
  true,
  'reactivar vuelve a ofrecerla'
);
select is(
  (select cbu || '|' || notas || '|' || moneda from dominio.cuentas_cobro where nombre = 'Billetera USD'),
  '2850590940090418135201|Solo mayoristas|USD',
  '«No usar» y reactivar conservan los datos'
);
select throws_ok(
  $$select public.listar_cuentas_cobro(null, 'otro')$$,
  '22023', null, 'el estado del filtro debe ser todas, activas o no_usar'
);

-- ============================================================================
-- Actividad (FR-013): sin CBU completo, sin duplicar por idempotencia
-- ============================================================================

reset role;

select is(
  (select count(*)::int from registro_actividad where tipo = 'cuenta_cobro.creada'),
  2,
  'un evento cuenta_cobro.creada por cada alta (las rechazadas no registran)'
);
select is(
  (select count(*)::int from registro_actividad where tipo = 'cuenta_cobro.desactivada'
     and detalle = 'Marcó «No usar» en la cuenta de cobro Billetera USD'),
  1,
  'un solo evento cuenta_cobro.desactivada (el repetido no duplica)'
);
select is(
  (select count(*)::int from registro_actividad where tipo = 'cuenta_cobro.reactivada'),
  1,
  'registra cuenta_cobro.reactivada'
);
select is(
  (select count(*)::int from registro_actividad where tipo = 'cuenta_cobro.editada'
     and detalle = 'Editó la cuenta de cobro Banco Uno ···7370'),
  2,
  'registra cuenta_cobro.editada por la edición de datos y por el cambio solo de empresas'
);
select is(
  (select count(*)::int from registro_actividad
    where tipo like 'cuenta_cobro.%' and detalle ~ '[0-9]{8}'),
  0,
  'ningún evento incluye el CBU ni el CUIT'
);

-- ============================================================================
-- Operador (edita Ventas pero no es Administrador): lee, no escribe
-- ============================================================================

select pg_temp.como('d1000000-0000-0000-0000-000000000012');

select is(
  (select count(*)::int from public.listar_cuentas_cobro()),
  2,
  'quien tiene Ventas ve las cuentas'
);
select throws_ok(
  $$select public.crear_cuenta_cobro('Z', 'T', '30701234568', 'B', null, '0170099220000067797370', 'caja_ahorro', 'ARS')$$,
  '42501', null, 'un no Administrador no crea cuentas'
);
select throws_ok(
  $$select public.actualizar_cuenta_cobro(c.id, c.updated_at, 'Z', 'T', '30701234568', 'B', null,
      '0170099220000067797370', 'caja_ahorro', 'ARS', 0, true, null, '{}')
    from dominio.cuentas_cobro c limit 1$$,
  '42501', null, 'un no Administrador no edita cuentas'
);
select throws_ok(
  $$select public.cambiar_estado_cuenta_cobro(id, false) from dominio.cuentas_cobro limit 1$$,
  '42501', null, 'un no Administrador no marca «No usar»'
);
select throws_ok(
  $$insert into dominio.cuentas_cobro (nombre) values ('Directa')$$,
  '42501', null, 'tampoco hay escritura directa sobre la tabla (RLS)'
);

-- ============================================================================
-- Consulta (solo lectura)
-- ============================================================================

select pg_temp.como('d1000000-0000-0000-0000-000000000013');

select is(
  (select count(*)::int from dominio.cuentas_cobro),
  2,
  'un rol de lectura ve las cuentas'
);
select throws_ok(
  $$select public.crear_cuenta_cobro('Z', 'T', '30701234568', 'B', null, '0170099220000067797370', 'caja_ahorro', 'ARS')$$,
  '42501', null, 'un rol de lectura no crea cuentas'
);

-- ============================================================================
-- Administrador de la Dos: aislamiento por organización
-- ============================================================================

select pg_temp.como('d2000000-0000-0000-0000-000000000011');

select is(
  (select count(*)::int from dominio.cuentas_cobro) + (select count(*)::int from dominio.cuentas_cobro_empresas),
  0,
  'la otra organización no ve cuentas ni habilitaciones de la Uno (RLS)'
);
select throws_ok(
  $$select public.cambiar_estado_cuenta_cobro('00000000-0000-0000-0000-000000000000', false)$$,
  'P0002', null, 'una cuenta que no existe (o es de otra organización) se informa sin revelar nada'
);

-- ============================================================================
-- Sin delete, disparador de pertenencia y anon
-- ============================================================================

select pg_temp.como('d1000000-0000-0000-0000-000000000011');

select throws_ok(
  $$delete from dominio.cuentas_cobro$$,
  '42501', null, 'ni el Administrador puede borrar cuentas (sin grant DELETE)'
);

reset role;

select throws_ok(
  $$insert into dominio.cuentas_cobro_empresas (cuenta_id, empresa_id, organizacion_id)
    select id, 'a2000000-0000-0000-0000-0000000000a1', '11111111-1111-1111-1111-111111111111'
      from dominio.cuentas_cobro limit 1$$,
  '23514', null, 'el disparador rechaza una empresa de otra organización'
);
select throws_ok(
  $$insert into dominio.cuentas_cobro_empresas (cuenta_id, empresa_id, organizacion_id)
    select id, 'a2000000-0000-0000-0000-0000000000a1', '22222222-2222-2222-2222-222222222222'
      from dominio.cuentas_cobro limit 1$$,
  '23514', null, 'el disparador rechaza una cuenta de otra organización'
);

select is(
  has_function_privilege('anon', 'public.crear_cuenta_cobro(text,text,text,text,text,text,text,text,integer,boolean,text,uuid[])', 'execute')
    or has_function_privilege('anon', 'public.actualizar_cuenta_cobro(uuid,timestamptz,text,text,text,text,text,text,text,text,integer,boolean,text,uuid[])', 'execute')
    or has_function_privilege('anon', 'public.cambiar_estado_cuenta_cobro(uuid,boolean)', 'execute')
    or has_function_privilege('anon', 'public.listar_cuentas_cobro(uuid,text,integer,integer)', 'execute'),
  false,
  'anon no ejecuta las RPC'
);
select is(
  has_table_privilege('anon', 'dominio.cuentas_cobro', 'select')
    or has_table_privilege('anon', 'dominio.cuentas_cobro_empresas', 'select')
    or has_table_privilege('authenticated', 'dominio.cuentas_cobro', 'delete')
    or has_table_privilege('authenticated', 'dominio.cuentas_cobro_empresas', 'insert'),
  false,
  'anon sin privilegios; nadie borra cuentas; las habilitaciones no se escriben directo'
);

select * from finish();
rollback;
