-- F-CLI-02 (MSF-282, épica MSF-180): búsqueda de clientes en servidor.
-- Cubre SC-002 y SC-003 (FR-006, FR-007, FR-013) para `public.buscar_clientes`:
-- coincidencia parcial por nombre/documento/correo/teléfono/localidad/número,
-- escape de `%` y `_`, filtros de tipo y archivados, paginación con total y
-- tope de tamaño, aislamiento por organización y `anon` sin acceso.
-- Más abajo, `public.exportar_clientes` (F-CLI-04, T006/T008; SC-004, FR-011, FR-013):
-- solo con la acción `exportar`, keyset sin repetidos ni omisiones, tope de lote y
-- aislamiento por organización.
begin;

select plan(42);

insert into organizaciones (id, nombre) values
  ('11111111-1111-1111-1111-111111111111', 'Organización Uno'),
  ('22222222-2222-2222-2222-222222222222', 'Organización Dos');

insert into auth.users (id, email) values
  ('d1000000-0000-0000-0000-000000000001', 'admin-uno@example.com'),
  ('d2000000-0000-0000-0000-000000000001', 'admin-dos@example.com'),
  ('d3000000-0000-0000-0000-000000000001', 'sin-membresia@example.com'),
  ('d4000000-0000-0000-0000-000000000001', 'consulta-uno@example.com'),
  ('d5000000-0000-0000-0000-000000000001', 'deposito-uno@example.com');

insert into usuarios_organizacion (user_id, organizacion_id, rol_id) values
  ('d1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'administrador'),
  ('d4000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'consulta'),
  ('d5000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'deposito'),
  ('d2000000-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', 'administrador');

-- Cada organización ya trae su Consumidor final (Nº 1, minorista, activo).
insert into clientes (organizacion_id, numero, nombre, documento, correo, telefono, localidad, tipo) values
  ('11111111-1111-1111-1111-111111111111', 777, 'Norte Distribuidora', '30-71234567-8', 'norte@example.com', '341-4421', 'Rosario', 'mayorista'),
  ('11111111-1111-1111-1111-111111111111', 11, 'Descuento 50%', null, null, null, null, 'minorista'),
  ('11111111-1111-1111-1111-111111111111', 12, 'Descuento 500', null, null, null, null, 'minorista'),
  ('11111111-1111-1111-1111-111111111111', 13, 'a_b taller', null, null, null, null, 'minorista'),
  ('11111111-1111-1111-1111-111111111111', 14, 'axb taller', null, null, null, null, 'minorista'),
  ('11111111-1111-1111-1111-111111111111', 15, 'Zeta archivado', null, null, null, null, 'mayorista'),
  ('22222222-2222-2222-2222-222222222222', 20, 'Norte Dos', null, null, null, null, 'minorista');
update clientes set archivado_en = now() where nombre = 'Zeta archivado';

-- Cursor de otra organización para probar que exportar_clientes no lo acepta.
create temp table cursor_ajeno as select id from clientes where nombre = 'Norte Distribuidora';
grant select on cursor_ajeno to authenticated;

create function pg_temp.como(p_user uuid) returns void language plpgsql as $$
begin
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
  set local role authenticated;
end $$;

select pg_temp.como('d1000000-0000-0000-0000-000000000001');

-- ============================================================================
-- Coincidencia parcial por cada campo (FR-007)
-- ============================================================================

select results_eq($$select nombre from buscar_clientes('norte')$$, $$values ('Norte Distribuidora'::text)$$,
  'busca parcial por nombre, sin distinguir mayúsculas y sin ver otra organización');
select results_eq($$select nombre from buscar_clientes('30-7123')$$, $$values ('Norte Distribuidora'::text)$$, 'busca parcial por documento');
select results_eq($$select nombre from buscar_clientes('norte@exa')$$, $$values ('Norte Distribuidora'::text)$$, 'busca parcial por correo');
select results_eq($$select nombre from buscar_clientes('4421')$$, $$values ('Norte Distribuidora'::text)$$, 'busca parcial por teléfono');
select results_eq($$select nombre from buscar_clientes('rosar')$$, $$values ('Norte Distribuidora'::text)$$, 'busca parcial por localidad');
select results_eq($$select nombre from buscar_clientes('777')$$, $$values ('Norte Distribuidora'::text)$$, 'busca por número de cliente');
select is((select count(*)::int from buscar_clientes('no-existe-xyz')), 0, 'sin coincidencias no devuelve filas');

-- ============================================================================
-- Escape de comodines (FR-007)
-- ============================================================================

select results_eq($$select nombre from buscar_clientes('50%')$$, $$values ('Descuento 50%'::text)$$,
  '«%» se busca literal, no como comodín (no trae «Descuento 500»)');
select results_eq($$select nombre from buscar_clientes('a_b')$$, $$values ('a_b taller'::text)$$,
  '«_» se busca literal, no como un carácter cualquiera (no trae «axb taller»)');
select is((select count(*)::int from buscar_clientes('%')), 1, 'el texto «%» solo coincide con el cliente que lo contiene');
select is((select count(*)::int from buscar_clientes('\')), 0, 'una barra invertida no rompe la consulta ni escapa nada');
select is((select count(*)::int from buscar_clientes('   ')), 6, 'un texto de solo espacios equivale a no buscar');

-- ============================================================================
-- Tipo y archivados
-- ============================================================================

select results_eq($$select nombre from buscar_clientes(null, 'mayorista')$$, $$values ('Norte Distribuidora'::text)$$,
  'filtra mayoristas activos (el archivado no aparece)');
select is((select count(*)::int from buscar_clientes(null, 'minorista')), 5, 'filtra minoristas activos (incluye el Consumidor final)');
select results_eq($$select nombre from buscar_clientes(null, null, true)$$, $$values ('Zeta archivado'::text)$$, 'archivados: solo los archivados');
select is((select count(*)::int from buscar_clientes(null, 'minorista', true)), 0, 'tipo y archivados se combinan');
select is((select count(*)::int from buscar_clientes('zeta')), 0, 'un archivado no aparece al buscar entre los activos');

-- ============================================================================
-- Paginación, total y tope de tamaño
-- ============================================================================

select is((select count(*)::int from buscar_clientes(null, null, false, 1, 4)), 4, 'la página 1 trae el tamaño pedido');
select is((select max(total)::int from buscar_clientes(null, null, false, 1, 4)), 6, 'el total cuenta todas las coincidencias, no solo la página');
select is(
  (select count(distinct id)::int from (
    select id from buscar_clientes(null, null, false, 1, 4)
    union all select id from buscar_clientes(null, null, false, 2, 4)) t),
  6, 'las páginas no repiten ni omiten clientes');
select is((select nombre from buscar_clientes(null, null, false, 2, 4) order by lower(nombre) desc limit 1), 'Norte Distribuidora',
  'el orden es por nombre: lo último queda en la última página');
select is((select count(*)::int from buscar_clientes(null, null, false, 99, 4)), 0, 'una página fuera de rango no trae filas');
select is((select count(*)::int from buscar_clientes(null, null, false, 0, 0)), 1, 'tamaño y página inválidos se acotan (mínimo 1)');

-- ============================================================================
-- Aislamiento y permisos (FR-013)
-- ============================================================================

select pg_temp.como('d2000000-0000-0000-0000-000000000001');
select results_eq($$select nombre from buscar_clientes('norte')$$, $$values ('Norte Dos'::text)$$, 'cada organización busca solo entre los suyos');

select pg_temp.como('d3000000-0000-0000-0000-000000000001');
select is((select count(*)::int from buscar_clientes()), 0, 'un usuario sin membresía no ve clientes');

-- Rol con lectura en Clientes (consulta) ve; rol sin acceso (depósito) no (FR-013).
select pg_temp.como('d4000000-0000-0000-0000-000000000001');
select is((select count(*)::int from buscar_clientes()), 6, 'rol con lectura en Clientes: ve el listado');
select pg_temp.como('d5000000-0000-0000-0000-000000000001');
select is((select count(*)::int from buscar_clientes()), 0, 'rol «ninguno» en Clientes: no ve clientes');

reset role;
set local role anon;
select throws_ok($$select * from buscar_clientes('norte')$$, '42501', null, '«anon» no puede ejecutar buscar_clientes');

-- ============================================================================
-- exportar_clientes (F-CLI-04): permiso, keyset, tope de lote y aislamiento
-- ============================================================================

select pg_temp.como('d1000000-0000-0000-0000-000000000001');

select is((select count(*)::int from exportar_clientes()), 6, 'administrador (con «exportar»): exporta los clientes activos de su organización');
select is((select max(total)::int from exportar_clientes(null, null, false, null, 2)), 6, 'el total cuenta todas las coincidencias, no solo el lote');

select is(
  (with b1 as (select * from exportar_clientes(null, null, false, null, 2)),
        b2 as (select * from exportar_clientes(null, null, false, (select id from b1 order by lower(nombre) desc, id desc limit 1), 2)),
        b3 as (select * from exportar_clientes(null, null, false, (select id from b2 order by lower(nombre) desc, id desc limit 1), 2))
   select count(distinct id)::int * 100 + count(*)::int from (select id from b1 union all select id from b2 union all select id from b3) t),
  606, 'keyset: tres lotes de 2 recorren 6 clientes, sin repetidos ni omisiones');
select is(
  (with b1 as (select * from exportar_clientes(null, null, false, null, 2)),
        b2 as (select * from exportar_clientes(null, null, false, (select id from b1 order by lower(nombre) desc, id desc limit 1), 2)),
        b3 as (select * from exportar_clientes(null, null, false, (select id from b2 order by lower(nombre) desc, id desc limit 1), 2))
   select count(*)::int from exportar_clientes(null, null, false, (select id from b3 order by lower(nombre) desc, id desc limit 1), 2)),
  0, 'keyset: pasado el último lote no vuelven filas');
select is(
  (select array_agg(id order by lower(nombre), id) from exportar_clientes()),
  (select array_agg(id order by lower(nombre), id) from buscar_clientes(null, null, false, 1, 100)),
  'exporta exactamente los mismos clientes que muestra el listado');

select results_eq($$select nombre from exportar_clientes(null, null, true)$$, $$values ('Zeta archivado'::text)$$, 'respeta el filtro de archivados');
select results_eq($$select nombre from exportar_clientes('norte')$$, $$values ('Norte Distribuidora'::text)$$, 'respeta el texto de búsqueda y no trae otra organización');

select pg_temp.como('d2000000-0000-0000-0000-000000000001');
select results_eq($$select nombre from exportar_clientes('norte')$$, $$values ('Norte Dos'::text)$$, 'cada organización exporta solo los suyos');
select is((select count(*)::int from exportar_clientes(null, null, false, (select id from cursor_ajeno), 10)), 0,
  'un cursor de otra organización no devuelve filas');

-- Sin la acción «exportar» la RPC rechaza la llamada directa aunque se pueda leer (FR-011, FR-013).
select pg_temp.como('d4000000-0000-0000-0000-000000000001');
select throws_ok($$select * from exportar_clientes()$$, '42501', null, 'consulta (lee Clientes pero sin «exportar»): rechazado');
select pg_temp.como('d5000000-0000-0000-0000-000000000001');
select throws_ok($$select * from exportar_clientes()$$, '42501', null, 'depósito (sin acceso a Clientes): rechazado');
select pg_temp.como('d3000000-0000-0000-0000-000000000001');
select throws_ok($$select * from exportar_clientes()$$, '42501', null, 'sin membresía: rechazado');

reset role;
set local role anon;
select throws_ok($$select * from exportar_clientes()$$, '42501', null, '«anon» no puede ejecutar exportar_clientes');

-- Tope de lote: aunque se pida más, un lote no pasa de 1000 filas.
reset role;
insert into clientes (organizacion_id, nombre, tipo)
  select '11111111-1111-1111-1111-111111111111', 'Lote ' || lpad(i::text, 5, '0'), 'minorista' from generate_series(1, 1005) i;
select pg_temp.como('d1000000-0000-0000-0000-000000000001');
select is((select count(*)::int from exportar_clientes(null, null, false, null, 5000)), 1000, 'el lote se acota a 1000 filas');

select * from finish();
rollback;
