-- F-VTA-07 (MSF-317, épica MSF-159): confirmación de la factura. Cubre SC-005: baja exacta por depósito, «A pedido»
-- reserva sin descontar, todo o nada, sin stock negativo, idempotencia, presupuesto sin movimientos, permisos,
-- aislamiento entre organizaciones, `anon` sin acceso y borrador fuera del ranking de clientes.
-- La concurrencia real (dos sesiones) no cabe en una transacción de pgTAP: se prueba la serie (la segunda
-- confirmación ve lo que dejó la primera) y que el comprobante y las existencias se toman `for update`.
begin;

select no_plan();

insert into organizaciones (id, nombre) values
  ('11111111-1111-1111-1111-111111111111', 'Organización Uno'),
  ('22222222-2222-2222-2222-222222222222', 'Organización Dos');

insert into auth.users (id, email) values
  ('f1000000-0000-0000-0000-000000000001', 'administrador@example.com'),
  ('f1000000-0000-0000-0000-000000000002', 'operador@example.com'),
  ('f1000000-0000-0000-0000-000000000003', 'consulta@example.com'),
  ('f2000000-0000-0000-0000-000000000001', 'admin-dos@example.com');

insert into usuarios_organizacion (user_id, organizacion_id, rol_id, estado) values
  ('f1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'administrador', 'activo'),
  ('f1000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'operador', 'activo'),
  ('f1000000-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111', 'consulta', 'activo'),
  ('f2000000-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', 'administrador', 'activo');

insert into dominio.empresas (id, organizacion_id, nombre) values
  ('a1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'San Javucho'),
  ('a2000000-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', 'Empresa Dos');

insert into usuarios_empresas (user_id, empresa_id, organizacion_id, rol_id) values
  ('f1000000-0000-0000-0000-000000000002', 'a1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'operador'),
  ('f1000000-0000-0000-0000-000000000003', 'a1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'consulta');

insert into clientes (id, organizacion_id, numero, nombre, tipo, archivado_en) values
  ('c5000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 10, 'Cliente Confirmado', 'minorista', null),
  ('c5000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 11, 'Cliente Borrador', 'minorista', null);

insert into dominio.categorias (id, organizacion_id, nombre) values
  ('c1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'Joysticks');

-- P1 y P2 con stock; P3 «A pedido».
insert into dominio.productos (id, organizacion_id, nombre, sku, moneda, precio_lista, categoria_id, disponibilidad_manual, activo) values
  ('b1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'Joystick', 'JOY-1', 'ARS', 1000, 'c1000000-0000-0000-0000-000000000001', null, true),
  ('b1000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'Cable', 'CAB-1', 'ARS', 500, 'c1000000-0000-0000-0000-000000000001', null, true),
  ('b1000000-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111', 'Consola bajo pedido', 'CON-1', 'ARS', 2000, 'c1000000-0000-0000-0000-000000000001', 'a_pedido', true);

insert into dominio.depositos (id, organizacion_id, nombre) values
  ('d1000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'Local');

create temp table datos as
  select (select id from dominio.depositos where organizacion_id = '11111111-1111-1111-1111-111111111111' and por_defecto) as principal;
grant select on datos to public;

insert into dominio.depositos_empresas (deposito_id, empresa_id, organizacion_id)
select d, 'a1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111'
  from (select principal as d from datos union all select 'd1000000-0000-0000-0000-000000000002'::uuid) x
on conflict do nothing;

-- Joystick: 10 en el principal y 4 en Local (14). Cable: 5 en el principal. Consola a pedido: 6 en el principal.
insert into dominio.existencias (producto_id, organizacion_id, cantidad, reservado) values
  ('b1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 14, 0),
  ('b1000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 5, 0),
  ('b1000000-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111', 6, 0)
on conflict (producto_id) do update set cantidad = excluded.cantidad, reservado = excluded.reservado;
insert into dominio.existencias_deposito (producto_id, deposito_id, organizacion_id, cantidad, reservado) values
  ('b1000000-0000-0000-0000-000000000001', (select principal from datos), '11111111-1111-1111-1111-111111111111', 10, 0),
  ('b1000000-0000-0000-0000-000000000001', 'd1000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 4, 0),
  ('b1000000-0000-0000-0000-000000000002', (select principal from datos), '11111111-1111-1111-1111-111111111111', 5, 0),
  ('b1000000-0000-0000-0000-000000000003', (select principal from datos), '11111111-1111-1111-1111-111111111111', 6, 0)
on conflict (producto_id, deposito_id) do update set cantidad = excluded.cantidad, reservado = excluded.reservado;

create function pg_temp.como(p_user uuid) returns void language plpgsql as $$
begin
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
  set local role authenticated;
end $$;

create temp table comps (clave text primary key, id uuid);
grant select, insert, update on comps to public;

-- Crea un comprobante y guarda sus líneas (arreglo JSON) como el operador.
create function pg_temp.armar(p_clave text, p_tipo text, p_cliente uuid, p_lineas jsonb) returns void language plpgsql as $$
declare v_c dominio.comprobantes_venta;
begin
  v_c := public.crear_comprobante(p_tipo, 'a1000000-0000-0000-0000-000000000001', p_cliente, 'mostrador', '2026-10-24');
  insert into comps (clave, id) values (p_clave, v_c.id);
  if p_lineas is not null then
    perform public.guardar_lineas_comprobante(v_c.id, p_lineas, v_c.updated_at);
  end if;
end $$;

create function pg_temp.id_de(p_clave text) returns uuid language sql as $$ select id from comps where clave = p_clave $$;
create function pg_temp.disp(p_producto uuid, p_deposito uuid) returns text language sql security definer as $$
  select cantidad || '/' || reservado from dominio.existencias_deposito where producto_id = p_producto and deposito_id = p_deposito $$;

select pg_temp.como('f1000000-0000-0000-0000-000000000002');

-- A: Joystick 3 del principal + 2 de Local + Consola a pedido 2 del principal.
select pg_temp.armar('A', 'factura', 'c5000000-0000-0000-0000-000000000001', jsonb_build_array(
  jsonb_build_object('producto_id', 'b1000000-0000-0000-0000-000000000001', 'cantidad', 3, 'deposito_id', (select principal from datos)),
  jsonb_build_object('producto_id', 'b1000000-0000-0000-0000-000000000001', 'cantidad', 2, 'deposito_id', 'd1000000-0000-0000-0000-000000000002'),
  jsonb_build_object('producto_id', 'b1000000-0000-0000-0000-000000000003', 'cantidad', 2, 'deposito_id', (select principal from datos))));
-- B: sin líneas. P: presupuesto con una línea. C: todo o nada (Cable 2 + Joystick 99).
select pg_temp.armar('vacia', 'factura', 'c5000000-0000-0000-0000-000000000001', null);
select pg_temp.armar('presupuesto', 'presupuesto', 'c5000000-0000-0000-0000-000000000001', jsonb_build_array(
  jsonb_build_object('producto_id', 'b1000000-0000-0000-0000-000000000002', 'cantidad', 1, 'deposito_id', (select principal from datos))));
select pg_temp.armar('todo_o_nada', 'factura', 'c5000000-0000-0000-0000-000000000001', jsonb_build_array(
  jsonb_build_object('producto_id', 'b1000000-0000-0000-0000-000000000002', 'cantidad', 2, 'deposito_id', (select principal from datos)),
  jsonb_build_object('producto_id', 'b1000000-0000-0000-0000-000000000001', 'cantidad', 99, 'deposito_id', (select principal from datos))));
select pg_temp.armar('borrador', 'factura', 'c5000000-0000-0000-0000-000000000002', jsonb_build_array(
  jsonb_build_object('producto_id', 'b1000000-0000-0000-0000-000000000002', 'cantidad', 1, 'deposito_id', (select principal from datos))));

-- ============================================================================
-- Privilegios
-- ============================================================================

select is(has_function_privilege('anon', 'public.confirmar_comprobante(uuid)', 'execute'), false, 'anon no confirma');
select is(has_function_privilege('authenticated', 'public.confirmar_comprobante(uuid)', 'execute'), true, 'authenticated ejecuta confirmar_comprobante');

-- ============================================================================
-- Confirmación feliz (FR-030, FR-031, FR-032, FR-035)
-- ============================================================================

select is((select estado from public.confirmar_comprobante(pg_temp.id_de('A'))), 'confirmada', 'la factura pasa a confirmada');
select is(
  (select (confirmado_en is not null and confirmado_por = 'f1000000-0000-0000-0000-000000000002')::text
     from dominio.comprobantes_venta where id = pg_temp.id_de('A')),
  'true', 'fija confirmado_en y confirmado_por (el operador de la sesión)'
);
select is(pg_temp.disp('b1000000-0000-0000-0000-000000000001', (select principal from datos)), '7/0', 'baja exacta en el depósito principal (10 − 3)');
select is(pg_temp.disp('b1000000-0000-0000-0000-000000000001', 'd1000000-0000-0000-0000-000000000002'), '2/0', 'baja exacta en Local (4 − 2)');
select is((select cantidad from dominio.existencias where producto_id = 'b1000000-0000-0000-0000-000000000001'), 9, 'el total único baja 5 (14 − 5)');
select is(pg_temp.disp('b1000000-0000-0000-0000-000000000003', (select principal from datos)), '6/2', '«A pedido»: reserva 2 y NO descuenta');
select is(
  (select count(*)::int from dominio.movimientos_stock where nota = 'Factura ' || (select numero from dominio.comprobantes_venta where id = pg_temp.id_de('A'))
     and tipo = 'salida' and deposito_id is not null),
  2, 'dos salidas con depósito (una por línea de stock), ninguna para «A pedido»'
);
select is(
  (select string_agg(deposito_id::text || ':' || cantidad, ',' order by cantidad desc) from dominio.movimientos_stock
    where nota = 'Factura ' || (select numero from dominio.comprobantes_venta where id = pg_temp.id_de('A'))),
  (select principal::text from datos) || ':3,d1000000-0000-0000-0000-000000000002:2', 'cada salida va al depósito de su línea'
);
select is(
  (select row(r.estado, r.cantidad, r.deposito_id = (select principal from datos))::text from dominio.reservas_stock r
    where r.referencia = 'comprobante:' || pg_temp.id_de('A') || ':linea:3'),
  '(activa,2,t)', 'la reserva queda activa con la referencia del comprobante y la línea'
);
reset role;
select is(
  (select count(*)::int from public.registro_actividad where tipo = 'comprobante.confirmado'),
  1, 'registra el evento comprobante.confirmado'
);
select pg_temp.como('f1000000-0000-0000-0000-000000000002');

-- Idempotencia
select lives_ok(format($$select public.confirmar_comprobante(%L)$$, pg_temp.id_de('A')), 'reintentar sobre una confirmada no falla');
select is(pg_temp.disp('b1000000-0000-0000-0000-000000000001', (select principal from datos)), '7/0', 'el reintento no descuenta dos veces');
select is((select count(*)::int from dominio.reservas_stock where referencia like 'comprobante:' || pg_temp.id_de('A') || '%'), 1, 'el reintento no duplica la reserva');
reset role;
select is((select count(*)::int from public.registro_actividad where tipo = 'comprobante.confirmado'), 1, 'el reintento no repite el evento');
select pg_temp.como('f1000000-0000-0000-0000-000000000002');

-- ============================================================================
-- Rechazos
-- ============================================================================

select throws_ok(format($$select public.confirmar_comprobante(%L)$$, pg_temp.id_de('vacia')),
  '22023', null, 'una factura sin líneas no se confirma');
select throws_ok(format($$select public.confirmar_comprobante(%L)$$, pg_temp.id_de('presupuesto')),
  '22023', null, 'un presupuesto nunca se confirma (FR-030)');
select is((select estado from dominio.comprobantes_venta where id = pg_temp.id_de('presupuesto')), 'pendiente', 'el presupuesto sigue pendiente');
select is(pg_temp.disp('b1000000-0000-0000-0000-000000000002', (select principal from datos)), '5/0', 'el presupuesto no descontó ni reservó (FR-033)');

-- Todo o nada (FR-034): el Cable alcanza, el Joystick no; ni el Cable se descuenta.
select throws_ok(format($$select public.confirmar_comprobante(%L)$$, pg_temp.id_de('todo_o_nada')),
  'P0001', null, 'sin stock suficiente la confirmación falla');
select is(pg_temp.disp('b1000000-0000-0000-0000-000000000002', (select principal from datos)), '5/0', 'todo o nada: el Cable no se descontó');
select is(pg_temp.disp('b1000000-0000-0000-0000-000000000001', (select principal from datos)), '7/0', 'todo o nada: el Joystick quedó igual');
select is((select estado from dominio.comprobantes_venta where id = pg_temp.id_de('todo_o_nada')), 'borrador', 'todo o nada: sigue en borrador');
select is((select count(*)::int from dominio.movimientos_stock where nota = 'Factura ' || (select numero from dominio.comprobantes_venta where id = pg_temp.id_de('todo_o_nada'))), 0, 'todo o nada: sin movimientos parciales');

do $$
begin
  perform public.confirmar_comprobante((select id from comps where clave = 'todo_o_nada'));
exception when others then
  perform set_config('test.mensaje', sqlerrm, true);
end $$;
select ok(current_setting('test.mensaje') like '%Joystick%principal%', 'el mensaje nombra producto y depósito');

-- Serie sin stock negativo: la segunda confirmación ve lo que dejó la primera.
select pg_temp.armar('agota', 'factura', 'c5000000-0000-0000-0000-000000000001', jsonb_build_array(
  jsonb_build_object('producto_id', 'b1000000-0000-0000-0000-000000000001', 'cantidad', 7, 'deposito_id', (select principal from datos))));
select pg_temp.armar('sobra', 'factura', 'c5000000-0000-0000-0000-000000000001', jsonb_build_array(
  jsonb_build_object('producto_id', 'b1000000-0000-0000-0000-000000000001', 'cantidad', 1, 'deposito_id', (select principal from datos))));
select lives_ok(format($$select public.confirmar_comprobante(%L)$$, pg_temp.id_de('agota')), 'la primera agota el depósito');
select throws_ok(format($$select public.confirmar_comprobante(%L)$$, pg_temp.id_de('sobra')), 'P0001', null, 'la segunda ya no tiene stock');
select is(pg_temp.disp('b1000000-0000-0000-0000-000000000001', (select principal from datos)), '0/0', 'el stock queda en 0, nunca negativo');

-- ============================================================================
-- Permisos y aislamiento
-- ============================================================================

select pg_temp.como('f1000000-0000-0000-0000-000000000003');
select throws_ok(format($$select public.confirmar_comprobante(%L)$$, pg_temp.id_de('borrador')), '42501', null, 'consulta (solo lectura) no confirma');
select pg_temp.como('f2000000-0000-0000-0000-000000000001');
select throws_ok(format($$select public.confirmar_comprobante(%L)$$, pg_temp.id_de('borrador')), 'P0002', null, 'otra organización no ve el comprobante');
reset role;
set local role anon;
select throws_ok(format($$select public.confirmar_comprobante(%L)$$, pg_temp.id_de('borrador')), '42501', null, 'anon no ejecuta la RPC');
reset role;

-- ============================================================================
-- Ranking de clientes (FR-036): el borrador no suma
-- ============================================================================

select is(private.comprobante_cuenta_como_facturado('factura', 'borrador'), false, 'una factura en borrador no cuenta como facturada');
select is(private.comprobante_cuenta_como_facturado('factura', 'confirmada'), true, 'una factura confirmada cuenta');
select is(private.comprobante_cuenta_como_facturado('factura', 'anulada'), false, 'una factura anulada no cuenta');
select is(private.comprobante_cuenta_como_facturado('presupuesto', 'confirmada'), false, 'un presupuesto nunca cuenta');

select pg_temp.como('f1000000-0000-0000-0000-000000000001');
select is(
  (select string_agg(nombre, ',' order by nombre) from public.ranking_clientes('2026-10-01', '2026-10-31')),
  'Cliente Confirmado', 'el ranking incluye al cliente con factura confirmada y no al que solo tiene un borrador'
);

select * from finish();
rollback;
