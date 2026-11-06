-- MSF-375 (F-CAT-10, SC-101): importación de productos desde CSV.
-- Cubre: tablas `dominio.importaciones_productos*` (esquema, RLS, solo lectura para el Administrador,
-- `anon` sin privilegios), `validar_importacion_productos` (reglas de FR-105, costo sin Rentabilidad
-- de FR-106), `solicitar_importacion_productos` (permiso, límite de filas, idempotencia por clave,
-- encolado en la outbox, serialización de FR-109), `obtener_importacion_productos` (estados de
-- FR-111, aislamiento) y las funciones del worker (aplicar fila, celda vacía, escalas, tiendas,
-- reintento sin duplicar, cierre y despacho de la siguiente).
-- El fixture corre como postgres (RLS no aplica); las verificaciones de la app, con el rol que
-- corresponda. Las llamadas del worker se hacen como postgres (dueño de las funciones, que no es
-- superusuario en el CI) identificado como administrador por JWT: el gate de rol `worker_*` se
-- verifica con has_function_privilege, igual que en historial_importacion.test.sql.
begin;

select plan(66);

insert into organizaciones (id, nombre) values
  ('11111111-1111-1111-1111-111111111111', 'Organización Uno'),
  ('22222222-2222-2222-2222-222222222222', 'Organización Dos');

insert into auth.users (id, email) values
  ('d1000000-0000-0000-0000-000000000011', 'admin-uno@example.com'),
  ('d1000000-0000-0000-0000-000000000012', 'miembro-uno@example.com'),
  ('d2000000-0000-0000-0000-000000000011', 'admin-dos@example.com');

insert into usuarios_organizacion (user_id, organizacion_id, rol_id) values
  ('d1000000-0000-0000-0000-000000000011', '11111111-1111-1111-1111-111111111111', 'administrador'),
  ('d1000000-0000-0000-0000-000000000012', '11111111-1111-1111-1111-111111111111', 'miembro'),
  ('d2000000-0000-0000-0000-000000000011', '22222222-2222-2222-2222-222222222222', 'administrador');

insert into dominio.empresas (id, organizacion_id, nombre) values
  ('a1000000-0000-0000-0000-0000000000a1', '11111111-1111-1111-1111-111111111111', 'San Javucho'),
  ('a1000000-0000-0000-0000-0000000000a2', '11111111-1111-1111-1111-111111111111', 'Mundo JC'),
  ('a2000000-0000-0000-0000-0000000000a1', '22222222-2222-2222-2222-222222222222', 'Empresa Dos');

insert into dominio.categorias (id, organizacion_id, nombre, padre_id) values
  ('c1000000-0000-0000-0000-0000000000c1', '11111111-1111-1111-1111-111111111111', 'Accesorios', null);
insert into dominio.categorias (id, organizacion_id, nombre, padre_id) values
  ('c1000000-0000-0000-0000-0000000000c2', '11111111-1111-1111-1111-111111111111', 'Vidrios', 'c1000000-0000-0000-0000-0000000000c1');

insert into dominio.productos (id, organizacion_id, nombre, sku, precio_lista, codigo_barras) values
  ('b1000000-0000-0000-0000-0000000000b1', '11111111-1111-1111-1111-111111111111', 'Producto existente', 'EXI-1', 100, null),
  ('b1000000-0000-0000-0000-0000000000b2', '11111111-1111-1111-1111-111111111111', 'Producto con barras', 'EXI-2', 100, '7790000000012');

-- Conexión del importador. El catálogo lo crea la RPC al primer uso; el fixture lo inserta para
-- poder crear la conexión directamente (la FK exige que exista).
insert into sistemas_externos (id, descripcion)
values ('importar-productos', 'Importación de productos desde CSV, sin sistema externo real')
on conflict (id) do nothing;
insert into conexiones (id, organizacion_id, sistema_externo, credencial_vault_id) values
  ('c1000000-0000-0000-0000-0000000000d1', '11111111-1111-1111-1111-111111111111', 'importar-productos', gen_random_uuid());

-- Claves de importación de los casos.
-- k1: lote principal · k2: segunda importación (queda en cola) · k3: lote solo con errores.
insert into storage.objects (bucket_id, name) values
  ('productos-importaciones', '11111111-1111-1111-1111-111111111111/0a000000-0000-0000-0000-000000000001/subida.jpg');

create function pg_temp.como(p_user uuid) returns void language plpgsql as $$
begin
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
  set local role authenticated;
end $$;

-- ============================================================================
-- Estructura (FR-112, Principio VII)
-- ============================================================================

select is(
  (select count(*)::int from pg_tables where schemaname = 'dominio' and tablename like 'importaciones\_productos%'),
  2,
  'las dos tablas de la importación viven en el esquema dominio'
);

select is(
  (select count(*)::int from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'dominio' and c.relname like 'importaciones\_productos%' and c.relrowsecurity),
  2,
  'las dos tablas de la importación tienen RLS activado'
);

select ok(
  not has_table_privilege('anon', 'dominio.importaciones_productos', 'select')
  and not has_table_privilege('anon', 'dominio.importaciones_productos_filas', 'select'),
  'anon no tiene privilegios sobre las tablas de la importación'
);

select ok(
  not has_table_privilege('authenticated', 'dominio.importaciones_productos', 'insert')
  and not has_table_privilege('authenticated', 'dominio.importaciones_productos_filas', 'update'),
  'authenticated no escribe las tablas de la importación (solo las RPC y el worker)'
);

select ok(
  not has_function_privilege('anon', 'public.validar_importacion_productos(jsonb, uuid)', 'execute')
  and not has_function_privilege('anon', 'public.solicitar_importacion_productos(jsonb, uuid)', 'execute')
  and not has_function_privilege('anon', 'public.obtener_importacion_productos(uuid)', 'execute'),
  'anon no ejecuta ninguna RPC de la importación'
);

select ok(
  has_function_privilege('authenticated', 'public.solicitar_importacion_productos(jsonb, uuid)', 'execute')
  and not has_function_privilege('authenticated', 'private.aplicar_fila_importacion_productos(uuid, uuid)', 'execute')
  and has_function_privilege('workers_orquestacion', 'private.aplicar_fila_importacion_productos(uuid, uuid)', 'execute'),
  'la app ejecuta las RPC públicas y solo los workers aplican filas'
);

select is(private.codigo_tienda('San Javucho') || '/' || private.codigo_tienda('Mundo JC'), 'SJ/MJC',
  'el código de una tienda sale de las iniciales (una sigla entera entra completa)');

-- ============================================================================
-- Validación (FR-105)
-- ============================================================================

select pg_temp.como('d1000000-0000-0000-0000-000000000011');

create temp table pg_temp.filas_k1 (j jsonb);
insert into pg_temp.filas_k1 values ($j$[
  {"fila":2,"sku":"NEW-1","nombre":"Vidrio templado","categoria":"Accesorios > Vidrios","costo":"1200","precio_x1":"2500","precio_x5":"2300","precio_x10":"2100","precio_x50":"1900","proveedor":"","codigo_barras":"","tiendas":"SJ|MJC","imagenes":"subida.jpg"},
  {"fila":3,"sku":"exi-1","nombre":"Nombre actualizado","categoria":"Accesorios","costo":"","precio_x1":"","tiendas":"","imagenes":""},
  {"fila":4,"sku":"NEW-1","nombre":"Repetido","categoria":"Accesorios","precio_x1":"10"},
  {"fila":5,"sku":"NEW-2","nombre":"Sin categoría","categoria":"No existe","precio_x1":"10"},
  {"fila":6,"sku":"NEW-3","nombre":"Precio malo","categoria":"Accesorios","precio_x1":"abc"},
  {"fila":7,"sku":"NEW-4","nombre":"Con avisos","categoria":"Accesorios","precio_x1":"5","tiendas":"XX","imagenes":"falta.jpg"},
  {"fila":8,"sku":"NEW-5","nombre":"Barras ajeno","categoria":"Accesorios","precio_x1":"5","codigo_barras":"7790000000012"},
  {"fila":9,"sku":"","nombre":"","categoria":"","precio_x1":""},
  {"fila":10,"sku":"NEW-6","nombre":"Sin precio","categoria":"Accesorios"}
]$j$::jsonb);

create temp table pg_temp.validacion as
  select * from public.validar_importacion_productos(
    (select j from pg_temp.filas_k1), '0a000000-0000-0000-0000-000000000001');
grant all on pg_temp.filas_k1, pg_temp.validacion to public;

select is(
  (select accion || '/' || estado from pg_temp.validacion where fila = 2), 'nuevo/ok',
  'fila válida y nueva: Nuevo, sin observaciones (la imagen subida cuenta)'
);
select is(
  (select accion || '/' || estado from pg_temp.validacion where fila = 3), 'actualiza/ok',
  'el SKU existente (sin distinguir mayúsculas) es una actualización y no exige precio'
);
select is(
  (select estado from pg_temp.validacion where fila = 4), 'error',
  'SKU repetido en la planilla: error'
);
select ok(
  (select mensaje like '%repetido%' from pg_temp.validacion where fila = 4),
  'el motivo del SKU repetido lo dice'
);
select is(
  (select estado from pg_temp.validacion where fila = 5), 'error',
  'categoría inexistente: error'
);
select is(
  (select estado from pg_temp.validacion where fila = 6), 'error',
  'precio no numérico: error'
);
select is(
  (select estado from pg_temp.validacion where fila = 7), 'aviso',
  'tienda desconocida e imagen que no se subió: aviso (se importa igual)'
);
select ok(
  (select mensaje like '%Tienda desconocida%' and mensaje like '%no se subió%' from pg_temp.validacion where fila = 7),
  'el aviso nombra la tienda y la imagen'
);
select is(
  (select estado from pg_temp.validacion where fila = 8), 'error',
  'código de barras ya usado por otro producto: error'
);
select is(
  (select estado from pg_temp.validacion where fila = 9), 'error',
  'sin SKU, nombre ni categoría: error'
);
select is(
  (select estado from pg_temp.validacion where fila = 10), 'error',
  'un producto nuevo sin precio x1: error'
);

select is(
  (select estado from private.validar_filas_importacion_productos(
     '11111111-1111-1111-1111-111111111111', false,
     '[{"fila":2,"sku":"NEW-1","nombre":"Vidrio","categoria":"Accesorios","costo":"1200","precio_x1":"10"}]'::jsonb)),
  'aviso',
  'con costo y sin acceso a Rentabilidad, la fila se importa con aviso (FR-106)'
);

select throws_ok(
  $$ select * from public.validar_importacion_productos(
       (select jsonb_agg(jsonb_build_object('fila', g + 1, 'sku', 'S' || g, 'nombre', 'N', 'categoria', 'Accesorios', 'precio_x1', '1'))
          from generate_series(1, 2001) g)) $$,
  '22023', null, 'más de 2000 filas se rechazan (límite de FR-105)'
);

select pg_temp.como('d1000000-0000-0000-0000-000000000012');

select throws_ok(
  $$ select * from public.validar_importacion_productos('[{"fila":2,"sku":"A"}]'::jsonb) $$,
  '42501', null, 'quien no es Administrador no valida importaciones'
);

-- ============================================================================
-- Solicitar (FR-107, FR-109)
-- ============================================================================

select throws_ok(
  $$ select public.solicitar_importacion_productos('[{"fila":2,"sku":"A","nombre":"A","categoria":"Accesorios","precio_x1":"1"}]'::jsonb) $$,
  '42501', null, 'quien no es Administrador no solicita importaciones'
);

select pg_temp.como('d2000000-0000-0000-0000-000000000011');

select throws_ok(
  $$ select public.solicitar_importacion_productos('[{"fila":2,"sku":"A","nombre":"A","categoria":"Accesorios","precio_x1":"1"}]'::jsonb) $$,
  'P0001', null, 'una organización sin la conexión importar-productos no importa (SIN_CONEXION_IMPORTACION)'
);

select pg_temp.como('d1000000-0000-0000-0000-000000000011');

select throws_ok(
  $$ select public.solicitar_importacion_productos('[]'::jsonb) $$,
  '22023', null, 'una planilla sin filas se rechaza'
);

select throws_ok(
  $$ select public.solicitar_importacion_productos(
       '[{"fila":2,"sku":"","nombre":"","categoria":""}]'::jsonb, '0a000000-0000-0000-0000-000000000003') $$,
  '22023', null, 'si ninguna fila es importable no se crea la importación'
);

create temp table pg_temp.sol1 as
  select public.solicitar_importacion_productos((select j from pg_temp.filas_k1), '0a000000-0000-0000-0000-000000000001') as r;
grant all on pg_temp.sol1 to public;

select is(
  (select r ->> 'estado' from pg_temp.sol1) || '/' || (select r ->> 'importables' from pg_temp.sol1) || '/' || (select r ->> 'omitidas' from pg_temp.sol1),
  'en_cola/3/6',
  'la solicitud queda en_cola con 3 filas importables y 6 omitidas por error'
);

select is(
  (public.solicitar_importacion_productos((select j from pg_temp.filas_k1), '0a000000-0000-0000-0000-000000000001') ->> 'importacion_id'),
  (select r ->> 'importacion_id' from pg_temp.sol1),
  'reintentar con la misma clave devuelve la misma importación (idempotente)'
);

create temp table pg_temp.sol2 as
  select public.solicitar_importacion_productos(
    '[{"fila":2,"sku":"SEG-1","nombre":"Segunda","categoria":"Accesorios","precio_x1":"7"}]'::jsonb,
    '0a000000-0000-0000-0000-000000000002') as r;
grant all on pg_temp.sol2 to public;

select is(
  (select r ->> 'estado' from pg_temp.sol2), 'en_cola',
  'la segunda importación no se rechaza: queda en_cola (FR-109)'
);

select is(
  (public.obtener_importacion_productos((select (r ->> 'importacion_id')::uuid from pg_temp.sol1)) ->> 'estado'),
  'en_cola',
  'obtener informa el estado en_cola (FR-111)'
);

select is(
  jsonb_array_length(public.obtener_importacion_productos((select (r ->> 'importacion_id')::uuid from pg_temp.sol1)) -> 'errores'),
  6,
  'las filas con error figuran con su motivo para el reporte (FR-110)'
);

select throws_ok(
  $$ insert into dominio.importaciones_productos (organizacion_id, clave, solicitante, total_filas, importables)
     values ('11111111-1111-1111-1111-111111111111', gen_random_uuid(), 'd1000000-0000-0000-0000-000000000011', 1, 1) $$,
  '42501', null, 'ni el Administrador escribe las tablas directamente'
);

select pg_temp.como('d2000000-0000-0000-0000-000000000011');

select throws_ok(
  format($f$ select public.obtener_importacion_productos('%s'::uuid) $f$, (select r ->> 'importacion_id' from pg_temp.sol1)),
  'P0002', null, 'el Administrador de otra organización no ve la importación'
);
select is(
  (select count(*)::int from dominio.importaciones_productos), 0,
  'RLS: otra organización no lee las importaciones'
);

select pg_temp.como('d1000000-0000-0000-0000-000000000012');

select is(
  (select count(*)::int from dominio.importaciones_productos), 0,
  'RLS: un miembro que no es Administrador no lee las importaciones'
);

reset role;

select is(
  (select count(*)::int from despachos_ejecucion d join ejecuciones_worker e on e.id = d.ejecucion_id
    where e.detalle ? 'importacion_id'),
  1,
  'solo la primera importación tiene ejecución y orden en la outbox; la segunda espera'
);

select is(
  (select ejecucion_id is null from dominio.importaciones_productos where id = (select (r ->> 'importacion_id')::uuid from pg_temp.sol2)),
  true,
  'la importación en cola no tiene ejecución hasta que termine la anterior'
);

-- ============================================================================
-- Worker (FR-108): aplicar filas, idempotencia, cierre y despacho de la siguiente
-- ============================================================================

do $$
begin
  perform set_config('t.imp1', (select r ->> 'importacion_id' from pg_temp.sol1), false);
  perform set_config('t.imp2', (select r ->> 'importacion_id' from pg_temp.sol2), false);
  perform set_config('t.ejec1', (select ejecucion_id::text from dominio.importaciones_productos where id = (select r ->> 'importacion_id' from pg_temp.sol1)::uuid), false);
  -- Ver historial_importacion.test.sql: el dueño de las funciones se identifica como administrador por JWT.
  perform set_config('request.jwt.claims',
    json_build_object('sub', 'd1000000-0000-0000-0000-000000000011', 'role', 'authenticated')::text, false);
end $$;

-- Costo, escalas, tiendas y descripción con actividad (el solicitante tenía Rentabilidad).
update dominio.importaciones_productos set con_costo = true where id = current_setting('t.imp1')::uuid;

select is(
  (select pendientes from private.iniciar_importacion_productos(current_setting('t.ejec1')::uuid)),
  3,
  'el worker inicia la importación y ve 3 filas pendientes'
);

select is(
  (select estado from dominio.importaciones_productos where id = current_setting('t.imp1')::uuid),
  'aplicando',
  'iniciar la importación la pasa a aplicando'
);

select is(
  (select count(*)::int from private.filas_pendientes_importacion_productos(current_setting('t.ejec1')::uuid)),
  3,
  'las filas con error no se ofrecen al worker'
);

select is(
  (select private.aplicar_fila_importacion_productos(current_setting('t.ejec1')::uuid, f.id) ->> 'resultado'
     from dominio.importaciones_productos_filas f where f.importacion_id = current_setting('t.imp1')::uuid and f.fila = 2),
  'aplicada',
  'aplicar una fila nueva crea el producto'
);

select is(
  (select p.nombre || '/' || p.categoria_id::text || '/' || p.precio_lista::text
     from dominio.productos p where p.organizacion_id = '11111111-1111-1111-1111-111111111111' and p.sku = 'NEW-1'),
  'Vidrio templado/c1000000-0000-0000-0000-0000000000c2/2500.00',
  'el producto nuevo queda con nombre, categoría de la ruta «Accesorios > Vidrios» y precio x1'
);

select is(
  (select costo::text from dominio.producto_costos where producto_id = (select id from dominio.productos where sku = 'NEW-1' and organizacion_id = '11111111-1111-1111-1111-111111111111')),
  '1200.00',
  'con acceso a Rentabilidad se escribe el costo'
);

select is(
  (select string_agg(escala || '=' || precio::text, ',' order by escala) from dominio.producto_precios_escala
    where producto_id = (select id from dominio.productos where sku = 'NEW-1' and organizacion_id = '11111111-1111-1111-1111-111111111111')),
  'x10=2100.00,x5=2300.00,x50=1900.00',
  'las escalas x5, x10 y x50 se escriben'
);

select is(
  (select count(*)::int from dominio.producto_empresa
    where producto_id = (select id from dominio.productos where sku = 'NEW-1' and organizacion_id = '11111111-1111-1111-1111-111111111111')),
  2,
  'las tiendas SJ|MJC publican el producto en las dos empresas'
);

select is(
  (select private.aplicar_fila_importacion_productos(current_setting('t.ejec1')::uuid, f.id) -> 'imagenes' ->> 0
     from dominio.importaciones_productos_filas f where f.importacion_id = current_setting('t.imp1')::uuid and f.fila = 2),
  'subida.jpg',
  'reaplicar la fila devuelve el resultado guardado y las imágenes a adjuntar (idempotente)'
);

select is(
  (select count(*)::int from dominio.productos where organizacion_id = '11111111-1111-1111-1111-111111111111' and sku = 'NEW-1'),
  1,
  'reaplicar no duplica el producto'
);

select is(
  (select private.registrar_imagen_importacion_productos(
      current_setting('t.ejec1')::uuid, f.id, 'subida.jpg',
      '11111111-1111-1111-1111-111111111111/' || f.producto_id::text || '/imp-1.jpg')
     from dominio.importaciones_productos_filas f where f.importacion_id = current_setting('t.imp1')::uuid and f.fila = 2),
  'registrada',
  'la imagen se registra en la primera posición libre'
);

select is(
  (select private.registrar_imagen_importacion_productos(
      current_setting('t.ejec1')::uuid, f.id, 'subida.jpg',
      '11111111-1111-1111-1111-111111111111/' || f.producto_id::text || '/imp-1.jpg')
     from dominio.importaciones_productos_filas f where f.importacion_id = current_setting('t.imp1')::uuid and f.fila = 2),
  'existente',
  'registrar la misma imagen otra vez no la duplica'
);

select throws_ok(
  format($f$ select private.registrar_imagen_importacion_productos('%s'::uuid, f.id, 'x.jpg', '22222222-2222-2222-2222-222222222222/x/x.jpg')
              from dominio.importaciones_productos_filas f where f.importacion_id = '%s'::uuid and f.fila = 2 $f$,
         current_setting('t.ejec1'), current_setting('t.imp1')),
  'P0001', null, 'una ruta ajena al producto se rechaza'
);

select is(
  (select private.aplicar_fila_importacion_productos(current_setting('t.ejec1')::uuid, f.id) ->> 'resultado'
     from dominio.importaciones_productos_filas f where f.importacion_id = current_setting('t.imp1')::uuid and f.fila = 3),
  'aplicada',
  'aplicar una fila de SKU existente actualiza el producto'
);

select is(
  (select nombre || '/' || precio_lista::text from dominio.productos where id = 'b1000000-0000-0000-0000-0000000000b1'),
  'Nombre actualizado/100.00',
  'la celda de precio vacía no pisa el precio actual (Decisión 7)'
);

select is(
  (select count(*)::int from public.registro_actividad
    where organizacion_id = '11111111-1111-1111-1111-111111111111'
      and tipo in ('producto.creado', 'producto.editado') and detalle like '%importación CSV%'),
  2,
  'cada producto aplicado deja su evento de actividad a nombre de quien solicitó'
);

select is(
  (select count(*)::int from public.registro_actividad
    where organizacion_id = '11111111-1111-1111-1111-111111111111' and detalle ~ '[0-9]{4}\.[0-9]{2}'),
  0,
  'la actividad no lleva precios ni costos'
);

-- Resto de las filas y cierre.
select lives_ok(
  format($f$ select private.aplicar_fila_importacion_productos('%s'::uuid, f.id)
             from dominio.importaciones_productos_filas f where f.importacion_id = '%s'::uuid and f.resultado = 'pendiente' $f$,
         current_setting('t.ejec1'), current_setting('t.imp1')),
  'el worker aplica las filas restantes'
);

select is(
  (select (private.cerrar_importacion_productos(current_setting('t.ejec1')::uuid, 'terminada')) ->> 'procesadas'),
  '3',
  'al cerrar quedan 3 filas procesadas'
);

select is(
  (select estado || '/' || procesadas || '/' || omitidas from dominio.importaciones_productos where id = current_setting('t.imp1')::uuid),
  'terminada/3/6',
  'la importación termina con 3 procesadas y 6 omitidas por error'
);

select lives_ok(
  format($f$ select public.cerrar_ejecucion_worker('%s'::uuid, 'exitosa', 'IMPORTADAS:3', '{}'::jsonb) $f$, current_setting('t.ejec1')),
  'el worker cierra la ejecución'
);

select isnt(
  private.despachar_importacion_siguiente('11111111-1111-1111-1111-111111111111'),
  null,
  'al cerrar la primera se despacha la importación que esperaba en cola'
);

select is(
  (select ejecucion_id is not null from dominio.importaciones_productos where id = current_setting('t.imp2')::uuid),
  true,
  'la segunda importación ya tiene su ejecución'
);

select throws_ok(
  format($f$ select * from private.iniciar_importacion_productos('%s'::uuid) $f$, current_setting('t.ejec1')),
  'P0001', null, 'una ejecución cerrada no se puede reiniciar (EJECUCION_NO_EN_CURSO)'
);


-- ============================================================================
-- Falla (FR-109/FR-111): una orden agotada lleva la importación a `fallida` y libera la cola
-- ============================================================================

update despachos_ejecucion set estado = 'agotada', reclamada_en = null, vence_en = null
 where ejecucion_id = (select ejecucion_id from dominio.importaciones_productos where id = current_setting('t.imp2')::uuid);

insert into dominio.importaciones_productos (id, organizacion_id, clave, solicitante, total_filas, importables)
values ('e1000000-0000-0000-0000-0000000000e3', '11111111-1111-1111-1111-111111111111',
        '0a000000-0000-0000-0000-000000000099', 'd1000000-0000-0000-0000-000000000011', 1, 1);

select is(
  private.reconciliar_importaciones_fallidas('11111111-1111-1111-1111-111111111111'),
  1,
  'la importación con orden agotada se reconcilia'
);

select is(
  (select estado || '/' || (mensaje_fallo is not null) from dominio.importaciones_productos where id = current_setting('t.imp2')::uuid),
  'fallida/true',
  'queda fallida con su mensaje de fallo'
);

select is(
  (select e.estado from ejecuciones_worker e join dominio.importaciones_productos i on i.ejecucion_id = e.id
    where i.id = current_setting('t.imp2')::uuid),
  'fallida',
  'su ejecución también se cierra como fallida'
);

select is(
  private.reconciliar_importaciones_fallidas('11111111-1111-1111-1111-111111111111'),
  0,
  'reconciliar es idempotente'
);

select is(
  private.despachar_importacion_siguiente('11111111-1111-1111-1111-111111111111'),
  'e1000000-0000-0000-0000-0000000000e3'::uuid,
  'tras la falla se despacha la siguiente importación de la organización'
);

select is(
  (select r ->> 'estado' from (select public.obtener_importacion_productos(current_setting('t.imp2')::uuid) as r) s),
  'fallida',
  'la pantalla ve la importación como fallida'
);

select * from finish();
rollback;
