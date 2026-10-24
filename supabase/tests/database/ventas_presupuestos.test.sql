-- F-VTA-08 (MSF-331, épica MSF-159): presupuesto — aceptar, copiar y listar. Cubre SC-007: aceptar idempotente y
-- con su evento, no aceptar un vencido ni una factura, copiar sin tocar el original (precios recalculados con la
-- lista vigente salvo manual), `vencido` derivado de `valido_hasta`, búsqueda, filtros por estado y tienda,
-- paginación, aislamiento entre organizaciones y empresas, `lectura` sin acciones y `anon` sin acceso.
-- Matriz de `ventas`: administrador y operador `edicion`; consulta `lectura`.
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
  ('a1000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'Segunda tienda'),
  ('a2000000-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', 'Empresa Dos');

-- El operador y la consulta solo ven San Javucho; el administrador ve ambas tiendas.
insert into usuarios_empresas (user_id, empresa_id, organizacion_id, rol_id) values
  ('f1000000-0000-0000-0000-000000000002', 'a1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'operador'),
  ('f1000000-0000-0000-0000-000000000003', 'a1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'consulta');

insert into clientes (id, organizacion_id, numero, nombre, tipo) values
  ('c5000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 10, 'Distribuidora Norte', 'mayorista'),
  ('c5000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 11, 'Cliente minorista', 'minorista'),
  ('c6000000-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', 20, 'Cliente Dos', 'minorista');

insert into dominio.categorias (id, organizacion_id, nombre) values
  ('c1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'Joysticks');

-- Joystick: lista 1.000 y x5 = 900 (sin IVA, precios fijos); Cable: lista 500 con IVA propio 10,5 %.
insert into dominio.productos (id, organizacion_id, nombre, sku, moneda, precio_lista, categoria_id, activo) values
  ('b1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'Joystick', 'JOY-1', 'ARS', 1000, 'c1000000-0000-0000-0000-000000000001', true),
  ('b1000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'Cable', 'CAB-1', 'ARS', 500, 'c1000000-0000-0000-0000-000000000001', true);
insert into dominio.producto_precios_escala (producto_id, organizacion_id, escala, precio) values
  ('b1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'x5', 900);

insert into dominio.depositos_empresas (deposito_id, empresa_id, organizacion_id)
select d.id, 'a1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111'
  from dominio.depositos d where d.organizacion_id = '11111111-1111-1111-1111-111111111111' and d.por_defecto
on conflict do nothing;

create function pg_temp.como(p_user uuid) returns void language plpgsql as $$
begin
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
  set local role authenticated;
end $$;

create temp table comps (clave text primary key, id uuid);
grant select, insert, update on comps to public;

-- ============================================================================
-- Privilegios
-- ============================================================================
select is(
  (select count(*) from unnest(array[
    'public.aceptar_presupuesto(uuid)',
    'public.copiar_presupuesto(uuid)',
    'public.listar_presupuestos(text,text,uuid,integer,integer)'
  ]) as f where has_function_privilege('anon', f::regprocedure, 'execute'))::int,
  0, 'anon no ejecuta las RPC de presupuestos'
);
select is(
  (select count(*) from unnest(array[
    'public.aceptar_presupuesto(uuid)',
    'public.copiar_presupuesto(uuid)',
    'public.listar_presupuestos(text,text,uuid,integer,integer)'
  ]) as f where has_function_privilege('authenticated', f::regprocedure, 'execute'))::int,
  3, 'authenticated ejecuta las RPC de presupuestos'
);
select is(has_function_privilege('authenticated', 'private.hoy_argentina()', 'execute'),
  false, 'authenticated no ejecuta el helper de fecha');

-- ============================================================================
-- Datos: A (Norte, vigente, con líneas), B (vencido), C (vigente, se acepta), una factura y una tienda ajena
-- ============================================================================
select pg_temp.como('f1000000-0000-0000-0000-000000000002');
insert into comps (clave, id)
select 'A', c.id from public.crear_comprobante('presupuesto', 'a1000000-0000-0000-0000-000000000001',
  'c5000000-0000-0000-0000-000000000001', 'mostrador', '2026-10-24', '2099-12-31') c;
insert into comps (clave, id)
select 'B', c.id from public.crear_comprobante('presupuesto', 'a1000000-0000-0000-0000-000000000001',
  'c5000000-0000-0000-0000-000000000002', 'mostrador', '2020-01-01', '2020-01-10') c;
insert into comps (clave, id)
select 'C', c.id from public.crear_comprobante('presupuesto', 'a1000000-0000-0000-0000-000000000001',
  'c5000000-0000-0000-0000-000000000001', 'mostrador', '2026-10-24', '2099-12-31') c;
insert into comps (clave, id)
select 'F', c.id from public.crear_comprobante('factura', 'a1000000-0000-0000-0000-000000000001',
  'c5000000-0000-0000-0000-000000000001', 'mostrador', '2026-10-24') c;

select public.guardar_lineas_comprobante(
  (select id from comps where clave = 'A'),
  '[{"producto_id":"b1000000-0000-0000-0000-000000000001","cantidad":5},
    {"producto_id":"b1000000-0000-0000-0000-000000000002","cantidad":1,"precio_manual":123}]'::jsonb,
  (select updated_at from dominio.comprobantes_venta where id = (select id from comps where clave = 'A')));

select pg_temp.como('f1000000-0000-0000-0000-000000000001');
insert into comps (clave, id)
select 'D', c.id from public.crear_comprobante('presupuesto', 'a1000000-0000-0000-0000-000000000002',
  'c5000000-0000-0000-0000-000000000001', 'mostrador', '2026-10-24', '2099-12-31') c;
select pg_temp.como('f2000000-0000-0000-0000-000000000001');
insert into comps (clave, id)
select 'X', c.id from public.crear_comprobante('presupuesto', 'a2000000-0000-0000-0000-000000000001',
  'c6000000-0000-0000-0000-000000000001', 'mostrador', '2026-10-24', '2099-12-31') c;

-- ============================================================================
-- Aceptar (FR-050)
-- ============================================================================
select pg_temp.como('f1000000-0000-0000-0000-000000000002');
select is((select estado from public.aceptar_presupuesto((select id from comps where clave = 'C'))),
  'aceptado', 'aceptar pasa el presupuesto pendiente a aceptado');
create temp table tras_aceptar as
  select updated_at from dominio.comprobantes_venta where id = (select id from comps where clave = 'C');
grant select on tras_aceptar to public;
select lives_ok(format($$select public.aceptar_presupuesto(%L)$$, (select id from comps where clave = 'C')),
  'aceptar de nuevo no falla (idempotente)');
select is(
  (select updated_at from dominio.comprobantes_venta where id = (select id from comps where clave = 'C')),
  (select updated_at from tras_aceptar), 'el reintento no modifica el presupuesto');
select pg_temp.como('f1000000-0000-0000-0000-000000000001');
reset role;
select is(
  (select count(*)::int from public.registro_actividad
    where tipo = 'presupuesto.aceptado' and organizacion_id = '11111111-1111-1111-1111-111111111111'),
  1, 'se registra un solo evento presupuesto.aceptado, aunque se reintente');
select is(
  (select actor_id from public.registro_actividad where tipo = 'presupuesto.aceptado'),
  'f1000000-0000-0000-0000-000000000002'::uuid, 'el evento guarda quién aceptó');
select pg_temp.como('f1000000-0000-0000-0000-000000000002');
select throws_ok(
  format($$select public.guardar_comprobante(%L, 'c5000000-0000-0000-0000-000000000001', 'mostrador', '2026-10-24', null, null, null, now())$$,
    (select id from comps where clave = 'C')),
  '55000', null, 'un presupuesto aceptado no se modifica'
);
select is((public.obtener_comprobante((select id from comps where clave = 'C')) ->> 'editable')::boolean,
  false, 'un presupuesto aceptado no figura como editable');
select throws_ok(format($$select public.aceptar_presupuesto(%L)$$, (select id from comps where clave = 'B')),
  '55000', null, 'un presupuesto vencido no se acepta');
select throws_ok(format($$select public.aceptar_presupuesto(%L)$$, (select id from comps where clave = 'F')),
  'P0002', null, 'una factura no es un presupuesto: no se acepta');
select throws_ok(format($$select public.aceptar_presupuesto(%L)$$, (select id from comps where clave = 'D')),
  '42501', null, 'sin acceso a la tienda no se acepta');
select throws_ok(format($$select public.aceptar_presupuesto(%L)$$, (select id from comps where clave = 'X')),
  'P0002', null, 'un presupuesto de otra organización no existe');
select pg_temp.como('f1000000-0000-0000-0000-000000000003');
select throws_ok(format($$select public.aceptar_presupuesto(%L)$$, (select id from comps where clave = 'A')),
  '42501', null, 'con lectura no se acepta');

-- ============================================================================
-- Copiar (FR-051): el original no cambia y los precios se recalculan salvo el manual
-- ============================================================================
select pg_temp.como('f1000000-0000-0000-0000-000000000001');
reset role;
-- Cambia la lista vigente: el Joystick x5 pasa de 900 a 850.
update dominio.producto_precios_escala set precio = 850
 where producto_id = 'b1000000-0000-0000-0000-000000000001' and escala = 'x5';
update dominio.productos set precio_lista = 700 where id = 'b1000000-0000-0000-0000-000000000002';
create temp table original as
  select c.estado, c.updated_at, c.total_con_iva,
         (select count(*) from dominio.comprobantes_venta_lineas l where l.comprobante_id = c.id) as lineas,
         (select l.precio_unitario from dominio.comprobantes_venta_lineas l where l.comprobante_id = c.id and l.orden = 1) as precio1
    from dominio.comprobantes_venta c where c.id = (select id from comps where clave = 'A');
grant select on original to public;

select pg_temp.como('f1000000-0000-0000-0000-000000000002');
insert into comps (clave, id)
select 'A2', c.id from public.copiar_presupuesto((select id from comps where clave = 'A')) c;

select isnt((select id from comps where clave = 'A2'), (select id from comps where clave = 'A'), 'la copia es otro presupuesto');
select is((select estado from dominio.comprobantes_venta where id = (select id from comps where clave = 'A2')),
  'pendiente', 'la copia nace pendiente');
select is((select numero from dominio.comprobantes_venta where id = (select id from comps where clave = 'A2')),
  '00000004', 'la copia toma el número siguiente de la tienda');
select is((select cliente_id from dominio.comprobantes_venta where id = (select id from comps where clave = 'A2')),
  'c5000000-0000-0000-0000-000000000001'::uuid, 'la copia conserva el cliente');
select is((select fecha from dominio.comprobantes_venta where id = (select id from comps where clave = 'A2')),
  (select (now() at time zone 'America/Argentina/Buenos_Aires')::date), 'la copia lleva la fecha de hoy');
select is(
  (select c.valido_hasta - c.fecha from dominio.comprobantes_venta c where c.id = (select id from comps where clave = 'A2')),
  (select '2099-12-31'::date - '2026-10-24'::date), 'la copia conserva la duración de la validez');
select is((select operador_id from dominio.comprobantes_venta where id = (select id from comps where clave = 'A2')),
  'f1000000-0000-0000-0000-000000000002'::uuid, 'el operador de la copia es quien copia');
select is((select count(*)::int from dominio.comprobantes_venta_lineas where comprobante_id = (select id from comps where clave = 'A2')),
  2, 'la copia trae las mismas líneas');
select is(
  (select l.precio_unitario from dominio.comprobantes_venta_lineas l where l.comprobante_id = (select id from comps where clave = 'A2') and l.orden = 1),
  850::numeric, 'el precio de la copia se recalcula con la lista vigente (x5 = 850)');
select is(
  (select l.precio_unitario || ':' || l.precio_manual from dominio.comprobantes_venta_lineas l where l.comprobante_id = (select id from comps where clave = 'A2') and l.orden = 2),
  '123.00:true', 'el precio manual se conserva');
select is((select total_sin_iva from dominio.comprobantes_venta where id = (select id from comps where clave = 'A2')),
  4373::numeric, 'la copia recalcula su total (5 × 850 + 123)');
select is(
  (select row(c.estado, c.updated_at, c.total_con_iva,
     (select count(*) from dominio.comprobantes_venta_lineas l where l.comprobante_id = c.id),
     (select l.precio_unitario from dominio.comprobantes_venta_lineas l where l.comprobante_id = c.id and l.orden = 1))::text
   from dominio.comprobantes_venta c where c.id = (select id from comps where clave = 'A')),
  (select row(estado, updated_at, total_con_iva, lineas, precio1)::text from original),
  'el original no cambia: estado, totales, líneas ni precios'
);
select throws_ok(format($$select public.copiar_presupuesto(%L)$$, (select id from comps where clave = 'F')),
  'P0002', null, 'una factura no se copia como presupuesto');
select throws_ok(format($$select public.copiar_presupuesto(%L)$$, (select id from comps where clave = 'D')),
  '42501', null, 'sin acceso a la tienda no se copia');
select throws_ok(format($$select public.copiar_presupuesto(%L)$$, (select id from comps where clave = 'X')),
  'P0002', null, 'un presupuesto de otra organización no se copia');
select pg_temp.como('f1000000-0000-0000-0000-000000000003');
select throws_ok(format($$select public.copiar_presupuesto(%L)$$, (select id from comps where clave = 'A')),
  '42501', null, 'con lectura no se copia');
select pg_temp.como('f1000000-0000-0000-0000-000000000002');
-- Copiar uno ya aceptado o vencido es válido: es una cotización nueva (la UI también lo habilita en cualquier estado).
select lives_ok(format($$select public.copiar_presupuesto(%L)$$, (select id from comps where clave = 'C')),
  'se puede copiar un presupuesto aceptado');

-- ============================================================================
-- Listar (FR-053, FR-055). Tienda 1: A, B, C, A2 y la copia de C = 5 presupuestos
-- ============================================================================
select is((select count(*)::int from public.listar_presupuestos()), 5, 'el operador ve los presupuestos de su tienda (no la factura)');
select is((select max(filas)::int from public.listar_presupuestos()), 5, 'cada fila trae el total del filtro');
select is((select estado from public.listar_presupuestos('00000002')), 'vencido', 'vencido se deriva de valido_hasta');
select is(
  (select estado from dominio.comprobantes_venta where id = (select id from comps where clave = 'B')),
  'pendiente', 'el vencido no se guarda: sigue pendiente en la base');
select is((select count(*)::int from public.listar_presupuestos(null, 'pendiente')), 3, 'pendiente excluye al vencido');
select is((select count(*)::int from public.listar_presupuestos(null, 'aceptado')), 1, 'filtro aceptado');
select is((select count(*)::int from public.listar_presupuestos(null, 'vencido')), 1, 'filtro vencido');
select is((select count(*)::int from public.listar_presupuestos(null, 'convertido')), 0, 'filtro convertido (sin presupuestos convertidos todavía)');
select throws_ok($$select * from public.listar_presupuestos(null, 'inventado')$$, '22023', null, 'un estado desconocido se rechaza');
select is((select count(*)::int from public.listar_presupuestos('norte')), 4, 'busca por cliente sin mayúsculas');
select is((select count(*)::int from public.listar_presupuestos('MINORISTA')), 1, 'busca por cliente (otro cliente)');
select is((select numero from public.listar_presupuestos('00000004')), '00000004', 'busca por número');
select is((select count(*)::int from public.listar_presupuestos('%')), 0, 'el texto se toma literal (no es comodín)');
select is((select count(*)::int from public.listar_presupuestos(null, null, 'a1000000-0000-0000-0000-000000000001')), 5, 'filtra por tienda');
select is((select count(*)::int from public.listar_presupuestos(null, null, 'a1000000-0000-0000-0000-000000000002')), 0, 'el operador no ve la otra tienda');
select is((select count(*)::int from public.listar_presupuestos(null, null, null, 1, 2)), 2, 'pagina de a 2');
select is((select max(filas)::int from public.listar_presupuestos(null, null, null, 3, 2)), 5, 'la última página sigue informando el total');
select is((select count(*)::int from public.listar_presupuestos(null, null, null, 9, 2)), 0, 'una página fuera de rango queda vacía');
select is((select bool_and(puede_editar) from public.listar_presupuestos()), true, 'el operador puede editar (acciones)');
select is((select id from public.listar_presupuestos() limit 1), (select id from public.listar_presupuestos() order by fecha desc, numero desc limit 1),
  'orden: fecha y número descendentes');

select pg_temp.como('f1000000-0000-0000-0000-000000000003');
select is((select count(*)::int from public.listar_presupuestos()), 5, 'con lectura se ve el listado');
select is((select bool_or(puede_editar) from public.listar_presupuestos()), false, 'con lectura no hay acciones');

select pg_temp.como('f1000000-0000-0000-0000-000000000001');
select is((select count(*)::int from public.listar_presupuestos()), 6, 'el administrador ve las dos tiendas');
select is((select empresa from public.listar_presupuestos(null, null, 'a1000000-0000-0000-0000-000000000002')), 'Segunda tienda', 'filtra por la otra tienda');
select is((select count(*)::int from public.listar_presupuestos(null, null, 'a2000000-0000-0000-0000-000000000001')), 0, 'una tienda de otra organización devuelve cero filas');

select pg_temp.como('f2000000-0000-0000-0000-000000000001');
select is((select count(*)::int from public.listar_presupuestos()), 1, 'otra organización ve solo lo suyo');

reset role;
set local role anon;
select throws_ok($$select * from public.listar_presupuestos()$$, '42501', null, 'anon no lista');
select throws_ok($$select public.aceptar_presupuesto('00000000-0000-0000-0000-000000000000')$$, '42501', null, 'anon no acepta');
select throws_ok($$select public.copiar_presupuesto('00000000-0000-0000-0000-000000000000')$$, '42501', null, 'anon no copia');

-- ============================================================================
-- Un producto desactivado detiene la copia con un mensaje claro (no pierde líneas en silencio)
-- ============================================================================
select pg_temp.como('f1000000-0000-0000-0000-000000000001');
reset role;
update dominio.productos set activo = false where id = 'b1000000-0000-0000-0000-000000000002';
select pg_temp.como('f1000000-0000-0000-0000-000000000002');
select throws_ok(format($$select public.copiar_presupuesto(%L)$$, (select id from comps where clave = 'A')),
  '22023', null, 'un producto inactivo detiene la copia');
select is((select count(*)::int from public.listar_presupuestos()), 5, 'la copia fallida no deja un presupuesto a medias');

select * from finish();
rollback;
