-- F-TDA-11 (MSF-386, épica MSF-167): publico.categorias_por_dominio.
-- Cubre SC-001 y verifica FR-001, FR-002 y FR-060: solo las categorías visibles de la tienda del host
-- (la categoría y su padre), conteos de productos efectivamente visibles, orden de Catálogo, el mismo
-- `null` para host desconocido y empresa desactivada, lista blanca de campos y privilegios de `anon`.
begin;

select plan(23);

-- ============================================================================
-- Fixture (como postgres: RLS no aplica)
-- ============================================================================

insert into organizaciones (id, nombre) values
  ('11111111-1111-1111-1111-111111111111', 'Organización Uno'),
  ('22222222-2222-2222-2222-222222222222', 'Organización Dos');

insert into dominio.empresas (id, organizacion_id, nombre, activa) values
  ('e1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'Tienda A', true),
  ('e1000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'Tienda B', true),
  ('e1000000-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111', 'Tienda apagada', false),
  ('e2000000-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', 'Tienda Dos', true);

insert into dominio.tiendas (organizacion_id, empresa_id, dominio) values
  ('11111111-1111-1111-1111-111111111111', 'e1000000-0000-0000-0000-000000000001', 'cp-a.ejemplo.com'),
  ('11111111-1111-1111-1111-111111111111', 'e1000000-0000-0000-0000-000000000002', 'cp-b.ejemplo.com'),
  ('11111111-1111-1111-1111-111111111111', 'e1000000-0000-0000-0000-000000000003', 'cp-apagada.ejemplo.com'),
  ('22222222-2222-2222-2222-222222222222', 'e2000000-0000-0000-0000-000000000001', 'cp-dos.ejemplo.com');

insert into dominio.categorias (id, organizacion_id, nombre, padre_id, posicion) values
  ('ca000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'Cargadores', null, 2),
  ('ca000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'Joysticks', null, 1),
  ('ca000000-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111', 'Oculta en A', null, 3),
  ('ca000000-0000-0000-0000-000000000004', '11111111-1111-1111-1111-111111111111', 'Hija de oculta', 'ca000000-0000-0000-0000-000000000003', 0),
  ('ca000000-0000-0000-0000-000000000005', '11111111-1111-1111-1111-111111111111', 'Hija de Joysticks', 'ca000000-0000-0000-0000-000000000001', 0),
  ('ca000000-0000-0000-0000-000000000006', '11111111-1111-1111-1111-111111111111', 'Vacía', null, 4),
  ('ca000000-0000-0000-0000-0000000000f1', '22222222-2222-2222-2222-222222222222', 'Ajena', null, 0);

insert into dominio.productos (id, organizacion_id, nombre, sku, precio_lista, moneda, activo, categoria_id) values
  ('a1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'Joystick 1', 'CP-1', 10, 'USD', true, 'ca000000-0000-0000-0000-000000000001'),
  ('a1000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'Joystick 2', 'CP-2', 10, 'USD', true, 'ca000000-0000-0000-0000-000000000001'),
  ('a1000000-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111', 'Joystick inactivo', 'CP-3', 10, 'USD', false, 'ca000000-0000-0000-0000-000000000001'),
  ('a1000000-0000-0000-0000-000000000004', '11111111-1111-1111-1111-111111111111', 'Joystick oculto', 'CP-4', 10, 'USD', true, 'ca000000-0000-0000-0000-000000000001'),
  ('a1000000-0000-0000-0000-000000000005', '11111111-1111-1111-1111-111111111111', 'Cargador', 'CP-5', 10, 'USD', true, 'ca000000-0000-0000-0000-000000000002'),
  ('a1000000-0000-0000-0000-000000000006', '11111111-1111-1111-1111-111111111111', 'En hija de oculta', 'CP-6', 10, 'USD', true, 'ca000000-0000-0000-0000-000000000004'),
  ('a1000000-0000-0000-0000-000000000007', '11111111-1111-1111-1111-111111111111', 'En hija de Joysticks', 'CP-7', 10, 'USD', true, 'ca000000-0000-0000-0000-000000000005'),
  ('b2000000-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', 'Producto Dos', 'CP-D', 5, 'USD', true, 'ca000000-0000-0000-0000-0000000000f1');

insert into dominio.producto_empresa (producto_id, empresa_id, organizacion_id)
select p.id, e.id, '11111111-1111-1111-1111-111111111111'
  from dominio.productos p
  cross join (values ('e1000000-0000-0000-0000-000000000001'::uuid), ('e1000000-0000-0000-0000-000000000002'::uuid)) e(id)
 where p.organizacion_id = '11111111-1111-1111-1111-111111111111';

insert into dominio.producto_empresa (producto_id, empresa_id, organizacion_id)
values ('b2000000-0000-0000-0000-000000000001', 'e2000000-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222');

-- MSF-841: fotos de producto. «En hija de Joysticks» tiene dos (la principal es la de posición 1); «Joystick
-- inactivo» y «Joystick oculto» (oculto en la tienda A) también, pero no deben elegirse.
insert into dominio.producto_imagenes (producto_id, organizacion_id, posicion, ruta) values
  ('a1000000-0000-0000-0000-000000000007', '11111111-1111-1111-1111-111111111111', 2,
   '11111111-1111-1111-1111-111111111111/a1000000-0000-0000-0000-000000000007/segunda.png'),
  ('a1000000-0000-0000-0000-000000000007', '11111111-1111-1111-1111-111111111111', 1,
   '11111111-1111-1111-1111-111111111111/a1000000-0000-0000-0000-000000000007/frente.png'),
  ('a1000000-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111', 1,
   '11111111-1111-1111-1111-111111111111/a1000000-0000-0000-0000-000000000003/inactivo.png'),
  ('a1000000-0000-0000-0000-000000000004', '11111111-1111-1111-1111-111111111111', 1,
   '11111111-1111-1111-1111-111111111111/a1000000-0000-0000-0000-000000000004/oculto.png');

-- Tienda A: oculta «Oculta en A» (y por tanto «Hija de oculta») y un producto de Joysticks.
insert into dominio.categorias_tienda (empresa_id, categoria_id, organizacion_id, visible) values
  ('e1000000-0000-0000-0000-000000000001', 'ca000000-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111', false);
insert into dominio.productos_tienda (empresa_id, producto_id, organizacion_id, visible) values
  ('e1000000-0000-0000-0000-000000000001', 'a1000000-0000-0000-0000-000000000004', '11111111-1111-1111-1111-111111111111', false);
-- Tienda B: oculta «Cargadores».
insert into dominio.categorias_tienda (empresa_id, categoria_id, organizacion_id, visible) values
  ('e1000000-0000-0000-0000-000000000002', 'ca000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', false);

-- ============================================================================
-- Privilegios y estructura
-- ============================================================================

select is(has_function_privilege('anon', 'publico.categorias_por_dominio(text)', 'execute'), true, 'anon ejecuta la función pública');
select is(
  (select count(*)::int from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'publico' and c.relkind in ('r', 'p')),
  0, 'publico sigue sin tablas'
);

-- ============================================================================
-- Lectura anónima (FR-001, FR-002, FR-060)
-- ============================================================================

select set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);
set local role anon;

select is(
  (select jsonb_agg(c ->> 'nombre') from jsonb_array_elements(publico.categorias_por_dominio('cp-a.ejemplo.com') -> 'categorias') c),
  '["Joysticks", "Cargadores", "Hija de Joysticks"]'::jsonb,
  'Tienda A: solo las visibles (sin la oculta ni su hija), raíces primero y por posición'
);
select is(
  (select jsonb_agg(c ->> 'nombre') from jsonb_array_elements(publico.categorias_por_dominio('cp-b.ejemplo.com') -> 'categorias') c),
  '["Joysticks", "Oculta en A", "Hija de oculta", "Hija de Joysticks"]'::jsonb,
  'Tienda B: su propia visibilidad (oculta Cargadores, no lo que A ocultó)'
);
select is(
  (select (c ->> 'productos')::int from jsonb_array_elements(publico.categorias_por_dominio('cp-a.ejemplo.com') -> 'categorias') c where c ->> 'nombre' = 'Joysticks'),
  3,
  'el conteo solo incluye productos efectivamente visibles (sin inactivo ni oculto) y suma las subcategorías (MSF-825)'
);
select is(
  (select (c ->> 'productos')::int from jsonb_array_elements(publico.categorias_por_dominio('cp-b.ejemplo.com') -> 'categorias') c where c ->> 'nombre' = 'Joysticks'),
  4,
  'el conteo de la otra tienda respeta su propia visibilidad de productos (3 propios + 1 de la hija)'
);
select is(
  (select (c ->> 'productos')::int from jsonb_array_elements(publico.categorias_por_dominio('cp-a.ejemplo.com') -> 'categorias') c where c ->> 'nombre' = 'Cargadores'),
  1,
  'Cargadores cuenta su producto visible'
);
select is(
  (select (c ->> 'productos')::int from jsonb_array_elements(publico.categorias_por_dominio('cp-a.ejemplo.com') -> 'categorias') c where c ->> 'nombre' = 'Hija de Joysticks'),
  1,
  'una subcategoría cuenta sus propios productos visibles'
);
select is(
  (publico.catalogo_pagina_por_dominio('cp-a.ejemplo.com', 'ca000000-0000-0000-0000-000000000001'::uuid) ->> 'total')::int,
  (select (c ->> 'productos')::int from jsonb_array_elements(publico.categorias_por_dominio('cp-a.ejemplo.com') -> 'categorias') c where c ->> 'nombre' = 'Joysticks'),
  'el listado de una categoría incluye sus subcategorías: el conteo de la tarjeta coincide con el listado (MSF-825)'
);
select is(
  (select count(*)::int from jsonb_array_elements(publico.categorias_por_dominio('cp-a.ejemplo.com') -> 'categorias') c where c ->> 'nombre' = 'Vacía'),
  0,
  'una categoría sin productos visibles no se lista (MSF-825, MSF-827)'
);
select is(
  (select jsonb_agg(c ->> 'nombre') from jsonb_array_elements(publico.categorias_por_dominio('cp-dos.ejemplo.com') -> 'categorias') c),
  '["Ajena"]'::jsonb,
  'la tienda de otra organización solo ve sus propias categorías'
);
select is(
  (select jsonb_agg(k order by k) from (select distinct jsonb_object_keys(c) k from jsonb_array_elements(publico.categorias_por_dominio('cp-a.ejemplo.com') -> 'categorias') c) s),
  '["id", "imagen", "nombre", "padre_id", "productos"]'::jsonb,
  'lista blanca de campos: sin organizacion_id ni columnas internas'
);
select is(
  (select jsonb_agg(k order by k) from jsonb_object_keys(publico.categorias_por_dominio('cp-a.ejemplo.com')) k),
  '["categorias"]'::jsonb,
  'la respuesta solo trae «categorias»'
);
-- La ruta de `imagen` cuelga de <organizacion>/<producto>/ (igual que la `imagen` de los destacados): se
-- excluye de esta comprobación, que busca el id de la organización en cualquier otro campo.
select ok(
  position('11111111-1111-1111-1111-111111111111' in (select jsonb_agg(c - 'imagen') from jsonb_array_elements(publico.categorias_por_dominio('cp-a.ejemplo.com') -> 'categorias') c)::text) = 0,
  'la respuesta no filtra el id de la organización (fuera de la ruta de la imagen)'
);
select is(
  (select c ->> 'imagen' from jsonb_array_elements(publico.categorias_por_dominio('cp-a.ejemplo.com') -> 'categorias') c where c ->> 'nombre' = 'Joysticks'),
  '11111111-1111-1111-1111-111111111111/a1000000-0000-0000-0000-000000000007/frente.png',
  'MSF-841: la foto de una raíz es la imagen principal (posición 1) de un producto visible de sus subcategorías; no usa la de un producto inactivo ni oculto'
);
select is(
  (select c ->> 'imagen' from jsonb_array_elements(publico.categorias_por_dominio('cp-a.ejemplo.com') -> 'categorias') c where c ->> 'nombre' = 'Hija de Joysticks'),
  '11111111-1111-1111-1111-111111111111/a1000000-0000-0000-0000-000000000007/frente.png',
  'MSF-841: la subcategoría usa la imagen principal de su propio producto'
);
select is(
  (select c -> 'imagen' from jsonb_array_elements(publico.categorias_por_dominio('cp-a.ejemplo.com') -> 'categorias') c where c ->> 'nombre' = 'Cargadores'),
  'null'::jsonb,
  'MSF-841: una categoría cuyos productos no tienen imagen devuelve imagen null'
);
select is(publico.categorias_por_dominio('no-existe.ejemplo.com'), null, 'un dominio desconocido devuelve null');
select is(
  publico.categorias_por_dominio('cp-apagada.ejemplo.com'),
  publico.categorias_por_dominio('no-existe.ejemplo.com'),
  'una empresa desactivada devuelve lo mismo que un dominio desconocido (null)'
);
select is(
  publico.categorias_por_dominio('  CP-A.Ejemplo.com.:443'),
  publico.categorias_por_dominio('cp-a.ejemplo.com'),
  'el host se normaliza (mayúsculas, espacios, punto final y puerto)'
);

-- MSF-841: la foto solo sale de productos efectivamente visibles de ESA tienda.
reset role;
insert into dominio.categorias (id, organizacion_id, nombre, padre_id, posicion) values
  ('ca000000-0000-0000-0000-0000000000a1', '11111111-1111-1111-1111-111111111111', 'Foto oculta en A', null, 10),
  ('ca000000-0000-0000-0000-0000000000a2', '11111111-1111-1111-1111-111111111111', 'Foto inactiva', null, 11);
insert into dominio.productos (id, organizacion_id, nombre, sku, precio_lista, moneda, activo, categoria_id) values
  ('a1000000-0000-0000-0000-0000000000a1', '11111111-1111-1111-1111-111111111111', 'Solo oculto en A', 'CP-A1', 10, 'USD', true, 'ca000000-0000-0000-0000-0000000000a1'),
  ('a1000000-0000-0000-0000-0000000000a2', '11111111-1111-1111-1111-111111111111', 'Inactivo con foto', 'CP-A2', 10, 'USD', false, 'ca000000-0000-0000-0000-0000000000a2'),
  ('a1000000-0000-0000-0000-0000000000a3', '11111111-1111-1111-1111-111111111111', 'Activo sin foto', 'CP-A3', 10, 'USD', true, 'ca000000-0000-0000-0000-0000000000a2');
insert into dominio.producto_empresa (producto_id, empresa_id, organizacion_id)
select p.id, e.id, '11111111-1111-1111-1111-111111111111'
  from dominio.productos p
  cross join (values ('e1000000-0000-0000-0000-000000000001'::uuid), ('e1000000-0000-0000-0000-000000000002'::uuid)) e(id)
 where p.id in ('a1000000-0000-0000-0000-0000000000a1', 'a1000000-0000-0000-0000-0000000000a2', 'a1000000-0000-0000-0000-0000000000a3');
insert into dominio.producto_imagenes (producto_id, organizacion_id, posicion, ruta) values
  ('a1000000-0000-0000-0000-0000000000a1', '11111111-1111-1111-1111-111111111111', 1,
   '11111111-1111-1111-1111-111111111111/a1000000-0000-0000-0000-0000000000a1/solo.png'),
  ('a1000000-0000-0000-0000-0000000000a2', '11111111-1111-1111-1111-111111111111', 1,
   '11111111-1111-1111-1111-111111111111/a1000000-0000-0000-0000-0000000000a2/inactivo.png');
insert into dominio.productos_tienda (empresa_id, producto_id, organizacion_id, visible) values
  ('e1000000-0000-0000-0000-000000000001', 'a1000000-0000-0000-0000-0000000000a1', '11111111-1111-1111-1111-111111111111', false);
set local role anon;

select is(
  (select count(*)::int from jsonb_array_elements(publico.categorias_por_dominio('cp-a.ejemplo.com') -> 'categorias') c where c ->> 'nombre' = 'Foto oculta en A'),
  0,
  'MSF-841: en la tienda A, una categoría cuyo único producto está oculto no se lista (ni su foto)'
);
select is(
  (select c ->> 'imagen' from jsonb_array_elements(publico.categorias_por_dominio('cp-b.ejemplo.com') -> 'categorias') c where c ->> 'nombre' = 'Foto oculta en A'),
  '11111111-1111-1111-1111-111111111111/a1000000-0000-0000-0000-0000000000a1/solo.png',
  'MSF-841: en la tienda B el mismo producto sí es visible y aporta su foto'
);
select is(
  (select c -> 'imagen' from jsonb_array_elements(publico.categorias_por_dominio('cp-a.ejemplo.com') -> 'categorias') c where c ->> 'nombre' = 'Foto inactiva'),
  'null'::jsonb,
  'MSF-841: la foto de un producto inactivo no se usa (la categoría sigue con imagen null)'
);

select * from finish();
rollback;
