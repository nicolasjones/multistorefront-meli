-- MSF-394 · F-STK-09 (épica MSF-368, SC-201/SC-202): resumen de reposición por correo.
-- Cubre FR-201 (solo productos nuevos en alerta; sin novedades no genera nada), FR-202 (empeorar, salir y
-- volver avisa de nuevo; mejorar o repetir no), FR-204 (destinatarios; sin destinatarios no marca),
-- FR-206 (una entrega fallida no marca; el reintento reutiliza el resumen y no pierde productos;
-- reserva con vencimiento), FR-207 (registro con estado, intentos y error sanitizado) y FR-208
-- (RLS por organización y sección `stock`, sin escritura de la app, RPC solo de service_role, `anon` sin
-- acceso). El fixture corre como postgres (RLS no aplica); las verificaciones, como «authenticated»,
-- «anon» o «service_role», igual que PostgREST.
begin;

select plan(69);

insert into organizaciones (id, nombre) values
  ('11111111-1111-1111-1111-111111111111', 'Organización Uno'),
  ('22222222-2222-2222-2222-222222222222', 'Organización Dos'),
  ('33333333-3333-3333-3333-333333333333', 'Organización Tres');

insert into auth.users (id, email) values
  ('f1000000-0000-0000-0000-000000000001', 'Admin-Uno@example.com'),
  ('f1000000-0000-0000-0000-000000000002', 'consulta-uno@example.com'),
  ('f1000000-0000-0000-0000-000000000003', 'suspendido-uno@example.com'),
  ('f2000000-0000-0000-0000-000000000001', 'admin-dos@example.com');

insert into usuarios_organizacion (user_id, organizacion_id, rol_id, estado) values
  ('f1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'administrador', 'activo'),
  ('f1000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'consulta', 'activo'),
  ('f1000000-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111', 'administrador', 'suspendido'),
  ('f2000000-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', 'administrador', 'activo');

-- Org 1: A sin stock, B bajo el mínimo, C normal, I inactivo sin stock. Org 2: E sin stock. Org 3 (sin
-- miembros): F sin stock.
insert into dominio.productos (id, organizacion_id, nombre, sku, precio_lista) values
  ('a1000000-0000-0000-0000-00000000000a', '11111111-1111-1111-1111-111111111111', 'Zapato', 'P-A', 10),
  ('a1000000-0000-0000-0000-00000000000b', '11111111-1111-1111-1111-111111111111', 'Aro', 'P-B', 10),
  ('a1000000-0000-0000-0000-00000000000c', '11111111-1111-1111-1111-111111111111', 'Cinto', 'P-C', 10),
  ('a1000000-0000-0000-0000-00000000000d', '11111111-1111-1111-1111-111111111111', 'Inactivo', 'P-I', 10),
  ('a2000000-0000-0000-0000-00000000000e', '22222222-2222-2222-2222-222222222222', 'Producto Dos', 'P-E', 10),
  ('a3000000-0000-0000-0000-00000000000f', '33333333-3333-3333-3333-333333333333', 'Producto Tres', 'P-F', 10);

update dominio.productos set activo = false where id = 'a1000000-0000-0000-0000-00000000000d';
update dominio.existencias set cantidad = 0, minimo = 5 where producto_id = 'a1000000-0000-0000-0000-00000000000a';
update dominio.existencias set cantidad = 2, minimo = 5 where producto_id = 'a1000000-0000-0000-0000-00000000000b';
update dominio.existencias set cantidad = 10, minimo = 5 where producto_id = 'a1000000-0000-0000-0000-00000000000c';
update dominio.existencias set cantidad = 0, minimo = 5 where producto_id = 'a1000000-0000-0000-0000-00000000000d';
update dominio.existencias set cantidad = 0, minimo = 5 where producto_id = 'a2000000-0000-0000-0000-00000000000e';
update dominio.existencias set cantidad = 0, minimo = 5 where producto_id = 'a3000000-0000-0000-0000-00000000000f';

create function pg_temp.como(p_user uuid) returns void language plpgsql as $$
begin
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
  set local role authenticated;
end $$;

-- ============================================================================
-- Esquema (Principio VII) y privilegios (FR-208)
-- ============================================================================

select ok(
  exists (select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
           where n.nspname = 'dominio' and c.relname = 'stock_avisos_reposicion' and c.relrowsecurity),
  'stock_avisos_reposicion vive en «dominio» y tiene RLS activada'
);
select ok(
  exists (select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
           where n.nspname = 'dominio' and c.relname = 'stock_alertas_avisadas' and c.relrowsecurity),
  'stock_alertas_avisadas vive en «dominio» y tiene RLS activada'
);
select is(has_table_privilege('anon', 'dominio.stock_avisos_reposicion', 'select'), false, 'anon no lee el registro de resúmenes');
select is(has_table_privilege('anon', 'dominio.stock_alertas_avisadas', 'select'), false, 'anon no lee las marcas');
select is(
  has_table_privilege('authenticated', 'dominio.stock_avisos_reposicion', 'insert')
    or has_table_privilege('authenticated', 'dominio.stock_avisos_reposicion', 'update')
    or has_table_privilege('authenticated', 'dominio.stock_avisos_reposicion', 'delete'),
  false, 'authenticated no escribe el registro de resúmenes'
);
select is(
  has_table_privilege('authenticated', 'dominio.stock_alertas_avisadas', 'insert')
    or has_table_privilege('authenticated', 'dominio.stock_alertas_avisadas', 'update')
    or has_table_privilege('authenticated', 'dominio.stock_alertas_avisadas', 'delete'),
  false, 'authenticated no escribe las marcas'
);
select is(
  (select count(*)::int from unnest(array[
    'public.generar_resumen_reposicion(uuid, integer)',
    'public.cerrar_resumen_reposicion(uuid, boolean, text)',
    'public.organizaciones_con_resumen_pendiente()'
  ]) f where has_function_privilege('anon', f, 'execute')),
  0, 'anon no ejecuta ninguna RPC del resumen'
);
select is(
  (select count(*)::int from unnest(array[
    'public.generar_resumen_reposicion(uuid, integer)',
    'public.cerrar_resumen_reposicion(uuid, boolean, text)',
    'public.organizaciones_con_resumen_pendiente()'
  ]) f where has_function_privilege('authenticated', f, 'execute')),
  0, 'authenticated tampoco: son solo de service_role'
);
select is(
  (select count(*)::int from unnest(array[
    'public.generar_resumen_reposicion(uuid, integer)',
    'public.cerrar_resumen_reposicion(uuid, boolean, text)',
    'public.organizaciones_con_resumen_pendiente()'
  ]) f where has_function_privilege('service_role', f, 'execute')),
  3, 'service_role ejecuta las tres'
);

select pg_temp.como('f1000000-0000-0000-0000-000000000001');
select throws_ok(
  $$select * from public.generar_resumen_reposicion('11111111-1111-1111-1111-111111111111')$$,
  '42501', null, 'un administrador autenticado no puede generar el resumen'
);
select throws_ok(
  $$select public.organizaciones_con_resumen_pendiente()$$,
  '42501', null, 'ni listar las organizaciones pendientes'
);
reset role;

-- ============================================================================
-- Qué organizaciones hay que barrer
-- ============================================================================

set local role service_role;
select is(
  public.organizaciones_con_resumen_pendiente(),
  array['11111111-1111-1111-1111-111111111111', '22222222-2222-2222-2222-222222222222', '33333333-3333-3333-3333-333333333333']::uuid[],
  'el barrido incluye las tres organizaciones con productos en alerta'
);

-- ============================================================================
-- FR-201 / FR-203 / FR-204: contenido y destinatarios del primer resumen
-- ============================================================================

create temp table g1 as select * from public.generar_resumen_reposicion('11111111-1111-1111-1111-111111111111');
select is((select count(*)::int from g1), 1, 'se genera un resumen para la organización 1');
select is((select sin_stock from g1), 1, 'cuenta 1 producto sin stock');
select is((select stock_bajo from g1), 1, 'cuenta 1 producto con stock bajo');
select is(
  (select array_agg(p ->> 'nombre' order by ord) from g1, jsonb_array_elements(productos) with ordinality as t(p, ord)),
  array['Zapato', 'Aro'], '«Sin stock» primero y el producto normal y el inactivo no están'
);
select is(
  (select p ->> 'sku' || '|' || (p ->> 'cantidad') || '|' || (p ->> 'disponible') || '|' || (p ->> 'minimo') || '|' || (p ->> 'estado')
     from g1, jsonb_array_elements(productos) p where p ->> 'producto_id' = 'a1000000-0000-0000-0000-00000000000b'),
  'P-B|2|2|5|stock_bajo', 'cada producto trae SKU, stock, disponible, mínimo y estado'
);
select is(
  (select destinatarios from g1), array['admin-uno@example.com'],
  'destinatarios: solo miembros activos con edición en Stock (sin lectura, sin suspendidos, sin otras organizaciones)'
);

reset role;

-- FR-207: queda registrado
select is(
  (select estado || '|' || intentos from dominio.stock_avisos_reposicion where id = (select resumen_id from g1)),
  'pendiente|1', 'el resumen queda registrado como pendiente con 1 intento'
);
select is((select count(*)::int from dominio.stock_alertas_avisadas), 0, 'generar no marca ningún producto (solo el envío exitoso marca)');

set local role service_role;
select is(
  (select count(*)::int from public.generar_resumen_reposicion('11111111-1111-1111-1111-111111111111')), 0,
  'mientras está reservado, otro barrido no genera el mismo resumen'
);

-- ============================================================================
-- FR-206: una entrega fallida no marca; el reintento reutiliza el resumen y no pierde productos
-- ============================================================================

select is(
  public.cerrar_resumen_reposicion((select resumen_id from g1), false, E'smtp\n   caído  en prueba'),
  'fallido', 'cerrar con fallo devuelve «fallido»'
);
reset role;
select is(
  (select estado || '|' || ultimo_error from dominio.stock_avisos_reposicion where id = (select resumen_id from g1)),
  'fallido|smtp caído en prueba', 'el error queda registrado y sanitizado (una sola línea)'
);
select is((select count(*)::int from dominio.stock_alertas_avisadas), 0, 'una entrega fallida no marca productos');

set local role service_role;
create temp table g2 as select * from public.generar_resumen_reposicion('11111111-1111-1111-1111-111111111111');
select is((select resumen_id from g2), (select resumen_id from g1), 'el reintento reutiliza el mismo resumen (no duplica registros)');
select is((select sin_stock + stock_bajo from g2), 2, 'el reintento vuelve a incluir los mismos productos');
reset role;
select is(
  (select intentos from dominio.stock_avisos_reposicion where id = (select resumen_id from g1)), 2,
  'el reintento suma un intento'
);
select is(
  (select count(*)::int from dominio.stock_avisos_reposicion where organizacion_id = '11111111-1111-1111-1111-111111111111'), 1,
  'hay un solo registro para la organización 1'
);

-- Reserva con vencimiento: un pendiente cuyo proceso murió se retoma pasados los 2 minutos.
update dominio.stock_avisos_reposicion set updated_at = now() - interval '3 minutes'
 where id = (select resumen_id from g1);
set local role service_role;
select ok(
  '11111111-1111-1111-1111-111111111111'::uuid = any (public.organizaciones_con_resumen_pendiente()),
  'con la reserva vencida, la organización vuelve al barrido'
);
create temp table g3 as select * from public.generar_resumen_reposicion('11111111-1111-1111-1111-111111111111');
select is((select resumen_id from g3), (select resumen_id from g1), 'la reserva vencida se retoma sobre el mismo resumen');
reset role;
select is((select intentos from dominio.stock_avisos_reposicion where id = (select resumen_id from g1)), 3, 'y cuenta otro intento');

-- ============================================================================
-- Entrega exitosa: marca los productos; un cierre repetido no pisa el estado
-- ============================================================================

set local role service_role;
select is(public.cerrar_resumen_reposicion((select resumen_id from g1), true, null), 'enviado', 'cerrar con éxito devuelve «enviado»');
select is(public.cerrar_resumen_reposicion((select resumen_id from g1), false, 'tarde'), null, 'un cierre repetido no pisa un «enviado»');
reset role;
select is(
  (select estado || '|' || coalesce(ultimo_error, '-') || '|' || (enviado_en is not null)
     from dominio.stock_avisos_reposicion where id = (select resumen_id from g1)),
  'enviado|-|true', 'el resumen queda enviado, sin error y con fecha de envío'
);
select is(
  (select string_agg(producto_id::text || ':' || estado_avisado, ',' order by producto_id) from dominio.stock_alertas_avisadas),
  'a1000000-0000-0000-0000-00000000000a:sin_stock,a1000000-0000-0000-0000-00000000000b:stock_bajo',
  'se marcaron exactamente los dos productos avisados, con su estado'
);

-- ============================================================================
-- FR-201 / FR-202: segunda corrida sin cambios, empeorar, mejorar, salir y volver
-- ============================================================================

set local role service_role;
select is(
  (select count(*)::int from public.generar_resumen_reposicion('11111111-1111-1111-1111-111111111111')), 0,
  'segunda corrida sin cambios: no genera nada'
);
reset role;
select is(
  (select count(*)::int from dominio.stock_avisos_reposicion where organizacion_id = '11111111-1111-1111-1111-111111111111'), 1,
  'y no deja otro registro'
);

-- Empeora: B pasa de stock_bajo a sin_stock.
update dominio.existencias set cantidad = 0 where producto_id = 'a1000000-0000-0000-0000-00000000000b';
set local role service_role;
create temp table g4 as select * from public.generar_resumen_reposicion('11111111-1111-1111-1111-111111111111');
select is(
  (select array_agg(p ->> 'nombre') from g4, jsonb_array_elements(productos) p), array['Aro'],
  'un producto que empeora (stock bajo → sin stock) vuelve a avisarse, solo él'
);
select is((select sin_stock || '|' || stock_bajo from g4), '1|0', 'con los totales correctos');
select is(public.cerrar_resumen_reposicion((select resumen_id from g4), true, null), 'enviado', 'se cierra con éxito');
reset role;
select is(
  (select estado_avisado from dominio.stock_alertas_avisadas where producto_id = 'a1000000-0000-0000-0000-00000000000b'),
  'sin_stock', 'la marca de B pasó a sin_stock'
);

-- Mejora sin salir de la alerta (sin_stock → stock_bajo): no se vuelve a avisar.
update dominio.existencias set cantidad = 2 where producto_id = 'a1000000-0000-0000-0000-00000000000b';
set local role service_role;
select is(
  (select count(*)::int from public.generar_resumen_reposicion('11111111-1111-1111-1111-111111111111')), 0,
  'mejorar sin salir de la alerta no avisa de nuevo'
);
reset role;
select is(
  (select count(*)::int from dominio.stock_alertas_avisadas where producto_id = 'a1000000-0000-0000-0000-00000000000b'), 1,
  'y conserva la marca'
);

-- Sale de la alerta: pierde la marca. Vuelve a entrar: avisa de nuevo.
update dominio.existencias set cantidad = 10 where producto_id = 'a1000000-0000-0000-0000-00000000000a';
set local role service_role;
select is(
  (select count(*)::int from public.generar_resumen_reposicion('11111111-1111-1111-1111-111111111111')), 0,
  'un producto que vuelve a «disponible» no genera resumen'
);
reset role;
select is(
  (select count(*)::int from dominio.stock_alertas_avisadas where producto_id = 'a1000000-0000-0000-0000-00000000000a'), 0,
  'pero pierde su marca'
);
update dominio.existencias set cantidad = 0 where producto_id = 'a1000000-0000-0000-0000-00000000000a';
set local role service_role;
create temp table g5 as select * from public.generar_resumen_reposicion('11111111-1111-1111-1111-111111111111');
select is(
  (select array_agg(p ->> 'nombre') from g5, jsonb_array_elements(productos) p), array['Zapato'],
  'al volver a entrar en alerta, se avisa de nuevo'
);
select is(public.cerrar_resumen_reposicion((select resumen_id from g5), true, null), 'enviado', 'se cierra con éxito');
reset role;
select is(
  (select count(*)::int from dominio.stock_avisos_reposicion where organizacion_id = '11111111-1111-1111-1111-111111111111'), 3,
  'cada resumen distinto quedó registrado (3 en total)'
);

-- Un producto desactivado deja de contar y pierde la marca.
update dominio.productos set activo = false where id = 'a1000000-0000-0000-0000-00000000000b';
set local role service_role;
select is(
  (select count(*)::int from public.generar_resumen_reposicion('11111111-1111-1111-1111-111111111111')), 0,
  'un producto desactivado no entra en el resumen'
);
reset role;
select is(
  (select count(*)::int from dominio.stock_alertas_avisadas where producto_id = 'a1000000-0000-0000-0000-00000000000b'), 0,
  'y se limpia su marca'
);

-- ============================================================================
-- FR-204: sin destinatarios queda registrado y no marca
-- ============================================================================

set local role service_role;
create temp table g6 as select * from public.generar_resumen_reposicion('33333333-3333-3333-3333-333333333333');
select is((select count(*)::int from g6), 1, 'la organización sin miembros igual genera su registro');
select is((select coalesce(array_length(destinatarios, 1), 0) from g6), 0, 'pero sin destinatarios');
select is(public.cerrar_resumen_reposicion((select resumen_id from g6), true, null), null, 'no se puede cerrar como enviado un resumen «sin destinatario»');
reset role;
select is(
  (select estado || '|' || intentos from dominio.stock_avisos_reposicion where id = (select resumen_id from g6)),
  'sin_destinatario|0', 'queda «sin destinatario», sin intentos'
);
select is((select count(*)::int from dominio.stock_alertas_avisadas where organizacion_id = '33333333-3333-3333-3333-333333333333'), 0,
  'y no marca productos');

-- Cuando aparece un destinatario, el mismo registro se retoma.
insert into auth.users (id, email) values ('f3000000-0000-0000-0000-000000000001', 'admin-tres@example.com');
insert into usuarios_organizacion (user_id, organizacion_id, rol_id, estado) values
  ('f3000000-0000-0000-0000-000000000001', '33333333-3333-3333-3333-333333333333', 'administrador', 'activo');
set local role service_role;
create temp table g7 as select * from public.generar_resumen_reposicion('33333333-3333-3333-3333-333333333333');
select is((select resumen_id from g7), (select resumen_id from g6), 'con un destinatario nuevo se retoma el mismo registro');
select is((select destinatarios from g7), array['admin-tres@example.com'], 'y ya tiene a quién enviar');
reset role;

-- ============================================================================
-- FR-208: RLS por organización y sección Stock
-- ============================================================================

set local role service_role;
create temp table g8 as select * from public.generar_resumen_reposicion('22222222-2222-2222-2222-222222222222');
reset role;
select is((select count(*)::int from g8), 1, 'la organización 2 tiene su propio resumen pendiente');

select pg_temp.como('f1000000-0000-0000-0000-000000000002');
select is(
  (select count(*)::int from dominio.stock_avisos_reposicion), 3,
  'lectura en Stock ve los resúmenes de su organización (y ninguno de otra)'
);
select is(
  (select count(*)::int from dominio.stock_avisos_reposicion where organizacion_id <> '11111111-1111-1111-1111-111111111111'), 0,
  'ninguna fila de otra organización'
);
select is((select count(*)::int from dominio.stock_alertas_avisadas), 1, 'y sus marcas (queda la de Zapato)');
select throws_ok(
  $$insert into dominio.stock_avisos_reposicion (organizacion_id) values ('11111111-1111-1111-1111-111111111111')$$,
  '42501', null, 'la app no inserta resúmenes'
);
select throws_ok(
  $$delete from dominio.stock_alertas_avisadas$$,
  '42501', null, 'la app no borra marcas'
);
reset role;

select pg_temp.como('f2000000-0000-0000-0000-000000000001');
select is(
  (select count(*)::int from dominio.stock_avisos_reposicion where organizacion_id = '11111111-1111-1111-1111-111111111111'), 0,
  'la organización 2 no ve los resúmenes de la 1'
);
select is((select count(*)::int from dominio.stock_avisos_reposicion), 1, 'solo ve el suyo');
reset role;

-- Una sección Stock sin acceso no ve nada.
insert into public.permisos_rol (organizacion_id, rol_id, seccion, nivel) values
  ('11111111-1111-1111-1111-111111111111', 'consulta', 'stock', 'ninguno')
on conflict (organizacion_id, rol_id, seccion) do update set nivel = 'ninguno';
select pg_temp.como('f1000000-0000-0000-0000-000000000002');
select is((select count(*)::int from dominio.stock_avisos_reposicion), 0, 'sin acceso a Stock no se ve el registro');
select is((select count(*)::int from dominio.stock_alertas_avisadas), 0, 'ni las marcas');
reset role;

set local role anon;
select throws_ok(
  $$select count(*) from dominio.stock_avisos_reposicion$$,
  '42501', null, 'anon no lee el registro'
);
select throws_ok(
  $$select * from public.generar_resumen_reposicion('11111111-1111-1111-1111-111111111111')$$,
  '42501', null, 'anon no ejecuta la RPC'
);
reset role;

select * from finish();
rollback;
