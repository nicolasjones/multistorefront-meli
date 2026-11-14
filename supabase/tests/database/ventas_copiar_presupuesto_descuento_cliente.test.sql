-- MSF-933 (S2 de la épica MSF-816, hallazgo 3 de la spec 20261113-120000-precio-promocional-en-pos-y-comprobantes):
-- `copiar_presupuesto` cobra el descuento del cliente igual que el mostrador (`guardar_lineas_comprobante`) y sin
-- acumularlo con la promoción: gana el más bajo.
-- Para cada combinación cliente × producto se arma un presupuesto original por `guardar_lineas_comprobante` (el cálculo
-- del mostrador), se lo copia con `copiar_presupuesto` y se comparan, línea por línea, precio, descuento, escala,
-- referencia, promoción y subtotal, y los totales: la copia cobra lo mismo. Además valores exactos (5 % lista 1000 = 950,
-- 15 % contra promoción 900 = 850, 5 % contra promoción 900 = 900 sin descuento, empate promoción = normal),
-- precio manual conservado, bandera `promociones_precio` apagada (descuento sí, promoción no), descuento vigente al copiar,
-- clientes sin descuento sin cambios, original intacto y aislamiento por organización.
begin;

select no_plan();

insert into organizaciones (id, nombre) values
  ('11111111-1111-1111-1111-111111111111', 'Organización Uno'),
  ('22222222-2222-2222-2222-222222222222', 'Organización Dos');
insert into auth.users (id, email) values
  ('f9000000-0000-0000-0000-000000000001', 'operador-s2@example.com'),
  ('f9000000-0000-0000-0000-000000000002', 'consulta-s2@example.com'),
  ('f9200000-0000-0000-0000-000000000001', 'operador-dos-s2@example.com');
insert into usuarios_organizacion (user_id, organizacion_id, rol_id, estado) values
  ('f9000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'operador', 'activo'),
  ('f9000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'consulta', 'activo'),
  ('f9200000-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', 'operador', 'activo');
insert into dominio.empresas (id, organizacion_id, nombre) values
  ('a9000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'Tienda A'),
  ('a9000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'Tienda B'),
  ('a9200000-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', 'Empresa Dos');
insert into usuarios_empresas (user_id, empresa_id, organizacion_id, rol_id) values
  ('f9000000-0000-0000-0000-000000000001', 'a9000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'operador'),
  ('f9000000-0000-0000-0000-000000000002', 'a9000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'consulta'),
  ('f9200000-0000-0000-0000-000000000001', 'a9200000-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', 'operador');

-- Clientes: c1 minorista sin descuento · c2 5 % · c3 15 % · c4 mayorista 10 % · c9 de la org 2 con 20 %.
insert into clientes (id, organizacion_id, numero, nombre, tipo, archivado_en, descuento) values
  ('c9000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 10, 'Minorista sin descuento', 'minorista', null, null),
  ('c9000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 11, 'Cliente 5 %', 'minorista', null, 5),
  ('c9000000-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111', 12, 'Cliente 15 %', 'minorista', null, 15),
  ('c9000000-0000-0000-0000-000000000004', '11111111-1111-1111-1111-111111111111', 13, 'Mayorista 10 %', 'mayorista', null, 10),
  ('c9200000-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', 10, 'Cliente org dos 20 %', 'minorista', null, 20);

insert into dominio.categorias (id, organizacion_id, nombre) values
  ('c1900000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'Joysticks'),
  ('c2900000-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', 'Ajena');
-- P1 lista 1000 sin promoción · P2 lista 1000 con promoción 900 · P3 lista 1000 con promoción 980 · P4 lista 1000 con
-- escala x5 900 · P5 org 2 lista 500 con promoción 400.
insert into dominio.productos (id, organizacion_id, nombre, sku, moneda, precio_lista, categoria_id, disponibilidad_manual, activo)
select ('b9000000-0000-0000-0000-' || lpad(n::text, 12, '0'))::uuid, '11111111-1111-1111-1111-111111111111',
       'Producto ' || n, 'S2-' || n, 'ARS', 1000, 'c1900000-0000-0000-0000-000000000001', null, true
  from generate_series(1, 4) n;
insert into dominio.productos (id, organizacion_id, nombre, sku, moneda, precio_lista, categoria_id, disponibilidad_manual, activo) values
  ('b9200000-0000-0000-0000-000000000005', '22222222-2222-2222-2222-222222222222', 'Ajeno 5', 'S2-5', 'ARS', 500, 'c2900000-0000-0000-0000-000000000001', null, true);
insert into dominio.producto_precios_escala (producto_id, organizacion_id, escala, precio) values
  ('b9000000-0000-0000-0000-000000000004', '11111111-1111-1111-1111-111111111111', 'x5', 900);

insert into dominio.depositos_empresas (deposito_id, empresa_id, organizacion_id)
select d.id, 'a9000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111'
  from dominio.depositos d where d.organizacion_id = '11111111-1111-1111-1111-111111111111' and d.por_defecto
on conflict do nothing;
insert into dominio.depositos_empresas (deposito_id, empresa_id, organizacion_id)
select d.id, 'a9200000-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222'
  from dominio.depositos d where d.organizacion_id = '22222222-2222-2222-2222-222222222222' and d.por_defecto
on conflict do nothing;

insert into dominio.promociones_precio (id, organizacion_id, empresa_id, producto_id, precio_promocional, desde, hasta) values
  ('e9000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'a9000000-0000-0000-0000-000000000001', 'b9000000-0000-0000-0000-000000000002', 900, now() - interval '1 day', now() + interval '1 day'),
  ('e9000000-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111', 'a9000000-0000-0000-0000-000000000001', 'b9000000-0000-0000-0000-000000000003', 980, now() - interval '1 day', now() + interval '1 day'),
  ('e9200000-0000-0000-0000-000000000005', '22222222-2222-2222-2222-222222222222', 'a9200000-0000-0000-0000-000000000001', 'b9200000-0000-0000-0000-000000000005', 400, now() - interval '1 day', now() + interval '1 day');

grant select on dominio.comprobantes_venta_lineas to authenticated;

create function pg_temp.como(p_user uuid) returns void language plpgsql as $$
begin
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
  set local role authenticated;
end $$;
create function pg_temp.bandera(p_activa boolean) returns void language plpgsql as $$
begin
  reset role;
  update public.banderas_plataforma set activa = p_activa where clave = 'promociones_precio';
end $$;

create temp table comps (clave text primary key, id uuid);
grant select, insert, update on comps to public;
create function pg_temp.id_de(p_clave text) returns uuid language sql as $$ select id from comps where clave = p_clave $$;
create function pg_temp.upd(p_clave text) returns timestamptz language sql security definer as $$
  select updated_at from dominio.comprobantes_venta where id = (select id from comps where clave = p_clave) $$;
-- Crea un presupuesto original y le guarda líneas con el cálculo del mostrador (guardar_lineas_comprobante).
create function pg_temp.original(p_clave text, p_empresa uuid, p_cliente uuid, p_lineas jsonb) returns void language plpgsql as $$
declare v_c dominio.comprobantes_venta;
begin
  v_c := public.crear_comprobante('presupuesto', p_empresa, p_cliente, 'mostrador', '2027-03-01');
  insert into comps (clave, id) values (p_clave, v_c.id);
  perform public.guardar_lineas_comprobante(v_c.id, p_lineas, v_c.updated_at);
end $$;
create function pg_temp.copiar(p_clave text, p_de text) returns void language plpgsql as $$
declare v_c dominio.comprobantes_venta;
begin
  v_c := public.copiar_presupuesto(pg_temp.id_de(p_de));
  insert into comps (clave, id) values (p_clave, v_c.id);
end $$;
create function pg_temp.l(p_n integer, p_cant integer, p_manual numeric default null) returns jsonb language sql as $$
  select jsonb_strip_nulls(jsonb_build_object(
    'producto_id', 'b9000000-0000-0000-0000-' || lpad(p_n::text, 12, '0'), 'cantidad', p_cant, 'precio_manual', p_manual));
$$;
-- «precio|descuento|referencia|promoción?|escala|subtotal» de las líneas, en orden.
create function pg_temp.res(p_clave text) returns text language sql security definer as $$
  select string_agg(l.precio_unitario::text || '|' || l.descuento_pct::text || '|' || coalesce(l.precio_referencia::text, '-')
         || '|' || (l.promocion_id is not null)::text || '|' || l.escala || '|' || l.subtotal_sin_iva::text, ' ' order by l.orden)
    from dominio.comprobantes_venta_lineas l where l.comprobante_id = (select id from comps where clave = p_clave) $$;
create function pg_temp.totales(p_clave text) returns text language sql security definer as $$
  select c.total_sin_iva::text || '|' || c.total_con_iva::text from dominio.comprobantes_venta c where c.id = (select id from comps where clave = p_clave) $$;
grant execute on function pg_temp.res(text), pg_temp.totales(text), pg_temp.id_de(text), pg_temp.upd(text) to public;

-- ============================================================================
-- Bandera ENCENDIDA: descuento del cliente y promoción, gana el más bajo
-- ============================================================================
select pg_temp.bandera(true);
select pg_temp.como('f9000000-0000-0000-0000-000000000001');

-- Original por el cálculo del mostrador y su copia, para cada cliente × producto.
select pg_temp.original('o_c2_p1', 'a9000000-0000-0000-0000-000000000001', 'c9000000-0000-0000-0000-000000000002', jsonb_build_array(pg_temp.l(1, 2)));
select pg_temp.original('o_c3_p2', 'a9000000-0000-0000-0000-000000000001', 'c9000000-0000-0000-0000-000000000003', jsonb_build_array(pg_temp.l(2, 2)));
select pg_temp.original('o_c2_p2', 'a9000000-0000-0000-0000-000000000001', 'c9000000-0000-0000-0000-000000000002', jsonb_build_array(pg_temp.l(2, 2)));
select pg_temp.original('o_c2_p3', 'a9000000-0000-0000-0000-000000000001', 'c9000000-0000-0000-0000-000000000002', jsonb_build_array(pg_temp.l(3, 2)));
select pg_temp.original('o_c1_p1', 'a9000000-0000-0000-0000-000000000001', 'c9000000-0000-0000-0000-000000000001', jsonb_build_array(pg_temp.l(1, 2)));
select pg_temp.original('o_c1_p2', 'a9000000-0000-0000-0000-000000000001', 'c9000000-0000-0000-0000-000000000001', jsonb_build_array(pg_temp.l(2, 2)));
select pg_temp.original('o_c4_p4', 'a9000000-0000-0000-0000-000000000001', 'c9000000-0000-0000-0000-000000000004', jsonb_build_array(pg_temp.l(4, 5)));
select pg_temp.original('o_mix', 'a9000000-0000-0000-0000-000000000001', 'c9000000-0000-0000-0000-000000000002',
  jsonb_build_array(pg_temp.l(1, 1), pg_temp.l(2, 1), pg_temp.l(3, 1), pg_temp.l(1, 1, 640), pg_temp.l(2, 1, 700)));

select pg_temp.copiar('k_c2_p1', 'o_c2_p1');
select pg_temp.copiar('k_c3_p2', 'o_c3_p2');
select pg_temp.copiar('k_c2_p2', 'o_c2_p2');
select pg_temp.copiar('k_c2_p3', 'o_c2_p3');
select pg_temp.copiar('k_c1_p1', 'o_c1_p1');
select pg_temp.copiar('k_c1_p2', 'o_c1_p2');
select pg_temp.copiar('k_c4_p4', 'o_c4_p4');
select pg_temp.copiar('k_mix', 'o_mix');

-- Valores exactos del mostrador (los originales) y de la copia.
select is(pg_temp.res('o_c2_p1'), '950.00|5.00|-|false|x1|1900.00', 'mostrador: cliente 5 % sobre lista 1000 cobra 950 con descuento_pct 5');
select is(pg_temp.res('k_c2_p1'), '950.00|5.00|-|false|x1|1900.00', 'copia: cliente 5 % sobre lista 1000 cobra 950 con descuento_pct 5 (antes cobraba 1000 sin descuento)');
select is(pg_temp.res('k_c3_p2'), '850.00|15.00|-|false|x1|1700.00', 'copia: cliente 15 % (850) contra promoción 900: gana el descuento, sin referencia ni promoción');
select is(pg_temp.res('k_c2_p2'), '900.00|0.00|950.00|true|x1|1800.00', 'copia: cliente 5 % (950) contra promoción 900: gana la promoción, referencia 950 y descuento_pct 0 (sin acumular)');
select is(pg_temp.res('k_c2_p3'), '950.00|5.00|-|false|x1|1900.00', 'copia: cliente 5 % (950) contra promoción 980: gana el descuento, no la promoción más cara');
select is(pg_temp.res('k_c1_p1'), '1000.00|0.00|-|false|x1|2000.00', 'copia: cliente sin descuento ni promoción: precio de lista, como siempre');
select is(pg_temp.res('k_c1_p2'), '900.00|0.00|1000.00|true|x1|1800.00', 'copia: cliente sin descuento con promoción 900: gana la promoción con referencia 1000');
select is(pg_temp.res('k_c4_p4'), '810.00|10.00|-|false|x5|4050.00', 'copia: mayorista 10 % con cantidad 5: escala x5 (900) menos 10 % = 810');
select is(pg_temp.res('k_mix'), '950.00|5.00|-|false|x1|950.00 900.00|0.00|950.00|true|x1|900.00 950.00|5.00|-|false|x1|950.00 640.00|0.00|-|false|x1|640.00 700.00|0.00|-|false|x1|700.00',
  'copia con varias líneas: descuento, promoción, descuento contra promoción más cara y precios manuales conservados (640 y 700 sobre un producto con promoción: sin descuento, referencia ni promoción)');

-- Paridad: la copia cobra lo mismo que el original calculado por el mostrador, línea por línea y en los totales.
select is((select count(*)::int from (values
    ('o_c2_p1','k_c2_p1'),('o_c3_p2','k_c3_p2'),('o_c2_p2','k_c2_p2'),('o_c2_p3','k_c2_p3'),
    ('o_c1_p1','k_c1_p1'),('o_c1_p2','k_c1_p2'),('o_c4_p4','k_c4_p4'),('o_mix','k_mix')) v(o, k)
   where pg_temp.res(o) is distinct from pg_temp.res(k) or pg_temp.totales(o) is distinct from pg_temp.totales(k)), 0,
  'paridad con el mostrador: en las 8 combinaciones la copia tiene las mismas líneas y los mismos totales que el original');
select is(pg_temp.totales('k_c2_p2'), '1800.00|2178.00', 'totales de la copia con promoción ganadora: 1800 sin IVA y 2178 con IVA 21 %');
select is(pg_temp.totales('k_c2_p1'), '1900.00|2299.00', 'totales de la copia con descuento: 1900 sin IVA y 2299 con IVA 21 %');
select is(pg_temp.res('o_c2_p1'), '950.00|5.00|-|false|x1|1900.00', 'el original no se modifica al copiarlo');

-- ============================================================================
-- Bandera APAGADA: el descuento del cliente rige igual (es la corrección); la promoción no
-- ============================================================================
select pg_temp.bandera(false);
select pg_temp.como('f9000000-0000-0000-0000-000000000001');
select pg_temp.original('of_c2_p1', 'a9000000-0000-0000-0000-000000000001', 'c9000000-0000-0000-0000-000000000002', jsonb_build_array(pg_temp.l(1, 2)));
select pg_temp.original('of_c2_p2', 'a9000000-0000-0000-0000-000000000001', 'c9000000-0000-0000-0000-000000000002', jsonb_build_array(pg_temp.l(2, 2)));
select pg_temp.original('of_c1_p2', 'a9000000-0000-0000-0000-000000000001', 'c9000000-0000-0000-0000-000000000001', jsonb_build_array(pg_temp.l(2, 2), pg_temp.l(1, 1, 640)));
select pg_temp.copiar('kf_c2_p1', 'of_c2_p1');
select pg_temp.copiar('kf_c2_p2', 'of_c2_p2');
select pg_temp.copiar('kf_c1_p2', 'of_c1_p2');
select is(pg_temp.res('kf_c2_p1'), '950.00|5.00|-|false|x1|1900.00', 'bandera apagada: la copia aplica el descuento del cliente (950)');
select is(pg_temp.res('kf_c2_p2'), '950.00|5.00|-|false|x1|1900.00', 'bandera apagada: con promoción cargada la copia no la usa (950 por el descuento, sin referencia)');
select is(pg_temp.res('kf_c1_p2'), '1000.00|0.00|-|false|x1|2000.00 640.00|0.00|-|false|x1|640.00',
  'bandera apagada, cliente sin descuento: igual que antes (lista 1000; manual 640 conservado)');
select is((select count(*)::int from (values ('of_c2_p1','kf_c2_p1'),('of_c2_p2','kf_c2_p2'),('of_c1_p2','kf_c1_p2')) v(o, k)
            where pg_temp.res(o) is distinct from pg_temp.res(k) or pg_temp.totales(o) is distinct from pg_temp.totales(k)), 0,
  'bandera apagada: la copia coincide con el original del mostrador en líneas y totales');

-- ============================================================================
-- Descuento vigente al copiar, empate y aislamiento por organización
-- ============================================================================
select pg_temp.bandera(true);
reset role;
-- El cambio de descuento lo restringe un disparador a administradores: acá se salta como dueño (fixture).
set local session_replication_role = replica;
update public.clientes set descuento = 10 where id = 'c9000000-0000-0000-0000-000000000002';
set local session_replication_role = origin;
select pg_temp.como('f9000000-0000-0000-0000-000000000001');
select pg_temp.copiar('k_dto_nuevo', 'o_c2_p1');
select is(pg_temp.res('k_dto_nuevo'), '900.00|10.00|-|false|x1|1800.00',
  'el descuento que rige es el vigente del cliente al copiar (10 %, como hace el mostrador al reeditar): 900 con descuento_pct 10');
select is(pg_temp.res('o_c2_p1'), '950.00|5.00|-|false|x1|1900.00', '... y el original conserva el precio con el descuento de entonces');
select is((select count(*)::int from dominio.comprobantes_venta_lineas where comprobante_id = pg_temp.id_de('k_dto_nuevo') and descuento_pct = 10 and precio_referencia is null), 1,
  'la línea copiada guarda descuento_pct = 10');

-- Defensa en profundidad: un presupuesto cuyo cliente quedó en OTRA organización (fila inconsistente forzada como dueño)
-- no se copia ni toma su descuento: «El cliente del presupuesto ya no existe» (22023).
select pg_temp.original('o_cruzado', 'a9000000-0000-0000-0000-000000000001', 'c9000000-0000-0000-0000-000000000002', jsonb_build_array(pg_temp.l(1, 1)));
reset role;
set local session_replication_role = replica;
update dominio.comprobantes_venta set cliente_id = 'c9200000-0000-0000-0000-000000000001' where id = pg_temp.id_de('o_cruzado');
set local session_replication_role = origin;
select pg_temp.como('f9000000-0000-0000-0000-000000000001');
select throws_ok(format($$select public.copiar_presupuesto(%L)$$, pg_temp.id_de('o_cruzado')), '22023', null,
  'un presupuesto con un cliente de otra organización no se copia (el descuento de la org 2 no se filtra a la org 1)');

-- Organización 2: descuento 20 % sobre lista 500 = 400, igual a la promoción 400: la promoción no gana (no es menor).
select pg_temp.como('f9200000-0000-0000-0000-000000000001');
select pg_temp.original('o_dos', 'a9200000-0000-0000-0000-000000000001', 'c9200000-0000-0000-0000-000000000001',
  jsonb_build_array(jsonb_build_object('producto_id', 'b9200000-0000-0000-0000-000000000005', 'cantidad', 1)));
select pg_temp.copiar('k_dos', 'o_dos');
select is(pg_temp.res('k_dos'), '400.00|20.00|-|false|x1|400.00',
  'org 2: descuento 20 % (400) y promoción 400 empatan: gana el descuento (la promoción tiene que ser estrictamente menor)');
select is(pg_temp.res('k_dos'), pg_temp.res('o_dos'), 'org 2: la copia coincide con el original');
-- La organización 2 no puede copiar un presupuesto de la organización 1 ni lo ve.
select throws_ok(format($$select public.copiar_presupuesto(%L)$$, pg_temp.id_de('o_c2_p1')), 'P0002', null,
  'aislamiento: otra organización no copia el presupuesto (P0002), así que su descuento de cliente no se filtra');
-- Un usuario de consulta no copia (permiso sin cambios).
select pg_temp.como('f9000000-0000-0000-0000-000000000002');
select throws_ok(format($$select public.copiar_presupuesto(%L)$$, pg_temp.id_de('o_c2_p1')), '42501', null, 'consulta no copia presupuestos (42501)');
reset role;
-- Cliente de otra organización con descuento no cambia el de la org 1: el de la org 1 sigue en 10 %.
select is((select descuento from public.clientes where id = 'c9000000-0000-0000-0000-000000000002'), 10::numeric, 'control: el cliente de la org 1 conserva su descuento');
select is(has_function_privilege('anon', 'public.copiar_presupuesto(uuid)', 'execute'), false, 'anon no ejecuta copiar_presupuesto');
select is(has_function_privilege('authenticated', 'public.copiar_presupuesto(uuid)', 'execute'), true, 'authenticated sigue ejecutando copiar_presupuesto');
select is((select prosecdef and proconfig = array['search_path=""'] from pg_proc where oid = 'public.copiar_presupuesto(uuid)'::regprocedure), true,
  'copiar_presupuesto sigue security definer con search_path vacío');

select * from finish();
rollback;
