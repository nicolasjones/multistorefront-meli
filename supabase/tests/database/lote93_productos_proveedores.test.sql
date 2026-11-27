-- MSF-530 (lote 93): varios proveedores por producto, con UNO principal; costo y código por vínculo.
-- Cubre: estructura y RLS, relleno desde productos.proveedor_id, espejo del principal en productos (camino viejo y RPC nuevas),
-- un solo principal, quitar el principal, costo efectivo (principal -> producto y producto -> principal), permisos (42501),
-- PT404/PT409/22023, aislamiento por organización y `anon` sin acceso.
begin;

select plan(104);

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
insert into dominio.proveedores (id, organizacion_id, razon_social, cuit, activo) values
  ('f1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'Proveedor A', '20123456786', true),
  ('f1000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'Proveedor B', '30701234568', true),
  ('f1000000-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111', 'Proveedor C', '33555555550', true),
  ('f1000000-0000-0000-0000-000000000004', '11111111-1111-1111-1111-111111111111', 'Proveedor Inactivo', '30500010912', false),
  ('f2000000-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', 'Proveedor Ajeno', '20123456786', true);
-- Un producto que ya tenía proveedor y costo ANTES de la tabla de vínculos (el relleno lo hizo principal).
insert into dominio.productos (id, organizacion_id, nombre, moneda, precio_lista, proveedor_id, codigo_proveedor) values
  ('e1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'Producto Uno', 'USD', 10,
   'f1000000-0000-0000-0000-000000000001', 'A-1'),
  ('e1000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'Producto Dos', 'USD', 10, null, null),
  ('e2000000-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', 'Producto Ajeno', 'USD', 10, null, null),
  ('e1000000-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111', 'Producto Tres', 'USD', 10, 'f1000000-0000-0000-0000-000000000001', 'T-1'),
  ('e1000000-0000-0000-0000-000000000004', '11111111-1111-1111-1111-111111111111', 'Producto Cuatro', 'USD', 10, null, null),
  ('e1000000-0000-0000-0000-000000000005', '11111111-1111-1111-1111-111111111111', 'Producto Cinco', 'USD', 10, 'f1000000-0000-0000-0000-000000000001', 'Q-1');
insert into dominio.producto_costos (producto_id, organizacion_id, costo) values
  ('e1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 100),
  ('e1000000-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111', 20),
  ('e1000000-0000-0000-0000-000000000004', '11111111-1111-1111-1111-111111111111', 30);

create function pg_temp.como(p_user uuid) returns void language plpgsql as $$
begin
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
  set local role authenticated;
end $$;

create function pg_temp.espejo(p_producto uuid) returns text language sql security definer as $$
  select coalesce(proveedor_id::text, 'sin') || '|' || coalesce(codigo_proveedor, '-') from dominio.productos where id = p_producto
$$;
create function pg_temp.principal(p_producto uuid) returns text language sql security definer as $$
  select coalesce(string_agg(proveedor_id::text, ',' order by proveedor_id), 'ninguno') from dominio.productos_proveedores
   where producto_id = p_producto and principal
$$;
create function pg_temp.costo_producto(p_producto uuid) returns numeric language sql security definer as $$
  select costo from dominio.producto_costos where producto_id = p_producto
$$;
create function pg_temp.costo_vinculo(p_producto uuid, p_proveedor uuid) returns numeric language sql security definer as $$
  select costo from dominio.productos_proveedores where producto_id = p_producto and proveedor_id = p_proveedor
$$;
create function pg_temp.vinculos(p_producto uuid, p_proveedor uuid) returns int language sql security definer as $$
  select count(*)::int from dominio.productos_proveedores where producto_id = p_producto and proveedor_id = p_proveedor
$$;
create function pg_temp.vinculo_alta(p_nombre text) returns text language sql security definer as $$
  select v.principal::text || '|' || coalesce(v.codigo_proveedor, '-') || '|' || coalesce(v.costo::text, '-')
    from dominio.productos_proveedores v join dominio.productos p on p.id = v.producto_id where p.nombre = p_nombre
$$;
create function pg_temp.total_vinculos() returns int language sql security definer as $$
  select count(*)::int from dominio.productos_proveedores
$$;
grant execute on all functions in schema pg_temp to authenticated;

-- Estructura
select has_table('dominio', 'productos_proveedores', 'existe la tabla de vínculos');
select fk_ok('dominio', 'productos_proveedores', array['producto_id', 'organizacion_id'], 'dominio', 'productos', array['id', 'organizacion_id'], 'FK compuesta al producto');
select fk_ok('dominio', 'productos_proveedores', array['proveedor_id', 'organizacion_id'], 'dominio', 'proveedores', array['id', 'organizacion_id'], 'FK compuesta al proveedor');
select is((select relrowsecurity from pg_class where oid = 'dominio.productos_proveedores'::regclass), true, 'RLS activa');
select is(has_column_privilege('authenticated', 'dominio.productos_proveedores', 'costo', 'select'), false, 'authenticated no lee el costo del vínculo directo');
select is(has_table_privilege('authenticated', 'dominio.productos_proveedores', 'insert'), false, 'authenticated no inserta directo');
select is(has_table_privilege('authenticated', 'dominio.productos_proveedores', 'delete'), false, 'authenticated no borra directo');
select is(has_table_privilege('anon', 'dominio.productos_proveedores', 'select'), false, 'anon no lee');

-- Relleno: lo que ya existía queda principal (el relleno corre en la migración; acá se reproduce con el camino viejo del insert).
select is(pg_temp.principal('e1000000-0000-0000-0000-000000000001'), 'f1000000-0000-0000-0000-000000000001', 'el producto con proveedor tiene su vínculo principal');
select is(pg_temp.costo_vinculo('e1000000-0000-0000-0000-000000000001', 'f1000000-0000-0000-0000-000000000001'), 100.00::numeric,
          'el costo del producto llega al vínculo principal (producto -> principal)');
select is(pg_temp.principal('e1000000-0000-0000-0000-000000000002'), 'ninguno', 'sin proveedor, sin principal');

-- Administrador
select pg_temp.como('d1000000-0000-0000-0000-000000000001');

select lives_ok($f$select public.asignar_proveedor_producto('e1000000-0000-0000-0000-000000000001', 'f1000000-0000-0000-0000-000000000002', '  B-7 ', 80)$f$,
  'agrega un segundo proveedor con código y costo');
select is((select count(*)::int from public.listar_proveedores_de_producto('e1000000-0000-0000-0000-000000000001')), 2, 'el producto tiene dos proveedores');
select is(pg_temp.principal('e1000000-0000-0000-0000-000000000001'), 'f1000000-0000-0000-0000-000000000001', 'el principal no cambia al agregar un secundario');
select is(pg_temp.espejo('e1000000-0000-0000-0000-000000000001'), 'f1000000-0000-0000-0000-000000000001|A-1', 'el espejo sigue siendo el principal');
select is(
  (select proveedor_id::text || '|' || codigo_proveedor || '|' || costo || '|' || principal
     from public.listar_proveedores_de_producto('e1000000-0000-0000-0000-000000000001') where razon_social = 'Proveedor B'),
  'f1000000-0000-0000-0000-000000000002|B-7|80.00|false', 'el código se recorta y el costo queda por vínculo');
select is((select razon_social from public.listar_proveedores_de_producto('e1000000-0000-0000-0000-000000000001') limit 1), 'Proveedor A', 'el principal sale primero');
select is(pg_temp.costo_producto('e1000000-0000-0000-0000-000000000001'), 100.00::numeric, 'el costo efectivo sigue siendo el del principal');

-- Marcar otro como principal
select lives_ok($f$select public.marcar_proveedor_principal('e1000000-0000-0000-0000-000000000001', 'f1000000-0000-0000-0000-000000000002')$f$, 'marca a B como principal');
select is(pg_temp.principal('e1000000-0000-0000-0000-000000000001'), 'f1000000-0000-0000-0000-000000000002', 'a lo sumo un principal: ahora B');
select is(pg_temp.espejo('e1000000-0000-0000-0000-000000000001'), 'f1000000-0000-0000-0000-000000000002|B-7', 'el espejo pasa a B con su código');
select is(pg_temp.costo_producto('e1000000-0000-0000-0000-000000000001'), 80.00::numeric, 'el costo efectivo pasa a ser el del nuevo principal (principal -> producto)');
select is((select count(*)::int from public.listar_proveedores_de_producto('e1000000-0000-0000-0000-000000000001')), 2, 'A queda como secundario (no se pierde)');
select lives_ok($f$select public.marcar_proveedor_principal('e1000000-0000-0000-0000-000000000001', 'f1000000-0000-0000-0000-000000000002')$f$, 'marcar el que ya es principal es idempotente');

-- Producto -> principal: cambiar el costo del producto se copia al vínculo principal
update dominio.producto_costos set costo = 90 where producto_id = 'e1000000-0000-0000-0000-000000000001';
select is(pg_temp.costo_vinculo('e1000000-0000-0000-0000-000000000001', 'f1000000-0000-0000-0000-000000000002'), 90.00::numeric, 'un cambio del costo del producto llega al principal');
select is(pg_temp.costo_vinculo('e1000000-0000-0000-0000-000000000001', 'f1000000-0000-0000-0000-000000000001'), 100.00::numeric, 'y no toca al secundario');

-- Camino viejo: elegir otro proveedor reemplaza al principal anterior (semántica de siempre)
update dominio.productos set proveedor_id = 'f1000000-0000-0000-0000-000000000003', codigo_proveedor = 'C-3'
 where id = 'e1000000-0000-0000-0000-000000000001';
select is(pg_temp.principal('e1000000-0000-0000-0000-000000000001'), 'f1000000-0000-0000-0000-000000000003', 'el camino viejo deja a C como único principal');
select is(pg_temp.vinculos('e1000000-0000-0000-0000-000000000001', 'f1000000-0000-0000-0000-000000000002'),
          0, 'y reemplaza al principal anterior (B se quita)');
select is(pg_temp.vinculos('e1000000-0000-0000-0000-000000000001', 'f1000000-0000-0000-0000-000000000001'),
          1, 'pero el secundario A se conserva');
update dominio.productos set proveedor_id = null where id = 'e1000000-0000-0000-0000-000000000001';
select is(pg_temp.principal('e1000000-0000-0000-0000-000000000001'), 'ninguno', 'el camino viejo con proveedor vacío quita el principal');
select is(pg_temp.espejo('e1000000-0000-0000-0000-000000000001'), 'sin|-', 'y el espejo queda vacío');
select is((select count(*)::int from public.listar_proveedores_de_producto('e1000000-0000-0000-0000-000000000001')), 1, 'el secundario A sigue ahí');

-- crear_producto con proveedor (camino viejo de alta)
select lives_ok($f$select public.crear_producto('Alta con proveedor', null, null, null, 'USD', 10, 55, 'f1000000-0000-0000-0000-000000000001', 'ALTA-1')$f$, 'crear_producto con proveedor, código y costo');
select is(pg_temp.vinculo_alta('Alta con proveedor'), 'true|ALTA-1|55.00', 'crear_producto crea el vínculo principal y el costo del alta llega al vínculo');

-- La ficha del proveedor lista los productos donde figura, principal o no, con el costo del vínculo
select is((select string_agg(nombre, ',' order by nombre) from public.productos_de_proveedor('f1000000-0000-0000-0000-000000000001')),
          'Alta con proveedor,Producto Cinco,Producto Tres,Producto Uno', 'productos_de_proveedor incluye los productos donde el proveedor es secundario');
select is((select costo from public.productos_de_proveedor('f1000000-0000-0000-0000-000000000001') where nombre = 'Producto Uno'), 100.00::numeric,
          'y trae el costo del vínculo');

-- Quitar
select lives_ok($f$select public.asignar_proveedor_producto('e1000000-0000-0000-0000-000000000002', 'f1000000-0000-0000-0000-000000000001', 'X', null, true)$f$, 'asigna y marca principal a la vez');
select is(pg_temp.espejo('e1000000-0000-0000-0000-000000000002'), 'f1000000-0000-0000-0000-000000000001|X', 'el espejo se completa');
select lives_ok($f$select public.quitar_proveedor_producto('e1000000-0000-0000-0000-000000000002', 'f1000000-0000-0000-0000-000000000001')$f$, 'quita el principal');
select is(pg_temp.espejo('e1000000-0000-0000-0000-000000000002'), 'sin|-', 'quitar el principal vacía el espejo');

-- Errores de negocio
select throws_ok($f$select public.asignar_proveedor_producto('e1000000-0000-0000-0000-000000000002', 'f1000000-0000-0000-0000-000000000004')$f$,
  'PT409', 'El proveedor está desactivado: reactivalo antes de asignarlo', 'un proveedor desactivado no se asigna nuevo');
select throws_ok($f$select public.asignar_proveedor_producto('e1000000-0000-0000-0000-000000000002', 'f2000000-0000-0000-0000-000000000001')$f$,
  'PT404', 'El proveedor no existe', 'proveedor de otra organización');
select throws_ok($f$select public.asignar_proveedor_producto('e2000000-0000-0000-0000-000000000001', 'f1000000-0000-0000-0000-000000000001')$f$,
  'PT404', 'El producto no existe', 'producto de otra organización');
select throws_ok($f$select public.marcar_proveedor_principal('e1000000-0000-0000-0000-000000000002', 'f1000000-0000-0000-0000-000000000003')$f$,
  'PT404', 'El producto no tiene ese proveedor', 'marcar un proveedor que no es del producto');
select throws_ok($f$select public.quitar_proveedor_producto('e1000000-0000-0000-0000-000000000002', 'f1000000-0000-0000-0000-000000000003')$f$,
  'PT404', 'El producto no tiene ese proveedor', 'quitar un proveedor que no es del producto');
select throws_ok(format($f$select public.asignar_proveedor_producto('e1000000-0000-0000-0000-000000000002', 'f1000000-0000-0000-0000-000000000003', %L)$f$, repeat('x', 81)),
  '22023', 'El código del proveedor admite hasta 80 caracteres', 'código de 81 caracteres');
select throws_ok($f$select public.asignar_proveedor_producto('e1000000-0000-0000-0000-000000000002', 'f1000000-0000-0000-0000-000000000003', null, -1)$f$,
  '22023', 'El costo no puede ser negativo y admite hasta 2 decimales', 'costo negativo');

-- Operador: edita proveedores del producto pero sin Rentabilidad no ve ni carga costos
select pg_temp.como('d1000000-0000-0000-0000-000000000002');
select lives_ok($f$select public.asignar_proveedor_producto('e1000000-0000-0000-0000-000000000002', 'f1000000-0000-0000-0000-000000000003', 'C-9')$f$, 'un Operador asigna proveedores sin costo');
select throws_ok($f$select public.asignar_proveedor_producto('e1000000-0000-0000-0000-000000000002', 'f1000000-0000-0000-0000-000000000003', 'C-9', 5)$f$,
  '42501', 'Tu rol no puede cargar el costo', 'un Operador no carga costo');
select is((select costo from public.listar_proveedores_de_producto('e1000000-0000-0000-0000-000000000001') where razon_social = 'Proveedor A'), null,
  'sin Rentabilidad el costo del vínculo llega nulo');

-- Consulta: lee, no escribe
select pg_temp.como('d1000000-0000-0000-0000-000000000003');
select is((select count(*)::int from public.listar_proveedores_de_producto('e1000000-0000-0000-0000-000000000001')), 1, 'Consulta lee los proveedores del producto');
select throws_ok($f$select public.quitar_proveedor_producto('e1000000-0000-0000-0000-000000000001', 'f1000000-0000-0000-0000-000000000001')$f$,
  '42501', 'Tu rol no puede cambiar los proveedores del producto', 'Consulta no escribe');

-- ============================================================================
-- Costo efectivo: permiso de Rentabilidad, herencia y sincronía simétrica
-- ============================================================================
-- Producto Tres: principal A, costo 20. B secundario con costo 500 (lo carga la administración).
select pg_temp.como('d1000000-0000-0000-0000-000000000001');
select lives_ok($f$select public.asignar_proveedor_producto('e1000000-0000-0000-0000-000000000003', 'f1000000-0000-0000-0000-000000000002', 'B-3', 500)$f$, 'la administración agrega B con costo 500');
select is(pg_temp.costo_producto('e1000000-0000-0000-0000-000000000003'), 20.00::numeric, 'agregar un secundario no toca el costo efectivo');

-- Un Operador (edita Productos, sin Rentabilidad) no puede cambiar el costo efectivo promoviendo un proveedor con otro costo.
select pg_temp.como('d1000000-0000-0000-0000-000000000002');
select throws_ok($f$select public.marcar_proveedor_principal('e1000000-0000-0000-0000-000000000003', 'f1000000-0000-0000-0000-000000000002')$f$,
  'PT409', 'Este proveedor tiene otro costo: cambiar el principal modifica el costo del producto y necesitás edición en Rentabilidad',
  'sin Rentabilidad, marcar principal a un proveedor con otro costo se rechaza');
select is(pg_temp.costo_producto('e1000000-0000-0000-0000-000000000003'), 20.00::numeric, 'y el costo del producto queda en 20 (antes 20, después 20)');
select is(pg_temp.principal('e1000000-0000-0000-0000-000000000003'), 'f1000000-0000-0000-0000-000000000001', 'ni cambia el principal');
select throws_ok($f$select public.asignar_proveedor_producto('e1000000-0000-0000-0000-000000000003', 'f1000000-0000-0000-0000-000000000002', 'B-3', null, true)$f$,
  'PT409', 'Este proveedor tiene otro costo: cambiar el principal modifica el costo del producto y necesitás edición en Rentabilidad',
  'asignar con p_principal tampoco evade el permiso');
select is(pg_temp.costo_producto('e1000000-0000-0000-0000-000000000003'), 20.00::numeric, 'el costo sigue en 20');

-- Con permiso (administración), marcar principal a B cambia el costo efectivo a 500.
select pg_temp.como('d1000000-0000-0000-0000-000000000001');
select lives_ok($f$select public.marcar_proveedor_principal('e1000000-0000-0000-0000-000000000003', 'f1000000-0000-0000-0000-000000000002')$f$, 'la administración marca principal a B');
select is(pg_temp.costo_producto('e1000000-0000-0000-0000-000000000003'), 500.00::numeric, 'el costo efectivo pasa de 20 a 500');

-- Un Operador no promueve a A (costo 20 ≠ 500) pero sí cuando el costo del vínculo coincide con el del producto.
select pg_temp.como('d1000000-0000-0000-0000-000000000002');
select throws_ok($f$select public.marcar_proveedor_principal('e1000000-0000-0000-0000-000000000003', 'f1000000-0000-0000-0000-000000000001')$f$,
  'PT409', 'Este proveedor tiene otro costo: cambiar el principal modifica el costo del producto y necesitás edición en Rentabilidad',
  'sin Rentabilidad, volver a A (costo 20 contra 500) se rechaza');
select pg_temp.como('d1000000-0000-0000-0000-000000000001');
select lives_ok($f$select public.asignar_proveedor_producto('e1000000-0000-0000-0000-000000000003', 'f1000000-0000-0000-0000-000000000001', 'T-1', 500)$f$, 'la administración iguala el costo de A a 500');
select pg_temp.como('d1000000-0000-0000-0000-000000000002');
select lives_ok($f$select public.marcar_proveedor_principal('e1000000-0000-0000-0000-000000000003', 'f1000000-0000-0000-0000-000000000001')$f$, 'sin Rentabilidad se puede cuando el costo coincide');
select is(pg_temp.costo_producto('e1000000-0000-0000-0000-000000000003'), 500.00::numeric, 'y el costo del producto no cambia');

-- Camino viejo (cambiar el proveedor del producto): el vínculo nuevo hereda el costo vigente; el permiso se respeta.
update dominio.productos set proveedor_id = 'f1000000-0000-0000-0000-000000000002' where id = 'e1000000-0000-0000-0000-000000000004';
select is(pg_temp.costo_vinculo('e1000000-0000-0000-0000-000000000004', 'f1000000-0000-0000-0000-000000000002'), 30.00::numeric,
  'camino viejo: el vínculo principal nuevo hereda el costo 30 del producto (no queda nulo)');
select is(pg_temp.costo_producto('e1000000-0000-0000-0000-000000000004'), 30.00::numeric, 'y el costo del producto no cambia');
select pg_temp.como('d1000000-0000-0000-0000-000000000001');
select lives_ok($f$select public.asignar_proveedor_producto('e1000000-0000-0000-0000-000000000004', 'f1000000-0000-0000-0000-000000000003', 'C-4', 99)$f$, 'la administración agrega C con costo 99');
select pg_temp.como('d1000000-0000-0000-0000-000000000002');
select throws_ok($f$update dominio.productos set proveedor_id = 'f1000000-0000-0000-0000-000000000003', codigo_proveedor = 'C-4' where id = 'e1000000-0000-0000-0000-000000000004'$f$,
  'PT409', 'Este proveedor tiene otro costo: cambiar el principal modifica el costo del producto y necesitás edición en Rentabilidad',
  'camino viejo sin Rentabilidad: elegir un proveedor con otro costo se rechaza');
select is(pg_temp.costo_producto('e1000000-0000-0000-0000-000000000004'), 30.00::numeric, 'y el costo sigue en 30');
select is(pg_temp.principal('e1000000-0000-0000-0000-000000000004'), 'f1000000-0000-0000-0000-000000000002', 'y el principal sigue siendo B');
select pg_temp.como('d1000000-0000-0000-0000-000000000001');
update dominio.productos set proveedor_id = 'f1000000-0000-0000-0000-000000000003', codigo_proveedor = 'C-4' where id = 'e1000000-0000-0000-0000-000000000004';
select is(pg_temp.costo_producto('e1000000-0000-0000-0000-000000000004'), 99.00::numeric, 'camino viejo con Rentabilidad: el costo efectivo pasa a 99');

-- Sincronía simétrica del costo en Producto Cinco (principal A, sin costo): alta, cambio y borrado, en los dos sentidos.
reset role;
insert into dominio.producto_costos (producto_id, organizacion_id, costo) values ('e1000000-0000-0000-0000-000000000005', '11111111-1111-1111-1111-111111111111', 10);
select is(pg_temp.costo_vinculo('e1000000-0000-0000-0000-000000000005', 'f1000000-0000-0000-0000-000000000001'), 10.00::numeric, 'producto -> principal: ALTA del costo');
update dominio.producto_costos set costo = 12 where producto_id = 'e1000000-0000-0000-0000-000000000005';
select is(pg_temp.costo_vinculo('e1000000-0000-0000-0000-000000000005', 'f1000000-0000-0000-0000-000000000001'), 12.00::numeric, 'producto -> principal: CAMBIO del costo');
delete from dominio.producto_costos where producto_id = 'e1000000-0000-0000-0000-000000000005';
select is(pg_temp.costo_vinculo('e1000000-0000-0000-0000-000000000005', 'f1000000-0000-0000-0000-000000000001'), null::numeric, 'producto -> principal: BORRADO del costo');
select pg_temp.como('d1000000-0000-0000-0000-000000000001');
select lives_ok($f$select public.asignar_proveedor_producto('e1000000-0000-0000-0000-000000000005', 'f1000000-0000-0000-0000-000000000001', 'Q-1', 7)$f$, 'principal -> producto: ALTA (el producto no tenía costo)');
select is(pg_temp.costo_producto('e1000000-0000-0000-0000-000000000005'), 7.00::numeric, 'el costo del producto pasa a 7');
select lives_ok($f$select public.asignar_proveedor_producto('e1000000-0000-0000-0000-000000000005', 'f1000000-0000-0000-0000-000000000001', 'Q-1', 8)$f$, 'principal -> producto: CAMBIO');
select is(pg_temp.costo_producto('e1000000-0000-0000-0000-000000000005'), 8.00::numeric, 'el costo del producto pasa a 8');
select lives_ok($f$select public.asignar_proveedor_producto('e1000000-0000-0000-0000-000000000005', 'f1000000-0000-0000-0000-000000000001', 'Q-1', null)$f$, 'principal -> producto: BORRADO (costo vacío en el principal)');
select is(pg_temp.costo_producto('e1000000-0000-0000-0000-000000000005'), null::numeric, 'el producto queda sin costo (el espejo no diverge)');
select is(pg_temp.costo_vinculo('e1000000-0000-0000-0000-000000000005', 'f1000000-0000-0000-0000-000000000001'), null::numeric, 'y el vínculo principal también');

-- Costo y proveedor en la misma llamada de actualizar_producto: si el proveedor ya tiene otro costo no se elige uno en silencio.
select lives_ok($f$select public.asignar_proveedor_producto('e1000000-0000-0000-0000-000000000005', 'f1000000-0000-0000-0000-000000000002', 'B-5', 40)$f$, 'la administración agrega B con costo 40 a Producto Cinco');
create function pg_temp.actualizar_cinco(p_costo numeric, p_proveedor uuid, p_codigo text) returns void language sql as $$
  select public.actualizar_producto(p.id, p.updated_at, p.nombre, p.descripcion, p.sku, p.compatible_con, p.moneda, p.precio_lista, p_costo, p_proveedor, p_codigo, true)
    from dominio.productos p where p.id = 'e1000000-0000-0000-0000-000000000005'
$$;
grant execute on function pg_temp.actualizar_cinco(numeric, uuid, text) to authenticated;
select throws_ok($f$select pg_temp.actualizar_cinco(55, 'f1000000-0000-0000-0000-000000000002', 'B-5')$f$,
  '22023', 'No se puede cambiar el proveedor principal y el costo a la vez si el proveedor ya tiene otro costo: guardá primero el proveedor y después el costo',
  'costo nuevo (55) y proveedor con otro costo (40) en la misma llamada: se rechaza');
select is(pg_temp.principal('e1000000-0000-0000-0000-000000000005'), 'f1000000-0000-0000-0000-000000000001', 'y no cambia el principal');
select is(pg_temp.costo_producto('e1000000-0000-0000-0000-000000000005'), null::numeric, 'ni deja el costo 55 guardado');
select lives_ok($f$select pg_temp.actualizar_cinco(40, 'f1000000-0000-0000-0000-000000000002', 'B-5')$f$, 'si el costo enviado coincide con el del proveedor (40), se guarda');
select is(pg_temp.principal('e1000000-0000-0000-0000-000000000005') || '|' || pg_temp.costo_producto('e1000000-0000-0000-0000-000000000005')::text,
  'f1000000-0000-0000-0000-000000000002|40.00', 'B es el principal y el costo es 40');

-- Camino viejo sin Rentabilidad: el principal anterior no se borra, queda como secundario (con permiso se borra, ver arriba).
select pg_temp.como('d1000000-0000-0000-0000-000000000002');
update dominio.productos set proveedor_id = 'f1000000-0000-0000-0000-000000000001', codigo_proveedor = 'Q-1' where id = 'e1000000-0000-0000-0000-000000000005';
select is(pg_temp.principal('e1000000-0000-0000-0000-000000000005'), 'f1000000-0000-0000-0000-000000000001', 'el Operador cambia el principal a A');
select is(pg_temp.vinculos('e1000000-0000-0000-0000-000000000005', 'f1000000-0000-0000-0000-000000000002'), 1, 'y B (con su costo) se conserva como secundario');
select is(pg_temp.costo_vinculo('e1000000-0000-0000-0000-000000000005', 'f1000000-0000-0000-0000-000000000002'), 40.00::numeric, 'con su costo intacto');
update dominio.productos set proveedor_id = null where id = 'e1000000-0000-0000-0000-000000000005';
select is(pg_temp.vinculos('e1000000-0000-0000-0000-000000000005', 'f1000000-0000-0000-0000-000000000001'), 1, 'quitar el proveedor sin Rentabilidad deja el vínculo como secundario');
update dominio.productos set proveedor_id = 'f1000000-0000-0000-0000-000000000001', codigo_proveedor = 'Q-1' where id = 'e1000000-0000-0000-0000-000000000005';

-- El DETAIL de los tres rechazos es el contrato con la pantalla (distingue «desactivado» de «falta Rentabilidad»): se afirma explícito.
-- `pg_exception_detail` devuelve '' (no NULL) si no hay detail.
create function pg_temp.detalle(p_sql text) returns text language plpgsql as $$
declare v_detalle text;
begin
  execute p_sql;
  return 'sin error';
exception when others then
  get stacked diagnostics v_detalle = pg_exception_detail;
  return sqlstate || '|' || v_detalle;
end $$;
grant execute on function pg_temp.detalle(text) to authenticated;
select pg_temp.como('d1000000-0000-0000-0000-000000000001');
select lives_ok($f$select public.asignar_proveedor_producto('e1000000-0000-0000-0000-000000000005', 'f1000000-0000-0000-0000-000000000002', 'B-5', 41)$f$, 'la administración deja a B con costo 41 (distinto del 40 del producto)');
select pg_temp.como('d1000000-0000-0000-0000-000000000002');
select is(pg_temp.detalle($f$select public.marcar_proveedor_principal('e1000000-0000-0000-0000-000000000005', 'f1000000-0000-0000-0000-000000000002')$f$),
  'PT409|rentabilidad', 'detail del PT409 por Rentabilidad');
select pg_temp.como('d1000000-0000-0000-0000-000000000001');
select lives_ok($f$select public.asignar_proveedor_producto('e1000000-0000-0000-0000-000000000005', 'f1000000-0000-0000-0000-000000000002', 'B-5', 40)$f$, 'la administración vuelve a dejar a B con costo 40');
select is(pg_temp.detalle($f$select pg_temp.actualizar_cinco(55, 'f1000000-0000-0000-0000-000000000002', 'B-5')$f$),
  '22023|costo_y_proveedor', 'detail del 22023 por costo y proveedor a la vez');
select is(pg_temp.detalle($f$select public.asignar_proveedor_producto('e1000000-0000-0000-0000-000000000002', 'f1000000-0000-0000-0000-000000000004')$f$),
  'PT409|proveedor_inactivo', 'detail del PT409 al asignar un proveedor desactivado');
reset role;
update dominio.proveedores set activo = false where id = 'f1000000-0000-0000-0000-000000000003';
select pg_temp.como('d1000000-0000-0000-0000-000000000001');
select is(pg_temp.detalle($f$select public.marcar_proveedor_principal('e1000000-0000-0000-0000-000000000002', 'f1000000-0000-0000-0000-000000000003')$f$),
  'PT409|proveedor_inactivo', 'detail del PT409 al marcar principal un proveedor desactivado');
select is(pg_temp.detalle($f$select public.asignar_proveedor_producto('e1000000-0000-0000-0000-000000000002', 'f1000000-0000-0000-0000-000000000003', 'C-9', null, true)$f$),
  'PT409|proveedor_inactivo', 'detail del PT409 al asignar como principal un proveedor desactivado');
reset role;
update dominio.proveedores set activo = true where id = 'f1000000-0000-0000-0000-000000000003';

-- Un solo principal por producto: el índice único parcial lo garantiza aunque se escriba la tabla directo.
reset role;
select throws_ok(
  $f$update dominio.productos_proveedores set principal = true
      where producto_id = 'e1000000-0000-0000-0000-000000000005' and proveedor_id = 'f1000000-0000-0000-0000-000000000002'$f$,
  '23505', 'duplicate key value violates unique constraint "productos_proveedores_un_principal_idx"', 'un segundo principal choca con el índice único parcial');

-- Un proveedor usado por un producto no se borra: la clave diferida se traduce a un error de negocio (como productos.proveedor_id)
reset role;
select throws_ok(
  $t$do $b$ begin
      delete from dominio.proveedores where id = 'f1000000-0000-0000-0000-000000000003';
      perform private.confirmar_claves_diferidas();
    end $b$$t$,
  'P0001', 'No se puede borrar: el registro está en uso por otros datos.',
  'un proveedor con productos no se borra: el 23503 diferido es un error de negocio');

-- Aislamiento y anon
select pg_temp.como('d2000000-0000-0000-0000-000000000001');
select throws_ok($f$select * from public.listar_proveedores_de_producto('e1000000-0000-0000-0000-000000000001')$f$,
  'PT404', 'El producto no existe', 'otra organización no ve los proveedores de un producto ajeno');
select is((select count(*)::int from dominio.productos_proveedores where producto_id is not null), 0, 'ni lee filas ajenas por RLS');

reset role;
select set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);
set local role anon;
select throws_ok($f$select * from public.listar_proveedores_de_producto('e1000000-0000-0000-0000-000000000001')$f$, '42501', null, 'anon no ejecuta las RPC');

select * from finish();
rollback;
