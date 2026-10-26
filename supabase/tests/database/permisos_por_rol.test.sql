-- F-ROL-01 (MSF-258, épica MSF-125): roles básicos y permisos por sección.
-- Cubre SC-002 (cada rol ve/escribe solo lo que su matriz permite), FR-003
-- (Administrador no restringible), FR-016 (RLS + aislamiento entre
-- organizaciones, recorriendo public y dominio) y el escenario 9 (regresión de
-- private.puede_escribir()). Corre como postgres para armar el fixture y como
-- "authenticated" (request.jwt.claims, igual que PostgREST) para verificar.
begin;

select plan(61);

-- ============================================================================
-- Fixture: 2 organizaciones; en la 1, un usuario por rol; en la 2, un administrador
-- ============================================================================

insert into organizaciones (id, nombre) values
  ('11111111-1111-1111-1111-111111111111', 'Organización Uno'),
  ('22222222-2222-2222-2222-222222222222', 'Organización Dos');

insert into auth.users (id, email) values
  ('b1000000-0000-0000-0000-000000000001', 'administrador@example.com'),
  ('b1000000-0000-0000-0000-000000000002', 'operador@example.com'),
  ('b1000000-0000-0000-0000-000000000003', 'consulta@example.com'),
  ('b1000000-0000-0000-0000-000000000004', 'mostrador@example.com'),
  ('b1000000-0000-0000-0000-000000000005', 'deposito@example.com'),
  ('b1000000-0000-0000-0000-000000000006', 'administracion@example.com'),
  ('b1000000-0000-0000-0000-000000000007', 'miembro@example.com'),
  ('b2000000-0000-0000-0000-000000000001', 'admin-dos@example.com'),
  ('b9000000-0000-0000-0000-000000000009', 'sin-organizacion@example.com');

insert into usuarios_organizacion (user_id, organizacion_id, rol_id) values
  ('b1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'administrador'),
  ('b1000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'operador'),
  ('b1000000-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111', 'consulta'),
  ('b1000000-0000-0000-0000-000000000004', '11111111-1111-1111-1111-111111111111', 'mostrador'),
  ('b1000000-0000-0000-0000-000000000005', '11111111-1111-1111-1111-111111111111', 'deposito'),
  ('b1000000-0000-0000-0000-000000000006', '11111111-1111-1111-1111-111111111111', 'administracion'),
  ('b1000000-0000-0000-0000-000000000007', '11111111-1111-1111-1111-111111111111', 'miembro'),
  ('b2000000-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', 'administrador');

-- Tabla de prueba con el contrato de FR-007 (se descarta con el rollback).
create table public.prueba_stock (
  id int generated always as identity primary key,
  organizacion_id uuid not null references organizaciones (id),
  nombre text not null
);
alter table public.prueba_stock enable row level security;
create policy prueba_stock_select on public.prueba_stock for select to authenticated
  using (organizacion_id = (select private.organizacion_id()) and (select private.nivel_seccion('stock')) in ('lectura', 'edicion'));
create policy prueba_stock_insert on public.prueba_stock for insert to authenticated
  with check (organizacion_id = (select private.organizacion_id()) and (select private.nivel_seccion('stock')) = 'edicion');
grant select, insert on public.prueba_stock to authenticated;
grant usage on sequence public.prueba_stock_id_seq to authenticated;

insert into public.prueba_stock (organizacion_id, nombre) values
  ('11111111-1111-1111-1111-111111111111', 'Stock de la Uno'),
  ('22222222-2222-2222-2222-222222222222', 'Stock de la Dos');

create function pg_temp.como(p_user uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
  set local role authenticated;
end $$;

-- ============================================================================
-- Catálogo y siembra (como postgres)
-- ============================================================================

select is(
  (select count(*)::int from roles_organizacion
    where id in ('administrador', 'operador', 'consulta', 'mostrador', 'deposito', 'administracion', 'miembro')),
  7, 'roles_organizacion contiene los seis roles de negocio y miembro'
);
select is(
  (select count(*)::int from permisos_rol where organizacion_id = '11111111-1111-1111-1111-111111111111'),
  16 * 8, 'crear una organización siembra 16 secciones × 8 roles (con Técnico)'
);
select is(
  (select count(*)::int from permisos_rol_accion where organizacion_id = '22222222-2222-2222-2222-222222222222'),
  16 * 8 * 3 + 8 + 8 + 8 + 8, 'crear una organización siembra 16 secciones × 8 roles (con Técnico) × 3 acciones + editar_precio, registrar_cobro, conciliar_pago y cobrar_contrarreembolso en ventas (una fila por rol)'
);
select is(
  (select nivel from permisos_rol where organizacion_id = '11111111-1111-1111-1111-111111111111' and rol_id = 'deposito' and seccion = 'stock'),
  'edicion', 'la siembra respeta la matriz de Roles.dc.html (Depósito edita Stock)'
);
select is(
  (select count(*)::int from permisos_rol where rol_id = 'administrador' and nivel <> 'edicion'),
  0, 'el Administrador tiene Edición en todas las secciones de todas las organizaciones'
);
select throws_ok(
  $$update permisos_rol set nivel = 'lectura' where rol_id = 'administrador' and seccion = 'stock'$$,
  '23514', null, 'la base de datos impide restringir al Administrador (FR-003)'
);
select throws_ok(
  $$update permisos_rol_accion set permitido = false where rol_id = 'administrador' and seccion = 'stock' and accion = 'eliminar'$$,
  '23514', null, 'la base de datos impide quitarle acciones al Administrador (FR-003)'
);
select lives_ok(
  $$select private.sembrar_permisos('11111111-1111-1111-1111-111111111111')$$,
  'sembrar_permisos es idempotente'
);
select is(
  (select count(*)::int from permisos_rol where organizacion_id = '11111111-1111-1111-1111-111111111111'),
  16 * 8, 'resembrar no duplica filas'
);

-- ============================================================================
-- Nivel por rol (SC-002): nivel_seccion en secciones representativas
-- ============================================================================

reset role;
select pg_temp.como('b1000000-0000-0000-0000-000000000001');
select is(private.nivel_seccion('usuarios_permisos'), 'edicion', 'administrador: edita Usuarios y permisos');
select is(private.nivel_seccion('proveedores'), 'edicion', 'administrador: edita Proveedores');

reset role;
select pg_temp.como('b1000000-0000-0000-0000-000000000002');
select is(private.nivel_seccion('productos'), 'edicion', 'operador: edita Productos');
select is(private.nivel_seccion('cotizacion_dolar'), 'lectura', 'operador: lee Cotización del dólar');
select is(private.nivel_seccion('empresas'), 'ninguno', 'operador: sin acceso a Empresas');

reset role;
select pg_temp.como('b1000000-0000-0000-0000-000000000003');
select is(private.nivel_seccion('ventas'), 'lectura', 'consulta: solo lectura en Ventas');
select is(private.nivel_seccion('actividad'), 'ninguno', 'consulta: sin acceso a Actividad');

reset role;
select pg_temp.como('b1000000-0000-0000-0000-000000000004');
select is(private.nivel_seccion('ventas'), 'edicion', 'mostrador: edita Ventas');
select is(private.nivel_seccion('categorias'), 'ninguno', 'mostrador: sin acceso a Categorías');

reset role;
select pg_temp.como('b1000000-0000-0000-0000-000000000005');
select is(private.nivel_seccion('stock'), 'edicion', 'depósito: edita Stock');
select is(private.nivel_seccion('clientes'), 'ninguno', 'depósito: sin acceso a Clientes');

reset role;
select pg_temp.como('b1000000-0000-0000-0000-000000000006');
select is(private.nivel_seccion('proveedores'), 'edicion', 'administración: edita Proveedores');
select is(private.nivel_seccion('rentabilidad'), 'lectura', 'administración: lee Rentabilidad');
select is(private.nivel_seccion('stock'), 'lectura', 'administración: lee Stock');

reset role;
select pg_temp.como('b1000000-0000-0000-0000-000000000007');
select is(private.nivel_seccion('productos'), 'lectura', 'miembro (template): sigue en solo lectura');
select is(private.nivel_seccion('usuarios_permisos'), 'ninguno', 'miembro (template): sin acceso a Usuarios y permisos');

reset role;
select pg_temp.como('b9000000-0000-0000-0000-000000000009');
select is(private.nivel_seccion('inicio'), 'ninguno', 'sin membresía: sin acceso (nunca acceso total por omisión)');

-- ============================================================================
-- Acciones: eliminar exige edición; exportar y ver costos exigen al menos lectura
-- ============================================================================

reset role;
select pg_temp.como('b1000000-0000-0000-0000-000000000001');
select ok(private.puede_accion('stock', 'eliminar'), 'administrador: puede eliminar');
select ok(private.puede_accion('stock', 'ver_costos'), 'administrador: ve costos');
select ok(not private.puede_accion('stock', 'inventada'), 'una acción desconocida se deniega');

reset role;
select pg_temp.como('b1000000-0000-0000-0000-000000000002');
select ok(not private.puede_accion('productos', 'eliminar'), 'operador: no puede eliminar (valor inicial propuesto)');
select ok(private.puede_accion('productos', 'exportar'), 'operador: puede exportar');
select ok(not private.puede_accion('empresas', 'exportar'), 'operador: sin acceso a Empresas → no exporta');

reset role;
select pg_temp.como('b1000000-0000-0000-0000-000000000006');
select ok(private.puede_accion('rentabilidad', 'ver_costos'), 'administración: ve costos con acceso de lectura');

-- ============================================================================
-- Efecto real sobre una tabla con el contrato (escenarios 3, 4, 5 y 8)
-- ============================================================================

reset role;
select pg_temp.como('b1000000-0000-0000-0000-000000000005');
select is((select count(*)::int from public.prueba_stock), 1, 'depósito (Edición) lee solo el stock de su organización');
select lives_ok(
  $$insert into public.prueba_stock (organizacion_id, nombre) values ('11111111-1111-1111-1111-111111111111', 'nuevo')$$,
  'depósito (Edición) puede escribir en Stock'
);

reset role;
select pg_temp.como('b1000000-0000-0000-0000-000000000003');
select is((select count(*)::int from public.prueba_stock), 2, 'consulta (Solo lectura) lee Stock');
select throws_ok(
  $$insert into public.prueba_stock (organizacion_id, nombre) values ('11111111-1111-1111-1111-111111111111', 'x')$$,
  '42501', null, 'consulta (Solo lectura) no puede escribir en Stock'
);

reset role;
select pg_temp.como('b1000000-0000-0000-0000-000000000004');
select is((select count(*)::int from public.prueba_stock), 2, 'mostrador (Solo lectura) lee Stock');

-- Sin acceso: se restringe Stock para Mostrador en la organización 1 (como postgres).
reset role;
update public.permisos_rol set nivel = 'ninguno'
 where organizacion_id = '11111111-1111-1111-1111-111111111111' and rol_id = 'mostrador' and seccion = 'stock';

select pg_temp.como('b1000000-0000-0000-0000-000000000004');
select is((select count(*)::int from public.prueba_stock), 0, 'mostrador (Sin acceso) no recibe filas aunque consulte la tabla directo');
select is(private.nivel_seccion('stock'), 'ninguno', 'el cambio de la matriz se aplica de inmediato, sin cachear en el token');

reset role;
select pg_temp.como('b2000000-0000-0000-0000-000000000001');
select is(
  (select count(*)::int from public.prueba_stock where organizacion_id = '11111111-1111-1111-1111-111111111111'),
  0, 'el administrador de la organización 2 no ve datos de la 1'
);
select is(private.nivel_seccion('stock'), 'edicion', 'la restricción de la organización 1 no afecta a la organización 2');

-- ============================================================================
-- Aislamiento de las tablas de permisos (FR-016)
-- ============================================================================

reset role;
select pg_temp.como('b1000000-0000-0000-0000-000000000002');
select is((select count(*)::int from permisos_rol), 16 * 8, 'operador de la organización 1 solo ve la matriz de su organización');
select is(
  (select count(*)::int from permisos_rol where organizacion_id = '22222222-2222-2222-2222-222222222222'),
  0, 'no ve permisos_rol de la organización 2'
);
select is(
  (select count(*)::int from permisos_rol_accion where organizacion_id = '22222222-2222-2222-2222-222222222222'),
  0, 'no ve permisos_rol_accion de la organización 2'
);
select throws_ok(
  $$update permisos_rol set nivel = 'edicion' where rol_id = 'operador'$$,
  '42501', null, 'no hay escritura directa sobre permisos_rol (llega con F-ROL-02 vía RPC)'
);
select throws_ok(
  $$insert into permisos_rol_accion (organizacion_id, rol_id, seccion, accion, permitido)
    values ('11111111-1111-1111-1111-111111111111', 'operador', 'stock', 'eliminar', true)$$,
  '42501', null, 'no hay escritura directa sobre permisos_rol_accion'
);

reset role;
select pg_temp.como('b9000000-0000-0000-0000-000000000009');
select is((select count(*)::int from permisos_rol), 0, 'un usuario sin organización no ve ninguna matriz');

-- RPC de lectura para el panel
reset role;
select pg_temp.como('b1000000-0000-0000-0000-000000000005');
select is((select count(*)::int from public.permisos_actuales()), 16, 'permisos_actuales devuelve las 16 secciones');
select is((select nivel from public.permisos_actuales() where seccion = 'stock'), 'edicion', 'permisos_actuales refleja el nivel del usuario');

-- ============================================================================
-- RLS en todas las tablas de los esquemas expuestos (public + dominio)
-- ============================================================================

reset role;
select is(
  (select count(*)::int from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname in ('public', 'dominio') and c.relkind in ('r', 'p') and not c.relrowsecurity),
  0, 'toda tabla de public y dominio tiene RLS activada (incluye las nuevas)'
);
select ok(
  (select relrowsecurity from pg_class where oid = 'public.permisos_rol'::regclass)
  and (select relrowsecurity from pg_class where oid = 'public.permisos_rol_accion'::regclass),
  'permisos_rol y permisos_rol_accion tienen RLS'
);

-- ============================================================================
-- Regresión (escenario 9): private.puede_escribir() conserva su comportamiento
-- ============================================================================

select pg_temp.como('b1000000-0000-0000-0000-000000000001');
select ok(private.puede_escribir(), 'administrador: puede_escribir sigue verdadero');
reset role;
select pg_temp.como('b1000000-0000-0000-0000-000000000002');
select ok(not private.puede_escribir(), 'operador: puede_escribir sigue siendo falso (solo administrador del template)');
reset role;
select pg_temp.como('b1000000-0000-0000-0000-000000000007');
select ok(not private.puede_escribir(), 'miembro: puede_escribir sigue siendo falso');
select throws_ok(
  $$insert into clientes (organizacion_id, nombre) values ('11111111-1111-1111-1111-111111111111', 'x')$$,
  '42501', null, 'clientes (política por sección): el miembro (solo lectura) no inserta'
);
reset role;
select pg_temp.como('b1000000-0000-0000-0000-000000000001');
select lives_ok(
  $$insert into clientes (organizacion_id, nombre) values ('11111111-1111-1111-1111-111111111111', 'ok')$$,
  'clientes (política por sección): el administrador inserta'
);
reset role;
select pg_temp.como('b1000000-0000-0000-0000-000000000002');
select lives_ok(
  $$insert into clientes (organizacion_id, nombre) values ('11111111-1111-1111-1111-111111111111', 'del operador')$$,
  'clientes (política por sección): el operador (edición en Clientes) inserta aunque puede_escribir() sea falso'
);
reset role;
select pg_temp.como('b1000000-0000-0000-0000-000000000005');
select is(
  (select count(*) from clientes)::int, 0,
  'clientes: depósito (sección en ninguno) no lee filas ni siquiera por la API'
);
reset role;

-- Un superadmin con organización activa opera como administrador
reset role;
insert into auth.users (id, email) values ('b5000000-0000-0000-0000-000000000005', 'super@example.com');
insert into superadmins (user_id) values ('b5000000-0000-0000-0000-000000000005');
insert into superadmin_organizacion_activa (user_id, organizacion_id) values
  ('b5000000-0000-0000-0000-000000000005', '11111111-1111-1111-1111-111111111111');
select pg_temp.como('b5000000-0000-0000-0000-000000000005');
select is(private.nivel_seccion('usuarios_permisos'), 'edicion', 'superadmin con organización activa = administrador');
select ok(private.puede_accion('stock', 'eliminar'), 'superadmin con organización activa puede eliminar');

select * from finish();
rollback;
