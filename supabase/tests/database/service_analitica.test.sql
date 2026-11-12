-- F-SVC-23 (MSF-168, épica MSF-124): vistas `analitica.service_*` para el tablero de Service (SC-010, FR-062).
-- Cubre: columnas esperadas, ausencia de costos internos, `organizacion_id` aislante entre dos organizaciones,
-- técnico con nombre visible (nunca el correo), solo `superset_analitica` lee, `anon`/`authenticated` sin acceso
-- y rol de Superset sin lectura directa de las tablas de dominio.
begin;

select no_plan();

insert into organizaciones (id, nombre) values
  ('11111111-1111-1111-1111-111111111111', 'Organización Uno'),
  ('22222222-2222-2222-2222-222222222222', 'Organización Dos');

insert into auth.users (id, email) values
  ('e1000000-0000-0000-0000-000000000001', 'administrador@example.com'),
  ('e2000000-0000-0000-0000-000000000001', 'admin-dos@example.com');

insert into usuarios_organizacion (user_id, organizacion_id, rol_id, estado) values
  ('e1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'administrador', 'activo'),
  ('e2000000-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', 'administrador', 'activo');

insert into dominio.empresas (id, organizacion_id, nombre) values
  ('a1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'San Javucho'),
  ('a1000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'Mundo JC'),
  ('a2000000-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', 'Empresa Dos');

insert into clientes (id, organizacion_id, numero, nombre, tipo, archivado_en) values
  ('c5000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 10, 'Distribuidora Norte', 'mayorista', null),
  ('c6000000-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', 10, 'Cliente de la Dos', 'minorista', null);

create function pg_temp.como(p_user uuid) returns void language plpgsql as $$
begin
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
  set local role authenticated;
end $$;

create temp table datos as
  select
    (select id from dominio.modelos_equipo where organizacion_id = '11111111-1111-1111-1111-111111111111' and equipo = 'Nintendo Switch' and modelo = 'Estándar') as modelo_uno,
    (select id from dominio.modelos_equipo where organizacion_id = '22222222-2222-2222-2222-222222222222' and equipo = 'Nintendo Switch' and modelo = 'Estándar') as modelo_dos;
grant select on datos to public;

create temp table reps (clave text primary key, id uuid);
grant select, insert on reps to public;

-- ============================================================================
-- Superficie: columnas, privilegios y ausencia de costos
-- ============================================================================

select is(
  (select array_agg(attname::text order by attnum) from pg_catalog.pg_attribute
    where attrelid = 'analitica.service_reparaciones'::regclass and attnum > 0 and not attisdropped),
  array['organizacion_id', 'empresa_id', 'empresa_nombre', 'reparacion_id', 'codigo', 'ingreso_en', 'entrega_prevista',
        'entrega_real', 'estado_id', 'estado_nombre', 'estado_cierra', 'tecnico_id', 'tecnico_nombre', 'equipo', 'modelo',
        'anulada', 'total_mano_obra', 'total_repuestos', 'total_cliente'],
  'service_reparaciones expone exactamente las columnas de FR-062');
select is(
  (select array_agg(attname::text order by attnum) from pg_catalog.pg_attribute
    where attrelid = 'analitica.service_reparacion_items'::regclass and attnum > 0 and not attisdropped),
  array['organizacion_id', 'empresa_id', 'empresa_nombre', 'reparacion_id', 'item_id', 'tipo', 'cantidad', 'subtotal', 'ingreso_en'],
  'service_reparacion_items expone exactamente las columnas de FR-062');
select is(
  (select count(*)::int from pg_catalog.pg_attribute
    where attrelid in ('analitica.service_reparaciones'::regclass, 'analitica.service_reparacion_items'::regclass)
      and attnum > 0 and not attisdropped
      and (attname ilike '%costo%' or attname ilike '%ganancia%' or attname ilike '%margen%' or attname ilike '%correo%' or attname ilike '%email%')),
  0, 'ninguna vista expone costos internos, ganancia ni correos');

select ok(has_table_privilege('superset_analitica', 'analitica.service_reparaciones', 'SELECT'), 'superset_analitica lee service_reparaciones');
select ok(has_table_privilege('superset_analitica', 'analitica.service_reparacion_items', 'SELECT'), 'superset_analitica lee service_reparacion_items');
select ok(
  not has_table_privilege('anon', 'analitica.service_reparaciones', 'SELECT')
  and not has_table_privilege('authenticated', 'analitica.service_reparaciones', 'SELECT')
  and not has_table_privilege('anon', 'analitica.service_reparacion_items', 'SELECT')
  and not has_table_privilege('authenticated', 'analitica.service_reparacion_items', 'SELECT'),
  'anon y authenticated no leen las vistas de Service');
select ok(
  not has_table_privilege('superset_analitica', 'analitica.service_reparaciones', 'INSERT,UPDATE,DELETE,TRUNCATE')
  and not has_table_privilege('superset_analitica', 'analitica.service_reparacion_items', 'INSERT,UPDATE,DELETE,TRUNCATE'),
  'superset_analitica no escribe en las vistas de Service');
select ok(
  not has_table_privilege('superset_analitica', 'dominio.reparaciones', 'SELECT')
  and not has_table_privilege('superset_analitica', 'dominio.reparacion_items', 'SELECT'),
  'superset_analitica no lee las tablas de dominio directamente');

-- ============================================================================
-- Datos: dos reparaciones en la organización Uno (dos tiendas) y una en la Dos
-- ============================================================================

select pg_temp.como('e1000000-0000-0000-0000-000000000001');
insert into reps (clave, id) values
  ('A', (public.crear_reparacion('a1000000-0000-0000-0000-000000000001', 'c5000000-0000-0000-0000-000000000001', (select modelo_uno from datos), p_numero_serie => 'AAA-1')->>'id')::uuid),
  ('B', (public.crear_reparacion('a1000000-0000-0000-0000-000000000002', 'c5000000-0000-0000-0000-000000000001', (select modelo_uno from datos), p_numero_serie => 'BBB-2')->>'id')::uuid);
-- A: 2 × 50 de mano de obra + 1 × 30 de repuesto = 130 al cliente.
select public.agregar_item_reparacion((select id from reps where clave = 'A'), 'mano_obra', 'Diagnóstico', null, 2, 50);
select public.agregar_item_reparacion((select id from reps where clave = 'A'), 'repuesto', 'Cinta', null, 1, 30);

select pg_temp.como('e2000000-0000-0000-0000-000000000001');
insert into reps (clave, id) values
  ('Z', (public.crear_reparacion('a2000000-0000-0000-0000-000000000001', 'c6000000-0000-0000-0000-000000000001', (select modelo_dos from datos), p_numero_serie => 'ZZZ-9')->>'id')::uuid);

-- Técnico con nombre visible en A; costos internos cargados para comprobar que no salen.
reset role;
insert into public.perfiles_usuario (user_id, nombre, apellido) values ('e1000000-0000-0000-0000-000000000001', 'Ana', 'Pérez')
  on conflict (user_id) do update set nombre = excluded.nombre, apellido = excluded.apellido;
update dominio.reparaciones
   set tecnico_id = 'e1000000-0000-0000-0000-000000000001', costo_mano_obra = 77, costo_repuestos = 88
 where id = (select id from reps where clave = 'A');

-- ============================================================================
-- Lectura como el rol de Superset
-- ============================================================================

-- El usuario de la prueba no es miembro de `superset_analitica` (SET ROLE falla en el CI): se lee como
-- propietario y los privilegios del rol se comprueban aparte con has_table_privilege.
reset role;

select ok(
  has_table_privilege('superset_analitica', 'analitica.service_reparaciones', 'SELECT')
  and has_table_privilege('superset_analitica', 'analitica.service_reparacion_items', 'SELECT'),
  'el rol de Superset lee las vistas de Service');
select ok(
  not has_table_privilege('superset_analitica', 'dominio.reparaciones', 'SELECT')
  and not has_table_privilege('superset_analitica', 'analitica.service_reparaciones', 'INSERT'),
  'el rol de Superset no lee la tabla de dominio ni escribe en la vista');

select is(
  (select count(*)::int from analitica.service_reparaciones where organizacion_id = '11111111-1111-1111-1111-111111111111'),
  2, 'la organización Uno ve sus dos reparaciones');
select is(
  (select count(*)::int from analitica.service_reparaciones where organizacion_id = '22222222-2222-2222-2222-222222222222'),
  1, 'la organización Dos ve la suya');
select is(
  (select count(distinct organizacion_id)::int from analitica.service_reparaciones
    where reparacion_id in ((select id from reps where clave = 'A'), (select id from reps where clave = 'Z'))),
  2, 'cada fila lleva la organización dueña (la cláusula rls del token filtra por ella)');
select is(
  (select tecnico_nombre from analitica.service_reparaciones where reparacion_id = (select id from reps where clave = 'A')),
  'Ana Pérez', 'el técnico sale con nombre visible, no con el correo');
select is(
  (select tecnico_nombre from analitica.service_reparaciones where reparacion_id = (select id from reps where clave = 'B')),
  null, 'sin técnico asignado el nombre es nulo');
select is(
  (select trim_scale(total_mano_obra) || '/' || trim_scale(total_repuestos) || '/' || trim_scale(total_cliente)
     from analitica.service_reparaciones where reparacion_id = (select id from reps where clave = 'A')),
  '100/30/130', 'totales de cara al cliente (mano de obra, repuestos y total)');
select is(
  (select empresa_nombre from analitica.service_reparaciones where reparacion_id = (select id from reps where clave = 'B')),
  'Mundo JC', 'la tienda sale con su nombre');
select is(
  (select estado_cierra from analitica.service_reparaciones where reparacion_id = (select id from reps where clave = 'A')),
  false, 'una reparación recién creada no está en un estado que cierra');

select is(
  (select count(*)::int from analitica.service_reparacion_items where organizacion_id = '11111111-1111-1111-1111-111111111111'),
  2, 'la vista de ítems trae los dos ítems de la organización Uno');
select is(
  (select count(*)::int from analitica.service_reparacion_items where organizacion_id = '22222222-2222-2222-2222-222222222222'),
  0, 'la organización Dos no tiene ítems (no se mezclan con los de Uno)');
select is(
  (select sum(subtotal)::numeric from analitica.service_reparacion_items where tipo = 'mano_obra'),
  100::numeric, 'subtotal de mano de obra');
select is(
  (select ingreso_en = (select ingreso_en from analitica.service_reparaciones where reparacion_id = (select id from reps where clave = 'A'))
     from analitica.service_reparacion_items limit 1),
  true, 'cada ítem trae el ingreso de su reparación');

-- ============================================================================
-- authenticated y anon no leen
-- ============================================================================

reset role;
select pg_temp.como('e1000000-0000-0000-0000-000000000001');
select throws_ok('select count(*) from analitica.service_reparaciones', '42501', null, 'authenticated no lee service_reparaciones');
select throws_ok('select count(*) from analitica.service_reparacion_items', '42501', null, 'authenticated no lee service_reparacion_items');
reset role;
set local role anon;
select throws_ok('select count(*) from analitica.service_reparaciones', '42501', null, 'anon no lee service_reparaciones');

select * from finish();
rollback;
