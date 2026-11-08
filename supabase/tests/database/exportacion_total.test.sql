-- MSF-396 (F-OPS-06, MSF-224): exportación total de datos de la organización.
-- Cubre FR-030 (solicitud solo de administradores, idempotente), FR-031/FR-032 (lista permitida + exclusiones y
-- completitud contra el esquema real), FR-035 (lectura acotada a la organización de la ejecución), FR-036 (política
-- del bucket) y FR-040 (no administrador, `anon` y otra organización). SC-004.
-- El rol de conexión (postgres) no es superusuario en el CI y no puede simular el login del worker: las lecturas del
-- worker se hacen como dueño con el JWT de un administrador (lo que `autorizar_llamante_ciclo` acepta).
begin;

select plan(45);

insert into organizaciones (id, nombre) values
  ('11111111-1111-1111-1111-111111111111', 'Organización Uno'),
  ('22222222-2222-2222-2222-222222222222', 'Organización Dos');

insert into auth.users (id, email) values
  ('d9000000-0000-0000-0000-000000000001', 'superadmin@example.com'),
  ('d1000000-0000-0000-0000-000000000011', 'admin-uno@example.com'),
  ('d1000000-0000-0000-0000-000000000012', 'miembro-uno@example.com'),
  ('d2000000-0000-0000-0000-000000000011', 'admin-dos@example.com');

insert into usuarios_organizacion (user_id, organizacion_id, rol_id) values
  ('d1000000-0000-0000-0000-000000000011', '11111111-1111-1111-1111-111111111111', 'administrador'),
  ('d1000000-0000-0000-0000-000000000012', '11111111-1111-1111-1111-111111111111', 'miembro'),
  ('d2000000-0000-0000-0000-000000000011', '22222222-2222-2222-2222-222222222222', 'administrador');

-- Un superadmin con la organización Uno activa (acceso de soporte): puede operar la organización, pero NO exportar sus datos.
insert into superadmins (user_id) values ('d9000000-0000-0000-0000-000000000001');
insert into superadmin_organizacion_activa (user_id, organizacion_id)
values ('d9000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111');

insert into dominio.empresas (id, organizacion_id, nombre) values
  ('e1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'Tienda Total Uno'),
  ('e2000000-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', 'Tienda Total Dos');

-- Solo la organización Uno tiene la conexión de exportaciones (la Dos prueba SIN_CONEXION_EXPORTACION).
insert into sistemas_externos (id, descripcion)
values ('historial-ventas', 'Prueba de la exportación total')
on conflict (id) do nothing;
insert into conexiones (id, organizacion_id, sistema_externo, credencial_vault_id)
values ('c1000000-0000-0000-0000-0000000000c1', '11111111-1111-1111-1111-111111111111', 'historial-ventas', gen_random_uuid());
-- Capacidad de otro producto: una ejecución suya no puede leer la exportación total.
insert into capacidades_ejecucion (organizacion_id, conexion_id, clave, tiempo_max_seg)
values ('11111111-1111-1111-1111-111111111111', 'c1000000-0000-0000-0000-0000000000c1', 'otra-capacidad', 3600);

create function pg_temp.como(p_user uuid) returns void language plpgsql as $$
begin
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
  set local role authenticated;
end $$;

create function pg_temp.proceso() returns uuid language sql security definer as $$
  select p.id from public.procesos_masivos p
   where p.organizacion_id = '11111111-1111-1111-1111-111111111111' and p.funcionalidad = 'exportacion_total' limit 1
$$;
create function pg_temp.ejecucion() returns uuid language sql security definer as $$
  select p.ejecucion_id from public.procesos_masivos p
   where p.organizacion_id = '11111111-1111-1111-1111-111111111111' and p.funcionalidad = 'exportacion_total' limit 1
$$;
create function pg_temp.cantidad_procesos() returns integer language sql security definer as $$
  select count(*)::int from public.procesos_masivos p
   where p.organizacion_id = '11111111-1111-1111-1111-111111111111' and p.funcionalidad = 'exportacion_total'
$$;

-- ============================================================================
-- Permisos (FR-030, FR-035, FR-040)
-- ============================================================================

select ok(
  has_function_privilege('authenticated', 'public.solicitar_exportacion_total()', 'execute')
  and not has_function_privilege('anon', 'public.solicitar_exportacion_total()', 'execute'),
  'solicitar_exportacion_total: authenticated sí, anon no'
);

select ok(
  not has_function_privilege('authenticated', 'private.datos_exportacion_total(uuid)', 'execute')
  and not has_function_privilege('anon', 'private.datos_exportacion_total(uuid)', 'execute')
  and not has_function_privilege('authenticated', 'private.filas_exportacion_total(uuid, text, text, integer, integer)', 'execute')
  and not has_function_privilege('anon', 'private.filas_exportacion_total(uuid, text, text, integer, integer)', 'execute')
  and not has_function_privilege('authenticated', 'private.conjuntos_exportacion_total()', 'execute')
  and not has_function_privilege('anon', 'private.conjuntos_exportacion_total()', 'execute'),
  'las funciones de lectura de la exportación total no las ejecuta ni authenticated ni anon'
);

select ok(
  has_function_privilege('workers_orquestacion', 'private.datos_exportacion_total(uuid)', 'execute')
  and has_function_privilege('workers_orquestacion', 'private.filas_exportacion_total(uuid, text, text, integer, integer)', 'execute')
  and has_function_privilege('workers_orquestacion', 'private.conjuntos_exportacion_total()', 'execute'),
  'los workers ejecutan las funciones de lectura de la exportación total'
);

-- ============================================================================
-- Solicitud (FR-030, FR-040)
-- ============================================================================

select pg_temp.como('d1000000-0000-0000-0000-000000000012');
select throws_ok(
  $$ select * from public.solicitar_exportacion_total() $$,
  '42501', null, 'un miembro que no es administrador no puede pedir la exportación total'
);

select pg_temp.como('d9000000-0000-0000-0000-000000000001');
-- Precondiciones: sin ellas el rechazo de abajo podría ser solo «sin organización» y no probaría la restricción.
select is(private.organizacion_id(), '11111111-1111-1111-1111-111111111111'::uuid,
  'precondición: el superadmin tiene la organización Uno activa');
select ok(private.es_administrador_de('11111111-1111-1111-1111-111111111111'::uuid),
  'precondición: la regla anterior (es_administrador_de) SÍ lo dejaba pasar');
select throws_ok(
  $$ select * from public.solicitar_exportacion_total() $$,
  '42501', null, 'un superadmin con la organización activa NO puede pedir la exportación total de otra organización'
);
select is(pg_temp.cantidad_procesos(), 0, 'el pedido rechazado del superadmin no creó ningún proceso');
select ok(
  (select qual from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname = 'exportaciones_organizacion_select')
    ~ 'es_administrador_propio_de'
  and (select qual from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname = 'exportaciones_organizacion_select')
    !~ 'es_administrador_de\(',
  'la política de Storage del ZIP exige la membresía propia: un superadmin no lo descarga'
);

reset role;
set local role anon;
select throws_ok(
  $$ select * from public.solicitar_exportacion_total() $$,
  '42501', null, 'anon no puede pedir la exportación total'
);

select pg_temp.como('d2000000-0000-0000-0000-000000000011');
select throws_ok(
  $$ select * from public.solicitar_exportacion_total() $$,
  'P0001', null, 'sin la conexión de exportaciones la solicitud falla con SIN_CONEXION_EXPORTACION'
);

select pg_temp.como('d1000000-0000-0000-0000-000000000011');
select is(
  (select reutilizado from public.solicitar_exportacion_total()),
  false, 'el administrador pide la exportación total y nace una nueva'
);

reset role;
select is(pg_temp.cantidad_procesos(), 1, 'quedó un solo proceso de exportación total');
select is(
  (select p.tipo || '/' || p.estado || '/' || coalesce(p.empresa_id::text, 'sin-empresa') || '/' || (p.solicitado_por = 'd1000000-0000-0000-0000-000000000011')
     from public.procesos_masivos p where p.id = pg_temp.proceso()),
  'exportacion/pendiente/sin-empresa/true',
  'el proceso es una exportación pendiente, sin empresa y con su actor'
);
select is(
  (select count(*)::int from public.despachos_ejecucion d where d.ejecucion_id = pg_temp.ejecucion()),
  1, 'la orden de despacho para Kestra nace en la misma transacción'
);
select ok(
  (select cap.clave = 'exportar-organizacion-11111111-1111-1111-1111-111111111111'
     from public.ejecuciones_worker e join public.capacidades_ejecucion cap on cap.id = e.capacidad_id
    where e.id = pg_temp.ejecucion()),
  'la ejecución corre sobre la capacidad exportar-organizacion-<organización>'
);

select pg_temp.como('d1000000-0000-0000-0000-000000000011');
select is(
  (select r.reutilizado and r.proceso_id = pg_temp.proceso() from public.solicitar_exportacion_total() r),
  true, 'pedirla de nuevo con una abierta devuelve la misma (reutilizado)'
);
reset role;
select is(pg_temp.cantidad_procesos(), 1, 'pedirla de nuevo no crea otro proceso');

-- ============================================================================
-- Lista permitida, exclusiones y completitud (FR-031, FR-032)
-- ============================================================================

select cmp_ok(
  (select count(*)::int from private.conjuntos_exportacion_total()), '>', 50,
  'la lista permitida trae los conjuntos de negocio de dominio y public'
);
select ok(
  exists (select 1 from private.conjuntos_exportacion_total() where esquema = 'dominio' and tabla = 'productos')
  and exists (select 1 from private.conjuntos_exportacion_total() where esquema = 'dominio' and tabla = 'comprobantes_venta')
  and exists (select 1 from private.conjuntos_exportacion_total() where esquema = 'public' and tabla = 'clientes'),
  'incluye catálogo, ventas y clientes'
);
select is(
  (select count(*)::int from private.conjuntos_exportacion_total()
    where tabla in ('conexiones', 'conexiones_oauth', 'credenciales_mcp', 'ejecuciones_worker', 'despachos_ejecucion', 'avisos_pendientes', 'procesos_masivos')),
  0, 'no incluye credenciales, colas internas ni registros operativos'
);
select is(
  (select count(*)::int from private.conjuntos_exportacion_total() c, unnest(c.columnas) col
    where col ~* '(secret|token|password|passwd|api_?key|vault|credencial|private_key)'),
  0, 'ninguna columna exportada parece un secreto o un token'
);
select ok(
  not exists (select 1 from private.conjuntos_exportacion_total() where tabla = 'tiendas' and 'token_verificacion' = any(columnas))
  and exists (select 1 from private.conjuntos_exportacion_total() where tabla = 'tiendas' and 'dominio' = any(columnas)),
  'tiendas se exporta sin su token de verificación'
);
select is(
  (select count(*)::int
     from private.exclusiones_exportacion_total() x
     join private.conjuntos_exportacion_total() c on c.esquema = x.esquema and c.tabla = x.tabla),
  0, 'ninguna tabla está a la vez permitida y excluida'
);
select is(
  (select count(*)::int
     from private.exclusiones_exportacion_total() x
    where x.motivo is null or btrim(x.motivo) = ''),
  0, 'toda exclusión documenta su motivo'
);
select is(
  (select count(*)::int
     from private.exclusiones_exportacion_total() x
    where not exists (
      select 1 from pg_catalog.pg_class c join pg_catalog.pg_namespace n on n.oid = c.relnamespace
       where n.nspname = x.esquema and c.relname = x.tabla and c.relkind in ('r', 'p'))),
  0, 'toda exclusión nombra una tabla que existe'
);
-- Completitud: una tabla nueva con organizacion_id que no esté ni permitida ni excluida hace fallar esta prueba.
select is(
  (select coalesce(string_agg(c.table_schema || '.' || c.table_name, ', ' order by c.table_schema, c.table_name), '')
     from information_schema.columns c
     join information_schema.tables t on t.table_schema = c.table_schema and t.table_name = c.table_name and t.table_type = 'BASE TABLE'
    where c.table_schema in ('public', 'dominio')
      and c.column_name = 'organizacion_id'
      and not exists (select 1 from private.conjuntos_exportacion_total() k where k.esquema = c.table_schema and k.tabla = c.table_name)
      and not exists (select 1 from private.exclusiones_exportacion_total() x where x.esquema = c.table_schema and x.tabla = c.table_name)),
  '', 'toda tabla con organizacion_id de public y dominio está en la lista permitida o en las exclusiones'
);

-- ============================================================================
-- Lectura acotada a la organización de la ejecución (FR-035)
-- ============================================================================

-- El worker no tiene sesión: se simula con el JWT de un administrador de la organización dueña.
select set_config('request.jwt.claims',
  json_build_object('sub', 'd1000000-0000-0000-0000-000000000011', 'role', 'authenticated')::text, true);

select is(
  (select d.organizacion_id from private.datos_exportacion_total(pg_temp.ejecucion()) d),
  '11111111-1111-1111-1111-111111111111'::uuid, 'el worker obtiene la organización de su ejecución'
);
select is(
  (select d.proceso_id from private.datos_exportacion_total(pg_temp.ejecucion()) d),
  pg_temp.proceso(), 'y el proceso masivo que debe informar'
);
select is(
  (select d.conjuntos from private.datos_exportacion_total(pg_temp.ejecucion()) d),
  (select count(*)::int from private.conjuntos_exportacion_total()),
  'conjuntos = cantidad de la lista permitida (total del progreso)'
);

select ok(
  (select bool_and((f->>'organizacion_id')::uuid = '11111111-1111-1111-1111-111111111111')
          and count(*) filter (where f->>'nombre' = 'Tienda Total Uno') = 1
          and count(*) filter (where f->>'nombre' = 'Tienda Total Dos') = 0
     from jsonb_array_elements(private.filas_exportacion_total(pg_temp.ejecucion(), 'dominio', 'empresas', 0, 100)) f),
  'las filas son solo de la organización de la ejecución (no entra la empresa de la Dos)'
);
select is(
  jsonb_typeof(private.filas_exportacion_total(pg_temp.ejecucion(), 'dominio', 'empresas', 0, 100)),
  'array', 'la página es un arreglo de filas'
);
select is(
  jsonb_array_length(private.filas_exportacion_total(pg_temp.ejecucion(), 'dominio', 'empresas', 100000, 100)),
  0, 'una página más allá del final viene vacía'
);
select is(
  (select f->>'nombre'
     from jsonb_array_elements(private.filas_exportacion_total(pg_temp.ejecucion(), 'public', 'organizaciones', 0, 10)) f),
  'Organización Uno', 'la propia organización se exporta por su id'
);
select throws_ok(
  format($f$select private.filas_exportacion_total(%L, 'public', 'conexiones', 0, 10)$f$, pg_temp.ejecucion()),
  '22023', null, 'un conjunto fuera de la lista (conexiones) se rechaza'
);
select throws_ok(
  format($f$select private.filas_exportacion_total(%L, 'auth', 'users', 0, 10)$f$, pg_temp.ejecucion()),
  '22023', null, 'tampoco se lee auth.users'
);
select throws_ok(
  format($f$select private.filas_exportacion_total(%L, 'dominio', 'empresas', 0, 5001)$f$, pg_temp.ejecucion()),
  '22023', null, 'el lote tiene un tope'
);
select throws_ok(
  $$select * from private.datos_exportacion_total('99999999-9999-4999-8999-999999999999')$$,
  'P0001', null, 'una ejecución desconocida se rechaza'
);

-- Una ejecución de otra capacidad (aunque sea de la misma organización) no sirve para exportar.
select pg_temp.como('d1000000-0000-0000-0000-000000000011');
select lives_ok(
  $$ select public.iniciar_proceso_masivo('c1000000-0000-0000-0000-0000000000c1', 'otra-capacidad', 'exportacion', 'otra', 'Otra exportación') $$,
  'se crea una exportación de otra capacidad'
);
reset role;
select set_config('request.jwt.claims',
  json_build_object('sub', 'd1000000-0000-0000-0000-000000000011', 'role', 'authenticated')::text, true);
select throws_ok(
  $$select * from private.datos_exportacion_total((select e.id from public.ejecuciones_worker e join public.capacidades_ejecucion c on c.id = e.capacidad_id where c.clave = 'otra-capacidad' limit 1))$$,
  'P0001', null, 'la lectura exige la capacidad exportar-organizacion-*'
);

-- ============================================================================
-- Bucket y política de lectura (FR-036)
-- ============================================================================

select is(
  (select public::text || '/' || file_size_limit::text from storage.buckets where id = 'exportaciones-organizacion'),
  'false/524288000', 'el bucket exportaciones-organizacion es privado'
);

insert into storage.objects (bucket_id, name) values
  ('exportaciones-organizacion', '11111111-1111-1111-1111-111111111111/aaaaaaaa-0000-4000-8000-000000000001.zip'),
  ('exportaciones-organizacion', '22222222-2222-2222-2222-222222222222/aaaaaaaa-0000-4000-8000-000000000002.zip');

select pg_temp.como('d1000000-0000-0000-0000-000000000011');
select is(
  (select count(*)::int from storage.objects where bucket_id = 'exportaciones-organizacion'),
  1, 'el administrador solo ve el archivo de su organización'
);
select pg_temp.como('d1000000-0000-0000-0000-000000000012');
select is(
  (select count(*)::int from storage.objects where bucket_id = 'exportaciones-organizacion'),
  0, 'un miembro que no es administrador no ve ningún archivo'
);
select pg_temp.como('d2000000-0000-0000-0000-000000000011');
select is(
  (select count(*)::int from storage.objects
    where bucket_id = 'exportaciones-organizacion' and name like '11111111-1111-1111-1111-111111111111/%'),
  0, 'el administrador de otra organización no ve el archivo ajeno'
);
reset role;
set local role anon;
select is(
  (select count(*)::int from storage.objects where bucket_id = 'exportaciones-organizacion'),
  0, 'anon no ve ningún archivo'
);

reset role;
select * from finish();
rollback;
