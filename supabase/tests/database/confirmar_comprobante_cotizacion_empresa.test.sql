-- MSF-352 (revisión de F-PRE-06): `public.confirmar_comprobante` con la cotización por empresa (20270216400000).
-- Antes de la corrección, con alcance «empresa» `cotizacion_aplicada` tiene una fila por empresa y la subconsulta
-- escalar devolvía varias filas (21000): nadie podía confirmar facturas. Cubre: alcance «empresa» con y sin fila propia
-- (cae a la general), alcance «sistema» (comportamiento previo, ignora la fila de la empresa), sin cotización aplicada
-- (cae a la inicial), el costo en pesos con la misma cotización y la idempotencia.
begin;

select no_plan();

insert into organizaciones (id, nombre) values ('11111111-1111-1111-1111-111111111111', 'Organización Uno');
insert into auth.users (id, email) values ('f1000000-0000-0000-0000-000000000002', 'operador@example.com');
insert into usuarios_organizacion (user_id, organizacion_id, rol_id, estado) values
  ('f1000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'operador', 'activo');
insert into dominio.empresas (id, organizacion_id, nombre) values
  ('a1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'Empresa Uno'),
  ('a1000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'Empresa Dos');
insert into usuarios_empresas (user_id, empresa_id, organizacion_id, rol_id) values
  ('f1000000-0000-0000-0000-000000000002', 'a1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'operador'),
  ('f1000000-0000-0000-0000-000000000002', 'a1000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'operador');
insert into clientes (id, organizacion_id, numero, nombre, tipo, archivado_en) values
  ('c5000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 10, 'Cliente Uno', 'minorista', null);

-- Un producto en USD (precio USD 2) con costo USD 10 y stock suficiente.
insert into dominio.productos (id, organizacion_id, nombre, sku, moneda, precio_lista, activo) values
  ('b1000000-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111', 'Consola', 'CON-1', 'USD', 2, true);
insert into dominio.producto_costos (producto_id, organizacion_id, costo) values
  ('b1000000-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111', 10);

create temp table datos as
  select (select id from dominio.depositos where organizacion_id = '11111111-1111-1111-1111-111111111111' and por_defecto) as principal;
grant select on datos to public;
insert into dominio.depositos_empresas (deposito_id, empresa_id, organizacion_id)
select (select principal from datos), e, '11111111-1111-1111-1111-111111111111'
  from unnest(array['a1000000-0000-0000-0000-000000000001', 'a1000000-0000-0000-0000-000000000002']::uuid[]) e
on conflict do nothing;
insert into dominio.existencias (producto_id, organizacion_id, cantidad, reservado) values
  ('b1000000-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111', 50, 0)
on conflict (producto_id) do update set cantidad = excluded.cantidad, reservado = excluded.reservado;
insert into dominio.existencias_deposito (producto_id, deposito_id, organizacion_id, cantidad, reservado) values
  ('b1000000-0000-0000-0000-000000000003', (select principal from datos), '11111111-1111-1111-1111-111111111111', 50, 0)
on conflict (producto_id, deposito_id) do update set cantidad = excluded.cantidad, reservado = excluded.reservado;

create function pg_temp.como(p_user uuid) returns void language plpgsql as $$
begin
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
  set local role authenticated;
end $$;

create temp table comps (clave text primary key, id uuid);
grant select, insert, update on comps to public;

create function pg_temp.armar(p_clave text, p_empresa uuid) returns void language plpgsql as $$
declare v_c dominio.comprobantes_venta;
begin
  v_c := public.crear_comprobante('factura', p_empresa, 'c5000000-0000-0000-0000-000000000001', 'mostrador', current_date);
  insert into comps (clave, id) values (p_clave, v_c.id);
  perform public.guardar_lineas_comprobante(v_c.id, jsonb_build_array(
    jsonb_build_object('producto_id', 'b1000000-0000-0000-0000-000000000003', 'cantidad', 1, 'deposito_id', (select principal from datos))), v_c.updated_at);
end $$;
create function pg_temp.id_de(p_clave text) returns uuid language sql as $$ select id from comps where clave = p_clave $$;
create function pg_temp.col_linea(p_clave text, p_columna text) returns numeric language plpgsql security definer as $$
declare v numeric;
begin
  execute format('select %I from dominio.comprobantes_venta_lineas where comprobante_id = $1 order by orden limit 1', p_columna)
    into v using (select id from comps where clave = p_clave);
  return v;
end $$;
grant execute on function pg_temp.id_de(text), pg_temp.col_linea(text, text) to public;

-- ============================================================================
-- Sin cotización aplicada: rige la inicial (1.000)
-- ============================================================================
insert into dominio.cotizacion_inicial (organizacion_id, valor) values ('11111111-1111-1111-1111-111111111111', 1000);
select pg_temp.como('f1000000-0000-0000-0000-000000000002');
select pg_temp.armar('INI', 'a1000000-0000-0000-0000-000000000001');
select lives_ok(format($$select public.confirmar_comprobante(%L)$$, pg_temp.id_de('INI')), 'sin cotización aplicada confirma');
select is(pg_temp.col_linea('INI', 'cotizacion'), 1000.0000, 'guarda la cotización inicial');
select is(pg_temp.col_linea('INI', 'costo_unitario'), 10000.00, 'y el costo en pesos con ella (USD 10 × 1.000)');

-- ============================================================================
-- Alcance «sistema» (comportamiento previo): una sola cotización aplicada, la general.
-- Queda además una fila de la Empresa Uno (de un alcance anterior): NO debe usarse ni romper la subconsulta.
-- ============================================================================
reset role;
insert into dominio.cotizacion_aplicada (organizacion_id, empresa_id, valor) values
  ('11111111-1111-1111-1111-111111111111', null, 1200),
  ('11111111-1111-1111-1111-111111111111', 'a1000000-0000-0000-0000-000000000001', 1500);
select pg_temp.como('f1000000-0000-0000-0000-000000000002');
select pg_temp.armar('SIS', 'a1000000-0000-0000-0000-000000000001');
select lives_ok(format($$select public.confirmar_comprobante(%L)$$, pg_temp.id_de('SIS')), 'alcance sistema con varias filas aplicadas confirma (antes: 21000)');
select is(pg_temp.col_linea('SIS', 'cotizacion'), 1200.0000, 'alcance sistema: guarda la cotización general');
select is(pg_temp.col_linea('SIS', 'costo_unitario'), 12000.00, 'alcance sistema: el costo usa la general (USD 10 × 1.200)');

-- ============================================================================
-- Alcance «empresa»: la Empresa Uno usa la suya (1.500); la Empresa Dos no tiene fila y cae a la general (1.200)
-- ============================================================================
reset role;
insert into dominio.cotizacion_configuracion (organizacion_id, alcance) values ('11111111-1111-1111-1111-111111111111', 'empresa');
select pg_temp.como('f1000000-0000-0000-0000-000000000002');
select pg_temp.armar('E1', 'a1000000-0000-0000-0000-000000000001');
select pg_temp.armar('E2', 'a1000000-0000-0000-0000-000000000002');
select lives_ok(format($$select public.confirmar_comprobante(%L)$$, pg_temp.id_de('E1')), 'alcance empresa: confirma la factura de la empresa con cotización propia');
select is(pg_temp.col_linea('E1', 'cotizacion'), 1500.0000, 'guarda la cotización de la empresa');
select is(pg_temp.col_linea('E1', 'costo_unitario'), 15000.00, 'el costo usa la cotización de la empresa (USD 10 × 1.500)');
select lives_ok(format($$select public.confirmar_comprobante(%L)$$, pg_temp.id_de('E2')), 'alcance empresa: confirma la de la empresa sin fila propia');
select is(pg_temp.col_linea('E2', 'cotizacion'), 1200.0000, 'sin fila propia cae a la cotización general');
select is(pg_temp.col_linea('E2', 'costo_unitario'), 12000.00, 'y el costo usa la general (USD 10 × 1.200)');

-- Idempotencia: una cotización posterior no altera lo guardado y reconfirmar no falla.
reset role;
update dominio.cotizacion_aplicada set valor = 1800 where empresa_id = 'a1000000-0000-0000-0000-000000000001';
select pg_temp.como('f1000000-0000-0000-0000-000000000002');
select lives_ok(format($$select public.confirmar_comprobante(%L)$$, pg_temp.id_de('E1')), 'reconfirmar es idempotente');
select is(pg_temp.col_linea('E1', 'cotizacion'), 1500.0000, 'la cotización guardada no se mueve');
select is(pg_temp.col_linea('E1', 'costo_unitario'), 15000.00, 'el costo guardado tampoco');


-- ============================================================================
-- Alcance «empresa» sin fila propia Y sin cotización general: cae a la inicial (revisión de #799)
-- ============================================================================
reset role;
delete from dominio.cotizacion_aplicada where organizacion_id = '11111111-1111-1111-1111-111111111111';
select pg_temp.como('f1000000-0000-0000-0000-000000000002');
select pg_temp.armar('INI2', 'a1000000-0000-0000-0000-000000000002');
select lives_ok(format($$select public.confirmar_comprobante(%L)$$, pg_temp.id_de('INI2')), 'alcance empresa sin ninguna cotización aplicada confirma');
select is(pg_temp.col_linea('INI2', 'cotizacion'), 1000.0000, 'cae a la cotización inicial');
select is(pg_temp.col_linea('INI2', 'costo_unitario'), 10000.00, 'y el costo usa la inicial (USD 10 × 1.000)');

-- ============================================================================
-- Producto en ARS: el costo queda sin convertir; la cotización guardada es la vigente
-- ============================================================================
reset role;
insert into dominio.productos (id, organizacion_id, nombre, sku, moneda, precio_lista, activo) values
  ('b1000000-0000-0000-0000-000000000004', '11111111-1111-1111-1111-111111111111', 'Cable', 'CAB-1', 'ARS', 500, true);
insert into dominio.producto_costos (producto_id, organizacion_id, costo) values
  ('b1000000-0000-0000-0000-000000000004', '11111111-1111-1111-1111-111111111111', 200);
insert into dominio.existencias (producto_id, organizacion_id, cantidad, reservado) values
  ('b1000000-0000-0000-0000-000000000004', '11111111-1111-1111-1111-111111111111', 50, 0)
on conflict (producto_id) do update set cantidad = excluded.cantidad, reservado = excluded.reservado;
insert into dominio.existencias_deposito (producto_id, deposito_id, organizacion_id, cantidad, reservado) values
  ('b1000000-0000-0000-0000-000000000004', (select principal from datos), '11111111-1111-1111-1111-111111111111', 50, 0)
on conflict (producto_id, deposito_id) do update set cantidad = excluded.cantidad, reservado = excluded.reservado;
insert into dominio.cotizacion_aplicada (organizacion_id, empresa_id, valor) values
  ('11111111-1111-1111-1111-111111111111', 'a1000000-0000-0000-0000-000000000001', 1500);
select pg_temp.como('f1000000-0000-0000-0000-000000000002');
create function pg_temp.armar_ars(p_clave text, p_empresa uuid) returns void language plpgsql as $$
declare v_c dominio.comprobantes_venta;
begin
  v_c := public.crear_comprobante('factura', p_empresa, 'c5000000-0000-0000-0000-000000000001', 'mostrador', current_date);
  insert into comps (clave, id) values (p_clave, v_c.id);
  perform public.guardar_lineas_comprobante(v_c.id, jsonb_build_array(
    jsonb_build_object('producto_id', 'b1000000-0000-0000-0000-000000000004', 'cantidad', 1, 'deposito_id', (select principal from datos))), v_c.updated_at);
end $$;
select pg_temp.armar_ars('ARS1', 'a1000000-0000-0000-0000-000000000001');
select lives_ok(format($$select public.confirmar_comprobante(%L)$$, pg_temp.id_de('ARS1')), 'confirma una factura con un producto en ARS');
select is(pg_temp.col_linea('ARS1', 'costo_unitario'), 200.00, 'el costo de un producto en ARS no se convierte');
select is(pg_temp.col_linea('ARS1', 'cotizacion'), 1500.0000, 'y la cotización guardada es la de la empresa');

-- Misma firma y grants.
select is(has_function_privilege('anon', 'public.confirmar_comprobante(uuid)', 'execute'), false, 'anon no confirma');
select is(has_function_privilege('authenticated', 'public.confirmar_comprobante(uuid)', 'execute'), true, 'authenticated confirma');

select * from finish();
rollback;
