-- MSF-176 · Tienda compra y cuentas, historia B2 «Presupuesto desde la tienda», T056. FR-050 a FR-060, FR-014; D-9, D-17, D-23, D-28;
-- amenazas 2.1 a 2.12; escenarios B2-1 a B2-11; SC-003, SC-004, SC-005.
-- ADVERSARIAL, con dos organizaciones, tres tiendas (dos de la organización 1 y una de la 2), una tienda pausada y varios clientes:
--   (a) IDOR: el cliente A no crea ni lee para el cliente B aunque mande `cliente_id` en el jsonb;
--   (b) `sin_acceso` IDÉNTICO para anónimo, usuario de panel (propia y de otra organización), usuario sin cuenta, cuenta suspendida (al instante), no habilitada,
--       cuenta de OTRA tienda con el host de ésta, host desconocido, tienda pausada y de otra organización;
--   (c) claves ajenas ignoradas (precio, escala, descuento, deposito_id, estado, canal, empresa_id, cliente_id, fecha…): no cambian el resultado;
--   (d) PARIDAD con el panel (SC-003): las mismas líneas armadas con `crear_comprobante` + `guardar_lineas_comprobante` dan los mismos importes y TODAS las columnas
--       (mayorista con escala x10 y descuento, precio propio, promoción que gana y que no, alícuotas 21 %, 10,5 % y exenta);
--   (e) `sin_precio` no consume número ni crea nada; (f) CERO efectos de stock, reservas, cobros y contrarreembolsos, estado `pendiente`;
--   (g) topes: sexto del día, 11 abiertos, 51 líneas, cantidad 10.000, jsonb hostil, cupo de llamadas por cuenta; el lock por cuenta se toma (la concurrencia real
--       con dos sesiones simultáneas la prueba el E2E `tienda-presupuesto`);
--   (h) idempotencia (misma clave = mismo número, un solo comprobante, un solo cupo gastado); (i) un error provocado a mitad deja el contador de numeración sin cambio;
--   (j) `anon` sin `execute`; (k) `anon` y `authenticated` sin escritura sobre las tablas; (l) ninguna respuesta con texto de Postgres; (m) bandera apagada = `sin_acceso`
--   sin tocar datos; (n) el evento de actividad (actor nulo, número y cliente, sin correo ni teléfono).
begin;

select plan(182);

-- ============================================================================
-- Fixture
-- ============================================================================
insert into organizaciones (id, nombre) values
  ('11111111-1111-1111-1111-111111111111', 'Organización Uno'),
  ('22222222-2222-2222-2222-222222222222', 'Organización Dos');

insert into auth.users (id, email) values
  ('f3000000-0000-0000-0000-000000000001', 'mayorista@example.com'),
  ('f3000000-0000-0000-0000-000000000002', 'minorista@example.com'),
  ('f3000000-0000-0000-0000-000000000003', 'suspendida@example.com'),
  ('f3000000-0000-0000-0000-000000000004', 'nohabilitada@example.com'),
  ('f3000000-0000-0000-0000-000000000005', 'sin-cuenta@example.com'),
  ('f3000000-0000-0000-0000-000000000006', 'cuenta-b@example.com'),
  ('f3000000-0000-0000-0000-000000000007', 'panel-uno@example.com'),
  ('f3000000-0000-0000-0000-000000000008', 'panel-dos@example.com'),
  ('f3000000-0000-0000-0000-000000000009', 'cuenta-x@example.com'),
  ('f3000000-0000-0000-0000-00000000000a', 'topes@example.com'),
  ('f3000000-0000-0000-0000-00000000000b', 'concurrente@example.com');
insert into usuarios_organizacion (user_id, organizacion_id, rol_id, estado) values
  ('f3000000-0000-0000-0000-000000000007', '11111111-1111-1111-1111-111111111111', 'administrador', 'activo'),
  ('f3000000-0000-0000-0000-000000000008', '22222222-2222-2222-2222-222222222222', 'administrador', 'activo');

insert into dominio.empresas (id, organizacion_id, nombre, activa) values
  ('e1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'Tienda A', true),
  ('e1000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'Tienda B', true),
  ('e1000000-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111', 'Tienda pausada', false),
  ('e2000000-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', 'Tienda X', true);
insert into dominio.tiendas (organizacion_id, empresa_id, dominio) values
  ('11111111-1111-1111-1111-111111111111', 'e1000000-0000-0000-0000-000000000001', 'pres-a.ejemplo.com'),
  ('11111111-1111-1111-1111-111111111111', 'e1000000-0000-0000-0000-000000000002', 'pres-b.ejemplo.com'),
  ('11111111-1111-1111-1111-111111111111', 'e1000000-0000-0000-0000-000000000003', 'pres-pausada.ejemplo.com'),
  ('22222222-2222-2222-2222-222222222222', 'e2000000-0000-0000-0000-000000000001', 'pres-x.ejemplo.com');
-- El depósito por defecto de cada organización (lo siembra el alta de la organización) vende para las tiendas A y B y X; la pausada no lo necesita.
insert into dominio.depositos_empresas (deposito_id, empresa_id, organizacion_id)
select d.id, e.id, e.organizacion_id
  from dominio.depositos d join dominio.empresas e on e.organizacion_id = d.organizacion_id
 where d.por_defecto and e.id in ('e1000000-0000-0000-0000-000000000001', 'e1000000-0000-0000-0000-000000000002', 'e2000000-0000-0000-0000-000000000001')
on conflict do nothing;

-- Regla de precio de la tienda A: +5 % con redondeo a 10 (la B no tiene regla). Dólar solo en la organización 2 (la 1 queda SIN cotización).
insert into dominio.precios_empresa (empresa_id, organizacion_id, base, ajuste_pct, redondeo_pesos, mostrar_con_iva) values
  ('e1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'central_ajuste', 5, 10, false);
insert into dominio.cotizacion_inicial (organizacion_id, valor) values ('22222222-2222-2222-2222-222222222222', 1000);

insert into dominio.categorias (id, organizacion_id, nombre) values
  ('c1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'Con IVA 21');
insert into dominio.alicuotas_iva (id, organizacion_id, nombre, porcentaje, exento) values
  ('a1000000-0000-0000-0000-0000000000a5', '11111111-1111-1111-1111-111111111111', 'IVA 10,5 % de prueba', 10.5, false);

-- 1 Alfa (lista 1000; escalas x5 900, x10 800, x50 700; 21 % por categoría) · 2 Beta (2000) · 3 oculto en A · 4 inactivo · 5 de otra organización ·
-- 6 solo en B · 7 en dólares SIN cotización (sin precio) · 8 con promoción menor que la escala (3000; x10 2000; promoción 2400) ·
-- 9 con promoción que gana (5000; x10 4500; promoción 3000) · 10 con precio propio en A (950) · 11 exento (880) · 12 con alícuota 10,5 % (333,33) ·
-- 13 con promoción IGUAL al precio normal (se ignora).
insert into dominio.productos (id, organizacion_id, nombre, sku, precio_lista, moneda, activo, categoria_id) values
  ('a1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'Alfa', 'SKU-ALFA', 1000, 'ARS', true, 'c1000000-0000-0000-0000-000000000001'),
  ('a1000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'Beta', 'SKU-BETA', 2000, 'ARS', true, 'c1000000-0000-0000-0000-000000000001'),
  ('a1000000-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111', 'Oculto en A', 'SKU-OCU', 500, 'ARS', true, null),
  ('a1000000-0000-0000-0000-000000000004', '11111111-1111-1111-1111-111111111111', 'Inactivo', 'SKU-INA', 500, 'ARS', false, null),
  ('a1000000-0000-0000-0000-000000000006', '11111111-1111-1111-1111-111111111111', 'Solo en B', 'SKU-SOB', 500, 'ARS', true, null),
  ('a1000000-0000-0000-0000-000000000007', '11111111-1111-1111-1111-111111111111', 'En dólares sin cotización', 'SKU-USD', 5, 'USD', true, null),
  ('a1000000-0000-0000-0000-000000000008', '11111111-1111-1111-1111-111111111111', 'Promo menor que la escala', 'SKU-PRO8', 3000, 'ARS', true, 'c1000000-0000-0000-0000-000000000001'),
  ('a1000000-0000-0000-0000-000000000009', '11111111-1111-1111-1111-111111111111', 'Promo que gana', 'SKU-PRO9', 5000, 'ARS', true, 'c1000000-0000-0000-0000-000000000001'),
  ('a1000000-0000-0000-0000-000000000010', '11111111-1111-1111-1111-111111111111', 'Con precio propio', 'SKU-PRO10', 700, 'ARS', true, 'c1000000-0000-0000-0000-000000000001'),
  ('a1000000-0000-0000-0000-000000000011', '11111111-1111-1111-1111-111111111111', 'Exento', 'SKU-EXE', 880, 'ARS', true, null),
  ('a1000000-0000-0000-0000-000000000012', '11111111-1111-1111-1111-111111111111', 'Diez y medio', 'SKU-D105', 333.33, 'ARS', true, null),
  ('a1000000-0000-0000-0000-000000000013', '11111111-1111-1111-1111-111111111111', 'Promo igual al normal', 'SKU-PRO13', 1000, 'ARS', true, 'c1000000-0000-0000-0000-000000000001'),
  ('a2000000-0000-0000-0000-000000000005', '22222222-2222-2222-2222-222222222222', 'Otra organización', 'SKU-OTR', 500, 'ARS', true, null);
update dominio.productos set alicuota_iva_id = (select a.id from dominio.alicuotas_iva a where a.organizacion_id = '11111111-1111-1111-1111-111111111111' and a.nombre = 'Exento')
 where id = 'a1000000-0000-0000-0000-000000000011';
update dominio.productos set alicuota_iva_id = 'a1000000-0000-0000-0000-0000000000a5' where id = 'a1000000-0000-0000-0000-000000000012';
insert into dominio.productos (id, organizacion_id, nombre, sku, precio_lista, moneda, activo)
select ('b1000000-0000-0000-0000-' || lpad(n::text, 12, '0'))::uuid, '11111111-1111-1111-1111-111111111111', 'Masivo ' || n, 'MAS-' || n, 100 + n, 'ARS', true
  from generate_series(1, 60) n;
insert into dominio.producto_empresa (producto_id, empresa_id, organizacion_id)
select p.id, 'e1000000-0000-0000-0000-000000000001', p.organizacion_id
  from dominio.productos p
 where p.organizacion_id = '11111111-1111-1111-1111-111111111111' and p.id <> 'a1000000-0000-0000-0000-000000000006';
insert into dominio.producto_empresa (producto_id, empresa_id, organizacion_id) values
  ('a1000000-0000-0000-0000-000000000001', 'e1000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111'),
  ('a1000000-0000-0000-0000-000000000006', 'e1000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111'),
  ('a2000000-0000-0000-0000-000000000005', 'e2000000-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222');
insert into dominio.productos_tienda (empresa_id, producto_id, organizacion_id, visible, destacado) values
  ('e1000000-0000-0000-0000-000000000001', 'a1000000-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111', false, false);
insert into dominio.producto_precios_escala (producto_id, organizacion_id, escala, precio) values
  ('a1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'x5', 900),
  ('a1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'x10', 800),
  ('a1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'x50', 700),
  ('a1000000-0000-0000-0000-000000000008', '11111111-1111-1111-1111-111111111111', 'x10', 2000),
  ('a1000000-0000-0000-0000-000000000009', '11111111-1111-1111-1111-111111111111', 'x10', 4500);
insert into dominio.precios_propios_empresa (producto_id, empresa_id, organizacion_id, moneda, importe) values
  ('a1000000-0000-0000-0000-000000000010', 'e1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'ARS', 950);
update public.banderas_plataforma set activa = true where clave = 'promociones_precio';
insert into dominio.promociones_precio (organizacion_id, empresa_id, producto_id, precio_promocional, desde, hasta) values
  ('11111111-1111-1111-1111-111111111111', 'e1000000-0000-0000-0000-000000000001', 'a1000000-0000-0000-0000-000000000008', 2400, now() - interval '1 day', now() + interval '1 day'),
  ('11111111-1111-1111-1111-111111111111', 'e1000000-0000-0000-0000-000000000001', 'a1000000-0000-0000-0000-000000000009', 3000, now() - interval '1 day', now() + interval '1 day'),
  ('11111111-1111-1111-1111-111111111111', 'e1000000-0000-0000-0000-000000000001', 'a1000000-0000-0000-0000-000000000013', 1050, now() - interval '1 day', now() + interval '1 day');
insert into dominio.existencias (producto_id, organizacion_id, cantidad)
select p.id, p.organizacion_id, 7 from dominio.productos p on conflict (producto_id) do update set cantidad = excluded.cantidad;

-- Clientes: 1 mayorista con descuento 12,5 % · 2 minorista · 3 suspendida · 4 no habilitada en A (solo en B) · 6 con cuenta en B · 7 de la organización 2 con cuenta en X ·
-- 9 y 10: cuentas para los topes y la concurrencia (mayoristas).
insert into clientes (id, organizacion_id, numero, nombre, correo, tipo, descuento) values
  ('c1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 910, 'Mayorista Cuenta', 'my@example.com', 'mayorista', 12.5),
  ('c1000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 911, 'Minorista Cuenta', 'mn@example.com', 'minorista', 0),
  ('c1000000-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111', 912, 'Suspendida', 'su@example.com', 'mayorista', 0),
  ('c1000000-0000-0000-0000-000000000004', '11111111-1111-1111-1111-111111111111', 913, 'No habilitada', 'nh@example.com', 'mayorista', 0),
  ('c1000000-0000-0000-0000-000000000006', '11111111-1111-1111-1111-111111111111', 915, 'Cuenta en B', 'cb@example.com', 'mayorista', 0),
  ('c2000000-0000-0000-0000-000000000007', '22222222-2222-2222-2222-222222222222', 916, 'Cuenta en X', 'cx@example.com', 'mayorista', 0),
  ('c1000000-0000-0000-0000-000000000009', '11111111-1111-1111-1111-111111111111', 918, 'Topes', 'tp@example.com', 'minorista', 0),
  ('c1000000-0000-0000-0000-000000000010', '11111111-1111-1111-1111-111111111111', 919, 'Concurrente', 'cc@example.com', 'minorista', 0);
insert into clientes_empresas (cliente_id, empresa_id, organizacion_id) values
  ('c1000000-0000-0000-0000-000000000001', 'e1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111'),
  ('c1000000-0000-0000-0000-000000000002', 'e1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111'),
  ('c1000000-0000-0000-0000-000000000003', 'e1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111'),
  ('c1000000-0000-0000-0000-000000000004', 'e1000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111'),
  ('c1000000-0000-0000-0000-000000000006', 'e1000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111'),
  ('c2000000-0000-0000-0000-000000000007', 'e2000000-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222'),
  ('c1000000-0000-0000-0000-000000000009', 'e1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111'),
  ('c1000000-0000-0000-0000-000000000010', 'e1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111');
insert into cuentas_cliente (id, organizacion_id, cliente_id, empresa_id, auth_user_id, estado) values
  ('ca000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'c1000000-0000-0000-0000-000000000001', 'e1000000-0000-0000-0000-000000000001', 'f3000000-0000-0000-0000-000000000001', 'activa'),
  ('ca000000-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111', 'c1000000-0000-0000-0000-000000000002', 'e1000000-0000-0000-0000-000000000001', 'f3000000-0000-0000-0000-000000000002', 'activa'),
  ('ca000000-0000-0000-0000-000000000004', '11111111-1111-1111-1111-111111111111', 'c1000000-0000-0000-0000-000000000003', 'e1000000-0000-0000-0000-000000000001', 'f3000000-0000-0000-0000-000000000003', 'suspendida'),
  ('ca000000-0000-0000-0000-000000000005', '11111111-1111-1111-1111-111111111111', 'c1000000-0000-0000-0000-000000000004', 'e1000000-0000-0000-0000-000000000001', 'f3000000-0000-0000-0000-000000000004', 'activa'),
  ('ca000000-0000-0000-0000-000000000006', '11111111-1111-1111-1111-111111111111', 'c1000000-0000-0000-0000-000000000006', 'e1000000-0000-0000-0000-000000000002', 'f3000000-0000-0000-0000-000000000006', 'activa'),
  ('ca000000-0000-0000-0000-000000000007', '22222222-2222-2222-2222-222222222222', 'c2000000-0000-0000-0000-000000000007', 'e2000000-0000-0000-0000-000000000001', 'f3000000-0000-0000-0000-000000000009', 'activa'),
  ('ca000000-0000-0000-0000-000000000009', '11111111-1111-1111-1111-111111111111', 'c1000000-0000-0000-0000-000000000009', 'e1000000-0000-0000-0000-000000000001', 'f3000000-0000-0000-0000-00000000000a', 'activa'),
  ('ca000000-0000-0000-0000-000000000010', '11111111-1111-1111-1111-111111111111', 'c1000000-0000-0000-0000-000000000010', 'e1000000-0000-0000-0000-000000000001', 'f3000000-0000-0000-0000-00000000000b', 'activa');

update public.banderas_plataforma set activa = true where clave = 'tienda_pedidos';

-- Una sesión de cuenta (o de panel) con SU visitante (IP distinta por caso: el cupo por hora de la tienda es por hash de IP y empresa).
create function pg_temp.como(p_user uuid, p_ip text default '10.9.0.1') returns void language plpgsql as $$
begin
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
  perform set_config('request.headers', json_build_object('x-forwarded-for', p_ip)::text, true);
  set local role authenticated;
end $$;
create function pg_temp.anonimo(p_ip text default '10.9.0.2') returns void language plpgsql as $$
begin
  reset role;
  perform set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);
  perform set_config('request.headers', json_build_object('x-forwarded-for', p_ip)::text, true);
  set local role anon;
end $$;

create temp table res (k text primary key, v jsonb);
grant all on res to public;
create function pg_temp.items(variadic p text[]) returns jsonb language sql as $$
  select jsonb_agg(jsonb_build_object('producto_id', t[1], 'cantidad', t[2]::int))
    from (select array[p[i], p[i + 1]] as t from generate_series(1, array_length(p, 1), 2) i) x
$$;
create function pg_temp.fila(p_clave text) returns jsonb language sql as $$ select v from res where k = p_clave $$;
create function pg_temp.contar() returns jsonb language sql as $$
  select jsonb_build_object(
    'comprobantes', (select count(*) from dominio.comprobantes_venta),
    'lineas', (select count(*) from dominio.comprobantes_venta_lineas),
    'vinculos', (select count(*) from dominio.presupuestos_tienda),
    'numeracion', (select coalesce(sum(ultimo), 0) from dominio.comprobantes_venta_numeracion),
    'envios', (select count(*) from dominio.tienda_envios),
    'actividad', (select count(*) from public.registro_actividad where tipo = 'presupuesto.creado_desde_tienda'))
$$;
grant execute on function pg_temp.items(text[]) to public;

-- ============================================================================
-- (j) y (k) Privilegios y estructura
-- ============================================================================
select is(has_function_privilege('anon', 'publico.cotizar_presupuesto_tienda(text, jsonb)', 'execute'), false, '(j) anon NO ejecuta cotizar_presupuesto_tienda');
select is(has_function_privilege('anon', 'publico.crear_presupuesto_tienda(text, jsonb, text, uuid)', 'execute'), false, '(j) anon NO ejecuta crear_presupuesto_tienda');
select is(has_function_privilege('authenticated', 'publico.cotizar_presupuesto_tienda(text, jsonb)', 'execute'), true, '(j) authenticated ejecuta cotizar_presupuesto_tienda');
select is(has_function_privilege('authenticated', 'publico.crear_presupuesto_tienda(text, jsonb, text, uuid)', 'execute'), true, '(j) authenticated ejecuta crear_presupuesto_tienda');
select is(has_function_privilege('service_role', 'publico.crear_presupuesto_tienda(text, jsonb, text, uuid)', 'execute'), false, '(j) service_role no ejecuta crear_presupuesto_tienda');
select is((select count(*)::int from pg_proc p, aclexplode(p.proacl) a
            where p.oid in ('publico.cotizar_presupuesto_tienda(text, jsonb)'::regprocedure, 'publico.crear_presupuesto_tienda(text, jsonb, text, uuid)'::regprocedure)
              and a.privilege_type = 'EXECUTE' and a.grantee = 0), 0, '(j) PUBLIC (grantee 0) no ejecuta ninguna de las dos');
select is((select count(*)::int from pg_proc p
            where p.oid in ('publico.cotizar_presupuesto_tienda(text, jsonb)'::regprocedure, 'publico.crear_presupuesto_tienda(text, jsonb, text, uuid)'::regprocedure)
              and p.prosecdef and array_to_string(p.proconfig, ',') = 'search_path=""'), 2, '(j) las dos son security definer con search_path vacío');
select is((select count(*)::int from pg_proc p
            where p.oid in ('publico.cotizar_presupuesto_tienda(text, jsonb)'::regprocedure, 'publico.crear_presupuesto_tienda(text, jsonb, text, uuid)'::regprocedure,
                            'private.motor_presupuesto_tienda(uuid, jsonb)'::regprocedure, 'private.siguiente_numero_comprobante_org(uuid, uuid, text)'::regprocedure)
              and p.prosrc ~* '\mexecute\M'), 0, '(j) ninguna usa SQL dinámico');
select is((select count(*)::int from pg_proc p
            where p.oid in ('private.motor_presupuesto_tienda(uuid, jsonb)'::regprocedure, 'private.siguiente_numero_comprobante_org(uuid, uuid, text)'::regprocedure)
              and (has_function_privilege('anon', p.oid, 'execute') or has_function_privilege('authenticated', p.oid, 'execute')
                   or has_function_privilege('service_role', p.oid, 'execute'))), 0, '(j) el motor y la numeración con organización explícita no tienen execute de API');
select is((select count(*)::int from pg_proc p
            where p.pronamespace = 'publico'::regnamespace and p.proname in ('cotizar_presupuesto_tienda', 'crear_presupuesto_tienda')
              and has_function_privilege('anon', p.oid, 'execute')), 0, '(j) la lista de anon no crece: ninguna función de presupuesto es ejecutable por anon');
select is(has_table_privilege('anon', 'dominio.presupuestos_tienda', 'select'), false, '(k) anon no lee presupuestos_tienda');
select is(has_table_privilege('anon', 'dominio.presupuestos_tienda', 'insert'), false, '(k) anon no escribe presupuestos_tienda');
select is(has_table_privilege('authenticated', 'dominio.presupuestos_tienda', 'select'), true, '(k) authenticated lee presupuestos_tienda (con RLS)');
select is((select count(*)::int from unnest(array['insert', 'update', 'delete', 'truncate']) a where has_table_privilege('authenticated', 'dominio.presupuestos_tienda', a)), 0,
  '(k) authenticated no tiene insert, update, delete ni truncate sobre presupuestos_tienda');
select is((select c.relrowsecurity from pg_class c where c.oid = 'dominio.presupuestos_tienda'::regclass), true, 'presupuestos_tienda tiene RLS');
select is((select n.nspname::text from pg_class c join pg_namespace n on n.oid = c.relnamespace where c.oid = 'dominio.presupuestos_tienda'::regclass), 'dominio',
  'presupuestos_tienda vive en dominio (Principio VII)');
select is((select count(*)::int from pg_policies where schemaname = 'dominio' and tablename = 'presupuestos_tienda' and cmd <> 'SELECT'), 0, '(k) no hay políticas de escritura');
-- Escritura directa como authenticated sobre las tablas del presupuesto: sin privilegios.
select pg_temp.como('f3000000-0000-0000-0000-000000000007');
select throws_ok($$insert into dominio.presupuestos_tienda (organizacion_id, empresa_id, cuenta_cliente_id, cliente_id, comprobante_id, clave_envio)
  values ('11111111-1111-1111-1111-111111111111', 'e1000000-0000-0000-0000-000000000001', 'ca000000-0000-0000-0000-000000000001', 'c1000000-0000-0000-0000-000000000001', gen_random_uuid(), gen_random_uuid())$$,
  '42501', null, '(k) un usuario de panel no puede insertar en presupuestos_tienda');
select throws_ok($$select private.siguiente_numero_comprobante_org('11111111-1111-1111-1111-111111111111', 'e1000000-0000-0000-0000-000000000001', 'presupuesto')$$,
  '42501', null, '(k) authenticated no ejecuta la numeración con organización explícita');
select throws_ok($$select * from private.motor_presupuesto_tienda('ca000000-0000-0000-0000-000000000001', '[]'::jsonb)$$,
  '42501', null, '(k) authenticated no ejecuta el motor');
reset role;
select pg_temp.anonimo();
select throws_ok($$select publico.crear_presupuesto_tienda('pres-a.ejemplo.com', '[]'::jsonb, null, gen_random_uuid())$$,
  '42501', null, '(j) anon recibe permiso denegado al llamar crear_presupuesto_tienda');
select throws_ok($$select publico.cotizar_presupuesto_tienda('pres-a.ejemplo.com', '[]'::jsonb)$$,
  '42501', null, '(j) anon recibe permiso denegado al llamar cotizar_presupuesto_tienda');
reset role;

-- ============================================================================
-- (e)/(i) Numeración con la organización explícita
-- ============================================================================
select is(private.siguiente_numero_comprobante_org('11111111-1111-1111-1111-111111111111', 'e1000000-0000-0000-0000-000000000002', 'presupuesto'), 1, 'numeración: el primero es 1');
select is(private.siguiente_numero_comprobante_org('11111111-1111-1111-1111-111111111111', 'e1000000-0000-0000-0000-000000000002', 'presupuesto'), 2, 'numeración: correlativo, sin saltos');
select is(private.siguiente_numero_comprobante_org('11111111-1111-1111-1111-111111111111', 'e1000000-0000-0000-0000-000000000002', 'factura'), 1, 'numeración: cada tipo tiene su contador');
select throws_ok($$select private.siguiente_numero_comprobante_org('11111111-1111-1111-1111-111111111111', 'e2000000-0000-0000-0000-000000000001', 'presupuesto')$$,
  '22023', null, 'numeración: la empresa tiene que ser de la organización');
select throws_ok($$select private.siguiente_numero_comprobante_org('11111111-1111-1111-1111-111111111111', 'e1000000-0000-0000-0000-000000000002', 'otro')$$,
  '22023', null, 'numeración: tipo inválido');
select throws_ok($$select private.siguiente_numero_comprobante_org(null, 'e1000000-0000-0000-0000-000000000002', 'presupuesto')$$,
  '22023', null, 'numeración: sin organización no hay número');
-- Se devuelve el contador de B a cero para no mezclarlo con lo que sigue (la tienda B no se usa para crear).
delete from dominio.comprobantes_venta_numeracion where empresa_id = 'e1000000-0000-0000-0000-000000000002';

-- ============================================================================
-- (b) sin_acceso: idéntico en todos los casos, sin tocar datos
-- ============================================================================
create temp table antes as select pg_temp.contar() as c;
grant all on antes to public;
select pg_temp.como('f3000000-0000-0000-0000-000000000005', '10.1.0.1');   -- usuario sin cuenta
insert into res values ('sin_cuenta', publico.crear_presupuesto_tienda('pres-a.ejemplo.com', pg_temp.items('a1000000-0000-0000-0000-000000000001', '1'), null, 'c0000000-0000-0000-0000-000000000001'));
insert into res values ('sin_cuenta_cot', publico.cotizar_presupuesto_tienda('pres-a.ejemplo.com', pg_temp.items('a1000000-0000-0000-0000-000000000001', '1')));
select pg_temp.como('f3000000-0000-0000-0000-000000000007', '10.1.0.2');   -- panel de la organización 1
insert into res values ('panel_uno', publico.crear_presupuesto_tienda('pres-a.ejemplo.com', pg_temp.items('a1000000-0000-0000-0000-000000000001', '1'), null, 'c0000000-0000-0000-0000-000000000002'));
insert into res values ('panel_uno_cot', publico.cotizar_presupuesto_tienda('pres-a.ejemplo.com', pg_temp.items('a1000000-0000-0000-0000-000000000001', '1')));
select pg_temp.como('f3000000-0000-0000-0000-000000000008', '10.1.0.3');   -- panel de la organización 2
insert into res values ('panel_dos', publico.crear_presupuesto_tienda('pres-a.ejemplo.com', pg_temp.items('a1000000-0000-0000-0000-000000000001', '1'), null, 'c0000000-0000-0000-0000-000000000003'));
select pg_temp.como('f3000000-0000-0000-0000-000000000003', '10.1.0.4');   -- cuenta suspendida
insert into res values ('suspendida', publico.crear_presupuesto_tienda('pres-a.ejemplo.com', pg_temp.items('a1000000-0000-0000-0000-000000000001', '1'), null, 'c0000000-0000-0000-0000-000000000004'));
insert into res values ('suspendida_cot', publico.cotizar_presupuesto_tienda('pres-a.ejemplo.com', pg_temp.items('a1000000-0000-0000-0000-000000000001', '1')));
select pg_temp.como('f3000000-0000-0000-0000-000000000004', '10.1.0.5');   -- cuenta activa pero el cliente NO está habilitado en esta tienda
insert into res values ('no_habilitada', publico.crear_presupuesto_tienda('pres-a.ejemplo.com', pg_temp.items('a1000000-0000-0000-0000-000000000001', '1'), null, 'c0000000-0000-0000-0000-000000000005'));
select pg_temp.como('f3000000-0000-0000-0000-000000000006', '10.1.0.6');   -- cuenta de la tienda B con el host de la A
insert into res values ('otra_tienda', publico.crear_presupuesto_tienda('pres-a.ejemplo.com', pg_temp.items('a1000000-0000-0000-0000-000000000001', '1'), null, 'c0000000-0000-0000-0000-000000000006'));
insert into res values ('otra_tienda_cot', publico.cotizar_presupuesto_tienda('pres-a.ejemplo.com', pg_temp.items('a1000000-0000-0000-0000-000000000001', '1')));
select pg_temp.como('f3000000-0000-0000-0000-000000000009', '10.1.0.7');   -- cuenta de la organización 2 con el host de la organización 1
insert into res values ('otra_org', publico.crear_presupuesto_tienda('pres-a.ejemplo.com', pg_temp.items('a1000000-0000-0000-0000-000000000001', '1'), null, 'c0000000-0000-0000-0000-000000000007'));
select pg_temp.como('f3000000-0000-0000-0000-000000000001', '10.1.0.8');   -- cuenta buena con hosts que no sirven
insert into res values ('host_desconocido', publico.crear_presupuesto_tienda('no-existe.ejemplo.com', pg_temp.items('a1000000-0000-0000-0000-000000000001', '1'), null, 'c0000000-0000-0000-0000-000000000008'));
insert into res values ('host_pausada', publico.crear_presupuesto_tienda('pres-pausada.ejemplo.com', pg_temp.items('a1000000-0000-0000-0000-000000000001', '1'), null, 'c0000000-0000-0000-0000-000000000009'));
insert into res values ('host_otra_org', publico.crear_presupuesto_tienda('pres-x.ejemplo.com', pg_temp.items('a1000000-0000-0000-0000-000000000001', '1'), null, 'c0000000-0000-0000-0000-00000000000a'));
insert into res values ('host_nulo', publico.crear_presupuesto_tienda(null, pg_temp.items('a1000000-0000-0000-0000-000000000001', '1'), null, 'c0000000-0000-0000-0000-00000000000b'));
reset role;
-- Un uuid del cliente B (el minorista) NO se puede usar desde la cuenta del mayorista: se prueba más abajo (a). Acá, el anónimo no puede ni llamar (j).
select is((select count(*)::int from res where v = '{"estado":"sin_acceso"}'::jsonb), 15,
  '(b) sin_acceso IDÉNTICO en los 15 casos (13 llamadas a crear y a cotizar): sin cuenta, panel (dos organizaciones), suspendida, no habilitada, cuenta de otra tienda y de otra organización, host desconocido, pausada, de otra organización y nulo');
select is((select pg_temp.contar() from (select 1) x), (select c from antes), '(b) los casos sin acceso no crearon ni consumieron nada (comprobantes, líneas, vínculos, numeración, envíos, actividad)');
-- La suspensión rige AL INSTANTE (FR-011): la misma cuenta activa, suspendida y vuelta a llamar.
select pg_temp.como('f3000000-0000-0000-0000-000000000001', '10.1.0.9');
insert into res values ('antes_suspender', publico.cotizar_presupuesto_tienda('pres-a.ejemplo.com', pg_temp.items('a1000000-0000-0000-0000-000000000002', '1')));
reset role;
update public.cuentas_cliente set estado = 'suspendida' where id = 'ca000000-0000-0000-0000-000000000001';
select pg_temp.como('f3000000-0000-0000-0000-000000000001', '10.1.0.9');
insert into res values ('despues_suspender', publico.cotizar_presupuesto_tienda('pres-a.ejemplo.com', pg_temp.items('a1000000-0000-0000-0000-000000000002', '1')));
insert into res values ('despues_suspender_crear', publico.crear_presupuesto_tienda('pres-a.ejemplo.com', pg_temp.items('a1000000-0000-0000-0000-000000000002', '1'), null, 'c0000000-0000-0000-0000-00000000000c'));
reset role;
update public.cuentas_cliente set estado = 'activa' where id = 'ca000000-0000-0000-0000-000000000001';
select is(pg_temp.fila('antes_suspender') ->> 'estado', 'ok', '(b) la cuenta activa cotiza');
select is(pg_temp.fila('despues_suspender'), '{"estado":"sin_acceso"}'::jsonb, '(b) suspendida a mitad de la sesión: cotizar responde sin_acceso AL INSTANTE');
select is(pg_temp.fila('despues_suspender_crear'), '{"estado":"sin_acceso"}'::jsonb, '(b) suspendida a mitad de la sesión: crear responde sin_acceso AL INSTANTE');
-- Un cliente archivado y la baja de «Habilitado en» también cortan al instante.
update public.clientes set archivado_en = now() where id = 'c1000000-0000-0000-0000-000000000001';
select pg_temp.como('f3000000-0000-0000-0000-000000000001', '10.1.0.10');
insert into res values ('archivado', publico.cotizar_presupuesto_tienda('pres-a.ejemplo.com', pg_temp.items('a1000000-0000-0000-0000-000000000002', '1')));
reset role;
update public.clientes set archivado_en = null where id = 'c1000000-0000-0000-0000-000000000001';
select is(pg_temp.fila('archivado'), '{"estado":"sin_acceso"}'::jsonb, '(b) cliente archivado: sin_acceso');
delete from public.clientes_empresas where cliente_id = 'c1000000-0000-0000-0000-000000000001';
select pg_temp.como('f3000000-0000-0000-0000-000000000001', '10.1.0.11');
insert into res values ('baja_habilitado', publico.cotizar_presupuesto_tienda('pres-a.ejemplo.com', pg_temp.items('a1000000-0000-0000-0000-000000000002', '1')));
reset role;
insert into clientes_empresas (cliente_id, empresa_id, organizacion_id) values ('c1000000-0000-0000-0000-000000000001', 'e1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111');
select is(pg_temp.fila('baja_habilitado'), '{"estado":"sin_acceso"}'::jsonb, '(b) baja de «Habilitado en»: sin_acceso');

-- ============================================================================
-- (m) Bandera apagada: sin_acceso sin tocar datos
-- ============================================================================
update public.banderas_plataforma set activa = false where clave = 'tienda_pedidos';
select pg_temp.como('f3000000-0000-0000-0000-000000000001', '10.1.0.12');
insert into res values ('bandera_crear', publico.crear_presupuesto_tienda('pres-a.ejemplo.com', pg_temp.items('a1000000-0000-0000-0000-000000000001', '1'), null, 'c0000000-0000-0000-0000-00000000000d'));
insert into res values ('bandera_cotizar', publico.cotizar_presupuesto_tienda('pres-a.ejemplo.com', pg_temp.items('a1000000-0000-0000-0000-000000000001', '1')));
reset role;
update public.banderas_plataforma set activa = true where clave = 'tienda_pedidos';
select is(pg_temp.fila('bandera_crear'), '{"estado":"sin_acceso"}'::jsonb, '(m) bandera apagada: crear responde sin_acceso');
select is(pg_temp.fila('bandera_cotizar'), '{"estado":"sin_acceso"}'::jsonb, '(m) bandera apagada: cotizar responde sin_acceso');
select is((select pg_temp.contar() from (select 1) x), (select c from antes), '(m) bandera apagada: no se creó ni consumió nada');

-- ============================================================================
-- Cotización (FR-050, D-28): mayorista con descuento 12,5 %
-- ============================================================================
-- Se parte de contadores de llamadas limpios para esta cuenta.
delete from public.limite_pedidos_publicos;
select pg_temp.como('f3000000-0000-0000-0000-000000000001', '10.2.0.1');
insert into res values ('cot_mayorista', publico.cotizar_presupuesto_tienda('pres-a.ejemplo.com',
  pg_temp.items('a1000000-0000-0000-0000-000000000001', '12', 'a1000000-0000-0000-0000-000000000002', '2', 'a1000000-0000-0000-0000-000000000009', '10',
                'a1000000-0000-0000-0000-000000000010', '1', 'a1000000-0000-0000-0000-000000000011', '1', 'a1000000-0000-0000-0000-000000000012', '3')));
reset role;
select is(pg_temp.fila('cot_mayorista') ->> 'estado', 'ok', 'cotizar: ok para la cuenta activa');
select is(jsonb_array_length(pg_temp.fila('cot_mayorista') -> 'lineas'), 6, 'cotizar: seis líneas');
select is(pg_temp.fila('cot_mayorista') -> 'lineas' -> 0 ->> 'producto_id', 'a1000000-0000-0000-0000-000000000001', 'cotizar: respeta el orden de la lista');
select is((select array_agg(k order by k) from jsonb_object_keys(pg_temp.fila('cot_mayorista') -> 'lineas' -> 0) k),
  array['cantidad', 'codigo', 'descripcion', 'disponible', 'iva', 'precio_unitario', 'producto_id', 'subtotal_sin_iva']::text[],
  'cotizar: SALIDA MÍNIMA por línea (sin promocion_id, alicuota_id, precio_referencia, escala ni descuento)');
select is((select array_agg(k order by k) from jsonb_object_keys(pg_temp.fila('cot_mayorista')) k),
  array['estado', 'iva', 'lineas', 'no_disponibles', 'sin_precio', 'total_con_iva', 'total_sin_iva']::text[],
  'cotizar: claves exactas de la respuesta');
select is((pg_temp.fila('cot_mayorista') ->> 'total_con_iva')::numeric,
  (pg_temp.fila('cot_mayorista') ->> 'total_sin_iva')::numeric + (pg_temp.fila('cot_mayorista') ->> 'iva')::numeric, 'cotizar: total con IVA = total sin IVA + IVA');
select is(pg_temp.fila('cot_mayorista') -> 'no_disponibles', '[]'::jsonb, 'cotizar: ninguna no disponible');
select is(pg_temp.fila('cot_mayorista') -> 'sin_precio', '[]'::jsonb, 'cotizar: ninguna sin precio');

-- ============================================================================
-- (d) PARIDAD con el panel (SC-003): el mismo conjunto de líneas, armado por el panel y por la tienda
-- ============================================================================
-- Cuenta del mayorista (descuento 12,5 %): 12 de Alfa (x10), 2 de Beta, 10 de la promo que gana, el de precio propio, el exento y el de 10,5 %.
-- Panel: administrador de la organización 1 con `crear_comprobante` + `guardar_lineas_comprobante` sobre el MISMO cliente y la tienda A.
delete from public.limite_pedidos_publicos;
select pg_temp.como('f3000000-0000-0000-0000-000000000001', '10.2.0.2');
insert into res values ('crear_paridad', publico.crear_presupuesto_tienda('pres-a.ejemplo.com',
  pg_temp.items('a1000000-0000-0000-0000-000000000001', '12', 'a1000000-0000-0000-0000-000000000002', '2', 'a1000000-0000-0000-0000-000000000009', '10',
                'a1000000-0000-0000-0000-000000000010', '1', 'a1000000-0000-0000-0000-000000000011', '1', 'a1000000-0000-0000-0000-000000000012', '3'),
  'Entregar por la tarde', 'c0000000-0000-0000-0000-000000000010'));
reset role;
select pg_temp.como('f3000000-0000-0000-0000-000000000007');
insert into res select 'panel_cab', to_jsonb(c) from public.crear_comprobante('presupuesto', 'e1000000-0000-0000-0000-000000000001', 'c1000000-0000-0000-0000-000000000001', 'tienda_online') c;
insert into res select 'panel_lineas', to_jsonb(c) from public.guardar_lineas_comprobante(
  (pg_temp.fila('panel_cab') ->> 'id')::uuid,
  jsonb_build_array(
    jsonb_build_object('producto_id', 'a1000000-0000-0000-0000-000000000001', 'cantidad', 12),
    jsonb_build_object('producto_id', 'a1000000-0000-0000-0000-000000000002', 'cantidad', 2),
    jsonb_build_object('producto_id', 'a1000000-0000-0000-0000-000000000009', 'cantidad', 10),
    jsonb_build_object('producto_id', 'a1000000-0000-0000-0000-000000000010', 'cantidad', 1),
    jsonb_build_object('producto_id', 'a1000000-0000-0000-0000-000000000011', 'cantidad', 1),
    jsonb_build_object('producto_id', 'a1000000-0000-0000-0000-000000000012', 'cantidad', 3)),
  (pg_temp.fila('panel_cab') ->> 'updated_at')::timestamptz) c;
reset role;

select is(pg_temp.fila('crear_paridad') ->> 'estado', 'ok', 'crear: ok para la cuenta del mayorista');
select is(pg_temp.fila('crear_paridad') ->> 'numero', '00000001', 'crear: el primer presupuesto de la tienda A es el 00000001 (numeración de 8 dígitos, como el panel)');
select is((select array_agg(k order by k) from jsonb_object_keys(pg_temp.fila('crear_paridad')) k), array['estado', 'fecha', 'numero', 'total_con_iva']::text[],
  'crear: claves exactas de la respuesta ok');

create temp table cols as
select 'tienda' as lado, l.orden, to_jsonb(l) - 'id' - 'comprobante_id' - 'creado_en' as fila
  from dominio.comprobantes_venta_lineas l
  join dominio.comprobantes_venta c on c.id = l.comprobante_id
 where c.canal = 'tienda_online' and c.operador_id is null and c.numero = '00000001' and c.tipo = 'presupuesto' and c.empresa_id = 'e1000000-0000-0000-0000-000000000001'
   and exists (select 1 from dominio.presupuestos_tienda pt where pt.comprobante_id = c.id)
union all
select 'panel', l.orden, to_jsonb(l) - 'id' - 'comprobante_id' - 'creado_en'
  from dominio.comprobantes_venta_lineas l
 where l.comprobante_id = (pg_temp.fila('panel_cab') ->> 'id')::uuid;
select is((select count(*)::int from cols where lado = 'tienda'), 6, '(d) la tienda creó 6 líneas');
select is((select count(*)::int from cols where lado = 'panel'), 6, '(d) el panel armó 6 líneas');
select is((select count(*)::int from cols t join cols p on p.lado = 'panel' and p.orden = t.orden where t.lado = 'tienda' and t.fila is distinct from p.fila), 0,
  '(d) PARIDAD: TODAS las columnas de las 6 líneas son idénticas entre la tienda y el panel (precio, escala, descuento, IVA, depósito, promoción, referencia, a pedido…)');
select is((select t.total_sin_iva || '/' || t.total_con_iva from dominio.comprobantes_venta t where t.id = (select comprobante_id from dominio.presupuestos_tienda limit 1)),
  (select (pg_temp.fila('panel_lineas') ->> 'total_sin_iva') || '/' || (pg_temp.fila('panel_lineas') ->> 'total_con_iva')), '(d) PARIDAD: mismos totales de cabecera (sin IVA y con IVA)');
select is((pg_temp.fila('crear_paridad') ->> 'total_con_iva')::numeric, (pg_temp.fila('panel_lineas') ->> 'total_con_iva')::numeric, '(d) la respuesta de crear informa el mismo total con IVA que el panel (SC-003)');
select is((select to_jsonb(c) - 'id' - 'numero' - 'numero_entero' - 'creado_en' - 'updated_at' - 'operador_id' - 'fecha' - 'total_sin_iva' - 'total_con_iva'
             from dominio.comprobantes_venta c where c.id = (select comprobante_id from dominio.presupuestos_tienda limit 1)),
          (select to_jsonb(c) - 'id' - 'numero' - 'numero_entero' - 'creado_en' - 'updated_at' - 'operador_id' - 'fecha' - 'total_sin_iva' - 'total_con_iva'
             from dominio.comprobantes_venta c where c.id = (pg_temp.fila('panel_cab') ->> 'id')::uuid),
  '(d) la cabecera es igual a la que crea el panel (tipo, estado, canal, cliente, empresa, validez nula…), salvo número, fecha y operador');
-- Cobertura de la paridad: la grilla tiene las situaciones pedidas.
select is((select count(distinct fila ->> 'escala')::int from cols where lado = 'tienda'), 2, '(d) cobertura: líneas con escala x1 y x10');
select cmp_ok((select count(*)::int from cols where lado = 'tienda' and (fila ->> 'descuento_pct')::numeric = 12.5), '>=', 2, '(d) cobertura: líneas con el descuento de la ficha del cliente (12,5 %)');
select cmp_ok((select count(*)::int from cols where lado = 'tienda' and fila ->> 'promocion_id' is not null), '=', 1, '(d) cobertura: una línea donde GANA la promoción (con referencia y promoción guardadas)');
select is((select (fila ->> 'precio_unitario')::numeric from cols where lado = 'tienda' and fila ->> 'codigo' = 'SKU-PRO10'), 831.25::numeric,
  '(d) cobertura: precio propio (950) menos el 12,5 % de la ficha (831,25), sin la regla de la tienda');
select is((select (fila ->> 'alicuota_porcentaje')::numeric from cols where lado = 'tienda' and fila ->> 'codigo' = 'SKU-D105'), 10.5::numeric, '(d) cobertura: alícuota de 10,5 %');
select is((select (fila ->> 'iva')::numeric from cols where lado = 'tienda' and fila ->> 'codigo' = 'SKU-ALFA'), (select (fila ->> 'iva')::numeric from cols where lado = 'panel' and fila ->> 'codigo' = 'SKU-ALFA'),
  '(d) cobertura: el IVA de 21 % de la línea con escala x10 coincide');
select is((select (fila ->> 'iva')::numeric from cols where lado = 'tienda' and fila ->> 'codigo' = 'SKU-EXE'), 0::numeric, '(d) cobertura: el producto exento no lleva IVA');
-- «Lo que ves es lo que se crea»: la cotización de las mismas líneas informa el mismo total.
select pg_temp.como('f3000000-0000-0000-0000-000000000001', '10.2.0.3');
insert into res values ('cot_paridad', publico.cotizar_presupuesto_tienda('pres-a.ejemplo.com',
  pg_temp.items('a1000000-0000-0000-0000-000000000001', '12', 'a1000000-0000-0000-0000-000000000002', '2', 'a1000000-0000-0000-0000-000000000009', '10',
                'a1000000-0000-0000-0000-000000000010', '1', 'a1000000-0000-0000-0000-000000000011', '1', 'a1000000-0000-0000-0000-000000000012', '3')));
reset role;
select is((pg_temp.fila('cot_paridad') ->> 'total_con_iva')::numeric, (pg_temp.fila('crear_paridad') ->> 'total_con_iva')::numeric, 'cotizar y crear informan el MISMO total (lo que ves es lo que se crea)');
select is((select jsonb_agg(l -> 'precio_unitario' order by o) from jsonb_array_elements(pg_temp.fila('cot_paridad') -> 'lineas') with ordinality t(l, o)),
          (select jsonb_agg(to_jsonb(fila -> 'precio_unitario') order by orden) from cols where lado = 'tienda'),
  'cotizar y crear informan los mismos precios unitarios');

-- La nota y el vínculo (FR-054), y el estado fijo.
select is((select to_jsonb(pt) - 'id' - 'creado_en' - 'comprobante_id' from dominio.presupuestos_tienda pt limit 1),
  jsonb_build_object('organizacion_id', '11111111-1111-1111-1111-111111111111', 'empresa_id', 'e1000000-0000-0000-0000-000000000001',
                     'cuenta_cliente_id', 'ca000000-0000-0000-0000-000000000001', 'cliente_id', 'c1000000-0000-0000-0000-000000000001',
                     'clave_envio', 'c0000000-0000-0000-0000-000000000010', 'nota', 'Entregar por la tarde'),
  '(a) el vínculo guarda la cuenta, el cliente, la tienda, la clave y la nota de la persona');
select is((select jsonb_build_object('tipo', c.tipo, 'estado', c.estado, 'canal', c.canal, 'operador_id', c.operador_id, 'valido_hasta', c.valido_hasta,
                                     'fecha', c.fecha = (now() at time zone 'America/Argentina/Buenos_Aires')::date)
             from dominio.comprobantes_venta c where c.id = (select comprobante_id from dominio.presupuestos_tienda limit 1)),
  '{"tipo":"presupuesto","estado":"pendiente","canal":"tienda_online","operador_id":null,"valido_hasta":null,"fecha":true}'::jsonb,
  'FR-054: presupuesto pendiente, canal tienda_online, sin operador, sin validez y con la fecha de hoy de Buenos Aires');

-- ============================================================================
-- (n) Actividad (FR-060)
-- ============================================================================
select is((select count(*)::int from public.registro_actividad where tipo = 'presupuesto.creado_desde_tienda'), 1, '(n) un evento presupuesto.creado_desde_tienda');
select is((select actor_id from public.registro_actividad where tipo = 'presupuesto.creado_desde_tienda'), null::uuid, '(n) el evento no tiene actor de panel');
select is((select detalle from public.registro_actividad where tipo = 'presupuesto.creado_desde_tienda'),
  'Presupuesto 00000001 pedido desde la tienda Tienda A por el cliente Nº 910 · Mayorista Cuenta', '(n) el detalle lleva número, tienda y cliente (Nº y nombre)');
select is((select replace(detalle, '00000001', '') !~* '(@|\d{7,})' from public.registro_actividad where tipo = 'presupuesto.creado_desde_tienda'), true, '(n) el detalle no lleva correo ni teléfono');
select is((select empresa_id from public.registro_actividad where tipo = 'presupuesto.creado_desde_tienda'), 'e1000000-0000-0000-0000-000000000001'::uuid, '(n) el evento es de la tienda');
select is((select sensible from public.tipos_evento_actividad where tipo = 'presupuesto.creado_desde_tienda'), false, '(n) el tipo de evento no es sensible');

-- ============================================================================
-- (f) CERO efectos de stock, reservas, cobros y contrarreembolsos (FR-055, amenaza 2.7)
-- ============================================================================
create temp table efectos_antes as
select (select count(*) from dominio.movimientos_stock) as mov, (select count(*) from dominio.reservas_stock) as res,
       (select count(*) from dominio.cobros_comprobante) as cob, (select count(*) from dominio.contrarreembolsos) as con,
       (select coalesce(sum(cantidad), 0) from dominio.existencias) as exis, (select count(*) from dominio.existencias_deposito) as exd;
grant all on efectos_antes to public;
delete from public.limite_pedidos_publicos;
select pg_temp.como('f3000000-0000-0000-0000-000000000002', '10.3.0.1');
insert into res values ('efectos', publico.crear_presupuesto_tienda('pres-a.ejemplo.com', pg_temp.items('a1000000-0000-0000-0000-000000000001', '3', 'a1000000-0000-0000-0000-000000000002', '1'), null, 'c0000000-0000-0000-0000-000000000020'));
reset role;
select is(pg_temp.fila('efectos') ->> 'estado', 'ok', '(f) el minorista crea un presupuesto');
select is((select jsonb_build_array(
             (select count(*) from dominio.movimientos_stock) - mov, (select count(*) from dominio.reservas_stock) - res,
             (select count(*) from dominio.cobros_comprobante) - cob, (select count(*) from dominio.contrarreembolsos) - con,
             (select coalesce(sum(cantidad), 0) from dominio.existencias) - exis, (select count(*) from dominio.existencias_deposito) - exd) from efectos_antes),
  '[0,0,0,0,0,0]'::jsonb, '(f) CERO filas nuevas en movimientos de stock, reservas, cobros y contrarreembolsos, y las existencias no cambian');
select is((select c.estado from dominio.comprobantes_venta c join dominio.presupuestos_tienda pt on pt.comprobante_id = c.id where pt.clave_envio = 'c0000000-0000-0000-0000-000000000020'), 'pendiente',
  '(f) el comprobante nace y queda pendiente');
select is((select (l.precio_unitario)::text from dominio.comprobantes_venta_lineas l join dominio.presupuestos_tienda pt on pt.comprobante_id = l.comprobante_id
            where pt.clave_envio = 'c0000000-0000-0000-0000-000000000020' and l.codigo = 'SKU-ALFA'), '1050.00',
  'minorista: escala x1 con la regla de la tienda A (1000 + 5 % redondeado a 10), sin descuento');
select is((select jsonb_agg(l.escala order by l.orden) from dominio.comprobantes_venta_lineas l join dominio.presupuestos_tienda pt on pt.comprobante_id = l.comprobante_id
            where pt.clave_envio = 'c0000000-0000-0000-0000-000000000020'), '["x1","x1"]'::jsonb, 'minorista: siempre escala x1 (3 unidades no es mayorista)');

-- ============================================================================
-- (a) IDOR y (c) claves ajenas: ningún campo ajeno tiene efecto
-- ============================================================================
-- Mismas líneas con y sin claves extra (precio, escala, descuento, deposito_id, estado, canal, empresa_id, cliente_id, organizacion_id, fecha, ahora…).
delete from public.limite_pedidos_publicos;
select pg_temp.como('f3000000-0000-0000-0000-000000000001', '10.4.0.1');
insert into res values ('cot_limpia', publico.cotizar_presupuesto_tienda('pres-a.ejemplo.com', pg_temp.items('a1000000-0000-0000-0000-000000000001', '12', 'a1000000-0000-0000-0000-000000000002', '2')));
insert into res values ('cot_sucia', publico.cotizar_presupuesto_tienda('pres-a.ejemplo.com', jsonb_build_array(
  jsonb_build_object('producto_id', 'a1000000-0000-0000-0000-000000000001', 'cantidad', 12, 'precio', 1, 'precio_unitario', 1, 'escala', 'x50', 'descuento', 99, 'descuento_pct', 99,
    'deposito_id', 'd1000000-0000-0000-0000-000000000009', 'estado', 'aceptado', 'canal', 'mostrador', 'empresa_id', 'e2000000-0000-0000-0000-000000000001',
    'cliente_id', 'c1000000-0000-0000-0000-000000000002', 'organizacion_id', '22222222-2222-2222-2222-222222222222', 'fecha', '2000-01-01', 'ahora', '2000-01-01T00:00:00Z',
    'p_ahora', '2000-01-01T00:00:00Z', 'tipo_cliente', 'minorista', 'tipo', 'factura', 'precio_manual', 1, 'aplicar_descuento', false, 'promocion_id', gen_random_uuid()),
  jsonb_build_object('producto_id', 'a1000000-0000-0000-0000-000000000002', 'cantidad', '2', 'precio', 0, 'cliente_id', 'c1000000-0000-0000-0000-000000000002')))
);
insert into res values ('crear_sucio', publico.crear_presupuesto_tienda('pres-a.ejemplo.com', jsonb_build_array(
  jsonb_build_object('producto_id', 'a1000000-0000-0000-0000-000000000001', 'cantidad', 12, 'precio', 1, 'escala', 'x50', 'descuento', 99, 'deposito_id', 'd1000000-0000-0000-0000-000000000009',
    'estado', 'aceptado', 'canal', 'mostrador', 'empresa_id', 'e2000000-0000-0000-0000-000000000001', 'cliente_id', 'c1000000-0000-0000-0000-000000000002',
    'organizacion_id', '22222222-2222-2222-2222-222222222222', 'fecha', '2000-01-01', 'ahora', '2000-01-01T00:00:00Z', 'tipo_cliente', 'minorista', 'aplicar_descuento', false),
  jsonb_build_object('producto_id', 'a1000000-0000-0000-0000-000000000002', 'cantidad', '2', 'cliente_id', 'c1000000-0000-0000-0000-000000000002')),
  null, 'c0000000-0000-0000-0000-000000000030'));
reset role;
select is(pg_temp.fila('cot_sucia') -> 'lineas', pg_temp.fila('cot_limpia') -> 'lineas', '(c) las claves ajenas (precio, escala, descuento, depósito, estado, canal, empresa, cliente, fecha…) no cambian la cotización');
select is(pg_temp.fila('crear_sucio') ->> 'estado', 'ok', '(c) con claves ajenas se crea igual');
select is((select jsonb_agg(jsonb_build_object('precio', l.precio_unitario, 'escala', l.escala, 'desc', l.descuento_pct, 'dep', l.deposito_id) order by l.orden)
             from dominio.comprobantes_venta_lineas l join dominio.presupuestos_tienda pt on pt.comprobante_id = l.comprobante_id where pt.clave_envio = 'c0000000-0000-0000-0000-000000000030'),
  (select jsonb_agg(jsonb_build_object('precio', (x ->> 'precio_unitario')::numeric, 'escala', case when o = 1 then 'x10' else 'x1' end, 'desc', 12.5, 'dep',
                    (select d.id from dominio.depositos d where d.organizacion_id = '11111111-1111-1111-1111-111111111111' and d.por_defecto)) order by o)
     from jsonb_array_elements(pg_temp.fila('cot_limpia') -> 'lineas') with ordinality t(x, o)),
  '(c) las líneas creadas con claves ajenas son las del servidor (precio, escala x10, descuento 12,5 % de la ficha y el depósito por defecto)');
select is((select jsonb_build_object('cliente', pt.cliente_id, 'empresa', pt.empresa_id, 'org', pt.organizacion_id, 'canal', c.canal, 'estado', c.estado, 'tipo', c.tipo)
             from dominio.presupuestos_tienda pt join dominio.comprobantes_venta c on c.id = pt.comprobante_id where pt.clave_envio = 'c0000000-0000-0000-0000-000000000030'),
  '{"cliente":"c1000000-0000-0000-0000-000000000001","empresa":"e1000000-0000-0000-0000-000000000001","org":"11111111-1111-1111-1111-111111111111","canal":"tienda_online","estado":"pendiente","tipo":"presupuesto"}'::jsonb,
  '(a) IDOR: aun mandando cliente_id del minorista, el presupuesto es de la cuenta del mayorista (cliente, tienda, organización, canal y estado salen del servidor)');
-- El minorista no ve el presupuesto del mayorista: como authenticated sin sección ventas ni empresa accesible no lee la tabla.
select pg_temp.como('f3000000-0000-0000-0000-000000000002', '10.4.0.2');
select is((select count(*)::int from dominio.presupuestos_tienda), 0, '(a) una cuenta de la tienda NO lee presupuestos_tienda por la API (RLS: no es del panel)');
select is((select count(*)::int from dominio.comprobantes_venta), 0, '(a) una cuenta de la tienda NO lee comprobantes por la API');
reset role;

-- ============================================================================
-- (e) sin_precio / no_disponible: no consumen número ni crean nada
-- ============================================================================
create temp table antes_e as select pg_temp.contar() as c;
grant all on antes_e to public;
delete from public.limite_pedidos_publicos;
select pg_temp.como('f3000000-0000-0000-0000-000000000001', '10.5.0.1');
insert into res values ('sin_precio_usd', publico.crear_presupuesto_tienda('pres-a.ejemplo.com', pg_temp.items('a1000000-0000-0000-0000-000000000001', '1', 'a1000000-0000-0000-0000-000000000007', '1'), null, 'c0000000-0000-0000-0000-000000000040'));
insert into res values ('cot_sin_precio', publico.cotizar_presupuesto_tienda('pres-a.ejemplo.com', pg_temp.items('a1000000-0000-0000-0000-000000000001', '1', 'a1000000-0000-0000-0000-000000000007', '1')));
reset role;
select is(pg_temp.fila('sin_precio_usd'), '{"estado":"sin_precio","producto_id":"a1000000-0000-0000-0000-000000000007"}'::jsonb, '(e) un producto en dólares sin cotización responde sin_precio con el producto');
select is(pg_temp.fila('cot_sin_precio') -> 'sin_precio', '["a1000000-0000-0000-0000-000000000007"]'::jsonb, '(e) la cotización informa el producto sin precio');
select is((pg_temp.fila('cot_sin_precio') -> 'lineas' -> 0 ->> 'producto_id'), 'a1000000-0000-0000-0000-000000000001', '(e) la cotización cotiza los demás');
select is((select pg_temp.contar() - 'envios' from (select 1) x), (select c - 'envios' from antes_e), '(e) sin_precio no consumió número ni creó comprobante, líneas, vínculo ni actividad');
select is((select (pg_temp.contar() -> 'envios')::int - (c -> 'envios')::int from antes_e), 0, '(e) sin_precio no gastó cupo de envíos de la tienda');

-- Producto oculto, inactivo, de otra tienda, de otra organización e inexistente: INDISTINGUIBLES (amenaza 1.4, sin oráculo).
select pg_temp.como('f3000000-0000-0000-0000-000000000001', '10.5.0.2');
insert into res values ('nd_oculto', publico.crear_presupuesto_tienda('pres-a.ejemplo.com', pg_temp.items('a1000000-0000-0000-0000-000000000003', '1'), null, 'c0000000-0000-0000-0000-000000000050'));
insert into res values ('nd_inactivo', publico.crear_presupuesto_tienda('pres-a.ejemplo.com', pg_temp.items('a1000000-0000-0000-0000-000000000004', '1'), null, 'c0000000-0000-0000-0000-000000000051'));
insert into res values ('nd_solo_b', publico.crear_presupuesto_tienda('pres-a.ejemplo.com', pg_temp.items('a1000000-0000-0000-0000-000000000006', '1'), null, 'c0000000-0000-0000-0000-000000000052'));
insert into res values ('nd_otra_org', publico.crear_presupuesto_tienda('pres-a.ejemplo.com', pg_temp.items('a2000000-0000-0000-0000-000000000005', '1'), null, 'c0000000-0000-0000-0000-000000000053'));
insert into res values ('nd_inexistente', publico.crear_presupuesto_tienda('pres-a.ejemplo.com', pg_temp.items('a9999999-0000-0000-0000-000000000099', '1'), null, 'c0000000-0000-0000-0000-000000000054'));
insert into res values ('nd_mezcla', publico.crear_presupuesto_tienda('pres-a.ejemplo.com', pg_temp.items('a1000000-0000-0000-0000-000000000001', '1', 'a1000000-0000-0000-0000-000000000003', '1'), null, 'c0000000-0000-0000-0000-000000000055'));
insert into res values ('cot_nd', publico.cotizar_presupuesto_tienda('pres-a.ejemplo.com', pg_temp.items('a1000000-0000-0000-0000-000000000003', '1', 'a1000000-0000-0000-0000-000000000004', '1', 'a1000000-0000-0000-0000-000000000006', '1',
  'a2000000-0000-0000-0000-000000000005', '1', 'a9999999-0000-0000-0000-000000000099', '1')));
reset role;
select is((select array_agg(distinct v ->> 'estado') from res where k in ('nd_oculto', 'nd_inactivo', 'nd_solo_b', 'nd_otra_org', 'nd_inexistente', 'nd_mezcla')), array['no_disponible']::text[],
  '(1.4) oculto, inactivo, solo en otra tienda, de otra organización, inexistente y mezclado: la MISMA respuesta no_disponible (sin oráculo)');
select is((select v - 'producto_id' from res where k = 'nd_oculto'), (select v - 'producto_id' from res where k = 'nd_inexistente'), '(1.4) y con la misma forma que un producto inexistente');
select is(jsonb_array_length(pg_temp.fila('cot_nd') -> 'no_disponibles'), 5, '(1.4) la cotización informa los 5 como no disponibles, todos iguales');
select is(pg_temp.fila('cot_nd') -> 'lineas', '[]'::jsonb, '(1.4) y no cotiza ninguna línea de ellos');
select is((select pg_temp.contar() - 'envios' from (select 1) x), (select c - 'envios' from antes_e), '(1.4) no_disponible no consumió número ni creó nada');

-- ============================================================================
-- (g) Topes de líneas, cantidades y jsonb hostil: todo `invalido`, ningún error de Postgres
-- ============================================================================
delete from public.limite_pedidos_publicos;
select pg_temp.como('f3000000-0000-0000-0000-000000000001', '10.6.0.1');
insert into res select 'h_' || lpad(n::text, 2, '0'), publico.crear_presupuesto_tienda('pres-a.ejemplo.com', e, null, ('c0000000-0000-0000-0000-0000000000' || (60 + n))::uuid)
from (values
  (1, null::jsonb), (2, '{}'::jsonb), (3, '[]'::jsonb), (4, '"texto"'::jsonb), (5, '[1,2,3]'::jsonb), (6, '[[]]'::jsonb), (7, '[null]'::jsonb),
  (8, '[{"producto_id":"a1000000-0000-0000-0000-000000000001","cantidad":0}]'::jsonb)
) t(n, e) where n <= 9;
reset role;
delete from public.limite_pedidos_publicos;   -- el cupo de llamadas es de 10 por minuto y cuenta: se parte en lotes
select pg_temp.como('f3000000-0000-0000-0000-000000000001', '10.6.0.1');
insert into res select 'h_' || lpad(n::text, 2, '0'), publico.crear_presupuesto_tienda('pres-a.ejemplo.com', e, null, ('c0000000-0000-0000-0000-0000000000' || (60 + n))::uuid)
from (values
  (9, '[{"producto_id":"a1000000-0000-0000-0000-000000000001","cantidad":-1}]'::jsonb),
  (10, '[{"producto_id":"a1000000-0000-0000-0000-000000000001","cantidad":1.5}]'::jsonb),
  (11, '[{"producto_id":"a1000000-0000-0000-0000-000000000001","cantidad":"1e3"}]'::jsonb),
  (12, '[{"producto_id":"a1000000-0000-0000-0000-000000000001","cantidad":10000}]'::jsonb),
  (13, '[{"producto_id":"a1000000-0000-0000-0000-000000000001","cantidad":null}]'::jsonb),
  (14, '[{"producto_id":"a1000000-0000-0000-0000-000000000001","cantidad":"abc"}]'::jsonb),
  (15, '[{"producto_id":"no-es-uuid","cantidad":1}]'::jsonb),
  (16, '[{"producto_id":42,"cantidad":1}]'::jsonb),
  (17, '[{"cantidad":1}]'::jsonb),
  (18, '[{"producto_id":"a1000000-0000-0000-0000-000000000001","cantidad":{"x":1}}]'::jsonb)
) t(n, e);
reset role;
delete from public.limite_pedidos_publicos;
select pg_temp.como('f3000000-0000-0000-0000-000000000001', '10.6.0.1');
-- 51 líneas distintas y una lista gigante.
insert into res select 'h_51', publico.crear_presupuesto_tienda('pres-a.ejemplo.com',
  (select jsonb_agg(jsonb_build_object('producto_id', ('b1000000-0000-0000-0000-' || lpad(n::text, 12, '0')), 'cantidad', 1)) from generate_series(1, 51) n), null, 'c0000000-0000-0000-0000-000000000090');
insert into res select 'h_gigante', publico.crear_presupuesto_tienda('pres-a.ejemplo.com',
  (select jsonb_agg(jsonb_build_object('producto_id', 'a1000000-0000-0000-0000-000000000001', 'cantidad', 1, 'relleno', repeat('x', 200))) from generate_series(1, 49) n), null, 'c0000000-0000-0000-0000-000000000091');
reset role;
select is((select count(*)::int from res where k ~ '^h_' and v = '{"estado":"invalido","campos":["items"]}'::jsonb), 20,
  '(g) 20 entradas hostiles (no array, objeto, anidados, cantidad 0, -1, 1,5, "1e3", 10.000, nula, texto, objeto; producto no uuid, numérico o ausente; 51 líneas; lista de más de 8 kB): todas invalido con campos ["items"], ninguna con error de Postgres');
select is((select pg_temp.contar() - 'envios' from (select 1) x), (select c - 'envios' from antes_e), '(g) ninguna entrada hostil creó nada');
-- 50 líneas en la lista: una sola llamada válida de tamaño máximo (cotización: 50 productos distintos del catálogo masivo).
select pg_temp.como('f3000000-0000-0000-0000-000000000001', '10.6.0.2');
insert into res select 'cot_50', publico.cotizar_presupuesto_tienda('pres-a.ejemplo.com',
  (select jsonb_agg(jsonb_build_object('producto_id', ('b1000000-0000-0000-0000-' || lpad(n::text, 12, '0')), 'cantidad', 1)) from generate_series(1, 50) n));
reset role;
select is(jsonb_array_length(pg_temp.fila('cot_50') -> 'lineas'), 50, '(g) 50 líneas (el máximo) se cotizan');
-- Cantidad máxima y nota hostil.
delete from public.limite_pedidos_publicos;
select pg_temp.como('f3000000-0000-0000-0000-000000000001', '10.6.0.3');
insert into res values ('nota_larga', publico.crear_presupuesto_tienda('pres-a.ejemplo.com', pg_temp.items('a1000000-0000-0000-0000-000000000001', '1'), repeat('a', 501), 'c0000000-0000-0000-0000-000000000092'));
insert into res values ('nota_control', publico.crear_presupuesto_tienda('pres-a.ejemplo.com', pg_temp.items('a1000000-0000-0000-0000-000000000001', '1'), E'hola\x01chau', 'c0000000-0000-0000-0000-000000000093'));
insert into res values ('nota_bidi', publico.crear_presupuesto_tienda('pres-a.ejemplo.com', pg_temp.items('a1000000-0000-0000-0000-000000000001', '1'), E'abc‮def', 'c0000000-0000-0000-0000-000000000094'));
insert into res values ('clave_nula', publico.crear_presupuesto_tienda('pres-a.ejemplo.com', pg_temp.items('a1000000-0000-0000-0000-000000000001', '1'), null, null));
insert into res values ('todo_mal', publico.crear_presupuesto_tienda('pres-a.ejemplo.com', null, repeat('a', 501), null));
insert into res values ('cant_9999', publico.cotizar_presupuesto_tienda('pres-a.ejemplo.com', pg_temp.items('a1000000-0000-0000-0000-000000000001', '9999')));
reset role;
select is(pg_temp.fila('nota_larga'), '{"estado":"invalido","campos":["nota"]}'::jsonb, '(g) nota de 501 caracteres: invalido (nota)');
select is(pg_temp.fila('nota_control'), '{"estado":"invalido","campos":["nota"]}'::jsonb, '(g) nota con carácter de control: invalido (nota)');
select is(pg_temp.fila('nota_bidi'), '{"estado":"invalido","campos":["nota"]}'::jsonb, '(g) nota con marca de dirección del texto: invalido (nota)');
select is(pg_temp.fila('clave_nula'), '{"estado":"invalido","campos":["clave_envio"]}'::jsonb, '(g) sin clave_envio: invalido (clave_envio)');
select is(pg_temp.fila('todo_mal'), '{"estado":"invalido","campos":["nota","clave_envio","items"]}'::jsonb, '(g) varios errores: todos los campos, en orden');
select is(pg_temp.fila('cant_9999') ->> 'estado', 'ok', '(g) la cantidad máxima (9.999) se cotiza');
select is((pg_temp.fila('cant_9999') -> 'lineas' -> 0 ->> 'cantidad')::int, 9999, '(g) 9.999 unidades');

-- Cantidad que desborda el importe: invalido (nunca un error de Postgres).
update dominio.productos set precio_lista = 900000000 where id = 'a1000000-0000-0000-0000-000000000002';
select pg_temp.como('f3000000-0000-0000-0000-000000000001', '10.6.0.4');
insert into res values ('desborde', publico.crear_presupuesto_tienda('pres-a.ejemplo.com', pg_temp.items('a1000000-0000-0000-0000-000000000002', '9999'), null, 'c0000000-0000-0000-0000-000000000095'));
reset role;
update dominio.productos set precio_lista = 2000 where id = 'a1000000-0000-0000-0000-000000000002';
select is(pg_temp.fila('desborde') ->> 'estado', 'sin_precio', '(g) una línea que desborda el importe máximo no se crea ni rompe: se informa como sin_precio de ese producto');

-- ============================================================================
-- (h) Idempotencia (FR-058) y numeración correlativa
-- ============================================================================
delete from public.limite_pedidos_publicos;
create temp table antes_h as select pg_temp.contar() as c;
grant all on antes_h to public;
select pg_temp.como('f3000000-0000-0000-0000-000000000009', '10.7.0.1');
reset role;
select pg_temp.como('f3000000-0000-0000-0000-000000000002', '10.7.0.2');
insert into res values ('idem_1', publico.crear_presupuesto_tienda('pres-a.ejemplo.com', pg_temp.items('a1000000-0000-0000-0000-000000000002', '2'), null, 'c0000000-0000-0000-0000-0000000000a1'));
insert into res values ('idem_2', publico.crear_presupuesto_tienda('pres-a.ejemplo.com', pg_temp.items('a1000000-0000-0000-0000-000000000002', '2'), null, 'c0000000-0000-0000-0000-0000000000a1'));
-- Aun con otra lista, la misma clave devuelve el mismo presupuesto (no crea otro).
insert into res values ('idem_3', publico.crear_presupuesto_tienda('pres-a.ejemplo.com', pg_temp.items('a1000000-0000-0000-0000-000000000001', '5'), 'otra nota', 'c0000000-0000-0000-0000-0000000000a1'));
reset role;
select is(pg_temp.fila('idem_1') ->> 'estado', 'ok', '(h) la primera llamada crea');
select is(pg_temp.fila('idem_2'), pg_temp.fila('idem_1'), '(h) repetir la clave devuelve el MISMO presupuesto (mismo número, fecha y total)');
select is(pg_temp.fila('idem_3'), pg_temp.fila('idem_1'), '(h) la misma clave con otro contenido devuelve el original sin crear otro');
select is((select count(*)::int from dominio.presupuestos_tienda where clave_envio = 'c0000000-0000-0000-0000-0000000000a1'), 1, '(h) un solo vínculo');
select is((select (pg_temp.contar() -> 'comprobantes')::int - (c -> 'comprobantes')::int from antes_h), 1, '(h) un solo comprobante nuevo');
select is((select (pg_temp.contar() -> 'envios')::int - (c -> 'envios')::int from antes_h), 1, '(h) un solo cupo de envío gastado');
select is((select (pg_temp.contar() -> 'actividad')::int - (c -> 'actividad')::int from antes_h), 1, '(h) un solo evento de actividad');
select is((pg_temp.fila('idem_1') ->> 'numero')::int, (select max(ultimo) from dominio.comprobantes_venta_numeracion where empresa_id = 'e1000000-0000-0000-0000-000000000001' and tipo = 'presupuesto'),
  '(h) el contador de la tienda A está en el número del último presupuesto creado (correlativo, sin saltos ni consumo extra)');

-- ============================================================================
-- (i) Un error provocado a mitad deja el contador de numeración sin cambio (amenaza 2.12)
-- ============================================================================
create function pg_temp.falla_a_mitad() returns trigger language plpgsql as $$ begin raise exception 'falla provocada por la prueba'; end $$;
create trigger falla_a_mitad before insert on dominio.presupuestos_tienda for each row execute function pg_temp.falla_a_mitad();
create temp table antes_i as select pg_temp.contar() as c, (select ultimo from dominio.comprobantes_venta_numeracion where empresa_id = 'e1000000-0000-0000-0000-000000000001' and tipo = 'presupuesto') as ultimo;
grant all on antes_i to public;
delete from public.limite_pedidos_publicos;
select pg_temp.como('f3000000-0000-0000-0000-000000000002', '10.8.0.1');
insert into res values ('falla', publico.crear_presupuesto_tienda('pres-a.ejemplo.com', pg_temp.items('a1000000-0000-0000-0000-000000000002', '1'), null, 'c0000000-0000-0000-0000-0000000000b1'));
reset role;
drop trigger falla_a_mitad on dominio.presupuestos_tienda;
select is(pg_temp.fila('falla'), '{"estado":"error"}'::jsonb, '(i) un error a mitad responde error genérico, sin texto de Postgres');
select is((select ultimo from dominio.comprobantes_venta_numeracion where empresa_id = 'e1000000-0000-0000-0000-000000000001' and tipo = 'presupuesto'), (select ultimo from antes_i),
  '(i) el contador de numeración NO cambió (no hay saltos)');
select is((select pg_temp.contar() from (select 1) x), (select c from antes_i), '(i) no quedó comprobante, líneas, vínculo, actividad ni cupo gastado');

-- ============================================================================
-- (g) Topes por cuenta: 5 por día y 10 abiertos; lock por cuenta
-- ============================================================================
-- Cuenta «topes» (minorista, tienda A). Se crean 5 con IPs distintas (el cupo por hora de la tienda es por IP) y el sexto es `limite_cuenta`.
delete from public.limite_pedidos_publicos;
select pg_temp.como('f3000000-0000-0000-0000-00000000000a', '10.20.0.1');
insert into res values ('dia_1', publico.crear_presupuesto_tienda('pres-a.ejemplo.com', pg_temp.items('a1000000-0000-0000-0000-000000000002', '1'), null, 'c0000000-0000-0000-0000-0000000000c1'));
select pg_temp.como('f3000000-0000-0000-0000-00000000000a', '10.20.0.2');
insert into res values ('dia_2', publico.crear_presupuesto_tienda('pres-a.ejemplo.com', pg_temp.items('a1000000-0000-0000-0000-000000000002', '1'), null, 'c0000000-0000-0000-0000-0000000000c2'));
select pg_temp.como('f3000000-0000-0000-0000-00000000000a', '10.20.0.3');
insert into res values ('dia_3', publico.crear_presupuesto_tienda('pres-a.ejemplo.com', pg_temp.items('a1000000-0000-0000-0000-000000000002', '1'), null, 'c0000000-0000-0000-0000-0000000000c3'));
select pg_temp.como('f3000000-0000-0000-0000-00000000000a', '10.20.0.4');
insert into res values ('dia_4', publico.crear_presupuesto_tienda('pres-a.ejemplo.com', pg_temp.items('a1000000-0000-0000-0000-000000000002', '1'), null, 'c0000000-0000-0000-0000-0000000000c4'));
-- El lock por cuenta se TOMÓ en esta transacción (la concurrencia real con dos sesiones la prueba el E2E): una advisory lock con la clave de la cuenta.
select is((select count(*)::int from pg_locks l where l.locktype = 'advisory' and l.pid = pg_backend_pid()
             and ((l.classid::bigint << 32) | l.objid::bigint) = hashtextextended('presupuesto|ca000000-0000-0000-0000-000000000009', 0)), 1,
  '(g) el alta toma el lock por cuenta (pg_advisory_xact_lock sobre la cuenta)');
select pg_temp.como('f3000000-0000-0000-0000-00000000000a', '10.20.0.5');
insert into res values ('dia_5', publico.crear_presupuesto_tienda('pres-a.ejemplo.com', pg_temp.items('a1000000-0000-0000-0000-000000000002', '1'), null, 'c0000000-0000-0000-0000-0000000000c5'));
-- Dos llamadas seguidas con 4 creados hoy (aquí 5 ya): la sexta y la séptima son limite_cuenta y no crean nada.
select pg_temp.como('f3000000-0000-0000-0000-00000000000a', '10.20.0.6');
insert into res values ('dia_6', publico.crear_presupuesto_tienda('pres-a.ejemplo.com', pg_temp.items('a1000000-0000-0000-0000-000000000002', '1'), null, 'c0000000-0000-0000-0000-0000000000c6'));
select pg_temp.como('f3000000-0000-0000-0000-00000000000a', '10.20.0.7');
insert into res values ('dia_7', publico.crear_presupuesto_tienda('pres-a.ejemplo.com', pg_temp.items('a1000000-0000-0000-0000-000000000002', '1'), null, 'c0000000-0000-0000-0000-0000000000c7'));
-- La misma cuenta repitiendo la clave de un presupuesto ya creado NO choca con el tope (es una repetición).
select pg_temp.como('f3000000-0000-0000-0000-00000000000a', '10.20.0.8');
insert into res values ('dia_repite', publico.crear_presupuesto_tienda('pres-a.ejemplo.com', pg_temp.items('a1000000-0000-0000-0000-000000000002', '1'), null, 'c0000000-0000-0000-0000-0000000000c3'));
reset role;
select is((select array_agg(v ->> 'estado' order by k) from res where k in ('dia_1', 'dia_2', 'dia_3', 'dia_4', 'dia_5')), array['ok', 'ok', 'ok', 'ok', 'ok'], '(g) los primeros 5 del día se crean');
select is(pg_temp.fila('dia_6'), '{"estado":"limite_cuenta"}'::jsonb, '(g) el sexto del día responde limite_cuenta');
select is(pg_temp.fila('dia_7'), '{"estado":"limite_cuenta"}'::jsonb, '(g) y el séptimo también');
select is(pg_temp.fila('dia_repite') ->> 'estado', 'ok', '(g) repetir la clave de uno ya creado no choca con el tope diario (idempotencia primero)');
select is((select count(*)::int from dominio.presupuestos_tienda where cuenta_cliente_id = 'ca000000-0000-0000-0000-000000000009'), 5, '(g) la cuenta tiene exactamente 5 presupuestos');
select is((select count(*)::int from dominio.tienda_envios where clave_envio in ('c0000000-0000-0000-0000-0000000000c6', 'c0000000-0000-0000-0000-0000000000c7')), 0,
  '(g) limite_cuenta no gastó cupo de envío de la tienda');
-- Al día siguiente vuelve a poder: se mueven los 5 al día de ayer (Buenos Aires).
update dominio.presupuestos_tienda set creado_en = creado_en - interval '1 day' where cuenta_cliente_id = 'ca000000-0000-0000-0000-000000000009';
delete from public.limite_pedidos_publicos;
select pg_temp.como('f3000000-0000-0000-0000-00000000000a', '10.20.0.9');
insert into res values ('dia_siguiente', publico.crear_presupuesto_tienda('pres-a.ejemplo.com', pg_temp.items('a1000000-0000-0000-0000-000000000002', '1'), null, 'c0000000-0000-0000-0000-0000000000c8'));
reset role;
select is(pg_temp.fila('dia_siguiente') ->> 'estado', 'ok', '(g) al cambiar el día (Buenos Aires) el tope diario se reinicia (hay 5 abiertos < 10)');

-- 10 abiertos: se siembran 9 pendientes más de ayer y se prueba el décimo y el undécimo.
insert into dominio.comprobantes_venta (id, organizacion_id, empresa_id, cliente_id, tipo, numero, numero_entero, fecha, estado, total_sin_iva, total_con_iva, canal)
select ('d0000000-0000-0000-0000-' || lpad(n::text, 12, '0'))::uuid, '11111111-1111-1111-1111-111111111111', 'e1000000-0000-0000-0000-000000000001', 'c1000000-0000-0000-0000-000000000009',
       'presupuesto', lpad((900 + n)::text, 8, '0'), 900 + n, current_date, 'pendiente', 100, 100, 'tienda_online'
  from generate_series(1, 4) n;
insert into dominio.presupuestos_tienda (organizacion_id, empresa_id, cuenta_cliente_id, cliente_id, comprobante_id, clave_envio, creado_en)
select '11111111-1111-1111-1111-111111111111', 'e1000000-0000-0000-0000-000000000001', 'ca000000-0000-0000-0000-000000000009', 'c1000000-0000-0000-0000-000000000009',
       ('d0000000-0000-0000-0000-' || lpad(n::text, 12, '0'))::uuid, ('c0000000-0000-0000-0000-0000000001' || lpad(n::text, 2, '0'))::uuid, now() - interval '3 days'
  from generate_series(1, 4) n;
delete from public.limite_pedidos_publicos;
select pg_temp.como('f3000000-0000-0000-0000-00000000000a', '10.20.1.1');
insert into res values ('abiertos_10', publico.crear_presupuesto_tienda('pres-a.ejemplo.com', pg_temp.items('a1000000-0000-0000-0000-000000000002', '1'), null, 'c0000000-0000-0000-0000-0000000001e1'));
insert into res values ('abiertos_11', publico.crear_presupuesto_tienda('pres-a.ejemplo.com', pg_temp.items('a1000000-0000-0000-0000-000000000002', '1'), null, 'c0000000-0000-0000-0000-0000000001e2'));
reset role;
-- Abiertos antes: 5 del día anterior + 1 del día siguiente + 4 sembrados = 10 → el décimo primero ya no entra. (El «10» llegó con el sembrado.)
select is((select count(*)::int from dominio.presupuestos_tienda pt join dominio.comprobantes_venta c on c.id = pt.comprobante_id
            where pt.cuenta_cliente_id = 'ca000000-0000-0000-0000-000000000009' and c.estado = 'pendiente'), 10, '(g) la cuenta llegó a 10 presupuestos abiertos');
select is(pg_temp.fila('abiertos_10'), '{"estado":"limite_cuenta"}'::jsonb, '(g) con 10 abiertos: limite_cuenta');
select is(pg_temp.fila('abiertos_11'), '{"estado":"limite_cuenta"}'::jsonb, '(g) con 10 abiertos, el siguiente también: limite_cuenta');
-- Al aceptar uno (deja de estar pendiente) vuelve a poder crear exactamente uno.
update dominio.comprobantes_venta set estado = 'aceptado' where id = 'd0000000-0000-0000-0000-000000000001';
delete from public.limite_pedidos_publicos;
select pg_temp.como('f3000000-0000-0000-0000-00000000000a', '10.20.1.2');
insert into res values ('abiertos_9', publico.crear_presupuesto_tienda('pres-a.ejemplo.com', pg_temp.items('a1000000-0000-0000-0000-000000000002', '1'), null, 'c0000000-0000-0000-0000-0000000001e3'));
insert into res values ('abiertos_de_nuevo_10', publico.crear_presupuesto_tienda('pres-a.ejemplo.com', pg_temp.items('a1000000-0000-0000-0000-000000000002', '1'), null, 'c0000000-0000-0000-0000-0000000001e4'));
reset role;
select is(pg_temp.fila('abiertos_9') ->> 'estado', 'ok', '(g) con 9 abiertos (uno aceptado) se crea');
select is(pg_temp.fila('abiertos_de_nuevo_10'), '{"estado":"limite_cuenta"}'::jsonb, '(g) y el siguiente vuelve a ser limite_cuenta');

-- Cupo por hora de la tienda (FR-029, origen presupuesto): la sexta creación desde la misma IP de otra cuenta con topes libres.
delete from public.limite_pedidos_publicos;
select pg_temp.como('f3000000-0000-0000-0000-00000000000b', '10.30.0.1');
insert into res select 'ip_' || n, publico.crear_presupuesto_tienda('pres-a.ejemplo.com', pg_temp.items('a1000000-0000-0000-0000-000000000002', '1'), null, ('c0000000-0000-0000-0000-0000000002f' || n)::uuid)
  from generate_series(1, 6) n;
reset role;
select is((select count(*)::int from res where k ~ '^ip_[1-6]$' and v ->> 'estado' = 'ok'), 5, '(g) la cuenta «concurrente» crea 5 desde la misma IP (cupo por hora de la tienda = 5)');
select is((select v ->> 'estado' from res where k = 'ip_6'), 'limite_cuenta', '(g) la sexta es limite_cuenta');
-- El cupo por hora de la tienda: otra cuenta desde la MISMA IP (ya gastó 5 envíos de presupuesto) recibe `limite` con espera.
select pg_temp.como('f3000000-0000-0000-0000-000000000002', '10.30.0.1');
insert into res values ('cupo_tienda', publico.crear_presupuesto_tienda('pres-a.ejemplo.com', pg_temp.items('a1000000-0000-0000-0000-000000000002', '1'), null, 'c0000000-0000-0000-0000-0000000003a1'));
reset role;
select is(pg_temp.fila('cupo_tienda') ->> 'estado', 'limite', '(g) el cupo por hora de la tienda (5 por IP, compartido) responde limite');
select cmp_ok((pg_temp.fila('cupo_tienda') ->> 'espera_segundos')::int, '>=', 1, '(g) limite informa el tiempo de espera');
select is((select count(*)::int from dominio.presupuestos_tienda where clave_envio = 'c0000000-0000-0000-0000-0000000003a1'), 0, '(g) el límite de la tienda no creó nada');

-- ============================================================================
-- Cupo de LLAMADAS por cuenta (invariante 8): ANTES de cualquier cálculo, cuentan también las inválidas
-- ============================================================================
delete from public.limite_pedidos_publicos;
select pg_temp.como('f3000000-0000-0000-0000-000000000003', '10.40.0.1');   -- suspendida: no cuenta
select pg_temp.como('f3000000-0000-0000-0000-000000000002', '10.40.0.2');
insert into res select 'llamada_' || n, publico.crear_presupuesto_tienda('pres-a.ejemplo.com', null, null, gen_random_uuid()) from generate_series(1, 12) n;
insert into res values ('cot_llamada', publico.cotizar_presupuesto_tienda('pres-a.ejemplo.com', null));
reset role;
select is((select count(*)::int from res where k ~ '^llamada_' and v = '{"estado":"invalido","campos":["items"]}'::jsonb), 10, '(g) las primeras 10 llamadas (inválidas) del minuto se evalúan');
select is((select (v ->> 'espera_segundos')::int between 1 and 60 from res where k = 'llamada_12'), true, '(g) limite trae espera_segundos entre 1 y 60');
select is(pg_temp.fila('cot_llamada') ->> 'estado', 'invalido', '(g) el cupo de cotizaciones es otro (20 por minuto): cotizar sigue evaluándose');
delete from public.limite_pedidos_publicos;
select pg_temp.como('f3000000-0000-0000-0000-000000000002', '10.40.0.3');
insert into res select 'cotizacion_' || n, publico.cotizar_presupuesto_tienda('pres-a.ejemplo.com', null) from generate_series(1, 22) n;
reset role;
select is((select count(*)::int from res where k ~ '^cotizacion_' and v ->> 'estado' = 'limite'), 2, '(g) la cotización número 21 del minuto es limite');
select is((select count(*)::int from res where k ~ '^cotizacion_' and v ->> 'estado' = 'invalido'), 20, '(g) las primeras 20 cotizaciones del minuto se evalúan');
select is((select count(*)::int from public.limite_pedidos_publicos where visitante like 'cotizacion|ca000000-0000-0000-0000-000000000003%'), 1, '(g) el cupo de la cotización va por cuenta (clave cotizacion|<cuenta>)');

-- ============================================================================
-- Estructura de lo creado y una cuenta de otra organización crea lo suyo (SC-005)
-- ============================================================================
delete from public.limite_pedidos_publicos;
select pg_temp.como('f3000000-0000-0000-0000-000000000009', '10.50.0.1');
insert into res values ('org_dos', publico.crear_presupuesto_tienda('pres-x.ejemplo.com', pg_temp.items('a2000000-0000-0000-0000-000000000005', '2'), null, 'c0000000-0000-0000-0000-0000000004a1'));
insert into res values ('org_dos_con_producto_uno', publico.crear_presupuesto_tienda('pres-x.ejemplo.com', pg_temp.items('a1000000-0000-0000-0000-000000000001', '2'), null, 'c0000000-0000-0000-0000-0000000004a2'));
reset role;
select is(pg_temp.fila('org_dos') ->> 'estado', 'ok', 'SC-005: la cuenta de la organización 2 crea el suyo en su tienda');
select is((select to_jsonb(pt) ->> 'organizacion_id' from dominio.presupuestos_tienda pt where pt.clave_envio = 'c0000000-0000-0000-0000-0000000004a1'), '22222222-2222-2222-2222-222222222222',
  'SC-005: el presupuesto es de la organización 2');
select is((select c.numero from dominio.presupuestos_tienda pt join dominio.comprobantes_venta c on c.id = pt.comprobante_id where pt.clave_envio = 'c0000000-0000-0000-0000-0000000004a1'), '00000001',
  'la numeración es por tienda: la tienda X empieza en 00000001');
select is(pg_temp.fila('org_dos_con_producto_uno') ->> 'estado', 'no_disponible', 'SC-005: un producto de la organización 1 no existe para la tienda de la organización 2');
select is((select count(*)::int from dominio.comprobantes_venta_lineas l join dominio.comprobantes_venta c on c.id = l.comprobante_id and c.organizacion_id = l.organizacion_id
            where c.organizacion_id = '22222222-2222-2222-2222-222222222222' and l.producto_id <> 'a2000000-0000-0000-0000-000000000005'), 0, 'SC-005: ninguna línea de la organización 2 apunta a un producto ajeno');
-- Vista del panel: el operador de la organización 1 ve SOLO sus presupuestos de la tienda (RLS por organización, empresa y ventas).
select pg_temp.como('f3000000-0000-0000-0000-000000000007', '10.50.0.2');
select cmp_ok((select count(*)::int from dominio.presupuestos_tienda), '>', 0, 'el panel de la organización 1 lee los vínculos de su organización');
select is((select count(*)::int from dominio.presupuestos_tienda where organizacion_id = '22222222-2222-2222-2222-222222222222'), 0, 'SC-005: y ninguno de la organización 2');
select is((select count(*)::int from public.listar_presupuestos(null, null, null, 1, 200) where operador = 'Tienda online (cliente)'), (select count(*)::int from dominio.presupuestos_tienda), 'listar_presupuestos rotula «Tienda online (cliente)» en todos los de la tienda');
select is((select count(*)::int from public.listar_presupuestos(null, null, null, 1, 200) l
            where l.id in (select comprobante_id from dominio.presupuestos_tienda) and l.operador <> 'Tienda online (cliente)'), 0, 'listar_presupuestos ya no dice «Usuario sin nombre» para los de la tienda');
select is((select l.operador from public.listar_presupuestos(null, null, null, 1, 200) l where l.id = (pg_temp.fila('panel_cab') ->> 'id')::uuid), 'Usuario sin nombre'::text,
  'un presupuesto de canal tienda_online CON operador (el del panel, cuyo operador no tiene nombre) no cambia');
reset role;

-- ============================================================================
-- Q10: el operador modifica, copia, acepta y anula un presupuesto SIN operador_id con los flujos de siempre
-- ============================================================================
create temp table ids as
select (select comprobante_id from dominio.presupuestos_tienda where clave_envio = 'c0000000-0000-0000-0000-000000000010') as tienda,
       (select comprobante_id from dominio.presupuestos_tienda where clave_envio = 'c0000000-0000-0000-0000-000000000030') as tienda2,
       (select comprobante_id from dominio.presupuestos_tienda where clave_envio = 'c0000000-0000-0000-0000-000000000020') as tienda3,
       (pg_temp.fila('panel_cab') ->> 'id')::uuid as panel;
grant all on ids to public;
select pg_temp.como('f3000000-0000-0000-0000-000000000007', '10.55.0.1');
select is((select operador_id from dominio.comprobantes_venta where id = (select tienda from ids)), null::uuid, 'Q10: el presupuesto de la tienda no tiene operador');
-- Modificar: reemplazar las líneas (con el bloqueo optimista del comprobante).
select lives_ok($$select public.guardar_lineas_comprobante((select tienda from ids),
    jsonb_build_array(jsonb_build_object('producto_id', 'a1000000-0000-0000-0000-000000000002', 'cantidad', 2)),
    (select updated_at from dominio.comprobantes_venta where id = (select tienda from ids)))$$,
  'Q10: el operador MODIFICA las líneas de un presupuesto de la tienda (operador_id nulo)');
select is((select count(*)::int from dominio.comprobantes_venta_lineas where comprobante_id = (select tienda from ids)), 1, 'Q10: modificar dejó la línea nueva');
select is((select operador_id from dominio.comprobantes_venta where id = (select tienda from ids)), null::uuid, 'Q10: modificar no le asigna operador (sigue siendo de la tienda)');
-- Copiar: crea un presupuesto pendiente nuevo con las líneas, a nombre del operador que copia y SIN vínculo de la tienda.
select lives_ok($$select public.copiar_presupuesto((select tienda2 from ids))$$, 'Q10: el operador COPIA un presupuesto de la tienda');
select is((select count(*)::int from dominio.comprobantes_venta c where c.tipo = 'presupuesto' and c.operador_id = 'f3000000-0000-0000-0000-000000000007'
             and c.id <> (select panel from ids) and not exists (select 1 from dominio.presupuestos_tienda pt where pt.comprobante_id = c.id)), 1,
  'Q10: la copia es del operador (con su id) y no tiene vínculo de la tienda');
-- Aceptar.
select lives_ok($$select public.aceptar_presupuesto((select tienda2 from ids))$$, 'Q10: el operador ACEPTA un presupuesto de la tienda');
select is((select estado from dominio.comprobantes_venta where id = (select tienda2 from ids)), 'aceptado', 'Q10: queda aceptado');
-- «Anular»: el flujo vigente NO anula presupuestos (solo facturas confirmadas): se comporta IGUAL con un presupuesto sin operador que con uno de panel.
create temp table anular_res (k text primary key, v text);
grant all on anular_res to public;
do $$
declare v_c uuid; v_k text; v_r text;
begin
  for v_k, v_c in select 'tienda', (select tienda3 from ids) union all select 'panel', (select panel from ids) loop
    begin
      perform public.anular_comprobante(v_c, 'prueba', (select updated_at from dominio.comprobantes_venta where id = v_c));
      v_r := 'ok';
    exception when others then
      v_r := sqlstate;
    end;
    insert into anular_res values (v_k, v_r);
  end loop;
end $$;
select is((select v from anular_res where k = 'tienda'), (select v from anular_res where k = 'panel'),
  'Q10: anular un presupuesto de la tienda (operador nulo) da el MISMO resultado que anular uno de panel');
select is((select v from anular_res where k = 'tienda'), '22023', 'Q10: y es el rechazo vigente («Un presupuesto no se anula»): un presupuesto nunca se anula, ni de la tienda ni de panel');
reset role;

-- ============================================================================
-- M-1 y M-2: el origen «Tienda online» sale del VÍNCULO real, no de canal + operador nulo
-- ============================================================================
update dominio.comprobantes_venta set canal = 'mostrador' where id = (select tienda from ids);
update dominio.comprobantes_venta set canal = 'tienda_online', operador_id = null where id = (select panel from ids);
select pg_temp.como('f3000000-0000-0000-0000-000000000007', '10.55.0.2');
select is((select operador from public.listar_presupuestos(null, null, null, 1, 200) where id = (select tienda from ids)), 'Tienda online (cliente)',
  'M-1: cambiar el canal a mostrador NO pierde la etiqueta «Tienda online (cliente)» en Presupuestos');
select is((select operador from public.listar_presupuestos(null, null, null, 1, 200) where id = (select panel from ids)), 'Usuario sin nombre',
  'M-1: un presupuesto de panel con canal tienda_online y operador borrado NO se rotula como de la tienda');
select is(public.obtener_comprobante((select tienda from ids)) ->> 'de_tienda', 'true', 'M-1: obtener_comprobante marca de_tienda del presupuesto con vínculo (aunque su canal sea mostrador)');
select is(public.obtener_comprobante((select tienda from ids)) ->> 'operador', 'Tienda online (cliente)', 'M-1: y su operador es «Tienda online (cliente)»');
select is(public.obtener_comprobante((select panel from ids)) ->> 'de_tienda', 'false', 'M-1: el de panel con canal tienda_online sin operador NO es de_tienda');
select is(public.obtener_comprobante((select panel from ids)) ->> 'operador', 'Usuario sin nombre', 'M-1: y su operador no se rotula como de la tienda');
reset role;
-- M-2: la consulta común de Comprobantes (listado y CSV de comprobantes y presupuestos) aplica la misma regla.
select is((select c.operador from private.comprobantes_consulta('11111111-1111-1111-1111-111111111111', array['e1000000-0000-0000-0000-000000000001']::uuid[], array['presupuesto'],
            null, null, null, null, null, null, 200, 0) c where c.id = (select tienda from ids)), 'Tienda online (cliente)', 'M-2: comprobantes_consulta (CSV y listados) rotula el origen por el vínculo');
select is((select c.operador from private.comprobantes_consulta('11111111-1111-1111-1111-111111111111', array['e1000000-0000-0000-0000-000000000001']::uuid[], array['presupuesto'],
            null, null, null, null, null, null, 200, 0) c where c.id = (select panel from ids)), 'Usuario sin nombre', 'M-2: y no rotula el de panel con canal tienda_online sin operador');

-- ============================================================================
-- M-4: la nota (recorte con saltos de línea y caracteres invisibles bloqueados)
-- ============================================================================
delete from public.limite_pedidos_publicos;
select pg_temp.como('f3000000-0000-0000-0000-000000000001', '10.60.0.1');
insert into res values ('nota_saltos', publico.crear_presupuesto_tienda('pres-a.ejemplo.com', pg_temp.items('a1000000-0000-0000-0000-000000000002', '1'), E'\n\n \t\r\n', 'c0000000-0000-0000-0000-0000000005a1'));
insert into res values ('nota_061c', publico.crear_presupuesto_tienda('pres-a.ejemplo.com', pg_temp.items('a1000000-0000-0000-0000-000000000002', '1'), E'hola\u061cchau', 'c0000000-0000-0000-0000-0000000005a2'));
insert into res values ('nota_200b', publico.crear_presupuesto_tienda('pres-a.ejemplo.com', pg_temp.items('a1000000-0000-0000-0000-000000000002', '1'), E'hola\u200bchau', 'c0000000-0000-0000-0000-0000000005a3'));
insert into res values ('nota_200d', publico.crear_presupuesto_tienda('pres-a.ejemplo.com', pg_temp.items('a1000000-0000-0000-0000-000000000002', '1'), E'hola\u200dchau', 'c0000000-0000-0000-0000-0000000005a4'));
insert into res values ('nota_2060', publico.crear_presupuesto_tienda('pres-a.ejemplo.com', pg_temp.items('a1000000-0000-0000-0000-000000000002', '1'), E'hola\u2060chau', 'c0000000-0000-0000-0000-0000000005a5'));
insert into res values ('nota_feff', publico.crear_presupuesto_tienda('pres-a.ejemplo.com', pg_temp.items('a1000000-0000-0000-0000-000000000002', '1'), E'\ufeffhola', 'c0000000-0000-0000-0000-0000000005a6'));
reset role;
select is(pg_temp.fila('nota_saltos') ->> 'estado', 'ok', 'M-4: una nota solo de saltos de línea y espacios es «sin nota»: el presupuesto se crea');
select is((select nota from dominio.presupuestos_tienda where clave_envio = 'c0000000-0000-0000-0000-0000000005a1'), null::text, 'M-4: y no guarda una nota vacía (el CHECK es coherente)');
select is((select count(*)::int from res where k in ('nota_061c', 'nota_200b', 'nota_200d', 'nota_2060', 'nota_feff') and v = '{"estado":"invalido","campos":["nota"]}'::jsonb), 5,
  'M-4: U+061C, U+200B, U+200D, U+2060 y U+FEFF en la nota se rechazan (invalido nota)');
-- El MISMO conjunto en la lista de pedido (B1, `enviar_lista_pedido`, migración 20270322100700).
select pg_temp.anonimo('10.80.0.1');
insert into res values ('b1_200b', publico.enviar_lista_pedido('pres-a.ejemplo.com', 'Ana', 'ana@example.com', E'a\u200bb', pg_temp.items('a1000000-0000-0000-0000-000000000002', '1'), 'c0000000-0000-0000-0000-0000000007a1'));
reset role;
select is(pg_temp.fila('b1_200b'), '{"estado":"invalido","campos":["nota"]}'::jsonb, 'M-4: la lista de pedido (B1) rechaza también los caracteres invisibles en la nota (mismo conjunto que B2 y el front)');
select throws_ok($$insert into dominio.presupuestos_tienda (organizacion_id, empresa_id, cuenta_cliente_id, cliente_id, comprobante_id, clave_envio, nota)
  values ('11111111-1111-1111-1111-111111111111', 'e1000000-0000-0000-0000-000000000001', 'ca000000-0000-0000-0000-000000000001', 'c1000000-0000-0000-0000-000000000001', (select tienda from ids), gen_random_uuid(), E'\n \t')$$,
  '23514', null, 'M-4: el CHECK de la tabla rechaza una nota solo de saltos de línea');

-- ============================================================================
-- (l) Ninguna respuesta lleva texto de Postgres ni datos internos
-- ============================================================================
select is((select count(*)::int from res where k !~ '^panel_(cab|lineas)$' and v::text ~* '(sqlstate|sqlerrm|violates|constraint|relation "|column "|duplicate key|syntax error|permission denied|row-level|pg_catalog|dominio\.|public\.|publico\.|private\.)'), 0,
  '(l) ninguna respuesta de la tabla de resultados lleva texto de Postgres, nombres de tablas ni de funciones');
select is((select count(*)::int from res where k !~ '^panel_(cab|lineas)$' and jsonb_typeof(v) <> 'object'), 0, '(l) todas las respuestas son objetos con estado');
select is((select count(*)::int from res where k !~ '^panel_(cab|lineas)$' and not (v ->> 'estado' = any (array['ok', 'invalido', 'sin_precio', 'no_disponible', 'limite', 'limite_cuenta', 'sin_acceso', 'error']))), 0,
  '(l) todos los estados pertenecen a la lista cerrada del contrato');
select is((select count(*)::int from res where k !~ '^panel_(cab|lineas)$' and v::text ~* '(organizacion_id|empresa_id|cliente_id|cuenta_cliente_id|comprobante_id|alicuota_id|promocion_id|precio_referencia|descuento_pct|operador)'), 0,
  '(l) ninguna respuesta filtra identificadores internos, referencias, promociones ni descuentos');

-- ============================================================================
-- M-3: el cupo de llamadas SOBREVIVE a una excepción (no se revierte con el bloque que falla)
-- ============================================================================
-- Se reemplaza el motor por uno que falla (dentro de esta transacción, que se deshace al final) y se cuenta el contador de la cuenta antes y después.
create or replace function private.motor_presupuesto_tienda(p_cuenta uuid, p_items jsonb)
returns table (orden integer, producto_id uuid, estado text, descripcion text, codigo text, cantidad integer, precio_unitario numeric, escala text, alicuota_id uuid,
  alicuota_porcentaje numeric, deposito_id uuid, a_pedido boolean, subtotal_sin_iva numeric, iva numeric, descuento_pct numeric, precio_referencia numeric, promocion_id uuid, disponible boolean)
language plpgsql security definer set search_path = '' as $$
begin
  raise exception 'falla provocada del motor';
end $$;
delete from public.limite_pedidos_publicos;
select pg_temp.como('f3000000-0000-0000-0000-000000000002', '10.70.0.1');
insert into res values ('m3_cotizar_1', publico.cotizar_presupuesto_tienda('pres-a.ejemplo.com', pg_temp.items('a1000000-0000-0000-0000-000000000001', '1')));
insert into res values ('m3_crear_1', publico.crear_presupuesto_tienda('pres-a.ejemplo.com', pg_temp.items('a1000000-0000-0000-0000-000000000001', '1'), null, 'c0000000-0000-0000-0000-0000000006a1'));
reset role;
select is(pg_temp.fila('m3_cotizar_1'), '{"estado":"error"}'::jsonb, 'M-3: cotizar con el motor roto responde error genérico');
select is(pg_temp.fila('m3_crear_1'), '{"estado":"error"}'::jsonb, 'M-3: crear con el motor roto responde error genérico');
select is((select pedidos from public.limite_pedidos_publicos where visitante = 'cotizacion|ca000000-0000-0000-0000-000000000003'), 1, 'M-3: la cotización fallida GASTÓ cupo de llamadas (el contador no se revirtió)');
select is((select pedidos from public.limite_pedidos_publicos where visitante = 'presupuesto|ca000000-0000-0000-0000-000000000003'), 1, 'M-3: la creación fallida GASTÓ cupo de llamadas (el contador no se revirtió)');
-- Y por lo tanto el abuso por la vía del error también tiene límite: 11 llamadas con el motor roto en el minuto, la 11 es `limite`.
select pg_temp.como('f3000000-0000-0000-0000-000000000002', '10.70.0.2');
insert into res select 'm3_rep_' || lpad(n::text, 2, '0'), publico.crear_presupuesto_tienda('pres-a.ejemplo.com', pg_temp.items('a1000000-0000-0000-0000-000000000001', '1'), null, gen_random_uuid()) from generate_series(1, 10) n;
reset role;
select is((select count(*)::int from res where k ~ '^m3_rep_' and v ->> 'estado' = 'error'), 9, 'M-3: con el motor roto las primeras llamadas del minuto dan error...');
select is((select count(*)::int from res where k ~ '^m3_rep_' and v ->> 'estado' = 'limite'), 1, 'M-3: ...y a la undécima llamada del minuto (contando la de arriba) responde limite: el cupo sobrevivió a las excepciones');

select * from finish();
rollback;
