-- MSF-816 (gate MSF-834 · MSF-363 decisión 6): el mostrador y los comprobantes cobran el precio promocional.
-- Cubre FR-001…FR-007, FR-013, FR-015, FR-023, FR-024 y SC-001, SC-002, SC-003: una sola función de precio de
-- línea, la precedencia «gana el más bajo, sin acumular», el snapshot en la línea, la bandera apagada idéntica a
-- hoy, la vigencia de la promoción, el aislamiento por tienda y por organización, los permisos (quien vende
-- cobra la promoción sin el permiso `productos`), la inmutabilidad de lo ya emitido y la medición de 200 líneas.
-- Las fechas son RELATIVAS a now() (no dependen del día en que corre).
begin;

select no_plan();

-- ============================================================================
-- Fixture
-- ============================================================================

insert into organizaciones (id, nombre) values
  ('11111111-1111-1111-1111-111111111111', 'Organización Uno'),
  ('22222222-2222-2222-2222-222222222222', 'Organización Dos');

insert into auth.users (id, email) values
  ('e1000000-0000-0000-0000-000000000001', 'admin-uno@example.com'),
  ('e1000000-0000-0000-0000-000000000002', 'operador-uno@example.com'),
  ('e1000000-0000-0000-0000-000000000003', 'consulta-uno@example.com'),
  ('e2000000-0000-0000-0000-000000000001', 'admin-dos@example.com');

insert into usuarios_organizacion (user_id, organizacion_id, rol_id, estado) values
  ('e1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'administrador', 'activo'),
  ('e1000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'operador', 'activo'),
  ('e1000000-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111', 'consulta', 'activo'),
  ('e2000000-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', 'administrador', 'activo');

-- Tienda A y Tienda B de la organización uno; Tienda Dos de la organización dos.
insert into dominio.empresas (id, organizacion_id, nombre) values
  ('f1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'Tienda A'),
  ('f1000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'Tienda B'),
  ('f2000000-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', 'Tienda Dos');

insert into usuarios_empresas (user_id, empresa_id, organizacion_id, rol_id) values
  ('e1000000-0000-0000-0000-000000000002', 'f1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'operador'),
  ('e1000000-0000-0000-0000-000000000003', 'f1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'consulta');

-- Clientes: minorista, mayorista y dos con descuento (F-VTA-32).
insert into clientes (id, organizacion_id, numero, nombre, tipo, descuento, archivado_en) values
  ('c1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 10, 'Minorista', 'minorista', null, null),
  ('c1000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 11, 'Mayorista', 'mayorista', null, null),
  ('c1000000-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111', 12, 'Quince por ciento', 'minorista', 15, null),
  ('c1000000-0000-0000-0000-000000000004', '11111111-1111-1111-1111-111111111111', 13, 'Cinco por ciento', 'minorista', 5, null);

insert into dominio.categorias (id, organizacion_id, nombre) values
  ('c1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'General');

-- Productos: todos de lista 1.000 ARS. Alfa tiene escalas (x5 900 · x10 800 · x50 700); Beta y Delta tienen
-- precio propio 950 en la Tienda A; Gamma tiene x10 800.
insert into dominio.productos (id, organizacion_id, nombre, sku, moneda, precio_lista, categoria_id, activo) values
  ('a1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'Alfa', 'ALF-1', 'ARS', 1000, 'c1000000-0000-0000-0000-000000000001', true),
  ('a1000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'Beta', 'BET-2', 'ARS', 1000, 'c1000000-0000-0000-0000-000000000001', true),
  ('a1000000-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111', 'Gamma', 'GAM-3', 'ARS', 1000, 'c1000000-0000-0000-0000-000000000001', true),
  ('a1000000-0000-0000-0000-000000000004', '11111111-1111-1111-1111-111111111111', 'Delta', 'DEL-4', 'ARS', 1000, 'c1000000-0000-0000-0000-000000000001', true),
  ('a1000000-0000-0000-0000-000000000005', '11111111-1111-1111-1111-111111111111', 'Epsilon', 'EPS-5', 'ARS', 1000, 'c1000000-0000-0000-0000-000000000001', true),
  ('a1000000-0000-0000-0000-000000000006', '11111111-1111-1111-1111-111111111111', 'Zeta', 'ZET-6', 'ARS', 1000, 'c1000000-0000-0000-0000-000000000001', true),
  ('a1000000-0000-0000-0000-000000000007', '11111111-1111-1111-1111-111111111111', 'Eta', 'ETA-7', 'ARS', 1000, 'c1000000-0000-0000-0000-000000000001', true),
  ('a1000000-0000-0000-0000-000000000008', '11111111-1111-1111-1111-111111111111', 'Theta', 'THE-8', 'ARS', 1000, 'c1000000-0000-0000-0000-000000000001', true),
  ('a2000000-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', 'Ajeno', 'AJE-9', 'ARS', 700, null, true);

insert into dominio.producto_precios_escala (producto_id, organizacion_id, escala, precio) values
  ('a1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'x5', 900),
  ('a1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'x10', 800),
  ('a1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'x50', 700),
  ('a1000000-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111', 'x10', 800);

insert into dominio.precios_propios_empresa (producto_id, empresa_id, organizacion_id, moneda, importe) values
  ('a1000000-0000-0000-0000-000000000002', 'f1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'ARS', 950),
  ('a1000000-0000-0000-0000-000000000004', 'f1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'ARS', 950);

insert into dominio.producto_empresa (producto_id, empresa_id, organizacion_id) values
  ('a1000000-0000-0000-0000-000000000001', 'f1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111'),
  ('a1000000-0000-0000-0000-000000000001', 'f1000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111');

-- Promociones: vigentes (Alfa 900 · Beta 900 · Gamma 700 · Delta 980 · Eta 900 en la Tienda B),
-- vencida (Epsilon 500), programada (Zeta 500) y anulada (Theta 900).
insert into dominio.promociones_precio (id, organizacion_id, empresa_id, producto_id, precio_promocional, desde, hasta, anulada_at) values
  ('d1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'f1000000-0000-0000-0000-000000000001', 'a1000000-0000-0000-0000-000000000001', 900, now() - interval '1 hour', now() + interval '1 day', null),
  ('d1000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'f1000000-0000-0000-0000-000000000001', 'a1000000-0000-0000-0000-000000000002', 900, now() - interval '1 hour', now() + interval '1 day', null),
  ('d1000000-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111', 'f1000000-0000-0000-0000-000000000001', 'a1000000-0000-0000-0000-000000000003', 700, now() - interval '1 hour', now() + interval '1 day', null),
  ('d1000000-0000-0000-0000-000000000004', '11111111-1111-1111-1111-111111111111', 'f1000000-0000-0000-0000-000000000001', 'a1000000-0000-0000-0000-000000000004', 980, now() - interval '1 hour', now() + interval '1 day', null),
  ('d1000000-0000-0000-0000-000000000005', '11111111-1111-1111-1111-111111111111', 'f1000000-0000-0000-0000-000000000002', 'a1000000-0000-0000-0000-000000000007', 900, now() - interval '1 hour', now() + interval '1 day', null),
  ('d1000000-0000-0000-0000-000000000006', '11111111-1111-1111-1111-111111111111', 'f1000000-0000-0000-0000-000000000001', 'a1000000-0000-0000-0000-000000000005', 500, now() - interval '2 days', now() - interval '1 day', null),
  ('d1000000-0000-0000-0000-000000000007', '11111111-1111-1111-1111-111111111111', 'f1000000-0000-0000-0000-000000000001', 'a1000000-0000-0000-0000-000000000006', 500, now() + interval '1 day', now() + interval '2 days', null),
  ('d1000000-0000-0000-0000-000000000008', '11111111-1111-1111-1111-111111111111', 'f1000000-0000-0000-0000-000000000001', 'a1000000-0000-0000-0000-000000000008', 900, now() - interval '1 hour', now() + interval '1 day', now()),
  ('d2000000-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', 'f2000000-0000-0000-0000-000000000001', 'a2000000-0000-0000-0000-000000000001', 500, now() - interval '1 hour', now() + interval '1 day', null);

-- El depósito principal de la organización uno vende en la Tienda A y en la Tienda B.
create temp table datos as
  select (select id from dominio.depositos where organizacion_id = '11111111-1111-1111-1111-111111111111' and por_defecto) as principal;
grant select on datos to public;

insert into dominio.depositos_empresas (deposito_id, empresa_id, organizacion_id)
select principal, e, '11111111-1111-1111-1111-111111111111'
  from (values ('f1000000-0000-0000-0000-000000000001'::uuid), ('f1000000-0000-0000-0000-000000000002'::uuid)) x(e)
on conflict do nothing;

insert into dominio.existencias (producto_id, organizacion_id, cantidad, reservado)
select p, '11111111-1111-1111-1111-111111111111', 100, 0
  from (values ('a1000000-0000-0000-0000-000000000001'::uuid), ('a1000000-0000-0000-0000-000000000003'::uuid)) x(p)
on conflict (producto_id) do update set cantidad = excluded.cantidad, reservado = excluded.reservado;
insert into dominio.existencias_deposito (producto_id, deposito_id, organizacion_id, cantidad, reservado)
select p, (select principal from datos), '11111111-1111-1111-1111-111111111111', 100, 0
  from (values ('a1000000-0000-0000-0000-000000000001'::uuid), ('a1000000-0000-0000-0000-000000000003'::uuid)) x(p)
on conflict (producto_id, deposito_id) do update set cantidad = excluded.cantidad, reservado = excluded.reservado;

create function pg_temp.como(p_user uuid) returns void language plpgsql as $$
begin
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
  set local role authenticated;
end $$;

-- Misma identidad pero sin cambiar de rol: permite llamar a las funciones de `private` (que el rol no puede
-- ejecutar) como postgres, con los permisos y la organización de esa persona.
create function pg_temp.con_claims(p_user uuid) returns void language plpgsql as $$
begin
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
end $$;

create temp table comps (clave text primary key, id uuid, actualizado timestamptz);
grant select, insert, update on comps to public;

-- Crea un comprobante en la Tienda A y guarda sus líneas como el operador.
create function pg_temp.armar(p_clave text, p_cliente uuid, p_lineas jsonb) returns void language plpgsql as $$
declare v_c dominio.comprobantes_venta;
begin
  v_c := public.crear_comprobante('factura', 'f1000000-0000-0000-0000-000000000001', p_cliente, 'mostrador', current_date);
  insert into comps (clave, id, actualizado) values (p_clave, v_c.id, v_c.updated_at);
  if p_lineas is not null then
    perform public.guardar_lineas_comprobante(v_c.id, p_lineas, v_c.updated_at);
    update comps set actualizado = (select c.updated_at from dominio.comprobantes_venta c where c.id = v_c.id)
     where clave = p_clave;
  end if;
end $$;

-- Re-guarda las líneas de un comprobante que ya existe (para repetir la medición).
create function pg_temp.guardar(p_clave text, p_lineas jsonb) returns void language plpgsql as $$
begin
  perform public.guardar_lineas_comprobante(
    (select id from comps where clave = p_clave),
    p_lineas,
    (select actualizado from comps where clave = p_clave));
  update comps set actualizado = (select c.updated_at from dominio.comprobantes_venta c where c.id = (select id from comps where clave = p_clave))
   where clave = p_clave;
end $$;

-- La línea del comprobante: «precio:referencia:descuento».
create function pg_temp.linea(p_clave text) returns text language plpgsql as $$
declare v_texto text;
begin
  select l.precio_unitario::text || ':' || coalesce(l.precio_referencia::text, '-') || ':' || l.descuento_pct::text
    into v_texto
    from dominio.comprobantes_venta_lineas l
   where l.comprobante_id = (select id from comps where clave = p_clave)
   order by l.orden
   limit 1;
  return v_texto;
end $$;

-- La bandera de las promociones (MSF-363, decisión 15) nace APAGADA: este archivo la enciende para probar el
-- comportamiento de siempre.
update public.banderas_plataforma set activa = true where clave = 'promociones_precio';

-- ============================================================================
-- FR-006, FR-007, FR-023 · estructura de la migración
-- ============================================================================

select is(
  (select data_type from information_schema.columns
    where table_schema = 'dominio' and table_name = 'comprobantes_venta_lineas' and column_name = 'precio_referencia'),
  'numeric', 'la línea suma la columna precio_referencia'
);
select is(
  (select data_type from information_schema.columns
    where table_schema = 'dominio' and table_name = 'comprobantes_venta_lineas' and column_name = 'promocion_id'),
  'uuid', 'la línea suma la columna promocion_id'
);
select is(
  (select count(*)::int from pg_constraint c
    join pg_class t on t.oid = c.conrelid
   where t.relname = 'comprobantes_venta_lineas' and c.conname = 'comprobantes_venta_lineas_promocion_fk'
     and c.contype = 'f' and c.confdeltype = 'a'),
  1, 'la FK a la promoción es no action (no rompe la baja de la organización)'
);
select is(
  (select count(*)::int from pg_constraint c
    join pg_class t on t.oid = c.conrelid
   where t.relname = 'promociones_precio' and c.conname = 'promociones_precio_id_organizacion_uk' and c.contype = 'u'),
  1, 'la promoción tiene el unique (id, organizacion_id) que exige la FK compuesta'
);
select is(
  (select count(*)::int from dominio.comprobantes_venta_lineas where precio_referencia is not null or promocion_id is not null),
  0, 'la migración no escribe filas existentes'
);
select is(
  has_table_privilege('authenticated', 'dominio.comprobantes_venta_lineas', 'insert')
    or has_table_privilege('authenticated', 'dominio.comprobantes_venta_lineas', 'update'),
  false, 'nadie escribe las líneas directo: solo la RPC'
);
select is(
  (select count(*) from unnest(array[
    'private.precio_linea_venta(uuid,uuid,text,integer,numeric,timestamptz,boolean)',
    'private.promocion_vigente_fila(uuid,uuid,timestamptz)',
    'private.lineas_con_promocion_desactualizada(uuid,timestamptz)'
  ]) as f where has_function_privilege('public', f::regprocedure, 'execute'))::int,
  0, 'nadie fuera de la base ejecuta las funciones de cálculo'
);
select is(
  (select count(*) from unnest(array[
    'private.precio_linea_venta(uuid,uuid,text,integer,numeric,timestamptz,boolean)',
    'private.promocion_vigente_fila(uuid,uuid,timestamptz)'
  ]) as f where has_function_privilege('anon', f::regprocedure, 'execute'))::int,
  0, 'anon no ejecuta las funciones de cálculo'
);

-- ============================================================================
-- FR-003, SC-001 · precedencia: gana el más bajo, sin acumular
-- ============================================================================

select pg_temp.como('e1000000-0000-0000-0000-000000000002');

-- Fila 1: minorista, cantidad 1. Normal 1.000, promoción 900 → cobra 900 (referencia 1.000).
select pg_temp.armar('f1', 'c1000000-0000-0000-0000-000000000001',
  jsonb_build_array(jsonb_build_object('producto_id', 'a1000000-0000-0000-0000-000000000001', 'cantidad', 1)));
reset role;
select is(pg_temp.linea('f1'), '900.00:1000.00:0.00', 'minorista 1 unidad: cobra la promoción y deja la referencia del precio normal');
select is(
  (select l.promocion_id from dominio.comprobantes_venta_lineas l where l.comprobante_id = (select id from comps where clave = 'f1')),
  'd1000000-0000-0000-0000-000000000001'::uuid, 'la línea guarda la promoción aplicada'
);
select is(
  (select row(l.subtotal_sin_iva, l.iva)::text from dominio.comprobantes_venta_lineas l where l.comprobante_id = (select id from comps where clave = 'f1')),
  '(900.00,189.00)', 'el IVA se calcula sobre el precio cobrado (21 %)'
);

-- Fila 2: mayorista, 10 unidades (escala x10 = 800). La promoción (900) es MAYOR: cobra 800, sin referencia.
select pg_temp.como('e1000000-0000-0000-0000-000000000002');
select pg_temp.armar('f2', 'c1000000-0000-0000-0000-000000000002',
  jsonb_build_array(jsonb_build_object('producto_id', 'a1000000-0000-0000-0000-000000000001', 'cantidad', 10)));
reset role;
select is(pg_temp.linea('f2'), '800.00:-:0.00', 'mayorista 10 unidades: la escala x10 es más baja que la promoción y gana');

-- Fila 3: mayorista, 3 unidades (x1). Normal 1.000, promoción 900 → cobra 900.
select pg_temp.como('e1000000-0000-0000-0000-000000000002');
select pg_temp.armar('f3', 'c1000000-0000-0000-0000-000000000002',
  jsonb_build_array(jsonb_build_object('producto_id', 'a1000000-0000-0000-0000-000000000001', 'cantidad', 3)));
reset role;
select is(pg_temp.linea('f3'), '900.00:1000.00:0.00', 'mayorista 3 unidades: rige x1 y gana la promoción');

-- Fila 4: cliente con 15 % de descuento. Normal 850, promoción 900 → cobra 850 (el descuento es más bajo).
select pg_temp.como('e1000000-0000-0000-0000-000000000002');
select pg_temp.armar('f4', 'c1000000-0000-0000-0000-000000000003',
  jsonb_build_array(jsonb_build_object('producto_id', 'a1000000-0000-0000-0000-000000000001', 'cantidad', 1)));
reset role;
select is(pg_temp.linea('f4'), '850.00:-:15.00', 'con 15 % de descuento: cobra el precio con descuento (850), no la promoción');

-- Fila 5: cliente con 5 % de descuento. Normal 950, promoción 900 → cobra 900 y NO acumula el descuento.
select pg_temp.como('e1000000-0000-0000-0000-000000000002');
select pg_temp.armar('f5', 'c1000000-0000-0000-0000-000000000004',
  jsonb_build_array(jsonb_build_object('producto_id', 'a1000000-0000-0000-0000-000000000001', 'cantidad', 1)));
reset role;
select is(pg_temp.linea('f5'), '900.00:950.00:0.00', 'con 5 % de descuento: gana la promoción y el descuento no se aplica (950 es la referencia)');

-- Fila 6: precio propio de la tienda 950, promoción 900 → cobra 900 (la promoción baja el precio propio).
select pg_temp.como('e1000000-0000-0000-0000-000000000002');
select pg_temp.armar('f6', 'c1000000-0000-0000-0000-000000000001',
  jsonb_build_array(jsonb_build_object('producto_id', 'a1000000-0000-0000-0000-000000000002', 'cantidad', 1)));
reset role;
select is(pg_temp.linea('f6'), '900.00:950.00:0.00', 'precio propio 950 y promoción 900: cobra 900 y la referencia es el precio propio');

-- Fila 7: precio propio 950 y promoción 980 (mayor) → cobra 950: una promoción mayor al normal se ignora.
select pg_temp.como('e1000000-0000-0000-0000-000000000002');
select pg_temp.armar('f7', 'c1000000-0000-0000-0000-000000000001',
  jsonb_build_array(jsonb_build_object('producto_id', 'a1000000-0000-0000-0000-000000000004', 'cantidad', 1)));
reset role;
select is(pg_temp.linea('f7'), '950.00:-:0.00', 'precio propio 950 y promoción 980: cobra 950, la promoción mayor se ignora');

-- Fila 8: promoción 700 con x10 = 800 (mayorista, 10 unidades) → cobra 700 (la más baja).
select pg_temp.como('e1000000-0000-0000-0000-000000000002');
select pg_temp.armar('f8', 'c1000000-0000-0000-0000-000000000002',
  jsonb_build_array(jsonb_build_object('producto_id', 'a1000000-0000-0000-0000-000000000003', 'cantidad', 10)));
reset role;
select is(pg_temp.linea('f8'), '700.00:800.00:0.00', 'promoción 700 contra x10 800: cobra 700 y la referencia es el precio de escala');

-- Fila 9: precio manual 700 con promoción 900 → cobra 700 (el manual manda), sin referencia ni promoción.
select pg_temp.como('e1000000-0000-0000-0000-000000000002');
select pg_temp.armar('f9', 'c1000000-0000-0000-0000-000000000001',
  jsonb_build_array(jsonb_build_object('producto_id', 'a1000000-0000-0000-0000-000000000001', 'cantidad', 1, 'precio_manual', 700)));
reset role;
select is(pg_temp.linea('f9'), '700.00:-:0.00', 'precio manual: manda el manual, sin referencia ni promoción');
select is(
  (select l.precio_manual from dominio.comprobantes_venta_lineas l where l.comprobante_id = (select id from comps where clave = 'f9')),
  true, 'la línea con precio manual queda marcada como manual'
);

-- Fila 10: promoción de la Tienda B, venta en la Tienda A → cobra 1.000, sin referencia.
select pg_temp.como('e1000000-0000-0000-0000-000000000002');
select pg_temp.armar('f10', 'c1000000-0000-0000-0000-000000000001',
  jsonb_build_array(jsonb_build_object('producto_id', 'a1000000-0000-0000-0000-000000000007', 'cantidad', 1)));
reset role;
select is(pg_temp.linea('f10'), '1000.00:-:0.00', 'la promoción de otra tienda no aplica: cobra el precio normal');

-- ============================================================================
-- FR-002 · vigencia: vencida, programada y anulada cobran el precio normal
-- ============================================================================

select pg_temp.como('e1000000-0000-0000-0000-000000000002');
select pg_temp.armar('vencida', 'c1000000-0000-0000-0000-000000000001',
  jsonb_build_array(jsonb_build_object('producto_id', 'a1000000-0000-0000-0000-000000000005', 'cantidad', 1)));
select pg_temp.armar('programada', 'c1000000-0000-0000-0000-000000000001',
  jsonb_build_array(jsonb_build_object('producto_id', 'a1000000-0000-0000-0000-000000000006', 'cantidad', 1)));
select pg_temp.armar('anulada', 'c1000000-0000-0000-0000-000000000001',
  jsonb_build_array(jsonb_build_object('producto_id', 'a1000000-0000-0000-0000-000000000008', 'cantidad', 1)));
reset role;
select is(pg_temp.linea('vencida'), '1000.00:-:0.00', 'promoción vencida: cobra el precio normal');
select is(pg_temp.linea('programada'), '1000.00:-:0.00', 'promoción programada: cobra el precio normal');
select is(pg_temp.linea('anulada'), '1000.00:-:0.00', 'promoción anulada: cobra el precio normal');

-- Los bordes de `desde`/`hasta`: la promoción rige en [desde, hasta).
select is(
  (select p.precio from private.promocion_vigente_fila('a1000000-0000-0000-0000-000000000001', 'f1000000-0000-0000-0000-000000000001',
     (select p.desde from dominio.promociones_precio p where p.id = 'd1000000-0000-0000-0000-000000000001'))),
  900::numeric, 'en el instante de `desde` la promoción ya rige'
);
select is(
  (select p.precio from private.promocion_vigente_fila('a1000000-0000-0000-0000-000000000001', 'f1000000-0000-0000-0000-000000000001',
     (select p.hasta from dominio.promociones_precio p where p.id = 'd1000000-0000-0000-0000-000000000001'))),
  null::numeric, 'en el instante de `hasta` la promoción ya no rige'
);

-- Medianoche de Buenos Aires: la promoción rige por instante, sin conversión de zona. Con `hasta` =
-- 2027-03-10 00:00-03, a las 23:59:59.999-03 del día 9 todavía rige y a las 00:00:00-03 del día 10 ya no.
insert into dominio.promociones_precio (id, organizacion_id, empresa_id, producto_id, precio_promocional, desde, hasta) values
  ('d1000000-0000-0000-0000-000000000009', '11111111-1111-1111-1111-111111111111', 'f1000000-0000-0000-0000-000000000001', 'a1000000-0000-0000-0000-000000000008', 900, timestamptz '2027-03-01 00:00:00-03', timestamptz '2027-03-10 00:00:00-03');
select pg_temp.con_claims('e1000000-0000-0000-0000-000000000002');
select is(
  (select p.neto_unitario from private.precio_linea_venta('a1000000-0000-0000-0000-000000000008', 'f1000000-0000-0000-0000-000000000001', 'minorista', 1, 0, timestamptz '2027-03-09 23:59:59.999-03') p),
  900::numeric, 'a las 23:59:59.999-03 del día anterior a `hasta` la promoción todavía rige'
);
select is(
  (select p.neto_unitario from private.precio_linea_venta('a1000000-0000-0000-0000-000000000008', 'f1000000-0000-0000-0000-000000000001', 'minorista', 1, 0, timestamptz '2027-03-10 00:00:00-03') p),
  1000::numeric, 'a las 00:00:00-03 del día de `hasta` la promoción ya no rige'
);
reset role;

-- ============================================================================
-- FR-005, SC-002 · con la bandera apagada el resultado es idéntico al de hoy
-- ============================================================================

update public.banderas_plataforma set activa = false where clave = 'promociones_precio';
select pg_temp.como('e1000000-0000-0000-0000-000000000002');
select pg_temp.armar('apagada', 'c1000000-0000-0000-0000-000000000001',
  jsonb_build_array(jsonb_build_object('producto_id', 'a1000000-0000-0000-0000-000000000001', 'cantidad', 1)));
reset role;
select is(pg_temp.linea('apagada'), '1000.00:-:0.00', 'con la bandera apagada cobra el precio normal');
select is(
  (select row(l.precio_unitario, l.escala, l.descuento_pct, l.subtotal_sin_iva, l.iva)::text
     from dominio.comprobantes_venta_lineas l where l.comprobante_id = (select id from comps where clave = 'apagada')),
  '(1000.00,x1,0.00,1000.00,210.00)', 'con la bandera apagada cada columna de la línea es la de siempre'
);
select is(
  (select row(c.total_sin_iva, c.total_con_iva)::text from dominio.comprobantes_venta c where c.id = (select id from comps where clave = 'apagada')),
  '(1000.00,1210.00)', 'con la bandera apagada los totales son los de siempre'
);
select pg_temp.con_claims('e1000000-0000-0000-0000-000000000002');
select is(
  (select p.neto_unitario from private.precio_linea_venta('a1000000-0000-0000-0000-000000000001', 'f1000000-0000-0000-0000-000000000001', 'minorista', 1, 0, now()) p),
  1000::numeric, 'con la bandera apagada la función de precio devuelve el precio normal'
);
reset role;
update public.banderas_plataforma set activa = true where clave = 'promociones_precio';

-- ============================================================================
-- FR-013 · permisos: quien vende cobra la promoción sin el permiso `productos`
-- ============================================================================

update public.permisos_rol set nivel = 'ninguno'
 where organizacion_id = '11111111-1111-1111-1111-111111111111' and rol_id = 'operador' and seccion = 'productos';
select pg_temp.como('e1000000-0000-0000-0000-000000000002');
select pg_temp.armar('sin_productos', 'c1000000-0000-0000-0000-000000000001',
  jsonb_build_array(jsonb_build_object('producto_id', 'a1000000-0000-0000-0000-000000000001', 'cantidad', 1)));
reset role;
select is(pg_temp.linea('sin_productos'), '900.00:1000.00:0.00', 'sin permiso de productos: el mostrador igual cobra la promoción');
update public.permisos_rol set nivel = 'lectura'
 where organizacion_id = '11111111-1111-1111-1111-111111111111' and rol_id = 'operador' and seccion = 'productos';

-- Un rol sin ventas en edición no guarda líneas.
select pg_temp.como('e1000000-0000-0000-0000-000000000003');
select throws_ok(
  format($$select public.guardar_lineas_comprobante(%L, %L::jsonb, %L)$$,
    (select id from comps where clave = 'f1'),
    '[{"producto_id":"a1000000-0000-0000-0000-000000000001","cantidad":1}]',
    (select actualizado from comps where clave = 'f1')),
  '42501', 'un rol de solo lectura no guarda líneas');
reset role;

-- `authenticated` no puede escribir las líneas ni ejecutar las funciones de cálculo.
select is(
  has_function_privilege('authenticated', 'private.precio_linea_venta(uuid,uuid,text,integer,numeric,timestamptz,boolean)', 'execute'),
  false, 'authenticated no ejecuta la función de precio de línea'
);
select is(
  has_function_privilege('authenticated', 'private.promocion_vigente_fila(uuid,uuid,timestamptz)', 'execute'),
  false, 'authenticated no ejecuta la lectura de la promoción'
);
select is(
  has_function_privilege('anon', 'public.guardar_lineas_comprobante(uuid,jsonb,timestamptz)', 'execute'),
  false, 'anon no guarda líneas'
);

-- Las claves `precio_referencia` y `promocion_id` del payload se ignoran.
select pg_temp.como('e1000000-0000-0000-0000-000000000002');
select pg_temp.armar('inyectada', 'c1000000-0000-0000-0000-000000000001',
  jsonb_build_array(jsonb_build_object('producto_id', 'a1000000-0000-0000-0000-000000000001', 'cantidad', 1,
    'precio_referencia', 1, 'promocion_id', 'd1000000-0000-0000-0000-000000000008')));
reset role;
select is(pg_temp.linea('inyectada'), '900.00:1000.00:0.00', 'el payload no puede inyectar la referencia ni la promoción');

-- ============================================================================
-- FR-015 · obtener_comprobante expone la referencia y NO la promoción
-- ============================================================================

select pg_temp.como('e1000000-0000-0000-0000-000000000002');
select is(
  (select public.obtener_comprobante((select id from comps where clave = 'f1')) -> 'lineas' -> 0 ->> 'precio_referencia'),
  '1000.00', 'obtener_comprobante devuelve la referencia de la línea'
);
select is(
  (select public.obtener_comprobante((select id from comps where clave = 'f1')) -> 'lineas' -> 0 ? 'promocion_id'),
  false, 'obtener_comprobante NO expone el identificador de la promoción'
);
reset role;

-- ============================================================================
-- FR-002, FR-013 · aislamiento: otra organización y otra tienda
-- ============================================================================

-- La promoción de la organización dos no alcanza a la de la uno.
select is(
  (select count(*)::int from private.promocion_vigente_fila('a2000000-0000-0000-0000-000000000001', 'f1000000-0000-0000-0000-000000000001', now())),
  0, 'la promoción de otra organización no aplica'
);
-- Un producto de otra organización se rechaza en la línea.
select pg_temp.como('e1000000-0000-0000-0000-000000000002');
select throws_ok(
  format($$select public.guardar_lineas_comprobante(%L, %L::jsonb, %L)$$,
    (select id from comps where clave = 'f1'),
    '[{"producto_id":"a2000000-0000-0000-0000-000000000001","cantidad":1}]',
    (select actualizado from comps where clave = 'f1')),
  '22023', 'un producto de otra organización se rechaza');
reset role;

-- ============================================================================
-- FR-007, SC-003 · lo ya emitido no cambia
-- ============================================================================

-- Se confirma una factura con una línea en promoción.
select pg_temp.como('e1000000-0000-0000-0000-000000000002');
select pg_temp.armar('confirmada', 'c1000000-0000-0000-0000-000000000001',
  jsonb_build_array(jsonb_build_object('producto_id', 'a1000000-0000-0000-0000-000000000001', 'cantidad', 1)));
select lives_ok(
  format($$select public.confirmar_comprobante(%L)$$, (select id from comps where clave = 'confirmada')),
  'confirma la factura con la línea en promoción'
);
reset role;
select is(
  (select row(l.precio_unitario, l.precio_referencia)::text from dominio.comprobantes_venta_lineas l
    where l.comprobante_id = (select id from comps where clave = 'confirmada')),
  '(900.00,1000.00)', 'la factura confirmada guarda el precio cobrado y su referencia'
);
select is(
  (select row(c.total_sin_iva, c.total_con_iva)::text from dominio.comprobantes_venta c where c.id = (select id from comps where clave = 'confirmada')),
  '(900.00,1089.00)', 'los totales del comprobante confirmado son los del precio cobrado'
);

-- Se anula, se edita y se vence una promoción: la factura no se mueve.
update dominio.promociones_precio set anulada_at = now() where id = 'd1000000-0000-0000-0000-000000000001';
update dominio.promociones_precio set precio_promocional = 950 where id = 'd1000000-0000-0000-0000-000000000002';
update dominio.promociones_precio set hasta = now() - interval '1 hour' where id = 'd1000000-0000-0000-0000-000000000003';
select is(
  (select row(l.precio_unitario, l.precio_referencia)::text from dominio.comprobantes_venta_lineas l
    where l.comprobante_id = (select id from comps where clave = 'confirmada')),
  '(900.00,1000.00)', 'anular, editar o vencer una promoción no cambia un comprobante emitido'
);
-- Se restauran las promociones para el resto del archivo.
update dominio.promociones_precio set anulada_at = null where id = 'd1000000-0000-0000-0000-000000000001';
update dominio.promociones_precio set precio_promocional = 900 where id = 'd1000000-0000-0000-0000-000000000002';
update dominio.promociones_precio set hasta = now() + interval '1 day' where id = 'd1000000-0000-0000-0000-000000000003';

-- La baja de la organización con una línea promocional no falla (FK `no action`).
insert into organizaciones (id, nombre) values ('33333333-3333-3333-3333-333333333333', 'Organización Tres');
insert into dominio.empresas (id, organizacion_id, nombre)
  values ('f3000000-0000-0000-0000-000000000001', '33333333-3333-3333-3333-333333333333', 'Tienda Tres');
insert into clientes (id, organizacion_id, numero, nombre, tipo, archivado_en)
  values ('c3000000-0000-0000-0000-000000000001', '33333333-3333-3333-3333-333333333333', 1, 'Cliente Tres', 'minorista', null);
insert into dominio.productos (id, organizacion_id, nombre, sku, moneda, precio_lista, activo)
  values ('a3000000-0000-0000-0000-000000000001', '33333333-3333-3333-3333-333333333333', 'Producto Tres', 'TRE-1', 'ARS', 1000, true);
insert into dominio.promociones_precio (id, organizacion_id, empresa_id, producto_id, precio_promocional, desde, hasta)
  values ('d3000000-0000-0000-0000-000000000001', '33333333-3333-3333-3333-333333333333', 'f3000000-0000-0000-0000-000000000001',
          'a3000000-0000-0000-0000-000000000001', 900, now() - interval '1 hour', now() + interval '1 day');
insert into dominio.comprobantes_venta (id, organizacion_id, empresa_id, cliente_id, tipo, numero, fecha, estado, total_sin_iva, total_con_iva)
  values ('e3000000-0000-0000-0000-000000000001', '33333333-3333-3333-3333-333333333333', 'f3000000-0000-0000-0000-000000000001',
          'c3000000-0000-0000-0000-000000000001', 'factura', '00000001', current_date, 'confirmada', 900, 1089);
insert into dominio.comprobantes_venta_lineas (organizacion_id, comprobante_id, orden, producto_id, descripcion, cantidad,
  precio_unitario, escala, subtotal_sin_iva, iva, precio_referencia, promocion_id)
  values ('33333333-3333-3333-3333-333333333333', 'e3000000-0000-0000-0000-000000000001', 1, 'a3000000-0000-0000-0000-000000000001',
          'Producto Tres', 1, 900, 'x1', 900, 189, 1000, 'd3000000-0000-0000-0000-000000000001');
select lives_ok(
  $$delete from organizaciones where id = '33333333-3333-3333-3333-333333333333'$$,
  'la baja de una organización con una línea promocional no falla'
);

-- ============================================================================
-- FR-024 · 200 líneas: con la bandera encendida no se multiplica el tiempo
-- ============================================================================

insert into dominio.productos (id, organizacion_id, nombre, sku, moneda, precio_lista, activo)
select ('b1000000-0000-0000-0000-' || lpad(i::text, 12, '0'))::uuid, '11111111-1111-1111-1111-111111111111',
       'Medición ' || i, 'MED-' || lpad(i::text, 4, '0'), 'ARS', 1000, true
  from generate_series(1, 200) i;
insert into dominio.promociones_precio (id, organizacion_id, empresa_id, producto_id, precio_promocional, desde, hasta)
select ('c3000000-0000-0000-0000-' || lpad(i::text, 12, '0'))::uuid, '11111111-1111-1111-1111-111111111111',
       'f1000000-0000-0000-0000-000000000001', ('b1000000-0000-0000-0000-' || lpad(i::text, 12, '0'))::uuid,
       900, now() - interval '1 hour', now() + interval '1 day'
  from generate_series(1, 200) i;

select pg_temp.con_claims('e1000000-0000-0000-0000-000000000002');
do $$
declare
  v_lineas jsonb;
  v_t0 timestamptz;
  v_t1 timestamptz;
  v_apagada double precision;
  v_encendida double precision;
begin
  select jsonb_agg(jsonb_build_object('producto_id', p.id, 'cantidad', 1)) into v_lineas
    from dominio.productos p
   where p.sku like 'MED-%';

  perform pg_temp.armar('medicion', 'c1000000-0000-0000-0000-000000000001', null);

  -- Con la bandera apagada.
  update public.banderas_plataforma set activa = false where clave = 'promociones_precio';
  select clock_timestamp() into v_t0;
  perform pg_temp.guardar('medicion', v_lineas);
  select clock_timestamp() into v_t1;
  v_apagada := extract(epoch from (v_t1 - v_t0));

  -- Con la bandera encendida (misma carga, con promoción en cada producto).
  update public.banderas_plataforma set activa = true where clave = 'promociones_precio';
  select clock_timestamp() into v_t0;
  perform pg_temp.guardar('medicion', v_lineas);
  select clock_timestamp() into v_t1;
  v_encendida := extract(epoch from (v_t1 - v_t0));

  -- Tolerancia de 50 ms: lo que se vigila es que la promoción no multiplique el tiempo por un factor.
  if v_encendida > v_apagada * 1.5 + 0.05 then
    raise exception 'Con la bandera encendida las 200 líneas tardaron % s contra % s con la bandera apagada', v_encendida, v_apagada;
  end if;
end $$;

select is(
  (select count(*)::int from dominio.comprobantes_venta_lineas where comprobante_id = (select id from comps where clave = 'medicion')),
  200, 'la medición guardó las 200 líneas'
);
select is(
  (select count(*)::int from dominio.comprobantes_venta_lineas
    where comprobante_id = (select id from comps where clave = 'medicion') and precio_referencia = 1000 and promocion_id is not null),
  200, 'las 200 líneas cobraron el precio promocional con su referencia'
);

select * from finish();
rollback;
