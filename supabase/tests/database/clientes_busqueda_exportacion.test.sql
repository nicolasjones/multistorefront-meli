-- F-CLI-02 (MSF-282, épica MSF-180): búsqueda de clientes en servidor.
-- Cubre SC-002 y SC-003 (FR-006, FR-007, FR-013) para `public.buscar_clientes`:
-- coincidencia parcial por nombre/documento/correo/teléfono/localidad/número,
-- escape de `%` y `_`, filtros de tipo y archivados, paginación con total y
-- tope de tamaño, aislamiento por organización y `anon` sin acceso.
-- `exportar_clientes` (aserciones de exportación) las agrega F-CLI-04 (T006/T014).
begin;

select plan(26);

insert into organizaciones (id, nombre) values
  ('11111111-1111-1111-1111-111111111111', 'Organización Uno'),
  ('22222222-2222-2222-2222-222222222222', 'Organización Dos');

insert into auth.users (id, email) values
  ('d1000000-0000-0000-0000-000000000001', 'admin-uno@example.com'),
  ('d2000000-0000-0000-0000-000000000001', 'admin-dos@example.com'),
  ('d3000000-0000-0000-0000-000000000001', 'sin-membresia@example.com');

insert into usuarios_organizacion (user_id, organizacion_id, rol_id) values
  ('d1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'administrador'),
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

reset role;
set local role anon;
select throws_ok($$select * from buscar_clientes('norte')$$, '42501', null, '«anon» no puede ejecutar buscar_clientes');

select * from finish();
rollback;
