-- F-TDA-06 (MSF-216, épica MSF-133): borrador, vista previa y publicación de la tienda.
-- Verifica FR-050 (guardar en borrador con las mismas validaciones), FR-052 (las tres `guardar_*` ya no son
-- ejecutables por authenticated), FR-056 (publicar: transaccional, idempotente, crea versión), FR-058 (versión 1
-- «Configuración inicial»), FR-061 (anon sin acceso, publico no lee el borrador), FR-062 (archivos referenciados),
-- FR-063/FR-059 (vista previa sin costos; precios en vivo), FR-064 (auditoría) y SC-007 (aislamiento).
begin;

select plan(58);

-- ============================================================================
-- Fixture (como postgres)
-- ============================================================================

insert into organizaciones (id, nombre) values
  ('11111111-1111-1111-1111-111111111111', 'Organización Uno'),
  ('22222222-2222-2222-2222-222222222222', 'Organización Dos');

insert into auth.users (id, email) values
  ('d1000000-0000-0000-0000-000000000001', 'admin-uno@example.com'),
  ('d1000000-0000-0000-0000-000000000003', 'consulta-uno@example.com'),
  ('d2000000-0000-0000-0000-000000000001', 'admin-dos@example.com');

insert into usuarios_organizacion (user_id, organizacion_id, rol_id, estado) values
  ('d1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'administrador', 'activo'),
  ('d1000000-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111', 'consulta', 'activo'),
  ('d2000000-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', 'administrador', 'activo');

insert into dominio.empresas (id, organizacion_id, nombre, activa) values
  ('e1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'Tienda A', true),
  ('e1000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'Tienda B', false),
  ('e2000000-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', 'Tienda Dos', true);

insert into dominio.tiendas (organizacion_id, empresa_id, dominio) values
  ('11111111-1111-1111-1111-111111111111', 'e1000000-0000-0000-0000-000000000001', 'bor-a.ejemplo.com'),
  ('11111111-1111-1111-1111-111111111111', 'e1000000-0000-0000-0000-000000000002', 'bor-b.ejemplo.com'),
  ('22222222-2222-2222-2222-222222222222', 'e2000000-0000-0000-0000-000000000001', 'bor-dos.ejemplo.com');

insert into dominio.productos (id, organizacion_id, nombre, sku, precio_lista, moneda, activo) values
  ('a1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'Joystick', 'JOY-1', 49.90, 'USD', true),
  ('a1000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'Cable', 'CAB-1', 10, 'USD', true);

insert into dominio.producto_empresa (producto_id, empresa_id, organizacion_id) values
  ('a1000000-0000-0000-0000-000000000001', 'e1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111'),
  ('a1000000-0000-0000-0000-000000000002', 'e1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111');

create function pg_temp.como(p_user uuid) returns void language plpgsql as $$
begin
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
  set local role authenticated;
end;
$$;

-- Identidad completa; solo cambia el color primario (y, opcionalmente, el logo).
create function pg_temp.ident(p_color text, p_logo text default null) returns jsonb language sql as $$
  select jsonb_build_object(
    'color_primario', p_color, 'color_primario_oscuro', '#000000', 'color_acento', '#222222', 'color_fondo', '#FFFFFF',
    'tipografia_titulos', 'system-ui', 'tipografia_texto', 'system-ui',
    'logo_ruta', p_logo, 'banner_ruta', null, 'banner_movil_ruta', null);
$$;

-- ============================================================================
-- Estructura y privilegios (FR-050, FR-052, FR-061)
-- ============================================================================

select is((select relrowsecurity from pg_class where oid = 'dominio.tienda_borrador'::regclass), true, 'tienda_borrador tiene RLS');
select is((select relrowsecurity from pg_class where oid = 'dominio.tienda_versiones'::regclass), true, 'tienda_versiones tiene RLS');
select is(has_table_privilege('anon', 'dominio.tienda_borrador', 'select'), false, 'anon no lee el borrador');
select is(has_table_privilege('anon', 'dominio.tienda_versiones', 'select'), false, 'anon no lee las versiones');
select is(has_table_privilege('authenticated', 'dominio.tienda_borrador', 'insert'), false, 'authenticated no escribe el borrador directo');
select is(has_table_privilege('authenticated', 'dominio.tienda_versiones', 'insert'), false, 'authenticated no escribe las versiones directo');
select is(has_function_privilege('anon', 'public.guardar_borrador_tienda(uuid, text, jsonb)', 'execute'), false, 'anon no ejecuta guardar_borrador_tienda');
select is(has_function_privilege('anon', 'public.obtener_borrador_tienda(uuid)', 'execute'), false, 'anon no ejecuta obtener_borrador_tienda');
select is(has_function_privilege('anon', 'public.descartar_borrador_tienda(uuid)', 'execute'), false, 'anon no ejecuta descartar_borrador_tienda');
select is(has_function_privilege('anon', 'public.publicar_tienda(uuid)', 'execute'), false, 'anon no ejecuta publicar_tienda');
select is(has_function_privilege('anon', 'public.vista_previa_tienda(uuid)', 'execute'), false, 'anon no ejecuta vista_previa_tienda');
select is(has_function_privilege('anon', 'public.rutas_tienda_sin_referencia(uuid, text[])', 'execute'), false, 'anon no ejecuta rutas_tienda_sin_referencia');
select is(
  has_function_privilege('authenticated', 'public.guardar_tienda_identidad(uuid,text,text,text,text,text,text,text,text,text)', 'execute'),
  false, 'authenticated ya no ejecuta guardar_tienda_identidad (BREAKING)'
);
select is(
  has_function_privilege('authenticated', 'public.guardar_tienda_contenido(uuid,text,text,text,text,text,text,text,text)', 'execute'),
  false, 'authenticated ya no ejecuta guardar_tienda_contenido (BREAKING)'
);
select is(has_function_privilege('authenticated', 'public.guardar_catalogo_tienda(uuid, jsonb, jsonb)', 'execute'), false, 'authenticated ya no ejecuta guardar_catalogo_tienda (BREAKING)');
select is(has_function_privilege('authenticated', 'public.publicar_tienda(uuid)', 'execute'), true, 'authenticated ejecuta publicar_tienda');
select is(
  (select count(*)::int from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'publico' and c.relkind in ('r', 'p')),
  0, 'el esquema publico sigue sin tablas'
);

-- ============================================================================
-- Guardar en borrador no cambia lo publicado (FR-050, FR-061)
-- ============================================================================

select pg_temp.como('d1000000-0000-0000-0000-000000000001');

select lives_ok(
  $$select public.guardar_borrador_tienda('e1000000-0000-0000-0000-000000000001', 'identidad', pg_temp.ident('#c8102e'))$$,
  'guardar la identidad en el borrador'
);
select throws_ok(
  $$select public.guardar_borrador_tienda('e1000000-0000-0000-0000-000000000001', 'identidad', pg_temp.ident('azul'))$$,
  '22023', 'El color primario debe tener el formato #RRGGBB', 'un valor inválido no se guarda (mismo mensaje que la RPC viva)'
);
select throws_ok(
  $$select public.guardar_borrador_tienda('e1000000-0000-0000-0000-000000000001', 'precios', '{}'::jsonb)$$,
  '22023', 'El área del borrador no es válida', 'un área desconocida se rechaza'
);
select throws_ok(
  $$select public.guardar_borrador_tienda('e2000000-0000-0000-0000-000000000001', 'identidad', pg_temp.ident('#C8102E'))$$,
  'P0002', null, 'no se guarda el borrador de una empresa de otra organización'
);
select lives_ok(
  $$select public.guardar_borrador_tienda('e1000000-0000-0000-0000-000000000001', 'contenido',
      '{"titulo":"Hola","bienvenida":"Bienvenidos","boton_destino":"catalogo"}'::jsonb)$$,
  'guardar el contenido en el borrador'
);
select lives_ok(
  $$select public.guardar_borrador_tienda('e1000000-0000-0000-0000-000000000001', 'catalogo',
      '{"categorias":[],"productos":[{"id":"a1000000-0000-0000-0000-000000000001","visible":false,"destacado":false}]}'::jsonb)$$,
  'guardar el catálogo en el borrador'
);

reset role;

select is(
  (select color_primario from publico.identidad_por_dominio('bor-a.ejemplo.com')),
  '#222222', 'la identidad pública no cambió con el borrador'
);
select is(
  (select titulo from publico.contenido_por_dominio('bor-a.ejemplo.com')),
  '', 'el contenido público no cambió con el borrador'
);
select is(
  (select count(*)::int from jsonb_array_elements(publico.catalogo_visible_por_dominio('bor-a.ejemplo.com') -> 'productos') p where p ->> 'nombre' = 'Joystick'),
  1, 'el catálogo público sigue mostrando el producto oculto en el borrador'
);

select pg_temp.como('d1000000-0000-0000-0000-000000000001');

select is(
  public.obtener_borrador_tienda('e1000000-0000-0000-0000-000000000001') -> 'cambios' ->> 'resumen',
  'colores, texto del banner, mensaje de bienvenida y 1 producto visible',
  'el resumen se calcula en el servidor por campos tocados'
);
select is(
  (public.obtener_borrador_tienda('e1000000-0000-0000-0000-000000000001') -> 'cambios' ->> 'total')::int,
  4, 'el total cuenta los elementos tocados'
);
select is(
  (select p ->> 'visible' from jsonb_array_elements(public.listar_catalogo_tienda('e1000000-0000-0000-0000-000000000001') -> 'productos') p where p ->> 'nombre' = 'Joystick'),
  'false', 'listar_catalogo_tienda superpone el borrador (FR-051)'
);
select is(
  public.vista_previa_tienda('e1000000-0000-0000-0000-000000000001') -> 'identidad' ->> 'color_primario',
  '#C8102E', 'la vista previa muestra el borrador sobre lo publicado'
);
select is(
  (select string_agg(k, ',' order by k collate "C") from jsonb_object_keys(public.vista_previa_tienda('e1000000-0000-0000-0000-000000000001')) k),
  'categorias,contenido,destacados,empresa_nombre,en_linea,hay_productos,identidad',
  'la vista previa devuelve solo la lista blanca (sin costos, stock exacto ni proveedor)'
);

-- ============================================================================
-- Permisos y aislamiento (SC-007)
-- ============================================================================

select pg_temp.como('d1000000-0000-0000-0000-000000000003');

select throws_ok(
  $$select public.guardar_borrador_tienda('e1000000-0000-0000-0000-000000000001', 'identidad', pg_temp.ident('#C8102E'))$$,
  '42501', null, 'quien no tiene edición en Empresas no guarda borrador'
);
select throws_ok(
  $$select public.publicar_tienda('e1000000-0000-0000-0000-000000000001')$$,
  '42501', null, 'quien no tiene edición en Empresas no publica'
);
select throws_ok(
  $$select public.vista_previa_tienda('e1000000-0000-0000-0000-000000000001')$$,
  '42501', null, 'quien no tiene edición en Empresas no ve la vista previa'
);

select pg_temp.como('d2000000-0000-0000-0000-000000000001');

select throws_ok(
  $$select public.obtener_borrador_tienda('e1000000-0000-0000-0000-000000000001')$$,
  'P0002', null, 'otra organización no lee el borrador de esta empresa'
);
select throws_ok(
  $$select public.publicar_tienda('e1000000-0000-0000-0000-000000000001')$$,
  'P0002', null, 'otra organización no publica la tienda de esta empresa'
);
select is((select count(*)::int from dominio.tienda_borrador), 0, 'RLS: otra organización no ve ningún borrador');

reset role;
set local role anon;
select throws_ok($$select * from dominio.tienda_borrador$$, '42501', null, 'anon no puede leer el borrador');
select throws_ok($$select * from dominio.tienda_versiones$$, '42501', null, 'anon no puede leer las versiones');
select throws_ok($$select public.publicar_tienda('e1000000-0000-0000-0000-000000000001')$$, '42501', null, 'anon no puede publicar');
reset role;

-- ============================================================================
-- Publicar (FR-056, FR-058, FR-064)
-- ============================================================================

select pg_temp.como('d1000000-0000-0000-0000-000000000001');
select is(
  public.publicar_tienda('e1000000-0000-0000-0000-000000000001') ->> 'version',
  '2', 'publicar crea la versión siguiente (la 1 es la «Configuración inicial» de antes)'
);
reset role;

select is(
  (select color_primario from publico.identidad_por_dominio('bor-a.ejemplo.com')),
  '#C8102E', 'publicar aplica la identidad al instante'
);
select is(
  (select bienvenida from publico.contenido_por_dominio('bor-a.ejemplo.com')),
  'Bienvenidos', 'publicar aplica el contenido'
);
select is(
  (select count(*)::int from jsonb_array_elements(publico.catalogo_visible_por_dominio('bor-a.ejemplo.com') -> 'productos') p where p ->> 'nombre' = 'Joystick'),
  0, 'publicar aplica el catálogo (el producto oculto sale de la tienda)'
);
select is((select count(*)::int from dominio.tienda_borrador), 0, 'publicar borra el borrador');
select is(
  (select string_agg(numero || ':' || resumen, ' | ' order by numero) from dominio.tienda_versiones where empresa_id = 'e1000000-0000-0000-0000-000000000001'),
  '1:Configuración inicial | 2:colores, texto del banner, mensaje de bienvenida y 1 producto visible',
  'quedan la versión 1 inicial y la 2 con su resumen'
);
select is(
  (select instantanea -> 'identidad' ->> 'color_primario' from dominio.tienda_versiones where empresa_id = 'e1000000-0000-0000-0000-000000000001' and numero = 1),
  '#222222', 'la versión 1 guarda el estado de antes de publicar'
);
select is(
  (select count(*)::int from public.registro_actividad
    where tipo = 'tienda.publicada' and empresa_id = 'e1000000-0000-0000-0000-000000000001' and actor_id = 'd1000000-0000-0000-0000-000000000001'),
  1, 'publicar deja el evento tienda.publicada con actor y empresa'
);

select pg_temp.como('d1000000-0000-0000-0000-000000000001');
select is(
  public.publicar_tienda('e1000000-0000-0000-0000-000000000001') ->> 'version',
  null, 'publicar sin borrador no hace nada (idempotente)'
);
select is(
  (select count(*)::int from dominio.tienda_versiones where empresa_id = 'e1000000-0000-0000-0000-000000000001'),
  2, 'publicar sin borrador no crea versión'
);

-- Guardar lo mismo que ya está publicado no deja borrador.
do $$ begin perform public.guardar_borrador_tienda('e1000000-0000-0000-0000-000000000001', 'contenido',
  '{"titulo":"Hola","bienvenida":"Bienvenidos","boton_destino":"catalogo"}'::jsonb); end $$;
select is(
  (select (public.obtener_borrador_tienda('e1000000-0000-0000-0000-000000000001') ->> 'hay_borrador')::boolean),
  false, 'un área igual a lo publicado no cuenta como cambio'
);

-- ============================================================================
-- Descartar (FR-057, FR-064)
-- ============================================================================

do $$ begin perform public.guardar_borrador_tienda('e1000000-0000-0000-0000-000000000001', 'contenido',
  '{"titulo":"Hola","pie":"Pie nuevo","bienvenida":"Bienvenidos","boton_destino":"catalogo"}'::jsonb); end $$;
select is(
  (select (public.obtener_borrador_tienda('e1000000-0000-0000-0000-000000000001') ->> 'hay_borrador')::boolean),
  true, 'hay borrador tras un cambio real'
);
do $$ begin perform public.descartar_borrador_tienda('e1000000-0000-0000-0000-000000000001'); end $$;
do $$ begin perform public.descartar_borrador_tienda('e1000000-0000-0000-0000-000000000001'); end $$;
select is(
  (select (public.obtener_borrador_tienda('e1000000-0000-0000-0000-000000000001') ->> 'hay_borrador')::boolean),
  false, 'descartar borra el borrador'
);
reset role;
select is(
  (select count(*)::int from public.registro_actividad where tipo = 'tienda.borrador_descartado' and empresa_id = 'e1000000-0000-0000-0000-000000000001'),
  1, 'descartar deja un solo evento (la segunda vez no había borrador)'
);
select is(
  (select pie from publico.contenido_por_dominio('bor-a.ejemplo.com')),
  '', 'descartar no tocó lo publicado'
);

-- ============================================================================
-- Archivos referenciados (FR-062)
-- ============================================================================

select pg_temp.como('d1000000-0000-0000-0000-000000000001');
do $$ begin perform public.guardar_borrador_tienda('e1000000-0000-0000-0000-000000000001', 'identidad',
  pg_temp.ident('#C8102E', '11111111-1111-1111-1111-111111111111/e1000000-0000-0000-0000-000000000001/logo-1.png')); end $$;
do $$ begin perform public.publicar_tienda('e1000000-0000-0000-0000-000000000001'); end $$;
do $$ begin perform public.guardar_borrador_tienda('e1000000-0000-0000-0000-000000000001', 'identidad',
  pg_temp.ident('#C8102E', '11111111-1111-1111-1111-111111111111/e1000000-0000-0000-0000-000000000001/logo-2.png')); end $$;
do $$ begin perform public.publicar_tienda('e1000000-0000-0000-0000-000000000001'); end $$;
do $$ begin perform public.guardar_borrador_tienda('e1000000-0000-0000-0000-000000000001', 'identidad',
  pg_temp.ident('#C8102E', '11111111-1111-1111-1111-111111111111/e1000000-0000-0000-0000-000000000001/logo-3.png')); end $$;

select is(
  public.rutas_tienda_sin_referencia('e1000000-0000-0000-0000-000000000001', array[
    '11111111-1111-1111-1111-111111111111/e1000000-0000-0000-0000-000000000001/logo-1.png',
    '11111111-1111-1111-1111-111111111111/e1000000-0000-0000-0000-000000000001/logo-2.png',
    '11111111-1111-1111-1111-111111111111/e1000000-0000-0000-0000-000000000001/logo-3.png',
    '11111111-1111-1111-1111-111111111111/e1000000-0000-0000-0000-000000000001/suelto.png',
    '22222222-2222-2222-2222-222222222222/e2000000-0000-0000-0000-000000000001/ajeno.png'
  ]),
  array['11111111-1111-1111-1111-111111111111/e1000000-0000-0000-0000-000000000001/suelto.png'],
  'solo se pueden borrar los archivos que no usa lo publicado, el borrador ni ninguna versión'
);

-- ============================================================================
-- Publicar con elementos que desaparecieron y empresa desactivada
-- ============================================================================

do $$ begin perform public.descartar_borrador_tienda('e1000000-0000-0000-0000-000000000001'); end $$;
do $$ begin perform public.guardar_borrador_tienda('e1000000-0000-0000-0000-000000000001', 'catalogo',
  '{"categorias":[],"productos":[{"id":"a1000000-0000-0000-0000-000000000002","visible":false,"destacado":false}]}'::jsonb); end $$;
reset role;
delete from dominio.producto_empresa where producto_id = 'a1000000-0000-0000-0000-000000000002';

select pg_temp.como('d1000000-0000-0000-0000-000000000001');
select lives_ok(
  $$select public.publicar_tienda('e1000000-0000-0000-0000-000000000001')$$,
  'un producto que dejó de venderse desde el borrador no traba la publicación'
);
select is(
  public.obtener_borrador_tienda('e1000000-0000-0000-0000-000000000002') ->> 'en_linea',
  'false', 'una tienda de empresa desactivada figura fuera de línea (FR-054)'
);
reset role;

select * from finish();
rollback;
