-- F-STK-14 (MSF-316, épica MSF-292): depósitos y existencias por depósito.
-- Cubre FR-001, FR-003, FR-004, FR-006, FR-007, FR-015 y SC-001, SC-004, SC-005: nombre único,
-- exactamente un depósito por defecto, backfill que conserva el total, total = suma por
-- depósito tras cada RPC, solo el Administrador define depósitos, aislamiento entre
-- organizaciones, sin escritura directa y `anon` sin acceso. La prueba genérica
-- `rls_en_toda_tabla` / `aislamiento_organizaciones` recorre las tablas nuevas sin tocarlas.
-- Corre como postgres para armar el fixture y como "authenticated" (request.jwt.claims,
-- igual que PostgREST) para verificar.
begin;

select plan(45);

insert into organizaciones (id, nombre) values
  ('11111111-1111-1111-1111-111111111111', 'Organización Uno'),
  ('22222222-2222-2222-2222-222222222222', 'Organización Dos');

insert into auth.users (id, email) values
  ('d1000000-0000-0000-0000-000000000001', 'administrador@example.com'),
  ('d1000000-0000-0000-0000-000000000002', 'operador@example.com'),
  ('d1000000-0000-0000-0000-000000000003', 'consulta@example.com'),
  ('d2000000-0000-0000-0000-000000000001', 'admin-dos@example.com');

insert into usuarios_organizacion (user_id, organizacion_id, rol_id) values
  ('d1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'administrador'),
  ('d1000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'operador'),
  ('d1000000-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111', 'consulta'),
  ('d2000000-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', 'administrador');

insert into dominio.empresas (id, organizacion_id, nombre) values
  ('e1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'Tienda Uno A'),
  ('e1000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'Tienda Uno B'),
  ('e2000000-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', 'Tienda Dos A');

insert into dominio.productos (id, organizacion_id, nombre, sku, precio_lista) values
  ('a1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'Joystick Pro', 'JOY-1', 50),
  ('a1000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'Cable HDMI', 'HDM-1', 5),
  ('a2000000-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', 'Teclado Dos', 'TEC-2', 30);

create temp table ids on commit drop as
select m.organizacion_id, m.nombre, m.id from dominio.motivos_movimiento m;
grant select on ids to authenticated;

create function pg_temp.como(p_user uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
  set local role authenticated;
end $$;

-- SC-001: ninguna existencia tiene un total distinto de la suma por depósito.
create function pg_temp.total_coincide() returns boolean language sql as $$
  select not exists (
    select 1 from dominio.existencias e
     where e.cantidad <> coalesce((select sum(x.cantidad) from dominio.existencias_deposito x where x.producto_id = e.producto_id), 0)
        or e.reservado <> coalesce((select sum(x.reservado) from dominio.existencias_deposito x where x.producto_id = e.producto_id), 0)
  );
$$;

-- ============================================================================
-- Esquema (Principio VII) y depósito principal (FR-001, FR-015)
-- ============================================================================

select has_table('dominio', 'depositos', 'depositos vive en dominio');
select has_table('dominio', 'depositos_empresas', 'depositos_empresas vive en dominio');
select has_table('dominio', 'existencias_deposito', 'existencias_deposito vive en dominio');

select is(
  (select count(*)::int from dominio.depositos where organizacion_id = '11111111-1111-1111-1111-111111111111'),
  1, 'exactamente un depósito por defecto activo: la organización nace con uno'
);
select is(
  (select nombre from dominio.depositos where organizacion_id = '11111111-1111-1111-1111-111111111111' and por_defecto and activo),
  'Depósito principal', 'backfill: la organización recibe «Depósito principal» por defecto y activo'
);

-- Backfill (D-9, SC-004): el reparto de la migración conserva el total de cada producto.
update dominio.existencias set cantidad = 10 where producto_id = 'a1000000-0000-0000-0000-000000000001';
insert into dominio.existencias_deposito (producto_id, deposito_id, organizacion_id, cantidad)
select e.producto_id, d.id, e.organizacion_id, e.cantidad
  from dominio.existencias e
  join dominio.depositos d on d.organizacion_id = e.organizacion_id and d.por_defecto
 where e.cantidad > 0
on conflict (producto_id, deposito_id) do nothing;

select ok(pg_temp.total_coincide(), 'backfill crea Depósito principal y conserva el total de cada producto');
select is(
  (select count(*)::int from (
     select 1 from dominio.depositos d where d.por_defecto group by d.organizacion_id having count(*) > 1
   ) repetidos),
  0, 'backfill conserva un único defecto por organización'
);

-- Restricciones (FR-007).
select throws_ok(
  $$update dominio.existencias_deposito set reservado = cantidad + 1$$,
  '23514', null, 'restricción: reservado no puede superar la cantidad'
);
select throws_ok(
  $$update dominio.existencias_deposito set cantidad = -1$$,
  '23514', null, 'restricción: la cantidad por depósito no puede ser negativa'
);

-- ============================================================================
-- Administrador: crear, nombre único, por defecto, activo (FR-001…FR-004)
-- ============================================================================

select pg_temp.como('d1000000-0000-0000-0000-000000000001');

select lives_ok(
  $$select public.crear_deposito('Depósito Sur', 'Calle 1', array['e1000000-0000-0000-0000-000000000001']::uuid[])$$,
  'administrador: crea un depósito con dirección y empresas'
);
select throws_ok(
  $$select public.crear_deposito('  depósito SUR ')$$,
  '23505', 'Ya existe un depósito con ese nombre', 'nombre único por organización sin distinguir mayúsculas'
);
select throws_ok(
  $$select public.crear_deposito('   ')$$,
  '22023', 'El nombre del depósito debe tener entre 1 y 80 caracteres', 'el nombre no puede quedar vacío'
);
select is(
  (select empresa_ids from public.depositos_listado where nombre = 'Depósito Sur'),
  array['e1000000-0000-0000-0000-000000000001']::uuid[], 'el listado informa las empresas que venden desde acá'
);
select throws_ok(
  $$select public.crear_deposito('Depósito Fuera', null, array['e2000000-0000-0000-0000-000000000001']::uuid[])$$,
  '22023', 'Alguna de las empresas elegidas no es válida', 'una empresa de otra organización se rechaza'
);
select lives_ok(
  $$select public.actualizar_deposito(
      (select id from dominio.depositos where nombre = 'Depósito Sur'), 'Depósito Sur 2', null,
      array['e1000000-0000-0000-0000-000000000002']::uuid[])$$,
  'administrador: edita nombre, dirección y empresas con el mismo formulario'
);
select is(
  (select empresa_ids from public.depositos_listado where nombre = 'Depósito Sur 2'),
  array['e1000000-0000-0000-0000-000000000002']::uuid[], 'la edición reemplaza el conjunto «Venden desde acá»'
);

select throws_ok(
  $$select public.cambiar_activo_deposito((select id from dominio.depositos where por_defecto), false)$$,
  '22023', 'El depósito por defecto no se puede desactivar', 'el por defecto no se desactiva'
);

select lives_ok(
  $$select public.definir_deposito_por_defecto((select id from dominio.depositos where nombre = 'Depósito Sur 2'))$$,
  'administrador: usa «Depósito Sur 2» por defecto'
);
select is(
  (select count(*)::int from dominio.depositos where por_defecto), 1,
  'definir_deposito_por_defecto deja un único por defecto'
);
select is(
  (select nombre from dominio.depositos where por_defecto), 'Depósito Sur 2',
  'el nuevo depósito por defecto es el elegido'
);

-- Un inactivo no puede ser el por defecto ni admite entradas.
select lives_ok(
  $$select public.crear_deposito('Depósito Norte')$$,
  'administrador: crea «Depósito Norte»'
);
select lives_ok(
  $$select public.cambiar_activo_deposito((select id from dominio.depositos where nombre = 'Depósito Norte'), false)$$,
  'administrador: desactiva un depósito sin unidades'
);
select throws_ok(
  $$select public.definir_deposito_por_defecto((select id from dominio.depositos where nombre = 'Depósito Norte'))$$,
  '22023', 'Activá el depósito antes de usarlo por defecto', 'un inactivo no puede ser el por defecto'
);

reset role;

-- ============================================================================
-- Operador: movimientos por depósito mantienen total = suma (FR-007, SC-001)
-- ============================================================================

select pg_temp.como('d1000000-0000-0000-0000-000000000002');

select lives_ok(
  $$select public.registrar_movimiento_stock('a1000000-0000-0000-0000-000000000001', 'entrada', 3,
      (select id from ids where nombre = 'Compra a proveedor' and organizacion_id = '11111111-1111-1111-1111-111111111111'),
      null, current_date,
      (select id from dominio.depositos where nombre = 'Depósito Sur 2'))$$,
  'operador: entrada de 3 en «Depósito Sur 2»'
);
select ok(pg_temp.total_coincide(), 'total = suma por depósito tras la entrada');
select is(
  (select cantidad from dominio.existencias where producto_id = 'a1000000-0000-0000-0000-000000000001'),
  13, 'el total único es 13 (10 en el principal + 3 en Sur 2)'
);
select throws_ok(
  $$select public.registrar_movimiento_stock('a1000000-0000-0000-0000-000000000001', 'entrada', 1,
      (select id from ids where nombre = 'Compra a proveedor' and organizacion_id = '11111111-1111-1111-1111-111111111111'),
      null, current_date,
      (select id from dominio.depositos where nombre = 'Depósito Norte'))$$,
  '22023', 'El depósito está inactivo: elegí otro para este movimiento', 'un inactivo no admite entradas'
);

reset role;

-- Con unidades no se desactiva (el principal ya no es el por defecto y tiene 10).
select pg_temp.como('d1000000-0000-0000-0000-000000000001');

select throws_ok(
  $$select public.cambiar_activo_deposito((select id from dominio.depositos where nombre = 'Depósito principal'), false)$$,
  '22023', 'Tiene stock: trasladá la mercadería antes de desactivarlo', 'con unidades no se desactiva'
);
select is(
  (select unidades from public.depositos_listado where nombre = 'Depósito principal'),
  10::bigint, 'el listado informa las unidades del depósito'
);
select is(
  (select productos_con_stock from public.depositos_listado where nombre = 'Depósito principal'),
  1::bigint, 'el listado informa los productos con stock del depósito'
);

reset role;

-- ============================================================================
-- Solo el Administrador define depósitos (FR-006, SC-005)
-- ============================================================================

select pg_temp.como('d1000000-0000-0000-0000-000000000002');

select throws_ok(
  $$select public.crear_deposito('Depósito Operador')$$,
  '42501', 'Solo el Administrador puede definir depósitos', 'operador (edicion) no crea depósitos'
);
select throws_ok(
  $$select public.actualizar_deposito((select id from dominio.depositos where por_defecto), 'Otro nombre')$$,
  '42501', 'Solo el Administrador puede definir depósitos', 'operador no edita depósitos'
);
select throws_ok(
  $$select public.definir_deposito_por_defecto((select id from dominio.depositos where nombre = 'Depósito principal'))$$,
  '42501', 'Solo el Administrador puede definir depósitos', 'operador no cambia el por defecto'
);
select throws_ok(
  $$select public.cambiar_activo_deposito((select id from dominio.depositos where nombre = 'Depósito Norte'), true)$$,
  '42501', 'Solo el Administrador puede definir depósitos', 'operador no activa ni desactiva'
);
select is(
  (select count(*)::int from dominio.depositos), 3, 'operador ve los depósitos de su organización (solo lectura)'
);
select throws_ok(
  $$insert into dominio.existencias_deposito (producto_id, deposito_id, organizacion_id, cantidad)
    values ('a1000000-0000-0000-0000-000000000002', (select id from dominio.depositos where por_defecto), '11111111-1111-1111-1111-111111111111', 5)$$,
  '42501', null, 'authenticated sin escritura directa en existencias_deposito'
);
select throws_ok(
  $$update dominio.depositos set nombre = 'Hackeado'$$,
  '42501', null, 'authenticated sin escritura directa en depositos'
);

reset role;

select pg_temp.como('d1000000-0000-0000-0000-000000000003');

select throws_ok(
  $$select public.crear_deposito('Depósito Consulta')$$,
  '42501', 'Solo el Administrador puede definir depósitos', 'consulta no crea depósitos'
);
select is(
  (select count(*)::int from dominio.existencias_deposito), 2, 'consulta ve las existencias por depósito'
);

reset role;

-- ============================================================================
-- Aislamiento entre organizaciones (SC-005)
-- ============================================================================

select pg_temp.como('d2000000-0000-0000-0000-000000000001');

select is(
  (select count(*)::int from dominio.depositos where organizacion_id = '11111111-1111-1111-1111-111111111111'),
  0, 'otra organización no ve filas de depósitos'
);
select is(
  (select count(*)::int from dominio.existencias_deposito), 0, 'otra organización no ve existencias por depósito'
);
select throws_ok(
  $$select public.actualizar_deposito('00000000-0000-0000-0000-00000000dead', 'Robado')$$,
  '22023', 'No encontramos ese depósito', 'otra organización no opera depósitos ajenos'
);

reset role;

-- ============================================================================
-- anon y privilegios (FR-006, FR-015)
-- ============================================================================

select is(has_table_privilege('anon', 'dominio.depositos', 'SELECT'), false, 'anon no lee depositos');
select is(
  (select count(*)::int
     from unnest(array[
       'public.crear_deposito(text, text, uuid[])',
       'public.actualizar_deposito(uuid, text, text, uuid[])',
       'public.definir_deposito_por_defecto(uuid)',
       'public.cambiar_activo_deposito(uuid, boolean)'
     ]) f
    where has_function_privilege('anon', f, 'EXECUTE')),
  0, 'anon no ejecuta las RPC de gestión de depósitos'
);
select is(
  (select count(*)::int
     from unnest(array['dominio.depositos', 'dominio.depositos_empresas', 'dominio.existencias_deposito']) t
    where has_table_privilege('authenticated', t, 'INSERT')
       or has_table_privilege('authenticated', t, 'UPDATE')
       or has_table_privilege('authenticated', t, 'DELETE')),
  0, 'authenticated no tiene escritura directa en las tablas nuevas'
);

select * from finish();

rollback;
