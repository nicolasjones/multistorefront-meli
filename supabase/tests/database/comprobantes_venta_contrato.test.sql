-- F-CLI-08 (MSF-238, épica MSF-126): contrato `dominio.comprobantes_venta`
-- (FR-001, SC-003): esquema `dominio` con RLS, lectura por organización y sección
-- `ventas`, sin escritura para `authenticated`, sin acceso para `anon`, restricciones
-- del contrato y FK compuesta que impide apuntar a un cliente de otra organización.
-- Las pruebas globales `rls_en_toda_tabla` y `aislamiento_organizaciones` recorren
-- también esta tabla.
begin;

select plan(13);

insert into organizaciones (id, nombre) values
  ('11111111-1111-1111-1111-111111111111', 'Organización Uno'),
  ('22222222-2222-2222-2222-222222222222', 'Organización Dos');

insert into auth.users (id, email) values
  ('d1000000-0000-0000-0000-000000000001', 'admin-uno@example.com'),
  ('d2000000-0000-0000-0000-000000000001', 'admin-dos@example.com'),
  ('d5000000-0000-0000-0000-000000000001', 'deposito-uno@example.com');

insert into usuarios_organizacion (user_id, organizacion_id, rol_id) values
  ('d1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'administrador'),
  ('d5000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'deposito'),
  ('d2000000-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', 'administrador');

insert into clientes (id, organizacion_id, numero, nombre, tipo) values
  ('c1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 101, 'Alfa', 'mayorista'),
  ('c2000000-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', 201, 'Ajeno', 'minorista');

insert into dominio.comprobantes_venta
  (organizacion_id, cliente_id, tipo, numero, fecha, estado, total_sin_iva, total_con_iva) values
  ('11111111-1111-1111-1111-111111111111', 'c1000000-0000-0000-0000-000000000001', 'factura', '0001-00000001', '2026-10-01', 'emitida', 1000, 1210),
  ('22222222-2222-2222-2222-222222222222', 'c2000000-0000-0000-0000-000000000001', 'factura', '0001-00000001', '2026-10-10', 'emitida', 500, 605);

create function pg_temp.como(p_user uuid) returns void language plpgsql as $$
begin
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
  set local role authenticated;
end $$;

-- ============================================================================
-- Esquema y RLS
-- ============================================================================

select ok(
  exists (select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
           where n.nspname = 'dominio' and c.relname = 'comprobantes_venta' and c.relrowsecurity),
  'comprobantes_venta vive en «dominio» y tiene RLS activada'
);
select ok(
  not exists (select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
               where n.nspname = 'public' and c.relname = 'comprobantes_venta'),
  'no existe una copia en «public»'
);

-- ============================================================================
-- Lectura por organización y sección ventas
-- ============================================================================

select pg_temp.como('d1000000-0000-0000-0000-000000000001');
select is((select count(*)::int from dominio.comprobantes_venta), 1, 'administrador de la organización 1 ve solo sus comprobantes');
select is((select numero from dominio.comprobantes_venta), '0001-00000001', 'y es el de su organización');

select pg_temp.como('d2000000-0000-0000-0000-000000000001');
select is((select count(*)::int from dominio.comprobantes_venta where cliente_id = 'c1000000-0000-0000-0000-000000000001'), 0, 'la organización 2 no ve comprobantes ajenos');

-- «Ventas» en ninguno para depósito (como postgres): no recibe filas aunque consulte directo.
reset role;
update permisos_rol set nivel = 'ninguno'
 where organizacion_id = '11111111-1111-1111-1111-111111111111' and rol_id = 'deposito' and seccion = 'ventas';
select pg_temp.como('d5000000-0000-0000-0000-000000000001');
select is((select count(*)::int from dominio.comprobantes_venta), 0, 'sección Ventas en «ninguno»: sin filas');

-- ============================================================================
-- Sin escritura para authenticated ni acceso para anon
-- ============================================================================

select pg_temp.como('d1000000-0000-0000-0000-000000000001');
select throws_ok(
  $$insert into dominio.comprobantes_venta (organizacion_id, cliente_id, tipo, numero, fecha, estado, total_sin_iva, total_con_iva)
    values ('11111111-1111-1111-1111-111111111111', 'c1000000-0000-0000-0000-000000000001', 'factura', 'X-1', '2026-10-02', 'emitida', 1, 1)$$,
  '42501', null, 'authenticated no puede insertar comprobantes (escribe Ventas)'
);
select throws_ok($$update dominio.comprobantes_venta set estado = 'anulada'$$, '42501', null, 'authenticated no puede modificar comprobantes');
select throws_ok($$delete from dominio.comprobantes_venta$$, '42501', null, 'authenticated no puede borrar comprobantes');

reset role;
set local role anon;
select throws_ok($$select * from dominio.comprobantes_venta$$, '42501', null, '«anon» no lee comprobantes');
reset role;

-- ============================================================================
-- Restricciones del contrato y FK compuesta (como postgres, sin RLS)
-- ============================================================================

select throws_ok(
  $$insert into dominio.comprobantes_venta (organizacion_id, cliente_id, tipo, numero, fecha, estado, total_sin_iva, total_con_iva)
    values ('11111111-1111-1111-1111-111111111111', 'c2000000-0000-0000-0000-000000000001', 'factura', 'X-2', '2026-10-02', 'emitida', 1, 1)$$,
  '23503', null, 'un comprobante no puede apuntar a un cliente de otra organización'
);
select throws_ok(
  $$insert into dominio.comprobantes_venta (organizacion_id, cliente_id, tipo, numero, fecha, estado, total_sin_iva, total_con_iva)
    values ('11111111-1111-1111-1111-111111111111', 'c1000000-0000-0000-0000-000000000001', 'remito', 'X-3', '2026-10-02', 'emitida', 1, 1)$$,
  '23514', null, 'el tipo se limita a factura o presupuesto'
);
select throws_ok(
  $$insert into dominio.comprobantes_venta (organizacion_id, cliente_id, tipo, numero, fecha, estado, total_sin_iva, total_con_iva)
    values ('11111111-1111-1111-1111-111111111111', 'c1000000-0000-0000-0000-000000000001', 'factura', 'X-4', '2026-10-02', 'emitida', 100, 50)$$,
  '23514', null, 'el total con IVA no puede ser menor al total sin IVA'
);

select * from finish();
rollback;
