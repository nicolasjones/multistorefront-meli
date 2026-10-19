-- F-PRV-03 (MSF-367, épica MSF-205): relación proveedor ↔ producto.
-- Cubre SC-005: columnas y FK compuesta, rechazo de proveedor ajeno, inexistente o
-- inactivo nuevo, código sin proveedor, quitar proveedor limpia el código,
-- `proveedores_basico` sin CUIT ni contacto para un Operador y sin filas ajenas,
-- `productos_de_proveedor` por niveles y `crear/actualizar_producto` con y sin proveedor.
begin;

select plan(35);

insert into organizaciones (id, nombre) values
  ('11111111-1111-1111-1111-111111111111', 'Organización Uno'),
  ('22222222-2222-2222-2222-222222222222', 'Organización Dos');

insert into auth.users (id, email) values
  ('d1000000-0000-0000-0000-000000000001', 'administrador@example.com'),
  ('d1000000-0000-0000-0000-000000000002', 'operador@example.com'),
  ('d2000000-0000-0000-0000-000000000001', 'admin-dos@example.com');

insert into usuarios_organizacion (user_id, organizacion_id, rol_id) values
  ('d1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'administrador'),
  ('d1000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'operador'),
  ('d2000000-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', 'administrador');

create function pg_temp.como(p_user uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
  set local role authenticated;
end $$;

-- Datos de partida (como administrador de cada organización).
select pg_temp.como('d2000000-0000-0000-0000-000000000001');
select public.crear_proveedor('Proveedor Ajeno SA', '30701234568', 'Contacto Ajeno', 'ajeno@example.com');
create temp table ajeno as select id from dominio.proveedores where cuit = '30701234568';
grant select on ajeno to authenticated;

select pg_temp.como('d1000000-0000-0000-0000-000000000001');
select public.crear_proveedor('Proveedor Uno SA', '20123456786', 'Ana Pérez', 'ventas@uno.example.com');
select public.crear_proveedor('Proveedor Dos SA', '33555555550');
create temp table provs as select id, razon_social from dominio.proveedores where organizacion_id = '11111111-1111-1111-1111-111111111111';
grant select on provs to authenticated;

-- ============================================================================
-- Estructura
-- ============================================================================

select has_column('dominio', 'productos', 'proveedor_id', 'productos tiene proveedor_id');
select has_column('dominio', 'productos', 'codigo_proveedor', 'productos tiene codigo_proveedor');
select fk_ok('dominio', 'productos', array['proveedor_id', 'organizacion_id'],
             'dominio', 'proveedores', array['id', 'organizacion_id'],
             'FK compuesta (proveedor_id, organizacion_id)');

-- ============================================================================
-- Alta con y sin proveedor
-- ============================================================================

select lives_ok(
  $$select public.crear_producto('Sin proveedor', null, null, null, 'USD', 10)$$,
  'crear_producto sin proveedor sigue funcionando con la firma anterior'
);
select lives_ok(
  format($f$select public.crear_producto('Con proveedor', null, null, null, 'USD', 10, null, %L::uuid, '  COD-1  ')$f$,
         (select id from provs where razon_social = 'Proveedor Uno SA')),
  'crear_producto con proveedor y código'
);
select is(
  (select codigo_proveedor from dominio.productos where nombre = 'Con proveedor'),
  'COD-1', 'el código del proveedor se guarda recortado'
);
select throws_ok(
  format($f$select public.crear_producto('Código huérfano', null, null, null, 'USD', 10, null, null, 'COD-2')$f$),
  '22023', null, 'un código sin proveedor se rechaza'
);
select throws_ok(
  format($f$select public.crear_producto('Ajeno', null, null, null, 'USD', 10, null, %L::uuid)$f$, (select id from ajeno)),
  '22023', null, 'no se asigna un proveedor de otra organización'
);
select throws_ok(
  $$select public.crear_producto('Inexistente', null, null, null, 'USD', 10, null, 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'::uuid)$$,
  '22023', null, 'no se asigna un proveedor inexistente'
);
select throws_ok(
  $$insert into dominio.productos (organizacion_id, nombre, precio_lista, codigo_proveedor)
    values ('11111111-1111-1111-1111-111111111111', 'Directo', 10, 'X')$$,
  '23514', null, 'la restricción de la base rechaza un código sin proveedor'
);

-- ============================================================================
-- Edición: cambiar, quitar, desactivar proveedor
-- ============================================================================

create temp table prod as select id, updated_at from dominio.productos where nombre = 'Con proveedor';
grant select on prod to authenticated;

select lives_ok(
  format($f$select public.actualizar_producto(%L::uuid, %L::timestamptz, 'Con proveedor', null, null, null, 'USD', 10, null, %L::uuid, 'COD-9', true)$f$,
         (select id from prod), (select updated_at from prod), (select id from provs where razon_social = 'Proveedor Dos SA')),
  'actualizar_producto cambia de proveedor y código'
);
select is(
  (select codigo_proveedor from dominio.productos where nombre = 'Con proveedor'),
  'COD-9', 'el código nuevo queda guardado'
);
select ok(
  (select updated_at from dominio.productos where nombre = 'Con proveedor') > (select updated_at from prod),
  'cambiar solo el proveedor/código avanza updated_at (bloqueo optimista)'
);
select is(
  (select count(*)::int from public.registro_actividad where tipo = 'producto.editado' and detalle like '%Con proveedor%'),
  1, 'el cambio de proveedor deja el evento producto.editado'
);

-- Proveedor desactivado: la asignación se conserva y el producto sigue editable.
select public.cambiar_estado_proveedor((select id from provs where razon_social = 'Proveedor Dos SA'), false);
create or replace temp view prod_act as select id, updated_at from dominio.productos where nombre = 'Con proveedor';
grant select on prod_act to authenticated;
select lives_ok(
  format($f$select public.actualizar_producto(%L::uuid, %L::timestamptz, 'Con proveedor editado', null, null, null, 'USD', 10, null, %L::uuid, 'COD-9', true)$f$,
         (select id from prod_act), (select updated_at from prod_act), (select id from provs where razon_social = 'Proveedor Dos SA')),
  'un producto con proveedor desactivado se sigue editando'
);
select is(
  (select proveedor_id from dominio.productos where nombre = 'Con proveedor editado'),
  (select id from provs where razon_social = 'Proveedor Dos SA'),
  'la asignación a un proveedor desactivado se conserva'
);
select throws_ok(
  format($f$select public.crear_producto('Nuevo inactivo', null, null, null, 'USD', 10, null, %L::uuid)$f$,
         (select id from provs where razon_social = 'Proveedor Dos SA')),
  '22023', null, 'no se asigna a un producto nuevo un proveedor desactivado'
);

-- Llamador con la firma anterior (9 argumentos): «no enviado = sin cambio», no borra el proveedor.
create or replace temp view prod_l as select id, updated_at from dominio.productos where nombre = 'Con proveedor editado';
grant select on prod_l to authenticated;
select lives_ok(
  format($f$select public.actualizar_producto(%L::uuid, %L::timestamptz, 'Con proveedor editado', null, null, null, 'USD', 10, null)$f$,
         (select id from prod_l), (select updated_at from prod_l)),
  'un llamador con la firma anterior (sin p_cambiar_proveedor) edita el producto'
);
select ok(
  (select proveedor_id = (select id from provs where razon_social = 'Proveedor Dos SA') and codigo_proveedor = 'COD-9'
     from dominio.productos where nombre = 'Con proveedor editado'),
  'la firma anterior no borra el proveedor ni el código'
);

-- Quitar el proveedor limpia el código.
create or replace temp view prod_q as select id, updated_at from dominio.productos where nombre = 'Con proveedor editado';
grant select on prod_q to authenticated;
select lives_ok(
  format($f$select public.actualizar_producto(%L::uuid, %L::timestamptz, 'Con proveedor editado', null, null, null, 'USD', 10, null, null, null, true)$f$,
         (select id from prod_q), (select updated_at from prod_q)),
  'quitar el proveedor'
);
select ok(
  (select proveedor_id is null and codigo_proveedor is null from dominio.productos where nombre = 'Con proveedor editado'),
  'sin proveedor y sin código'
);

-- ============================================================================
-- proveedores_basico
-- ============================================================================

select is(
  (select array_agg(column_name::text order by ordinal_position)
     from information_schema.columns
    where table_schema = 'public' and table_name = 'proveedores_basico'),
  array['id', 'razon_social', 'activo'], 'la vista expone solo id, razón social y estado'
);

select pg_temp.como('d1000000-0000-0000-0000-000000000002');
select is(
  (select count(*)::int from public.proveedores_basico), 2,
  'Operador (sin sección proveedores) ve los proveedores de su organización por la vista'
);
select is(
  (select count(*)::int from public.proveedores_basico where id = (select id from ajeno)), 0,
  'la vista no muestra proveedores de otra organización'
);
select is(
  (select count(*)::int from dominio.proveedores), 0,
  'Operador no lee la tabla de proveedores (sin CUIT ni contacto)'
);
select throws_ok(
  $$select cuit from public.proveedores_basico$$, '42703', null,
  'la vista no tiene columna cuit'
);

-- ============================================================================
-- productos_de_proveedor
-- ============================================================================

select throws_ok(
  format($f$select * from public.productos_de_proveedor(%L::uuid)$f$, (select id from provs where razon_social = 'Proveedor Uno SA')),
  '42501', null, 'Operador (sin proveedores) no ve los productos del proveedor'
);

select pg_temp.como('d1000000-0000-0000-0000-000000000001');
select is(
  (select count(*)::int from public.productos_de_proveedor((select id from provs where razon_social = 'Proveedor Uno SA'))),
  0, 'Proveedor Uno ya no tiene productos tras reasignar y quitar'
);
select public.crear_producto('Zeta', null, null, null, 'USD', 10, null, (select id from provs where razon_social = 'Proveedor Uno SA'), 'Z-1');
select public.crear_producto('Alfa', null, null, null, 'USD', 10, null, (select id from provs where razon_social = 'Proveedor Uno SA'), null);
select is(
  (select array_agg(nombre order by nombre) from public.productos_de_proveedor((select id from provs where razon_social = 'Proveedor Uno SA'))),
  array['Alfa', 'Zeta'], 'lista los productos del proveedor'
);
select is(
  (select nombre from public.productos_de_proveedor((select id from provs where razon_social = 'Proveedor Uno SA'), 1, 1)),
  'Alfa', 'ordenado por nombre y paginado'
);
select is(
  (select max(total_filas)::int from public.productos_de_proveedor((select id from provs where razon_social = 'Proveedor Uno SA'), 1, 1)),
  2, 'total_filas cuenta todos los productos'
);
select is(
  (select count(*)::int from public.productos_de_proveedor((select id from ajeno))), 0,
  'no devuelve productos de proveedores de otra organización'
);

-- ============================================================================
-- anon
-- ============================================================================

reset role;
select ok(
  not has_function_privilege('anon', 'public.productos_de_proveedor(uuid, integer, integer)', 'execute')
  and not has_function_privilege('anon', 'public.crear_producto(text, text, text, text[], text, numeric, numeric, uuid, text, text)', 'execute')
  and not has_function_privilege('anon', 'public.actualizar_producto(uuid, timestamptz, text, text, text, text[], text, numeric, numeric, uuid, text, boolean, text, boolean)', 'execute'),
  'anon no ejecuta las RPC nuevas'
);
select ok(not has_table_privilege('anon', 'public.proveedores_basico', 'select'), 'anon no lee proveedores_basico');

-- Rol sin productos (edición), stock ni proveedores: la vista no devuelve filas.
reset role;
update permisos_rol set nivel = 'ninguno'
 where organizacion_id = '11111111-1111-1111-1111-111111111111' and rol_id = 'operador'
   and seccion in ('productos', 'stock', 'proveedores');
select pg_temp.como('d1000000-0000-0000-0000-000000000002');
select is((select count(*)::int from public.proveedores_basico), 0, 'rol sin productos, stock ni proveedores: la vista no devuelve filas');

reset role;
select * from finish();
rollback;
