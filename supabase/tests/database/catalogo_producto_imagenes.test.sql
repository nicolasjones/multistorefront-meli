-- F-CAT-05 (MSF-461, épica MSF-456): imágenes del producto.
-- Cubre SC-004 / FR-012…FR-014: aislamiento entre organizaciones en la tabla y en
-- Storage, permisos por rol (Administrador/Operador editan, Consulta lee), tope de 4
-- (también ante llamada directa), ruta/formato/posición inválidos rechazados en la
-- base, eventos en Actividad y privilegios de `anon`.
begin;

select plan(35);

insert into organizaciones (id, nombre) values
  ('11111111-1111-1111-1111-111111111111', 'Organización Uno'),
  ('22222222-2222-2222-2222-222222222222', 'Organización Dos');

insert into auth.users (id, email) values
  ('d1000000-0000-0000-0000-000000000001', 'administrador@example.com'),
  ('d1000000-0000-0000-0000-000000000002', 'operador@example.com'),
  ('d1000000-0000-0000-0000-000000000003', 'consulta@example.com'),
  ('d2000000-0000-0000-0000-000000000001', 'admin-dos@example.com');

insert into usuarios_organizacion (user_id, organizacion_id, rol_id) values
  ('d1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'administrador'),
  ('d1000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'operador'),
  ('d1000000-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111', 'consulta'),
  ('d2000000-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', 'administrador');

insert into dominio.productos (id, organizacion_id, nombre, sku, precio_lista) values
  ('a1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'Joystick', 'JOY-1', 49.90),
  ('a1000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'Cable', 'CAB-1', 10),
  ('b2000000-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', 'Producto Dos', 'DOS-1', 5);

create function pg_temp.como(p_user uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
  set local role authenticated;
end $$;

-- ============================================================================
-- Estructura y privilegios
-- ============================================================================

select is(
  (select relrowsecurity from pg_class where oid = 'dominio.producto_imagenes'::regclass),
  true, 'producto_imagenes tiene RLS'
);
select is(
  (select public::text || '|' || file_size_limit::text from storage.buckets where id = 'productos-imagenes'),
  'false|2097152', 'el bucket es privado y tiene tope de 2 MB'
);
select is(
  (select array_to_string(allowed_mime_types, ',') from storage.buckets where id = 'productos-imagenes'),
  'image/png,image/jpeg,image/webp', 'el bucket solo admite JPG, PNG y WebP'
);
select is(has_table_privilege('anon', 'dominio.producto_imagenes', 'SELECT'), false, 'anon no lee producto_imagenes');
select is(has_table_privilege('anon', 'dominio.producto_imagenes', 'INSERT'), false, 'anon no inserta en producto_imagenes');

-- ============================================================================
-- Administrador: agrega imágenes y la base rechaza lo inválido
-- ============================================================================

select pg_temp.como('d1000000-0000-0000-0000-000000000001');
select lives_ok(
  $$insert into dominio.producto_imagenes (producto_id, organizacion_id, posicion, ruta) values
      ('a1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 1,
       '11111111-1111-1111-1111-111111111111/a1000000-0000-0000-0000-000000000001/frente.png')$$,
  'administrador: agrega la primera imagen'
);
reset role;
select is(
  (select count(*)::int from registro_actividad where tipo = 'producto.imagen_agregada'),
  1, 'agregar deja producto.imagen_agregada'
);
select ok(
  (select detalle from registro_actividad where tipo = 'producto.imagen_agregada') like '%Joystick%',
  'el evento nombra el producto'
);

select pg_temp.como('d1000000-0000-0000-0000-000000000001');
select throws_ok(
  $$insert into dominio.producto_imagenes (producto_id, organizacion_id, posicion, ruta) values
      ('a1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 2,
       '22222222-2222-2222-2222-222222222222/a1000000-0000-0000-0000-000000000001/ajena.png')$$,
  '23514', null, 'una ruta fuera del prefijo de su organización/producto se rechaza'
);
select throws_ok(
  $$insert into dominio.producto_imagenes (producto_id, organizacion_id, posicion, ruta) values
      ('a1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 2,
       '11111111-1111-1111-1111-111111111111/a1000000-0000-0000-0000-000000000001/animada.gif')$$,
  '23514', null, 'un formato que no es JPG/PNG/WebP se rechaza'
);
select throws_ok(
  $$insert into dominio.producto_imagenes (producto_id, organizacion_id, posicion, ruta) values
      ('a1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 5,
       '11111111-1111-1111-1111-111111111111/a1000000-0000-0000-0000-000000000001/quinta.png')$$,
  '23514', null, 'una posición fuera de 1..4 se rechaza'
);
select throws_ok(
  $$insert into dominio.producto_imagenes (producto_id, organizacion_id, posicion, ruta) values
      ('a1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 1,
       '11111111-1111-1111-1111-111111111111/a1000000-0000-0000-0000-000000000001/repetida.png')$$,
  '23505', null, 'una posición ya ocupada se rechaza'
);
select throws_ok(
  $$insert into dominio.producto_imagenes (producto_id, organizacion_id, posicion, ruta) values
      ('b2000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 1,
       '11111111-1111-1111-1111-111111111111/b2000000-0000-0000-0000-000000000001/cruzada.png')$$,
  '23503', null, 'no se asocia una imagen de la organización a un producto de otra'
);

-- Tope de 4: tres más completan el cupo y la quinta se rechaza aunque llegue por llamada directa.
select lives_ok(
  $$insert into dominio.producto_imagenes (producto_id, organizacion_id, posicion, ruta) values
      ('a1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 2,
       '11111111-1111-1111-1111-111111111111/a1000000-0000-0000-0000-000000000001/lado.jpg'),
      ('a1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 3,
       '11111111-1111-1111-1111-111111111111/a1000000-0000-0000-0000-000000000001/atras.webp'),
      ('a1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 4,
       '11111111-1111-1111-1111-111111111111/a1000000-0000-0000-0000-000000000001/caja.jpeg')$$,
  'administrador: completa las 4 imágenes'
);
select throws_ok(
  $$insert into dominio.producto_imagenes (producto_id, organizacion_id, posicion, ruta) values
      ('a1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 1,
       '11111111-1111-1111-1111-111111111111/a1000000-0000-0000-0000-000000000001/quinta.png')$$,
  '23514', 'Un producto admite hasta 4 imágenes', 'la quinta imagen se rechaza'
);
select is(
  (select count(*)::int from dominio.producto_imagenes where producto_id = 'a1000000-0000-0000-0000-000000000001'),
  4, 'quedan exactamente 4 imágenes'
);

-- Storage: solo bajo el prefijo de la organización y de un producto propio.
select lives_ok(
  $$insert into storage.objects (bucket_id, name, owner) values
      ('productos-imagenes', '11111111-1111-1111-1111-111111111111/a1000000-0000-0000-0000-000000000001/frente.png', 'd1000000-0000-0000-0000-000000000001')$$,
  'administrador: sube un archivo bajo su organización y producto'
);
select throws_ok(
  $$insert into storage.objects (bucket_id, name, owner) values
      ('productos-imagenes', '22222222-2222-2222-2222-222222222222/b2000000-0000-0000-0000-000000000001/x.png', 'd1000000-0000-0000-0000-000000000001')$$,
  '42501', null, 'administrador: no sube bajo el prefijo de otra organización'
);
select throws_ok(
  $$insert into storage.objects (bucket_id, name, owner) values
      ('productos-imagenes', '11111111-1111-1111-1111-111111111111/b2000000-0000-0000-0000-000000000001/x.png', 'd1000000-0000-0000-0000-000000000001')$$,
  '42501', null, 'administrador: no sube sobre un producto que no es de su organización'
);

-- Eliminar: promueve a la siguiente como principal y deja evento.
select lives_ok(
  $$delete from dominio.producto_imagenes where producto_id = 'a1000000-0000-0000-0000-000000000001' and posicion = 1$$,
  'administrador: elimina la principal'
);
select is(
  (select min(posicion)::int from dominio.producto_imagenes where producto_id = 'a1000000-0000-0000-0000-000000000001'),
  2, 'la siguiente pasa a ser la principal'
);
reset role;
select is(
  (select count(*)::int from registro_actividad where tipo = 'producto.imagen_eliminada'),
  1, 'eliminar deja producto.imagen_eliminada'
);
select is(
  (select count(*)::int from registro_actividad where tipo like 'producto.imagen_%' and detalle like '%.png%'),
  0, 'los eventos no exponen rutas de archivos'
);

-- ============================================================================
-- Operador: edita
-- ============================================================================

select pg_temp.como('d1000000-0000-0000-0000-000000000002');
select lives_ok(
  $$insert into dominio.producto_imagenes (producto_id, organizacion_id, posicion, ruta) values
      ('a1000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 1,
       '11111111-1111-1111-1111-111111111111/a1000000-0000-0000-0000-000000000002/cable.png')$$,
  'operador: agrega una imagen'
);
select is(
  (select count(*)::int from dominio.producto_imagenes), 4, 'operador: ve las imágenes de su organización'
);
reset role;

-- ============================================================================
-- Consulta: solo lee
-- ============================================================================

select pg_temp.como('d1000000-0000-0000-0000-000000000003');
select is((select count(*)::int from dominio.producto_imagenes), 4, 'consulta: lee las imágenes');
select throws_ok(
  $$insert into dominio.producto_imagenes (producto_id, organizacion_id, posicion, ruta) values
      ('a1000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 2,
       '11111111-1111-1111-1111-111111111111/a1000000-0000-0000-0000-000000000002/otra.png')$$,
  '42501', null, 'consulta: no agrega imágenes'
);
delete from dominio.producto_imagenes;
select is((select count(*)::int from dominio.producto_imagenes), 4, 'consulta: no elimina imágenes');
select is(
  (select count(*)::int from storage.objects where bucket_id = 'productos-imagenes'),
  1, 'consulta: lee los archivos de su organización'
);
select throws_ok(
  $$insert into storage.objects (bucket_id, name, owner) values
      ('productos-imagenes', '11111111-1111-1111-1111-111111111111/a1000000-0000-0000-0000-000000000002/x.png', 'd1000000-0000-0000-0000-000000000003')$$,
  '42501', null, 'consulta: no sube archivos'
);
reset role;

-- ============================================================================
-- Otra organización: aislamiento en tabla y Storage
-- ============================================================================

select pg_temp.como('d2000000-0000-0000-0000-000000000001');
select is((select count(*)::int from dominio.producto_imagenes), 0, 'otra organización: no ve imágenes ajenas');
select is(
  (select count(*)::int from storage.objects where bucket_id = 'productos-imagenes'),
  0, 'otra organización: no ve archivos ajenos'
);
select throws_ok(
  $$insert into dominio.producto_imagenes (producto_id, organizacion_id, posicion, ruta) values
      ('a1000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 2,
       '11111111-1111-1111-1111-111111111111/a1000000-0000-0000-0000-000000000002/intruso.png')$$,
  '42501', null, 'otra organización: no inserta imágenes en productos ajenos'
);
select throws_ok(
  $$insert into storage.objects (bucket_id, name, owner) values
      ('productos-imagenes', '11111111-1111-1111-1111-111111111111/a1000000-0000-0000-0000-000000000002/intruso.png', 'd2000000-0000-0000-0000-000000000001')$$,
  '42501', null, 'otra organización: no sube archivos al prefijo ajeno'
);
reset role;
select is(
  (select count(*)::int from dominio.producto_imagenes), 4, 'las imágenes ajenas quedaron intactas'
);

select * from finish();

rollback;
