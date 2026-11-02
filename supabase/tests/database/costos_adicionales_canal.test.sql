-- F-REN-08 (MSF-209, épica MSF-192): costos adicionales del canal.
-- Cubre FR-001…FR-003 / SC-001: sin costos el margen es el de MSF-120; 5 % sobre el neto ($ 10.000 −
-- $ 6.000 − $ 500 = $ 3.500, 35 %) solo en la empresa del costo; monto por unidad y varios costos
-- activos; baja y edición recalculan margen y estado; nombre repetido, valor negativo y porcentaje
-- fuera de 0–100 rechazados por la RPC; permisos (solo `edicion` escribe, `lectura` lista, sin sección
-- no ve nada); `anon` sin ejecución; sin escritura directa a la tabla; RLS activa en la tabla.
begin;

select plan(37);

insert into organizaciones (id, nombre) values
  ('11111111-1111-1111-1111-111111111111', 'Organización Uno'),
  ('22222222-2222-2222-2222-222222222222', 'Organización Dos');

insert into auth.users (id, email) values
  ('d1000000-0000-0000-0000-000000000001', 'administrador@example.com'),
  ('d1000000-0000-0000-0000-000000000002', 'administracion@example.com'),
  ('d1000000-0000-0000-0000-000000000003', 'operador@example.com'),
  ('d2000000-0000-0000-0000-000000000001', 'admin-dos@example.com');

insert into usuarios_organizacion (user_id, organizacion_id, rol_id) values
  ('d1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'administrador'),
  ('d1000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'administracion'),
  ('d1000000-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111', 'operador'),
  ('d2000000-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', 'administrador');

insert into dominio.empresas (id, organizacion_id, nombre) values
  ('e1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'Mundo JC'),
  ('e1000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'San Javucho'),
  ('e2000000-0000-0000-0000-000000000003', '22222222-2222-2222-2222-222222222222', 'Empresa Dos');

-- Administración solo ve las empresas con fila explícita (private.empresas_accesibles).
insert into usuarios_empresas (user_id, empresa_id, organizacion_id, rol_id) values
  ('d1000000-0000-0000-0000-000000000002', 'e1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'administracion'),
  ('d1000000-0000-0000-0000-000000000002', 'e1000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'administracion');

-- Neto $ 10.000 y costo $ 6.000 en las dos empresas de la organización 1.
insert into dominio.productos (id, organizacion_id, nombre, sku, moneda, precio_lista, activo) values
  ('a1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'Joystick', 'JOY-1', 'ARS', 10000, true);
insert into dominio.producto_costos (producto_id, organizacion_id, costo) values
  ('a1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 6000);

create function pg_temp.como(p_user uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
  set local role authenticated;
end $$;

create function pg_temp.margen(p_empresa uuid) returns numeric language sql as $$
  select margen from analitica.margen_producto_canal
   where producto_id = 'a1000000-0000-0000-0000-000000000001' and empresa_id = p_empresa
$$;

create function pg_temp.id_costo(p_nombre text, p_empresa uuid) returns uuid language sql as $$
  select id from dominio.costos_adicionales_canal where nombre = p_nombre and empresa_id = p_empresa and activo
$$;

-- ============================================================================
-- Esquema y contrato (FR-001, FR-003)
-- ============================================================================

select has_table('dominio', 'costos_adicionales_canal', 'la tabla vive en dominio');
select has_function('analitica', 'costos_adicionales_de', array['uuid', 'numeric'], 'existe analitica.costos_adicionales_de');
select has_column('analitica', 'margen_producto_canal', 'costos_adicionales', 'la vista suma costos_adicionales');
select ok(
  (select relrowsecurity from pg_class where oid = 'dominio.costos_adicionales_canal'::regclass),
  'la tabla tiene RLS'
);

-- Escenario 1: sin costos, el margen es el de MSF-120 (neto − costo).
select is(pg_temp.margen('e1000000-0000-0000-0000-000000000001'), 4000.00, 'sin costos adicionales: margen = neto − costo');
select is(
  (select costos_adicionales from analitica.margen_producto_canal
    where empresa_id = 'e1000000-0000-0000-0000-000000000001'),
  0::numeric, 'sin costos adicionales la columna vale 0'
);

-- ============================================================================
-- Alta, margen por empresa, monto, varios costos (US1-2, US1-3)
-- ============================================================================

select pg_temp.como('d1000000-0000-0000-0000-000000000001');
select lives_ok(
  $$select public.guardar_costo_adicional(null, 'e1000000-0000-0000-0000-000000000001', 'Impuestos', 'porcentaje', 5)$$,
  'el administrador crea un costo del 5 %'
);
reset role;

select is(pg_temp.margen('e1000000-0000-0000-0000-000000000001'), 3500.00, '5 % sobre $ 10.000: margen $ 3.500');
select is(
  (select margen_pct from analitica.margen_producto_canal where empresa_id = 'e1000000-0000-0000-0000-000000000001'),
  0.35, 'margen % = 35 %'
);
select is(pg_temp.margen('e1000000-0000-0000-0000-000000000002'), 4000.00, 'las demás empresas siguen en $ 4.000');

select pg_temp.como('d1000000-0000-0000-0000-000000000001');
select lives_ok(
  $$select public.guardar_costo_adicional(null, 'e1000000-0000-0000-0000-000000000001', 'Envío', 'monto', 200)$$,
  'el administrador crea un costo de $ 200 por unidad'
);
reset role;
select is(pg_temp.margen('e1000000-0000-0000-0000-000000000001'), 3300.00, 'se descuentan todos los costos activos de la empresa');

-- ============================================================================
-- Baja y edición recalculan margen y estado (US1-4)
-- ============================================================================

select pg_temp.como('d1000000-0000-0000-0000-000000000001');
select lives_ok(
  $$select public.dar_baja_costo_adicional(pg_temp.id_costo('Envío', 'e1000000-0000-0000-0000-000000000001'))$$,
  'el administrador da de baja un costo'
);
select lives_ok(
  $$select public.dar_baja_costo_adicional((select id from dominio.costos_adicionales_canal where nombre = 'Envío'))$$,
  'la baja es idempotente'
);
reset role;
select is(pg_temp.margen('e1000000-0000-0000-0000-000000000001'), 3500.00, 'el costo dado de baja deja de descontarse');

select pg_temp.como('d1000000-0000-0000-0000-000000000001');
select lives_ok(
  $$select public.guardar_costo_adicional(pg_temp.id_costo('Impuestos', 'e1000000-0000-0000-0000-000000000001'), 'e1000000-0000-0000-0000-000000000001', 'Impuestos', 'porcentaje', 60)$$,
  'el administrador edita el costo al 60 %'
);
reset role;
select is(
  (select estado from analitica.margen_producto_canal where empresa_id = 'e1000000-0000-0000-0000-000000000001'),
  'negativo', 'con 60 % el margen es negativo y el estado se recalcula'
);

select pg_temp.como('d1000000-0000-0000-0000-000000000001');
select lives_ok(
  $$select public.dar_baja_costo_adicional(pg_temp.id_costo('Impuestos', 'e1000000-0000-0000-0000-000000000001'))$$,
  'se da de baja el último costo'
);
reset role;
select is(pg_temp.margen('e1000000-0000-0000-0000-000000000001'), 4000.00, 'sin costos activos vuelve al margen de MSF-120');
select is(
  (select estado from analitica.margen_producto_canal where empresa_id = 'e1000000-0000-0000-0000-000000000001'),
  'ok', 'y el estado vuelve a ok'
);

-- ============================================================================
-- Validaciones de la RPC (US1-6)
-- ============================================================================

select pg_temp.como('d1000000-0000-0000-0000-000000000001');
select lives_ok(
  $$select public.guardar_costo_adicional(null, 'e1000000-0000-0000-0000-000000000001', 'Tasa', 'porcentaje', 2)$$,
  'un nombre dado de baja puede volver a usarse (la unicidad es entre activos)'
);
select throws_ok(
  $$select public.guardar_costo_adicional(null, 'e1000000-0000-0000-0000-000000000001', ' tasa ', 'monto', 10)$$,
  '23505', null, 'nombre repetido en la misma empresa (sin distinguir mayúsculas ni bordes)'
);
select lives_ok(
  $$select public.guardar_costo_adicional(null, 'e1000000-0000-0000-0000-000000000002', 'Tasa', 'porcentaje', 2)$$,
  'el mismo nombre en otra empresa es válido'
);
select throws_ok(
  $$select public.guardar_costo_adicional(null, 'e1000000-0000-0000-0000-000000000001', 'Negativo', 'monto', -1)$$,
  '23514', null, 'valor negativo rechazado'
);
select throws_ok(
  $$select public.guardar_costo_adicional(null, 'e1000000-0000-0000-0000-000000000001', 'Enorme', 'porcentaje', 100.5)$$,
  '23514', null, 'porcentaje mayor a 100 rechazado'
);
select throws_ok(
  $$select public.guardar_costo_adicional(null, 'e1000000-0000-0000-0000-000000000001', '   ', 'monto', 1)$$,
  '23514', null, 'nombre vacío rechazado'
);
select throws_ok(
  $$select public.guardar_costo_adicional(null, 'e1000000-0000-0000-0000-000000000001', 'Raro', 'otro', 1)$$,
  '23514', null, 'tipo inválido rechazado'
);
select throws_ok(
  $$select public.guardar_costo_adicional(null, 'e2000000-0000-0000-0000-000000000003', 'Ajeno', 'monto', 1)$$,
  '42501', null, 'no se puede cargar un costo en una empresa de otra organización'
);
select throws_ok(
  $$insert into dominio.costos_adicionales_canal (organizacion_id, empresa_id, nombre, tipo, valor)
    values ('11111111-1111-1111-1111-111111111111', 'e1000000-0000-0000-0000-000000000001', 'Directo', 'monto', 1)$$,
  '42501', null, 'la escritura directa a la tabla no existe'
);
reset role;

-- ============================================================================
-- Permisos por rol (US1-5, FR-002)
-- ============================================================================

select pg_temp.como('d1000000-0000-0000-0000-000000000002');
select is(
  (select count(*)::int from public.listar_costos_adicionales(null)), 2,
  'Administración (lectura) lista los costos activos'
);
select throws_ok(
  $$select public.guardar_costo_adicional(null, 'e1000000-0000-0000-0000-000000000001', 'Nuevo', 'monto', 1)$$,
  '42501', null, 'Administración no puede guardar'
);
select throws_ok(
  $$select public.dar_baja_costo_adicional(pg_temp.id_costo('Tasa', 'e1000000-0000-0000-0000-000000000001'))$$,
  '42501', null, 'Administración no puede dar de baja'
);
reset role;

select pg_temp.como('d1000000-0000-0000-0000-000000000003');
select throws_ok(
  $$select public.listar_costos_adicionales(null)$$,
  '42501', null, 'un rol sin la sección rentabilidad no lista'
);
select is((select count(*)::int from dominio.costos_adicionales_canal), 0, 'ni lee la tabla (RLS)');
reset role;

select pg_temp.como('d1000000-0000-0000-0000-000000000001');
select is(
  (select count(*)::int from public.listar_costos_adicionales('e1000000-0000-0000-0000-000000000002')), 1,
  'el filtro por empresa trae solo las de esa empresa'
);
reset role;

select ok(
  not has_function_privilege('anon', 'public.guardar_costo_adicional(uuid, uuid, text, text, numeric)', 'execute')
  and not has_function_privilege('anon', 'public.listar_costos_adicionales(uuid)', 'execute')
  and not has_function_privilege('anon', 'public.dar_baja_costo_adicional(uuid)', 'execute'),
  'anon no ejecuta las RPC'
);
select ok(
  has_function_privilege('authenticated', 'public.guardar_costo_adicional(uuid, uuid, text, text, numeric)', 'execute')
  and not has_table_privilege('anon', 'dominio.costos_adicionales_canal', 'select'),
  'authenticated ejecuta la RPC y anon no toca la tabla'
);

select * from finish();
rollback;
