-- F-VTA-02 (MSF-225, épica MSF-139, SC-003): `dominio.formas_envio` y sus RPC.
-- Cubre FR-006 y FR-007 (mismo alcance que formas_envio más costo negativo y costo nulo): esquema `dominio` con RLS, aislamiento por organización y por
-- empresa accesible, lectura con la sección `ventas`, escritura solo del Administrador,
-- nombre único por empresa (y válido en otra), valores fuera de lista, bloqueo optimista,
-- estado idempotente, sin DELETE y `anon` sin ejecución.
-- El fixture corre como postgres (RLS no aplica) y las verificaciones como "authenticated"
-- vía request.jwt.claims, igual que PostgREST.
begin;

select plan(40);

insert into organizaciones (id, nombre) values
  ('11111111-1111-1111-1111-111111111111', 'Organización Uno'),
  ('22222222-2222-2222-2222-222222222222', 'Organización Dos');

insert into auth.users (id, email) values
  ('f1000000-0000-0000-0000-000000000001', 'admin-uno@example.com'),
  ('f1000000-0000-0000-0000-000000000002', 'operador-uno@example.com'),
  ('f1000000-0000-0000-0000-000000000003', 'consulta-uno@example.com'),
  ('f2000000-0000-0000-0000-000000000001', 'admin-dos@example.com');

insert into usuarios_organizacion (user_id, organizacion_id, rol_id, estado) values
  ('f1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'administrador', 'activo'),
  ('f1000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'operador', 'activo'),
  ('f1000000-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111', 'consulta', 'activo'),
  ('f2000000-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', 'administrador', 'activo');

insert into dominio.empresas (id, organizacion_id, nombre) values
  ('a1000000-0000-0000-0000-00000000000a', '11111111-1111-1111-1111-111111111111', 'San Javucho'),
  ('a1000000-0000-0000-0000-00000000000b', '11111111-1111-1111-1111-111111111111', 'Mundo JC'),
  ('a2000000-0000-0000-0000-00000000000c', '22222222-2222-2222-2222-222222222222', 'Empresa Dos');

-- El operador trabaja en San Javucho; la persona de consulta, en Mundo JC.
insert into usuarios_empresas (user_id, empresa_id, organizacion_id, rol_id) values
  ('f1000000-0000-0000-0000-000000000002', 'a1000000-0000-0000-0000-00000000000a', '11111111-1111-1111-1111-111111111111', 'operador'),
  ('f1000000-0000-0000-0000-000000000003', 'a1000000-0000-0000-0000-00000000000b', '11111111-1111-1111-1111-111111111111', 'consulta');
insert into usuario_empresa_activa (user_id, empresa_id) values
  ('f1000000-0000-0000-0000-000000000002', 'a1000000-0000-0000-0000-00000000000a'),
  ('f1000000-0000-0000-0000-000000000003', 'a1000000-0000-0000-0000-00000000000b');

insert into dominio.formas_envio (id, organizacion_id, empresa_id, nombre, tipo) values
  ('b1000000-0000-0000-0000-00000000000a', '11111111-1111-1111-1111-111111111111', 'a1000000-0000-0000-0000-00000000000a', 'Retiro en local', 'retiro_local'),
  ('b1000000-0000-0000-0000-00000000000b', '11111111-1111-1111-1111-111111111111', 'a1000000-0000-0000-0000-00000000000b', 'Retiro en local', 'retiro_local'),
  ('b2000000-0000-0000-0000-00000000000c', '22222222-2222-2222-2222-222222222222', 'a2000000-0000-0000-0000-00000000000c', 'Retiro en local', 'retiro_local');

create function pg_temp.como(p_user uuid) returns void language plpgsql as $$
begin
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
  set local role authenticated;
end $$;

-- ============================================================================
-- Esquema (Principio VII)
-- ============================================================================

select ok(
  exists (select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
           where n.nspname = 'dominio' and c.relname = 'formas_envio' and c.relrowsecurity),
  'formas_envio vive en «dominio» y tiene RLS activada'
);
select ok(
  not exists (select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
               where n.nspname = 'public' and c.relname = 'formas_envio'),
  'no existe una copia en «public»'
);

-- ============================================================================
-- Lectura: organización, empresa accesible y sección ventas
-- ============================================================================

select pg_temp.como('f1000000-0000-0000-0000-000000000001');
select is((select count(*)::int from dominio.formas_envio), 2,
  'el administrador de la Uno ve las formas de sus dos empresas y ninguna de la otra organización');

select pg_temp.como('f2000000-0000-0000-0000-000000000001');
select is((select count(*)::int from dominio.formas_envio where empresa_id = 'a1000000-0000-0000-0000-00000000000a'), 0,
  'la organización Dos no ve formas ajenas');

select pg_temp.como('f1000000-0000-0000-0000-000000000002');
select is((select array_agg(empresa_id) from dominio.formas_envio), array['a1000000-0000-0000-0000-00000000000a']::uuid[],
  'el operador (ventas = edición) lee solo las formas de su empresa');

select pg_temp.como('f1000000-0000-0000-0000-000000000003');
select is((select array_agg(empresa_id) from dominio.formas_envio), array['a1000000-0000-0000-0000-00000000000b']::uuid[],
  'la persona de consulta (ventas = lectura) lee las formas de su empresa y no las de San Javucho');

-- «Ventas» en ninguno para consulta (como postgres): no recibe filas aunque consulte directo.
reset role;
update permisos_rol set nivel = 'ninguno'
 where organizacion_id = '11111111-1111-1111-1111-111111111111' and rol_id = 'consulta' and seccion = 'ventas';
select pg_temp.como('f1000000-0000-0000-0000-000000000003');
select is((select count(*)::int from dominio.formas_envio), 0, 'sección Ventas en «ninguno»: sin filas');

-- ============================================================================
-- Escritura: solo el Administrador
-- ============================================================================

select pg_temp.como('f1000000-0000-0000-0000-000000000002');
select throws_ok(
  $$select * from public.crear_forma_envio(array['a1000000-0000-0000-0000-00000000000a']::uuid[], 'Moto', 'moto', false, null, 'sin_armar')$$,
  '42501', null, 'un rol con edición en Ventas que no es Administrador no puede crear');
select throws_ok(
  $$select public.actualizar_forma_envio('b1000000-0000-0000-0000-00000000000a', now(), 'Otra', 'correo', false, null, 'sin_armar', 1, true)$$,
  '42501', null, 'ni editar');
select throws_ok(
  $$select public.cambiar_estado_forma_envio('b1000000-0000-0000-0000-00000000000a', false)$$,
  '42501', null, 'ni cambiar el estado');
select throws_ok(
  $$insert into dominio.formas_envio (empresa_id, nombre, tipo) values ('a1000000-0000-0000-0000-00000000000a', 'Directa', 'correo')$$,
  '42501', null, 'tampoco por insert directo (RLS)');

select pg_temp.como('f1000000-0000-0000-0000-000000000001');

select is(
  (select count(*)::int from public.crear_forma_envio(
     array['a1000000-0000-0000-0000-00000000000a', 'a1000000-0000-0000-0000-00000000000b']::uuid[],
     '  Expreso a domicilio ', 'expreso', true, 1500.5, 'armando', 2, true)),
  2, 'el alta multiempresa devuelve un ítem por empresa marcada');
select is(
  (select count(distinct id)::int from dominio.formas_envio where nombre = 'Expreso a domicilio'),
  2, 'son ítems independientes (nombre normalizado, un id por empresa)');
select is(
  (select count(*)::int from dominio.formas_envio where nombre = 'Expreso a domicilio' and exige_transporte_guia and costo_defecto = 1500.50 and estado_despacho_inicial = 'armando'),
  2, 'cada ítem conserva los campos enviados');

select throws_ok(
  $$select * from public.crear_forma_envio(array['a1000000-0000-0000-0000-00000000000a']::uuid[], 'RETIRO EN LOCAL', 'retiro_local', false, null, 'sin_armar')$$,
  '23505', null, 'un nombre repetido en la misma empresa se rechaza sin distinguir mayúsculas');
select lives_ok(
  $$select * from public.crear_forma_envio(array['a1000000-0000-0000-0000-00000000000b']::uuid[], 'Moto', 'moto', false, 3500, 'listo_para_despachar')$$,
  'un nombre libre en una empresa se crea');
select lives_ok(
  $$select * from public.crear_forma_envio(array['a1000000-0000-0000-0000-00000000000a']::uuid[], 'Moto', 'moto', false, 3500, 'listo_para_despachar')$$,
  'el mismo nombre es válido en otra empresa');

-- Todo o nada: Mundo JC ya tiene «Correo»; San Javucho no debe recibirla.
select lives_ok(
  $$select * from public.crear_forma_envio(array['a1000000-0000-0000-0000-00000000000b']::uuid[], 'Correo', 'correo', true, null, 'sin_armar')$$,
  'se crea «Correo» solo en Mundo JC');
select throws_ok(
  $$select * from public.crear_forma_envio(array['a1000000-0000-0000-0000-00000000000a', 'a1000000-0000-0000-0000-00000000000b']::uuid[], 'Correo', 'correo', true, null, 'sin_armar')$$,
  '23505', null, 'si una de las empresas ya la tiene, el alta falla');
select is(
  (select count(*)::int from dominio.formas_envio where nombre = 'Correo' and empresa_id = 'a1000000-0000-0000-0000-00000000000a'),
  0, 'y no se creó en la otra empresa (transacción única)');

-- Valores no permitidos
select throws_ok(
  $$select * from public.crear_forma_envio(array['a1000000-0000-0000-0000-00000000000a']::uuid[], '   ', 'correo', false, null, 'sin_armar')$$,
  '22023', 'Completá el nombre', 'nombre vacío');
select throws_ok(
  $$select * from public.crear_forma_envio(array['a1000000-0000-0000-0000-00000000000a']::uuid[], 'Paloma', 'paloma', false, null, 'sin_armar')$$,
  '22023', null, 'tipo fuera de la lista');
select throws_ok(
  $$select * from public.crear_forma_envio(array['a1000000-0000-0000-0000-00000000000a']::uuid[], 'Paloma', 'correo', false, null, 'entregado')$$,
  '22023', null, 'estado de despacho fuera de la lista');
select throws_ok(
  $$select * from public.crear_forma_envio(array[]::uuid[], 'Paloma', 'correo', false, null, 'sin_armar')$$,
  '22023', null, 'sin empresas marcadas');
select throws_ok(
  $$select * from public.crear_forma_envio(array['a2000000-0000-0000-0000-00000000000c']::uuid[], 'Paloma', 'correo', false, null, 'sin_armar')$$,
  '42501', null, 'una empresa de otra organización se rechaza');

-- Costo por defecto: negativo se rechaza; nulo y cero son válidos
select throws_ok(
  $$select * from public.crear_forma_envio(array['a1000000-0000-0000-0000-00000000000a']::uuid[], 'Paloma', 'correo', false, -1, 'sin_armar')$$,
  '22023', null, 'un costo negativo se rechaza');
select lives_ok(
  $$select * from public.crear_forma_envio(array['a1000000-0000-0000-0000-00000000000a']::uuid[], 'Terminal', 'terminal', true, 0, 'sin_armar')$$,
  'un costo en cero es válido');
select is(
  (select costo_defecto from dominio.formas_envio where nombre = 'Retiro en local' and empresa_id = 'a1000000-0000-0000-0000-00000000000b'),
  null::numeric, 'un costo nulo se guarda como nulo (la lista muestra «—»)');
select throws_ok(
  $$update dominio.formas_envio set costo_defecto = -5 where id = 'b1000000-0000-0000-0000-00000000000a'$$,
  '23514', null, 'la base también rechaza el costo negativo (check)');
select throws_ok(
  $$select * from public.crear_forma_envio(array['a1000000-0000-0000-0000-00000000000a']::uuid[], 'Paloma', 'correo', false, 99999999999, 'sin_armar')$$,
  '22023', null, 'un costo fuera de rango se rechaza');
select lives_ok(
  $$select * from public.crear_forma_envio(array['a1000000-0000-0000-0000-00000000000b']::uuid[], 'Expreso', 'expreso', true, 12345678.90, 'sin_armar')$$,
  'un importe grande con centavos es válido');

-- ============================================================================
-- Edición con bloqueo optimista
-- ============================================================================

select set_config('prueba.leido', (select updated_at::text from dominio.formas_envio where id = 'b1000000-0000-0000-0000-00000000000a'), true);

select is(
  (select nombre from public.actualizar_forma_envio('b1000000-0000-0000-0000-00000000000a', current_setting('prueba.leido')::timestamptz, 'Retiro en caja', 'retiro_local', false, 0, 'listo_para_despachar', 3, true)),
  'Retiro en caja', 'editar con la versión leída guarda el cambio');
select is(
  (select nombre from dominio.formas_envio where id = 'b1000000-0000-0000-0000-00000000000b'),
  'Retiro en local', 'y la edición aplica solo a la empresa elegida');
select throws_ok(
  $$select public.actualizar_forma_envio('b1000000-0000-0000-0000-00000000000a', current_setting('prueba.leido')::timestamptz, 'Otro nombre', 'retiro_local', false, 0, 'listo_para_despachar', 3, true)$$,
  '40001', null, 'editar con una versión vieja es un conflicto');

-- ============================================================================
-- Estado idempotente
-- ============================================================================

select is((select activo from public.cambiar_estado_forma_envio('b1000000-0000-0000-0000-00000000000b', false)), false,
  'desactivar deja la forma inactiva');
select set_config('prueba.estado', (select updated_at::text from dominio.formas_envio where id = 'b1000000-0000-0000-0000-00000000000b'), true);
select is(
  (select updated_at::text from public.cambiar_estado_forma_envio('b1000000-0000-0000-0000-00000000000b', false)),
  current_setting('prueba.estado'), 'desactivar de nuevo no cambia nada (idempotente)');
select is((select activo from public.cambiar_estado_forma_envio('b1000000-0000-0000-0000-00000000000b', true)), true,
  'reactivar la devuelve a activa sin perder datos');

-- ============================================================================
-- Sin DELETE y `anon` sin ejecución
-- ============================================================================

select throws_ok($$delete from dominio.formas_envio where id = 'b1000000-0000-0000-0000-00000000000a'$$,
  '42501', null, 'no existe el borrado: ni el Administrador puede hacer delete');

reset role;
select is(
  (select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in ('crear_forma_envio', 'actualizar_forma_envio', 'cambiar_estado_forma_envio')
      and has_function_privilege('anon', p.oid, 'execute')),
  0, 'anon no puede ejecutar ninguna RPC de formas de pago');
select ok(
  not has_table_privilege('anon', 'dominio.formas_envio', 'select')
  and not has_table_privilege('authenticated', 'dominio.formas_envio', 'delete'),
  'anon no lee la tabla y authenticated no tiene delete');

select * from finish();
rollback;
