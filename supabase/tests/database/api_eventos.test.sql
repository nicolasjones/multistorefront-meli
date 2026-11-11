-- F-API-01 (MSF-403, FR-011): eventos de precio y de venta.
--
-- Un cambio real de precio (de lista o de escala) emite un `precio.actualizado`
-- y una factura que pasa a confirmada emite un `venta.registrada`. Un cambio
-- que no cambia el valor no emite nada, y el mismo evento no se duplica.
begin;

select no_plan();

insert into organizaciones (id, nombre) values
  ('11111111-1111-1111-1111-111111111111', 'Organización A'),
  ('22222222-2222-2222-2222-222222222222', 'Organización B');

insert into auth.users (id, email) values
  ('f1000000-0000-0000-0000-000000000001', 'admin-api-a@example.com');

insert into usuarios_organizacion (user_id, organizacion_id, rol_id, estado) values
  ('f1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'administrador', 'activo');

insert into clientes (id, organizacion_id, numero, nombre, tipo, archivado_en) values
  ('c1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 10, 'Cliente A', 'minorista', null);

insert into dominio.empresas (id, organizacion_id, nombre) values
  ('a1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'Tienda A');

-- ============================================================================
-- Precio de lista (D-5)
-- ============================================================================

insert into dominio.productos (id, organizacion_id, nombre, sku, moneda, precio_lista, activo) values
  ('b1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'Producto de A', 'A-1', 'ARS', 10000, true);

select is(
  (select count(*)::int from public.cola_eventos where tipo = 'precio.actualizado'
     and organizacion_id = '11111111-1111-1111-1111-111111111111'),
  1,
  'crear el producto con su precio emite un evento'
);

select is(
  (select carga->>'producto_id' from public.cola_eventos where tipo = 'precio.actualizado'
     and organizacion_id = '11111111-1111-1111-1111-111111111111'),
  'b1000000-0000-0000-0000-000000000001',
  'el evento lleva el producto'
);

select is(
  (select (carga->>'precio')::numeric from public.cola_eventos where tipo = 'precio.actualizado'
     and organizacion_id = '11111111-1111-1111-1111-111111111111'),
  10000::numeric,
  'el evento lleva el precio'
);

select is(
  (select carga->>'escala' from public.cola_eventos where tipo = 'precio.actualizado'
     and organizacion_id = '11111111-1111-1111-1111-111111111111'),
  'x1',
  'el precio de lista se emite como escala x1'
);

-- Un UPDATE que deja el mismo precio no emite nada.
update dominio.productos set precio_lista = 10000 where id = 'b1000000-0000-0000-0000-000000000001';

select is(
  (select count(*)::int from public.cola_eventos where tipo = 'precio.actualizado'
     and organizacion_id = '11111111-1111-1111-1111-111111111111'),
  1,
  'un precio que no cambia no emite otro evento'
);

-- Un cambio real sí emite.
update dominio.productos set precio_lista = 12000 where id = 'b1000000-0000-0000-0000-000000000001';

select is(
  (select count(*)::int from public.cola_eventos where tipo = 'precio.actualizado'
     and organizacion_id = '11111111-1111-1111-1111-111111111111'),
  2,
  'un cambio real de precio emite un evento'
);

select is(
  (select (carga->>'precio')::numeric from public.cola_eventos where tipo = 'precio.actualizado'
     and organizacion_id = '11111111-1111-1111-1111-111111111111'
   order by created_at desc limit 1),
  12000::numeric,
  'el evento lleva el precio nuevo'
);

-- Un cambio de moneda también.
update dominio.productos set moneda = 'USD' where id = 'b1000000-0000-0000-0000-000000000001';

select is(
  (select count(*)::int from public.cola_eventos where tipo = 'precio.actualizado'
     and organizacion_id = '11111111-1111-1111-1111-111111111111'),
  3,
  'un cambio de moneda emite un evento'
);

-- ============================================================================
-- Precio de una escala (D-5)
-- ============================================================================

insert into dominio.producto_precios_escala (producto_id, organizacion_id, escala, precio) values
  ('b1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'x5', 50000);

select is(
  (select count(*)::int from public.cola_eventos where tipo = 'precio.actualizado'
     and organizacion_id = '11111111-1111-1111-1111-111111111111'
     and carga->>'escala' = 'x5'),
  1,
  'cargar el precio de una escala emite un evento'
);

update dominio.producto_precios_escala set precio = 50000
 where producto_id = 'b1000000-0000-0000-0000-000000000001' and escala = 'x5';

select is(
  (select count(*)::int from public.cola_eventos where tipo = 'precio.actualizado'
     and organizacion_id = '11111111-1111-1111-1111-111111111111'
     and carga->>'escala' = 'x5'),
  1,
  'un precio de escala que no cambia no emite otro evento'
);

update dominio.producto_precios_escala set precio = 55000
 where producto_id = 'b1000000-0000-0000-0000-000000000001' and escala = 'x5';

select is(
  (select count(*)::int from public.cola_eventos where tipo = 'precio.actualizado'
     and organizacion_id = '11111111-1111-1111-1111-111111111111'
     and carga->>'escala' = 'x5'),
  2,
  'un cambio real del precio de una escala emite un evento'
);

-- ============================================================================
-- Venta registrada (D-5)
-- ============================================================================

insert into dominio.comprobantes_venta (
  id, organizacion_id, cliente_id, empresa_id, tipo, numero, fecha, estado,
  total_sin_iva, total_con_iva
) values (
  'd1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111',
  'c1000000-0000-0000-0000-000000000001', 'a1000000-0000-0000-0000-000000000001',
  'factura', 'F-1', current_date, 'borrador', 10000, 12100
);

select is(
  (select count(*)::int from public.cola_eventos where tipo = 'venta.registrada'
     and organizacion_id = '11111111-1111-1111-1111-111111111111'),
  0,
  'una factura en borrador no emite venta.registrada'
);

update dominio.comprobantes_venta set estado = 'confirmada', confirmado_en = now()
 where id = 'd1000000-0000-0000-0000-000000000001';

select is(
  (select count(*)::int from public.cola_eventos where tipo = 'venta.registrada'
     and organizacion_id = '11111111-1111-1111-1111-111111111111'),
  1,
  'confirmar la factura emite venta.registrada'
);

select is(
  (select carga->>'comprobante_id' from public.cola_eventos where tipo = 'venta.registrada'
     and organizacion_id = '11111111-1111-1111-1111-111111111111'),
  'd1000000-0000-0000-0000-000000000001',
  'el evento lleva el comprobante'
);

select is(
  (select carga->>'numero' from public.cola_eventos where tipo = 'venta.registrada'
     and organizacion_id = '11111111-1111-1111-1111-111111111111'),
  'F-1',
  'el evento lleva el número de la factura'
);

-- Volver a confirmar la misma factura no emite otro evento.
update dominio.comprobantes_venta set estado = 'confirmada'
 where id = 'd1000000-0000-0000-0000-000000000001';

select is(
  (select count(*)::int from public.cola_eventos where tipo = 'venta.registrada'
     and organizacion_id = '11111111-1111-1111-1111-111111111111'),
  1,
  'reconfirmar la factura no duplica el evento'
);

-- Un presupuesto no emite venta.registrada aunque se confirme.
insert into dominio.comprobantes_venta (
  id, organizacion_id, cliente_id, empresa_id, tipo, numero, fecha, estado,
  total_sin_iva, total_con_iva
) values (
  'd1000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111',
  'c1000000-0000-0000-0000-000000000001', 'a1000000-0000-0000-0000-000000000001',
  'presupuesto', 'P-1', current_date, 'confirmada', 10000, 12100
);

select is(
  (select count(*)::int from public.cola_eventos where tipo = 'venta.registrada'
     and organizacion_id = '11111111-1111-1111-1111-111111111111'),
  1,
  'un presupuesto no emite venta.registrada'
);

-- ============================================================================
-- Aislamiento: el evento lleva la organización de la fila.
-- ============================================================================

insert into dominio.productos (id, organizacion_id, nombre, sku, moneda, precio_lista, activo) values
  ('b2000000-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', 'Producto de B', 'B-1', 'ARS', 30000, true);

select is(
  (select count(*)::int from public.cola_eventos where tipo = 'precio.actualizado'
     and organizacion_id = '22222222-2222-2222-2222-222222222222'),
  1,
  'el evento de la otra organización se registra en su propia organización'
);

select * from finish();
rollback;
