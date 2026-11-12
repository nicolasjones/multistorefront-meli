-- MSF-161 · F-VTA-26 (MSF-257, spec 20261110-100000-ventas-avisos-de-faltantes): aviso a clientes desde
-- «Ventas · Faltantes».
-- Cubre `avisar_faltantes_venta` (FR-001, FR-003, FR-004, FR-005), el cierre de la cola (FR-007), el aviso
-- derivado de `listar_faltantes` (FR-008), el texto editable en `tomar_aviso_faltante` (soporte de FR-006) y
-- el aislamiento de las columnas nuevas (SC-003). Los faltantes se insertan como dueño (los escribe la RPC de
-- despacho, que no es lo que se prueba acá); las verificaciones corren como «authenticated», «anon» o
-- «service_role», igual que PostgREST.
begin;

select no_plan();

insert into organizaciones (id, nombre) values
  ('11111111-1111-1111-1111-111111111111', 'Organización Uno'),
  ('22222222-2222-2222-2222-222222222222', 'Organización Dos');

insert into auth.users (id, email) values
  ('f1000000-0000-0000-0000-000000000002', 'operador@example.com'),
  ('f1000000-0000-0000-0000-000000000003', 'consulta@example.com'),
  ('f1000000-0000-0000-0000-000000000004', 'mixto@example.com'),
  ('f2000000-0000-0000-0000-000000000001', 'admin-dos@example.com');

insert into usuarios_organizacion (user_id, organizacion_id, rol_id, estado) values
  ('f1000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'operador', 'activo'),
  ('f1000000-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111', 'consulta', 'activo'),
  ('f1000000-0000-0000-0000-000000000004', '11111111-1111-1111-1111-111111111111', 'operador', 'activo'),
  ('f2000000-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', 'administrador', 'activo');

insert into dominio.empresas (id, organizacion_id, nombre) values
  ('a1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'San Javucho'),
  ('a1000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'Sucursal Norte'),
  ('a2000000-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', 'Empresa Dos');

-- El operador trabaja en las dos tiendas; «mixto» edita en San Javucho pero solo consulta en Sucursal Norte.
insert into usuarios_empresas (user_id, empresa_id, organizacion_id, rol_id) values
  ('f1000000-0000-0000-0000-000000000002', 'a1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'operador'),
  ('f1000000-0000-0000-0000-000000000002', 'a1000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'operador'),
  ('f1000000-0000-0000-0000-000000000003', 'a1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'consulta'),
  ('f1000000-0000-0000-0000-000000000004', 'a1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'operador'),
  ('f1000000-0000-0000-0000-000000000004', 'a1000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'consulta'),
  ('f2000000-0000-0000-0000-000000000001', 'a2000000-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', 'administracion');

insert into public.usuario_empresa_activa (user_id, empresa_id) values
  ('f1000000-0000-0000-0000-000000000002', 'a1000000-0000-0000-0000-000000000001'),
  ('f1000000-0000-0000-0000-000000000003', 'a1000000-0000-0000-0000-000000000001'),
  ('f1000000-0000-0000-0000-000000000004', 'a1000000-0000-0000-0000-000000000001'),
  ('f2000000-0000-0000-0000-000000000001', 'a2000000-0000-0000-0000-000000000001');

-- Uno tiene correo; Sin Correo no.
insert into clientes (id, organizacion_id, numero, nombre, tipo, correo, archivado_en) values
  ('c5000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 10, 'Cliente Uno', 'minorista', 'uno@example.com', null),
  ('c5000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 11, 'Cliente Sin Correo', 'minorista', null, null),
  ('c5000000-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111', 12, 'Cliente Tres', 'minorista', 'tres@example.com', null);

insert into dominio.categorias (id, organizacion_id, nombre) values
  ('c1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'Consolas');

insert into dominio.productos (id, organizacion_id, nombre, sku, moneda, precio_lista, categoria_id, disponibilidad_manual, activo) values
  ('b1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'Joystick', 'JOY-1', 'ARS', 1000, 'c1000000-0000-0000-0000-000000000001', null, true),
  ('b1000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'Control', 'CTR-1', 'ARS', 500, 'c1000000-0000-0000-0000-000000000001', null, true);

create temp table datos as
  select (select id from dominio.depositos where organizacion_id = '11111111-1111-1111-1111-111111111111' and por_defecto) as principal;
grant select on datos to public;

insert into dominio.depositos_empresas (deposito_id, empresa_id, organizacion_id)
select principal, e.id, '11111111-1111-1111-1111-111111111111'
  from datos, (values ('a1000000-0000-0000-0000-000000000001'::uuid), ('a1000000-0000-0000-0000-000000000002'::uuid)) e(id)
on conflict do nothing;

insert into dominio.existencias (producto_id, organizacion_id, cantidad, reservado)
select p.id, '11111111-1111-1111-1111-111111111111', 100, 0
  from (values ('b1000000-0000-0000-0000-000000000001'::uuid), ('b1000000-0000-0000-0000-000000000002'::uuid)) p(id)
on conflict (producto_id) do update set cantidad = excluded.cantidad, reservado = 0;
insert into dominio.existencias_deposito (producto_id, deposito_id, organizacion_id, cantidad, reservado)
select p.id, principal, '11111111-1111-1111-1111-111111111111', 100, 0
  from datos, (values ('b1000000-0000-0000-0000-000000000001'::uuid), ('b1000000-0000-0000-0000-000000000002'::uuid)) p(id)
on conflict (producto_id, deposito_id) do update set cantidad = excluded.cantidad, reservado = 0;

create function pg_temp.como(p_user uuid) returns void language plpgsql as $$
begin
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
  set local role authenticated;
end $$;

-- Lectura directa con los privilegios del dueño.
create function pg_temp.q(p_sql text) returns text language plpgsql security definer as $$
declare v text;
begin
  execute p_sql into v;
  return v;
end $$;

create temp table comps (clave text primary key, id uuid, linea_id uuid);
grant select, insert, update on comps to public;

-- Una factura confirmada con una línea; `linea_id` es la fila de comprobantes_venta_lineas.
create function pg_temp.armar(p_clave text, p_empresa uuid, p_cliente uuid, p_producto uuid, p_cantidad integer) returns void language plpgsql as $$
declare v_c dominio.comprobantes_venta;
begin
  v_c := public.crear_comprobante('factura', p_empresa, p_cliente, 'mostrador', '2026-10-24');
  perform public.guardar_lineas_comprobante(v_c.id, jsonb_build_array(jsonb_build_object(
    'producto_id', p_producto, 'cantidad', p_cantidad, 'deposito_id', (select principal from datos))), v_c.updated_at);
  perform public.confirmar_comprobante(v_c.id);
  insert into comps (clave, id, linea_id)
    select p_clave, v_c.id, l.id from dominio.comprobantes_venta_lineas l where l.comprobante_id = v_c.id;
end $$;

select pg_temp.como('f1000000-0000-0000-0000-000000000002');

select pg_temp.armar('A1', 'a1000000-0000-0000-0000-000000000001', 'c5000000-0000-0000-0000-000000000001', 'b1000000-0000-0000-0000-000000000001', 4);
select pg_temp.armar('A2', 'a1000000-0000-0000-0000-000000000001', 'c5000000-0000-0000-0000-000000000001', 'b1000000-0000-0000-0000-000000000002', 2);
select pg_temp.armar('A3', 'a1000000-0000-0000-0000-000000000001', 'c5000000-0000-0000-0000-000000000002', 'b1000000-0000-0000-0000-000000000001', 1);
select pg_temp.armar('A4', 'a1000000-0000-0000-0000-000000000001', 'c5000000-0000-0000-0000-000000000003', 'b1000000-0000-0000-0000-000000000001', 3);
select pg_temp.armar('B1', 'a1000000-0000-0000-0000-000000000002', 'c5000000-0000-0000-0000-000000000001', 'b1000000-0000-0000-0000-000000000001', 1);

-- Faltantes abiertos (los inserta el dueño; el despacho los escribe con su propia RPC, ya probada).
reset role;
create temp table falt (clave text primary key, id uuid);
grant select on falt to public;
insert into falt (clave, id) select c.clave, gen_random_uuid() from comps c;
insert into dominio.faltantes_venta
  (id, organizacion_id, empresa_id, comprobante_id, linea_orden, producto_id, deposito_id, cantidad_faltante, creado_en)
select f.id, '11111111-1111-1111-1111-111111111111', cv.empresa_id, cv.id, l.orden, l.producto_id,
       (select principal from datos), case f.clave when 'A1' then 3 else 1 end,
       now() - (row_number() over (order by f.clave)) * interval '1 hour'
  from falt f
  join comps c on c.clave = f.clave
  join dominio.comprobantes_venta cv on cv.id = c.id
  join dominio.comprobantes_venta_lineas l on l.id = c.linea_id;

create function pg_temp.fid(p_clave text) returns uuid language sql as $$ select id from falt where clave = p_clave $$;
grant execute on function pg_temp.fid(text) to public;

select is((select count(*)::int from dominio.faltantes_venta), 5, 'hay cinco faltantes abiertos');

-- ============================================================================
-- Privilegios y firma (Principio VII)
-- ============================================================================

select is(has_function_privilege('anon', 'public.avisar_faltantes_venta(uuid[], text, boolean)', 'execute'), false, 'anon no ejecuta avisar_faltantes_venta');
select is(has_function_privilege('authenticated', 'public.avisar_faltantes_venta(uuid[], text, boolean)', 'execute'), true, 'authenticated ejecuta avisar_faltantes_venta');
select is(
  (select p.prosecdef and p.proconfig @> array['search_path=""'] from pg_proc p where p.oid = 'public.avisar_faltantes_venta(uuid[], text, boolean)'::regprocedure),
  true, 'avisar_faltantes_venta es security definer con search_path vacío');
select ok(
  not exists (select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
               where n.nspname = 'public' and c.relname in ('faltantes_avisos', 'faltantes_venta')),
  'no hay copias de las tablas en «public»');
select has_column('dominio', 'faltantes_avisos', 'mensaje', 'la cola tiene la columna mensaje');

-- ============================================================================
-- Permisos y validación (FR-004)
-- ============================================================================

select pg_temp.como('f1000000-0000-0000-0000-000000000003');
select throws_ok(
  format($$select public.avisar_faltantes_venta(array[%L]::uuid[], 'Hola')$$, pg_temp.fid('A1')),
  '42501', null, 'Consulta no puede avisar (42501)');

reset role;
select set_config('request.jwt.claims', '{}', true);
select throws_ok($$select public.avisar_faltantes_venta(array[gen_random_uuid()])$$, '42501', null, 'sin sesión: 42501');

reset role;
set local role anon;
select throws_ok($$select public.avisar_faltantes_venta(array[gen_random_uuid()])$$, '42501', null, 'anon no ejecuta (permiso denegado)');

select pg_temp.como('f1000000-0000-0000-0000-000000000002');
select throws_ok($$select public.avisar_faltantes_venta(null)$$, '22023', null, 'lista nula: 22023');
select throws_ok($$select public.avisar_faltantes_venta('{}')$$, '22023', null, 'lista vacía: 22023');
select throws_ok(
  $$select public.avisar_faltantes_venta(array(select gen_random_uuid() from generate_series(1, 201)))$$,
  '22023', null, 'más de 200 ids: 22023');
select throws_ok(
  format($$select public.avisar_faltantes_venta(array[%L]::uuid[], repeat('x', 1001))$$, pg_temp.fid('A1')),
  '22023', null, 'mensaje de más de 1.000 caracteres: 22023');
select is((select count(*)::int from dominio.faltantes_avisos), 0, 'las validaciones no dejan avisos');

-- ============================================================================
-- Aviso normal (FR-001): dos faltantes del mismo cliente = un cliente, dos líneas
-- ============================================================================

create temp table r1 (j jsonb);
grant select, insert on r1 to public;
insert into r1 select public.avisar_faltantes_venta(
  array[pg_temp.fid('A1'), pg_temp.fid('A2')], '  Ya llegaron tus productos  ');

select is((select (j ->> 'encolados')::int from r1), 1, 'un cliente con aviso nuevo');
select is((select (j ->> 'lineas_avisadas')::int from r1), 2, 'dos líneas avisadas');
select is((select count(*)::int from r1, jsonb_array_elements(j -> 'detalle') d where d ->> 'resultado' = 'encolado'), 2, 'el detalle marca las dos como encolado');
select is((select count(*)::int from dominio.faltantes_avisos where estado = 'pendiente' and mensaje = 'Ya llegaron tus productos'), 2,
  'quedan dos avisos pendientes con el texto recortado');
select is((select count(*)::int from public.listar_faltantes(null, 1, 50) where aviso = 'avisado' and aviso_en is not null), 2,
  'listar_faltantes los muestra «avisado» con fecha');
select is((select count(*)::int from public.listar_faltantes(null, 1, 50) where aviso = 'sin_avisar' and aviso_en is null), 3,
  'los otros tres siguen «sin_avisar»');
select is((select count(*)::int from public.registro_actividad where tipo = 'ventas.faltantes_avisados' and detalle !~ '@'), 1,
  'actividad ventas.faltantes_avisados sin correos');

-- En cola nunca se reenvía (ni con p_reavisar).
select is(
  (select (public.avisar_faltantes_venta(array[pg_temp.fid('A1')], 'Otro', true) ->> 'omitidos_en_cola')::int),
  1, 'un aviso en cola nunca se reenvía, ni con p_reavisar');
select is((select mensaje from dominio.faltantes_avisos where linea_id = (select linea_id from comps where clave = 'A1')),
  'Ya llegaron tus productos', 'y no se pisa su texto');

-- ============================================================================
-- Ya avisado (FR-003): se omite sin p_reavisar y se reinicia con él
-- ============================================================================

reset role;
update dominio.faltantes_avisos set estado = 'enviado', intentos = 1, enviado_en = '2026-11-10 10:00+00', created_at = '2026-11-10 09:00+00';
select pg_temp.como('f1000000-0000-0000-0000-000000000002');

select is(
  (select (public.avisar_faltantes_venta(array[pg_temp.fid('A1'), pg_temp.fid('A2')], 'Nuevo texto') ->> 'omitidos_ya_avisados')::int),
  2, 'ya avisados se omiten sin p_reavisar');
select is((select count(*)::int from dominio.faltantes_avisos where estado = 'enviado'), 2, 'siguen enviados');
select is((select aviso_en from public.listar_faltantes(null, 1, 50) where id = pg_temp.fid('A1')), '2026-11-10 10:00+00'::timestamptz,
  'avisado: la fecha es la de envío');

create temp table r2 (j jsonb);
grant select, insert on r2 to public;
insert into r2 select public.avisar_faltantes_venta(array[pg_temp.fid('A1'), pg_temp.fid('A2')], 'Nuevo texto', true);
select is((select (j ->> 'lineas_avisadas')::int from r2), 2, 'con p_reavisar vuelven a encolarse');
select is((select count(*)::int from dominio.faltantes_avisos where estado = 'pendiente' and intentos = 0 and enviado_en is null
             and ultimo_error is null and mensaje = 'Nuevo texto' and created_at > '2026-11-10 12:00+00'), 2,
  'la fila de la cola se reinicia con el texto nuevo');

-- ============================================================================
-- Sin correo (FR-005), tienda sin edición, otra organización, inexistente
-- ============================================================================

create temp table r3 (j jsonb);
grant select, insert on r3 to public;
insert into r3 select public.avisar_faltantes_venta(
  array[pg_temp.fid('A3'), pg_temp.fid('B1'), gen_random_uuid()], null);
select is((select (j ->> 'omitidos_sin_correo')::int from r3), 1, 'cliente sin correo: omitido');
select is((select count(*)::int from dominio.faltantes_avisos where linea_id = (select linea_id from comps where clave = 'A3')), 0,
  'y no se marca');
select is((select aviso from public.listar_faltantes(null, 1, 50) where id = pg_temp.fid('A3')), 'sin_avisar', 'sigue «sin_avisar»');
select is((select (j ->> 'omitidos_no_abiertos')::int from r3), 1, 'un id inexistente: no_abierto');
select is((select (j ->> 'encolados')::int from r3), 1, 'el operador edita en las dos tiendas: B1 se encola');

select pg_temp.como('f1000000-0000-0000-0000-000000000004');
create temp table r4 (j jsonb);
grant select, insert on r4 to public;
insert into r4 select public.avisar_faltantes_venta(array[pg_temp.fid('A4'), pg_temp.fid('B1')], null);
select is((select (j ->> 'omitidos_sin_permiso')::int from r4), 1, 'tienda donde solo consulta: sin_permiso');
select is((select (j ->> 'lineas_avisadas')::int from r4), 1, 'la de su tienda con edición sí se avisa');
select is((select d ->> 'resultado' from r4, jsonb_array_elements(j -> 'detalle') d where d ->> 'id' = pg_temp.fid('B1')::text),
  'sin_permiso', 'el permiso por tienda se evalúa antes que el estado de la cola');

-- Otra organización: no delata nada.
select pg_temp.como('f2000000-0000-0000-0000-000000000001');
select is(
  (select (public.avisar_faltantes_venta(array[pg_temp.fid('A1'), pg_temp.fid('A2')], 'Hola') ->> 'omitidos_no_abiertos')::int),
  2, 'faltantes de otra organización: no_abierto');
select is((select count(*)::int from dominio.faltantes_avisos), 0, 'la otra organización no ve la cola');
select is((select count(*)::int from public.listar_faltantes(null, 1, 50)), 0, 'ni el listado');

-- ============================================================================
-- Agotado se reencola siempre (sin p_reavisar)
-- ============================================================================

reset role;
update dominio.faltantes_avisos set estado = 'agotado', ultimo_error = 'x'
 where linea_id = (select linea_id from comps where clave = 'A2');
select pg_temp.como('f1000000-0000-0000-0000-000000000002');
select is(
  (select (public.avisar_faltantes_venta(array[pg_temp.fid('A2')], 'Reintento') ->> 'lineas_avisadas')::int),
  1, 'un aviso agotado se reencola sin p_reavisar');
select is((select count(*)::int from public.listar_faltantes(null, 1, 50, 'avisado')), 4, 'filtro avisado: A1, A2, A4 y B1');
select is((select count(*)::int from public.listar_faltantes(null, 1, 50, 'sin_avisar')), 1, 'filtro sin_avisar: solo A3');
select throws_ok($$select * from public.listar_faltantes(null, 1, 50, 'cualquiera')$$, '22023', null, 'p_aviso inválido: 22023');
select is(to_regprocedure('public.listar_faltantes(uuid, integer, integer)') is null, true, 'la firma vieja de tres parámetros ya no existe');
select is(has_function_privilege('anon', 'public.listar_faltantes(uuid, integer, integer, text)', 'execute'), false, 'anon no ejecuta listar_faltantes');
select is(has_function_privilege('authenticated', 'public.listar_faltantes(uuid, integer, integer, text)', 'execute'), true, 'authenticated ejecuta listar_faltantes');

-- ============================================================================
-- Cola de la función de envío (FR-006, FR-007): texto, cantidad faltante y faltante cerrado
-- ============================================================================

reset role;
-- Estado limpio de la cola para A1 (cantidad faltante 3 de 4 pedidas), A2 y A4.
delete from dominio.faltantes_avisos;
insert into dominio.faltantes_avisos (linea_id, organizacion_id, empresa_id, cliente_id, mensaje, created_at, updated_at)
select c.linea_id, '11111111-1111-1111-1111-111111111111', 'a1000000-0000-0000-0000-000000000001',
       'c5000000-0000-0000-0000-000000000001', m.mensaje, m.creado, m.creado
  from (values ('A1', 'Texto A', '2026-11-10 09:00+00'::timestamptz),
               ('A2', 'Texto B', '2026-11-10 09:05+00')) m(clave, mensaje, creado)
  join comps c on c.clave = m.clave;

set local role service_role;
create temp table t1 (cliente text, correo text, lineas jsonb);
grant select, insert on t1 to public;
insert into t1 select * from public.tomar_aviso_faltante('c5000000-0000-0000-0000-000000000001', 5);
select is((select count(*)::int from t1), 1, 'tomar devuelve un correo por cliente');
select is((select jsonb_array_length(lineas) from t1), 1, 'la tanda solo lleva las líneas con el mismo texto que la más antigua');
select is((select lineas -> 0 ->> 'mensaje' from t1), 'Texto A', 'cada línea lleva su mensaje');
select is((select (lineas -> 0 ->> 'cantidad')::int from t1), 3, 'la cantidad es la faltante (3), no la pedida (4)');
select is((select lineas -> 0 ->> 'producto' from t1), 'Joystick', 'y el producto');

-- La otra línea (otro texto) sale en el barrido siguiente, cuando se cierra la tanda y vence la reserva.
select is((select count(*)::int from public.tomar_aviso_faltante('c5000000-0000-0000-0000-000000000001', 5)), 0,
  'con un envío en vuelo no se abre otra tanda del cliente');
select public.cerrar_aviso_faltante('c5000000-0000-0000-0000-000000000001', true, null, 5);
select is(pg_temp.q($$select estado from dominio.faltantes_avisos where mensaje = 'Texto A'$$), 'enviado', 'la tanda se cierra como enviada');
select is(pg_temp.q($$select estado from dominio.faltantes_avisos where mensaje = 'Texto B'$$), 'pendiente', 'la otra línea sigue pendiente (intentos 0)');
create temp table t2 (cliente text, correo text, lineas jsonb);
grant select, insert on t2 to public;
insert into t2 select * from public.tomar_aviso_faltante('c5000000-0000-0000-0000-000000000001', 5);
select is((select lineas -> 0 ->> 'mensaje' from t2), 'Texto B', 'la segunda tanda lleva el otro texto');

-- Un faltante resuelto antes del envío no se manda y vuelve a «Sin avisar» con el motivo (FR-007).
reset role;
update dominio.faltantes_avisos set estado = 'pendiente', intentos = 0, enviado_en = null, updated_at = now()
 where mensaje in ('Texto A', 'Texto B');
update dominio.faltantes_venta set estado = 'resuelto', resuelto_en = now()
 where id = pg_temp.fid('A2');
set local role service_role;
create temp table t3 (cliente text, correo text, lineas jsonb);
grant select, insert on t3 to public;
insert into t3 select * from public.tomar_aviso_faltante('c5000000-0000-0000-0000-000000000001', 5);
select is((select jsonb_array_length(lineas) from t3), 1, 'solo se toma el faltante todavía abierto');
select is((select lineas -> 0 ->> 'mensaje' from t3), 'Texto A', 'el abierto es el de Texto A');
select is(pg_temp.q($$select estado || '|' || ultimo_error from dominio.faltantes_avisos where mensaje = 'Texto B'$$),
  'agotado|El faltante se cerró antes de enviar el aviso', 'el resuelto vuelve a «Sin avisar» con el motivo');
select public.cerrar_aviso_faltante('c5000000-0000-0000-0000-000000000001', false, 'fallo', 5);

-- Sin mensaje: el aviso de F-STK-17 no cambia (mensaje nulo).
reset role;
delete from dominio.faltantes_avisos;
insert into dominio.faltantes_avisos (linea_id, organizacion_id, empresa_id, cliente_id)
select c.linea_id, '11111111-1111-1111-1111-111111111111', 'a1000000-0000-0000-0000-000000000001',
       'c5000000-0000-0000-0000-000000000003'
  from comps c where c.clave = 'A4';
set local role service_role;
select is((select (lineas -> 0 -> 'mensaje') = 'null'::jsonb from public.tomar_aviso_faltante('c5000000-0000-0000-0000-000000000003', 5)),
  true, 'sin texto editado, mensaje es null (texto por defecto)');

-- ============================================================================
-- RLS y anon (SC-003)
-- ============================================================================

reset role;
set local role anon;
select throws_ok($$select mensaje from dominio.faltantes_avisos$$, '42501', null, 'anon no lee la cola ni la columna mensaje');
select pg_temp.como('f1000000-0000-0000-0000-000000000003');
select is((select count(*)::int from dominio.faltantes_avisos), 1, 'quien tiene Ventas en lectura ve la cola de su organización');
select throws_ok($$update dominio.faltantes_avisos set mensaje = 'x'$$, '42501', null, 'y no la modifica');
select pg_temp.como('f2000000-0000-0000-0000-000000000001');
select is((select count(*)::int from dominio.faltantes_avisos), 0, 'otra organización no ve la cola');

select * from finish();
rollback;
