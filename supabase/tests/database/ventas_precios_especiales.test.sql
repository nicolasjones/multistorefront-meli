-- F-VTA-32 (MSF-340, épica MSF-193): precios especiales por cliente. Cubre SC-002: cliente 5 % ⇒ precio =
-- escala − 5 %; cliente sin descuento no cambia; precio manual no se pisa; descuento fuera de rango rechazado;
-- solo un Administrador cambia el descuento; el payload no puede imponer un descuento; aislamiento y `anon`.
begin;

select no_plan();

insert into organizaciones (id, nombre) values
  ('11111111-1111-1111-1111-111111111111', 'Organización Uno'),
  ('22222222-2222-2222-2222-222222222222', 'Organización Dos');

insert into auth.users (id, email) values
  ('f1000000-0000-0000-0000-000000000001', 'administrador@example.com'),
  ('f1000000-0000-0000-0000-000000000002', 'operador@example.com'),
  ('f1000000-0000-0000-0000-000000000003', 'consulta@example.com'),
  ('f1000000-0000-0000-0000-000000000004', 'mixto@example.com'),
  ('f2000000-0000-0000-0000-000000000001', 'admin-dos@example.com');

insert into usuarios_organizacion (user_id, organizacion_id, rol_id, estado) values
  ('f1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'administrador', 'activo'),
  ('f1000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'operador', 'activo'),
  ('f1000000-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111', 'consulta', 'activo'),
  ('f1000000-0000-0000-0000-000000000004', '11111111-1111-1111-1111-111111111111', 'operador', 'activo'),
  ('f2000000-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', 'administrador', 'activo');

insert into dominio.empresas (id, organizacion_id, nombre) values
  ('a1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'San Javucho'),
  ('a1000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'Segunda tienda'),
  ('a2000000-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', 'Empresa Dos');

insert into usuarios_empresas (user_id, empresa_id, organizacion_id, rol_id) values
  ('f1000000-0000-0000-0000-000000000002', 'a1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'operador'),
  ('f1000000-0000-0000-0000-000000000003', 'a1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'consulta'),
  ('f1000000-0000-0000-0000-000000000004', 'a1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'mostrador'),
  ('f1000000-0000-0000-0000-000000000004', 'a1000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'operador');

insert into clientes (id, organizacion_id, numero, nombre, tipo, archivado_en, descuento) values
  ('c5000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 10, 'Distribuidora Norte', 'mayorista', null, 5),
  ('c5000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 11, 'Cliente minorista', 'minorista', null, null),
  ('c5000000-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111', 12, 'Cliente minorista 5', 'minorista', null, 5);

-- Las categorías nacen en 21 % (F-PRE-12). P1 ARS 1.000 con x5 = 900, x10 = 800, x50 = 700 (sin IVA, precios fijos);
-- P2 ARS 500 con IVA propio 10,5 % (override); P3 «A pedido»; P4 de la org 2; P5 inactivo.
insert into dominio.categorias (id, organizacion_id, nombre) values
  ('c1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'Joysticks'),
  ('c2000000-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', 'Ajena');

insert into dominio.productos (id, organizacion_id, nombre, sku, moneda, precio_lista, categoria_id, disponibilidad_manual, activo) values
  ('b1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'Joystick', 'JOY-1', 'ARS', 1000, 'c1000000-0000-0000-0000-000000000001', null, true),
  ('b1000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'Cable', 'CAB-1', 'ARS', 500, 'c1000000-0000-0000-0000-000000000001', null, true),
  ('b1000000-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111', 'Consola bajo pedido', 'CON-1', 'ARS', 2000, 'c1000000-0000-0000-0000-000000000001', 'a_pedido', true),
  ('b2000000-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', 'Teclado ajeno', 'TEC-1', 'ARS', 500, 'c2000000-0000-0000-0000-000000000001', null, true),
  ('b1000000-0000-0000-0000-000000000005', '11111111-1111-1111-1111-111111111111', 'Producto inactivo', 'INA-1', 'ARS', 100, 'c1000000-0000-0000-0000-000000000001', null, false);

insert into dominio.producto_precios_escala (producto_id, organizacion_id, escala, precio) values
  ('b1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'x5', 900),
  ('b1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'x10', 800),
  ('b1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'x50', 700);

update dominio.productos
   set alicuota_iva_id = (select a.id from dominio.alicuotas_iva a
                           where a.organizacion_id = '11111111-1111-1111-1111-111111111111' and a.porcentaje = 10.5 and not a.exento)
 where id = 'b1000000-0000-0000-0000-000000000002';

-- Depósitos: el principal lo siembra la organización; se suma «Local».
insert into dominio.depositos (id, organizacion_id, nombre) values
  ('d1000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'Local');

create temp table datos as
  select
    (select id from dominio.depositos where organizacion_id = '11111111-1111-1111-1111-111111111111' and por_defecto) as principal,
    (select id from dominio.depositos where organizacion_id = '22222222-2222-2222-2222-222222222222' and por_defecto) as ajeno;
grant select on datos to public;

-- «Venden desde acá»: el principal y Local venden para San Javucho; «Otro» solo para la segunda tienda.
insert into dominio.depositos (id, organizacion_id, nombre) values
  ('d1000000-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111', 'Otro');
insert into dominio.depositos_empresas (deposito_id, empresa_id, organizacion_id)
select d, 'a1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111'
  from (select principal as d from datos union all select 'd1000000-0000-0000-0000-000000000002'::uuid) x
on conflict do nothing;
insert into dominio.depositos_empresas (deposito_id, empresa_id, organizacion_id) values
  ('d1000000-0000-0000-0000-000000000003', 'a1000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111')
on conflict do nothing;

-- Existencias: Joystick 10 en el principal con 3 reservadas; 4 en Local.
insert into dominio.existencias (producto_id, organizacion_id, cantidad, reservado) values
  ('b1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 14, 3)
on conflict (producto_id) do update set cantidad = excluded.cantidad, reservado = excluded.reservado;
insert into dominio.existencias_deposito (producto_id, deposito_id, organizacion_id, cantidad, reservado) values
  ('b1000000-0000-0000-0000-000000000001', (select principal from datos), '11111111-1111-1111-1111-111111111111', 10, 3),
  ('b1000000-0000-0000-0000-000000000001', 'd1000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 4, 0)
on conflict (producto_id, deposito_id) do update set cantidad = excluded.cantidad, reservado = excluded.reservado;

create function pg_temp.como(p_user uuid) returns void language plpgsql as $$
begin
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
  set local role authenticated;
end $$;

create temp table comps (clave text primary key, id uuid, actualizado timestamptz);
grant select, insert, update on comps to public;

-- Guarda una sola línea del Joystick con la cantidad dada y devuelve «escala:precio» (releyendo el token vigente).
create function pg_temp.escala_de(p_clave text, p_cantidad int) returns text language plpgsql as $$
declare v_escala text;
begin
  perform public.guardar_lineas_comprobante(
    (select id from comps where clave = p_clave),
    jsonb_build_array(jsonb_build_object('producto_id', 'b1000000-0000-0000-0000-000000000001', 'cantidad', p_cantidad)),
    (select c.updated_at from dominio.comprobantes_venta c where c.id = (select id from comps where clave = p_clave))
  );
  select l.escala || ':' || l.precio_unitario::text into v_escala
    from dominio.comprobantes_venta_lineas l where l.comprobante_id = (select id from comps where clave = p_clave);
  return v_escala;
end $$;

select pg_temp.como('f1000000-0000-0000-0000-000000000002');
insert into comps (clave, id, actualizado)
select 'mayorista5', c.id, c.updated_at from public.crear_comprobante('factura', 'a1000000-0000-0000-0000-000000000001',
  'c5000000-0000-0000-0000-000000000001', 'mostrador', '2026-10-28') c;
insert into comps (clave, id, actualizado)
select 'minorista0', c.id, c.updated_at from public.crear_comprobante('factura', 'a1000000-0000-0000-0000-000000000001',
  'c5000000-0000-0000-0000-000000000002', 'mostrador', '2026-10-28') c;
insert into comps (clave, id, actualizado)
select 'minorista5', c.id, c.updated_at from public.crear_comprobante('factura', 'a1000000-0000-0000-0000-000000000001',
  'c5000000-0000-0000-0000-000000000003', 'mostrador', '2026-10-28') c;

create function pg_temp.guardar(p_clave text, p_lineas jsonb) returns void language plpgsql as $$
begin
  perform public.guardar_lineas_comprobante(
    (select id from comps where clave = p_clave), p_lineas,
    (select c.updated_at from dominio.comprobantes_venta c where c.id = (select id from comps where clave = p_clave)));
end $$;
create function pg_temp.precio(p_clave text) returns text language sql as $$
  select l.precio_unitario::text || '|' || l.descuento_pct::text || '|' || l.escala
    from dominio.comprobantes_venta_lineas l where l.comprobante_id = (select id from comps where clave = p_clave);
$$;

-- Esquema y privilegios
select is((select data_type from information_schema.columns where table_schema = 'public' and table_name = 'clientes' and column_name = 'descuento'),
  'numeric', 'clientes.descuento existe (public, columna aditiva)');
select is(has_column_privilege('anon', 'public.clientes', 'descuento', 'select')
  or has_column_privilege('anon', 'public.clientes', 'descuento', 'update'), false, 'anon no ve ni edita el descuento');
select is(has_column_privilege('authenticated', 'public.clientes', 'descuento', 'insert'), false,
  'el descuento no se concede en INSERT: un cliente nace sin descuento');
select is((select relrowsecurity from pg_class where oid = 'public.clientes'::regclass), true, 'RLS vigente en clientes');

-- Cálculo: mayorista con 5 %, cantidad 10 (x10 = 800) => 760; minorista con 5 % (x1 = 1000) => 950
select lives_ok($$select pg_temp.guardar('mayorista5', '[{"producto_id":"b1000000-0000-0000-0000-000000000001","cantidad":10}]')$$, 'guarda la línea del cliente con descuento');
select is(pg_temp.precio('mayorista5'), '760.00|5.00|x10', 'cliente 5 % ⇒ escala x10 (800) − 5 % = 760');
select pg_temp.guardar('minorista5', '[{"producto_id":"b1000000-0000-0000-0000-000000000001","cantidad":1}]');
select is(pg_temp.precio('minorista5'), '950.00|5.00|x1', 'minorista 5 % ⇒ lista (1000) − 5 % = 950');
select pg_temp.guardar('minorista0', '[{"producto_id":"b1000000-0000-0000-0000-000000000001","cantidad":1}]');
select is(pg_temp.precio('minorista0'), '1000.00|0.00|x1', 'cliente sin descuento: el precio no cambia');
select is((select c.total_sin_iva::text from dominio.comprobantes_venta c where c.id = (select id from comps where clave = 'mayorista5')),
  '7600.00', 'el total del comprobante usa el precio con descuento (antes del IVA)');
select is((select (l.iva)::text from dominio.comprobantes_venta_lineas l where l.comprobante_id = (select id from comps where clave = 'mayorista5')),
  '1596.00', 'el IVA (21 %) se calcula sobre el neto ya descontado');

-- Precio manual: no se pisa (el operador tiene editar_precio)
select pg_temp.guardar('mayorista5', '[{"producto_id":"b1000000-0000-0000-0000-000000000001","cantidad":10,"precio_manual":900}]');
select is(pg_temp.precio('mayorista5'), '900.00|0.00|x10', 'el precio manual no se altera ni se descuenta');

-- El payload no impone el descuento: una clave «descuento» se ignora
select pg_temp.guardar('minorista0', '[{"producto_id":"b1000000-0000-0000-0000-000000000001","cantidad":1,"descuento":50,"descuento_pct":50}]');
select is(pg_temp.precio('minorista0'), '1000.00|0.00|x1', 'el descuento nunca viene del payload');

-- obtener_comprobante expone descuento_pct
select pg_temp.guardar('minorista5', '[{"producto_id":"b1000000-0000-0000-0000-000000000001","cantidad":1}]');
select is((public.obtener_comprobante((select id from comps where clave = 'minorista5')) -> 'lineas' -> 0 ->> 'descuento_pct')::numeric, 5::numeric,
  'obtener_comprobante devuelve el descuento aplicado por línea');

-- Edición del descuento: rango y rol
select pg_temp.como('f1000000-0000-0000-0000-000000000001');
select throws_ok($$update public.clientes set descuento = 101 where id = 'c5000000-0000-0000-0000-000000000002'$$, '23514', null, 'descuento > 100 rechazado');
select throws_ok($$update public.clientes set descuento = -1 where id = 'c5000000-0000-0000-0000-000000000002'$$, '23514', null, 'descuento negativo rechazado');
select lives_ok($$update public.clientes set descuento = 7.5 where id = 'c5000000-0000-0000-0000-000000000002'$$, 'el Administrador fija el descuento');
select is((select count(*)::int from public.registro_actividad where tipo = 'cliente.descuento_editado'), 1, 'cambiar el descuento registra cliente.descuento_editado');
select pg_temp.como('f1000000-0000-0000-0000-000000000002');
select throws_ok($$update public.clientes set descuento = 30 where id = 'c5000000-0000-0000-0000-000000000002'$$, '42501', null, 'quien no es Administrador no cambia el descuento');
select lives_ok($$update public.clientes set telefono = '123' where id = 'c5000000-0000-0000-0000-000000000002'$$, 'editar otros campos sigue permitido sin ser Administrador');
select is((select descuento::text from public.clientes where id = 'c5000000-0000-0000-0000-000000000002'), '7.50', 'el descuento quedó como lo fijó el Administrador');

-- Aislamiento: el Administrador de otra organización no ve ni toca el cliente
select pg_temp.como('f2000000-0000-0000-0000-000000000001');
select is((select count(*)::int from public.clientes where id = 'c5000000-0000-0000-0000-000000000002'), 0, 'otra organización no ve el cliente');
select throws_ok(
  format($$select public.guardar_lineas_comprobante(%L, '[]'::jsonb, now())$$, (select id from comps where clave = 'minorista5')),
  'P0002', null, 'otra organización no opera el comprobante');

-- anon
select pg_temp.como('f1000000-0000-0000-0000-000000000001');
reset role;
set local role anon;
select throws_ok($$select public.guardar_lineas_comprobante(gen_random_uuid(), '[]'::jsonb, now())$$, '42501', null, 'anon no ejecuta guardar_lineas_comprobante');

select * from finish();
rollback;
