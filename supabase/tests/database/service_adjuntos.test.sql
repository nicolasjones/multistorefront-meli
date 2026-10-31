-- F-SVC-20 (MSF-134, épica MSF-124): fotos y adjuntos del equipo (SC-001).
-- Cubre FR-001, FR-002, FR-004, FR-005, FR-006 y FR-008: tabla sin escritura directa, bucket privado y
-- políticas de storage.objects, alta/baja, máximo de 20 (el bloqueo `for update` serializa cargas
-- simultáneas; la concurrencia real no cabe en una transacción), tipo/tamaño/ruta, anulada rechazada (55000),
-- entregada permitida, aislamiento entre organizaciones y por tienda, `anon` sin ejecución y actividad.
begin;

select no_plan();

insert into organizaciones (id, nombre) values
  ('11111111-1111-1111-1111-111111111111', 'Organización Uno'),
  ('22222222-2222-2222-2222-222222222222', 'Organización Dos');

insert into auth.users (id, email) values
  ('e1000000-0000-0000-0000-000000000001', 'administrador@example.com'),
  ('e1000000-0000-0000-0000-000000000002', 'operador@example.com'),
  ('e1000000-0000-0000-0000-000000000003', 'consulta@example.com'),
  ('e1000000-0000-0000-0000-000000000005', 'deposito@example.com'),
  ('e2000000-0000-0000-0000-000000000001', 'admin-dos@example.com');

insert into usuarios_organizacion (user_id, organizacion_id, rol_id, estado) values
  ('e1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'administrador', 'activo'),
  ('e1000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'operador', 'activo'),
  ('e1000000-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111', 'consulta', 'activo'),
  ('e1000000-0000-0000-0000-000000000005', '11111111-1111-1111-1111-111111111111', 'deposito', 'activo'),
  ('e2000000-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', 'administrador', 'activo');

insert into dominio.empresas (id, organizacion_id, nombre) values
  ('a1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'San Javucho'),
  ('a1000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'Mundo JC'),
  ('a2000000-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', 'Empresa Dos');

-- El operador y la consulta solo acceden a San Javucho.
insert into usuarios_empresas (user_id, empresa_id, organizacion_id, rol_id) values
  ('e1000000-0000-0000-0000-000000000002', 'a1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'operador'),
  ('e1000000-0000-0000-0000-000000000003', 'a1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'consulta');

insert into clientes (id, organizacion_id, numero, nombre, tipo, archivado_en) values
  ('c5000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 10, 'Distribuidora Norte', 'mayorista', null),
  ('c6000000-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', 10, 'Cliente de la Dos', 'minorista', null);

insert into dominio.productos (id, organizacion_id, nombre, sku, precio_lista, activo) values
  ('b1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'Pantalla Switch', 'PAN-1', 100, true),
  ('b1000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'Producto inactivo', 'INA-1', 100, false),
  ('b2000000-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', 'Producto de la Dos', 'DOS-1', 100, true);

create function pg_temp.como(p_user uuid) returns void language plpgsql as $$
begin
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
  set local role authenticated;
end $$;

create temp table datos as
  select
    (select id from dominio.modelos_equipo where organizacion_id = '11111111-1111-1111-1111-111111111111' and equipo = 'Nintendo Switch' and modelo = 'Estándar') as modelo_uno,
    (select id from dominio.estados_reparacion where organizacion_id = '11111111-1111-1111-1111-111111111111' and cierra order by orden limit 1) as cierra_uno;
grant select on datos to public;

create temp table reps (clave text primary key, id uuid);
grant select, insert on reps to public;



create temp table adj (clave text primary key, id uuid, ruta text);
grant select, insert on adj to public;

create function pg_temp.ruta(p_org text, p_rep uuid, p_n int) returns text language sql as $$
  select p_org || '/' || p_rep::text || '/' || ('00000000-0000-4000-8000-' || lpad(p_n::text, 12, '0')) || '.png' $$;

-- ============================================================================
-- Diseño, privilegios y bucket (FR-001, FR-002)
-- ============================================================================

select ok((select relrowsecurity from pg_class where oid = 'dominio.reparacion_adjuntos'::regclass),
  'reparacion_adjuntos tiene RLS activada');
select is(
  (select count(*) from information_schema.role_table_grants
    where table_schema = 'dominio' and table_name = 'reparacion_adjuntos'
      and grantee in ('anon', 'authenticated', 'PUBLIC') and privilege_type <> 'SELECT')::int,
  0, 'reparacion_adjuntos no admite escritura directa');
select is(
  (select count(*) from information_schema.role_table_grants
    where table_schema = 'dominio' and table_name = 'reparacion_adjuntos' and grantee = 'anon')::int,
  0, 'anon no tiene privilegios sobre reparacion_adjuntos');
select is(
  (select array_agg(column_name::text order by column_name) from information_schema.columns
    where table_schema = 'dominio' and table_name = 'reparacion_adjuntos'),
  array['bytes', 'creado_en', 'creado_por', 'id', 'mime', 'nombre_original', 'organizacion_id', 'reparacion_id', 'ruta'],
  'columnas de FR-001');
select ok(exists (select 1 from pg_constraint where conrelid = 'dominio.reparacion_adjuntos'::regclass
    and contype = 'f' and pg_get_constraintdef(oid) like 'FOREIGN KEY (reparacion_id, organizacion_id)%'),
  'FK compuesta (reparacion_id, organizacion_id)');
select ok(exists (select 1 from pg_constraint where conrelid = 'dominio.reparacion_adjuntos'::regclass
    and contype = 'u' and pg_get_constraintdef(oid) = 'UNIQUE (ruta)'), 'ruta única');
select is(
  (select count(*) from unnest(array[
    'public.registrar_adjunto_reparacion(uuid,text,text,text,integer)',
    'public.quitar_adjunto_reparacion(uuid)',
    'public.listar_adjuntos_reparacion(uuid)'
  ]) f where has_function_privilege('anon', f::regprocedure, 'execute'))::int,
  0, 'anon no ejecuta las RPC de adjuntos');
select is(
  (select count(*) from unnest(array[
    'public.registrar_adjunto_reparacion(uuid,text,text,text,integer)',
    'public.quitar_adjunto_reparacion(uuid)',
    'public.listar_adjuntos_reparacion(uuid)'
  ]) f where has_function_privilege('authenticated', f::regprocedure, 'execute'))::int,
  3, 'authenticated ejecuta las tres RPC de adjuntos');
select ok((select prosrc like '%for update%' from pg_proc where oid = 'private.bloquear_reparacion_para_adjuntos(uuid)'::regprocedure),
  'la compuerta bloquea la reparación (for update): dos cargas simultáneas se serializan');
select ok((select prosrc like '%bloquear_reparacion_para_adjuntos%' and prosrc like '%>= 20%'
             from pg_proc where oid = 'public.registrar_adjunto_reparacion(uuid,text,text,text,integer)'::regprocedure),
  'el máximo de 20 se cuenta después del bloqueo');
select is(
  (select row(public, file_size_limit, allowed_mime_types)::text from storage.buckets where id = 'reparacion-adjuntos'),
  row(false, 5242880::bigint, array['image/jpeg', 'image/png', 'image/webp'])::text,
  'bucket privado, 5 MB, JPG/PNG/WebP');
select is(
  (select array_agg(cmd order by cmd) from pg_policies
    where schemaname = 'storage' and tablename = 'objects' and policyname like 'reparacion_adjuntos_%'),
  array['DELETE', 'INSERT', 'SELECT'], 'políticas select/insert/delete y ninguna update');

-- ============================================================================
-- Alta y baja
-- ============================================================================

select pg_temp.como('e1000000-0000-0000-0000-000000000001');

insert into reps (clave, id)
select 'r1', (public.crear_reparacion('a1000000-0000-0000-0000-000000000001', 'c5000000-0000-0000-0000-000000000001', (select modelo_uno from datos))->>'id')::uuid;
insert into reps (clave, id)
select 'r2', (public.crear_reparacion('a1000000-0000-0000-0000-000000000001', 'c5000000-0000-0000-0000-000000000001', (select modelo_uno from datos))->>'id')::uuid;
insert into reps (clave, id)
select 'otra_tienda', (public.crear_reparacion('a1000000-0000-0000-0000-000000000002', 'c5000000-0000-0000-0000-000000000001', (select modelo_uno from datos))->>'id')::uuid;
insert into reps (clave, id)
select 'entregada', (public.crear_reparacion('a1000000-0000-0000-0000-000000000001', 'c5000000-0000-0000-0000-000000000001', (select modelo_uno from datos))->>'id')::uuid;
insert into reps (clave, id)
select 'anulada', (public.crear_reparacion('a1000000-0000-0000-0000-000000000001', 'c5000000-0000-0000-0000-000000000001', (select modelo_uno from datos))->>'id')::uuid;

-- Los objetos los sube el cliente: el administrador sube con su sesión (política de insert).
insert into storage.objects (bucket_id, name, owner)
select 'reparacion-adjuntos', pg_temp.ruta('11111111-1111-1111-1111-111111111111', id, n), 'e1000000-0000-0000-0000-000000000001'
  from reps cross join generate_series(1, 21) n where clave = 'r1';
insert into storage.objects (bucket_id, name, owner)
select 'reparacion-adjuntos', pg_temp.ruta('11111111-1111-1111-1111-111111111111', id, n), 'e1000000-0000-0000-0000-000000000001'
  from reps cross join generate_series(1, 2) n where clave in ('r2', 'otra_tienda', 'entregada', 'anulada');

select is((select count(*)::int from storage.objects where bucket_id = 'reparacion-adjuntos'), 29,
  'el administrador sube bajo el prefijo de su organización y de reparaciones propias');
select throws_ok(
  $$insert into storage.objects (bucket_id, name, owner) values
      ('reparacion-adjuntos', '22222222-2222-2222-2222-222222222222/00000000-0000-4000-8000-000000000001/00000000-0000-4000-8000-000000000001.png', 'e1000000-0000-0000-0000-000000000001')$$,
  '42501', null, 'no sube bajo el prefijo de otra organización');
select throws_ok(
  $$insert into storage.objects (bucket_id, name, owner) values
      ('reparacion-adjuntos', '11111111-1111-1111-1111-111111111111/00000000-0000-4000-8000-000000000001/x.png', 'e1000000-0000-0000-0000-000000000001')$$,
  '42501', null, 'no sube sobre una reparación inexistente');
select throws_ok(
  format($$insert into storage.objects (bucket_id, name, owner) values ('reparacion-adjuntos', '11111111-1111-1111-1111-111111111111/%s/x.exe', 'e1000000-0000-0000-0000-000000000001')$$, (select id from reps where clave = 'r1')),
  '42501', null, 'no sube con extensión no permitida');

insert into adj (clave, id, ruta)
select 'a1', (public.registrar_adjunto_reparacion(r.id, pg_temp.ruta('11111111-1111-1111-1111-111111111111', r.id, 1), '  frente.png  ', 'image/png', 1000)->>'id')::uuid,
       pg_temp.ruta('11111111-1111-1111-1111-111111111111', r.id, 1)
  from reps r where clave = 'r1';

select is((select nombre_original from dominio.reparacion_adjuntos where id = (select id from adj where clave = 'a1')),
  'frente.png', 'registra el adjunto con el nombre recortado');
select is(jsonb_array_length(public.listar_adjuntos_reparacion((select id from reps where clave = 'r1'))), 1, 'lista el adjunto');
select ok(not (public.listar_adjuntos_reparacion((select id from reps where clave = 'r1'))::text like '%@%'),
  'la lista no expone el correo');
select is(public.listar_adjuntos_reparacion((select id from reps where clave = 'r1'))->0->>'subido_por', 'Usuario sin nombre',
  'sin nombre en el perfil, el nombre visible es un texto neutro');
select is(public.listar_adjuntos_reparacion((select id from reps where clave = 'r2')), '[]'::jsonb, 'sin adjuntos devuelve lista vacía');

-- Validaciones (22023 con hint).
select throws_ok(format($$select public.registrar_adjunto_reparacion(%L, %L, 'x.png', 'image/png', 10)$$,
  (select id from reps where clave = 'r2'), pg_temp.ruta('11111111-1111-1111-1111-111111111111', (select id from reps where clave = 'r1'), 2)),
  '22023', null, 'ruta de otra reparación rechazada');
select throws_ok(format($$select public.registrar_adjunto_reparacion(%L, %L, 'x.png', 'image/png', 10)$$,
  (select id from reps where clave = 'r2'), pg_temp.ruta('22222222-2222-2222-2222-222222222222', (select id from reps where clave = 'r2'), 1)),
  '22023', null, 'ruta de otra organización rechazada');
select throws_ok(format($$select public.registrar_adjunto_reparacion(%L, %L, 'x.png', 'image/png', 10)$$,
  (select id from reps where clave = 'r2'), pg_temp.ruta('11111111-1111-1111-1111-111111111111', (select id from reps where clave = 'r2'), 9)),
  '22023', null, 'objeto inexistente en Storage rechazado');
select throws_ok(format($$select public.registrar_adjunto_reparacion(%L, %L, 'x.gif', 'image/gif', 10)$$,
  (select id from reps where clave = 'r2'), pg_temp.ruta('11111111-1111-1111-1111-111111111111', (select id from reps where clave = 'r2'), 1)),
  '22023', null, 'tipo no permitido rechazado');
select throws_ok(format($$select public.registrar_adjunto_reparacion(%L, %L, 'x.png', 'image/png', 5242881)$$,
  (select id from reps where clave = 'r2'), pg_temp.ruta('11111111-1111-1111-1111-111111111111', (select id from reps where clave = 'r2'), 1)),
  '22023', null, 'más de 5 MB rechazado');
select throws_ok(format($$select public.registrar_adjunto_reparacion(%L, %L, '  ', 'image/png', 10)$$,
  (select id from reps where clave = 'r2'), pg_temp.ruta('11111111-1111-1111-1111-111111111111', (select id from reps where clave = 'r2'), 1)),
  '22023', null, 'nombre vacío rechazado');
select throws_ok(format($$select public.registrar_adjunto_reparacion(%L, %L, 'x.png', 'image/png', 10)$$,
  (select id from reps where clave = 'r1'), pg_temp.ruta('11111111-1111-1111-1111-111111111111', (select id from reps where clave = 'r1'), 1)),
  '22023', null, 'registrar dos veces la misma ruta se rechaza');

-- Máximo de 20.
select public.registrar_adjunto_reparacion(r.id, pg_temp.ruta('11111111-1111-1111-1111-111111111111', r.id, n), 'f' || n || '.png', 'image/png', 100)
  from reps r cross join generate_series(2, 20) n where clave = 'r1';
select is((select count(*)::int from dominio.reparacion_adjuntos where reparacion_id = (select id from reps where clave = 'r1')), 20,
  'una reparación llega a 20 adjuntos');
select throws_ok(format($$select public.registrar_adjunto_reparacion(%L, %L, 'f21.png', 'image/png', 100)$$,
  (select id from reps where clave = 'r1'), pg_temp.ruta('11111111-1111-1111-1111-111111111111', (select id from reps where clave = 'r1'), 21)),
  '22023', null, 'el adjunto 21 se rechaza');

-- Quitar.
select is((public.quitar_adjunto_reparacion((select id from adj where clave = 'a1')))->>'ruta', (select ruta from adj where clave = 'a1'),
  'quitar devuelve la ruta para borrar el objeto');
select is((select count(*)::int from dominio.reparacion_adjuntos where id = (select id from adj where clave = 'a1')), 0, 'la fila se borró');
select throws_ok($$select public.quitar_adjunto_reparacion(gen_random_uuid())$$, 'P0002', null, 'quitar un adjunto inexistente es P0002');
select lives_ok(format($$delete from storage.objects where bucket_id = 'reparacion-adjuntos' and name = %L$$, (select ruta from adj where clave = 'a1')),
  'el administrador borra el objeto');

-- Situación: entregada permitida, anulada rechazada.
select public.registrar_entrega_reparacion((select id from reps where clave = 'entregada'), (select cierra_uno from datos),
  (now() at time zone 'America/Argentina/Buenos_Aires')::date, 'Ana');
select lives_ok(format($$select public.registrar_adjunto_reparacion(%L, %L, 'e.png', 'image/png', 10)$$,
  (select id from reps where clave = 'entregada'), pg_temp.ruta('11111111-1111-1111-1111-111111111111', (select id from reps where clave = 'entregada'), 1)),
  'una reparación entregada admite fotos');
insert into adj (clave, id, ruta)
select 'anu', (public.registrar_adjunto_reparacion(r.id, pg_temp.ruta('11111111-1111-1111-1111-111111111111', r.id, 1), 'a.png', 'image/png', 10)->>'id')::uuid,
       pg_temp.ruta('11111111-1111-1111-1111-111111111111', r.id, 1)
  from reps r where clave = 'anulada';
select public.anular_reparacion((select id from reps where clave = 'anulada'), 'Duplicada');
select throws_ok(format($$select public.registrar_adjunto_reparacion(%L, %L, 'b.png', 'image/png', 10)$$,
  (select id from reps where clave = 'anulada'), pg_temp.ruta('11111111-1111-1111-1111-111111111111', (select id from reps where clave = 'anulada'), 2)),
  '55000', null, 'anulada: no se registra');
select throws_ok(format($$select public.quitar_adjunto_reparacion(%L)$$, (select id from adj where clave = 'anu')),
  '55000', null, 'anulada: no se quita');
select is(jsonb_array_length(public.listar_adjuntos_reparacion((select id from reps where clave = 'anulada'))), 1, 'anulada: sigue listándose');

-- ============================================================================
-- Permisos, tiendas y aislamiento
-- ============================================================================

-- Adjunto en la tienda B (el operador no accede a ella).
insert into adj (clave, id, ruta)
select 'tiendaB', (public.registrar_adjunto_reparacion(r.id, pg_temp.ruta('11111111-1111-1111-1111-111111111111', r.id, 1), 'b.png', 'image/png', 10)->>'id')::uuid,
       pg_temp.ruta('11111111-1111-1111-1111-111111111111', r.id, 1)
  from reps r where clave = 'otra_tienda';

-- Operador: edita en su tienda, no ve la otra.
select pg_temp.como('e1000000-0000-0000-0000-000000000002');
select lives_ok(format($$select public.registrar_adjunto_reparacion(%L, %L, 'o.png', 'image/png', 10)$$,
  (select id from reps where clave = 'r2'), pg_temp.ruta('11111111-1111-1111-1111-111111111111', (select id from reps where clave = 'r2'), 1)),
  'el operador (edicion) registra en su tienda');
select throws_ok(format($$select public.registrar_adjunto_reparacion(%L, %L, 'o.png', 'image/png', 10)$$,
  (select id from reps where clave = 'otra_tienda'), pg_temp.ruta('11111111-1111-1111-1111-111111111111', (select id from reps where clave = 'otra_tienda'), 2)),
  'P0002', null, 'tienda inaccesible: se trata como inexistente');
select throws_ok(format($$select public.listar_adjuntos_reparacion(%L)$$, (select id from reps where clave = 'otra_tienda')),
  'P0002', null, 'tienda inaccesible: no se lista');
select throws_ok(format($$select public.quitar_adjunto_reparacion(%L)$$, (select id from adj where clave = 'tiendaB')),
  'P0002', null, 'tienda inaccesible: no se quita');
select is((select count(*)::int from dominio.reparacion_adjuntos where reparacion_id = (select id from reps where clave = 'otra_tienda')), 0,
  'tienda inaccesible: la tabla no devuelve filas');
select is((select count(*)::int from storage.objects where bucket_id = 'reparacion-adjuntos' and name like '%' || (select id::text from reps where clave = 'otra_tienda') || '%'), 0,
  'tienda inaccesible: storage.objects no devuelve objetos');
select is((select count(*)::int from storage.objects where bucket_id = 'reparacion-adjuntos' and name like '%' || (select id::text from reps where clave = 'r2') || '%'), 3,
  'tienda accesible: storage.objects devuelve los objetos');
select throws_ok(format($$insert into storage.objects (bucket_id, name, owner) values ('reparacion-adjuntos', %L, 'e1000000-0000-0000-0000-000000000002')$$,
  pg_temp.ruta('11111111-1111-1111-1111-111111111111', (select id from reps where clave = 'otra_tienda'), 7)),
  '42501', null, 'tienda inaccesible: no sube');

-- Consulta (lectura): lista pero no modifica.
select pg_temp.como('e1000000-0000-0000-0000-000000000003');
select is(jsonb_array_length(public.listar_adjuntos_reparacion((select id from reps where clave = 'r2'))), 1, 'lectura lista los adjuntos');
select throws_ok(format($$select public.registrar_adjunto_reparacion(%L, %L, 'c.png', 'image/png', 10)$$,
  (select id from reps where clave = 'r2'), pg_temp.ruta('11111111-1111-1111-1111-111111111111', (select id from reps where clave = 'r2'), 2)),
  '42501', null, 'lectura no registra');
select throws_ok(format($$select public.quitar_adjunto_reparacion(%L)$$, (select id from adj where clave = 'anu')),
  '42501', null, 'lectura no quita');
select throws_ok(format($$insert into storage.objects (bucket_id, name, owner) values ('reparacion-adjuntos', %L, 'e1000000-0000-0000-0000-000000000003')$$,
  pg_temp.ruta('11111111-1111-1111-1111-111111111111', (select id from reps where clave = 'r2'), 7)),
  '42501', null, 'lectura no sube al bucket');
select is((select count(*)::int from storage.objects where bucket_id = 'reparacion-adjuntos' and name like '%' || (select id::text from reps where clave = 'r2') || '%'), 3,
  'lectura lee los objetos de su tienda');
select pg_temp.como('e1000000-0000-0000-0000-000000000003');
delete from storage.objects where bucket_id = 'reparacion-adjuntos' and name like '%' || (select id::text from reps where clave = 'r2') || '%';
select is((select count(*)::int from storage.objects where bucket_id = 'reparacion-adjuntos' and name like '%' || (select id::text from reps where clave = 'r2') || '%'), 3,
  'lectura no borra objetos');

-- Depósito: sin acceso a Service.
select pg_temp.como('e1000000-0000-0000-0000-000000000005');
select throws_ok(format($$select public.listar_adjuntos_reparacion(%L)$$, (select id from reps where clave = 'r2')),
  '42501', null, 'sin permiso de Service no lista');

-- Otra organización.
select pg_temp.como('e2000000-0000-0000-0000-000000000001');
select throws_ok(format($$select public.listar_adjuntos_reparacion(%L)$$, (select id from reps where clave = 'r2')),
  'P0002', null, 'otra organización no lista');
select throws_ok(format($$select public.quitar_adjunto_reparacion(%L)$$, (select id from adj where clave = 'anu')),
  'P0002', null, 'otra organización no quita');
select is((select count(*)::int from dominio.reparacion_adjuntos), 0, 'otra organización no ve filas');
select is((select count(*)::int from storage.objects where bucket_id = 'reparacion-adjuntos'), 0, 'otra organización no ve objetos (ni conociendo la ruta)');

-- anon.
reset role;
select set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);
set local role anon;
select throws_ok(format($$select public.listar_adjuntos_reparacion(%L)$$, (select id from reps where clave = 'r2')),
  '42501', null, 'anon no ejecuta listar_adjuntos_reparacion');
select throws_ok($$select count(*) from dominio.reparacion_adjuntos$$, '42501', null, 'anon no lee reparacion_adjuntos');
select is((select count(*)::int from storage.objects where bucket_id = 'reparacion-adjuntos'), 0, 'anon no ve objetos');
reset role;

-- Actividad.
select is((select count(*)::int from public.registro_actividad where tipo = 'reparacion.adjunto_agregado' and organizacion_id = '11111111-1111-1111-1111-111111111111'), 25,
  'cada alta deja actividad (20 + entregada + anulada + tienda B + operador)');
select is((select count(*)::int from public.registro_actividad where tipo = 'reparacion.adjunto_quitado' and organizacion_id = '11111111-1111-1111-1111-111111111111'), 1,
  'cada baja deja actividad');
select ok((select bool_and(detalle ~ 'R-[0-9]+' and detalle !~* '[0-9a-f]{8}-[0-9a-f]{4}') from public.registro_actividad where tipo like 'reparacion.adjunto_%'),
  'el detalle usa el código visible, no ids');
select is((select count(*)::int from public.registro_actividad where tipo like 'reparacion.adjunto_%' and empresa_id is null), 0,
  'la actividad lleva la tienda de la reparación');

-- RLS en todas las tablas expuestas.
select is(
  (select count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname in ('public', 'dominio') and c.relkind = 'r' and not c.relrowsecurity)::int,
  0, 'toda tabla de public y dominio tiene RLS (incluida reparacion_adjuntos)');

select * from finish();
rollback;
