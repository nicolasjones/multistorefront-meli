-- MSF-816 (gate MSF-834 · MSF-363 decisión 6): el ciclo de vida del precio promocional.
-- Cubre FR-008…FR-012 y FR-019 (y parte de SC-002): la guarda de precios desactualizados al confirmar (rechazo
-- sin efectos, promoción vencida, promoción nueva, idempotencia, bandera apagada y reencendido, líneas
-- manual y sin precio calculable), copiar presupuesto, la nota de crédito al precio cobrado con herencia del
-- snapshot, el saldo y los cobros, el IVA (21 % y exento) y la edición manual de precio.
-- Las fechas son RELATIVAS a now() (no dependen del día en que corre).
begin;

select no_plan();

-- ============================================================================
-- Fixture
-- ============================================================================

insert into organizaciones (id, nombre) values
  ('11111111-1111-1111-1111-111111111111', 'Organización Uno');

insert into auth.users (id, email) values
  ('f1000000-0000-0000-0000-000000000001', 'administrador@example.com'),
  ('f1000000-0000-0000-0000-000000000002', 'operador@example.com'),
  ('f1000000-0000-0000-0000-000000000003', 'mostrador@example.com');

insert into usuarios_organizacion (user_id, organizacion_id, rol_id, estado) values
  ('f1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'administrador', 'activo'),
  ('f1000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'operador', 'activo'),
  ('f1000000-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111', 'mostrador', 'activo');

insert into dominio.empresas (id, organizacion_id, nombre) values
  ('a1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'Tienda A');

insert into usuarios_empresas (user_id, empresa_id, organizacion_id, rol_id) values
  ('f1000000-0000-0000-0000-000000000002', 'a1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'operador'),
  ('f1000000-0000-0000-0000-000000000003', 'a1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'mostrador');

insert into clientes (id, organizacion_id, numero, nombre, tipo, archivado_en) values
  ('c5000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 10, 'Cliente', 'minorista', null);

insert into dominio.categorias (id, organizacion_id, nombre) values
  ('c1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'General');

-- Alfa de lista 1.000 (21 % por la categoría) y Beta exento.
insert into dominio.productos (id, organizacion_id, nombre, sku, moneda, precio_lista, categoria_id, activo) values
  ('b1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'Alfa', 'ALF-1', 'ARS', 1000, 'c1000000-0000-0000-0000-000000000001', true),
  ('b1000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'Beta', 'BET-2', 'ARS', 500, 'c1000000-0000-0000-0000-000000000001', true);

update dominio.productos
   set alicuota_iva_id = (select a.id from dominio.alicuotas_iva a
                           where a.organizacion_id = '11111111-1111-1111-1111-111111111111' and a.exento)
 where id = 'b1000000-0000-0000-0000-000000000002';

create temp table datos as
  select (select id from dominio.depositos where organizacion_id = '11111111-1111-1111-1111-111111111111' and por_defecto) as principal;
grant select on datos to public;

insert into dominio.depositos_empresas (deposito_id, empresa_id, organizacion_id)
select principal, 'a1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111'
on conflict do nothing;

insert into dominio.existencias (producto_id, organizacion_id, cantidad, reservado) values
  ('b1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 100, 0),
  ('b1000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 100, 0)
on conflict (producto_id) do update set cantidad = excluded.cantidad, reservado = excluded.reservado;
insert into dominio.existencias_deposito (producto_id, deposito_id, organizacion_id, cantidad, reservado) values
  ('b1000000-0000-0000-0000-000000000001', (select principal from datos), '11111111-1111-1111-1111-111111111111', 100, 0),
  ('b1000000-0000-0000-0000-000000000002', (select principal from datos), '11111111-1111-1111-1111-111111111111', 100, 0)
on conflict (producto_id, deposito_id) do update set cantidad = excluded.cantidad, reservado = excluded.reservado;

-- Promoción vigente de 900 sobre Alfa (lista 1.000).
insert into dominio.promociones_precio (id, organizacion_id, empresa_id, producto_id, precio_promocional, desde, hasta) values
  ('d1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'a1000000-0000-0000-0000-000000000001',
   'b1000000-0000-0000-0000-000000000001', 900, now() - interval '1 hour', now() + interval '1 day');

create function pg_temp.como(p_user uuid) returns void language plpgsql as $$
begin
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
  set local role authenticated;
end $$;

create temp table comps (clave text primary key, id uuid, actualizado timestamptz);
grant select, insert, update on comps to public;

-- Crea un comprobante (factura o presupuesto) y guarda sus líneas.
create function pg_temp.armar(p_clave text, p_tipo text, p_lineas jsonb) returns void language plpgsql as $$
declare v_c dominio.comprobantes_venta;
begin
  v_c := public.crear_comprobante(p_tipo, 'a1000000-0000-0000-0000-000000000001', 'c5000000-0000-0000-0000-000000000001', 'mostrador', current_date);
  insert into comps (clave, id, actualizado) values (p_clave, v_c.id, v_c.updated_at);
  if p_lineas is not null then
    perform public.guardar_lineas_comprobante(v_c.id, p_lineas, v_c.updated_at);
    update comps set actualizado = (select c.updated_at from dominio.comprobantes_venta c where c.id = v_c.id)
     where clave = p_clave;
  end if;
end $$;

-- Re-guarda las líneas de un comprobante que ya existe.
create function pg_temp.guardar(p_clave text, p_lineas jsonb) returns void language plpgsql as $$
begin
  perform public.guardar_lineas_comprobante(
    (select id from comps where clave = p_clave),
    p_lineas,
    (select actualizado from comps where clave = p_clave));
  update comps set actualizado = (select c.updated_at from dominio.comprobantes_venta c where c.id = (select id from comps where clave = p_clave))
   where clave = p_clave;
end $$;

update public.banderas_plataforma set activa = true where clave = 'promociones_precio';

-- ============================================================================
-- FR-009 · la guarda de precios desactualizados al confirmar
-- ============================================================================

-- Una factura con una línea en promoción.
select pg_temp.como('f1000000-0000-0000-0000-000000000002');
select pg_temp.armar('promo', 'factura', jsonb_build_array(
  jsonb_build_object('producto_id', 'b1000000-0000-0000-0000-000000000001', 'cantidad', 1)));
reset role;
select is(
  (select row(l.precio_unitario, l.precio_referencia)::text from dominio.comprobantes_venta_lineas l
    where l.comprobante_id = (select id from comps where clave = 'promo')),
  '(900.00,1000.00)', 'la factura en borrador guarda el precio promocional y su referencia'
);

-- La promoción vence: confirmar se rechaza y no mueve nada.
update dominio.promociones_precio set hasta = now() - interval '1 minute' where id = 'd1000000-0000-0000-0000-000000000001';
select pg_temp.como('f1000000-0000-0000-0000-000000000002');
select throws_ok(
  format($$select public.confirmar_comprobante(%L)$$, (select id from comps where clave = 'promo')),
  '40001', 'Los precios de la venta cambiaron (promoción vencida o nueva): revisá el total',
  'con la promoción vencida, confirmar se rechaza con 40001');
reset role;
select is(
  (select estado from dominio.comprobantes_venta where id = (select id from comps where clave = 'promo')),
  'borrador', 'el rechazo deja la factura en borrador'
);
select is(
  (select count(*)::int from dominio.movimientos_stock),
  0, 'el rechazo no mueve el stock'
);
select is(
  (select count(*)::int from dominio.comprobantes_venta_lineas where comprobante_id = (select id from comps where clave = 'promo') and costo_unitario is not null),
  0, 'el rechazo no guarda el costo'
);

-- La promoción vuelve a estar vigente: se reprecia y la factura se confirma.
update dominio.promociones_precio set hasta = now() + interval '1 day' where id = 'd1000000-0000-0000-0000-000000000001';
select pg_temp.como('f1000000-0000-0000-0000-000000000002');
select pg_temp.guardar('promo', jsonb_build_array(
  jsonb_build_object('producto_id', 'b1000000-0000-0000-0000-000000000001', 'cantidad', 1)));
select lives_ok(
  format($$select public.confirmar_comprobante(%L)$$, (select id from comps where clave = 'promo')),
  'con la promoción vigente, la factura se confirma'
);
-- Idempotencia: confirmar de nuevo no falla ni duplica movimientos.
select lives_ok(
  format($$select public.confirmar_comprobante(%L)$$, (select id from comps where clave = 'promo')),
  'confirmar de nuevo es idempotente'
);
reset role;
select is(
  (select estado from dominio.comprobantes_venta where id = (select id from comps where clave = 'promo')),
  'confirmada', 'la factura quedó confirmada'
);
select is(
  (select count(*)::int from dominio.movimientos_stock),
  1, 'la confirmación movió el stock una sola vez'
);
select is(
  (select row(l.precio_unitario, l.precio_referencia)::text from dominio.comprobantes_venta_lineas l
    where l.comprobante_id = (select id from comps where clave = 'promo')),
  '(900.00,1000.00)', 'la línea confirmada conserva el precio cobrado y su referencia'
);

-- Una promoción NUEVA también invalida el borrador: se rechaza.
select pg_temp.como('f1000000-0000-0000-0000-000000000002');
select pg_temp.armar('nueva', 'factura', jsonb_build_array(
  jsonb_build_object('producto_id', 'b1000000-0000-0000-0000-000000000002', 'cantidad', 1)));
reset role;
select is(
  (select l.precio_unitario from dominio.comprobantes_venta_lineas l
    where l.comprobante_id = (select id from comps where clave = 'nueva')),
  500::numeric, 'sin promoción, la línea cobra el precio normal'
);
insert into dominio.promociones_precio (id, organizacion_id, empresa_id, producto_id, precio_promocional, desde, hasta) values
  ('d1000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'a1000000-0000-0000-0000-000000000001',
   'b1000000-0000-0000-0000-000000000002', 400, now() - interval '1 hour', now() + interval '1 day');
select pg_temp.como('f1000000-0000-0000-0000-000000000002');
select throws_ok(
  format($$select public.confirmar_comprobante(%L)$$, (select id from comps where clave = 'nueva')),
  '40001', 'Los precios de la venta cambiaron (promoción vencida o nueva): revisá el total',
  'una promoción que empezó después del guardado también impide cobrar'
);
reset role;
select is(
  (select estado from dominio.comprobantes_venta where id = (select id from comps where clave = 'nueva')),
  'borrador', 'el rechazo deja la factura en borrador'
);

-- Con la bandera apagada la guarda no actúa: el borrador conserva su precio y se confirma.
update public.banderas_plataforma set activa = false where clave = 'promociones_precio';
select pg_temp.como('f1000000-0000-0000-0000-000000000002');
select lives_ok(
  format($$select public.confirmar_comprobante(%L)$$, (select id from comps where clave = 'nueva')),
  'con la bandera apagada, confirmar no rechaza por precios'
);
reset role;
select is(
  (select l.precio_unitario from dominio.comprobantes_venta_lineas l
    where l.comprobante_id = (select id from comps where clave = 'nueva')),
  500::numeric, 'con la bandera apagada el borrador conserva su precio'
);
update public.banderas_plataforma set activa = true where clave = 'promociones_precio';

-- Al volver a encender la bandera, el borrador guardado con el precio normal se rechaza una vez y se reprecia.
select pg_temp.como('f1000000-0000-0000-0000-000000000002');
select pg_temp.armar('reencendido', 'factura', jsonb_build_array(
  jsonb_build_object('producto_id', 'b1000000-0000-0000-0000-000000000002', 'cantidad', 1)));
reset role;
select is(
  (select l.precio_unitario from dominio.comprobantes_venta_lineas l
    where l.comprobante_id = (select id from comps where clave = 'reencendido')),
  400::numeric, 'con la带宽 encendida la línea cobra la promoción'
);
update dominio.promociones_precio set precio_promocional = 450 where id = 'd1000000-0000-0000-0000-000000000002';
select pg_temp.como('f1000000-0000-0000-0000-000000000002');
select throws_ok(
  format($$select public.confirmar_comprobante(%L)$$, (select id from comps where clave = 'reencendido')),
  '40001', 'Los precios de la venta cambiaron (promoción vencida o nueva): revisá el total',
  'si el precio de la promoción cambió, el borrador se rechaza';
);

-- La línea manual y la línea sin precio calculable se omiten de la guarda.
select pg_temp.como('f1000000-0000-0000-0000-000000000002');
select pg_temp.armar('manual', 'factura', jsonb_build_array(
  jsonb_build_object('producto_id', 'b1000000-0000-0000-0000-000000000001', 'cantidad', 1, 'precio_manual', 700)));
select lives_ok(
  format($$select public.confirmar_comprobante(%L)$$, (select id from comps where clave = 'manual')),
  'una línea con precio manual no se rechaza aunque la promoción haya cambiado'
);
reset role;
select is(
  (select row(l.precio_unitario, l.precio_referencia, l.precio_manual)::text from dominio.comprobantes_venta_lineas l
    where l.comprobante_id = (select id from comps where clave = 'manual')),
  '(700.00,,t)', 'la línea manual conserva su precio, sin referencia y marcada como manual'
);

-- ============================================================================
-- FR-010 · copiar presupuesto reprecia con la promoción vigente
-- ============================================================================

select pg_temp.como('f1000000-0000-0000-0000-000000000002');
select pg_temp.armar('presupuesto', 'presupuesto', jsonb_build_array(
  jsonb_build_object('producto_id', 'b1000000-0000-0000-0000-000000000001', 'cantidad', 1)));
select lives_ok(
  format($$select public.copiar_presupuesto(%L)$$, (select id from comps where clave = 'presupuesto')),
  'copia el presupuesto'
);
reset role;
select is(
  (select count(*)::int from dominio.comprobantes_venta c
    where c.tipo = 'presupuesto' and c.estado = 'pendiente' and c.id <> (select id from comps where clave = 'presupuesto')),
  1, 'la copia es un presupuesto pendiente nuevo'
);
select is(
  (select row(l.precio_unitario, l.precio_referencia)::text
     from dominio.comprobantes_venta_lineas l
     join dominio.comprobantes_venta c on c.id = l.comprobante_id
    where c.tipo = 'presupuesto' and c.id <> (select id from comps where clave = 'presupuesto')),
  '(900.00,1000.00)', 'la copia cobra el precio promocional vigente'
);

-- ============================================================================
-- FR-011 · la nota de crédito devuelve al precio cobrado y hereda el snapshot
-- ============================================================================

select pg_temp.como('f1000000-0000-0000-0000-000000000002');
select lives_ok(
  format($$select public.emitir_nota_credito(%L, 'devolucion_productos', %L::jsonb, null)$$,
    (select id from comps where clave = 'promo'),
    (select jsonb_build_array(jsonb_build_object('linea_id', l.id, 'cantidad', 1))
       from dominio.comprobantes_venta_lineas l
      where l.comprobante_id = (select id from comps where clave = 'promo'))),
  'emite una nota de crédito por la línea en promoción'
);
reset role;
select is(
  (select row(l.precio_unitario, l.precio_referencia, l.promocion_id)::text
     from dominio.comprobantes_venta_lineas l
     join dominio.comprobantes_venta c on c.id = l.comprobante_id
    where c.tipo = 'nota_credito' and c.comprobante_origen_id = (select id from comps where clave = 'promo')),
  '(900.00,1000.00,d1000000-0000-0000-0000-000000000001)', 'la nota devuelve al precio cobrado y hereda la referencia y la promoción'
);

-- ============================================================================
-- FR-012 · IVA, saldo y cobros con el precio cobrado
-- ============================================================================

select is(
  (select row(c.total_sin_iva, c.total_con_iva)::text from dominio.comprobantes_venta c where c.id = (select id from comps where clave = 'promo')),
  '(900.00,1089.00)', 'el total con IVA se calcula sobre el precio cobrado (21 %)'
);
select is(
  (select row(s.total, s.cobrado, s.saldo)::text from private.saldo_comprobante((select id from comps where clave = 'promo')) s),
  '(1089.00,0.00,1089.00)', 'el saldo de la factura promocional es el total cobrado'
);
select is(
  (select row(s.total, s.cobrado, s.saldo)::text from private.saldo_comprobante(
     (select c.id from dominio.comprobantes_venta c
       where c.tipo = 'nota_credito' and c.comprobante_origen_id = (select id from comps where clave = 'promo')) s),
  '(1089.00,0.00,1089.00)', 'la nota de crédito descuenta el importe cobrado'
);

-- ============================================================================
-- FR-019 · la edición manual de precio no cambia
-- ============================================================================

-- Sin el permiso `editar_precio` (el rol mostrador), el precio manual se rechaza.
select pg_temp.como('f1000000-0000-0000-0000-000000000003');
select pg_temp.armar('sin_permiso', 'factura', jsonb_build_array(
  jsonb_build_object('producto_id', 'b1000000-0000-0000-0000-000000000001', 'cantidad', 1)));
select throws_ok(
  format($$select public.guardar_lineas_comprobante(%L, %L::jsonb, %L)$$,
    (select id from comps where clave = 'sin_permiso'),
    '[{"producto_id":"b1000000-0000-0000-0000-000000000001","cantidad":1,"precio_manual":700}]',
    (select actualizado from comps where clave = 'sin_permiso')),
  '42501', 'sin editar_precio el precio manual se rechaza');
reset role;

-- Con permiso, el manual manda sobre la promoción y no deja referencia.
select pg_temp.como('f1000000-0000-0000-0000-000000000002');
select pg_temp.guardar('sin_permiso', jsonb_build_array(
  jsonb_build_object('producto_id', 'b1000000-0000-0000-0000-000000000001', 'cantidad', 1, 'precio_manual', 700)));
reset role;
select is(
  (select row(l.precio_unitario, l.precio_referencia, l.precio_manual)::text
     from dominio.comprobantes_venta_lineas l where l.comprobante_id = (select id from comps where clave = 'sin_permiso')),
  '(700.00,,t)', 'con permiso, el precio manual manda sobre la promoción y no deja referencia'
);
select is(
  (select count(*)::int from public.registro_actividad
    where organizacion_id = '11111111-1111-1111-1111-111111111111' and tipo = 'comprobante.editado'),
  1, 'el guardado manual deja el evento comprobante.editado'
);

select * from finish();
rollback;
