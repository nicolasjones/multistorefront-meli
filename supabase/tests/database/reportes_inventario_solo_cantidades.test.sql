-- Decisión de Nicolás (Decisión abierta 3 de MSF-140, 2026-11-14): el rol Consulta (y cualquier rol sin la acción
-- `ver_costos` en Stock) ve el reporte de inventario SOLO con cantidades. Se prueba en la base:
--   · la vista `analitica.inventario_productos_stock_cantidades` no trae costo ni valor ni lee `producto_costos`;
--   · `resolver_organizacion_reporte` no emite el token del tablero con costos (`accion_requerida = 'ver_costos'`)
--     a quien no tiene la acción, pero sí el de cantidades;
--   · `reportes_visibles_para_mi` no lista el tablero con costos a quien no la tiene;
--   · la matriz por rol de la organización manda (conceder `ver_costos` a Consulta le abre el tablero con costos);
--   · falla cerrado (acción sin sección) y la superficie nueva no abre nada a `anon`.
begin;

select plan(41);

insert into organizaciones (id, nombre) values
  ('11111111-1111-1111-1111-111111111111', 'Organización Uno'),
  ('22222222-2222-2222-2222-222222222222', 'Organización Dos');

insert into auth.users (id, email) values
  ('d1000000-0000-0000-0000-000000000001', 'administrador@example.com'),
  ('d1000000-0000-0000-0000-000000000002', 'administracion@example.com'),
  ('d1000000-0000-0000-0000-000000000003', 'consulta@example.com'),
  ('d1000000-0000-0000-0000-000000000004', 'operador@example.com'),
  ('d1000000-0000-0000-0000-000000000005', 'sin-organizacion@example.com'),
  ('d1000000-0000-0000-0000-000000000006', 'superadmin@example.com');
insert into superadmins (user_id) values ('d1000000-0000-0000-0000-000000000006');

insert into usuarios_organizacion (user_id, organizacion_id, rol_id) values
  ('d1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'administrador'),
  ('d1000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'administracion'),
  ('d1000000-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111', 'consulta'),
  ('d1000000-0000-0000-0000-000000000004', '11111111-1111-1111-1111-111111111111', 'operador');

-- Consulta y Administración leen Stock.
insert into public.permisos_rol (organizacion_id, rol_id, seccion, nivel) values
  ('11111111-1111-1111-1111-111111111111', 'administracion', 'stock', 'lectura'),
  ('11111111-1111-1111-1111-111111111111', 'consulta', 'stock', 'lectura'),
  ('11111111-1111-1111-1111-111111111111', 'operador', 'stock', 'edicion')
  on conflict (organizacion_id, rol_id, seccion) do update set nivel = excluded.nivel;

-- Los dos tableros (uno con costos que exige ver_costos, otro de cantidades) y uno que declara una acción sin sección.
insert into reportes (id, superset_dashboard_uuid, nombre, creado_por, seccion, accion_requerida) values
  ('f0000000-0000-0000-0000-0000000000a1', 'dash-con-costos', 'Inventario · Productos y stock', 'd1000000-0000-0000-0000-000000000001', 'stock', 'ver_costos'),
  ('f0000000-0000-0000-0000-0000000000a2', 'dash-cantidades', 'Inventario · Productos y stock (cantidades)', 'd1000000-0000-0000-0000-000000000001', 'stock', null),
  ('f0000000-0000-0000-0000-0000000000a3', 'dash-sin-seccion', 'Reporte sin sección con acción', 'd1000000-0000-0000-0000-000000000001', null, 'ver_costos'),
  ('f0000000-0000-0000-0000-0000000000a4', 'dash-sin-accion', 'Otro reporte de stock sin acción', 'd1000000-0000-0000-0000-000000000001', 'stock', null);
insert into reportes_roles_default (reporte_id, rol_id)
  select r, rol
    from unnest(array['f0000000-0000-0000-0000-0000000000a1', 'f0000000-0000-0000-0000-0000000000a2', 'f0000000-0000-0000-0000-0000000000a3', 'f0000000-0000-0000-0000-0000000000a4']::uuid[]) r,
         unnest(array['administracion', 'consulta', 'operador']) rol;
insert into reportes_organizaciones (reporte_id, organizacion_id, asignado_por) values
  ('f0000000-0000-0000-0000-0000000000a1', '11111111-1111-1111-1111-111111111111', 'd1000000-0000-0000-0000-000000000001'),
  ('f0000000-0000-0000-0000-0000000000a3', '11111111-1111-1111-1111-111111111111', 'd1000000-0000-0000-0000-000000000001'),
  ('f0000000-0000-0000-0000-0000000000a4', '11111111-1111-1111-1111-111111111111', 'd1000000-0000-0000-0000-000000000001');

-- ============================================================================
-- Asignación automática del tablero «(cantidades)»: a toda organización que ya tenga el de costos (migración, bloque 6)
-- ============================================================================

select is(
  (select array_agg(organizacion_id::text) from public.reportes_organizaciones where reporte_id = 'f0000000-0000-0000-0000-0000000000a2'),
  array['11111111-1111-1111-1111-111111111111'],
  'el tablero de cantidades se asignó solo a la organización que tiene el de costos (sin asignar a mano)'
);
select is(
  (select count(*)::int from public.reportes_organizaciones where reporte_id = 'f0000000-0000-0000-0000-0000000000a2' and organizacion_id = '22222222-2222-2222-2222-222222222222'),
  0, 'una organización sin el tablero de costos no recibe el de cantidades'
);
-- Se asigna el de costos a otra organización: el de cantidades la acompaña (con los roles por defecto).
insert into reportes_organizaciones (reporte_id, organizacion_id, asignado_por) values
  ('f0000000-0000-0000-0000-0000000000a1', '22222222-2222-2222-2222-222222222222', 'd1000000-0000-0000-0000-000000000001');
select is(
  (select count(*)::int from public.reportes_organizaciones where reporte_id = 'f0000000-0000-0000-0000-0000000000a2' and organizacion_id = '22222222-2222-2222-2222-222222222222'),
  1, 'al asignar el de costos a otra organización, también se asigna el de cantidades'
);
-- Un rol habilitado después en el de costos se replica en el de cantidades.
insert into reportes_organizaciones_roles (reporte_id, organizacion_id, rol_id) values
  ('f0000000-0000-0000-0000-0000000000a1', '11111111-1111-1111-1111-111111111111', 'mostrador');
select is(
  (select count(*)::int from public.reportes_organizaciones_roles where reporte_id = 'f0000000-0000-0000-0000-0000000000a2'
    and organizacion_id = '11111111-1111-1111-1111-111111111111' and rol_id = 'mostrador'),
  1, 'un rol habilitado en el de costos se replica en el de cantidades'
);
select is(
  (select count(*)::int from public.reportes_organizaciones_roles where reporte_id = 'f0000000-0000-0000-0000-0000000000a2'
    and organizacion_id = '11111111-1111-1111-1111-111111111111' and rol_id = 'consulta'),
  1, 'Consulta tiene acceso al tablero de cantidades'
);
-- La réplica solo agrega y es idempotente (no falla ni duplica al repetirse).
select lives_ok($$select private.replicar_reporte_cantidades()$$, 'la réplica es idempotente');

create function pg_temp.como(p_user uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
  set local role authenticated;
end $$;

-- ============================================================================
-- Token: el tablero con costos exige ver_costos
-- ============================================================================

select pg_temp.como('d1000000-0000-0000-0000-000000000001');
select is(public.resolver_organizacion_reporte('f0000000-0000-0000-0000-0000000000a1'),
  '11111111-1111-1111-1111-111111111111'::uuid, 'el administrador abre el tablero con costos');
select is(public.resolver_organizacion_reporte('f0000000-0000-0000-0000-0000000000a2'),
  '11111111-1111-1111-1111-111111111111'::uuid, 'el administrador abre el tablero de cantidades');
reset role;

select pg_temp.como('d1000000-0000-0000-0000-000000000002');
select is(public.resolver_organizacion_reporte('f0000000-0000-0000-0000-0000000000a1'),
  '11111111-1111-1111-1111-111111111111'::uuid, 'Administración (con ver_costos por defecto) abre el tablero con costos');
reset role;

select pg_temp.como('d1000000-0000-0000-0000-000000000003');
select is(public.resolver_organizacion_reporte('f0000000-0000-0000-0000-0000000000a1'),
  null::uuid, 'Consulta sin ver_costos: no hay token del tablero con costos (403)');
select is(public.resolver_organizacion_reporte('f0000000-0000-0000-0000-0000000000a2'),
  '11111111-1111-1111-1111-111111111111'::uuid, 'Consulta abre el tablero de cantidades');
select is(public.resolver_organizacion_reporte('f0000000-0000-0000-0000-0000000000a3'),
  null::uuid, 'una acción requerida sin sección falla cerrado');
reset role;

-- Operador (matriz por defecto): conserva costos y valor del inventario.
select pg_temp.como('d1000000-0000-0000-0000-000000000004');
select is(public.resolver_organizacion_reporte('f0000000-0000-0000-0000-0000000000a1'),
  '11111111-1111-1111-1111-111111111111'::uuid, 'Operador (ver_costos en Stock por defecto) abre el tablero con costos');
reset role;
select is(
  (select permitido from public.permisos_rol_accion
    where organizacion_id = '11111111-1111-1111-1111-111111111111' and rol_id = 'operador'
      and seccion = 'stock' and accion = 'ver_costos'),
  true, 'la matriz de la organización tiene ver_costos para Operador en Stock'
);
select is(
  (select permitido from private.matriz_acciones_iniciales()
    where rol_id = 'operador' and seccion = 'stock' and accion = 'ver_costos'),
  true, 'la matriz inicial da ver_costos a Operador en Stock'
);
select is(
  (select count(*)::int from private.matriz_acciones_iniciales()
    where rol_id in ('operador', 'consulta') and accion = 'ver_costos' and permitido and not (rol_id = 'operador' and seccion = 'stock')),
  0, 'ver_costos de Operador es solo en Stock y Consulta no lo tiene en ninguna sección'
);

-- Un reporte sin accion_requerida conserva su comportamiento para Consulta (solo la sección manda).
select pg_temp.como('d1000000-0000-0000-0000-000000000003');
select is(public.resolver_organizacion_reporte('f0000000-0000-0000-0000-0000000000a4'),
  '11111111-1111-1111-1111-111111111111'::uuid, 'un reporte de stock sin accion_requerida sigue abriendo con solo la sección');
reset role;

-- Falla cerrado: reporte inexistente; usuario sin organización no obtiene nada.
select pg_temp.como('d1000000-0000-0000-0000-000000000001');
select is(private.cumple_accion_reporte('f0000000-0000-0000-0000-0000000000ff'), false, 'un reporte inexistente falla cerrado');
reset role;
select pg_temp.como('d1000000-0000-0000-0000-000000000005');
select is(public.resolver_organizacion_reporte('f0000000-0000-0000-0000-0000000000a2'), null::uuid, 'sin organización no hay token');
select is((select count(*)::int from public.reportes_visibles_para_mi()), 0, 'sin organización no hay reportes visibles');
reset role;

-- Superadmin: sin organización activa no hay token; con una activa se trata como su Administrador.
select pg_temp.como('d1000000-0000-0000-0000-000000000006');
select is(public.resolver_organizacion_reporte('f0000000-0000-0000-0000-0000000000a1'), null::uuid, 'superadmin sin organización activa: sin token');
reset role;
insert into superadmin_organizacion_activa (user_id, organizacion_id) values
  ('d1000000-0000-0000-0000-000000000006', '11111111-1111-1111-1111-111111111111');
select pg_temp.como('d1000000-0000-0000-0000-000000000006');
select is(public.resolver_organizacion_reporte('f0000000-0000-0000-0000-0000000000a1'),
  '11111111-1111-1111-1111-111111111111'::uuid, 'superadmin con organización activa: abre el tablero con costos');
reset role;

-- ============================================================================
-- Lista de reportes visibles
-- ============================================================================

select pg_temp.como('d1000000-0000-0000-0000-000000000003');
select is(
  (select array_agg(nombre order by nombre) from public.reportes_visibles_para_mi()),
  array['Inventario · Productos y stock (cantidades)', 'Otro reporte de stock sin acción']::text[],
  'Consulta ve el de cantidades y el reporte sin acción; el de costos y el sin sección no figuran'
);
reset role;

select pg_temp.como('d1000000-0000-0000-0000-000000000002');
select ok(
  (select bool_or(nombre = 'Inventario · Productos y stock') from public.reportes_visibles_para_mi()),
  'Administración ve el tablero con costos'
);
reset role;

-- La matriz de la organización manda: conceder ver_costos en Stock a Consulta le abre el tablero con costos.
insert into public.permisos_rol_accion (organizacion_id, rol_id, seccion, accion, permitido)
  values ('11111111-1111-1111-1111-111111111111', 'consulta', 'stock', 'ver_costos', true)
  on conflict (organizacion_id, rol_id, seccion, accion) do update set permitido = true;
select pg_temp.como('d1000000-0000-0000-0000-000000000003');
select is(public.resolver_organizacion_reporte('f0000000-0000-0000-0000-0000000000a1'),
  '11111111-1111-1111-1111-111111111111'::uuid, 'con ver_costos concedido a Consulta, abre el tablero con costos');
reset role;

-- Y quitarle ver_costos a Administración se lo cierra.
insert into public.permisos_rol_accion (organizacion_id, rol_id, seccion, accion, permitido)
  values ('11111111-1111-1111-1111-111111111111', 'administracion', 'stock', 'ver_costos', false)
  on conflict (organizacion_id, rol_id, seccion, accion) do update set permitido = false;
select pg_temp.como('d1000000-0000-0000-0000-000000000002');
select is(public.resolver_organizacion_reporte('f0000000-0000-0000-0000-0000000000a1'),
  null::uuid, 'sin ver_costos, Administración tampoco abre el tablero con costos');
reset role;

-- La lista también respeta la matriz: con ver_costos quitado a Administración, el tablero con costos no figura.
select pg_temp.como('d1000000-0000-0000-0000-000000000002');
select ok(
  not (select bool_or(nombre = 'Inventario · Productos y stock') from public.reportes_visibles_para_mi()),
  'la lista no incluye el tablero con costos si la matriz le quitó ver_costos'
);
reset role;

-- ============================================================================
-- Vista de cantidades: sin costo ni valor
-- ============================================================================

insert into dominio.productos (id, organizacion_id, nombre, sku, moneda, precio_lista, activo) values
  ('a1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'Joystick', 'JOY-1', 'ARS', 10000, true),
  ('a1000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'Agotado', 'AGO-1', 'ARS', 10000, true),
  ('a1000000-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111', 'Inactivo', 'INA-1', 'ARS', 10000, false),
  ('a2000000-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', 'Mouse', 'MOU-1', 'ARS', 500, true);
insert into dominio.producto_costos (producto_id, organizacion_id, costo) values
  ('a1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 6000);
update dominio.existencias set cantidad = 3, minimo = 5 where producto_id = 'a1000000-0000-0000-0000-000000000001';
update dominio.existencias set cantidad = 0, minimo = 4 where producto_id = 'a1000000-0000-0000-0000-000000000002';

select has_view('analitica', 'inventario_productos_stock_cantidades', 'existe la vista de cantidades');
select columns_are(
  'analitica', 'inventario_productos_stock_cantidades',
  array['organizacion_id', 'producto_id', 'producto_nombre', 'sku', 'categoria', 'cantidad', 'minimo', 'estado'],
  'columnas del contrato: sin costo ni valor'
);
select is(
  (select count(*)::int from information_schema.columns
    where table_schema = 'analitica' and table_name = 'inventario_productos_stock_cantidades'
      and (column_name ~ 'costo' or column_name ~ 'valor' or column_name ~ 'moneda')),
  0, 'ninguna columna de costo, valor ni moneda'
);
select ok(
  pg_get_viewdef('analitica.inventario_productos_stock_cantidades'::regclass) !~ 'producto_costos',
  'la vista no lee dominio.producto_costos'
);
select is(
  (select estado from analitica.inventario_productos_stock_cantidades where sku = 'JOY-1'),
  'stock_bajo', 'estado con la regla de public.stock_estados (3 <= 5)'
);
select is(
  (select estado from analitica.inventario_productos_stock_cantidades where sku = 'AGO-1'),
  'sin_stock', 'cantidad 0 = sin_stock'
);
select is(
  (select count(*)::int from analitica.inventario_productos_stock_cantidades where sku = 'INA-1'),
  0, 'un producto inactivo no aparece'
);
select is(
  (select count(*)::int from analitica.inventario_productos_stock_cantidades where organizacion_id = '22222222-2222-2222-2222-222222222222'),
  1, 'cada fila lleva su organización (el rls del token las separa)'
);

-- ============================================================================
-- Superficie
-- ============================================================================

select ok(not has_table_privilege('anon', 'analitica.inventario_productos_stock_cantidades', 'SELECT'), 'anon no lee la vista de cantidades');
select ok(not has_table_privilege('authenticated', 'analitica.inventario_productos_stock_cantidades', 'SELECT'), 'authenticated no lee la vista de cantidades');
select ok(
  has_table_privilege('superset_analitica', 'analitica.inventario_productos_stock_cantidades', 'SELECT')
  and not has_table_privilege('superset_analitica', 'analitica.inventario_productos_stock_cantidades', 'INSERT,UPDATE,DELETE,TRUNCATE'),
  'el rol de Superset solo lee la vista de cantidades'
);
select is((select datasets_permitidos from public.reportes where id = 'f0000000-0000-0000-0000-0000000000a2'), '{}'::text[], 'datasets_permitidos (allowlist) nace vacía por defecto: sin allowlist no hay token');
select ok(not has_function_privilege('anon', 'private.cumple_accion_reporte(uuid)', 'EXECUTE'), 'anon no ejecuta el helper');
select ok(
  not has_function_privilege('anon', 'public.resolver_organizacion_reporte(uuid)', 'EXECUTE')
  and not has_function_privilege('anon', 'public.reportes_visibles_para_mi()', 'EXECUTE')
  and has_function_privilege('authenticated', 'public.resolver_organizacion_reporte(uuid)', 'EXECUTE')
  and has_function_privilege('authenticated', 'public.reportes_visibles_para_mi()', 'EXECUTE'),
  'las RPC de reportes: anon sin EXECUTE, authenticated con EXECUTE'
);

select * from finish();
rollback;
