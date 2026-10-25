-- F-VTA-19 (MSF-230, épica MSF-213, spec 20261024-100000-ventas-impresion): pedidos de documentos imprimibles.
-- Cubre FR-001, FR-002, FR-003, FR-005, FR-007, FR-008, FR-015, FR-016 y SC-001: aislamiento entre organizaciones y
-- empresas, `lectura` / `ninguno` / `anon`, solo `confirmada` imprimible, idempotencia y reutilización del PDF,
-- funciones del worker no ejecutables por `authenticated`, bucket privado y RLS en la tabla nueva.
-- El fixture corre como postgres (RLS no aplica); las verificaciones, con el rol que corresponda. Las llamadas
-- del worker se hacen como postgres (dueño de las funciones, que no es superusuario en el CI): el gate de rol se
-- verifica con has_function_privilege y la autorización por organización con el JWT del administrador, igual
-- que en historial_importacion.test.sql.
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

insert into dominio.empresas (id, organizacion_id, nombre, razon_social, cuit, direccion) values
  ('a1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'San Javucho', 'San Javucho SRL', '30712345678', 'Calle 1 123'),
  ('a1000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'Mundo JC', null, null, null),
  ('a2000000-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', 'Empresa Dos', null, null, null);

-- Operador, consulta y depósito (ventas en «ninguno») trabajan solo en San Javucho; nadie salvo el administrador entra a Mundo JC.
insert into usuarios_empresas (user_id, empresa_id, organizacion_id, rol_id) values
  ('f1000000-0000-0000-0000-000000000002', 'a1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'operador'),
  ('f1000000-0000-0000-0000-000000000003', 'a1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'consulta'),
  ('f1000000-0000-0000-0000-000000000004', 'a1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'deposito');

-- Depósito sin acceso a Ventas en la organización del test (el rol de la matriz base lo trae en otro nivel).
insert into public.permisos_rol (organizacion_id, rol_id, seccion, nivel) values
  ('11111111-1111-1111-1111-111111111111', 'deposito', 'ventas', 'ninguno')
on conflict (organizacion_id, rol_id, seccion) do update set nivel = 'ninguno';

insert into clientes (id, organizacion_id, numero, nombre, tipo, archivado_en, condicion_iva) values
  ('c5000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 10, 'Cliente Uno', 'minorista', null, 'Responsable Inscripto'),
  ('c5000000-0000-0000-0000-000000000002', '22222222-2222-2222-2222-222222222222', 10, 'Cliente Dos', 'minorista', null, null);

-- Comprobantes: confirmada (F1), segunda confirmada (F2), borrador (B), presupuesto (P), confirmada de Mundo JC (M)
-- y confirmada de la organización Dos (D).
insert into dominio.comprobantes_venta
  (id, organizacion_id, cliente_id, tipo, numero, fecha, estado, total_sin_iva, total_con_iva, empresa_id, canal, operador_id) values
  ('b0000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'c5000000-0000-0000-0000-000000000001', 'factura', '00000001', '2026-10-24', 'confirmada', 100, 121, 'a1000000-0000-0000-0000-000000000001', 'mostrador', 'f1000000-0000-0000-0000-000000000002'),
  ('b0000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'c5000000-0000-0000-0000-000000000001', 'factura', '00000002', '2026-10-24', 'confirmada', 200, 242, 'a1000000-0000-0000-0000-000000000001', 'mostrador', 'f1000000-0000-0000-0000-000000000002'),
  ('b0000000-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111', 'c5000000-0000-0000-0000-000000000001', 'factura', '00000003', '2026-10-24', 'borrador', 0, 0, 'a1000000-0000-0000-0000-000000000001', 'mostrador', 'f1000000-0000-0000-0000-000000000002'),
  ('b0000000-0000-0000-0000-000000000004', '11111111-1111-1111-1111-111111111111', 'c5000000-0000-0000-0000-000000000001', 'presupuesto', '00000001', '2026-10-24', 'pendiente', 0, 0, 'a1000000-0000-0000-0000-000000000001', 'mostrador', 'f1000000-0000-0000-0000-000000000002'),
  ('b0000000-0000-0000-0000-000000000005', '11111111-1111-1111-1111-111111111111', 'c5000000-0000-0000-0000-000000000001', 'factura', '00000001', '2026-10-24', 'confirmada', 50, 60.5, 'a1000000-0000-0000-0000-000000000002', 'mostrador', 'f1000000-0000-0000-0000-000000000001'),
  ('b0000000-0000-0000-0000-000000000006', '22222222-2222-2222-2222-222222222222', 'c5000000-0000-0000-0000-000000000002', 'factura', '00000001', '2026-10-24', 'confirmada', 10, 12.1, 'a2000000-0000-0000-0000-000000000001', 'mostrador', 'f2000000-0000-0000-0000-000000000001');

-- Conexión del generador de PDF de la organización Uno (la crea un administrador, ver docs/ventas-impresion.md).
-- La fila del catálogo `comprobantes-pdf` la deja la migración de las RPC.
insert into conexiones (id, organizacion_id, sistema_externo, credencial_vault_id) values
  ('c1000000-0000-0000-0000-0000000000c1', '11111111-1111-1111-1111-111111111111', 'comprobantes-pdf', gen_random_uuid());

create function pg_temp.como(p_user uuid) returns void language plpgsql as $$
begin
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
  set local role authenticated;
end $$;

create temp table docs (clave text primary key, id uuid);
grant select, insert, update on docs to public;
create function pg_temp.id_doc(p_clave text) returns uuid language sql as $$ select id from docs where clave = p_clave $$;

-- ============================================================================
-- Estructura: esquema, RLS, bucket privado, columnas de la empresa (FR-003, FR-008, FR-016)
-- ============================================================================

select is(
  (select count(*)::int from pg_tables where schemaname = 'dominio' and tablename = 'comprobante_documentos'),
  1, 'comprobante_documentos vive en el esquema dominio'
);
select is(
  (select relrowsecurity from pg_class where oid = 'dominio.comprobante_documentos'::regclass),
  true, 'comprobante_documentos tiene RLS activado'
);
select is(
  (select count(*)::int from pg_tables where schemaname = 'public' and tablename = 'comprobante_documentos'),
  0, 'la tabla no se creó en public'
);
select is(
  (select public from storage.buckets where id = 'comprobantes-documentos'),
  false, 'el bucket comprobantes-documentos es privado'
);
select is(
  (select count(*)::int from pg_policies where schemaname = 'storage' and tablename = 'objects'
     and policyname = 'comprobantes_documentos_objetos_select'),
  1, 'el bucket tiene su política de lectura acotada'
);
select is(
  (select count(*)::int from pg_policies where schemaname = 'storage' and tablename = 'objects'
     and qual like '%comprobantes-documentos%' and cmd <> 'SELECT'),
  0, 'nadie con rol de usuario escribe en el bucket: sin políticas de insert, update ni delete'
);
select is(
  (select count(*)::int from information_schema.columns
    where table_schema = 'dominio' and table_name = 'empresas' and column_name in ('razon_social', 'cuit')),
  2, 'dominio.empresas tiene razon_social y cuit (FR-008)'
);
select throws_ok(
  $$ update dominio.empresas set cuit = '123' where id = 'a1000000-0000-0000-0000-000000000002' $$,
  '23514', null, 'el CUIT de la empresa exige 11 dígitos'
);
select throws_ok(
  $$ update dominio.empresas set cuit = '30-71234567-8' where id = 'a1000000-0000-0000-0000-000000000002' $$,
  '23514', null, 'el CUIT de la empresa se guarda sin guiones'
);
select lives_ok(
  $$ update dominio.empresas set cuit = '30712345678', razon_social = 'Mundo JC SA' where id = 'a1000000-0000-0000-0000-000000000002' $$,
  'un CUIT de 11 dígitos y una razón social válidos se guardan'
);
select is(
  has_column_privilege('authenticated', 'dominio.empresas', 'cuit', 'update')
  and has_column_privilege('authenticated', 'dominio.empresas', 'razon_social', 'update'),
  true, 'la ficha puede editar razon_social y cuit'
);

-- ============================================================================
-- Privilegios y definición de las funciones (FR-007, FR-016)
-- ============================================================================

select is(
  has_function_privilege('anon', 'public.solicitar_documento_comprobante(uuid, text)', 'execute')
  or has_function_privilege('anon', 'public.obtener_documento_comprobante(uuid)', 'execute')
  or has_function_privilege('anon', 'public.listar_documentos_comprobante(uuid)', 'execute'),
  false, 'anon no ejecuta ninguna RPC de documentos'
);
select is(
  has_function_privilege('authenticated', 'public.solicitar_documento_comprobante(uuid, text)', 'execute')
  and has_function_privilege('authenticated', 'public.obtener_documento_comprobante(uuid)', 'execute')
  and has_function_privilege('authenticated', 'public.listar_documentos_comprobante(uuid)', 'execute'),
  true, 'authenticated ejecuta las RPC de documentos'
);
select is(
  (select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in ('solicitar_documento_comprobante', 'obtener_documento_comprobante', 'listar_documentos_comprobante')
      and p.prosecdef and p.proconfig @> array['search_path=""']),
  3, 'las tres RPC son security definer con search_path vacío'
);
select is(
  has_function_privilege('authenticated', 'private.datos_documento_comprobante(uuid)', 'execute')
  or has_function_privilege('anon', 'private.datos_documento_comprobante(uuid)', 'execute')
  or has_function_privilege('authenticated', 'private.cerrar_documento_comprobante(uuid, text, text)', 'execute')
  or has_function_privilege('anon', 'private.cerrar_documento_comprobante(uuid, text, text)', 'execute'),
  false, 'las funciones del worker no son ejecutables por authenticated ni anon'
);
select is(
  has_function_privilege('workers_orquestacion', 'private.datos_documento_comprobante(uuid)', 'execute')
  and has_function_privilege('workers_orquestacion', 'private.cerrar_documento_comprobante(uuid, text, text)', 'execute'),
  true, 'los workers ejecutan las funciones de datos y cierre'
);
select is(
  has_table_privilege('authenticated', 'dominio.comprobante_documentos', 'insert')
  or has_table_privilege('authenticated', 'dominio.comprobante_documentos', 'update')
  or has_table_privilege('authenticated', 'dominio.comprobante_documentos', 'delete')
  or has_table_privilege('anon', 'dominio.comprobante_documentos', 'select'),
  false, 'sin escritura directa para authenticated y sin acceso para anon'
);

-- ============================================================================
-- Pedido como operador (edición): FR-001, FR-002, FR-005, FR-015
-- ============================================================================

select pg_temp.como('f1000000-0000-0000-0000-000000000002');

select throws_ok(
  $$ select public.solicitar_documento_comprobante('b0000000-0000-0000-0000-000000000003', 'factura') $$,
  '22023', null, 'un borrador no se imprime (FR-002)'
);
select throws_ok(
  $$ select public.solicitar_documento_comprobante('b0000000-0000-0000-0000-000000000004', 'factura') $$,
  '22023', null, 'un presupuesto no se imprime como factura en esta historia (FR-002)'
);
select throws_ok(
  $$ select public.solicitar_documento_comprobante('b0000000-0000-0000-0000-000000000001', 'presupuesto') $$,
  '22023', null, 'el documento presupuesto no se pide para una factura (F-VTA-20 lo habilita solo para presupuestos)'
);
select throws_ok(
  $$ select public.solicitar_documento_comprobante('b0000000-0000-0000-0000-000000000001', null) $$,
  '22023', null, 'sin tipo de documento se rechaza'
);

insert into docs (clave, id)
  select 'f1', (public.solicitar_documento_comprobante('b0000000-0000-0000-0000-000000000001', 'factura')).id;

select is(
  (select row(estado, solicitado_por, tipo_documento, ejecucion_id is not null)::text
     from dominio.comprobante_documentos where id = pg_temp.id_doc('f1')),
  '(pendiente,f1000000-0000-0000-0000-000000000002,factura,t)',
  'la factura confirmada queda pendiente, con el solicitante de la sesión y su ejecución (FR-001)'
);
select is(
  (select organizacion_id::text from dominio.comprobante_documentos where id = pg_temp.id_doc('f1')),
  '11111111-1111-1111-1111-111111111111', 'la organización sale de la sesión (FR-001)'
);

-- Idempotencia: el doble clic es un solo pedido (FR-005).
select is(
  (select (public.solicitar_documento_comprobante('b0000000-0000-0000-0000-000000000001', 'factura')).id),
  pg_temp.id_doc('f1'), 'pedir de nuevo devuelve el mismo pedido pendiente'
);
reset role;
select is(
  (select count(*)::int from dominio.comprobante_documentos
    where comprobante_id = 'b0000000-0000-0000-0000-000000000001' and tipo_documento = 'factura'),
  1, 'un solo pedido pendiente por comprobante y tipo (FR-005)'
);
select throws_ok(
  $$ insert into dominio.comprobante_documentos (organizacion_id, empresa_id, comprobante_id, tipo_documento)
     values ('11111111-1111-1111-1111-111111111111', 'a1000000-0000-0000-0000-000000000001',
             'b0000000-0000-0000-0000-000000000001', 'factura') $$,
  '23505', null, 'el índice impide dos pendientes del mismo comprobante y tipo'
);
select is(
  (select count(*)::int from public.despachos_ejecucion d join public.ejecuciones_worker e on e.id = d.ejecucion_id
    where e.detalle->>'documento_id' = pg_temp.id_doc('f1')::text and d.estado = 'pendiente' and e.estado = 'en_curso'
      and e.origen = 'manual' and e.actor = 'f1000000-0000-0000-0000-000000000002'),
  1, 'el pedido deja una ejecución manual auditable y su orden en la outbox (FR-013)'
);
select is(
  (select c.clave like 'generar-documento-venta-factura-%'
     from public.ejecuciones_worker e join public.capacidades_ejecucion c on c.id = e.capacidad_id
    where e.id = (select ejecucion_id from dominio.comprobante_documentos where id = pg_temp.id_doc('f1'))),
  true, 'la capacidad lleva el prefijo generar-documento-venta- que reclama el flow'
);
select is(
  (select count(*)::int from public.registro_actividad
    where tipo = 'comprobante.documento_solicitado' and empresa_id = 'a1000000-0000-0000-0000-000000000001'),
  1, 'registra comprobante.documento_solicitado en la misma transacción, una sola vez (FR-015)'
);

-- El remito es otro documento: otro pedido.
select pg_temp.como('f1000000-0000-0000-0000-000000000002');
insert into docs (clave, id)
  select 'r1', (public.solicitar_documento_comprobante('b0000000-0000-0000-0000-000000000001', 'remito')).id;
select isnt(pg_temp.id_doc('r1'), pg_temp.id_doc('f1'), 'el remito es un pedido distinto de la factura');

-- ============================================================================
-- Permisos y aislamiento (FR-001, SC-001)
-- ============================================================================

select pg_temp.como('f1000000-0000-0000-0000-000000000003');
select lives_ok(
  $$ select public.solicitar_documento_comprobante('b0000000-0000-0000-0000-000000000002', 'factura') $$,
  'ventas en lectura puede pedir un documento (FR-001)'
);
select is(
  (select count(*)::int from dominio.comprobante_documentos), 3,
  'lectura ve los pedidos de su organización y empresa (RLS)'
);
select is(
  (select estado from public.obtener_documento_comprobante(pg_temp.id_doc('f1'))),
  'pendiente', 'lectura consulta el estado de un pedido'
);
select is(
  (select count(*)::int from public.listar_documentos_comprobante('b0000000-0000-0000-0000-000000000001')),
  2, 'lectura lista los documentos del comprobante (factura y remito)'
);

select pg_temp.como('f1000000-0000-0000-0000-000000000004');
select throws_ok(
  $$ select public.solicitar_documento_comprobante('b0000000-0000-0000-0000-000000000001', 'factura') $$,
  '42501', null, 'ventas en ninguno no pide documentos'
);
select throws_ok(
  format($$ select public.obtener_documento_comprobante(%L) $$, pg_temp.id_doc('f1')),
  '42501', null, 'ventas en ninguno no consulta documentos'
);
select is(
  (select count(*)::int from dominio.comprobante_documentos), 0,
  'ventas en ninguno no ve ningún pedido (RLS)'
);

-- Otra empresa de la misma organización a la que el operador no pertenece.
select pg_temp.como('f1000000-0000-0000-0000-000000000002');
select throws_ok(
  $$ select public.solicitar_documento_comprobante('b0000000-0000-0000-0000-000000000005', 'factura') $$,
  '42501', null, 'el operador no pide documentos de una empresa a la que no pertenece'
);

-- Otra organización.
select throws_ok(
  $$ select public.solicitar_documento_comprobante('b0000000-0000-0000-0000-000000000006', 'factura') $$,
  'P0002', null, 'un comprobante de otra organización no existe para el operador'
);
select pg_temp.como('f2000000-0000-0000-0000-000000000001');
select is((select count(*)::int from dominio.comprobante_documentos), 0, 'la otra organización no ve los pedidos de la Uno (RLS)');
select throws_ok(
  format($$ select public.obtener_documento_comprobante(%L) $$, pg_temp.id_doc('f1')),
  'P0002', null, 'la otra organización no consulta un documento ajeno'
);
select throws_ok(
  $$ select public.solicitar_documento_comprobante('b0000000-0000-0000-0000-000000000006', 'factura') $$,
  'P0001', null, 'una organización sin conexión comprobantes-pdf recibe un error claro'
);

-- Lectura por empresa del documento (FR-001): operador en San Javucho y depósito (sin ventas) en Mundo JC (ambas accesibles).
reset role;
insert into auth.users (id, email) values ('f1000000-0000-0000-0000-000000000005', 'mixto@example.com');
insert into usuarios_organizacion (user_id, organizacion_id, rol_id, estado) values
  ('f1000000-0000-0000-0000-000000000005', '11111111-1111-1111-1111-111111111111', 'miembro', 'activo');
insert into usuarios_empresas (user_id, empresa_id, organizacion_id, rol_id) values
  ('f1000000-0000-0000-0000-000000000005', 'a1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'operador'),
  ('f1000000-0000-0000-0000-000000000005', 'a1000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'deposito');
insert into dominio.comprobante_documentos (id, organizacion_id, empresa_id, comprobante_id, tipo_documento, estado, ruta, generado_en) values
  ('d0000000-0000-0000-0000-0000000000a1', '11111111-1111-1111-1111-111111111111', 'a1000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-000000000001', 'remito', 'generado',
   '11111111-1111-1111-1111-111111111111/a1000000-0000-0000-0000-000000000001/b0000000-0000-0000-0000-000000000001/d0000000-0000-0000-0000-0000000000a1.pdf', now()),
  ('d0000000-0000-0000-0000-0000000000b1', '11111111-1111-1111-1111-111111111111', 'a1000000-0000-0000-0000-000000000002', 'b0000000-0000-0000-0000-000000000005', 'factura', 'generado',
   '11111111-1111-1111-1111-111111111111/a1000000-0000-0000-0000-000000000002/b0000000-0000-0000-0000-000000000005/d0000000-0000-0000-0000-0000000000b1.pdf', now());
select pg_temp.como('f1000000-0000-0000-0000-000000000005');
select is(
  (select count(*)::int from dominio.comprobante_documentos where id = 'd0000000-0000-0000-0000-0000000000a1'), 1,
  'con ventas en edición en la empresa A ve sus documentos'
);
select is(
  (select count(*)::int from dominio.comprobante_documentos where id = 'd0000000-0000-0000-0000-0000000000b1'), 0,
  'sin ventas en la empresa B no ve sus documentos aunque B sea accesible (RLS por empresa del documento)'
);
-- Un objeto de la empresa A (carpeta uuid) y otro con carpeta que no es uuid: el helper debe contar solo el primero
-- y no fallar con el segundo (la evaluación del WHERE no cortocircuita).
reset role;
insert into storage.objects (bucket_id, name) values
  ('comprobantes-documentos', '11111111-1111-1111-1111-111111111111/a1000000-0000-0000-0000-000000000001/prueba-helper.pdf'),
  ('comprobantes-documentos', '11111111-1111-1111-1111-111111111111/no-es-uuid/prueba-helper.pdf');
select pg_temp.como('f1000000-0000-0000-0000-000000000005');
select is(
  (select count(*)::int from storage.objects o where o.bucket_id = 'comprobantes-documentos' and o.name like '%/prueba-helper.pdf'
     and private.puede_leer_documento_ruta((storage.foldername(o.name))[2])), 1,
  'el helper del bucket cuenta la carpeta uuid y no falla con la que no es uuid'
);
select is(private.puede_leer_documento_ruta('a1000000-0000-0000-0000-000000000001'), true, 'la ruta de la empresa A se puede leer');
select is(private.puede_leer_documento_ruta('a1000000-0000-0000-0000-000000000002'), false, 'la ruta de la empresa B no se puede leer');
select is(private.puede_leer_documento_ruta('no-es-uuid'), false, 'una carpeta que no es uuid no da acceso');

-- anon
reset role;
set local role anon;
select throws_ok(
  $$ select public.solicitar_documento_comprobante('b0000000-0000-0000-0000-000000000001', 'factura') $$,
  '42501', null, 'anon no ejecuta la RPC'
);
reset role;

-- ============================================================================
-- Funciones del worker (FR-004, FR-007): datos, cierre idempotente, reutilización
-- ============================================================================

-- Rol worker de la organización Uno (como lo deja aprovisionar_servidor_organizacion).
create role worker_testdoc nologin;
grant workers_orquestacion to worker_testdoc;
grant usage on schema private to worker_testdoc;
insert into servidores_organizacion
  (organizacion_id, host, usuario_ssh, credencial_ssh_vault_id, rol_db, credencial_db_vault_id)
values ('11111111-1111-1111-1111-111111111111', 'worker.test', 'ssh', gen_random_uuid(), 'worker_testdoc', gen_random_uuid());

-- En el CI el rol de conexión (postgres) no es superusuario y no puede simular el login del worker:
-- `autorizar_llamante_ciclo` acepta a un administrador por JWT, así que se identifica al admin de la
-- organización para ejercitar el camino del worker. El gate de rol se cubre con los grants de arriba.
select set_config('request.jwt.claims',
  json_build_object('sub', 'f1000000-0000-0000-0000-000000000001', 'role', 'authenticated')::text, false);

select is(
  (select private.datos_documento_comprobante(pg_temp.id_doc('f1'))->'empresa'->>'razon_social'),
  'San Javucho SRL', 'el worker lee la razón social de la ficha (FR-007)'
);
select is(
  (select private.datos_documento_comprobante(pg_temp.id_doc('f1'))->'empresa'->>'cuit'),
  '30712345678', 'el worker lee el CUIT de la ficha'
);
select is(
  (select private.datos_documento_comprobante(pg_temp.id_doc('f1'))->'cliente'->>'condicion_iva'),
  'Responsable Inscripto', 'el worker lee la condición frente al IVA del cliente (FR-009)'
);
-- Sin condición cargada el dato llega nulo (no una cadena vacía): la plantilla no imprime la línea.
update public.clientes set condicion_iva = null where id = 'c5000000-0000-0000-0000-000000000001';
select is(
  (select private.datos_documento_comprobante(pg_temp.id_doc('f1'))->'cliente'->>'condicion_iva'),
  null, 'sin condición frente al IVA cargada el worker recibe nulo (FR-009)'
);
update public.clientes set condicion_iva = 'Responsable Inscripto' where id = 'c5000000-0000-0000-0000-000000000001';
select is(
  (select private.datos_documento_comprobante(pg_temp.id_doc('f1'))->'comprobante'->>'numero'),
  '00000001', 'el worker lee el número del comprobante'
);
select is(
  (select jsonb_typeof(private.datos_documento_comprobante(pg_temp.id_doc('f1'))->'lineas')),
  'array', 'el worker recibe las líneas como arreglo'
);

select is(
  (select private.datos_documento_comprobante(pg_temp.id_doc('f1'))->'documento'->>'ruta'),
  (select d.organizacion_id::text || '/' || d.empresa_id::text || '/' || d.comprobante_id::text || '/' || d.id::text || '.pdf'
     from dominio.comprobante_documentos d where d.id = pg_temp.id_doc('f1')),
  'el worker recibe la ruta exacta donde subir el PDF'
);

-- Ruta ajena: se rechaza.
select throws_ok(
  format($$ select private.cerrar_documento_comprobante(%L, '22222222-2222-2222-2222-222222222222/x/y/z.pdf', null) $$, pg_temp.id_doc('f1')),
  'P0001', null, 'el cierre rechaza una ruta que no es la del documento'
);

-- Cierre generado: sube el archivo (fixture) y cierra.
insert into storage.objects (bucket_id, name) values (
  'comprobantes-documentos',
  '11111111-1111-1111-1111-111111111111/a1000000-0000-0000-0000-000000000001/b0000000-0000-0000-0000-000000000001/' || pg_temp.id_doc('f1')::text || '.pdf'
);
select lives_ok(
  format($$ select private.cerrar_documento_comprobante(%L,
    '11111111-1111-1111-1111-111111111111/a1000000-0000-0000-0000-000000000001/b0000000-0000-0000-0000-000000000001/' || %L || '.pdf', null) $$,
    pg_temp.id_doc('f1'), pg_temp.id_doc('f1')::text),
  'el worker cierra el pedido como generado'
);
select is(
  (select row(estado, ruta is not null, generado_en is not null, error)::text
     from dominio.comprobante_documentos where id = pg_temp.id_doc('f1')),
  '(generado,t,t,)', 'queda generado con su ruta y fecha'
);
select is(
  (select e.estado from public.ejecuciones_worker e
    where e.id = (select ejecucion_id from dominio.comprobante_documentos where id = pg_temp.id_doc('f1'))),
  'exitosa', 'el cierre también cierra la ejecución del ciclo de workers'
);
select lives_ok(
  format($$ select private.cerrar_documento_comprobante(%L, null, 'otro intento') $$, pg_temp.id_doc('f1')),
  'cerrar de nuevo es idempotente'
);
select is(
  (select estado from dominio.comprobante_documentos where id = pg_temp.id_doc('f1')),
  'generado', 'el segundo cierre no cambia el documento generado'
);
select throws_ok(
  format($$ select private.datos_documento_comprobante(%L) $$, pg_temp.id_doc('f1')),
  'P0001', null, 'un documento ya cerrado no entrega más datos al worker'
);

-- Reutilización (FR-005): pedir de nuevo devuelve el generado sin crear otro pedido.
select pg_temp.como('f1000000-0000-0000-0000-000000000002');
select is(
  (select (public.solicitar_documento_comprobante('b0000000-0000-0000-0000-000000000001', 'factura')).id),
  pg_temp.id_doc('f1'), 'con un PDF vigente se reutiliza el mismo documento'
);
reset role;
select is(
  (select count(*)::int from dominio.comprobante_documentos
    where comprobante_id = 'b0000000-0000-0000-0000-000000000001' and tipo_documento = 'factura'),
  1, 'reutilizar no crea otro pedido'
);

-- Archivo ausente en Storage: el documento deja de valer y se genera de nuevo.
-- (se renombra en vez de borrar: Storage bloquea el DELETE directo sobre storage.objects)
update storage.objects set name = name || '.ausente'
 where bucket_id = 'comprobantes-documentos' and name like '%' || pg_temp.id_doc('f1')::text || '.pdf';
select pg_temp.como('f1000000-0000-0000-0000-000000000002');
insert into docs (clave, id)
  select 'f1b', (public.solicitar_documento_comprobante('b0000000-0000-0000-0000-000000000001', 'factura')).id;
select isnt(pg_temp.id_doc('f1b'), pg_temp.id_doc('f1'), 'sin el archivo en Storage se crea un pedido nuevo');
reset role;
select is(
  (select estado from dominio.comprobante_documentos where id = pg_temp.id_doc('f1')),
  'fallido', 'el pedido sin archivo pasa a fallido'
);

-- Cierre fallido: error sanitizado.
select set_config('request.jwt.claims',
  json_build_object('sub', 'f1000000-0000-0000-0000-000000000001', 'role', 'authenticated')::text, false);
select lives_ok(
  format($$ select private.cerrar_documento_comprobante(%L, null, 'falló con password=abc123 en el host') $$, pg_temp.id_doc('f1b')),
  'el worker cierra como fallido'
);
select is(
  (select row(estado, ruta, error)::text from dominio.comprobante_documentos where id = pg_temp.id_doc('f1b')),
  '(fallido,,"No se pudo generar el documento")', 'un error con forma de secreto no se guarda: queda el mensaje genérico'
);
select is(
  (select e.estado from public.ejecuciones_worker e
    where e.id = (select ejecucion_id from dominio.comprobante_documentos where id = pg_temp.id_doc('f1b'))),
  'fallida', 'la ejecución queda fallida'
);

-- Un fallido permite pedir de nuevo (FR-006).
select pg_temp.como('f1000000-0000-0000-0000-000000000002');
insert into docs (clave, id)
  select 'f1c', (public.solicitar_documento_comprobante('b0000000-0000-0000-0000-000000000001', 'factura')).id;
select isnt(pg_temp.id_doc('f1c'), pg_temp.id_doc('f1b'), 'tras un fallido se crea un pedido nuevo (Reintentar)');

-- Un pendiente que ya no puede completarse pasa a fallido en la consulta (cierre perezoso).
reset role;
update dominio.comprobante_documentos set solicitado_en = now() - interval '11 minutes' where id = pg_temp.id_doc('f1c');
select pg_temp.como('f1000000-0000-0000-0000-000000000002');
select is(
  (select estado from public.obtener_documento_comprobante(pg_temp.id_doc('f1c'))),
  'fallido', 'un pendiente vencido pasa a fallido al consultarlo'
);

select * from finish();
rollback;
