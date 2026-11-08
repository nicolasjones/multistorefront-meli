-- MSF-202 (revisión independiente, hallazgos 1, 2, 3, 4, 7, 9 y 10): robustez de la importación de productos.
-- Cubre: tope de 1000 caracteres por celda y `carga` acotada, imágenes pendientes que el reintento vuelve a ver,
-- errores transitorios (40/55) que se propagan en vez de omitir la fila, objetos temporales a borrar (los de la
-- importación y los huérfanos viejos), conexión habilitada y la bandera `reutilizada` (misma clave, dos llamadas).
-- El fixture corre como postgres; las llamadas del worker, como postgres identificado por JWT (ver
-- catalogo_importacion.test.sql: en el CI no es superusuario y no puede simular el login del worker).
begin;

select plan(28);

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

insert into dominio.categorias (id, organizacion_id, nombre, padre_id) values
  ('c1000000-0000-0000-0000-0000000000c1', '11111111-1111-1111-1111-111111111111', 'Accesorios', null);

insert into sistemas_externos (id, descripcion)
values ('importar-productos', 'Importación de productos desde CSV, sin sistema externo real')
on conflict (id) do nothing;
insert into conexiones (id, organizacion_id, sistema_externo, credencial_vault_id) values
  ('c1000000-0000-0000-0000-0000000000d1', '11111111-1111-1111-1111-111111111111', 'importar-productos', gen_random_uuid());

create function pg_temp.como(p_user uuid) returns void language plpgsql as $$
begin
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
  set local role authenticated;
end $$;

-- ============================================================================
-- Hallazgo 3: tope por celda y carga acotada
-- ============================================================================

create temp table pg_temp.val as
  select * from private.validar_filas_importacion_productos(
    '11111111-1111-1111-1111-111111111111', true,
    jsonb_build_array(
      jsonb_build_object('fila', '2', 'sku', 'V1', 'nombre', 'N', 'categoria', 'Accesorios', 'precio_x1', '1', 'tiendas', repeat('S|', 600), 'extra', 'no persiste'),
      jsonb_build_object('fila', '3', 'sku', 'V2', 'nombre', 'N', 'categoria', 'Accesorios', 'precio_x1', '1', 'imagenes', repeat('a.jpg|', 300)),
      jsonb_build_object('fila', '4', 'sku', 'V3', 'nombre', 'N', 'categoria', 'Accesorios', 'precio_x1', '1', 'proveedor', repeat('P', 1500)),
      jsonb_build_object('fila', '5', 'sku', 'V4', 'nombre', 'N', 'categoria', repeat('C', 2000), 'precio_x1', '1'),
      jsonb_build_object('fila', '6', 'sku', 'V5', 'nombre', 'N', 'categoria', 'Accesorios', 'precio_x1', '1')),
    null);

select is(
  (select string_agg(fila || ':' || estado, ',' order by fila) from pg_temp.val),
  '2:error,3:error,4:error,5:error,6:ok',
  'una celda de más de 1000 caracteres en tiendas, imagenes, proveedor o categoria es un error de la fila');
select ok(
  (select bool_and(mensaje like '%supera los 1000 caracteres%') from pg_temp.val where fila between 2 and 5),
  'el mensaje dice qué columna supera el tope');
select is(
  (select length(carga ->> 'tiendas') from pg_temp.val where fila = 2), 1000,
  'la carga guardada acota cada celda a 1000 caracteres');
select ok(
  (select not (carga ? 'extra') from pg_temp.val where fila = 2),
  'la carga guarda solo las columnas conocidas (una clave extra no se persiste)');

-- ============================================================================
-- Hallazgos 7 y 10: conexión habilitada y misma clave
-- ============================================================================

select pg_temp.como('d1000000-0000-0000-0000-000000000011');
select is(public.importacion_productos_habilitada(), true, 'la organización con la conexión importar-productos está habilitada');
select pg_temp.como('d2000000-0000-0000-0000-000000000011');
select is(public.importacion_productos_habilitada(), false, 'la organización sin la conexión no está habilitada (la pantalla avisa antes de pedir el CSV)');
select pg_temp.como('d1000000-0000-0000-0000-000000000012');
select throws_ok($$select public.importacion_productos_habilitada()$$, '42501', null, 'quien no es Administrador no consulta la habilitación');

select pg_temp.como('d1000000-0000-0000-0000-000000000011');

create temp table pg_temp.filas_k1 (j jsonb);
insert into pg_temp.filas_k1 values ($j$[
  {"fila":2,"sku":"TRANS-1","nombre":"Lock","categoria":"Accesorios","precio_x1":"1"},
  {"fila":3,"sku":"TRANS-2","nombre":"Deadlock","categoria":"Accesorios","precio_x1":"1"},
  {"fila":4,"sku":"DATO-1","nombre":"Dato","categoria":"Accesorios","precio_x1":"1"},
  {"fila":5,"sku":"IMG-1","nombre":"Con imágenes","categoria":"Accesorios","precio_x1":"1","imagenes":"a.jpg|b.png"}
]$j$::jsonb);
grant all on pg_temp.filas_k1 to public;

create temp table pg_temp.sol1 as
  select public.solicitar_importacion_productos((select j from pg_temp.filas_k1), '0a000000-0000-0000-0000-000000000001') as r;
grant all on pg_temp.sol1 to public;

select is((select (r ->> 'reutilizada')::boolean from pg_temp.sol1), false, 'la primera solicitud no es reutilizada');

-- Doble clic en «Importar»: la segunda llamada con la misma clave (aunque lleguen filas distintas) devuelve la misma
-- importación y lo dice. El candado de asesoría por organización serializa las dos llamadas concurrentes.
select is(
  (select r2 ->> 'importacion_id' || '/' || (r2 ->> 'reutilizada')
     from (select public.solicitar_importacion_productos(
             '[{"fila":2,"sku":"OTRA","nombre":"Otra","categoria":"Accesorios","precio_x1":"9"}]'::jsonb,
             '0a000000-0000-0000-0000-000000000001') as r2) t),
  (select r ->> 'importacion_id' || '/true' from pg_temp.sol1),
  'la misma clave devuelve la misma importación con reutilizada=true');
select is(
  (select count(*)::int from dominio.importaciones_productos where clave = '0a000000-0000-0000-0000-000000000001'), 1,
  'no se crea una segunda importación con la misma clave');

-- ============================================================================
-- Worker: errores transitorios e imágenes pendientes (hallazgos 1 y 2)
-- ============================================================================

reset role;

create function public.t_falla_importacion() returns trigger language plpgsql as $$
begin
  if new.sku = 'TRANS-1' then raise exception 'lock no disponible' using errcode = '55P03'; end if;
  if new.sku = 'TRANS-2' then raise exception 'deadlock' using errcode = '40P01'; end if;
  if new.sku = 'DATO-1' then raise exception 'duplicado' using errcode = '23505'; end if;
  return new;
end $$;
create trigger t_falla_importacion before insert on dominio.productos
  for each row execute function public.t_falla_importacion();

do $$
begin
  perform set_config('t.imp1', (select r ->> 'importacion_id' from pg_temp.sol1), false);
  perform set_config('t.ejec1', (select ejecucion_id::text from dominio.importaciones_productos where id = (select r ->> 'importacion_id' from pg_temp.sol1)::uuid), false);
  perform set_config('request.jwt.claims',
    json_build_object('sub', 'd1000000-0000-0000-0000-000000000011', 'role', 'authenticated')::text, false);
end $$;

select is(
  (select pendientes from private.iniciar_importacion_productos(current_setting('t.ejec1')::uuid)), 4,
  'el worker inicia la importación con 4 filas pendientes');

select throws_ok(
  format($f$ select private.aplicar_fila_importacion_productos('%s'::uuid, f.id) from dominio.importaciones_productos_filas f
              where f.importacion_id = '%s'::uuid and f.sku = 'TRANS-1' $f$, current_setting('t.ejec1'), current_setting('t.imp1')),
  '55P03', null, 'un lock no disponible (55P03) se propaga para que el flow reintente');
select throws_ok(
  format($f$ select private.aplicar_fila_importacion_productos('%s'::uuid, f.id) from dominio.importaciones_productos_filas f
              where f.importacion_id = '%s'::uuid and f.sku = 'TRANS-2' $f$, current_setting('t.ejec1'), current_setting('t.imp1')),
  '40P01', null, 'un deadlock (40P01) se propaga para que el flow reintente');
select is(
  (select string_agg(sku || ':' || resultado, ',' order by sku) from dominio.importaciones_productos_filas
    where importacion_id = current_setting('t.imp1')::uuid and sku in ('TRANS-1', 'TRANS-2')),
  'TRANS-1:pendiente,TRANS-2:pendiente',
  'las filas con error transitorio siguen pendientes (no quedan omitidas para siempre)');

select is(
  (select private.aplicar_fila_importacion_productos(current_setting('t.ejec1')::uuid, f.id) ->> 'resultado'
     from dominio.importaciones_productos_filas f where f.importacion_id = current_setting('t.imp1')::uuid and f.sku = 'DATO-1'),
  'omitida', 'un error de datos (23505) sigue omitiendo la fila con su motivo');

select is(
  (select private.aplicar_fila_importacion_productos(current_setting('t.ejec1')::uuid, f.id) ->> 'resultado'
     from dominio.importaciones_productos_filas f where f.importacion_id = current_setting('t.imp1')::uuid and f.sku = 'IMG-1'),
  'aplicada', 'la fila con imágenes se aplica');

select is(
  (select string_agg(sku, ',' order by fila) from private.filas_pendientes_importacion_productos(current_setting('t.ejec1')::uuid)),
  'TRANS-1,TRANS-2,IMG-1',
  'la fila aplicada con imágenes sin adjuntar se vuelve a ofrecer al worker (reintento tras una falla de Storage)');

select lives_ok(
  format($f$ select private.confirmar_imagenes_fila_importacion_productos('%s'::uuid, f.id)
              from dominio.importaciones_productos_filas f where f.importacion_id = '%s'::uuid and f.sku = 'IMG-1' $f$,
         current_setting('t.ejec1'), current_setting('t.imp1')),
  'el worker confirma que adjuntó las imágenes');
select is(
  (select string_agg(sku, ',' order by fila) from private.filas_pendientes_importacion_productos(current_setting('t.ejec1')::uuid)),
  'TRANS-1,TRANS-2',
  'confirmadas las imágenes la fila deja de ofrecerse');

-- Fila que siempre falla (revisión de #794): al tercer intento queda omitida y el resto sigue.
select lives_ok(
  format($f$ select private.registrar_fallo_fila_importacion_productos('%s'::uuid, f.id) from dominio.importaciones_productos_filas f,
              generate_series(1, 3) g where f.importacion_id = '%s'::uuid and f.sku = 'TRANS-1' $f$,
         current_setting('t.ejec1'), current_setting('t.imp1')),
  'el worker registra tres fallos transitorios de la misma fila');
select is(
  (select resultado || '/' || intentos || '/' || resultado_mensaje from dominio.importaciones_productos_filas
    where importacion_id = current_setting('t.imp1')::uuid and sku = 'TRANS-1'),
  'omitida/3/No se pudo aplicar tras varios intentos',
  'al tercer intento la fila queda omitida con un motivo claro');
select is(
  (select string_agg(sku || ':' || resultado || ':' || intentos, ',' order by fila) from dominio.importaciones_productos_filas
    where importacion_id = current_setting('t.imp1')::uuid),
  'TRANS-1:omitida:3,TRANS-2:pendiente:0,DATO-1:omitida:0,IMG-1:aplicada:0',
  'las demás filas no se ven afectadas (una fila que falla siempre no frena al resto)');

-- Imágenes que nunca se adjuntaron: la pantalla y el cierre las cuentan (hallazgos 3 y 4 de la revisión de #794).
update dominio.importaciones_productos_filas set imagenes_pendientes = true
 where importacion_id = current_setting('t.imp1')::uuid and sku = 'IMG-1';
select pg_temp.como('d1000000-0000-0000-0000-000000000011');
select is(
  (public.obtener_importacion_productos(current_setting('t.imp1')::uuid) ->> 'sin_imagenes')::int, 1,
  'obtener_importacion_productos cuenta los productos que quedaron sin imágenes');
reset role;

-- ============================================================================
-- Hallazgo 4: objetos temporales a borrar
-- ============================================================================

-- Una segunda importación (queda en cola) con imágenes viejas: no son huérfanas.
select pg_temp.como('d1000000-0000-0000-0000-000000000011');
select public.solicitar_importacion_productos(
  '[{"fila":2,"sku":"SEG-1","nombre":"Segunda","categoria":"Accesorios","precio_x1":"7"}]'::jsonb,
  '0a000000-0000-0000-0000-000000000002');
reset role;

insert into storage.objects (bucket_id, name, created_at) values
  ('productos-importaciones', '11111111-1111-1111-1111-111111111111/0a000000-0000-0000-0000-000000000001/a.jpg', now()),
  ('productos-importaciones', '11111111-1111-1111-1111-111111111111/0a000000-0000-0000-0000-0000000000f1/huerfana-vieja.jpg', now() - interval '10 days'),
  ('productos-importaciones', '11111111-1111-1111-1111-111111111111/0a000000-0000-0000-0000-0000000000f2/huerfana-joven.jpg', now()),
  ('productos-importaciones', '11111111-1111-1111-1111-111111111111/0a000000-0000-0000-0000-000000000002/en-cola-vieja.jpg', now() - interval '10 days'),
  ('productos-importaciones', '22222222-2222-2222-2222-222222222222/0a000000-0000-0000-0000-0000000000f3/otra-org.jpg', now() - interval '10 days');

select is(
  (select array_agg(regexp_replace(n, '^.*/', '') order by n)
     from private.imagenes_temporales_a_borrar(current_setting('t.ejec1')::uuid, 7) n),
  array['a.jpg', 'huerfana-vieja.jpg'],
  'se borran las imágenes de la importación y las huérfanas viejas; no las jóvenes, las de una importación en cola ni las de otra organización');
select is(
  (select array_agg(regexp_replace(n, '^.*/', '') order by n)
     from private.imagenes_temporales_a_borrar(current_setting('t.ejec1')::uuid, 7, false) n),
  array['huerfana-vieja.jpg'],
  'al empezar una corrida (sin la importación propia) solo se ofrecen los huérfanos');
select throws_ok(
  format($f$ select * from private.imagenes_temporales_a_borrar('%s'::uuid, 0) $f$, current_setting('t.ejec1')),
  'P0001', null, 'los días de retención fuera de rango se rechazan');
select ok(
  not has_function_privilege('authenticated', 'private.imagenes_temporales_a_borrar(uuid, integer, boolean)', 'execute')
  and has_function_privilege('workers_orquestacion', 'private.imagenes_temporales_a_borrar(uuid, integer, boolean)', 'execute')
  and not has_function_privilege('anon', 'public.importacion_productos_habilitada()', 'execute'),
  'solo el worker lista los temporales a borrar y anon no consulta la habilitación');

select is(
  (select private.cerrar_importacion_productos(current_setting('t.ejec1')::uuid, 'terminada') ->> 'sin_imagenes'),
  '1',
  'cerrar la importación informa cuántos productos quedaron sin imágenes');

select * from finish();
rollback;
