-- F-VTA-37 (MSF-275, SC-001): tablas de archivo `historial_*`, solicitud de importación y funciones
-- del worker. Cubre: RLS por organización/empresa/sección, ninguna escritura posible desde la app,
-- `anon` sin acceso, ausencia de FKs y disparadores a tablas vivas (FR-008), bucket, permiso y
-- simultaneidad de `solicitar_importacion_historial`, `historial_ultimo_numero` y la inserción
-- idempotente por lotes.
-- Mismo criterio que ejecucion_en_curso_worker.test.sql: en Supabase local postgres no puede adoptar
-- el session_user de un `worker_*`, así que la lógica se prueba en los núcleos `*_core` (que reciben
-- la organización) y los wrappers se prueban por rechazo y por grants.
begin;

select plan(65);

-- ============================================================================
-- Fixture
-- ============================================================================

insert into organizaciones (id, nombre) values
  ('11111111-1111-1111-1111-111111111111', 'Organización Uno'),
  ('22222222-2222-2222-2222-222222222222', 'Organización Dos');

insert into dominio.empresas (id, organizacion_id, nombre) values
  ('e1000000-0000-0000-0000-00000000000a', '11111111-1111-1111-1111-111111111111', 'Tienda A'),
  ('e1000000-0000-0000-0000-00000000000b', '11111111-1111-1111-1111-111111111111', 'Tienda B'),
  ('e2000000-0000-0000-0000-00000000000c', '22222222-2222-2222-2222-222222222222', 'Tienda C');

insert into auth.users (id, email) values
  ('c1000000-0000-0000-0000-000000000001', 'admin-uno@example.com'),
  ('c1000000-0000-0000-0000-000000000002', 'mostrador@example.com'),
  ('c1000000-0000-0000-0000-000000000003', 'sin-ventas@example.com'),
  ('c2000000-0000-0000-0000-000000000001', 'admin-dos@example.com');

insert into usuarios_organizacion (user_id, organizacion_id, rol_id) values
  ('c1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'administrador'),
  ('c1000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'administracion'),
  ('c1000000-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111', 'consulta'),
  ('c2000000-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', 'administrador');

-- El mostrador solo tiene asignada la Tienda A (rol Mostrador allí, que edita Ventas).
insert into usuarios_empresas (user_id, empresa_id, organizacion_id, rol_id) values
  ('c1000000-0000-0000-0000-000000000002', 'e1000000-0000-0000-0000-00000000000a', '11111111-1111-1111-1111-111111111111', 'mostrador');
insert into usuario_empresa_activa (user_id, empresa_id) values
  ('c1000000-0000-0000-0000-000000000002', 'e1000000-0000-0000-0000-00000000000a');

-- Una persona sin acceso a Ventas: el rol Consulta de la organización 1 pierde la sección.
insert into permisos_rol (organizacion_id, rol_id, seccion, nivel) values
  ('11111111-1111-1111-1111-111111111111', 'consulta', 'ventas', 'ninguno')
on conflict (organizacion_id, rol_id, seccion) do update set nivel = 'ninguno';

-- Archivo histórico sembrado como postgres (el worker real escribe vía importar_historial_lote).
insert into dominio.historial_comprobantes (organizacion_id, empresa_id, numero, fecha, cliente_nombre, operador, estado_final, total) values
  ('11111111-1111-1111-1111-111111111111', 'e1000000-0000-0000-0000-00000000000a', 'A-0001-00018790', '2026-11-20', 'Valeria Sosa', 'Emilse', 'Cobrado', 57250),
  ('11111111-1111-1111-1111-111111111111', 'e1000000-0000-0000-0000-00000000000a', 'A-0001-00018842', '2026-11-29', 'Distribuidora Norte SRL', 'Javier', 'Cobrado', 412300),
  ('11111111-1111-1111-1111-111111111111', 'e1000000-0000-0000-0000-00000000000a', 'A-0001-00000999', '2020-01-05', 'Kiosco La Esquina', 'Emilse', 'Cobrado', 1000),
  ('11111111-1111-1111-1111-111111111111', 'e1000000-0000-0000-0000-00000000000b', 'B-0002-00000050', '2026-11-22', 'Electro Sur SRL', 'Javier', 'Deuda', 273300),
  ('22222222-2222-2222-2222-222222222222', 'e2000000-0000-0000-0000-00000000000c', 'A-0001-00018842', '2026-11-29', 'Cliente Dos', 'Operador Dos', 'Cobrado', 10);

insert into dominio.historial_cobros (organizacion_id, empresa_id, fecha, comprobante_numero, cliente_nombre, cuenta_cobro, aprobado_por, importe) values
  ('11111111-1111-1111-1111-111111111111', 'e1000000-0000-0000-0000-00000000000a', '2026-11-29', 'A-0001-00018842', 'Distribuidora Norte SRL', 'Banco Ejemplo ···4821', 'Administrador', 412300),
  ('11111111-1111-1111-1111-111111111111', 'e1000000-0000-0000-0000-00000000000a', '2026-11-20', 'A-0001-00018790', 'Valeria Sosa', 'Billetera virtual', 'Administrador', 57250),
  ('11111111-1111-1111-1111-111111111111', 'e1000000-0000-0000-0000-00000000000b', '2026-11-22', 'B-0002-00000050', 'Electro Sur SRL', 'Caja del local', 'Emilse', 100),
  ('22222222-2222-2222-2222-222222222222', 'e2000000-0000-0000-0000-00000000000c', '2026-11-29', 'A-0001-00018842', 'Cliente Dos', 'Caja', 'Dos', 10);

insert into dominio.historial_cotizaciones_dolar (organizacion_id, fecha, dolar_comprador, dolar_vendedor, cargo) values
  ('11111111-1111-1111-1111-111111111111', '2026-11-30', 1410, 1450, 'Administrador'),
  ('11111111-1111-1111-1111-111111111111', '2026-11-27', 1405, 1445, 'Administrador'),
  ('22222222-2222-2222-2222-222222222222', '2026-11-30', 1300, 1340, 'Dos');

-- Planillas ya subidas al bucket.
insert into storage.objects (bucket_id, name) values
  ('historial-importaciones', '11111111-1111-1111-1111-111111111111/comprobantes/ventas.csv'),
  ('historial-importaciones', '11111111-1111-1111-1111-111111111111/cobros/cobros.xlsx'),
  ('historial-importaciones', '11111111-1111-1111-1111-111111111111/cotizaciones/dolar.csv'),
  ('historial-importaciones', '11111111-1111-1111-1111-111111111111/comprobantes/notas.txt'),
  ('historial-importaciones', '22222222-2222-2222-2222-222222222222/comprobantes/ajena.csv');

create function pg_temp.como(p_user uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
  set local role authenticated;
end $$;

-- ============================================================================
-- Estructura y aislamiento del modelo (FR-001, FR-008)
-- ============================================================================

select has_table('dominio', 'historial_comprobantes', 'existe dominio.historial_comprobantes');
select has_table('dominio', 'historial_cobros', 'existe dominio.historial_cobros');
select has_table('dominio', 'historial_cotizaciones_dolar', 'existe dominio.historial_cotizaciones_dolar');

select is(
  (select count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'dominio' and c.relname like 'historial\_%' and c.relkind = 'r' and c.relrowsecurity),
  3::bigint, 'las tres tablas del historial tienen RLS activo'
);

select is(
  (select count(*) from pg_tables where schemaname = 'public' and tablename like 'historial\_%'),
  0::bigint, 'ninguna tabla del historial vive en public (Principio VII)'
);

select is(
  (select count(*) from pg_policies where schemaname = 'dominio' and tablename like 'historial\_%' and cmd <> 'SELECT'),
  0::bigint, 'sin políticas de insert/update/delete: nadie escribe desde la app'
);

select ok(
  not (select bool_or(has_table_privilege(r, t, p))
         from unnest(array['anon', 'authenticated']) r,
              unnest(array['dominio.historial_comprobantes', 'dominio.historial_cobros', 'dominio.historial_cotizaciones_dolar']) t,
              unnest(array['INSERT', 'UPDATE', 'DELETE', 'TRUNCATE']) p),
  'anon y authenticated no tienen insert/update/delete/truncate sobre el historial'
);

select ok(
  not (select bool_or(has_table_privilege('anon', t, 'SELECT'))
         from unnest(array['dominio.historial_comprobantes', 'dominio.historial_cobros', 'dominio.historial_cotizaciones_dolar']) t),
  'anon no lee el historial'
);

select is(
  (select array_agg(distinct n.nspname || '.' || c.relname order by n.nspname || '.' || c.relname)
     from pg_constraint k
     join pg_class c on c.oid = k.confrelid
     join pg_namespace n on n.oid = c.relnamespace
    where k.contype = 'f'
      and k.conrelid in ('dominio.historial_comprobantes'::regclass, 'dominio.historial_cobros'::regclass, 'dominio.historial_cotizaciones_dolar'::regclass)),
  array['dominio.empresas', 'public.organizaciones'],
  'FR-008: las únicas claves foráneas son organización y empresa (ninguna a tablas vivas)'
);

select is(
  (select count(*) from pg_trigger
    where tgrelid in ('dominio.historial_comprobantes'::regclass, 'dominio.historial_cobros'::regclass, 'dominio.historial_cotizaciones_dolar'::regclass)
      and not tgisinternal),
  0::bigint, 'FR-008: sin disparadores sobre el historial'
);

-- ============================================================================
-- Lectura: RLS por organización, empresa y sección (SC-001)
-- ============================================================================

select pg_temp.como('c1000000-0000-0000-0000-000000000001');
select is((select count(*) from dominio.historial_comprobantes), 4::bigint, 'Administrador: ve los comprobantes de todas las tiendas de su organización');
select is((select count(*) from dominio.historial_cobros), 3::bigint, 'Administrador: ve los cobros de todas las tiendas de su organización');
select is((select count(*) from dominio.historial_cotizaciones_dolar), 2::bigint, 'Administrador: ve las cotizaciones de su organización, no las de otra');

select pg_temp.como('c1000000-0000-0000-0000-000000000002');
select is((select count(*) from dominio.historial_comprobantes), 3::bigint, 'Mostrador de la Tienda A: solo comprobantes de su tienda');
select is((select count(*) from dominio.historial_cobros where empresa_id = 'e1000000-0000-0000-0000-00000000000b'), 0::bigint, 'Mostrador: ningún cobro de la Tienda B');
select is((select count(*) from dominio.historial_cotizaciones_dolar), 2::bigint, 'Mostrador: las cotizaciones son globales de la organización');

select pg_temp.como('c1000000-0000-0000-0000-000000000003');
select is(
  (select (select count(*) from dominio.historial_comprobantes) + (select count(*) from dominio.historial_cobros) + (select count(*) from dominio.historial_cotizaciones_dolar)),
  0::bigint, 'sin acceso a la sección Ventas: la base no devuelve filas'
);

select pg_temp.como('c2000000-0000-0000-0000-000000000001');
select is((select count(*) from dominio.historial_comprobantes), 1::bigint, 'otra organización: solo ve lo suyo (comprobantes)');
select is((select count(*) from dominio.historial_cotizaciones_dolar where fecha = '2026-11-27'), 0::bigint, 'otra organización: no ve cotizaciones ajenas');

-- ============================================================================
-- Escritura imposible desde la app (Escenario 5)
-- ============================================================================

select pg_temp.como('c1000000-0000-0000-0000-000000000001');
select throws_ok(
  $$insert into dominio.historial_comprobantes (organizacion_id, empresa_id, numero, fecha, cliente_nombre, operador, estado_final, total)
    values ('11111111-1111-1111-1111-111111111111', 'e1000000-0000-0000-0000-00000000000a', 'X-1', '2026-01-01', 'X', 'X', 'X', 1)$$,
  '42501', null, 'el Administrador no puede insertar en el historial'
);
select throws_ok(
  $$update dominio.historial_cobros set importe = 1$$,
  '42501', null, 'el Administrador no puede modificar el historial'
);
select throws_ok(
  $$delete from dominio.historial_cotizaciones_dolar$$,
  '42501', null, 'el Administrador no puede borrar del historial'
);
reset role;

-- ============================================================================
-- Bucket (FR-002)
-- ============================================================================

select is(
  (select public from storage.buckets where id = 'historial-importaciones'),
  false, 'el bucket historial-importaciones es privado'
);

select pg_temp.como('c1000000-0000-0000-0000-000000000001');
select is(
  (select count(*) from storage.objects where bucket_id = 'historial-importaciones'),
  4::bigint, 'el Administrador ve solo las planillas de su organización'
);
select throws_ok(
  $$insert into storage.objects (bucket_id, name) values ('historial-importaciones', '22222222-2222-2222-2222-222222222222/comprobantes/intruso.csv')$$,
  '42501', null, 'no se puede subir a la carpeta de otra organización'
);
select throws_ok(
  $$insert into storage.objects (bucket_id, name) values ('historial-importaciones', '11111111-1111-1111-1111-111111111111/comprobantes/malo.exe')$$,
  '42501', null, 'solo se admiten planillas .csv y .xlsx'
);
select lives_ok(
  $$insert into storage.objects (bucket_id, name) values ('historial-importaciones', '11111111-1111-1111-1111-111111111111/comprobantes/nueva.xlsx')$$,
  'el Administrador sube una planilla .xlsx a su carpeta'
);
select pg_temp.como('c1000000-0000-0000-0000-000000000002');
select is(
  (select count(*) from storage.objects where bucket_id = 'historial-importaciones'),
  0::bigint, 'quien no puede importar no ve las planillas'
);
select throws_ok(
  $$insert into storage.objects (bucket_id, name) values ('historial-importaciones', '11111111-1111-1111-1111-111111111111/comprobantes/mostrador.csv')$$,
  '42501', null, 'quien no puede importar no sube planillas'
);
reset role;

-- ============================================================================
-- historial_ultimo_numero (FR-009)
-- ============================================================================

select pg_temp.como('c1000000-0000-0000-0000-000000000001');
select is(
  public.historial_ultimo_numero('comprobantes', 'e1000000-0000-0000-0000-00000000000a'),
  'A-0001-00018842', 'último comprobante histórico de la Tienda A (por su parte numérica)'
);
select is(
  public.historial_ultimo_numero('cobros', 'e1000000-0000-0000-0000-00000000000b'),
  'B-0002-00000050', 'último número de cobro de la Tienda B'
);
select throws_ok(
  $$select public.historial_ultimo_numero('otro', 'e1000000-0000-0000-0000-00000000000a')$$,
  'P0001', null, 'tipo inválido rechazado'
);
select pg_temp.como('c1000000-0000-0000-0000-000000000002');
select is(
  public.historial_ultimo_numero('comprobantes', 'e1000000-0000-0000-0000-00000000000b'),
  null, 'una tienda no asignada devuelve null (RLS)'
);
reset role;

-- ============================================================================
-- Permisos de ejecución (anon sin nada; el worker solo sus dos funciones)
-- ============================================================================

select ok(
  not has_function_privilege('anon', 'public.solicitar_importacion_historial(text, text)', 'execute')
  and not has_function_privilege('anon', 'public.historial_ultimo_numero(text, uuid)', 'execute'),
  'anon no ejecuta las RPC del historial'
);
select ok(
  has_function_privilege('authenticated', 'public.solicitar_importacion_historial(text, text)', 'execute')
  and has_function_privilege('authenticated', 'public.historial_ultimo_numero(text, uuid)', 'execute'),
  'authenticated ejecuta las RPC del historial'
);
select ok(
  not has_function_privilege('authenticated', 'private.importar_historial_lote(uuid, text, jsonb)', 'execute')
  and not has_function_privilege('authenticated', 'private.historial_contexto_ejecucion(uuid)', 'execute')
  and not has_function_privilege('anon', 'private.importar_historial_lote(uuid, text, jsonb)', 'execute'),
  'la app no ejecuta las funciones del worker'
);
select ok(
  has_function_privilege('workers_orquestacion', 'private.importar_historial_lote(uuid, text, jsonb)', 'execute')
  and has_function_privilege('workers_orquestacion', 'private.historial_contexto_ejecucion(uuid)', 'execute'),
  'el grupo de workers ejecuta las dos funciones del importador'
);
select throws_ok(
  $$select * from private.importar_historial_lote('f1000000-0000-0000-0000-000000000001', 'comprobantes', '[]')$$,
  'P0001', null, 'un llamante que no es worker_* es rechazado'
);

-- ============================================================================
-- solicitar_importacion_historial (FR-003)
-- ============================================================================

select pg_temp.como('c1000000-0000-0000-0000-000000000001');
select ok(
  public.solicitar_importacion_historial('comprobantes', '11111111-1111-1111-1111-111111111111/comprobantes/ventas.csv') is not null,
  'el Administrador solicita la importación de comprobantes'
);
select throws_like(
  $$select public.solicitar_importacion_historial('comprobantes', '11111111-1111-1111-1111-111111111111/comprobantes/ventas.csv')$$,
  'YA_EN_CURSO%', 'una segunda importación simultánea del mismo tipo es rechazada'
);
select ok(
  public.solicitar_importacion_historial('cobros', '11111111-1111-1111-1111-111111111111/cobros/cobros.xlsx') is not null,
  'otro tipo sí puede correr en paralelo'
);
select throws_like(
  $$select public.solicitar_importacion_historial('otro', '11111111-1111-1111-1111-111111111111/otro/x.csv')$$,
  'TIPO_INVALIDO%', 'tipo inválido'
);
select throws_like(
  $$select public.solicitar_importacion_historial('comprobantes', '22222222-2222-2222-2222-222222222222/comprobantes/ajena.csv')$$,
  'ARCHIVO_INVALIDO%', 'no acepta la carpeta de otra organización'
);
select throws_like(
  $$select public.solicitar_importacion_historial('comprobantes', '11111111-1111-1111-1111-111111111111/comprobantes/notas.txt')$$,
  'ARCHIVO_INVALIDO%', 'no acepta una extensión que no sea .csv/.xlsx'
);
select throws_like(
  $$select public.solicitar_importacion_historial('comprobantes', '11111111-1111-1111-1111-111111111111/comprobantes/inexistente.csv')$$,
  'ARCHIVO_NO_ENCONTRADO%', 'el archivo debe existir en el bucket'
);
select ok(
  public.solicitar_importacion_historial('cotizaciones', '11111111-1111-1111-1111-111111111111/cotizaciones/dolar.csv') is not null,
  'el Administrador solicita la importación de cotizaciones'
);

select pg_temp.como('c1000000-0000-0000-0000-000000000002');
select throws_ok(
  $$select public.solicitar_importacion_historial('comprobantes', '11111111-1111-1111-1111-111111111111/comprobantes/ventas.csv')$$,
  '42501', null, 'sin permiso de escritura de la organización no se puede importar'
);
reset role;

-- Efectos: ejecución auditable (origen, actor, estado), despacho durable, conexión y capacidades.
select is(
  (select count(*) from ejecuciones_worker e
     where e.organizacion_id = '11111111-1111-1111-1111-111111111111'
       and e.origen = 'manual' and e.estado = 'en_curso'
       and e.actor = 'c1000000-0000-0000-0000-000000000001'),
  3::bigint, 'tres ejecuciones manuales en curso con su actor'
);
select is(
  (select count(*) from despachos_ejecucion d
     join ejecuciones_worker e on e.id = d.ejecucion_id
    where e.organizacion_id = '11111111-1111-1111-1111-111111111111'),
  3::bigint, 'cada solicitud encola su despacho durable'
);
select is(
  (select count(*) from conexiones where organizacion_id = '11111111-1111-1111-1111-111111111111' and sistema_externo = 'historial-importador'),
  1::bigint, 'la conexión del importador se crea una sola vez'
);
select is(
  (select count(*) from capacidades_ejecucion c join conexiones x on x.id = c.conexion_id
    where x.organizacion_id = '11111111-1111-1111-1111-111111111111' and x.sistema_externo = 'historial-importador'),
  3::bigint, 'una capacidad por tipo'
);

-- ============================================================================
-- Funciones del worker, vía sus núcleos (FR-006/FR-007)
-- ============================================================================

create temp table ej as
select (e.detalle ->> 'tipo') as tipo, e.id
from ejecuciones_worker e
where e.organizacion_id = '11111111-1111-1111-1111-111111111111' and e.detalle ? 'tipo';

select is(
  (select c.tipo from private.historial_contexto_core((select id from ej where tipo = 'comprobantes'), '11111111-1111-1111-1111-111111111111') c),
  'comprobantes', 'el worker obtiene el tipo de su ejecución'
);
select is(
  (select c.archivo from private.historial_contexto_core((select id from ej where tipo = 'comprobantes'), '11111111-1111-1111-1111-111111111111') c),
  '11111111-1111-1111-1111-111111111111/comprobantes/ventas.csv', 'y la ruta del archivo'
);
select ok(
  (select c.empresas from private.historial_contexto_core((select id from ej where tipo = 'comprobantes'), '11111111-1111-1111-1111-111111111111') c)
    @> '[{"id": "e1000000-0000-0000-0000-00000000000a", "nombre": "Tienda A"}]'::jsonb,
  'y las tiendas de la organización para resolver la columna Tienda'
);
select throws_like(
  $$select * from private.historial_contexto_core((select id from ej where tipo = 'comprobantes'), '22222222-2222-2222-2222-222222222222')$$,
  'EJECUCION_NO_EN_CURSO%', 'una ejecución de otra organización no se resuelve'
);

select is(
  (select (r.nuevas, r.existentes)::text from private.importar_historial_lote_core(
    (select id from ej where tipo = 'comprobantes'), '11111111-1111-1111-1111-111111111111', 'comprobantes',
    '[{"empresa_id":"e1000000-0000-0000-0000-00000000000a","numero":"A-0001-00019000","fecha":"2026-12-01","cliente_nombre":"Cliente Uno","cliente_numero":"123","operador":"Javier","estado_final":"Cobrado","total":1500.50},
      {"empresa_id":"e1000000-0000-0000-0000-00000000000b","numero":"B-0002-00000051","fecha":"2026-12-02","cliente_nombre":"Cliente Dos","cliente_numero":"","operador":"Emilse","estado_final":"Deuda","total":10}]'::jsonb) r),
  '(2,0)', 'primer lote de comprobantes: 2 nuevas, 0 existentes'
);
select is(
  (select (r.nuevas, r.existentes)::text from private.importar_historial_lote_core(
    (select id from ej where tipo = 'comprobantes'), '11111111-1111-1111-1111-111111111111', 'comprobantes',
    '[{"empresa_id":"e1000000-0000-0000-0000-00000000000a","numero":"A-0001-00019000","fecha":"2026-12-01","cliente_nombre":"Cliente Uno","cliente_numero":"123","operador":"Javier","estado_final":"Cobrado","total":1500.50},
      {"empresa_id":"e1000000-0000-0000-0000-00000000000b","numero":"B-0002-00000051","fecha":"2026-12-02","cliente_nombre":"Cliente Dos","cliente_numero":"","operador":"Emilse","estado_final":"Deuda","total":10}]'::jsonb) r),
  '(0,2)', 'reimportar el mismo lote no duplica: 0 nuevas, 2 existentes'
);
select is(
  (select count(*) from dominio.historial_comprobantes where numero in ('A-0001-00019000', 'B-0002-00000051')),
  2::bigint, 'el historial quedó con exactamente 2 filas nuevas'
);
select ok(
  (select cliente_numero is null from dominio.historial_comprobantes where numero = 'B-0002-00000051'),
  'cliente sin número en la planilla: se guarda solo el nombre'
);
select throws_like(
  $$select * from private.importar_historial_lote_core((select id from ej where tipo = 'comprobantes'), '11111111-1111-1111-1111-111111111111', 'cobros', '[]'::jsonb)$$,
  'EJECUCION_NO_EN_CURSO%', 'el lote debe ser del tipo de la ejecución'
);
select throws_like(
  $$select * from private.importar_historial_lote_core((select id from ej where tipo = 'comprobantes'), '11111111-1111-1111-1111-111111111111', 'comprobantes',
    '[{"empresa_id":"e2000000-0000-0000-0000-00000000000c","numero":"Z-1","fecha":"2026-12-01","cliente_nombre":"X","operador":"X","estado_final":"X","total":1}]'::jsonb)$$,
  'EMPRESA_INVALIDA%', 'no se importa a una tienda de otra organización'
);
select is(
  (select (r.nuevas, r.existentes)::text from private.importar_historial_lote_core(
    (select id from ej where tipo = 'cobros'), '11111111-1111-1111-1111-111111111111', 'cobros',
    '[{"empresa_id":"e1000000-0000-0000-0000-00000000000a","fecha":"2026-12-01","comprobante_numero":"A-0001-00019000","cliente_nombre":"Cliente Uno","cuenta_cobro":"Caja del local","aprobado_por":"Emilse","importe":1500.50}]'::jsonb) r),
  '(1,0)', 'lote de cobros: 1 nuevo'
);
select is(
  (select (r.nuevas, r.existentes)::text from private.importar_historial_lote_core(
    (select id from ej where tipo = 'cotizaciones'), '11111111-1111-1111-1111-111111111111', 'cotizaciones',
    '[{"fecha":"2026-12-01","dolar_comprador":1415,"dolar_vendedor":1455,"cargo":"Administrador"},
      {"fecha":"2026-11-30","dolar_comprador":1410,"dolar_vendedor":1450,"cargo":"Administrador"}]'::jsonb) r),
  '(1,1)', 'lote de cotizaciones: la fecha ya importada cuenta como existente'
);

-- Una ejecución cerrada ya no escribe.
update ejecuciones_worker set estado = 'exitosa', finalizada_en = clock_timestamp()
where id = (select id from ej where tipo = 'comprobantes');
select throws_like(
  $$select * from private.importar_historial_lote_core((select id from ej where tipo = 'comprobantes'), '11111111-1111-1111-1111-111111111111', 'comprobantes', '[]'::jsonb)$$,
  'EJECUCION_NO_EN_CURSO%', 'una ejecución cerrada no escribe más'
);

-- El resultado se ve en la consulta con el último número actualizado (FR-009).
select pg_temp.como('c1000000-0000-0000-0000-000000000001');
select is(
  public.historial_ultimo_numero('comprobantes', 'e1000000-0000-0000-0000-00000000000a'),
  'A-0001-00019000', 'el último número histórico refleja lo importado'
);
reset role;

select * from finish();

rollback;
