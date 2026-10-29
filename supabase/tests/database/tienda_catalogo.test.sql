-- F-TDA-04 (MSF-312, épica MSF-147): catálogo visible y destacados de la tienda.
-- Cubre SC-007 (el resumen «N visibles, M destacados» coincide con lo que devuelve la función pública)
-- y verifica FR-040, FR-043, FR-044, FR-045, FR-047, FR-048 y FR-049: aislamiento entre tiendas y
-- organizaciones, `anon` sin datos internos, visibilidad efectiva (inactivo, categoría oculta, sin
-- categoría), precio y stock de lectura, RPC transaccional e idempotente.
-- El fixture corre como postgres (RLS no aplica) y las verificaciones como "authenticated" o "anon".
begin;

select plan(52);

-- ============================================================================
-- Fixture
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

insert into dominio.empresas (id, organizacion_id, nombre) values
  ('e1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'Tienda A'),
  ('e1000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'Tienda B'),
  ('e2000000-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', 'Tienda Dos');

insert into dominio.tiendas (organizacion_id, empresa_id, dominio) values
  ('11111111-1111-1111-1111-111111111111', 'e1000000-0000-0000-0000-000000000001', 'cat-a.ejemplo.com'),
  ('11111111-1111-1111-1111-111111111111', 'e1000000-0000-0000-0000-000000000002', 'cat-b.ejemplo.com'),
  ('22222222-2222-2222-2222-222222222222', 'e2000000-0000-0000-0000-000000000001', 'cat-dos.ejemplo.com');

insert into dominio.categorias (id, organizacion_id, nombre, padre_id) values
  ('ca000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'Visible', null),
  ('ca000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'Oculta', null),
  ('ca000000-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111', 'Hija de oculta', 'ca000000-0000-0000-0000-000000000002'),
  ('ca000000-0000-0000-0000-0000000000f1', '22222222-2222-2222-2222-222222222222', 'Ajena', null);

insert into dominio.productos (id, organizacion_id, nombre, sku, precio_lista, moneda, activo, categoria_id) values
  ('a1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'Joystick', 'JOY-1', 49.90, 'USD', true, 'ca000000-0000-0000-0000-000000000001'),
  ('a1000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'Cable', 'CAB-1', 10, 'USD', true, null),
  ('a1000000-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111', 'Inactivo', 'INA-1', 5, 'USD', false, null),
  ('a1000000-0000-0000-0000-000000000004', '11111111-1111-1111-1111-111111111111', 'En oculta', 'OCU-1', 7, 'ARS', true, 'ca000000-0000-0000-0000-000000000002'),
  ('a1000000-0000-0000-0000-000000000005', '11111111-1111-1111-1111-111111111111', 'En hija', 'HIJ-1', 8, 'USD', true, 'ca000000-0000-0000-0000-000000000003'),
  ('a1000000-0000-0000-0000-000000000006', '11111111-1111-1111-1111-111111111111', 'Sin tienda', 'SIN-1', 9, 'USD', true, null),
  ('b2000000-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', 'Producto Dos', 'DOS-1', 5, 'USD', true, null);

-- Las dos tiendas de la organización Uno venden los mismos cinco productos; «Sin tienda» no se vende en ninguna.
insert into dominio.producto_empresa (producto_id, empresa_id, organizacion_id)
select p.id, e.id, '11111111-1111-1111-1111-111111111111'
  from dominio.productos p
  cross join (values ('e1000000-0000-0000-0000-000000000001'::uuid), ('e1000000-0000-0000-0000-000000000002'::uuid)) e(id)
 where p.id in (
   'a1000000-0000-0000-0000-000000000001', 'a1000000-0000-0000-0000-000000000002', 'a1000000-0000-0000-0000-000000000003',
   'a1000000-0000-0000-0000-000000000004', 'a1000000-0000-0000-0000-000000000005'
 );

update dominio.existencias set cantidad = 7 where producto_id = 'a1000000-0000-0000-0000-000000000001';

create function pg_temp.como(p_user uuid) returns void language plpgsql as $$
begin
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
  set local role authenticated;
end;
$$;

-- ============================================================================
-- Estructura y privilegios (FR-040, SC-002)
-- ============================================================================

select is((select relrowsecurity from pg_class where oid = 'dominio.categorias_tienda'::regclass), true, 'categorias_tienda tiene RLS');
select is((select relrowsecurity from pg_class where oid = 'dominio.productos_tienda'::regclass), true, 'productos_tienda tiene RLS');
select is(has_table_privilege('anon', 'dominio.categorias_tienda', 'select'), false, 'anon no lee categorias_tienda');
select is(has_table_privilege('anon', 'dominio.productos_tienda', 'select'), false, 'anon no lee productos_tienda');
select is(has_table_privilege('authenticated', 'dominio.productos_tienda', 'insert'), false, 'authenticated no escribe productos_tienda directo');
select is(has_table_privilege('authenticated', 'dominio.categorias_tienda', 'update'), false, 'authenticated no escribe categorias_tienda directo');
select is(has_function_privilege('anon', 'public.listar_catalogo_tienda(uuid)', 'execute'), false, 'anon no ejecuta listar_catalogo_tienda');
select is(has_function_privilege('anon', 'public.guardar_catalogo_tienda(uuid, jsonb, jsonb)', 'execute'), false, 'anon no ejecuta guardar_catalogo_tienda');
select is(has_function_privilege('authenticated', 'public.guardar_catalogo_tienda(uuid, jsonb, jsonb)', 'execute'), true, 'authenticated ejecuta guardar_catalogo_tienda');
select is(has_function_privilege('anon', 'publico.catalogo_visible_por_dominio(text)', 'execute'), true, 'anon ejecuta la función pública del catálogo');
select is(has_function_privilege('anon', 'private.catalogo_tienda_efectivo(uuid)', 'execute'), false, 'anon no ejecuta el auxiliar privado');
select is(
  (select count(*)::int from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'publico' and c.relkind in ('r', 'p')),
  0, 'publico sigue sin tablas'
);

-- ============================================================================
-- Estado inicial: sin filas = visible y no destacado (FR-040, FR-043, FR-047)
-- ============================================================================

select pg_temp.como('d1000000-0000-0000-0000-000000000001');

select is(
  public.listar_catalogo_tienda('e1000000-0000-0000-0000-000000000001') -> 'resumen',
  '{"visibles": 4, "destacados": 0}'::jsonb,
  'sin filas todo lo activo se muestra y nada está destacado (el inactivo no cuenta)'
);
select is(
  (select p ->> 'motivo' from jsonb_array_elements(public.listar_catalogo_tienda('e1000000-0000-0000-0000-000000000001') -> 'productos') p
    where p ->> 'nombre' = 'Inactivo'),
  'No se muestra: producto inactivo',
  'el producto inactivo trae su motivo calculado en el servidor (FR-044)'
);
select is(
  (select (p ->> 'precio')::numeric from jsonb_array_elements(public.listar_catalogo_tienda('e1000000-0000-0000-0000-000000000001') -> 'productos') p
    where p ->> 'nombre' = 'Joystick'),
  49.90,
  'el precio de lista llega de lectura (FR-047)'
);
select is(
  (select (p ->> 'stock')::int from jsonb_array_elements(public.listar_catalogo_tienda('e1000000-0000-0000-0000-000000000001') -> 'productos') p
    where p ->> 'nombre' = 'Joystick'),
  7,
  'el stock llega de lectura (FR-047)'
);
select is(
  (select count(*)::int from jsonb_array_elements(public.listar_catalogo_tienda('e1000000-0000-0000-0000-000000000001') -> 'productos')),
  5,
  'solo aparecen los productos que vende la tienda (no «Sin tienda»)'
);
select is(
  (select (c ->> 'productos')::int from jsonb_array_elements(public.listar_catalogo_tienda('e1000000-0000-0000-0000-000000000001') -> 'categorias') c
    where c ->> 'nombre' = 'Oculta'),
  1,
  'cada categoría trae su conteo de productos de la tienda'
);

-- ============================================================================
-- Guardar: categoría oculta, destacados e idempotencia (FR-043, FR-045, FR-048)
-- ============================================================================

select is(
  public.guardar_catalogo_tienda(
    'e1000000-0000-0000-0000-000000000001',
    '[{"id":"ca000000-0000-0000-0000-000000000002","visible":false}]'::jsonb,
    '[{"id":"a1000000-0000-0000-0000-000000000001","visible":true,"destacado":true},
      {"id":"a1000000-0000-0000-0000-000000000003","visible":true,"destacado":true}]'::jsonb
  ),
  '{"visibles": 2, "destacados": 1}'::jsonb,
  'ocultar una categoría saca sus productos y los de su subcategoría; destacar un inactivo no cuenta'
);
select is(
  (select p ->> 'motivo' from jsonb_array_elements(public.listar_catalogo_tienda('e1000000-0000-0000-0000-000000000001') -> 'productos') p
    where p ->> 'nombre' = 'En oculta'),
  'No se muestra: categoría oculta',
  'el motivo por categoría oculta se calcula en el servidor'
);
select is(
  (select p ->> 'motivo' from jsonb_array_elements(public.listar_catalogo_tienda('e1000000-0000-0000-0000-000000000001') -> 'productos') p
    where p ->> 'nombre' = 'En hija'),
  'No se muestra: categoría oculta',
  'la subcategoría de una categoría oculta también queda oculta'
);
select is(
  (select (p ->> 'destacado')::boolean from jsonb_array_elements(public.listar_catalogo_tienda('e1000000-0000-0000-0000-000000000001') -> 'productos') p
    where p ->> 'nombre' = 'Inactivo'),
  true,
  'el destacado de un producto no visible se guarda sin cambiar su visibilidad (FR-046)'
);

reset role;
select is(
  (select count(*)::int from registro_actividad where tipo = 'tienda.catalogo_actualizado'),
  1,
  'el guardado deja un evento tienda.catalogo_actualizado'
);
select is(
  (select detalle from registro_actividad where tipo = 'tienda.catalogo_actualizado'),
  'Actualizó el catálogo visible de la tienda de «Tienda A»',
  'el evento nombra la empresa y no lleva ids'
);

select pg_temp.como('d1000000-0000-0000-0000-000000000001');
select public.guardar_catalogo_tienda(
  'e1000000-0000-0000-0000-000000000001',
  '[{"id":"ca000000-0000-0000-0000-000000000002","visible":false}]'::jsonb,
  '[{"id":"a1000000-0000-0000-0000-000000000001","visible":true,"destacado":true},
    {"id":"a1000000-0000-0000-0000-000000000003","visible":true,"destacado":true}]'::jsonb
);
reset role;
select is(
  (select count(*)::int from registro_actividad where tipo = 'tienda.catalogo_actualizado'),
  1,
  'repetir el mismo guardado no cambia nada ni deja otro evento (idempotente)'
);

-- ============================================================================
-- Función pública: lo que ve el visitante (FR-049, SC-007)
-- ============================================================================

select set_config('test.org_a', (select organizacion_id::text from dominio.tiendas where dominio = 'cat-a.ejemplo.com'), true);
select set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);
set local role anon;

select is(
  (select jsonb_agg(p ->> 'nombre') from jsonb_array_elements(publico.catalogo_visible_por_dominio('cat-a.ejemplo.com') -> 'productos') p),
  '["Joystick", "Cable"]'::jsonb,
  'la tienda pública muestra solo lo efectivamente visible, destacados primero'
);
select is(
  (select jsonb_agg(c ->> 'nombre') from jsonb_array_elements(publico.catalogo_visible_por_dominio('cat-a.ejemplo.com') -> 'categorias') c),
  '["Visible"]'::jsonb,
  'la categoría oculta y su hija no aparecen en el menú ni en los filtros'
);
select is(
  (select jsonb_agg(k order by k) from (select distinct jsonb_object_keys(p) k from jsonb_array_elements(publico.catalogo_visible_por_dominio('cat-a.ejemplo.com') -> 'productos') p) s),
  '["categoria_id", "destacado", "id", "moneda", "nombre", "precio", "tiene_imagen"]'::jsonb,
  'cada producto público trae solo la lista blanca: sin costos, stock, SKU ni proveedor'
);
select ok(
  position(current_setting('test.org_a') in publico.catalogo_visible_por_dominio('cat-a.ejemplo.com')::text) = 0,
  'ningún valor de la respuesta pública contiene el id de la organización'
);
select is(
  jsonb_array_length(publico.catalogo_visible_por_dominio('cat-a.ejemplo.com') -> 'productos'),
  2,
  'la cantidad de productos públicos coincide con «N visibles» del resumen'
);
select is(
  (select count(*)::int from jsonb_array_elements(publico.catalogo_visible_por_dominio('cat-a.ejemplo.com') -> 'productos') p where (p ->> 'destacado')::boolean),
  1,
  'los destacados públicos coinciden con «M destacados» del resumen'
);
select is(
  (select jsonb_agg(p ->> 'nombre' order by p ->> 'nombre') from jsonb_array_elements(publico.catalogo_visible_por_dominio('cat-b.ejemplo.com') -> 'productos') p),
  '["Cable", "En hija", "En oculta", "Joystick"]'::jsonb,
  'la otra tienda con los mismos productos no cambió (aislamiento entre tiendas)'
);
select is(publico.catalogo_visible_por_dominio('no-existe.ejemplo.com'), null, 'un dominio desconocido devuelve null');
select is(
  (select count(*)::int from jsonb_array_elements(publico.catalogo_visible_por_dominio('cat-dos.ejemplo.com') -> 'productos')),
  0,
  'la tienda de otra organización no recibe productos de la primera'
);

reset role;
update dominio.empresas set activa = false where id = 'e1000000-0000-0000-0000-000000000002';
select set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);
set local role anon;
select is(
  publico.catalogo_visible_por_dominio('cat-b.ejemplo.com'),
  null,
  'una empresa desactivada devuelve lo mismo que un dominio desconocido'
);
reset role;
update dominio.empresas set activa = true where id = 'e1000000-0000-0000-0000-000000000002';

-- ============================================================================
-- Resumen == lo público (SC-007) y vuelta a los valores predeterminados
-- ============================================================================

select pg_temp.como('d1000000-0000-0000-0000-000000000001');
select is(
  public.listar_catalogo_tienda('e1000000-0000-0000-0000-000000000002') -> 'resumen',
  '{"visibles": 4, "destacados": 0}'::jsonb,
  'el resumen de la otra tienda tampoco cambió'
);
select public.guardar_catalogo_tienda(
  'e1000000-0000-0000-0000-000000000001',
  '[{"id":"ca000000-0000-0000-0000-000000000002","visible":true}]'::jsonb,
  '[{"id":"a1000000-0000-0000-0000-000000000001","visible":true,"destacado":false},
    {"id":"a1000000-0000-0000-0000-000000000003","visible":true,"destacado":false}]'::jsonb
);
reset role;
select is(
  (select count(*)::int from dominio.productos_tienda where empresa_id = 'e1000000-0000-0000-0000-000000000001')
  + (select count(*)::int from dominio.categorias_tienda where empresa_id = 'e1000000-0000-0000-0000-000000000001'),
  0,
  'volver a lo predeterminado borra las filas (ausencia de fila = visible y no destacado)'
);

-- ============================================================================
-- Permisos y aislamiento entre organizaciones (SC-001)
-- ============================================================================

select pg_temp.como('d1000000-0000-0000-0000-000000000003');
-- La matriz inicial da «N» a consulta en la sección Empresas: ni lista ni guarda.
select throws_ok(
  $$select public.listar_catalogo_tienda('e1000000-0000-0000-0000-000000000001')$$,
  '42501', null, 'consulta (sin acceso a Empresas) no lista el catálogo'
);
select throws_ok(
  $$select public.guardar_catalogo_tienda('e1000000-0000-0000-0000-000000000001', '[]'::jsonb, '[]'::jsonb)$$,
  '42501', null, 'consulta no puede guardar'
);

select pg_temp.como('d2000000-0000-0000-0000-000000000001');
select throws_ok(
  $$select public.listar_catalogo_tienda('e1000000-0000-0000-0000-000000000001')$$,
  'P0002', null, 'otra organización no lista la tienda ajena'
);
select throws_ok(
  $$select public.guardar_catalogo_tienda('e1000000-0000-0000-0000-000000000001', '[]'::jsonb, '[]'::jsonb)$$,
  'P0002', null, 'otra organización no guarda en la tienda ajena'
);
select is((select count(*)::int from dominio.categorias_tienda), 0, 'otra organización no lee categorias_tienda ajenas');

-- ============================================================================
-- Validaciones y transacción (FR-048)
-- ============================================================================

select pg_temp.como('d1000000-0000-0000-0000-000000000001');
select throws_ok(
  $$select public.guardar_catalogo_tienda('e1000000-0000-0000-0000-000000000001', '[]'::jsonb,
      '[{"id":"b2000000-0000-0000-0000-000000000001","visible":false,"destacado":false}]'::jsonb)$$,
  '22023', null, 'un producto de otra organización se rechaza'
);
select throws_ok(
  $$select public.guardar_catalogo_tienda('e1000000-0000-0000-0000-000000000001', '[]'::jsonb,
      '[{"id":"a1000000-0000-0000-0000-000000000006","visible":false,"destacado":false}]'::jsonb)$$,
  '22023', null, 'un producto que la tienda no vende se rechaza'
);
select throws_ok(
  $$select public.guardar_catalogo_tienda('e1000000-0000-0000-0000-000000000001',
      '[{"id":"ca000000-0000-0000-0000-0000000000f1","visible":false}]'::jsonb, '[]'::jsonb)$$,
  '22023', null, 'una categoría de otra organización se rechaza'
);
select throws_ok(
  $$select public.guardar_catalogo_tienda('e1000000-0000-0000-0000-000000000001', '{}'::jsonb, '[]'::jsonb)$$,
  '22023', null, 'los cambios que no son lista se rechazan'
);
select throws_ok(
  $$select public.guardar_catalogo_tienda('e1000000-0000-0000-0000-000000000001', '[{"id":"no-es-uuid","visible":true}]'::jsonb, '[]'::jsonb)$$,
  '22023', null, 'un id con formato inválido se rechaza'
);
select throws_ok(
  $$select public.guardar_catalogo_tienda('e1000000-0000-0000-0000-000000000001', '[{"id":"ca000000-0000-0000-0000-000000000001"}]'::jsonb, '[]'::jsonb)$$,
  '22023', null, 'un cambio sin «visible» se rechaza'
);
select throws_ok(
  $$select public.guardar_catalogo_tienda('e1000000-0000-0000-0000-000000000001',
      '[{"id":"ca000000-0000-0000-0000-000000000001","visible":false},{"id":"ca000000-0000-0000-0000-000000000001","visible":true}]'::jsonb, '[]'::jsonb)$$,
  '22023', null, 'los elementos repetidos se rechazan'
);
select throws_ok(
  $$select public.guardar_catalogo_tienda('e1000000-0000-0000-0000-000000000001',
      '[{"id":"ca000000-0000-0000-0000-000000000001","visible":false}]'::jsonb,
      '[{"id":"a1000000-0000-0000-0000-000000000006","visible":false,"destacado":false}]'::jsonb)$$,
  '22023', null, 'un guardado con una parte inválida falla completo'
);
reset role;
select is(
  (select count(*)::int from dominio.categorias_tienda where empresa_id = 'e1000000-0000-0000-0000-000000000001'),
  0,
  'el guardado fallido no dejó cambios parciales (transaccional)'
);

-- ============================================================================
-- FK compuesta: una fila no cruza organizaciones (FR-040)
-- ============================================================================

select throws_ok(
  $$insert into dominio.productos_tienda (empresa_id, producto_id, organizacion_id, visible)
    values ('e1000000-0000-0000-0000-000000000001', 'b2000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', false)$$,
  '23503', null, 'productos_tienda no admite un producto de otra organización'
);

select * from finish();
rollback;
