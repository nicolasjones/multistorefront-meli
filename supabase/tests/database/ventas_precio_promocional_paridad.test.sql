-- MSF-816 / F-4 (spec 20261113-120000-precio-promocional-en-pos-y-comprobantes, FR-020): paridad entre el precio que
-- ve el cliente en la tienda y el que cobra el local.
--
-- Qué cubre:
--   · para producto/tienda/instante iguales, minorista, cantidad 1 y sin descuento, el neto unitario del local
--     (private.precio_linea_venta) es IGUAL al precio de la tienda (private.precio_vigente_empresa);
--   · con el interruptor «Precios que ve el cliente» (precios con IVA) la diferencia POR UNIDAD está acotada a
--     menos de $1: la tienda redondea al peso entero (private.aplicar_iva) y el local al centavo del subtotal de
--     la línea (hallazgo 6 de la spec);
--   · con la bandera apagada la paridad también se cumple (ambos lados muestran y cobran el precio normal);
--   · la paridad se EXCLUYE a propósito donde la regla dice que no se compara: una promoción mayor o igual al
--     precio normal (la tienda la muestra y el local la ignora: seguimiento S5) y un producto no publicado en la
--     tienda de la empresa (la tienda no muestra precio; el local sí lo cobraría).
--
-- Instantes fijos: la promoción va de 2027-03-01 a 2027-03-10 y los instantes probados son explícitos, así que
-- el test no depende del reloj (BUG-309). El fixture corre como postgres (la RLS no aplica).
begin;

select no_plan();

-- Sesión de un usuario SIN cambiar de rol (para llamar directo a las funciones `private` como dueño).
create function pg_temp.sesion(p_user uuid) returns void language plpgsql as $$
begin
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
end $$;

create function pg_temp.bandera(p_activa boolean) returns void language plpgsql as $$
begin
  reset role;
  update public.banderas_plataforma set activa = p_activa where clave = 'promociones_precio';
end $$;

insert into organizaciones (id, nombre) values
  ('11111111-1111-1111-1111-111111111111', 'Organización Paridad');

insert into auth.users (id, email) values
  ('f1000000-0000-0000-0000-000000000001', 'paridad@example.com');

insert into usuarios_organizacion (user_id, organizacion_id, rol_id, estado) values
  ('f1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'operador', 'activo');

insert into dominio.empresas (id, organizacion_id, nombre) values
  ('a1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'Tienda A'),
  ('a1000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'Tienda B');

insert into usuarios_empresas (user_id, empresa_id, organizacion_id, rol_id) values
  ('f1000000-0000-0000-0000-000000000001', 'a1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'operador'),
  ('f1000000-0000-0000-0000-000000000001', 'a1000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'operador');

-- La tienda B muestra los precios «con IVA» (interruptor «Precios que ve el cliente»); la A no tiene regla de
-- precio (base «central»): sus precios son netos.
insert into dominio.precios_empresa (empresa_id, organizacion_id, base, ajuste_pct, redondeo_pesos, mostrar_con_iva) values
  ('a1000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'central', 0, 10, true);

insert into dominio.categorias (id, organizacion_id, nombre) values
  ('c1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'Joysticks');

-- P1 lista 1.000 · P2 lista 1.000 (con promoción mayor al normal) · P3 lista 1.000 (no publicado en A)
-- P4 lista 1.234 (no múltiplo de 10) · P5 lista 1.000 con precio propio 950 en la tienda B · P6 lista 1.000 con
-- escala x5 = 900 (el minorista de a 1 unidad usa x1).
insert into dominio.productos (id, organizacion_id, nombre, sku, moneda, precio_lista, categoria_id, disponibilidad_manual, activo) values
  ('b1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'Producto 1', 'PA-1', 'ARS', 1000, 'c1000000-0000-0000-0000-000000000001', null, true),
  ('b1000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'Producto 2', 'PA-2', 'ARS', 1000, 'c1000000-0000-0000-0000-000000000001', null, true),
  ('b1000000-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111', 'Producto 3', 'PA-3', 'ARS', 1000, 'c1000000-0000-0000-0000-000000000001', null, true),
  ('b1000000-0000-0000-0000-000000000004', '11111111-1111-1111-1111-111111111111', 'Producto 4', 'PA-4', 'ARS', 1234, 'c1000000-0000-0000-0000-000000000001', null, true),
  ('b1000000-0000-0000-0000-000000000005', '11111111-1111-1111-1111-111111111111', 'Producto 5', 'PA-5', 'ARS', 1000, 'c1000000-0000-0000-0000-000000000001', null, true),
  ('b1000000-0000-0000-0000-000000000006', '11111111-1111-1111-1111-111111111111', 'Producto 6', 'PA-6', 'ARS', 1000, 'c1000000-0000-0000-0000-000000000001', null, true);

insert into dominio.producto_empresa (producto_id, empresa_id, organizacion_id) values
  ('b1000000-0000-0000-0000-000000000001', 'a1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111'),
  ('b1000000-0000-0000-0000-000000000002', 'a1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111'),
  ('b1000000-0000-0000-0000-000000000004', 'a1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111'),
  ('b1000000-0000-0000-0000-000000000005', 'a1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111'),
  ('b1000000-0000-0000-0000-000000000006', 'a1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111'),
  ('b1000000-0000-0000-0000-000000000001', 'a1000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111'),
  ('b1000000-0000-0000-0000-000000000005', 'a1000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111');

insert into dominio.producto_precios_escala (producto_id, organizacion_id, escala, precio) values
  ('b1000000-0000-0000-0000-000000000006', '11111111-1111-1111-1111-111111111111', 'x5', 900);

insert into dominio.precios_propios_empresa (producto_id, empresa_id, organizacion_id, moneda, importe) values
  ('b1000000-0000-0000-0000-000000000005', 'a1000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'ARS', 950);

-- Promociones: P1 en A a 800 y en B a 700 (menores al normal), P2 en A a 1.200 (mayor al normal: se excluye).
insert into dominio.promociones_precio (id, organizacion_id, empresa_id, producto_id, precio_promocional, desde, hasta) values
  ('e1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'a1000000-0000-0000-0000-000000000001', 'b1000000-0000-0000-0000-000000000001', 800, '2027-03-01 00:00:00-03', '2027-03-10 00:00:00-03'),
  ('e1000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'a1000000-0000-0000-0000-000000000002', 'b1000000-0000-0000-0000-000000000001', 700, '2027-03-01 00:00:00-03', '2027-03-10 00:00:00-03'),
  ('e1000000-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111', 'a1000000-0000-0000-0000-000000000001', 'b1000000-0000-0000-0000-000000000002', 1200, '2027-03-01 00:00:00-03', '2027-03-10 00:00:00-03');

-- El precio unitario del local (neto, minorista, una unidad, sin descuento) y el que ve el cliente en la tienda.
create function pg_temp.local(p_producto uuid, p_empresa uuid, p_ahora timestamptz) returns numeric language sql stable as $$
  select neto_unitario from private.precio_linea_venta(p_producto, p_empresa, 'minorista', 1, 0, p_ahora);
$$;

create function pg_temp.tienda(p_producto uuid, p_empresa uuid, p_ahora timestamptz) returns numeric language sql stable as $$
  select precio from private.precio_vigente_empresa(p_producto, p_empresa, p_ahora);
$$;

-- El precio unitario del local con el IVA de la línea: el local redondea el SUBTOTAL de la línea a centavos.
create function pg_temp.local_con_iva(p_producto uuid, p_empresa uuid, p_ahora timestamptz) returns numeric language sql stable as $$
  select round(pg_temp.local(p_producto, p_empresa, p_ahora), 2)
       + round(round(pg_temp.local(p_producto, p_empresa, p_ahora), 2) * a.porcentaje / 100, 2)
    from private.alicuota_producto(p_producto) a;
$$;

select pg_temp.bandera(true);
select pg_temp.sesion('f1000000-0000-0000-0000-000000000001');

-- ============================================================================
-- Paridad con la tienda A (sin interruptor de IVA): el neto unitario es IDÉNTICO
-- ============================================================================

select is(pg_temp.local('b1000000-0000-0000-0000-000000000001', 'a1000000-0000-0000-0000-000000000001', '2027-03-05 12:00:00-03'), 800.00,
  'A: con promoción vigente el local cobra el precio promocional');
select is(pg_temp.tienda('b1000000-0000-0000-0000-000000000001', 'a1000000-0000-0000-0000-000000000001', '2027-03-05 12:00:00-03'), 800.00,
  'A: la tienda muestra el mismo precio promocional');
select is(pg_temp.local('b1000000-0000-0000-0000-000000000001', 'a1000000-0000-0000-0000-000000000001', '2027-03-05 12:00:00-03'),
  pg_temp.tienda('b1000000-0000-0000-0000-000000000001', 'a1000000-0000-0000-0000-000000000001', '2027-03-05 12:00:00-03'),
  'A: con promoción vigente el precio del local es IGUAL al de la tienda');

select is(pg_temp.local('b1000000-0000-0000-0000-000000000001', 'a1000000-0000-0000-0000-000000000001', '2027-03-15 12:00:00-03'), 1000.00,
  'A: vencida la promoción el local cobra el precio normal');
select is(pg_temp.local('b1000000-0000-0000-0000-000000000001', 'a1000000-0000-0000-0000-000000000001', '2027-03-15 12:00:00-03'),
  pg_temp.tienda('b1000000-0000-0000-0000-000000000001', 'a1000000-0000-0000-0000-000000000001', '2027-03-15 12:00:00-03'),
  'A: sin promoción el precio del local es IGUAL al de la tienda');

select is(pg_temp.local('b1000000-0000-0000-0000-000000000004', 'a1000000-0000-0000-0000-000000000001', '2027-03-15 12:00:00-03'), 1234.00,
  'A: una lista que no es múltiplo de 10 se cobra tal cual (misma regla de precio en los dos lados)');
select is(pg_temp.local('b1000000-0000-0000-0000-000000000004', 'a1000000-0000-0000-0000-000000000001', '2027-03-15 12:00:00-03'),
  pg_temp.tienda('b1000000-0000-0000-0000-000000000004', 'a1000000-0000-0000-0000-000000000001', '2027-03-15 12:00:00-03'),
  'A: la lista que no es múltiplo de 10 también coincide con la tienda');

select is(pg_temp.local('b1000000-0000-0000-0000-000000000006', 'a1000000-0000-0000-0000-000000000001', '2027-03-15 12:00:00-03'), 1000.00,
  'A: el minorista de a 1 unidad usa la escala x1 (la x5 no aplica)');
select is(pg_temp.local('b1000000-0000-0000-0000-000000000006', 'a1000000-0000-0000-0000-000000000001', '2027-03-15 12:00:00-03'),
  pg_temp.tienda('b1000000-0000-0000-0000-000000000006', 'a1000000-0000-0000-0000-000000000001', '2027-03-15 12:00:00-03'),
  'A: la escala x1 coincide con la tienda');

-- ============================================================================
-- Paridad con la tienda B (interruptor «precios con IVA»): diferencia POR UNIDAD < $1
-- ============================================================================

select is(pg_temp.local('b1000000-0000-0000-0000-000000000001', 'a1000000-0000-0000-0000-000000000002', '2027-03-05 12:00:00-03'), 700.00,
  'B: con promoción vigente el local cobra el precio promocional (neto)');
select is(pg_temp.tienda('b1000000-0000-0000-0000-000000000001', 'a1000000-0000-0000-0000-000000000002', '2027-03-05 12:00:00-03'), 847.00,
  'B: la tienda muestra el precio promocional con IVA (redondeado al peso)');
select ok(abs(pg_temp.local_con_iva('b1000000-0000-0000-0000-000000000001', 'a1000000-0000-0000-0000-000000000002', '2027-03-05 12:00:00-03')
            - pg_temp.tienda('b1000000-0000-0000-0000-000000000001', 'a1000000-0000-0000-0000-000000000002', '2027-03-05 12:00:00-03')) < 1,
  'B: con promoción vigente la diferencia por unidad es menor de $1');

select is(pg_temp.tienda('b1000000-0000-0000-0000-000000000001', 'a1000000-0000-0000-0000-000000000002', '2027-03-15 12:00:00-03'), 1210.00,
  'B: sin promoción la tienda muestra el precio normal con IVA');
select ok(abs(pg_temp.local_con_iva('b1000000-0000-0000-0000-000000000001', 'a1000000-0000-0000-0000-000000000002', '2027-03-15 12:00:00-03')
            - pg_temp.tienda('b1000000-0000-0000-0000-000000000001', 'a1000000-0000-0000-0000-000000000002', '2027-03-15 12:00:00-03')) < 1,
  'B: sin promoción la diferencia por unidad es menor de $1');

select is(pg_temp.local('b1000000-0000-0000-0000-000000000005', 'a1000000-0000-0000-0000-000000000002', '2027-03-15 12:00:00-03'), 950.00,
  'B: el local cobra el precio propio de la tienda');
select ok(abs(pg_temp.local_con_iva('b1000000-0000-0000-0000-000000000005', 'a1000000-0000-0000-0000-000000000002', '2027-03-15 12:00:00-03')
            - pg_temp.tienda('b1000000-0000-0000-0000-000000000005', 'a1000000-0000-0000-0000-000000000002', '2027-03-15 12:00:00-03')) < 1,
  'B: con precio propio la diferencia por unidad es menor de $1 (redondeos distintos)');

-- ============================================================================
-- Las dos exclusiones de la paridad (FR-020)
-- ============================================================================

-- Promoción mayor o igual al normal: la tienda la muestra y el local la ignora (seguimiento S5). No se compara.
select is(pg_temp.tienda('b1000000-0000-0000-0000-000000000002', 'a1000000-0000-0000-0000-000000000001', '2027-03-05 12:00:00-03'), 1200.00,
  'exclusión S5: la tienda muestra la promoción de 1.200 aunque sea mayor al normal');
select is(pg_temp.local('b1000000-0000-0000-0000-000000000002', 'a1000000-0000-0000-0000-000000000001', '2027-03-05 12:00:00-03'), 1000.00,
  'exclusión S5: el local ignora la promoción mayor al normal y cobra el precio normal');

-- Producto no publicado en la tienda: la tienda no muestra precio y el local sí lo calcularía.
select is(pg_temp.tienda('b1000000-0000-0000-0000-000000000003', 'a1000000-0000-0000-0000-000000000001', '2027-03-15 12:00:00-03'), null,
  'exclusión: un producto no publicado en la tienda no tiene precio público');
select is(pg_temp.local('b1000000-0000-0000-0000-000000000003', 'a1000000-0000-0000-0000-000000000001', '2027-03-15 12:00:00-03'), 1000.00,
  'exclusión: el local sí calcularía el precio de un producto no publicado (por eso no se comparan)');

-- ============================================================================
-- El conjunto completo de paridad, fila por fila (FR-020)
-- ============================================================================

create temp table paridad (
  producto_id uuid not null,
  empresa_id uuid not null,
  instante timestamptz not null
);

insert into paridad values
  ('b1000000-0000-0000-0000-000000000001', 'a1000000-0000-0000-0000-000000000001', '2027-03-05 12:00:00-03'),
  ('b1000000-0000-0000-0000-000000000001', 'a1000000-0000-0000-0000-000000000001', '2027-03-15 12:00:00-03'),
  ('b1000000-0000-0000-0000-000000000004', 'a1000000-0000-0000-0000-000000000001', '2027-03-15 12:00:00-03'),
  ('b1000000-0000-0000-0000-000000000005', 'a1000000-0000-0000-0000-000000000001', '2027-03-15 12:00:00-03'),
  ('b1000000-0000-0000-0000-000000000006', 'a1000000-0000-0000-0000-000000000001', '2027-03-15 12:00:00-03'),
  ('b1000000-0000-0000-0000-000000000001', 'a1000000-0000-0000-0000-000000000002', '2027-03-15 12:00:00-03'),
  ('b1000000-0000-0000-0000-000000000005', 'a1000000-0000-0000-0000-000000000002', '2027-03-15 12:00:00-03');

-- En la tienda A (sin interruptor de IVA) el neto del local es el precio de la tienda; en la B (con IVA) difieren
-- menos de $1 por unidad (la tienda redondea al peso y el local al centavo del subtotal de la línea).
select is((
  select count(*)::int
    from paridad p
   where (p.empresa_id = 'a1000000-0000-0000-0000-000000000001'
          and pg_temp.local(p.producto_id, p.empresa_id, p.instante)
              <> pg_temp.tienda(p.producto_id, p.empresa_id, p.instante))
      or (p.empresa_id = 'a1000000-0000-0000-0000-000000000002'
          and abs(pg_temp.local_con_iva(p.producto_id, p.empresa_id, p.instante)
                  - pg_temp.tienda(p.producto_id, p.empresa_id, p.instante)) >= 1)
), 0, 'FR-020: ninguna fila del conjunto de paridad se aparta (igualdad sin IVA, menos de $1 por unidad con IVA)');

-- ============================================================================
-- Con la bandera apagada los dos lados muestran y cobran el precio normal
-- ============================================================================

select pg_temp.bandera(false);
select pg_temp.sesion('f1000000-0000-0000-0000-000000000001');

select is(pg_temp.local('b1000000-0000-0000-0000-000000000001', 'a1000000-0000-0000-0000-000000000001', '2027-03-05 12:00:00-03'), 1000.00,
  'A con la bandera apagada el local cobra el precio normal');
select is(pg_temp.tienda('b1000000-0000-0000-0000-000000000001', 'a1000000-0000-0000-0000-000000000001', '2027-03-05 12:00:00-03'), 1000.00,
  'A con la bandera apagada la tienda muestra el precio normal');
select is(pg_temp.local('b1000000-0000-0000-0000-000000000001', 'a1000000-0000-0000-0000-000000000001', '2027-03-05 12:00:00-03'),
  pg_temp.tienda('b1000000-0000-0000-0000-000000000001', 'a1000000-0000-0000-0000-000000000001', '2027-03-05 12:00:00-03'),
  'A con la bandera apagada el precio del local es IGUAL al de la tienda');

select * from finish();
rollback;
