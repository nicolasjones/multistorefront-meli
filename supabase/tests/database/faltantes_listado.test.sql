-- MSF-405 · F-STK-17 (épica MSF-368, SC-301, FR-302): vista public.faltantes_listado.
-- Lista exactamente las líneas «A pedido» de facturas CONFIRMADAS con reserva activa, las cierra al
-- descontar o liberar la reserva, deja fuera borradores, presupuestos y líneas con stock, no muestra las
-- tiendas sin `ventas` visible, aísla organizaciones y no es accesible para `anon`. El fixture corre como
-- postgres (RLS no aplica); las verificaciones, como «authenticated» o «anon», igual que PostgREST.
begin;

select no_plan();

insert into organizaciones (id, nombre) values
  ('11111111-1111-1111-1111-111111111111', 'Organización Uno'),
  ('22222222-2222-2222-2222-222222222222', 'Organización Dos');

insert into auth.users (id, email) values
  ('f1000000-0000-0000-0000-000000000002', 'operador@example.com'),
  ('f1000000-0000-0000-0000-000000000003', 'consulta@example.com'),
  ('f2000000-0000-0000-0000-000000000001', 'admin-dos@example.com');

insert into usuarios_organizacion (user_id, organizacion_id, rol_id, estado) values
  ('f1000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'operador', 'activo'),
  ('f1000000-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111', 'consulta', 'activo'),
  ('f2000000-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', 'administrador', 'activo');

-- San Javucho es la tienda de las dos personas de la organización Uno; Mundo JC no es de ninguna.
insert into dominio.empresas (id, organizacion_id, nombre) values
  ('a1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'San Javucho'),
  ('a1000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'Mundo JC'),
  ('a2000000-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', 'Empresa Dos');

insert into usuarios_empresas (user_id, empresa_id, organizacion_id, rol_id) values
  ('f1000000-0000-0000-0000-000000000002', 'a1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'operador'),
  ('f1000000-0000-0000-0000-000000000003', 'a1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'consulta');

insert into clientes (id, organizacion_id, numero, nombre, tipo, correo, archivado_en) values
  ('c5000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 10, 'Cliente Uno', 'minorista', 'uno@example.com', null);

insert into dominio.categorias (id, organizacion_id, nombre) values
  ('c1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'Joysticks');

-- P1 con stock; P3 «A pedido».
insert into dominio.productos (id, organizacion_id, nombre, sku, moneda, precio_lista, categoria_id, disponibilidad_manual, activo) values
  ('b1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'Joystick', 'JOY-1', 'ARS', 1000, 'c1000000-0000-0000-0000-000000000001', null, true),
  ('b1000000-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111', 'Consola bajo pedido', 'CON-1', 'ARS', 2000, 'c1000000-0000-0000-0000-000000000001', 'a_pedido', true);

create temp table datos as
  select (select id from dominio.depositos where organizacion_id = '11111111-1111-1111-1111-111111111111' and por_defecto) as principal;
grant select on datos to public;

insert into dominio.depositos_empresas (deposito_id, empresa_id, organizacion_id)
select principal, 'a1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111' from datos
on conflict do nothing;

insert into dominio.existencias (producto_id, organizacion_id, cantidad, reservado) values
  ('b1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 10, 0),
  ('b1000000-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111', 6, 0)
on conflict (producto_id) do update set cantidad = excluded.cantidad, reservado = excluded.reservado;
insert into dominio.existencias_deposito (producto_id, deposito_id, organizacion_id, cantidad, reservado) values
  ('b1000000-0000-0000-0000-000000000001', (select principal from datos), '11111111-1111-1111-1111-111111111111', 10, 0),
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

create function pg_temp.armar(p_clave text, p_tipo text, p_lineas jsonb) returns void language plpgsql as $$
declare v_c dominio.comprobantes_venta;
begin
  v_c := public.crear_comprobante(p_tipo, 'a1000000-0000-0000-0000-000000000001', 'c5000000-0000-0000-0000-000000000001', 'mostrador', '2026-10-24');
  insert into comps (clave, id) values (p_clave, v_c.id);
  perform public.guardar_lineas_comprobante(v_c.id, p_lineas, v_c.updated_at);
end $$;

create function pg_temp.id_de(p_clave text) returns uuid language sql as $$ select id from comps where clave = p_clave $$;
create function pg_temp.pedido(p_cantidad integer) returns jsonb language sql as $$
  select jsonb_build_object('producto_id', 'b1000000-0000-0000-0000-000000000003', 'cantidad', p_cantidad, 'deposito_id', (select principal from datos)) $$;
create function pg_temp.con_stock(p_cantidad integer) returns jsonb language sql as $$
  select jsonb_build_object('producto_id', 'b1000000-0000-0000-0000-000000000001', 'cantidad', p_cantidad, 'deposito_id', (select principal from datos)) $$;
create function pg_temp.reserva_de(p_clave text) returns uuid language sql security definer as $$
  select r.id from dominio.reservas_stock r where r.referencia like 'comprobante:' || pg_temp.id_de(p_clave) || ':linea:%' $$;

select pg_temp.como('f1000000-0000-0000-0000-000000000002');

-- A: Consola a pedido ×2 (línea 1) + Joystick con stock ×1 (línea 2). B: Consola a pedido ×1.
-- BORR: factura a pedido sin confirmar. PRES: presupuesto con línea a pedido.
select pg_temp.armar('A', 'factura', jsonb_build_array(pg_temp.pedido(2), pg_temp.con_stock(1)));
select pg_temp.armar('B', 'factura', jsonb_build_array(pg_temp.pedido(1)));
select pg_temp.armar('BORR', 'factura', jsonb_build_array(pg_temp.pedido(1)));
select pg_temp.armar('PRES', 'presupuesto', jsonb_build_array(pg_temp.pedido(1)));

-- ============================================================================
-- Esquema y privilegios (Principio VII, FR-309)
-- ============================================================================

reset role;
select ok(
  exists (select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
           where n.nspname = 'public' and c.relname = 'faltantes_listado' and c.relkind = 'v'),
  'faltantes_listado es una vista de lectura en «public»'
);
select ok(
  coalesce((select 'security_invoker=true' = any (c.reloptions) from pg_class c join pg_namespace n on n.oid = c.relnamespace
             where n.nspname = 'public' and c.relname = 'faltantes_listado'), false),
  'faltantes_listado es security_invoker (rige la RLS de quien consulta)'
);
select is(has_table_privilege('anon', 'public.faltantes_listado', 'select'), false, 'anon no lee faltantes_listado');
select is(has_table_privilege('authenticated', 'public.faltantes_listado', 'select'), true, 'authenticated lee faltantes_listado');

-- ============================================================================
-- Solo facturas confirmadas «A pedido» con reserva activa (FR-302)
-- ============================================================================

select pg_temp.como('f1000000-0000-0000-0000-000000000002');
select is((select count(*)::int from public.faltantes_listado), 0, 'sin facturas confirmadas no hay faltantes (borrador y presupuesto no aparecen)');

select public.confirmar_comprobante(pg_temp.id_de('A'));
select public.confirmar_comprobante(pg_temp.id_de('B'));

select is((select count(*)::int from public.faltantes_listado), 2, 'lista exactamente las dos líneas «A pedido» confirmadas (no la línea con stock)');
select is(
  (select count(*)::int from public.faltantes_listado where producto = 'Joystick'),
  0, 'la línea con stock no es un faltante'
);
select is(
  (select row(empresa, cliente, producto, sku, pedido, aviso)::text from public.faltantes_listado where comprobante_id = pg_temp.id_de('A')),
  '("San Javucho","Cliente Uno","Consola bajo pedido",CON-1,2,sin_avisar)',
  'cada fila trae tienda, cliente, producto y SKU, pedido y aviso «sin_avisar»'
);
select is(
  (select comprobante_numero from public.faltantes_listado where comprobante_id = pg_temp.id_de('A')),
  (select numero from dominio.comprobantes_venta where id = pg_temp.id_de('A')),
  'trae el número del comprobante'
);
select is(
  (select estado_stock from public.faltantes_listado where comprobante_id = pg_temp.id_de('A')),
  'disponible', 'Stock hoy sale de stock_estados (6 − 3 reservadas = 3 disponibles)'
);
select is(
  (select disponible from public.faltantes_listado where comprobante_id = pg_temp.id_de('A')),
  3, 'el disponible del producto es cantidad − reservado'
);

-- ============================================================================
-- Se cierra sola al descontar o liberar la reserva (sin cierre manual)
-- ============================================================================

select public.liberar_reserva(pg_temp.reserva_de('A'));
select is(
  (select count(*)::int from public.faltantes_listado where comprobante_id = pg_temp.id_de('A')),
  0, 'al liberar la reserva la línea sale de la lista'
);
select public.descontar_reserva(pg_temp.reserva_de('B'));
select is(
  (select count(*)::int from public.faltantes_listado where comprobante_id = pg_temp.id_de('B')),
  0, 'al descontar la reserva (entrega) la línea sale de la lista'
);
select is((select count(*)::int from public.faltantes_listado), 0, 'no quedan faltantes abiertos');

-- ============================================================================
-- Tienda sin `ventas` visible y aislamiento entre organizaciones
-- ============================================================================

-- Una factura confirmada de Mundo JC con reserva activa (armada como postgres: la persona no es de esa tienda).
reset role;
insert into dominio.comprobantes_venta
  (id, organizacion_id, cliente_id, tipo, numero, fecha, estado, total_sin_iva, total_con_iva, empresa_id, confirmado_en)
values
  ('e0000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'c5000000-0000-0000-0000-000000000001',
   'factura', 'X-0001', '2026-10-24', 'confirmada', 0, 0, 'a1000000-0000-0000-0000-000000000002', now());
insert into dominio.comprobantes_venta_lineas
  (id, organizacion_id, comprobante_id, orden, producto_id, descripcion, cantidad, precio_unitario, escala, deposito_id, a_pedido, subtotal_sin_iva, iva)
values
  ('e1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'e0000000-0000-0000-0000-000000000001', 1,
   'b1000000-0000-0000-0000-000000000003', 'Consola', 1, 0, 'x1', (select principal from datos), true, 0, 0);
insert into dominio.reservas_stock (organizacion_id, producto_id, deposito_id, cantidad, referencia)
values ('11111111-1111-1111-1111-111111111111', 'b1000000-0000-0000-0000-000000000003', (select principal from datos), 1,
        'comprobante:e0000000-0000-0000-0000-000000000001:linea:1');

select is(
  (select count(*)::int from dominio.reservas_stock
    where referencia = 'comprobante:e0000000-0000-0000-0000-000000000001:linea:1' and estado = 'activa'),
  1, 'la línea de Mundo JC existe con su reserva activa (el filtro que sigue es por tienda)'
);
select pg_temp.como('f1000000-0000-0000-0000-000000000002');
select is(
  (select count(*)::int from public.faltantes_listado), 0,
  'una tienda donde la persona no tiene `ventas` no muestra filas'
);
select pg_temp.como('f1000000-0000-0000-0000-000000000003');
select is(
  (select count(*)::int from public.faltantes_listado), 0,
  'el rol de solo lectura tampoco ve las filas de una tienda ajena'
);

-- Con acceso de lectura a Mundo JC, la fila aparece (el filtro es por tienda, no por rol).
reset role;
insert into usuarios_empresas (user_id, empresa_id, organizacion_id, rol_id) values
  ('f1000000-0000-0000-0000-000000000003', 'a1000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'consulta');
select pg_temp.como('f1000000-0000-0000-0000-000000000003');
select is(
  (select count(*)::int from public.faltantes_listado where empresa = 'Mundo JC'), 1,
  'con `ventas` en lectura en la tienda, la fila aparece'
);

select pg_temp.como('f2000000-0000-0000-0000-000000000001');
select is(
  (select count(*)::int from public.faltantes_listado), 0,
  'otra organización no ve ningún faltante de la organización Uno'
);

reset role;
select * from finish();
rollback;
