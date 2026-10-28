-- F-VTA-21 (MSF-256, épica MSF-213, spec 20261024-100000-ventas-impresion): marca de impreso y reimpresión.
-- Cubre FR-030, FR-031, FR-032, FR-035 y SC-007: impresión y reimpresión, evento correcto, tabla append-only,
-- documento no generado rechazado, aislamiento entre organizaciones y empresas, `lectura` / `ninguno` / `anon`.
-- El fixture corre como postgres (RLS no aplica); las verificaciones, con el rol que corresponda.
begin;

select no_plan();

insert into organizaciones (id, nombre) values
  ('11111111-1111-1111-1111-111111111111', 'Organización Uno'),
  ('22222222-2222-2222-2222-222222222222', 'Organización Dos');

insert into auth.users (id, email) values
  ('f1000000-0000-0000-0000-000000000001', 'administrador@example.com'),
  ('f1000000-0000-0000-0000-000000000002', 'operador@example.com'),
  ('f1000000-0000-0000-0000-000000000003', 'consulta@example.com'),
  ('f1000000-0000-0000-0000-000000000004', 'deposito@example.com'),
  ('f2000000-0000-0000-0000-000000000001', 'admin-dos@example.com');

insert into usuarios_organizacion (user_id, organizacion_id, rol_id, estado) values
  ('f1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'administrador', 'activo'),
  ('f1000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'operador', 'activo'),
  ('f1000000-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111', 'consulta', 'activo'),
  ('f1000000-0000-0000-0000-000000000004', '11111111-1111-1111-1111-111111111111', 'miembro', 'activo'),
  ('f2000000-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', 'administrador', 'activo');

insert into dominio.empresas (id, organizacion_id, nombre) values
  ('a1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'San Javucho'),
  ('a1000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'Mundo JC'),
  ('a2000000-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', 'Empresa Dos');

-- Operador, consulta y depósito trabajan solo en San Javucho; nadie salvo el administrador entra a Mundo JC.
insert into usuarios_empresas (user_id, empresa_id, organizacion_id, rol_id) values
  ('f1000000-0000-0000-0000-000000000002', 'a1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'operador'),
  ('f1000000-0000-0000-0000-000000000003', 'a1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'consulta'),
  ('f1000000-0000-0000-0000-000000000004', 'a1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'deposito');

-- Depósito sin acceso a Ventas en la organización del test.
insert into public.permisos_rol (organizacion_id, rol_id, seccion, nivel) values
  ('11111111-1111-1111-1111-111111111111', 'deposito', 'ventas', 'ninguno')
on conflict (organizacion_id, rol_id, seccion) do update set nivel = 'ninguno';

insert into clientes (id, organizacion_id, numero, nombre, tipo, archivado_en, condicion_iva) values
  ('c5000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 10, 'Cliente Uno', 'minorista', null, 'Responsable Inscripto'),
  ('c5000000-0000-0000-0000-000000000002', '22222222-2222-2222-2222-222222222222', 10, 'Cliente Dos', 'minorista', null, null);

-- F1 y F2 confirmadas en San Javucho, M confirmada en Mundo JC y D confirmada en la organización Dos.
insert into dominio.comprobantes_venta
  (id, organizacion_id, cliente_id, tipo, numero, fecha, estado, total_sin_iva, total_con_iva, empresa_id, canal, operador_id) values
  ('b0000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'c5000000-0000-0000-0000-000000000001', 'factura', '00000001', '2026-10-24', 'confirmada', 100, 121, 'a1000000-0000-0000-0000-000000000001', 'mostrador', 'f1000000-0000-0000-0000-000000000002'),
  ('b0000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'c5000000-0000-0000-0000-000000000001', 'factura', '00000002', '2026-10-24', 'confirmada', 200, 242, 'a1000000-0000-0000-0000-000000000001', 'mostrador', 'f1000000-0000-0000-0000-000000000002'),
  ('b0000000-0000-0000-0000-000000000005', '11111111-1111-1111-1111-111111111111', 'c5000000-0000-0000-0000-000000000001', 'factura', '00000001', '2026-10-24', 'confirmada', 50, 60.5, 'a1000000-0000-0000-0000-000000000002', 'mostrador', 'f1000000-0000-0000-0000-000000000001'),
  ('b0000000-0000-0000-0000-000000000006', '22222222-2222-2222-2222-222222222222', 'c5000000-0000-0000-0000-000000000002', 'factura', '00000001', '2026-10-24', 'confirmada', 10, 12.1, 'a2000000-0000-0000-0000-000000000001', 'mostrador', 'f2000000-0000-0000-0000-000000000001');

-- Documentos: la ruta tiene que ser <organización>/<empresa>/<comprobante>/<documento>.pdf (restricción de la tabla).
--   d1 factura generada de F1 · d2 remito generado de F1 · d3 factura pendiente de F2 · d4 remito fallido de F2
--   d5 factura generada de M (Mundo JC) · d6 factura generada de D (organización Dos)
insert into dominio.comprobante_documentos (id, organizacion_id, empresa_id, comprobante_id, tipo_documento, estado, ruta, generado_en) values
  ('d1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'a1000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-000000000001', 'factura', 'generado',
   '11111111-1111-1111-1111-111111111111/a1000000-0000-0000-0000-000000000001/b0000000-0000-0000-0000-000000000001/d1000000-0000-0000-0000-000000000001.pdf', now()),
  ('d1000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'a1000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-000000000001', 'remito', 'generado',
   '11111111-1111-1111-1111-111111111111/a1000000-0000-0000-0000-000000000001/b0000000-0000-0000-0000-000000000001/d1000000-0000-0000-0000-000000000002.pdf', now()),
  ('d1000000-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111', 'a1000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-000000000002', 'factura', 'pendiente', null, null),
  ('d1000000-0000-0000-0000-000000000004', '11111111-1111-1111-1111-111111111111', 'a1000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-000000000002', 'remito', 'fallido', null, null),
  ('d1000000-0000-0000-0000-000000000005', '11111111-1111-1111-1111-111111111111', 'a1000000-0000-0000-0000-000000000002', 'b0000000-0000-0000-0000-000000000005', 'factura', 'generado',
   '11111111-1111-1111-1111-111111111111/a1000000-0000-0000-0000-000000000002/b0000000-0000-0000-0000-000000000005/d1000000-0000-0000-0000-000000000005.pdf', now()),
  ('d2000000-0000-0000-0000-000000000006', '22222222-2222-2222-2222-222222222222', 'a2000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-000000000006', 'factura', 'generado',
   '22222222-2222-2222-2222-222222222222/a2000000-0000-0000-0000-000000000001/b0000000-0000-0000-0000-000000000006/d2000000-0000-0000-0000-000000000006.pdf', now());

create function pg_temp.como(p_user uuid) returns void language plpgsql as $$
begin
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
  set local role authenticated;
end $$;

-- ============================================================================
-- Estructura y privilegios (FR-030)
-- ============================================================================

select is(
  (select count(*)::int from pg_tables where schemaname = 'dominio' and tablename = 'comprobante_impresiones'),
  1, 'comprobante_impresiones vive en el esquema dominio'
);
select is(
  (select count(*)::int from pg_tables where schemaname = 'public' and tablename = 'comprobante_impresiones'),
  0, 'la tabla no se creó en public'
);
select is(
  (select relrowsecurity from pg_class where oid = 'dominio.comprobante_impresiones'::regclass),
  true, 'comprobante_impresiones tiene RLS activado'
);
select is(
  has_table_privilege('authenticated', 'dominio.comprobante_impresiones', 'insert')
  or has_table_privilege('authenticated', 'dominio.comprobante_impresiones', 'update')
  or has_table_privilege('authenticated', 'dominio.comprobante_impresiones', 'delete')
  or has_table_privilege('authenticated', 'dominio.comprobante_impresiones', 'truncate')
  or has_table_privilege('anon', 'dominio.comprobante_impresiones', 'select')
  or has_table_privilege('anon', 'dominio.comprobante_impresiones', 'insert'),
  false, 'sin escritura directa para authenticated (ni update ni delete) y sin acceso para anon'
);
select is(
  has_table_privilege('authenticated', 'dominio.comprobante_impresiones', 'select'),
  true, 'authenticated lee la tabla (acotada por RLS)'
);
select is(
  has_function_privilege('anon', 'public.registrar_impresion(uuid)', 'execute')
  or has_function_privilege('anon', 'public.ultimas_impresiones_comprobante(uuid)', 'execute'),
  false, 'anon no ejecuta las RPC de marcas'
);
select is(
  has_function_privilege('authenticated', 'public.registrar_impresion(uuid)', 'execute')
  and has_function_privilege('authenticated', 'public.ultimas_impresiones_comprobante(uuid)', 'execute'),
  true, 'authenticated ejecuta las RPC de marcas'
);
select is(
  (select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname in ('registrar_impresion', 'ultimas_impresiones_comprobante')
      and p.prosecdef and p.proconfig @> array['search_path=""']),
  2, 'las dos RPC son security definer con search_path vacío'
);

-- ============================================================================
-- Impresión y reimpresión como operador (edición): FR-031, FR-032, FR-035
-- ============================================================================

select pg_temp.como('f1000000-0000-0000-0000-000000000002');

select is(
  (select row(reimpresion, tipo_documento, comprobante_id, empresa_id, organizacion_id, impreso_por, documento_id)::text
     from public.registrar_impresion('d1000000-0000-0000-0000-000000000001')),
  '(f,factura,b0000000-0000-0000-0000-000000000001,a1000000-0000-0000-0000-000000000001,11111111-1111-1111-1111-111111111111,f1000000-0000-0000-0000-000000000002,d1000000-0000-0000-0000-000000000001)',
  'la primera impresión se registra con quién, qué y dónde; organización y actor salen de la sesión (FR-031)'
);

reset role;
select is(
  (select count(*)::int from public.registro_actividad
    where tipo = 'comprobante.impreso' and empresa_id = 'a1000000-0000-0000-0000-000000000001'
      and actor_id = 'f1000000-0000-0000-0000-000000000002' and detalle = 'Imprimió la factura 00000001'),
  1, 'la primera impresión emite comprobante.impreso con quién y la tienda (FR-032)'
);
select is(
  (select count(*)::int from public.registro_actividad where tipo = 'comprobante.reimpreso'),
  0, 'la primera impresión no emite comprobante.reimpreso'
);

select pg_temp.como('f1000000-0000-0000-0000-000000000002');
select is(
  (select reimpresion from public.registrar_impresion('d1000000-0000-0000-0000-000000000001')),
  true, 'la segunda impresión del mismo documento es una reimpresión (FR-032, FR-035)'
);
select is(
  (select reimpresion from public.registrar_impresion('d1000000-0000-0000-0000-000000000001')),
  true, 'la reimpresión no tiene límite (FR-035)'
);

reset role;
select is(
  (select count(*)::int from public.registro_actividad
    where tipo = 'comprobante.reimpreso' and detalle = 'Reimprimió la factura 00000001'),
  2, 'cada reimpresión emite comprobante.reimpreso (FR-032)'
);
select is(
  (select count(*)::int from public.registro_actividad where tipo = 'comprobante.impreso'),
  1, 'comprobante.impreso se emite una sola vez por documento'
);
select is(
  (select count(*)::int from dominio.comprobante_impresiones
    where comprobante_id = 'b0000000-0000-0000-0000-000000000001' and tipo_documento = 'factura'),
  3, 'el registro conserva todas las impresiones (FR-030, FR-035)'
);

-- El remito es otro documento: su primera impresión es «impreso» aunque la factura ya se haya reimpreso.
select pg_temp.como('f1000000-0000-0000-0000-000000000002');
select is(
  (select reimpresion from public.registrar_impresion('d1000000-0000-0000-0000-000000000002')),
  false, 'la primera impresión del remito no es una reimpresión'
);
reset role;
select is(
  (select count(*)::int from public.registro_actividad
    where tipo = 'comprobante.impreso' and detalle = 'Imprimió el remito 00000001'),
  1, 'el remito emite su propio comprobante.impreso'
);

-- Un PDF regenerado (otro documento del mismo comprobante y tipo) sigue siendo reimpresión del mismo documento de venta.
insert into dominio.comprobante_documentos (id, organizacion_id, empresa_id, comprobante_id, tipo_documento, estado, ruta, generado_en) values
  ('d1000000-0000-0000-0000-000000000007', '11111111-1111-1111-1111-111111111111', 'a1000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-000000000001', 'factura', 'generado',
   '11111111-1111-1111-1111-111111111111/a1000000-0000-0000-0000-000000000001/b0000000-0000-0000-0000-000000000001/d1000000-0000-0000-0000-000000000007.pdf', now());
select pg_temp.como('f1000000-0000-0000-0000-000000000002');
select is(
  (select reimpresion from public.registrar_impresion('d1000000-0000-0000-0000-000000000007')),
  true, 'imprimir un PDF regenerado de una factura ya impresa es una reimpresión'
);

-- ============================================================================
-- Documento no generado, inexistente o de otra organización (FR-031, SC-007)
-- ============================================================================

select throws_ok(
  $$ select public.registrar_impresion('d1000000-0000-0000-0000-000000000003') $$,
  '22023', null, 'un documento pendiente no se marca como impreso'
);
select throws_ok(
  $$ select public.registrar_impresion('d1000000-0000-0000-0000-000000000004') $$,
  '22023', null, 'un documento fallido no se marca como impreso'
);
select throws_ok(
  $$ select public.registrar_impresion('d9999999-9999-9999-9999-999999999999') $$,
  'P0002', null, 'un documento inexistente se rechaza'
);
select throws_ok(
  $$ select public.registrar_impresion(null) $$,
  'P0002', null, 'sin documento se rechaza'
);
select throws_ok(
  $$ select public.registrar_impresion('d2000000-0000-0000-0000-000000000006') $$,
  'P0002', null, 'el documento de otra organización no existe para esta sesión (aislamiento)'
);
select throws_ok(
  $$ select public.registrar_impresion('d1000000-0000-0000-0000-000000000005') $$,
  '42501', null, 'el operador no imprime en una tienda donde no tiene ventas (aislamiento entre empresas)'
);
reset role;
select is(
  (select count(*)::int from dominio.comprobante_impresiones
    where documento_id in ('d1000000-0000-0000-0000-000000000003', 'd1000000-0000-0000-0000-000000000004',
                           'd1000000-0000-0000-0000-000000000005', 'd2000000-0000-0000-0000-000000000006')),
  0, 'los rechazos no dejan impresiones registradas'
);

-- ============================================================================
-- Permisos: lectura alcanza, ninguno y anon no (FR-031)
-- ============================================================================

select pg_temp.como('f1000000-0000-0000-0000-000000000003');
select lives_ok(
  $$ select public.registrar_impresion('d1000000-0000-0000-0000-000000000001') $$,
  'ventas en lectura puede imprimir y reimprimir, sin permiso adicional (FR-031, FR-035)'
);
select is(
  (select count(*)::int from public.ultimas_impresiones_comprobante('b0000000-0000-0000-0000-000000000001')),
  2, 'lectura ve la última impresión de cada tipo (factura y remito)'
);

select pg_temp.como('f1000000-0000-0000-0000-000000000004');
select throws_ok(
  $$ select public.registrar_impresion('d1000000-0000-0000-0000-000000000001') $$,
  '42501', null, 'ventas en ninguno no registra impresiones'
);
select throws_ok(
  $$ select public.ultimas_impresiones_comprobante('b0000000-0000-0000-0000-000000000001') $$,
  '42501', null, 'ventas en ninguno no ve las marcas'
);
select is(
  (select count(*)::int from dominio.comprobante_impresiones), 0,
  'ventas en ninguno no lee la tabla (RLS)'
);

reset role;
set local role anon;
select throws_ok(
  $$ select public.registrar_impresion('d1000000-0000-0000-0000-000000000001') $$,
  '42501', null, 'anon no puede registrar impresiones'
);
select throws_ok(
  $$ select public.ultimas_impresiones_comprobante('b0000000-0000-0000-0000-000000000001') $$,
  '42501', null, 'anon no puede consultar las marcas'
);
reset role;

-- ============================================================================
-- Última impresión de cada tipo y aislamiento (FR-032, FR-033)
-- ============================================================================

select pg_temp.como('f1000000-0000-0000-0000-000000000002');
select is(
  (select array_agg(tipo_documento order by tipo_documento) from public.ultimas_impresiones_comprobante('b0000000-0000-0000-0000-000000000001')),
  array['factura', 'remito'], 'devuelve una sola fila por tipo de documento'
);
select is(
  (select impreso_en = (select max(i.impreso_en) from dominio.comprobante_impresiones i
                         where i.comprobante_id = 'b0000000-0000-0000-0000-000000000001' and i.tipo_documento = 'factura')
     from public.ultimas_impresiones_comprobante('b0000000-0000-0000-0000-000000000001') where tipo_documento = 'factura'),
  true, 'la fila de la factura es la última impresión'
);
select is(
  (select count(*)::int from public.ultimas_impresiones_comprobante('b0000000-0000-0000-0000-000000000002')),
  0, 'un comprobante nunca impreso no devuelve marcas'
);
select throws_ok(
  $$ select public.ultimas_impresiones_comprobante('b0000000-0000-0000-0000-000000000006') $$,
  'P0002', null, 'el comprobante de otra organización no existe para esta sesión'
);
select throws_ok(
  $$ select public.ultimas_impresiones_comprobante('b0000000-0000-0000-0000-000000000005') $$,
  '42501', null, 'el comprobante de una tienda sin ventas se rechaza'
);
select is(
  (select count(*)::int from dominio.comprobante_impresiones where organizacion_id <> '11111111-1111-1111-1111-111111111111'),
  0, 'la lectura directa solo ve la organización de la sesión'
);

-- La otra organización imprime lo suyo y no ve lo de la primera.
select pg_temp.como('f2000000-0000-0000-0000-000000000001');
select lives_ok(
  $$ select public.registrar_impresion('d2000000-0000-0000-0000-000000000006') $$,
  'la organización Dos imprime su propio documento'
);
select is(
  (select count(*)::int from dominio.comprobante_impresiones), 1,
  'la organización Dos solo ve su impresión (RLS por organización)'
);
select throws_ok(
  $$ select public.registrar_impresion('d1000000-0000-0000-0000-000000000001') $$,
  'P0002', null, 'la organización Dos no registra impresiones de documentos ajenos'
);

-- ============================================================================
-- Append-only (FR-030)
-- ============================================================================

select pg_temp.como('f1000000-0000-0000-0000-000000000001');
select throws_ok(
  $$ update dominio.comprobante_impresiones set impreso_en = now() $$,
  '42501', null, 'ni el administrador actualiza impresiones (sin privilegio)'
);
select throws_ok(
  $$ delete from dominio.comprobante_impresiones $$,
  '42501', null, 'ni el administrador borra impresiones (sin privilegio)'
);
select throws_ok(
  $$ insert into dominio.comprobante_impresiones (organizacion_id, empresa_id, comprobante_id, tipo_documento, documento_id)
     values ('11111111-1111-1111-1111-111111111111', 'a1000000-0000-0000-0000-000000000001',
             'b0000000-0000-0000-0000-000000000001', 'factura', 'd1000000-0000-0000-0000-000000000001') $$,
  '42501', null, 'tampoco se inserta directo: solo por registrar_impresion'
);

reset role;
select throws_ok(
  $$ update dominio.comprobante_impresiones set impreso_en = now() $$,
  '42501', 'Las impresiones registradas no se modifican ni se borran', 'ni el dueño de la tabla actualiza impresiones (trigger)'
);
select throws_ok(
  $$ delete from dominio.comprobante_impresiones $$,
  '42501', 'Las impresiones registradas no se modifican ni se borran', 'ni el dueño de la tabla borra impresiones (trigger)'
);

-- La baja de una organización entera sigue funcionando (el borrado en cascada no choca con el trigger).
select lives_ok(
  $$ delete from public.organizaciones where id = '22222222-2222-2222-2222-222222222222' $$,
  'borrar una organización arrastra sus impresiones'
);
select is(
  (select count(*)::int from dominio.comprobante_impresiones where organizacion_id = '22222222-2222-2222-2222-222222222222'),
  0, 'las impresiones de la organización borrada se fueron con ella'
);

select * from finish();
rollback;
