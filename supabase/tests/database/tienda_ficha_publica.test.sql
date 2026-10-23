-- F-TDA-13 (MSF-372, épica MSF-167): ficha de producto de la tienda pública.
-- Cubre SC-007 y verifica FR-050 y FR-055: columnas expuestas (lista blanca), el mismo `null` para
-- inexistente / inactivo / oculto / categoría oculta / otra empresa (y host desconocido o empresa
-- desactivada), compatibilidad opcional, precio igual a private.precio_para(...) de la empresa,
-- aislamiento entre tiendas e imágenes por posición.
-- Las llamadas públicas se hacen como `anon` y se guardan en una tabla temporal; las verificaciones
-- corren como postgres. La paridad de precio se calcula como administrador de la organización.
begin;

select plan(28);

-- ============================================================================
-- Fixture (como postgres: RLS no aplica)
-- ============================================================================

insert into organizaciones (id, nombre) values
  ('11111111-1111-1111-1111-111111111111', 'Organización Uno'),
  ('22222222-2222-2222-2222-222222222222', 'Organización Dos');

insert into auth.users (id, email) values
  ('d1000000-0000-0000-0000-000000000001', 'admin-uno@example.com');
insert into usuarios_organizacion (user_id, organizacion_id, rol_id, estado) values
  ('d1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'administrador', 'activo');

-- Org 1: tienda A (regla +10 % y precios con IVA), tienda B (sin regla, sin IVA) y una apagada.
-- Org 2: una tienda con su propio producto.
insert into dominio.empresas (id, organizacion_id, nombre, activa) values
  ('e1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'Tienda A', true),
  ('e1000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'Tienda B', true),
  ('e1000000-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111', 'Tienda apagada', false),
  ('e2000000-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', 'Tienda Dos', true);

insert into dominio.tiendas (organizacion_id, empresa_id, dominio) values
  ('11111111-1111-1111-1111-111111111111', 'e1000000-0000-0000-0000-000000000001', 'pc-a.ejemplo.com'),
  ('11111111-1111-1111-1111-111111111111', 'e1000000-0000-0000-0000-000000000002', 'pc-b.ejemplo.com'),
  ('11111111-1111-1111-1111-111111111111', 'e1000000-0000-0000-0000-000000000003', 'pc-apagada.ejemplo.com'),
  ('22222222-2222-2222-2222-222222222222', 'e2000000-0000-0000-0000-000000000001', 'pc-dos.ejemplo.com');

insert into dominio.precios_empresa (empresa_id, organizacion_id, base, ajuste_pct, mostrar_con_iva) values
  ('e1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'central_ajuste', 10, true),
  ('e1000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'central', 0, false);

insert into dominio.cotizacion_inicial (organizacion_id, valor) values
  ('11111111-1111-1111-1111-111111111111', 1500);

insert into dominio.categorias (id, organizacion_id, nombre, posicion) values
  ('ca000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'Joysticks', 1),
  ('ca000000-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111', 'Oculta en A', 3),
  ('ca000000-0000-0000-0000-0000000000f1', '22222222-2222-2222-2222-222222222222', 'Ajena', 1);

insert into dominio.productos (id, organizacion_id, nombre, sku, descripcion, compatible_con, precio_lista, moneda, activo, categoria_id) values
  ('a1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'Alfa', 'PC-1', 'Joystick <b>inalámbrico</b>', '{PS4,PS5}', 1000, 'ARS', true, 'ca000000-0000-0000-0000-000000000001'),
  ('a1000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'Beta', 'PC-2', null, '{}', 3000, 'ARS', true, 'ca000000-0000-0000-0000-000000000001'),
  ('a1000000-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111', 'Gama', 'PC-3', '  ', null, 10, 'USD', true, null),
  ('a1000000-0000-0000-0000-000000000006', '11111111-1111-1111-1111-111111111111', 'Oculto en A', 'PC-6', null, '{}', 100, 'ARS', true, 'ca000000-0000-0000-0000-000000000001'),
  ('a1000000-0000-0000-0000-000000000007', '11111111-1111-1111-1111-111111111111', 'Inactivo', 'PC-7', null, '{}', 100, 'ARS', false, 'ca000000-0000-0000-0000-000000000001'),
  ('a1000000-0000-0000-0000-000000000008', '11111111-1111-1111-1111-111111111111', 'En categoría oculta', 'PC-8', null, '{}', 100, 'ARS', true, 'ca000000-0000-0000-0000-000000000003'),
  ('a1000000-0000-0000-0000-000000000009', '11111111-1111-1111-1111-111111111111', 'Solo en apagada', 'PC-9', null, '{}', 100, 'ARS', true, 'ca000000-0000-0000-0000-000000000001'),
  ('b2000000-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', 'Dos ARS', 'PD-1', null, '{}', 700, 'ARS', true, 'ca000000-0000-0000-0000-0000000000f1');

-- Todo en A y B salvo «Solo en apagada» (solo en la tienda apagada); «Dos ARS» solo en la tienda de la otra organización.
insert into dominio.producto_empresa (producto_id, empresa_id, organizacion_id)
select p.id, e.id, '11111111-1111-1111-1111-111111111111'
  from dominio.productos p
  cross join (values ('e1000000-0000-0000-0000-000000000001'::uuid), ('e1000000-0000-0000-0000-000000000002'::uuid)) e(id)
 where p.organizacion_id = '11111111-1111-1111-1111-111111111111'
   and p.id <> 'a1000000-0000-0000-0000-000000000009';
insert into dominio.producto_empresa (producto_id, empresa_id, organizacion_id) values
  ('a1000000-0000-0000-0000-000000000009', 'e1000000-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111'),
  ('b2000000-0000-0000-0000-000000000001', 'e2000000-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222');

-- A oculta «Oculto en A» y la categoría «Oculta en A»; B oculta «Beta».
insert into dominio.productos_tienda (empresa_id, producto_id, organizacion_id, visible, destacado) values
  ('e1000000-0000-0000-0000-000000000001', 'a1000000-0000-0000-0000-000000000006', '11111111-1111-1111-1111-111111111111', false, false),
  ('e1000000-0000-0000-0000-000000000002', 'a1000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', false, false);
insert into dominio.categorias_tienda (empresa_id, categoria_id, organizacion_id, visible) values
  ('e1000000-0000-0000-0000-000000000001', 'ca000000-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111', false);

-- Stock: Alfa 5, Beta 0.
update dominio.existencias set cantidad = 5 where producto_id = 'a1000000-0000-0000-0000-000000000001';
update dominio.existencias set cantidad = 0 where producto_id = 'a1000000-0000-0000-0000-000000000002';

-- Imágenes: Alfa (2, cargadas en desorden).
insert into dominio.producto_imagenes (producto_id, organizacion_id, posicion, ruta) values
  ('a1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 2, '11111111-1111-1111-1111-111111111111/a1000000-0000-0000-0000-000000000001/segunda.png'),
  ('a1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 1, '11111111-1111-1111-1111-111111111111/a1000000-0000-0000-0000-000000000001/primera.png');

-- ============================================================================
-- Privilegios y estructura
-- ============================================================================

select is(has_function_privilege('anon', 'publico.producto_por_dominio(text, uuid)', 'execute'), true, 'anon ejecuta la función pública');
select is(
  (select count(*)::int from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'publico' and c.relkind in ('r', 'p')),
  0, 'publico sigue sin tablas'
);

-- ============================================================================
-- Lectura anónima: se guardan las respuestas y se verifican después
-- ============================================================================

create temp table res (clave text primary key, j jsonb);
grant all on res to anon;

select set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);
set local role anon;

insert into res values
  ('alfa_a', publico.producto_por_dominio('pc-a.ejemplo.com', 'a1000000-0000-0000-0000-000000000001')),
  ('alfa_b', publico.producto_por_dominio('pc-b.ejemplo.com', 'a1000000-0000-0000-0000-000000000001')),
  ('alfa_host', publico.producto_por_dominio('  PC-A.Ejemplo.com.:8080 ', 'a1000000-0000-0000-0000-000000000001')),
  ('beta_a', publico.producto_por_dominio('pc-a.ejemplo.com', 'a1000000-0000-0000-0000-000000000002')),
  ('gama_a', publico.producto_por_dominio('pc-a.ejemplo.com', 'a1000000-0000-0000-0000-000000000003')),
  ('oculto_b', publico.producto_por_dominio('pc-b.ejemplo.com', 'a1000000-0000-0000-0000-000000000006')),
  ('dos_ok', publico.producto_por_dominio('pc-dos.ejemplo.com', 'b2000000-0000-0000-0000-000000000001')),
  -- Los casos que deben dar `null`:
  ('n_oculto_otra_tienda', publico.producto_por_dominio('pc-b.ejemplo.com', 'a1000000-0000-0000-0000-000000000002')),
  ('n_oculto', publico.producto_por_dominio('pc-a.ejemplo.com', 'a1000000-0000-0000-0000-000000000006')),
  ('n_inactivo', publico.producto_por_dominio('pc-a.ejemplo.com', 'a1000000-0000-0000-0000-000000000007')),
  ('n_categoria_oculta', publico.producto_por_dominio('pc-a.ejemplo.com', 'a1000000-0000-0000-0000-000000000008')),
  ('n_otra_empresa', publico.producto_por_dominio('pc-a.ejemplo.com', 'b2000000-0000-0000-0000-000000000001')),
  ('n_otra_org', publico.producto_por_dominio('pc-dos.ejemplo.com', 'a1000000-0000-0000-0000-000000000001')),
  ('n_inexistente', publico.producto_por_dominio('pc-a.ejemplo.com', 'a1999999-0000-0000-0000-000000000000')),
  ('n_sin_producto', publico.producto_por_dominio('pc-a.ejemplo.com', null)),
  ('n_apagada', publico.producto_por_dominio('pc-apagada.ejemplo.com', 'a1000000-0000-0000-0000-000000000009')),
  ('n_desconocido', publico.producto_por_dominio('no-existe.ejemplo.com', 'a1000000-0000-0000-0000-000000000001'));

reset role;

-- ============================================================================
-- FR-050 · contenido y lista blanca
-- ============================================================================

select is(
  (select jsonb_agg(k order by k) from (select jsonb_object_keys(j) k from res where clave = 'alfa_a') s),
  '["categoria", "compatibilidad", "descripcion", "disponible", "id", "imagenes", "nombre", "precio", "sku"]'::jsonb,
  'columnas expuestas: la lista blanca del contrato (sin organizacion_id, costos, existencias ni proveedor)'
);
select is(
  (select jsonb_agg(k order by k) from (select jsonb_object_keys(j -> 'categoria') k from res where clave = 'alfa_a') s),
  '["id", "nombre"]'::jsonb, 'la categoría trae solo id y nombre'
);
select is((select j ->> 'nombre' from res where clave = 'alfa_a'), 'Alfa', 'nombre');
select is((select j ->> 'sku' from res where clave = 'alfa_a'), 'PC-1', 'SKU');
select is((select j ->> 'descripcion' from res where clave = 'alfa_a'), 'Joystick <b>inalámbrico</b>', 'descripción tal cual (el front la escapa al mostrarla)');
select is((select j #>> '{categoria,nombre}' from res where clave = 'alfa_a'), 'Joysticks', 'categoría');
select is((select j -> 'disponible' from res where clave = 'alfa_a'), 'true'::jsonb, 'disponible: con existencias');
select is((select j -> 'disponible' from res where clave = 'beta_a'), 'false'::jsonb, 'disponible: sin existencias, solo el booleano');
select is((select j from res where clave = 'alfa_host'), (select j from res where clave = 'alfa_a'), 'el host se normaliza (mayúsculas, espacios, puerto y punto final)');
select is((select j -> 'categoria' from res where clave = 'gama_a'), 'null'::jsonb, 'sin categoría: categoria es null');
select is((select j -> 'descripcion' from res where clave = 'gama_a'), 'null'::jsonb, 'descripción en blanco: null');
select ok(
  not exists (
    select 1 from res, jsonb_object_keys(j) k
     where clave in ('alfa_a', 'beta_a', 'gama_a', 'dos_ok')
       and k in ('organizacion_id', 'costo', 'existencias', 'cantidad', 'proveedor_id', 'codigo_proveedor', 'codigo_barras', 'moneda', 'precio_lista')
  ),
  'ninguna respuesta expone, como clave de primer nivel, costos, existencias, proveedor ni códigos internos (la ruta de imagen sí lleva el prefijo del tenant, documentado)'
);

-- Imágenes por posición
select is(
  (select jsonb_agg(i ->> 'posicion' order by o) from res, jsonb_array_elements(j -> 'imagenes') with ordinality t(i, o) where clave = 'alfa_a'),
  '["1", "2"]'::jsonb, 'imágenes ordenadas por posición (la principal primero)'
);
select is(
  (select j -> 'imagenes' -> 0 ->> 'ruta' from res where clave = 'alfa_a'),
  '11111111-1111-1111-1111-111111111111/a1000000-0000-0000-0000-000000000001/primera.png', 'la principal es la de menor posición'
);
select is((select j -> 'imagenes' from res where clave = 'beta_a'), '[]'::jsonb, 'sin imágenes: lista vacía');

-- ============================================================================
-- FR-055 · compatibilidad opcional
-- ============================================================================

select is((select j ->> 'compatibilidad' from res where clave = 'alfa_a'), 'PS4, PS5', 'compatibilidad como texto con los valores unidos por coma');
select is((select j -> 'compatibilidad' from res where clave = 'beta_a'), 'null'::jsonb, 'sin compatibilidad (arreglo vacío): null');
select is((select j -> 'compatibilidad' from res where clave = 'gama_a'), 'null'::jsonb, 'sin compatibilidad (nula): null');

-- ============================================================================
-- Precio de la empresa: paridad con private.precio_para
-- ============================================================================

create temp table esperado (empresa uuid, neto numeric, final numeric);
grant all on esperado to authenticated;

select set_config('request.jwt.claims', json_build_object('sub', 'd1000000-0000-0000-0000-000000000001', 'role', 'authenticated')::text, true);
set local role authenticated;
insert into esperado
select e.id, pp.neto, pp.final
  from (values ('e1000000-0000-0000-0000-000000000001'::uuid), ('e1000000-0000-0000-0000-000000000002'::uuid)) e(id)
  cross join lateral private.precio_para('a1000000-0000-0000-0000-000000000001', e.id, 'x1') pp;
reset role;

select is(
  (select (j ->> 'precio')::numeric from res where clave = 'alfa_a'),
  (select final from esperado where empresa = 'e1000000-0000-0000-0000-000000000001'),
  'tienda A (precios con IVA): el precio es precio_para(...).final'
);
select is(
  (select (j ->> 'precio')::numeric from res where clave = 'alfa_b'),
  (select neto from esperado where empresa = 'e1000000-0000-0000-0000-000000000002'),
  'tienda B (precios sin IVA): el precio es precio_para(...).neto'
);
select is((select (j ->> 'precio')::numeric from res where clave = 'alfa_a'), 1331::numeric, 'Alfa en A: 1.000 + 10 % = 1.100, con IVA 21 % = 1.331');

-- ============================================================================
-- El mismo `null` en todos los casos que no deben verse (FR-050)
-- ============================================================================

select is(
  (select count(*)::int from res where clave like 'n\_%' and j is null),
  10, 'oculto, inactivo, categoría oculta, de otra empresa u organización, inexistente, sin id, tienda apagada y host desconocido: todos null'
);
select is(
  (select count(*)::int from res where clave like 'n\_%'),
  10, 'los 10 casos negativos están cubiertos'
);

-- ============================================================================
-- Aislamiento entre tiendas
-- ============================================================================

select is((select j ->> 'nombre' from res where clave = 'oculto_b'), 'Oculto en A', 'lo oculto en A se ve en B (la visibilidad es por tienda)');
select is((select j ->> 'nombre' from res where clave = 'dos_ok'), 'Dos ARS', 'la tienda de la otra organización ve su propio producto');
select isnt((select j -> 'precio' from res where clave = 'alfa_a'), (select j -> 'precio' from res where clave = 'alfa_b'), 'el mismo producto tiene el precio de cada empresa');

select * from finish();
rollback;
