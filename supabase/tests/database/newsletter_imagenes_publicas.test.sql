-- Lote 95 (MSF-979; migración 20270511000100): imágenes de producto en el correo del newsletter con copias optimizadas en un bucket público dedicado.
-- Objetos reales y el rol del CI (no superusuario): nada se omite con skip. Datos inventados.
begin;

select no_plan();

insert into organizaciones (id, nombre) values
  ('11111111-1111-1111-1111-111111111111', 'Organización Uno'),
  ('22222222-2222-2222-2222-222222222222', 'Organización Dos');
insert into auth.users (id, email) values
  ('d1000000-0000-0000-0000-000000000001', 'admin-uno@example.com'),
  ('d1000000-0000-0000-0000-000000000002', 'lector@example.com'),
  ('d2000000-0000-0000-0000-000000000001', 'admin-dos@example.com');
insert into usuarios_organizacion (user_id, organizacion_id, rol_id, estado) values
  ('d1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'administrador', 'activo'),
  ('d1000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'consulta', 'activo'),
  ('d2000000-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', 'administrador', 'activo');
insert into dominio.empresas (id, organizacion_id, nombre, activa) values
  ('e1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'Tienda A', true),
  ('e2000000-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', 'Tienda Dos', true);
insert into dominio.tiendas (organizacion_id, empresa_id, dominio) values
  ('11111111-1111-1111-1111-111111111111', 'e1000000-0000-0000-0000-000000000001', 'nlimg-a.ejemplo.com');
insert into usuarios_empresas (user_id, empresa_id, organizacion_id, rol_id) values
  ('d1000000-0000-0000-0000-000000000002', 'e1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'consulta');
insert into usuario_empresa_activa (user_id, empresa_id) values ('d1000000-0000-0000-0000-000000000002', 'e1000000-0000-0000-0000-000000000001');
insert into dominio.precios_empresa (empresa_id, organizacion_id, base, ajuste_pct, mostrar_con_iva) values
  ('e1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'central', 0, false);
insert into dominio.cotizacion_inicial (organizacion_id, valor) values ('11111111-1111-1111-1111-111111111111', 1500);

-- Tres productos destacados: 1 con dos imágenes, 2 sin imágenes, 3 con una imagen.
insert into dominio.productos (id, organizacion_id, nombre, sku, compatible_con, precio_lista, moneda, activo)
select ('a1000000-0000-0000-0000-00000000000' || n)::uuid, '11111111-1111-1111-1111-111111111111', 'Producto ' || n, 'NLI-' || n, '{}', 1000 * n, 'ARS', true
  from generate_series(1, 3) n;
insert into dominio.productos (id, organizacion_id, nombre, sku, compatible_con, precio_lista, moneda, activo) values
  ('a2000000-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', 'Ajeno', 'NLI-X', '{}', 500, 'ARS', true);
insert into dominio.producto_empresa (producto_id, empresa_id, organizacion_id)
select p.id, 'e1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111'
  from dominio.productos p where p.organizacion_id = '11111111-1111-1111-1111-111111111111';
insert into dominio.productos_tienda (empresa_id, producto_id, organizacion_id, visible, destacado)
select 'e1000000-0000-0000-0000-000000000001', p.id, '11111111-1111-1111-1111-111111111111', true, true
  from dominio.productos p where p.organizacion_id = '11111111-1111-1111-1111-111111111111';
insert into dominio.producto_imagenes (id, producto_id, organizacion_id, posicion, ruta) values
  ('b1000000-0000-0000-0000-000000000001', 'a1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 1,
   '11111111-1111-1111-1111-111111111111/a1000000-0000-0000-0000-000000000001/frente.png'),
  ('b1000000-0000-0000-0000-000000000002', 'a1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 2,
   '11111111-1111-1111-1111-111111111111/a1000000-0000-0000-0000-000000000001/lateral.png'),
  ('b1000000-0000-0000-0000-000000000003', 'a1000000-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111', 1,
   '11111111-1111-1111-1111-111111111111/a1000000-0000-0000-0000-000000000003/frente.webp');

create function pg_temp.como(p_user uuid) returns void language plpgsql as $$
begin
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
  set local role authenticated;
end $$;

update public.banderas_plataforma set activa = true where clave in ('newsletter', 'promociones_precio');
-- La API que atiende las llamadas (cabecera que pone el proxy): la dirección pública de la imagen debe ser de este host.
select set_config('request.headers', '{"host":"p.supabase.co"}', true);

-- Cuenta las copias registradas aunque la sesión sea de authenticated (la tabla interna no es legible por la API).
create function pg_temp.n_copias() returns integer language sql security definer as $$ select count(*)::int from private.newsletter_imagenes $$;

-- ===== Bucket y políticas =====
select is((select public from storage.buckets where id = 'newsletter-imagenes'), true, 'el bucket de copias es público (lectura de solo imágenes ya públicas)');
select is((select allowed_mime_types from storage.buckets where id = 'newsletter-imagenes'), array['image/webp'], 'solo admite image/webp');
select is((select file_size_limit from storage.buckets where id = 'newsletter-imagenes'), 262144::bigint, 'tope de 256 KiB por archivo');
select is((select public from storage.buckets where id = 'productos-imagenes'), false, 'el bucket de originales sigue siendo privado');
select is((select count(*)::int from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname like 'newsletter_imagenes_objetos_%'), 4,
  'hay cuatro políticas (lectura, alta, sobrescritura y baja)');
select is((select count(*)::int from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname like 'newsletter_imagenes_objetos_%' and 'anon' = any (roles)), 0,
  'ninguna política es para anon (la lectura pública es del bucket)');

-- Subida: solo Administrador, bajo su organización y tienda, con ruta exacta uuid/uuid/uuid.webp.
select pg_temp.como('d1000000-0000-0000-0000-000000000001');
select lives_ok(
  $$insert into storage.objects (bucket_id, name, owner) values
      ('newsletter-imagenes', '11111111-1111-1111-1111-111111111111/e1000000-0000-0000-0000-000000000001/a1000000-0000-0000-0000-000000000001.webp', 'd1000000-0000-0000-0000-000000000001')$$,
  'administrador: sube la copia de su producto en su tienda');
select throws_ok(
  $$insert into storage.objects (bucket_id, name, owner) values
      ('newsletter-imagenes', '22222222-2222-2222-2222-222222222222/e2000000-0000-0000-0000-000000000001/a2000000-0000-0000-0000-000000000001.webp', 'd1000000-0000-0000-0000-000000000001')$$,
  '42501', null, 'administrador: no sube bajo otra organización');
select throws_ok(
  $$insert into storage.objects (bucket_id, name, owner) values
      ('newsletter-imagenes', '11111111-1111-1111-1111-111111111111/e2000000-0000-0000-0000-000000000001/a1000000-0000-0000-0000-000000000001.webp', 'd1000000-0000-0000-0000-000000000001')$$,
  '42501', null, 'administrador: no sube en una tienda que no es de su organización');
select throws_ok(
  $$insert into storage.objects (bucket_id, name, owner) values
      ('newsletter-imagenes', '11111111-1111-1111-1111-111111111111/e1000000-0000-0000-0000-000000000001/a1000000-0000-0000-0000-000000000003.png', 'd1000000-0000-0000-0000-000000000001')$$,
  '42501', null, 'administrador: no sube con otra extensión');
select throws_ok(
  $$insert into storage.objects (bucket_id, name, owner) values
      ('newsletter-imagenes', '11111111-1111-1111-1111-111111111111/e1000000-0000-0000-0000-000000000001/cualquiera.webp', 'd1000000-0000-0000-0000-000000000001')$$,
  '42501', null, 'administrador: el nombre debe ser un uuid de producto');
select throws_ok(
  $$insert into storage.objects (bucket_id, name, owner) values
      ('newsletter-imagenes', '11111111-1111-1111-1111-111111111111/e1000000-0000-0000-0000-000000000001/sub/a1000000-0000-0000-0000-000000000003.webp', 'd1000000-0000-0000-0000-000000000001')$$,
  '42501', null, 'administrador: sin subcarpetas extra');
select pg_temp.como('d1000000-0000-0000-0000-000000000002');
select throws_ok(
  $$insert into storage.objects (bucket_id, name, owner) values
      ('newsletter-imagenes', '11111111-1111-1111-1111-111111111111/e1000000-0000-0000-0000-000000000001/a1000000-0000-0000-0000-000000000003.webp', 'd1000000-0000-0000-0000-000000000002')$$,
  '42501', null, 'quien no es Administrador no sube');
select throws_ok(
  $$insert into storage.objects (bucket_id, name, owner) values
      ('productos-imagenes', '11111111-1111-1111-1111-111111111111/a1000000-0000-0000-0000-000000000003/otra.webp', 'd1000000-0000-0000-0000-000000000002')$$,
  '42501', null, 'el bucket privado sigue cerrado a quien no edita productos');
reset role;

-- ===== Tabla interna =====
select is((select relrowsecurity from pg_class where oid = 'private.newsletter_imagenes'::regclass), true, 'RLS activado en la tabla interna');
select is(
  (select array_agg(pg_get_expr(polqual, polrelid) || '/' || pg_get_expr(polwithcheck, polrelid) order by polname) from pg_policy where polrelid = 'private.newsletter_imagenes'::regclass),
  array['false/false'], 'una única política que deniega todo');
select is(
  (select bool_or(has_table_privilege(r, 'private.newsletter_imagenes', p))
     from unnest(array['anon', 'authenticated', 'service_role']) r, unnest(array['select', 'insert', 'update', 'delete', 'truncate']) p),
  false, 'nadie de la API toca la tabla directamente');
select is(
  (select bool_and(not has_function_privilege(r, f, 'execute'))
     from unnest(array['anon', 'authenticated', 'public']) r,
          unnest(array['private.url_imagen_newsletter(uuid,uuid)', 'private.imagen_html_newsletter(jsonb)', 'private.purgar_imagenes_newsletter(integer)']) f),
  true, 'las funciones internas no son ejecutables por la API');
select is(
  (select bool_and(has_function_privilege('authenticated', f, 'execute') and not has_function_privilege('anon', f, 'execute') and not has_function_privilege('public', f, 'execute'))
     from unnest(array['public.registrar_imagen_newsletter(uuid,uuid,uuid,text)', 'public.productos_para_imagenes_newsletter(uuid,boolean,boolean)']) f),
  true, 'las dos RPC son solo de authenticated');
select is(
  (select bool_and(p.prosecdef and p.proconfig = array['search_path=""'])
     from pg_proc p where p.oid in ('public.registrar_imagen_newsletter(uuid,uuid,uuid,text)'::regprocedure, 'public.productos_para_imagenes_newsletter(uuid,boolean,boolean)'::regprocedure,
                                    'private.url_imagen_newsletter(uuid,uuid)'::regprocedure, 'private.purgar_imagenes_newsletter(integer)'::regprocedure)),
  true, 'las funciones con datos son security definer con search_path vacío');

-- ===== Qué productos copiar =====
select pg_temp.como('d1000000-0000-0000-0000-000000000001');
select is(
  (select jsonb_agg(e ->> 'producto_id' order by e ->> 'producto_id') from jsonb_array_elements(public.productos_para_imagenes_newsletter('e1000000-0000-0000-0000-000000000001', true, false)) e),
  '["a1000000-0000-0000-0000-000000000001", "a1000000-0000-0000-0000-000000000003"]'::jsonb,
  'devuelve los productos de la foto con imagen y omite el que no tiene');
select is(
  (select e ->> 'origen' from jsonb_array_elements(public.productos_para_imagenes_newsletter('e1000000-0000-0000-0000-000000000001', true, false)) e
    where e ->> 'producto_id' = 'a1000000-0000-0000-0000-000000000001'),
  '11111111-1111-1111-1111-111111111111/a1000000-0000-0000-0000-000000000001/frente.png', 'del producto con dos imágenes devuelve la principal (posición 1)');
select is(
  (select e ->> 'imagen_id' from jsonb_array_elements(public.productos_para_imagenes_newsletter('e1000000-0000-0000-0000-000000000001', true, false)) e
    where e ->> 'producto_id' = 'a1000000-0000-0000-0000-000000000001'),
  'b1000000-0000-0000-0000-000000000001', 'y su id');
select is(public.productos_para_imagenes_newsletter('e1000000-0000-0000-0000-000000000001', false, false), '[]'::jsonb, 'sin secciones no hay productos');
select throws_ok($$select public.productos_para_imagenes_newsletter('e1000000-0000-0000-0000-000000000001', null, false)$$, '22023', 'Falta indicar las secciones del newsletter', 'secciones nulas');
select throws_ok($$select public.productos_para_imagenes_newsletter('e2000000-0000-0000-0000-000000000001', true, true)$$, 'P0002', 'La tienda no existe', 'tienda de otra organización');
select throws_ok($$select public.productos_para_imagenes_newsletter(null, true, true)$$, 'P0002', 'La tienda no existe', 'tienda nula');
select pg_temp.como('d1000000-0000-0000-0000-000000000002');
select throws_ok($$select public.productos_para_imagenes_newsletter('e1000000-0000-0000-0000-000000000001', true, true)$$, '42501', 'Solo un Administrador puede gestionar el newsletter', 'quien no es Administrador no lista');
reset role;

-- ===== Antes de registrar: la foto sale sin imagen =====
select pg_temp.como('d1000000-0000-0000-0000-000000000001');
select is(
  (select bool_and(e -> 'imagen_url' = 'null'::jsonb)
     from jsonb_array_elements(public.vista_previa_newsletter('e1000000-0000-0000-0000-000000000001', 'Hola', true, false) -> 'bloques' -> 'destacados') e),
  true, 'sin copias registradas, imagen_url es nulo en todos');
select is(position('<img' in public.vista_previa_newsletter('e1000000-0000-0000-0000-000000000001', 'Hola', true, false) ->> 'html'), 0, 'y el HTML no lleva imágenes');

-- ===== Registrar =====
select throws_ok($$select public.registrar_imagen_newsletter('e1000000-0000-0000-0000-000000000001', 'a1000000-0000-0000-0000-000000000003', 'b1000000-0000-0000-0000-000000000003',
   'https://p.supabase.co/storage/v1/object/public/newsletter-imagenes/11111111-1111-1111-1111-111111111111/e1000000-0000-0000-0000-000000000001/a1000000-0000-0000-0000-000000000003.webp')$$,
  '22023', 'La copia de la imagen no está en el bucket', 'sin el archivo en el bucket no se registra');
-- (la copia del producto 1 ya está subida arriba; la del 3 todavía no)
select throws_ok($$select public.registrar_imagen_newsletter('e1000000-0000-0000-0000-000000000001', 'a1000000-0000-0000-0000-000000000001', 'b1000000-0000-0000-0000-000000000002',
   'https://p.supabase.co/storage/v1/object/public/newsletter-imagenes/11111111-1111-1111-1111-111111111111/e1000000-0000-0000-0000-000000000001/a1000000-0000-0000-0000-000000000001.webp')$$,
  '22023', 'La imagen ya no es la principal del producto', 'una imagen que no es la principal no se registra');
select throws_ok($$select public.registrar_imagen_newsletter('e1000000-0000-0000-0000-000000000001', 'a2000000-0000-0000-0000-000000000001', 'b1000000-0000-0000-0000-000000000001', 'https://x.test/a.webp')$$,
  'P0002', 'El producto no existe', 'el producto de otra organización no existe');
select throws_ok($$select public.registrar_imagen_newsletter('e1000000-0000-0000-0000-000000000001', 'a1000000-0000-0000-0000-000000000001', null, 'https://x.test/a.webp')$$,
  '22023', 'Faltan datos de la imagen', 'falta la imagen');
select throws_ok($$select public.registrar_imagen_newsletter('e2000000-0000-0000-0000-000000000001', 'a1000000-0000-0000-0000-000000000001', 'b1000000-0000-0000-0000-000000000001', 'https://x.test/a.webp')$$,
  'P0002', 'La tienda no existe', 'la tienda de otra organización no existe');

-- URL: solo https y terminada en la ruta pública exacta (n-1 / n / n+1 en el largo, y caracteres peligrosos).
select throws_ok($$select public.registrar_imagen_newsletter('e1000000-0000-0000-0000-000000000001', 'a1000000-0000-0000-0000-000000000001', 'b1000000-0000-0000-0000-000000000001', 'https://evil.example.com/foto.webp')$$,
  '22023', 'La dirección pública de la imagen no es de este servidor', 'una dirección de otro dominio se rechaza');
select throws_ok($$select public.registrar_imagen_newsletter('e1000000-0000-0000-0000-000000000001', 'a1000000-0000-0000-0000-000000000001', 'b1000000-0000-0000-0000-000000000001',
   'http://p.supabase.co/storage/v1/object/public/newsletter-imagenes/11111111-1111-1111-1111-111111111111/e1000000-0000-0000-0000-000000000001/a1000000-0000-0000-0000-000000000001.webp')$$,
  '22023', 'La dirección pública de la imagen no es válida', 'http plano se rechaza');
select throws_ok($$select public.registrar_imagen_newsletter('e1000000-0000-0000-0000-000000000001', 'a1000000-0000-0000-0000-000000000001', 'b1000000-0000-0000-0000-000000000001',
   'https://p.supabase.co/storage/v1/object/public/newsletter-imagenes/11111111-1111-1111-1111-111111111111/e1000000-0000-0000-0000-000000000001/a1000000-0000-0000-0000-000000000001.webp?x=1')$$,
  '22023', 'La dirección pública de la imagen no es válida', 'una consulta (?) se rechaza');
select throws_ok($$select public.registrar_imagen_newsletter('e1000000-0000-0000-0000-000000000001', 'a1000000-0000-0000-0000-000000000001', 'b1000000-0000-0000-0000-000000000001',
   'https://p.supabase.co/storage/v1/object/public/newsletter-imagenes/11111111-1111-1111-1111-111111111111/e1000000-0000-0000-0000-000000000001/a1000000-0000-0000-0000-000000000001.webp"onerror="x')$$,
  '22023', 'La dirección pública de la imagen no es válida', 'las comillas se rechazan');
select throws_ok($$select public.registrar_imagen_newsletter('e1000000-0000-0000-0000-000000000001', 'a1000000-0000-0000-0000-000000000001', 'b1000000-0000-0000-0000-000000000001',
   'https://p.supabase.co/storage/v1/object/public/newsletter-imagenes/11111111-1111-1111-1111-111111111111/e1000000-0000-0000-0000-000000000001/a1000000-0000-0000-0000-000000000099.webp')$$,
  '22023', 'La dirección pública de la imagen no es válida', 'la ruta de otro producto se rechaza');
select throws_ok($$select public.registrar_imagen_newsletter('e1000000-0000-0000-0000-000000000001', 'a1000000-0000-0000-0000-000000000001', 'b1000000-0000-0000-0000-000000000001', null)$$,
  '22023', 'La dirección pública de la imagen no es válida', 'url nula');
select throws_ok(format($$select public.registrar_imagen_newsletter('e1000000-0000-0000-0000-000000000001', 'a1000000-0000-0000-0000-000000000001', 'b1000000-0000-0000-0000-000000000001', %L)$$,
   'https://' || repeat('h', 400) || '/storage/v1/object/public/newsletter-imagenes/11111111-1111-1111-1111-111111111111/e1000000-0000-0000-0000-000000000001/a1000000-0000-0000-0000-000000000001.webp'),
  '22023', 'La dirección pública de la imagen no es válida', 'una URL de más de 500 caracteres se rechaza');

select is(pg_temp.n_copias(), 0, 'ningún intento inválido dejó un registro');

-- Host de la URL contra el de la API (cabecera del proxy): el mismo path en otro dominio, un subdominio parecido y sin cabecera se rechazan.
select throws_ok($$select public.registrar_imagen_newsletter('e1000000-0000-0000-0000-000000000001', 'a1000000-0000-0000-0000-000000000001', 'b1000000-0000-0000-0000-000000000001',
   'https://evil.example.com/storage/v1/object/public/newsletter-imagenes/11111111-1111-1111-1111-111111111111/e1000000-0000-0000-0000-000000000001/a1000000-0000-0000-0000-000000000001.webp')$$,
  '22023', 'La dirección pública de la imagen no es de este servidor', 'el mismo path en otro dominio se rechaza');
select throws_ok($$select public.registrar_imagen_newsletter('e1000000-0000-0000-0000-000000000001', 'a1000000-0000-0000-0000-000000000001', 'b1000000-0000-0000-0000-000000000001',
   'https://p.supabase.co.evil.com/storage/v1/object/public/newsletter-imagenes/11111111-1111-1111-1111-111111111111/e1000000-0000-0000-0000-000000000001/a1000000-0000-0000-0000-000000000001.webp')$$,
  '22023', 'La dirección pública de la imagen no es de este servidor', 'un dominio que solo empieza igual se rechaza');
select throws_ok($$select public.registrar_imagen_newsletter('e1000000-0000-0000-0000-000000000001', 'a1000000-0000-0000-0000-000000000001', 'b1000000-0000-0000-0000-000000000001',
   'https://evilp.supabase.co/storage/v1/object/public/newsletter-imagenes/11111111-1111-1111-1111-111111111111/e1000000-0000-0000-0000-000000000001/a1000000-0000-0000-0000-000000000001.webp')$$,
  '22023', 'La dirección pública de la imagen no es de este servidor', 'un dominio que solo termina igual se rechaza');
select set_config('request.headers', '{}', true);
select throws_ok($$select public.registrar_imagen_newsletter('e1000000-0000-0000-0000-000000000001', 'a1000000-0000-0000-0000-000000000001', 'b1000000-0000-0000-0000-000000000001',
   'https://p.supabase.co/storage/v1/object/public/newsletter-imagenes/11111111-1111-1111-1111-111111111111/e1000000-0000-0000-0000-000000000001/a1000000-0000-0000-0000-000000000001.webp')$$,
  '22023', 'La dirección pública de la imagen no es de este servidor', 'sin la cabecera del proxy se rechaza (falla cerrada)');
select set_config('request.headers', '{"host":"otra-api.example.com","x-forwarded-host":"p.supabase.co:8443"}', true);
select lives_ok($$select public.registrar_imagen_newsletter('e1000000-0000-0000-0000-000000000001', 'a1000000-0000-0000-0000-000000000001', 'b1000000-0000-0000-0000-000000000001',
   'https://P.Supabase.co/storage/v1/object/public/newsletter-imagenes/11111111-1111-1111-1111-111111111111/e1000000-0000-0000-0000-000000000001/a1000000-0000-0000-0000-000000000001.webp')$$,
  'x-forwarded-host manda sobre host, se ignora el puerto y no distingue mayúsculas');
select is(pg_temp.n_copias(), 1, 'ese registro válido quedó');
select set_config('request.headers', '{"host":"p.supabase.co"}', true);

-- Producto no publicado en la tienda: con imagen y de la organización, pero oculto en esta tienda.
reset role;
insert into dominio.productos (id, organizacion_id, nombre, sku, compatible_con, precio_lista, moneda, activo)
  values ('a1000000-0000-0000-0000-000000000004', '11111111-1111-1111-1111-111111111111', 'Producto 4', 'NLI-4', '{}', 4000, 'ARS', true);
insert into dominio.producto_empresa (producto_id, empresa_id, organizacion_id) values ('a1000000-0000-0000-0000-000000000004', 'e1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111');
insert into dominio.productos_tienda (empresa_id, producto_id, organizacion_id, visible, destacado)
  values ('e1000000-0000-0000-0000-000000000001', 'a1000000-0000-0000-0000-000000000004', '11111111-1111-1111-1111-111111111111', false, true);
insert into dominio.producto_imagenes (id, producto_id, organizacion_id, posicion, ruta) values
  ('b1000000-0000-0000-0000-000000000004', 'a1000000-0000-0000-0000-000000000004', '11111111-1111-1111-1111-111111111111', 1,
   '11111111-1111-1111-1111-111111111111/a1000000-0000-0000-0000-000000000004/frente.png');
select pg_temp.como('d1000000-0000-0000-0000-000000000001');
select throws_ok($$select public.registrar_imagen_newsletter('e1000000-0000-0000-0000-000000000001', 'a1000000-0000-0000-0000-000000000004', 'b1000000-0000-0000-0000-000000000004',
   'https://p.supabase.co/storage/v1/object/public/newsletter-imagenes/11111111-1111-1111-1111-111111111111/e1000000-0000-0000-0000-000000000001/a1000000-0000-0000-0000-000000000004.webp')$$,
  '22023', 'El producto no está publicado en la tienda', 'un producto oculto en la tienda no se registra');
select is(pg_temp.n_copias(), 1, 'y no dejó registro');


select lives_ok($$select public.registrar_imagen_newsletter('e1000000-0000-0000-0000-000000000001', 'a1000000-0000-0000-0000-000000000001', 'b1000000-0000-0000-0000-000000000001',
   'https://p.supabase.co/storage/v1/object/public/newsletter-imagenes/11111111-1111-1111-1111-111111111111/e1000000-0000-0000-0000-000000000001/a1000000-0000-0000-0000-000000000001.webp')$$,
  'registra la copia válida');
select is(pg_temp.n_copias(), 1, 'queda un registro');
select lives_ok($$select public.registrar_imagen_newsletter('e1000000-0000-0000-0000-000000000001', 'a1000000-0000-0000-0000-000000000001', 'b1000000-0000-0000-0000-000000000001',
   'https://p.supabase.co/storage/v1/object/public/newsletter-imagenes/11111111-1111-1111-1111-111111111111/e1000000-0000-0000-0000-000000000001/a1000000-0000-0000-0000-000000000001.webp')$$,
  'registrar de nuevo la misma copia (nuevo envío) es idempotente');
select is(pg_temp.n_copias(), 1, 'sigue habiendo un solo registro por producto y tienda');

-- ===== La foto y el correo llevan la imagen =====
select is(
  (select e ->> 'imagen_url' from jsonb_array_elements(public.vista_previa_newsletter('e1000000-0000-0000-0000-000000000001', 'Hola', true, false) -> 'bloques' -> 'destacados') e
    where e ->> 'producto_id' = 'a1000000-0000-0000-0000-000000000001'),
  'https://p.supabase.co/storage/v1/object/public/newsletter-imagenes/11111111-1111-1111-1111-111111111111/e1000000-0000-0000-0000-000000000001/a1000000-0000-0000-0000-000000000001.webp',
  'el producto con copia vigente lleva su URL pública');
select is(
  (select count(*)::int from jsonb_array_elements(public.vista_previa_newsletter('e1000000-0000-0000-0000-000000000001', 'Hola', true, false) -> 'bloques' -> 'destacados') e
    where e -> 'imagen_url' = 'null'::jsonb),
  2, 'los dos productos sin copia siguen sin imagen');
select is(
  (select (length(h) - length(replace(h, '<img ', ''))) / length('<img ') from (select public.vista_previa_newsletter('e1000000-0000-0000-0000-000000000001', 'Hola', true, false) ->> 'html' h) x),
  1, 'el HTML tiene exactamente una imagen');
select ok(
  position('<img src="https://p.supabase.co/storage/v1/object/public/newsletter-imagenes/11111111-1111-1111-1111-111111111111/e1000000-0000-0000-0000-000000000001/a1000000-0000-0000-0000-000000000001.webp" alt="Producto 1" width="96" style="display: block; border: 0; margin: 0 0 4px 0;">'
            in public.vista_previa_newsletter('e1000000-0000-0000-0000-000000000001', 'Hola', true, false) ->> 'html') > 0,
  'la etiqueta sale con el valor exacto (src, alt con el nombre y ancho fijo)');

reset role;
-- Valor exacto de la etiqueta y del escape.
select is(private.imagen_html_newsletter('{"imagen_url":"https://a.test/x.webp","nombre":"A \"B\" <i>"}'::jsonb),
  '<img src="https://a.test/x.webp" alt="A &quot;B&quot; &lt;i&gt;" width="96" style="display: block; border: 0; margin: 0 0 4px 0;">', 'el alt se escapa');
select is(private.imagen_html_newsletter('{"imagen_url":null,"nombre":"A"}'::jsonb), '', 'sin URL no hay etiqueta');
select is(private.imagen_html_newsletter('{"imagen_url":"http://a.test/x.webp","nombre":"A"}'::jsonb), '', 'una URL que no es https no genera etiqueta');
select is(private.imagen_html_newsletter('{"imagen_url":"javascript:alert(1)","nombre":"A"}'::jsonb), '', 'un esquema peligroso no genera etiqueta');
select is(private.imagen_html_newsletter('{"nombre":"A"}'::jsonb), '', 'sin la clave no hay etiqueta');


-- ===== Políticas de escritura del bucket (UPDATE y DELETE iguales a INSERT) =====
reset role;
insert into dominio.empresas (id, organizacion_id, nombre, activa) values ('e1000000-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111', 'Tienda inactiva', false);
insert into storage.objects (bucket_id, name) values
  ('newsletter-imagenes', '11111111-1111-1111-1111-111111111111/e1000000-0000-0000-0000-000000000003/a1000000-0000-0000-0000-000000000003.webp'),
  ('newsletter-imagenes', '11111111-1111-1111-1111-111111111111/e1000000-0000-0000-0000-000000000001/a1000000-0000-0000-0000-000000000003.webp');
-- Intenta una sentencia y dice qué pasó (cuántas filas o el código de error); el borrado directo de storage.objects lo prohíbe Storage.
create function pg_temp.intentar(p_sql text) returns text language plpgsql as $$
declare v_n bigint;
begin
  execute p_sql;
  get diagnostics v_n = row_count;
  return 'filas:' || v_n;
exception when others then
  return 'error:' || sqlstate;
end $$;
create function pg_temp.n_objetos(p_nombre text) returns integer language sql security definer as $$ select count(*)::int from storage.objects where bucket_id = 'newsletter-imagenes' and name = p_nombre $$;
select pg_temp.como('d1000000-0000-0000-0000-000000000001');
select throws_ok($$insert into storage.objects (bucket_id, name, owner) values ('newsletter-imagenes', '11111111-1111-1111-1111-111111111111/e1000000-0000-0000-0000-000000000003/a1000000-0000-0000-0000-000000000001.webp', 'd1000000-0000-0000-0000-000000000001')$$,
  '42501', null, 'insertar en una tienda inactiva (no accesible) se rechaza');
select throws_ok($$insert into storage.objects (bucket_id, name, owner) values ('newsletter-imagenes', '22222222-2222-2222-2222-222222222222/e1000000-0000-0000-0000-000000000001/a1000000-0000-0000-0000-000000000001.webp', 'd1000000-0000-0000-0000-000000000001')$$,
  '42501', null, 'insertar bajo la carpeta de otra organización con una tienda propia se rechaza (la carpeta cuenta aparte de la tienda)');
select is(pg_temp.intentar($$update storage.objects set name = name where bucket_id = 'newsletter-imagenes' and name = '11111111-1111-1111-1111-111111111111/e1000000-0000-0000-0000-000000000003/a1000000-0000-0000-0000-000000000003.webp'$$), 'filas:0',
  'actualizar el archivo de una tienda no accesible no toca ninguna fila');
select is(pg_temp.intentar($$update storage.objects set name = name where bucket_id = 'newsletter-imagenes' and name = '11111111-1111-1111-1111-111111111111/e1000000-0000-0000-0000-000000000001/a1000000-0000-0000-0000-000000000003.webp'$$), 'filas:1',
  'actualizar el archivo de una tienda propia sí');
select is(pg_temp.intentar($$update storage.objects set name = '11111111-1111-1111-1111-111111111111/e1000000-0000-0000-0000-000000000001/malo.webp' where bucket_id = 'newsletter-imagenes' and name = '11111111-1111-1111-1111-111111111111/e1000000-0000-0000-0000-000000000001/a1000000-0000-0000-0000-000000000003.webp'$$), 'error:42501',
  'renombrar a una ruta que no es uuid/uuid/uuid.webp se rechaza (el with check de UPDATE exige la ruta como el INSERT)');
select is(pg_temp.intentar($$update storage.objects set name = '11111111-1111-1111-1111-111111111111/e1000000-0000-0000-0000-000000000003/a1000000-0000-0000-0000-000000000001.webp' where bucket_id = 'newsletter-imagenes' and name = '11111111-1111-1111-1111-111111111111/e1000000-0000-0000-0000-000000000001/a1000000-0000-0000-0000-000000000003.webp'$$), 'error:42501',
  'mover un archivo a una tienda no accesible se rechaza');
select is(pg_temp.intentar($$delete from storage.objects where bucket_id = 'newsletter-imagenes' and name = '11111111-1111-1111-1111-111111111111/e1000000-0000-0000-0000-000000000003/a1000000-0000-0000-0000-000000000003.webp'$$), 'filas:0',
  'borrar el archivo de una tienda no accesible no toca ninguna fila (el filtro de tienda existe)');
select is(pg_temp.n_objetos('11111111-1111-1111-1111-111111111111/e1000000-0000-0000-0000-000000000003/a1000000-0000-0000-0000-000000000003.webp'), 1, 'y el archivo sigue');
select ok(pg_temp.intentar($$delete from storage.objects where bucket_id = 'newsletter-imagenes' and name = '11111111-1111-1111-1111-111111111111/e1000000-0000-0000-0000-000000000001/a1000000-0000-0000-0000-000000000003.webp'$$) in ('filas:1') or pg_temp.intentar($$delete from storage.objects where bucket_id = 'newsletter-imagenes' and name = '11111111-1111-1111-1111-111111111111/e1000000-0000-0000-0000-000000000001/a1000000-0000-0000-0000-000000000003.webp'$$) like 'error:%',
  'borrar el archivo de una tienda propia pasa la política (Storage real lo rechaza después con su disparador: se borra con la API)');
-- La política le da el DELETE a un Administrador y no a una persona de solo lectura.
select pg_temp.como('d1000000-0000-0000-0000-000000000002');
select is(pg_temp.intentar($$delete from storage.objects where bucket_id = 'newsletter-imagenes' and name = '11111111-1111-1111-1111-111111111111/e1000000-0000-0000-0000-000000000001/a1000000-0000-0000-0000-000000000003.webp'$$), 'filas:0', 'quien no es Administrador no borra ni lo ve');
select pg_temp.como('d2000000-0000-0000-0000-000000000001');
select is(pg_temp.intentar($$delete from storage.objects where bucket_id = 'newsletter-imagenes' and name = '11111111-1111-1111-1111-111111111111/e1000000-0000-0000-0000-000000000001/a1000000-0000-0000-0000-000000000003.webp'$$), 'filas:0', 'el Administrador de otra organización no borra');

-- ===== Imagen en las promociones =====
reset role;
insert into storage.objects (bucket_id, name) select 'newsletter-imagenes', '11111111-1111-1111-1111-111111111111/e1000000-0000-0000-0000-000000000001/a1000000-0000-0000-0000-000000000003.webp' where not exists (select 1 from storage.objects where bucket_id = 'newsletter-imagenes' and name = '11111111-1111-1111-1111-111111111111/e1000000-0000-0000-0000-000000000001/a1000000-0000-0000-0000-000000000003.webp');
insert into dominio.promociones_precio (organizacion_id, empresa_id, producto_id, precio_promocional, desde, hasta) values
  ('11111111-1111-1111-1111-111111111111', 'e1000000-0000-0000-0000-000000000001', 'a1000000-0000-0000-0000-000000000003', 1500, now() - interval '1 hour', now() + interval '2 days');
select pg_temp.como('d1000000-0000-0000-0000-000000000001');
select lives_ok($$select public.registrar_imagen_newsletter('e1000000-0000-0000-0000-000000000001', 'a1000000-0000-0000-0000-000000000003', 'b1000000-0000-0000-0000-000000000003', 'https://p.supabase.co/storage/v1/object/public/newsletter-imagenes/11111111-1111-1111-1111-111111111111/e1000000-0000-0000-0000-000000000001/a1000000-0000-0000-0000-000000000003.webp')$$, 'registra la copia del producto en promoción');
select is(
  (select e ->> 'imagen_url' from jsonb_array_elements(public.vista_previa_newsletter('e1000000-0000-0000-0000-000000000001', 'Hola', false, true) -> 'bloques' -> 'promociones') e where e ->> 'producto_id' = 'a1000000-0000-0000-0000-000000000003'),
  'https://p.supabase.co/storage/v1/object/public/newsletter-imagenes/11111111-1111-1111-1111-111111111111/e1000000-0000-0000-0000-000000000001/a1000000-0000-0000-0000-000000000003.webp', 'la sección de promociones también lleva la imagen');
select ok(position('<img src="https://p.supabase.co/storage/v1/object/public/newsletter-imagenes/11111111-1111-1111-1111-111111111111/e1000000-0000-0000-0000-000000000001/a1000000-0000-0000-0000-000000000003.webp" alt="Producto 3"' in public.vista_previa_newsletter('e1000000-0000-0000-0000-000000000001', 'Hola', false, true) ->> 'html') > 0, 'y el HTML la dibuja en promociones');
reset role;
delete from private.newsletter_imagenes where producto_id = 'a1000000-0000-0000-0000-000000000003';

-- Escape de la dirección y del nombre en la etiqueta.
select is(private.imagen_html_newsletter('{"imagen_url":"https://a.test/x.webp?a=1&b=2","nombre":"n"}'::jsonb),
  '<img src="https://a.test/x.webp?a=1&amp;b=2" alt="n" width="96" style="display: block; border: 0; margin: 0 0 4px 0;">', 'el & de la dirección sale como entidad');
select is(private.imagen_html_newsletter('{"imagen_url":"https://a.test/x\"onerror=\"y","nombre":"n"}'::jsonb),
  '<img src="https://a.test/x&quot;onerror=&quot;y" alt="n" width="96" style="display: block; border: 0; margin: 0 0 4px 0;">', 'las comillas de la dirección no cierran el atributo');

-- ===== Vigencia: si cambia la imagen principal, la copia deja de valer =====
reset role;
delete from dominio.producto_imagenes where id = 'b1000000-0000-0000-0000-000000000001';
select pg_temp.como('d1000000-0000-0000-0000-000000000001');
select is(
  (select e -> 'imagen_url' from jsonb_array_elements(public.vista_previa_newsletter('e1000000-0000-0000-0000-000000000001', 'Hola', true, false) -> 'bloques' -> 'destacados') e
    where e ->> 'producto_id' = 'a1000000-0000-0000-0000-000000000001'),
  'null'::jsonb, 'al quitar la imagen principal (la segunda pasa a serlo) la copia vieja no se usa: el correo sale sin imagen');
select throws_ok($$select public.registrar_imagen_newsletter('e1000000-0000-0000-0000-000000000001', 'a1000000-0000-0000-0000-000000000001', 'b1000000-0000-0000-0000-000000000001',
   'https://p.supabase.co/storage/v1/object/public/newsletter-imagenes/11111111-1111-1111-1111-111111111111/e1000000-0000-0000-0000-000000000001/a1000000-0000-0000-0000-000000000001.webp')$$,
  '22023', 'La imagen ya no es la principal del producto', 'y la imagen quitada no se puede registrar');

-- Archivo borrado del bucket: tampoco se usa la URL.
reset role;
select is(private.url_imagen_newsletter('e1000000-0000-0000-0000-000000000001', 'a1000000-0000-0000-0000-000000000003'), null, 'un producto sin copia: url nula');
-- (Storage no admite borrar filas de storage.objects por SQL: se prueba con un registro cuya copia nunca se subió.)
insert into private.newsletter_imagenes (empresa_id, producto_id, organizacion_id, imagen_id, ruta, url) values
  ('e1000000-0000-0000-0000-000000000001', 'a1000000-0000-0000-0000-000000000004', '11111111-1111-1111-1111-111111111111', 'b1000000-0000-0000-0000-000000000004', '11111111-1111-1111-1111-111111111111/e1000000-0000-0000-0000-000000000001/a1000000-0000-0000-0000-000000000004.webp', 'https://p.supabase.co/x.webp');
select is(private.url_imagen_newsletter('e1000000-0000-0000-0000-000000000001', 'a1000000-0000-0000-0000-000000000004'), null, 'sin el archivo en el bucket la URL no se usa');
delete from private.newsletter_imagenes where producto_id = 'a1000000-0000-0000-0000-000000000004';

-- ===== Limpieza =====
insert into private.newsletter_imagenes (empresa_id, producto_id, organizacion_id, imagen_id, ruta, url, actualizada_en) values
  ('e1000000-0000-0000-0000-000000000001', 'a1000000-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111', 'b1000000-0000-0000-0000-000000000003',
   '11111111-1111-1111-1111-111111111111/e1000000-0000-0000-0000-000000000001/a1000000-0000-0000-0000-000000000003.webp', 'https://p.supabase.co/x.webp', now() - interval '91 days');
update private.newsletter_imagenes set actualizada_en = now() - interval '89 days' where producto_id = 'a1000000-0000-0000-0000-000000000001';
select is(private.purgar_imagenes_newsletter(90), array['11111111-1111-1111-1111-111111111111/e1000000-0000-0000-0000-000000000001/a1000000-0000-0000-0000-000000000003.webp'],
  'la limpieza borra y devuelve la ruta de lo de más de 90 días (91) y deja lo de 89');
select is((select count(*)::int from private.newsletter_imagenes), 1, 'queda el registro de 89 días');
select is(private.purgar_imagenes_newsletter(90), '{}'::text[], 'repetirla no borra nada más');
select is(private.purgar_imagenes_newsletter(1), array['11111111-1111-1111-1111-111111111111/e1000000-0000-0000-0000-000000000001/a1000000-0000-0000-0000-000000000001.webp'],
  'con 1 día entra el de 89');
select throws_ok($$select private.purgar_imagenes_newsletter(0)$$, '22023', 'purgar_imagenes_newsletter: los días deben ser un entero mayor o igual a 1', 'días 0');
select throws_ok($$select private.purgar_imagenes_newsletter(null)$$, '22023', 'purgar_imagenes_newsletter: los días deben ser un entero mayor o igual a 1', 'días nulos');

-- Restricciones de la tabla.
select throws_ok($$insert into private.newsletter_imagenes (empresa_id, producto_id, organizacion_id, imagen_id, ruta, url) values
  ('e1000000-0000-0000-0000-000000000001', 'a1000000-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111', 'b1000000-0000-0000-0000-000000000003', 'otra/ruta.webp', 'https://p.supabase.co/x.webp')$$,
  '23514', 'new row for relation "newsletter_imagenes" violates check constraint "newsletter_imagenes_ruta_coherente"', 'la ruta debe ser la de su organización, tienda y producto');
select throws_ok($$insert into private.newsletter_imagenes (empresa_id, producto_id, organizacion_id, imagen_id, ruta, url) values
  ('e1000000-0000-0000-0000-000000000001', 'a1000000-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111', 'b1000000-0000-0000-0000-000000000003',
   '11111111-1111-1111-1111-111111111111/e1000000-0000-0000-0000-000000000001/a1000000-0000-0000-0000-000000000003.webp', 'http://p.supabase.co/x.webp')$$,
  '23514', 'new row for relation "newsletter_imagenes" violates check constraint "newsletter_imagenes_url_check"', 'la URL debe ser https');

select * from finish();
rollback;
