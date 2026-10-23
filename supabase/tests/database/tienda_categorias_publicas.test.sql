-- F-TDA-11 (MSF-386, épica MSF-167): publico.categorias_por_dominio.
-- Cubre SC-001 y verifica FR-001, FR-002 y FR-060: solo las categorías visibles de la tienda del host
-- (la categoría y su padre), conteos de productos efectivamente visibles, orden de Catálogo, el mismo
-- `null` para host desconocido y empresa desactivada, lista blanca de campos y privilegios de `anon`.
begin;

select plan(15);

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
  ('ca000000-0000-0000-0000-0000000000f1', '22222222-2222-2222-2222-222222222222', 'Ajena', null, 0);

insert into dominio.productos (id, organizacion_id, nombre, sku, precio_lista, moneda, activo, categoria_id) values
  ('a1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'Joystick 1', 'CP-1', 10, 'USD', true, 'ca000000-0000-0000-0000-000000000001'),
  ('a1000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'Joystick 2', 'CP-2', 10, 'USD', true, 'ca000000-0000-0000-0000-000000000001'),
  ('a1000000-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111', 'Joystick inactivo', 'CP-3', 10, 'USD', false, 'ca000000-0000-0000-0000-000000000001'),
  ('a1000000-0000-0000-0000-000000000004', '11111111-1111-1111-1111-111111111111', 'Joystick oculto', 'CP-4', 10, 'USD', true, 'ca000000-0000-0000-0000-000000000001'),
  ('a1000000-0000-0000-0000-000000000005', '11111111-1111-1111-1111-111111111111', 'Cargador', 'CP-5', 10, 'USD', true, 'ca000000-0000-0000-0000-000000000002'),
  ('a1000000-0000-0000-0000-000000000006', '11111111-1111-1111-1111-111111111111', 'En hija de oculta', 'CP-6', 10, 'USD', true, 'ca000000-0000-0000-0000-000000000004'),
  ('b2000000-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', 'Producto Dos', 'CP-D', 5, 'USD', true, 'ca000000-0000-0000-0000-0000000000f1');

insert into dominio.producto_empresa (producto_id, empresa_id, organizacion_id)
select p.id, e.id, '11111111-1111-1111-1111-111111111111'
  from dominio.productos p
  cross join (values ('e1000000-0000-0000-0000-000000000001'::uuid), ('e1000000-0000-0000-0000-000000000002'::uuid)) e(id)
 where p.organizacion_id = '11111111-1111-1111-1111-111111111111';

insert into dominio.producto_empresa (producto_id, empresa_id, organizacion_id)
values ('b2000000-0000-0000-0000-000000000001', 'e2000000-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222');

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
  '["Joysticks", "Oculta en A", "Hija de Joysticks", "Hija de oculta"]'::jsonb,
  'Tienda B: su propia visibilidad (oculta Cargadores, no lo que A ocultó)'
);
select is(
  (select (c ->> 'productos')::int from jsonb_array_elements(publico.categorias_por_dominio('cp-a.ejemplo.com') -> 'categorias') c where c ->> 'nombre' = 'Joysticks'),
  2,
  'el conteo solo incluye productos efectivamente visibles (sin inactivo ni oculto)'
);
select is(
  (select (c ->> 'productos')::int from jsonb_array_elements(publico.categorias_por_dominio('cp-b.ejemplo.com') -> 'categorias') c where c ->> 'nombre' = 'Joysticks'),
  3,
  'el conteo de la otra tienda respeta su propia visibilidad de productos'
);
select is(
  (select (c ->> 'productos')::int from jsonb_array_elements(publico.categorias_por_dominio('cp-a.ejemplo.com') -> 'categorias') c where c ->> 'nombre' = 'Cargadores'),
  1,
  'Cargadores cuenta su producto visible'
);
select is(
  (select (c ->> 'productos')::int from jsonb_array_elements(publico.categorias_por_dominio('cp-a.ejemplo.com') -> 'categorias') c where c ->> 'nombre' = 'Hija de Joysticks'),
  0,
  'una categoría sin productos se lista con conteo 0'
);
select is(
  (select jsonb_agg(c ->> 'nombre') from jsonb_array_elements(publico.categorias_por_dominio('cp-dos.ejemplo.com') -> 'categorias') c),
  '["Ajena"]'::jsonb,
  'la tienda de otra organización solo ve sus propias categorías'
);
select is(
  (select jsonb_agg(k order by k) from (select distinct jsonb_object_keys(c) k from jsonb_array_elements(publico.categorias_por_dominio('cp-a.ejemplo.com') -> 'categorias') c) s),
  '["id", "nombre", "padre_id", "productos"]'::jsonb,
  'lista blanca de campos: sin organizacion_id ni columnas internas'
);
select is(
  (select jsonb_agg(k order by k) from jsonb_object_keys(publico.categorias_por_dominio('cp-a.ejemplo.com')) k),
  '["categorias"]'::jsonb,
  'la respuesta solo trae «categorias»'
);
select ok(
  position('11111111-1111-1111-1111-111111111111' in publico.categorias_por_dominio('cp-a.ejemplo.com')::text) = 0,
  'la respuesta no filtra el id de la organización'
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

select * from finish();
rollback;
