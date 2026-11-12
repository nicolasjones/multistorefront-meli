-- F-API-01 (MSF-403, FR-006, SC-001): aislamiento por organización de las
-- lecturas de la API.
--
-- Dos organizaciones con catálogo, stock, precios y ventas propias: la lectura
-- con la organización de A nunca trae filas de B. El filtro va dentro del SQL
-- (`private.api_leer_*`), no en el llamador.
begin;

select no_plan();

insert into organizaciones (id, nombre) values
  ('11111111-1111-1111-1111-111111111111', 'Organización A'),
  ('22222222-2222-2222-2222-222222222222', 'Organización B');

insert into auth.users (id, email) values
  ('f1000000-0000-0000-0000-000000000001', 'admin-api-a@example.com'),
  ('f2000000-0000-0000-0000-000000000001', 'admin-api-b@example.com');

insert into usuarios_organizacion (user_id, organizacion_id, rol_id, estado) values
  ('f1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'administrador', 'activo'),
  ('f2000000-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', 'administrador', 'activo');

insert into dominio.empresas (id, organizacion_id, nombre) values
  ('a1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'Tienda A'),
  ('a2000000-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', 'Tienda B');

insert into clientes (id, organizacion_id, numero, nombre, tipo, archivado_en) values
  ('c1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 10, 'Cliente A', 'minorista', null),
  ('c2000000-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', 10, 'Cliente B', 'minorista', null);

insert into dominio.productos (id, organizacion_id, nombre, sku, moneda, precio_lista, activo) values
  ('b1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'Producto de A', 'A-1', 'ARS', 10000, true),
  ('b2000000-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', 'Producto de B', 'B-1', 'ARS', 20000, true);

insert into dominio.producto_precios_escala (producto_id, organizacion_id, escala, precio) values
  ('b1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'x5', 50000);

insert into dominio.existencias_deposito (producto_id, deposito_id, organizacion_id, cantidad, reservado)
select p.producto_id,
  (select d.id from dominio.depositos d where d.organizacion_id = p.organizacion_id and d.por_defecto),
  p.organizacion_id, 10, 2
from (values
  ('b1000000-0000-0000-0000-000000000001'::uuid, '11111111-1111-1111-1111-111111111111'::uuid),
  ('b2000000-0000-0000-0000-000000000001'::uuid, '22222222-2222-2222-2222-222222222222'::uuid)
) as p(producto_id, organizacion_id);

insert into dominio.comprobantes_venta (
  id, organizacion_id, cliente_id, empresa_id, tipo, numero, fecha, estado,
  total_sin_iva, total_con_iva, confirmado_en
) values
  ('d1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111',
   'c1000000-0000-0000-0000-000000000001', 'a1000000-0000-0000-0000-000000000001',
   'factura', 'F-1', current_date - 1, 'confirmada', 10000, 12100, now() - interval '1 day'),
  ('d2000000-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222',
   'c2000000-0000-0000-0000-000000000001', 'a2000000-0000-0000-0000-000000000001',
   'factura', 'F-2', current_date - 1, 'confirmada', 20000, 24200, now() - interval '1 day');

-- ============================================================================
-- Productos: la lectura de A no trae el producto de B (FR-006).
-- ============================================================================

select is(
  (select jsonb_array_length(filas) from private.api_leer_productos('11111111-1111-1111-1111-111111111111', null, 50, null)),
  1,
  'la organización A lee un solo producto'
);

select is(
  (select filas->0->>'nombre' from private.api_leer_productos('11111111-1111-1111-1111-111111111111', null, 50, null)),
  'Producto de A',
  'el producto devuelto es el de la organización A'
);

select is(
  (select count(*)::int
     from private.api_leer_productos('11111111-1111-1111-1111-111111111111', null, 50, null) x,
          lateral jsonb_array_elements(x.filas) as fila
    where fila->>'nombre' = 'Producto de B'),
  0,
  'la lectura de A no trae el producto de B'
);

select is(
  (select (filas->0->>'precio_lista')::numeric from private.api_leer_productos('11111111-1111-1111-1111-111111111111', null, 50, null)),
  10000::numeric,
  'el precio devuelto es el de la organización A'
);

-- El envoltorio público (el que usa la Edge Function) aísla igual.
set local role service_role;

select is(
  (select jsonb_array_length(filas) from public.api_leer_productos('22222222-2222-2222-2222-222222222222', null, 50, null)),
  1,
  'el envoltorio público lee la organización pedida'
);

select is(
  (select filas->0->>'nombre' from public.api_leer_productos('22222222-2222-2222-2222-222222222222', null, 50, null)),
  'Producto de B',
  'el envoltorio público no mezcla organizaciones'
);

reset role;

-- ============================================================================
-- Stock, precios y ventas.
-- ============================================================================

select is(
  (select jsonb_array_length(filas) from private.api_leer_stock('11111111-1111-1111-1111-111111111111', null, 50, null)),
  1,
  'la organización A lee solo su stock'
);

select is(
  (select filas->0->>'disponible' from private.api_leer_stock('11111111-1111-1111-1111-111111111111', null, 50, null)),
  '8',
  'el disponible es cantidad menos reservado'
);

select is(
  (select filas->0->>'nombre' from private.api_leer_stock('11111111-1111-1111-1111-111111111111', null, 50, null)),
  'Producto de A',
  'el stock devuelto es el de la organización A'
);

select is(
  (select (filas->0->>'precio_x5')::numeric from private.api_leer_precios('11111111-1111-1111-1111-111111111111', null, 50, null)),
  50000::numeric,
  'la organización A lee el precio de su escala'
);

select is(
  (select filas->0->>'precio_x10' from private.api_leer_precios('11111111-1111-1111-1111-111111111111', null, 50, null)),
  null,
  'una escala sin precio cargado viene en null'
);

select is(
  (select jsonb_array_length(filas) from private.api_leer_precios('11111111-1111-1111-1111-111111111111', null, 50, null)),
  1,
  'la organización A lee un solo precio'
);

select is(
  (select jsonb_array_length(filas) from private.api_leer_ventas('11111111-1111-1111-1111-111111111111', null, 50, null)),
  1,
  'la organización A lee una sola venta'
);

select is(
  (select filas->0->>'numero' from private.api_leer_ventas('11111111-1111-1111-1111-111111111111', null, 50, null)),
  'F-1',
  'la venta devuelta es la de la organización A'
);

select is(
  (select not jsonb_exists(filas -> 0, 'cliente_id')
     from private.api_leer_ventas('11111111-1111-1111-1111-111111111111', null, 50, null)),
  true,
  'la venta no expone el cliente'
);

-- ============================================================================
-- Filtro `actualizado_desde` y paginación por cursor.
-- ============================================================================

select is(
  (select jsonb_array_length(filas) from private.api_leer_productos('11111111-1111-1111-1111-111111111111', null, 50, now() + interval '1 minute')),
  0,
  'un `actualizado_desde` futuro no trae filas'
);

select is(
  (select jsonb_array_length(filas) from private.api_leer_productos('11111111-1111-1111-1111-111111111111', null, 50, now() - interval '1 day')),
  1,
  'un `actualizado_desde` pasado trae la fila'
);

select is(
  (select siguiente_cursor from private.api_leer_productos('11111111-1111-1111-1111-111111111111', null, 50, null)),
  null,
  'sin más filas no hay cursor siguiente'
);

-- Con límite 1 sobre dos productos de la misma organización hay cursor.
insert into dominio.productos (id, organizacion_id, nombre, sku, moneda, precio_lista, activo) values
  ('b1000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'Producto de A 2', 'A-2', 'ARS', 15000, true);

select is(
  (select jsonb_array_length(filas) from private.api_leer_productos('11111111-1111-1111-1111-111111111111', null, 1, null)),
  1,
  'el límite acota la página'
);

select is(
  (select siguiente_cursor is not null from private.api_leer_productos('11111111-1111-1111-1111-111111111111', null, 1, null)),
  true,
  'con más filas hay cursor siguiente'
);

-- «c2luYmFycmE» es base64url de «sinbarra»: un cursor bien formado pero sin la
-- clave que el servidor espera.
select throws_ok(
  $$select private.api_leer_productos('11111111-1111-1111-1111-111111111111', 'c2luYmFycmE', 50, null)$$,
  '22023',
  null,
  'un cursor que no trae la clave esperada se rechaza'
);

select throws_ok(
  $$select private.api_leer_productos('11111111-1111-1111-1111-111111111111', null, 500, null)$$,
  '22023',
  null,
  'un límite mayor a 100 se rechaza'
);

select * from finish();
rollback;
