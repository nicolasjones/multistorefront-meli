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

-- Cuántos bloqueos advisory de ESTA sesión llevan la clave de la organización (hashtextextended(org, 161)): el tope diario
-- se evalúa bajo ese bloqueo. Sin `pg_advisory_xact_lock` en `encolar_aviso_faltante` la cuenta queda en 0.
create function pg_temp.bloqueos_org(p_org uuid) returns bigint language sql security definer as $$
  select count(*) from pg_locks
   where locktype = 'advisory' and pid = pg_backend_pid()
     -- La clave bigint (con signo) se reparte en classid (32 bits altos) y objid (32 bits bajos), ambos oid SIN signo: se compara
     -- por partes enmascaradas (un hash negativo no coincidiría con `(classid << 32) | objid`, que desborda).
     and objsubid = 1
     and classid::bigint = ((hashtextextended(p_org::text, 161) >> 32) & 4294967295)
     and objid::bigint = (hashtextextended(p_org::text, 161) & 4294967295)
$$;
grant execute on function pg_temp.bloqueos_org(uuid) to public;
select is(pg_temp.bloqueos_org('11111111-1111-1111-1111-111111111111'), 0::bigint, 'antes de encolar la sesión no tiene el bloqueo de la organización');

create temp table r1 (j jsonb);
grant select, insert on r1 to public;
insert into r1 select public.avisar_faltantes_venta(
  array[pg_temp.fid('A1'), pg_temp.fid('A2')], '  Ya llegaron tus productos  ');

select is(pg_temp.bloqueos_org('11111111-1111-1111-1111-111111111111'), 1::bigint,
  'encolar tomó el bloqueo advisory de la organización (M-1 del PR #915; falla si se quita pg_advisory_xact_lock)');
select is(pg_temp.bloqueos_org('22222222-2222-2222-2222-222222222222'), 0::bigint, 'y no el de otra organización');
-- Control positivo: el helper SÍ detecta la clave de la Organización Dos (hash negativo) cuando alguien la toma; sin esto la
-- aserción anterior podría pasar siempre (PR #920 m-4).
select pg_advisory_xact_lock(hashtextextended('22222222-2222-2222-2222-222222222222'::text, 161));
select is(pg_temp.bloqueos_org('22222222-2222-2222-2222-222222222222'), 1::bigint, 'el helper detecta el bloqueo de la Organización Dos (clave con signo negativo) si se toma');
select is((select (j ->> 'encolados')::int from r1), 1, 'un cliente con aviso nuevo');
select is((select (j ->> 'lineas_avisadas')::int from r1), 2, 'dos líneas avisadas');
select is((select count(*)::int from r1, jsonb_array_elements(j -> 'detalle') d where d ->> 'resultado' = 'encolado'), 2, 'el detalle marca las dos como encolado');
select is((select count(*)::int from dominio.faltantes_avisos where estado = 'pendiente' and mensaje = 'Ya llegaron tus productos'), 2,
  'quedan dos avisos pendientes con el texto recortado');
select is((select count(*)::int from public.listar_faltantes(null, 1, 50) where aviso = 'en_cola' and aviso_en is not null), 2,
  'listar_faltantes los muestra «en_cola» con fecha (todavía no «avisado»: el correo no salió)');
select is((select count(*)::int from public.listar_faltantes(null, 1, 50) where aviso = 'avisado'), 0,
  'ninguno figura «avisado» mientras el envío no se cierra');
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
update dominio.faltantes_avisos set estado = 'agotado', ultimo_error = 'otro'
 where linea_id = (select linea_id from comps where clave = 'A2');
select pg_temp.como('f1000000-0000-0000-0000-000000000002');
select is(
  (select (public.avisar_faltantes_venta(array[pg_temp.fid('A2')], 'Reintento') ->> 'lineas_avisadas')::int),
  1, 'un aviso agotado se reencola sin p_reavisar');
select is((select count(*)::int from public.listar_faltantes(null, 1, 50, 'avisado'))
        + (select count(*)::int from public.listar_faltantes(null, 1, 50, 'en_cola')), 4, 'filtros avisado + en_cola: A1, A2, A4 y B1');
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
create temp table t1 (cliente text, correo text, lineas jsonb, tanda uuid);
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
create temp table t2 (cliente text, correo text, lineas jsonb, tanda uuid);
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
create temp table t3 (cliente text, correo text, lineas jsonb, tanda uuid);
grant select, insert on t3 to public;
insert into t3 select * from public.tomar_aviso_faltante('c5000000-0000-0000-0000-000000000001', 5);
select is((select jsonb_array_length(lineas) from t3), 1, 'solo se toma el faltante todavía abierto');
select is((select lineas -> 0 ->> 'mensaje' from t3), 'Texto A', 'el abierto es el de Texto A');
select is(pg_temp.q($$select estado || '|' || ultimo_error from dominio.faltantes_avisos where mensaje = 'Texto B'$$),
  'agotado|faltante_cerrado', 'el resuelto vuelve a «Sin avisar» con el motivo');
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
-- Hallazgos de la revisión (MSF-161): token de tanda, topes, saneo, códigos de error, aviso fallido
-- ============================================================================

reset role;
delete from dominio.faltantes_avisos;
insert into dominio.faltantes_avisos (linea_id, organizacion_id, empresa_id, cliente_id, mensaje, created_at, updated_at)
select c.linea_id, '11111111-1111-1111-1111-111111111111', 'a1000000-0000-0000-0000-000000000001',
       'c5000000-0000-0000-0000-000000000001', 'Texto A', now(), now()
  from comps c where c.clave = 'A1';

-- M-2: cierre tardío con la reserva vencida. La tanda 1 se toma; vence la reserva (2 min) y se toma la tanda 2;
-- el cierre de la tanda 1 llega tarde y NO toca las líneas de la tanda 2.
set local role service_role;
create temp table t4 (cliente text, correo text, lineas jsonb, tanda uuid);
create temp table t5 (cliente text, correo text, lineas jsonb, tanda uuid);
grant select, insert on t4, t5 to public;
insert into t4 select * from public.tomar_aviso_faltante('c5000000-0000-0000-0000-000000000001', 5);
select isnt((select tanda from t4), null, 'tomar devuelve el token de la tanda');
reset role;
update dominio.faltantes_avisos set updated_at = now() - interval '3 minutes';
set local role service_role;
insert into t5 select * from public.tomar_aviso_faltante('c5000000-0000-0000-0000-000000000001', 5);
select is((select count(*)::int from t5), 1, 'vencida la reserva, otra invocación retoma el aviso');
select isnt((select tanda from t5), (select tanda from t4), 'y le da una tanda nueva');
select public.cerrar_aviso_faltante('c5000000-0000-0000-0000-000000000001', true, null, 5, (select tanda from t4));
select is(pg_temp.q($$select estado from dominio.faltantes_avisos$$), 'pendiente', 'el cierre tardío (tanda vieja) no cierra la tanda nueva como enviada');
select public.cerrar_aviso_faltante('c5000000-0000-0000-0000-000000000001', false, 'smtp_auth', 5, (select tanda from t4));
select is(pg_temp.q($$select coalesce(ultimo_error, 'nulo') from dominio.faltantes_avisos$$), 'nulo', 'ni le pisa el error');

-- m-4b: el error guardado es un código; lo que no es un código conocido queda como «otro» (el detalle no entra).
select public.cerrar_aviso_faltante('c5000000-0000-0000-0000-000000000001', false, '535 Authentication failed for user smtp-prod@host', 5, (select tanda from t5));
select is(pg_temp.q($$select ultimo_error from dominio.faltantes_avisos$$), 'otro', 'un error con detalle técnico se guarda como «otro»');
select public.cerrar_aviso_faltante('c5000000-0000-0000-0000-000000000001', false, 'smtp_auth', 5, (select tanda from t5));
select is(pg_temp.q($$select ultimo_error from dominio.faltantes_avisos$$), 'smtp_auth', 'un código conocido se guarda tal cual');
select public.cerrar_aviso_faltante('c5000000-0000-0000-0000-000000000001', true, null, 5, (select tanda from t5));
select is(pg_temp.q($$select estado from dominio.faltantes_avisos$$), 'enviado', 'el cierre de la tanda vigente sí cierra');

-- QA M1 / M-1: un aviso agotado no cambia la fila (sigue «Para avisar» si llegó mercadería) y expone el error.
reset role;
update dominio.faltantes_venta set para_avisar_en = now() where id = pg_temp.fid('A1');
update dominio.faltantes_avisos set estado = 'agotado', ultimo_error = 'smtp_conexion';
select pg_temp.como('f1000000-0000-0000-0000-000000000002');
select is((select aviso || '|' || aviso_error from public.listar_faltantes(null, 1, 50) where id = pg_temp.fid('A1')),
  'para_avisar|smtp_conexion', 'agotado con ingreso cubierto: sigue «Para avisar» y trae el error del aviso fallido');
reset role;
update dominio.faltantes_venta set para_avisar_en = null where id = pg_temp.fid('A1');
select pg_temp.como('f1000000-0000-0000-0000-000000000002');
select is((select aviso || '|' || aviso_error from public.listar_faltantes(null, 1, 50) where id = pg_temp.fid('A1')),
  'sin_avisar|smtp_conexion', 'agotado sin ingreso: «Sin avisar» con el error');
select is((select count(*)::int from public.listar_faltantes(null, 1, 50) where aviso_error is not null), 1, 'solo el fallido trae aviso_error');
select is((select count(*)::int from public.listar_faltantes(null, 1, 50, 'en_cola')), 0, 'el filtro en_cola no incluye al agotado');

-- M-3: no se reavisa un faltante enviado hace menos de 24 horas, ni con p_reavisar.
reset role;
update dominio.faltantes_avisos set estado = 'enviado', intentos = 1, ultimo_error = null, enviado_en = now() - interval '1 hour';
select pg_temp.como('f1000000-0000-0000-0000-000000000002');
select is((select (public.avisar_faltantes_venta(array[pg_temp.fid('A1')], 'Otra vez', true) ->> 'omitidos_reaviso_reciente')::int), 1,
  'enviado hace 1 hora: no se reavisa (reaviso_reciente)');
select is(pg_temp.q($$select estado from dominio.faltantes_avisos$$), 'enviado', 'y la cola no se toca');
reset role;
update dominio.faltantes_avisos set enviado_en = now() - interval '25 hours';
select pg_temp.como('f1000000-0000-0000-0000-000000000002');
select is((select (public.avisar_faltantes_venta(array[pg_temp.fid('A1')], 'Otra vez', true) ->> 'lineas_avisadas')::int), 1,
  'enviado hace más de 24 horas y con p_reavisar: se reavisa');

-- M-3: tope diario por organización (1.000 líneas en 24 horas). Las filas de relleno no cuelgan de líneas reales:
-- se insertan sin los disparadores de FK solo para este test.
reset role;
delete from dominio.faltantes_avisos;
set local session_replication_role = replica;
insert into dominio.faltantes_avisos (linea_id, organizacion_id, empresa_id, cliente_id, estado, intentos, enviado_en, created_at, updated_at)
select gen_random_uuid(), '11111111-1111-1111-1111-111111111111', 'a1000000-0000-0000-0000-000000000001',
       'c5000000-0000-0000-0000-000000000001', 'enviado', 1, now(), now(), now()
  from generate_series(1, 1000);
set local session_replication_role = origin;
select pg_temp.como('f1000000-0000-0000-0000-000000000002');
select is((public.avisar_faltantes_venta(array[pg_temp.fid('A1')], 'Hola') ->> 'omitidos_tope_diario')::int, 1,
  'con 1.000 avisos en las últimas 24 horas la organización no encola más (tope diario)');
select is((select count(*)::int from public.listar_faltantes(null, 1, 50) where aviso <> 'sin_avisar'), 0, 'y nada quedó encolado');
reset role;
-- El tope de una organización no limita a otra: la Organización Dos (sin avisos) encola aunque Uno esté en el tope.
set local session_replication_role = replica;
select is(private.encolar_aviso_faltante(gen_random_uuid(), '22222222-2222-2222-2222-222222222222',
  'a2000000-0000-0000-0000-000000000001', 'c5000000-0000-0000-0000-000000000001', null, false), 'encolado',
  'la otra organización no queda bloqueada por el tope de la primera');
set local session_replication_role = origin;
select is(private.encolar_aviso_faltante((select linea_id from comps where clave = 'A1'), '11111111-1111-1111-1111-111111111111',
  'a1000000-0000-0000-0000-000000000001', 'c5000000-0000-0000-0000-000000000001', null, false), 'tope_diario',
  'y la primera sigue en el tope');
select ok(exists (select 1 from pg_indexes where schemaname = 'dominio' and tablename = 'faltantes_avisos'
                   and indexname = 'faltantes_avisos_org_created_idx'), 'el conteo del tope tiene su índice (organizacion_id, created_at)');

-- La ventana es de 24 horas (QA PR #918 m3): 1.000 avisos de hace 23 h cuentan; de hace 25 h no. El relleno se reinserta con
-- la antigüedad pedida (no se actualiza: una fila sin FK válidas la revalida al actualizarse en la misma transacción).
create function pg_temp.relleno(p_horas integer) returns void language plpgsql security definer as $$
begin
  delete from dominio.faltantes_avisos where linea_id not in (select linea_id from comps);
  set local session_replication_role = replica;
  insert into dominio.faltantes_avisos (linea_id, organizacion_id, empresa_id, cliente_id, estado, intentos, enviado_en, created_at, updated_at)
  select gen_random_uuid(), '11111111-1111-1111-1111-111111111111', 'a1000000-0000-0000-0000-000000000001',
         'c5000000-0000-0000-0000-000000000001', 'enviado', 1, now(), now() - p_horas * interval '1 hour', now()
    from generate_series(1, 1000);
  set local session_replication_role = origin;
end $$;
grant execute on function pg_temp.relleno(integer) to public;
reset role;
select pg_temp.relleno(23);
select is(private.encolar_aviso_faltante((select linea_id from comps where clave = 'A1'), '11111111-1111-1111-1111-111111111111',
  'a1000000-0000-0000-0000-000000000001', 'c5000000-0000-0000-0000-000000000001', null, false), 'tope_diario',
  '1.000 avisos de hace 23 horas siguen contando para el tope');
select pg_temp.relleno(25);
select is(private.encolar_aviso_faltante((select linea_id from comps where clave = 'A1'), '11111111-1111-1111-1111-111111111111',
  'a1000000-0000-0000-0000-000000000001', 'c5000000-0000-0000-0000-000000000001', null, false), 'encolado',
  '1.000 avisos de hace 25 horas ya no cuentan');
-- Reencolar un agotado ya contado no se bloquea por el tope (PR #918 m-3): sus fallidos se pueden reintentar.
select pg_temp.relleno(1);
update dominio.faltantes_avisos set estado = 'agotado', ultimo_error = 'smtp_conexion' where linea_id = (select linea_id from comps where clave = 'A1');
select is(private.encolar_aviso_faltante((select linea_id from comps where clave = 'A1'), '11111111-1111-1111-1111-111111111111',
  'a1000000-0000-0000-0000-000000000001', 'c5000000-0000-0000-0000-000000000001', null, false), 'encolado',
  'con la organización en el tope, un agotado ya contado se reencola');
delete from dominio.faltantes_avisos;

-- m-5: el texto se sanea en la base (controles, invisibles, saltos) y un check lo exige.
select pg_temp.como('f1000000-0000-0000-0000-000000000002');
select public.avisar_faltantes_venta(array[pg_temp.fid('A1')], E'Hola\u0007 mun​do\r\n.\r\n\r\n\r\nchau');
select is(pg_temp.q($$select mensaje from dominio.faltantes_avisos$$), E'Hola mundo\n.\n\nchau', 'mensaje saneado por la RPC (sin controles ni invisibles, saltos normalizados)');
reset role;
select throws_ok(
  format($$insert into dominio.faltantes_avisos (linea_id, organizacion_id, empresa_id, cliente_id, mensaje)
           values (%L, '11111111-1111-1111-1111-111111111111', 'a1000000-0000-0000-0000-000000000001',
                   'c5000000-0000-0000-0000-000000000001', E'sin sanear\u0007')$$, (select linea_id from comps where clave = 'A2')),
  '23514', null, 'el check rechaza un mensaje sin sanear');
select throws_ok($$update dominio.faltantes_avisos set ultimo_error = 'smtp host=x user=y'$$, '23514', null,
  'el check rechaza un ultimo_error que no es un código');
-- Paridad con `sanearMensaje` (TypeScript): la MISMA tabla está en handler.test.ts (describe «paridad de saneo»); si se cambia una, se cambia la otra.
select is(private.sanear_mensaje_aviso(E'Hola\u0007 mundo'), E'Hola mundo', 'paridad de saneo: Hola\u0007 mundo');
select is(private.sanear_mensaje_aviso(E'a\u0001b\u001Fc\u007Fd\u009Fe'), E'abcde', 'paridad de saneo: a\u0001b\u001Fc\u007Fd\u009Fe');
select is(private.sanear_mensaje_aviso(E'x\u0085y'), E'x\ny', 'paridad de saneo: x\u0085y');
select is(private.sanear_mensaje_aviso(E'a​b‌c‍d‎e‏f'), E'abcdef', 'paridad de saneo: a​b‌c‍d‎e‏f');
select is(private.sanear_mensaje_aviso(E'x‪y‫z‬w‭v‮u'), E'xyzwvu', 'paridad de saneo: x‪y‫z‬w‭v‮u');
select is(private.sanear_mensaje_aviso(E'p⁠q⁡r⁤s⁦t⁩u﻿v'), E'pqrstuv', 'paridad de saneo: p⁠q⁡r⁤s⁦t⁩u﻿v');
select is(private.sanear_mensaje_aviso(E'l1 l2 l3'), E'l1\nl2\nl3', 'paridad de saneo: l1 l2 l3');
select is(private.sanear_mensaje_aviso(E'a\r\nb\rc'), E'a\nb\nc', 'paridad de saneo: a\r\nb\rc');
select is(private.sanear_mensaje_aviso(E'a\tb'), E'a b', 'paridad de saneo: a\tb');
select is(private.sanear_mensaje_aviso(E'a\n\n\n\n\nb'), E'a\n\nb', 'paridad de saneo: a\n\n\n\n\nb');
select is(private.sanear_mensaje_aviso(E'  \n hola \n  '), E'hola', 'paridad de saneo:   \n hola \n  ');
select is(private.sanear_mensaje_aviso(E' hola '), E' hola ', 'paridad de saneo:  hola ');
select is(private.sanear_mensaje_aviso(E'\u0007\u200B \n'), null, 'paridad de saneo: solo controles e invisibles = null');
select is(private.sanear_mensaje_aviso(''), null, 'paridad de saneo: vacío = null');
select is(length(private.sanear_mensaje_aviso(repeat('x', 999) || chr(128512) || chr(128512))), 1000, 'paridad de saneo: el recorte es por caracteres (un emoji no se parte)');
select is(private.sanear_mensaje_aviso(E'  \n '), null, 'un texto vacío después de sanear es null');
select is(length(private.sanear_mensaje_aviso(repeat('x', 1500))), 1000, 'y se recorta a 1.000');

-- m-6: las dos RPC comparten la regla única (la vieja también respeta «en cola»).
select is(has_function_privilege('authenticated', 'private.encolar_aviso_faltante(uuid, uuid, uuid, uuid, text, boolean)', 'execute'), false,
  'la regla única es interna: authenticated no la ejecuta');
select is(has_function_privilege('service_role', 'public.cerrar_aviso_faltante(uuid, boolean, text, integer, uuid)', 'execute'), true, 'service_role cierra por tanda');
select is(has_function_privilege('authenticated', 'public.cerrar_aviso_faltante(uuid, boolean, text, integer, uuid)', 'execute'), false, 'authenticated no cierra avisos');

-- Revisión PR #915, M-2: un smtp_timeout es un intento incierto: queda agotado en el acto (no se reenvía solo).
reset role;
delete from dominio.faltantes_avisos;
insert into dominio.faltantes_avisos (linea_id, organizacion_id, empresa_id, cliente_id, mensaje)
select c.linea_id, '11111111-1111-1111-1111-111111111111', 'a1000000-0000-0000-0000-000000000001',
       'c5000000-0000-0000-0000-000000000001', null
  from comps c where c.clave = 'A1';
set local role service_role;
create temp table t6 (cliente text, correo text, lineas jsonb, tanda uuid);
grant select, insert on t6 to public;
insert into t6 select * from public.tomar_aviso_faltante('c5000000-0000-0000-0000-000000000001', 5);
select public.cerrar_aviso_faltante('c5000000-0000-0000-0000-000000000001', false, 'smtp_timeout', 5, (select tanda from t6));
select is(pg_temp.q($$select estado || '|' || intentos || '|' || ultimo_error from dominio.faltantes_avisos$$), 'agotado|1|smtp_timeout',
  'tras un timeout el aviso queda agotado en el intento 1: no se reintenta solo');
select is((select cardinality(public.faltantes_avisos_pendientes(5, 50))), 0, 'y el barrido no lo vuelve a tomar');

-- Revisión PR #915: grants de la cola y del saneo.
select is(has_function_privilege('anon', 'public.tomar_aviso_faltante(uuid, integer)', 'execute'), false, 'anon no ejecuta tomar_aviso_faltante');
select is(has_function_privilege('authenticated', 'public.tomar_aviso_faltante(uuid, integer)', 'execute'), false, 'authenticated no ejecuta tomar_aviso_faltante');
select is(has_function_privilege('service_role', 'public.tomar_aviso_faltante(uuid, integer)', 'execute'), true, 'service_role ejecuta tomar_aviso_faltante');
-- La lista EXACTA de códigos de ultimo_error (la misma que la Edge Function, codigos.ts, y la pantalla): ampliar el check sin
-- tocar las otras dos rompe este test (y los de node y vitest que fijan la misma lista).
select is(
  (select array_agg(m[1] order by m[1])
     from pg_constraint c, regexp_matches(pg_get_constraintdef(c.oid), '''([a-z_]+)''', 'g') m
    where c.conrelid = 'dominio.faltantes_avisos'::regclass and c.conname = 'faltantes_avisos_ultimo_error_codigo_chk'),
  array['destinatario_invalido', 'faltante_cerrado', 'intentos_agotados', 'otro', 'sin_correo', 'smtp_auth', 'smtp_conexion', 'smtp_timeout'],
  'el check de ultimo_error admite exactamente los 8 códigos acordados'
);
select is(has_function_privilege('anon', 'public.cerrar_aviso_faltante(uuid, boolean, text, integer, uuid)', 'execute'), false, 'anon no ejecuta cerrar_aviso_faltante');
-- PR #920 m-1: el cierre bloquea las filas del cliente en orden de línea, como `tomar` (un deadlock real no se puede armar con una sola sesión).
select matches(pg_get_functiondef('public.cerrar_aviso_faltante(uuid, boolean, text, integer, uuid)'::regprocedure), 'order by a\.linea_id\s+for update',
  'cerrar_aviso_faltante bloquea en orden de línea antes de actualizar');
select matches(pg_get_functiondef('public.tomar_aviso_faltante(uuid, integer)'::regprocedure), 'order by a\.linea_id\s+for update',
  'tomar_aviso_faltante bloquea en orden de línea');
select is(has_function_privilege('service_role', 'private.sanear_mensaje_aviso(text)', 'execute'), true,
  'service_role ejecuta sanear_mensaje_aviso (la evalúa el CHECK de mensaje en toda escritura directa)');
select is(has_function_privilege('anon', 'private.sanear_mensaje_aviso(text)', 'execute'), false, 'anon no ejecuta sanear_mensaje_aviso');
select is(has_function_privilege('authenticated', 'private.sanear_mensaje_aviso(text)', 'execute'), false, 'authenticated no ejecuta sanear_mensaje_aviso');
select is(has_function_privilege('anon', 'private.encolar_aviso_faltante(uuid, uuid, uuid, uuid, text, boolean)', 'execute'), false, 'anon no ejecuta la regla única de encolado');
select is(has_function_privilege('anon', 'public.avisar_faltantes_venta(uuid[], text, boolean)', 'execute'), false, 'anon no ejecuta avisar_faltantes_venta');
select is(has_function_privilege('anon', 'public.avisar_faltantes(uuid[])', 'execute'), false, 'anon no ejecuta avisar_faltantes');
select is((select count(*)::int from pg_constraint where conrelid = 'dominio.faltantes_avisos'::regclass
            and conname in ('faltantes_avisos_mensaje_saneado_chk', 'faltantes_avisos_ultimo_error_codigo_chk') and convalidated), 2,
  'los dos checks están validados');

reset role;
-- Se restaura el estado que esperan las pruebas de RLS que siguen: un aviso del cliente 3.
delete from dominio.faltantes_avisos;
insert into dominio.faltantes_avisos (linea_id, organizacion_id, empresa_id, cliente_id)
select c.linea_id, '11111111-1111-1111-1111-111111111111', 'a1000000-0000-0000-0000-000000000001',
       'c5000000-0000-0000-0000-000000000003'
  from comps c where c.clave = 'A4';

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
