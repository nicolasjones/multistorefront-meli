-- MSF-414 · F-STK-18 (épica MSF-368, SC-401): `public.productos_mas_vendidos`.
--
-- Suma las UNIDADES de las líneas de las facturas que CUENTAN (predicado único
-- `private.comprobante_cuenta_como_facturado`), del período y de las tiendas elegidas: NO suman
-- presupuestos, borradores ni anuladas; ordena por unidades descendente y desempata por nombre; una
-- tienda ajena devuelve CERO filas; `anon` no puede ejecutarla y sin sesión responde 42501.
--
-- El fixture se arma como `postgres` (la RLS no aplica) con ventas de ejemplo, igual que
-- `ranking_clientes.test.sql`; las verificaciones de permiso corren como `authenticated` o `anon`,
-- como los ve PostgREST.
begin;

select plan(35);

insert into organizaciones (id, nombre) values
  ('11111111-1111-1111-1111-111111111111', 'Organización Uno'),
  ('22222222-2222-2222-2222-222222222222', 'Organización Dos');

insert into auth.users (id, email) values
  ('a1000000-0000-0000-0000-000000000001', 'ventas-uno@example.com'),
  ('a1000000-0000-0000-0000-000000000002', 'ventas-dos@example.com'),
  ('a1000000-0000-0000-0000-000000000003', 'lectura-uno@example.com'),
  ('a1000000-0000-0000-0000-000000000004', 'sin-stock@example.com'),
  ('a2000000-0000-0000-0000-000000000001', 'admin-dos@example.com');

-- Rol propio para probar que la RPC exige Stock: tiene ventas en lectura, pero no Stock.
-- `stock` es una sección compartida (F-ROL-07): con filas en `usuarios_empresas` manda el MEJOR
-- rol entre sus empresas, no el rol de organización. Por eso el usuario de la prueba también
-- necesita un rol por empresa sin Stock; se usa `deposito` con su nivel de Stock pisado a
-- «ninguno» en esta organización (las ventas le siguen quedando en lectura por la matriz inicial).
insert into public.roles_organizacion (id, descripcion) values
  ('vendedor', 'Vendedor con ventas en lectura y sin acceso a Stock.');
insert into public.permisos_rol (organizacion_id, rol_id, seccion, nivel) values
  ('11111111-1111-1111-1111-111111111111', 'vendedor', 'stock', 'ninguno'),
  ('11111111-1111-1111-1111-111111111111', 'vendedor', 'ventas', 'lectura'),
  ('11111111-1111-1111-1111-111111111111', 'deposito', 'stock', 'ninguno')
on conflict (organizacion_id, rol_id, seccion) do update set nivel = excluded.nivel;

insert into usuarios_organizacion (user_id, organizacion_id, rol_id, estado) values
  ('a1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'operador', 'activo'),
  ('a1000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'operador', 'activo'),
  ('a1000000-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111', 'consulta', 'activo'),
  ('a1000000-0000-0000-0000-000000000004', '11111111-1111-1111-1111-111111111111', 'vendedor', 'activo'),
  ('a2000000-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', 'administrador', 'activo');

insert into dominio.empresas (id, organizacion_id, nombre) values
  ('e1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'Tienda Uno'),
  ('e1000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'Tienda Dos'),
  ('e2000000-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', 'Empresa Dos');

-- `ventas-uno` solo tiene Tienda Uno; `ventas-dos` tiene las dos tiendas de su organización.
insert into public.usuarios_empresas (user_id, empresa_id, organizacion_id, rol_id) values
  ('a1000000-0000-0000-0000-000000000001', 'e1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'operador'),
  ('a1000000-0000-0000-0000-000000000002', 'e1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'operador'),
  ('a1000000-0000-0000-0000-000000000002', 'e1000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'operador'),
  ('a1000000-0000-0000-0000-000000000003', 'e1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'consulta'),
  ('a1000000-0000-0000-0000-000000000004', 'e1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'deposito');

insert into public.clientes (id, organizacion_id, numero, nombre, tipo) values
  ('c1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 10, 'Cliente Uno', 'minorista'),
  ('c2000000-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', 10, 'Cliente Dos', 'minorista');

insert into dominio.productos (id, organizacion_id, nombre, sku, moneda, precio_lista) values
  ('b1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'Auricular', 'AUR-1', 'ARS', 1000),
  ('b1000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'Cable', 'CAB-1', 'ARS', 1000),
  ('b1000000-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111', 'Mouse', 'MOU-1', 'ARS', 1000),
  ('b1000000-0000-0000-0000-000000000004', '11111111-1111-1111-1111-111111111111', 'Alfombra', 'ALF-1', 'ARS', 1000),
  ('b1000000-0000-0000-0000-000000000005', '11111111-1111-1111-1111-111111111111', 'Silla', 'SIA-1', 'ARS', 1000),
  ('b1000000-0000-0000-0000-000000000006', '11111111-1111-1111-1111-111111111111', 'Monitor', 'MON-1', 'ARS', 1000),
  ('b1000000-0000-0000-0000-000000000007', '11111111-1111-1111-1111-111111111111', 'Teclado', 'TEC-1', 'ARS', 1000),
  ('b2000000-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', 'Auricular', 'AUR-1', 'ARS', 1000);

-- Ventas de la organización Uno. F1 y F2 son las que cuentan; F3 es un borrador, F4 una anulada,
-- F5 un presupuesto, F6 es de Tienda Dos (sin `ventas` visible para `ventas-uno`), F7 es de
-- septiembre (fuera del período) y F8 no tiene tienda.
insert into dominio.comprobantes_venta
  (id, organizacion_id, empresa_id, cliente_id, tipo, numero, fecha, estado, total_sin_iva, total_con_iva)
select v.id::uuid,
       case when v.id like 'f2%' then '22222222-2222-2222-2222-222222222222'::uuid
            else '11111111-1111-1111-1111-111111111111'::uuid end,
       nullif(v.empresa, '')::uuid,
       case when v.id like 'f2%' then 'c2000000-0000-0000-0000-000000000001'::uuid
            else 'c1000000-0000-0000-0000-000000000001'::uuid end,
       v.tipo, v.numero, v.fecha::date, v.estado, 1000, 1210
  from (values
    ('f1000000-0000-0000-0000-000000000001', 'e1000000-0000-0000-0000-000000000001', 'factura',     '0001-00000001', '2026-10-05', 'confirmada'),
    ('f1000000-0000-0000-0000-000000000002', 'e1000000-0000-0000-0000-000000000001', 'factura',     '0001-00000002', '2026-10-15', 'confirmada'),
    ('f1000000-0000-0000-0000-000000000003', 'e1000000-0000-0000-0000-000000000001', 'factura',     '0001-00000003', '2026-10-20', 'borrador'),
    ('f1000000-0000-0000-0000-000000000004', 'e1000000-0000-0000-0000-000000000001', 'factura',     '0001-00000004', '2026-10-21', 'anulada'),
    ('f1000000-0000-0000-0000-000000000005', 'e1000000-0000-0000-0000-000000000001', 'presupuesto', '0001-00000005', '2026-10-22', 'pendiente'),
    ('f1000000-0000-0000-0000-000000000006', 'e1000000-0000-0000-0000-000000000002', 'factura',     '0001-00000006', '2026-10-25', 'confirmada'),
    ('f1000000-0000-0000-0000-000000000007', 'e1000000-0000-0000-0000-000000000001', 'factura',     '0001-00000007', '2026-09-30', 'confirmada'),
    ('f1000000-0000-0000-0000-000000000008', '',                                   'factura',     '0001-00000008', '2026-10-28', 'confirmada'),
    ('f2000000-0000-0000-0000-000000000001', 'e2000000-0000-0000-0000-000000000001', 'factura',     '0002-00000001', '2026-10-10', 'confirmada')
  ) as v(id, empresa, tipo, numero, fecha, estado);

insert into dominio.comprobantes_venta_lineas
  (organizacion_id, comprobante_id, orden, producto_id, descripcion, cantidad, precio_unitario, escala, deposito_id, a_pedido, subtotal_sin_iva, iva)
select case when v.comprobante like 'f2%' then '22222222-2222-2222-2222-222222222222'::uuid
            else '11111111-1111-1111-1111-111111111111'::uuid end,
       v.comprobante::uuid, v.orden::int, p.id, p.nombre, v.cantidad::int, 100, 'x1', d.id,
       v.a_pedido::boolean, v.cantidad::int * 100, 0
  from (values
    ('f1000000-0000-0000-0000-000000000001', 1, 'b1000000-0000-0000-0000-000000000001', 3, false),
    ('f1000000-0000-0000-0000-000000000001', 2, 'b1000000-0000-0000-0000-000000000002', 3, false),
    ('f1000000-0000-0000-0000-000000000001', 3, 'b1000000-0000-0000-0000-000000000004', 4, true),
    ('f1000000-0000-0000-0000-000000000002', 1, 'b1000000-0000-0000-0000-000000000001', 2, false),
    ('f1000000-0000-0000-0000-000000000002', 2, 'b1000000-0000-0000-0000-000000000003', 3, false),
    ('f1000000-0000-0000-0000-000000000003', 1, 'b1000000-0000-0000-0000-000000000001', 10, false),
    ('f1000000-0000-0000-0000-000000000004', 1, 'b1000000-0000-0000-0000-000000000002', 7, false),
    ('f1000000-0000-0000-0000-000000000005', 1, 'b1000000-0000-0000-0000-000000000003', 9, false),
    ('f1000000-0000-0000-0000-000000000006', 1, 'b1000000-0000-0000-0000-000000000005', 5, false),
    ('f1000000-0000-0000-0000-000000000007', 1, 'b1000000-0000-0000-0000-000000000006', 6, false),
    ('f1000000-0000-0000-0000-000000000008', 1, 'b1000000-0000-0000-0000-000000000007', 4, false),
    ('f2000000-0000-0000-0000-000000000001', 1, 'b2000000-0000-0000-0000-000000000001', 99, false)
  ) as v(comprobante, orden, producto, cantidad, a_pedido)
  join dominio.productos p on p.id = v.producto::uuid
  join dominio.depositos d
    on d.organizacion_id = case when v.comprobante like 'f2%' then '22222222-2222-2222-2222-222222222222'::uuid
                                else '11111111-1111-1111-1111-111111111111'::uuid end
   and d.por_defecto;

create function pg_temp.como(p_user uuid) returns void language plpgsql as $$
begin
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
  set local role authenticated;
end $$;

-- ============================================================================
-- Sin sesión no hay ranking (SC-401): la organización sale de la sesión, nunca del pedido
-- ============================================================================

reset role;
select throws_ok(
  $$select * from public.productos_mas_vendidos('2026-10-01', '2026-10-31')$$,
  '42501', null, 'sin sesión: sin permiso (ni organización ni sección Stock)'
);

-- ============================================================================
-- Esquema y privilegios (FR-408, Principio VII)
-- ============================================================================

select ok(
  (select p.prosecdef and p.proconfig @> array['search_path=""']
     from pg_proc p where p.oid = 'public.productos_mas_vendidos(date, date, uuid, integer, integer)'::regprocedure),
  'la RPC es security definer con search_path vacío'
);
select is(has_function_privilege('anon', 'public.productos_mas_vendidos(date, date, uuid, integer, integer)', 'execute'), false, 'anon no tiene EXECUTE sobre productos_mas_vendidos');
select is(has_function_privilege('authenticated', 'public.productos_mas_vendidos(date, date, uuid, integer, integer)', 'execute'), true, 'authenticated tiene EXECUTE sobre productos_mas_vendidos');

-- ============================================================================
-- Qué suma y qué no (FR-402): solo las facturas que cuentan, en el período
-- ============================================================================

select pg_temp.como('a1000000-0000-0000-0000-000000000001');

select results_eq(
  $$select posicion::int, nombre, unidades::int from public.productos_mas_vendidos('2026-10-01', '2026-10-31')$$,
  $$values (1, 'Auricular', 5), (2, 'Alfombra', 4), (3, 'Cable', 3), (4, 'Mouse', 3)$$,
  'suma las unidades de las facturas que cuentan, ordenadas por unidades y desempate por nombre'
);
select is((select max(total_filas) from public.productos_mas_vendidos('2026-10-01', '2026-10-31')), 4::bigint, 'total_filas cuenta todos los productos del ranking');
select is(
  (select unidades::int from public.productos_mas_vendidos('2026-10-01', '2026-10-31') where nombre = 'Auricular'),
  5, 'el borrador (10 unidades) no suma'
);
select is(
  (select unidades::int from public.productos_mas_vendidos('2026-10-01', '2026-10-31') where nombre = 'Cable'),
  3, 'la factura anulada (7 unidades) no suma'
);
select is(
  (select unidades::int from public.productos_mas_vendidos('2026-10-01', '2026-10-31') where nombre = 'Mouse'),
  3, 'el presupuesto (9 unidades) no suma'
);
select is(
  (select unidades::int from public.productos_mas_vendidos('2026-10-01', '2026-10-31') where nombre = 'Alfombra'),
  4, 'las líneas «A pedido» sí suman'
);
select results_eq(
  $$select nombre, unidades::int from public.productos_mas_vendidos('2026-10-01', '2026-10-31')$$,
  $$values ('Auricular', 5), ('Alfombra', 4), ('Cable', 3), ('Mouse', 3)$$,
  'trae el nombre del producto y sus unidades'
);
select results_eq(
  $$select sku from public.productos_mas_vendidos('2026-10-01', '2026-10-31') where nombre = 'Alfombra'$$,
  $$values ('ALF-1')$$,
  'trae el SKU del producto'
);

-- Período (FR-402): los extremos son inclusivos y lo que cae fuera no suma.
select results_eq(
  $$select nombre, unidades::int from public.productos_mas_vendidos('2026-10-05', '2026-10-05')$$,
  $$values ('Alfombra', 4), ('Auricular', 3), ('Cable', 3)$$,
  'el extremo Desde es inclusivo'
);
select results_eq(
  $$select nombre, unidades::int from public.productos_mas_vendidos('2026-09-01', '2026-09-30')$$,
  $$values ('Monitor', 6)$$,
  'otro período devuelve solo lo de ese período'
);
select is((select count(*)::int from public.productos_mas_vendidos('2026-08-01', '2026-08-31')), 0, 'un período sin ventas devuelve vacío sin fallar');

-- ============================================================================
-- Tiendas (FR-403): solo las visibles; una tienda ajena devuelve cero filas
-- ============================================================================

select is((select count(*)::int from public.productos_mas_vendidos('2026-10-01', '2026-10-31', 'e1000000-0000-0000-0000-000000000001')), 4, 'la tienda elegida acota el ranking');
select is((select count(*)::int from public.productos_mas_vendidos('2026-10-01', '2026-10-31', 'e1000000-0000-0000-0000-000000000002')), 0, 'una tienda sin `ventas` visible devuelve cero filas');
select is((select count(*)::int from public.productos_mas_vendidos('2026-10-01', '2026-10-31', 'e2000000-0000-0000-0000-000000000001')), 0, 'una tienda de otra organización devuelve cero filas');
select is((select count(*)::int from public.productos_mas_vendidos('2026-10-01', '2026-10-31', 'e1000000-0000-0000-0000-000000000001') where nombre = 'Silla'), 0, 'las ventas de una tienda sin `ventas` visible no suman');

-- Con acceso a las dos tiendas se ven las dos.
select pg_temp.como('a1000000-0000-0000-0000-000000000002');
select results_eq(
  $$select posicion::int, nombre, unidades::int from public.productos_mas_vendidos('2026-10-01', '2026-10-31')$$,
  $$values (1, 'Auricular', 5), (2, 'Silla', 5), (3, 'Alfombra', 4), (4, 'Cable', 3), (5, 'Mouse', 3)$$,
  'sin elegir tienda suma lo de todas las tiendas a las que tiene acceso'
);
select results_eq(
  $$select nombre, unidades::int from public.productos_mas_vendidos('2026-10-01', '2026-10-31', 'e1000000-0000-0000-0000-000000000002')$$,
  $$values ('Silla', 5)$$,
  'eligiendo Tienda Dos solo cuenta lo de Tienda Dos'
);

-- Aislamiento entre organizaciones.
select pg_temp.como('a2000000-0000-0000-0000-000000000001');
select results_eq(
  $$select nombre, unidades::int from public.productos_mas_vendidos('2026-10-01', '2026-10-31')$$,
  $$values ('Auricular', 99)$$,
  'otra organización solo ve sus propias ventas'
);

-- ============================================================================
-- Paginación y validaciones (FR-404, FR-405)
-- ============================================================================

select pg_temp.como('a1000000-0000-0000-0000-000000000001');
select results_eq(
  $$select posicion::int, nombre from public.productos_mas_vendidos('2026-10-01', '2026-10-31', null, 2, 2)$$,
  $$values (3, 'Cable'), (4, 'Mouse')$$,
  'la segunda página conserva la posición global'
);
select is((select count(*)::int from public.productos_mas_vendidos('2026-10-01', '2026-10-31', null, 3, 2)), 0, 'una página fuera de rango no devuelve filas');
select throws_ok($$select * from public.productos_mas_vendidos('2026-10-01', '2026-10-31', null, 1, 201)$$, '22023', null, 'tamaño mayor a 200: rechazado');
select lives_ok($$select * from public.productos_mas_vendidos('2026-10-01', '2026-10-31', null, 1, 200)$$, 'tamaño 200: aceptado');
select throws_ok($$select * from public.productos_mas_vendidos('2026-10-31', '2026-10-01')$$, '22023', null, 'Hasta anterior a Desde: rechazado');
select throws_ok($$select * from public.productos_mas_vendidos(null, '2026-10-01')$$, '22023', null, 'fecha Desde nula: rechazado');
select throws_ok($$select * from public.productos_mas_vendidos('2020-01-01', '2026-01-02')$$, '22023', null, 'rango mayor a 5 años: rechazado');
select lives_ok($$select * from public.productos_mas_vendidos('2021-10-15', '2026-10-15')$$, 'rango de exactamente 5 años: aceptado');
select throws_ok($$select * from public.productos_mas_vendidos('2026-10-01', '2026-10-31', null, 0)$$, '22023', null, 'página 0: rechazado');
select throws_ok($$select * from public.productos_mas_vendidos('2026-10-01', '2026-10-31', null, 1, 0)$$, '22023', null, 'tamaño 0: rechazado');

-- ============================================================================
-- Permisos (FR-408): Stock en lectura o edición; `anon` sin ejecución
-- ============================================================================

select pg_temp.como('a1000000-0000-0000-0000-000000000003');
select is((select count(*)::int from public.productos_mas_vendidos('2026-10-01', '2026-10-31')), 4, 'con Stock en lectura ve el ranking');

select pg_temp.como('a1000000-0000-0000-0000-000000000004');
select throws_ok($$select * from public.productos_mas_vendidos('2026-10-01', '2026-10-31')$$, '42501', null, 'sin Stock: sin permiso, aunque tenga ventas');

reset role;
set local role anon;
select throws_ok($$select * from public.productos_mas_vendidos('2026-10-01', '2026-10-31')$$, '42501', null, '«anon» no puede ejecutar productos_mas_vendidos');
reset role;

select * from finish();
rollback;
