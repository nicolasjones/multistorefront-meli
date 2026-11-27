-- MSF-523 (lote 93): condiciones de compra por proveedor (plazo de pago, mínimo de compra, moneda y notas).
-- Cubre: estructura y RLS, guardar y leer, validaciones (22023), concurrencia (PT412), proveedor inexistente o de otra
-- organización (PT404), permisos por rol (42501), aislamiento por organización, sin DELETE directo y `anon` sin acceso.
begin;

select plan(32);

insert into organizaciones (id, nombre) values
  ('11111111-1111-1111-1111-111111111111', 'Organización Uno'),
  ('22222222-2222-2222-2222-222222222222', 'Organización Dos');
insert into auth.users (id, email) values
  ('d1000000-0000-0000-0000-000000000001', 'administrador@example.com'),
  ('d1000000-0000-0000-0000-000000000002', 'operador@example.com'),
  ('d1000000-0000-0000-0000-000000000003', 'administracion@example.com'),
  ('d2000000-0000-0000-0000-000000000001', 'admin-dos@example.com');
insert into usuarios_organizacion (user_id, organizacion_id, rol_id) values
  ('d1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'administrador'),
  ('d1000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'operador'),
  ('d1000000-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111', 'administracion'),
  ('d2000000-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', 'administrador');
insert into dominio.proveedores (id, organizacion_id, razon_social, cuit) values
  ('f1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'Proveedor Uno', '20123456786'),
  ('f1000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'Proveedor Dos', '30701234568'),
  ('f2000000-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', 'Proveedor Ajeno', '20123456786');

create function pg_temp.como(p_user uuid) returns void language plpgsql as $$
begin
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
  set local role authenticated;
end $$;

-- Estructura
select has_table('dominio', 'proveedores_condiciones_compra', 'existe la tabla de condiciones');
select fk_ok('dominio', 'proveedores_condiciones_compra', array['proveedor_id', 'organizacion_id'],
             'dominio', 'proveedores', array['id', 'organizacion_id'], 'FK compuesta por organización');
select is((select relrowsecurity from pg_class where oid = 'dominio.proveedores_condiciones_compra'::regclass), true, 'RLS activa');
select is(has_table_privilege('authenticated', 'dominio.proveedores_condiciones_compra', 'insert'), false, 'authenticated no inserta directo');
select is(has_table_privilege('authenticated', 'dominio.proveedores_condiciones_compra', 'delete'), false, 'authenticated no borra directo');
select is(has_table_privilege('anon', 'dominio.proveedores_condiciones_compra', 'select'), false, 'anon no lee');

-- Administrador: guardar y leer
select pg_temp.como('d1000000-0000-0000-0000-000000000001');

select is(
  (select count(*)::int from public.obtener_condiciones_compra_proveedor('f1000000-0000-0000-0000-000000000001')),
  0, 'sin condiciones cargadas, cero filas');
select is(
  public.guardar_condiciones_compra_proveedor('f1000000-0000-0000-0000-000000000002'), null,
  'guardar todo vacío sin fila previa no crea nada');
select is((select count(*)::int from dominio.proveedores_condiciones_compra), 0, 'y no deja una fila vacía');

create temp table marca (clave text primary key, valor timestamptz);
grant all on marca to authenticated;
insert into marca values ('uno', public.guardar_condiciones_compra_proveedor(
  'f1000000-0000-0000-0000-000000000001', 30, 150000.50, 'ars', '  Pago a 30 días  '));

select is(
  (select plazo_pago_dias || '|' || minimo_compra || '|' || moneda || '|' || notas
     from public.obtener_condiciones_compra_proveedor('f1000000-0000-0000-0000-000000000001')),
  '30|150000.50|ARS|Pago a 30 días'::text, 'guarda y lee: moneda en mayúsculas y notas recortadas');
select is(
  (select updated_at from public.obtener_condiciones_compra_proveedor('f1000000-0000-0000-0000-000000000001')),
  (select valor from marca where clave = 'uno'), 'devuelve el updated_at vigente');

-- Repetir lo mismo no avanza updated_at
select is(
  public.guardar_condiciones_compra_proveedor('f1000000-0000-0000-0000-000000000001', 30, 150000.50, 'ARS', 'Pago a 30 días',
    (select valor from marca where clave = 'uno')),
  (select valor from marca where clave = 'uno'), 'repetir lo mismo es idempotente');

-- Cambiar con la marca vigente avanza
insert into marca values ('dos', public.guardar_condiciones_compra_proveedor(
  'f1000000-0000-0000-0000-000000000001', 0, null, null, null, (select valor from marca where clave = 'uno')));
select ok((select valor from marca where clave = 'dos') > (select valor from marca where clave = 'uno'), 'un cambio real avanza updated_at');
select is(
  (select plazo_pago_dias::text || '|' || coalesce(minimo_compra::text, 'n') || '|' || coalesce(notas, 'n')
     from public.obtener_condiciones_compra_proveedor('f1000000-0000-0000-0000-000000000001')),
  '0|n|n'::text, 'el plazo 0 (contado) se guarda y lo demás se puede vaciar');

-- Concurrencia
select throws_ok(
  $$select public.guardar_condiciones_compra_proveedor('f1000000-0000-0000-0000-000000000001', 10, null, null, null, null)$$,
  'PT412', 'Las condiciones fueron modificadas por otra persona', 'sin la marca vigente, PT412');
select throws_ok(
  format($f$select public.guardar_condiciones_compra_proveedor('f1000000-0000-0000-0000-000000000001', 10, null, null, null, %L)$f$,
         (select valor from marca where clave = 'uno')),
  'PT412', 'Las condiciones fueron modificadas por otra persona', 'con una marca vieja, PT412');
select throws_ok(
  $$select public.guardar_condiciones_compra_proveedor('f1000000-0000-0000-0000-000000000002', 10, null, null, null, now())$$,
  'PT412', 'Las condiciones fueron modificadas por otra persona', 'una marca sobre un proveedor sin condiciones, PT412');

-- Validaciones (cada frontera en una tabla)
select throws_ok(format($f$select public.guardar_condiciones_compra_proveedor('f1000000-0000-0000-0000-000000000002', %s)$f$, v.dias),
  '22023', 'El plazo de pago va de 0 a 365 días', 'plazo fuera de rango: ' || v.dias)
from (values (-1), (366)) as v(dias);
select lives_ok($f$select public.guardar_condiciones_compra_proveedor('f1000000-0000-0000-0000-000000000002', 365)$f$, 'plazo 365 es válido');
select throws_ok(
  $$select public.guardar_condiciones_compra_proveedor('f1000000-0000-0000-0000-000000000001', null, -1, 'ARS', null, (select valor from marca where clave = 'dos'))$$,
  '22023', 'El mínimo de compra no puede ser negativo y admite hasta 2 decimales', 'mínimo negativo');
select throws_ok(
  $$select public.guardar_condiciones_compra_proveedor('f1000000-0000-0000-0000-000000000001', null, 10.005, 'ARS')$$,
  '22023', 'El mínimo de compra no puede ser negativo y admite hasta 2 decimales', 'mínimo con 3 decimales');
select throws_ok(
  $$select public.guardar_condiciones_compra_proveedor('f1000000-0000-0000-0000-000000000001', null, 10, null)$$,
  '22023', 'Elegí la moneda del mínimo de compra', 'mínimo sin moneda');
select throws_ok(
  $$select public.guardar_condiciones_compra_proveedor('f1000000-0000-0000-0000-000000000001', null, null, 'EUR')$$,
  '22023', 'La moneda tiene que ser ARS o USD', 'moneda inválida');
select throws_ok(
  format($f$select public.guardar_condiciones_compra_proveedor('f1000000-0000-0000-0000-000000000001', null, null, null, %L)$f$, repeat('x', 1001)),
  '22023', 'Las notas admiten hasta 1000 caracteres', 'notas de 1001 caracteres');

-- Proveedor inexistente o ajeno
select throws_ok(
  $$select public.guardar_condiciones_compra_proveedor('f2000000-0000-0000-0000-000000000001', 5)$$,
  'PT404', 'El proveedor no existe', 'proveedor de otra organización: PT404 al guardar');
select throws_ok(
  $$select * from public.obtener_condiciones_compra_proveedor('f2000000-0000-0000-0000-000000000001')$$,
  'PT404', 'El proveedor no existe', 'proveedor de otra organización: PT404 al leer');

-- Permisos
select pg_temp.como('d1000000-0000-0000-0000-000000000002');
select throws_ok(
  $$select public.guardar_condiciones_compra_proveedor('f1000000-0000-0000-0000-000000000001', 5)$$,
  '42501', 'Tu rol no puede cambiar las condiciones de compra del proveedor', 'un Operador (sin proveedores) no escribe');
select throws_ok(
  $$select * from public.obtener_condiciones_compra_proveedor('f1000000-0000-0000-0000-000000000001')$$,
  '42501', 'Tu rol no puede ver las condiciones de compra del proveedor', 'un Operador (sin proveedores) no lee');

-- Aislamiento por organización (RLS directa)
select pg_temp.como('d2000000-0000-0000-0000-000000000001');
select is((select count(*)::int from dominio.proveedores_condiciones_compra), 0, 'otra organización no ve las filas de la primera');
select pg_temp.como('d1000000-0000-0000-0000-000000000001');
select is((select count(*)::int from dominio.proveedores_condiciones_compra), 2, 'la organización dueña ve sus dos filas');

-- anon
reset role;
select set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);
set local role anon;
select throws_ok(
  $$select * from public.obtener_condiciones_compra_proveedor('f1000000-0000-0000-0000-000000000001')$$,
  '42501', null, 'anon no ejecuta la lectura');

select * from finish();
rollback;
