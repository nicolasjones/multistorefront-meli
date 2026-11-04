-- F-CAT-15 (MSF-408, épica MSF-229), bloque A. Cubre FR-001, FR-002, FR-011, SC-002 y SC-004:
-- variante con orden, unicidad cruzada (variante/variante y variante/producto, en ambos sentidos), EAN-13,
-- aislamiento entre organizaciones, anon sin acceso y sin DELETE para nadie.
-- El fixture corre como postgres (RLS no aplica) y las verificaciones como "authenticated".
-- `rls_en_toda_tabla` (archivo aparte) recorre `public` + `dominio` y cubre la tabla nueva; acá se verifica además la propia.
begin;

select * from no_plan();

insert into organizaciones (id, nombre) values
  ('11111111-1111-1111-1111-111111111111', 'Organización Uno'),
  ('22222222-2222-2222-2222-222222222222', 'Organización Dos');

insert into auth.users (id, email) values
  ('d1000000-0000-0000-0000-000000000001', 'administrador@example.com'),
  ('d1000000-0000-0000-0000-000000000003', 'consulta@example.com'),
  ('d2000000-0000-0000-0000-000000000001', 'admin-dos@example.com');

insert into usuarios_organizacion (user_id, organizacion_id, rol_id, estado) values
  ('d1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'administrador', 'activo'),
  ('d1000000-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111', 'consulta', 'activo'),
  ('d2000000-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', 'administrador', 'activo');

insert into dominio.productos (id, organizacion_id, nombre, sku, precio_lista, codigo_barras) values
  ('a1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'Remera', 'REM-1', 20, null),
  ('a1000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'Gorra', 'GOR-1', 10, '7790000000099'),
  ('b2000000-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', 'Producto Dos', 'DOS-1', 5, null);

insert into dominio.producto_variantes (id, organizacion_id, producto_id, nombre, codigo, codigo_barras, orden) values
  ('c1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'a1000000-0000-0000-0000-000000000001',
   'Negro', 'REM-1-N', '7790000000011', 1);

create function pg_temp.como(p_user uuid) returns void language plpgsql as $$
begin
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
  set local role authenticated;
end $$;

-- Estructura y privilegios
select is((select relrowsecurity from pg_class where oid = 'dominio.producto_variantes'::regclass), true,
  'producto_variantes (dominio) tiene RLS');
select is((select n.nspname::text from pg_class c join pg_namespace n on n.oid = c.relnamespace
            where c.oid = 'dominio.producto_variantes'::regclass), 'dominio', 'producto_variantes vive en el esquema dominio');
select is(has_table_privilege('anon', 'dominio.producto_variantes', 'SELECT'), false, 'anon no lee producto_variantes');
select is(has_table_privilege('anon', 'dominio.producto_variantes', 'INSERT'), false, 'anon no inserta variantes');
select is(has_table_privilege('authenticated', 'dominio.producto_variantes', 'DELETE'), false, 'nadie borra variantes (sin DELETE)');
select is((select count(*)::int from pg_policies where schemaname = 'dominio' and tablename = 'producto_variantes' and cmd = 'DELETE'),
  0, 'no hay política DELETE');
select is((select orden from dominio.producto_variantes where codigo = 'REM-1-N'), 1, 'la variante guarda su orden');

-- Unicidad entre variantes (sin distinguir mayúsculas ni espacios extremos)
select throws_ok(
  $$insert into dominio.producto_variantes (organizacion_id, producto_id, nombre, codigo, orden)
    values ('11111111-1111-1111-1111-111111111111', 'a1000000-0000-0000-0000-000000000001', 'Blanco', ' rem-1-n ', 2)$$,
  '23505', null, 'el código de una variante no se repite en la organización (ignora mayúsculas y espacios)');
select throws_ok(
  $$insert into dominio.producto_variantes (organizacion_id, producto_id, nombre, codigo, codigo_barras, orden)
    values ('11111111-1111-1111-1111-111111111111', 'a1000000-0000-0000-0000-000000000001', 'Blanco', 'REM-1-B', '7790000000011', 2)$$,
  '23505', null, 'el código de barras de una variante no se repite entre variantes');

-- Unicidad contra productos (variante → producto)
select throws_ok(
  $$insert into dominio.producto_variantes (organizacion_id, producto_id, nombre, codigo, orden)
    values ('11111111-1111-1111-1111-111111111111', 'a1000000-0000-0000-0000-000000000001', 'Blanco', 'gor-1', 2)$$,
  '23505', 'El código "gor-1" ya lo usa un producto', 'el código de una variante no puede ser el SKU de un producto');
select throws_ok(
  $$insert into dominio.producto_variantes (organizacion_id, producto_id, nombre, codigo, codigo_barras, orden)
    values ('11111111-1111-1111-1111-111111111111', 'a1000000-0000-0000-0000-000000000001', 'Blanco', 'REM-1-B', '7790000000099', 2)$$,
  '23505', 'El código de barras "7790000000099" ya lo usa un producto', 'el código de barras de una variante no puede ser el de un producto');

-- Unicidad contra variantes (producto → variante)
select throws_ok(
  $$update dominio.productos set sku = 'REM-1-N' where id = 'a1000000-0000-0000-0000-000000000002'$$,
  '23505', 'El SKU "REM-1-N" ya lo usa una variante', 'un producto no puede tomar el código de una variante');
select throws_ok(
  $$update dominio.productos set codigo_barras = '7790000000011' where id = 'a1000000-0000-0000-0000-000000000002'$$,
  '23505', 'El código de barras "7790000000011" ya lo usa una variante', 'un producto no puede tomar el código de barras de una variante');

-- EAN-13 y nombre/código vacíos
select throws_ok(
  $$insert into dominio.producto_variantes (organizacion_id, producto_id, nombre, codigo, codigo_barras, orden)
    values ('11111111-1111-1111-1111-111111111111', 'a1000000-0000-0000-0000-000000000001', 'Blanco', 'REM-1-B', '123', 2)$$,
  '23514', null, 'el código de barras debe tener 13 dígitos');
select throws_ok(
  $$insert into dominio.producto_variantes (organizacion_id, producto_id, nombre, codigo, orden)
    values ('11111111-1111-1111-1111-111111111111', 'a1000000-0000-0000-0000-000000000001', '  ', 'REM-1-B', 2)$$,
  '22023', null, 'el nombre de la variante no puede quedar vacío');

-- Una variante no cruza organizaciones (FK compuesta)
select throws_ok(
  $$insert into dominio.producto_variantes (organizacion_id, producto_id, nombre, codigo, orden)
    values ('22222222-2222-2222-2222-222222222222', 'a1000000-0000-0000-0000-000000000001', 'Cruzada', 'X-1', 1)$$,
  '23503', null, 'una variante no puede colgar de un producto de otra organización');

-- El mismo código en otra organización sí se permite
select lives_ok(
  $$insert into dominio.producto_variantes (organizacion_id, producto_id, nombre, codigo, orden)
    values ('22222222-2222-2222-2222-222222222222', 'b2000000-0000-0000-0000-000000000001', 'Negro', 'REM-1-N', 1)$$,
  'otra organización puede usar el mismo código');

-- Aislamiento y permisos por rol
select pg_temp.como('d1000000-0000-0000-0000-000000000001');
select is((select count(*)::int from dominio.producto_variantes), 1, 'el administrador ve solo las variantes de su organización');
select lives_ok(
  $$update dominio.producto_variantes set activa = false where codigo = 'REM-1-N'$$,
  'el administrador desactiva una variante');
select throws_ok($$delete from dominio.producto_variantes where codigo = 'REM-1-N'$$, '42501', null, 'el administrador no puede borrar una variante');
select lives_ok(
  $$insert into dominio.producto_variantes (organizacion_id, producto_id, nombre, codigo, orden)
    values ('11111111-1111-1111-1111-111111111111', 'a1000000-0000-0000-0000-000000000001', 'Blanco', 'REM-1-B', 2)$$,
  'el administrador agrega una variante');

select pg_temp.como('d1000000-0000-0000-0000-000000000003');
select is((select count(*)::int from dominio.producto_variantes), 2, 'consulta ve las variantes (lectura)');
select throws_ok(
  $$insert into dominio.producto_variantes (organizacion_id, producto_id, nombre, codigo, orden)
    values ('11111111-1111-1111-1111-111111111111', 'a1000000-0000-0000-0000-000000000001', 'Rojo', 'REM-1-R', 3)$$,
  '42501', null, 'consulta no agrega variantes');
select lives_ok($$update dominio.producto_variantes set activa = true where codigo = 'REM-1-N'$$, 'consulta: el update no falla pero no alcanza filas');
select is((select activa from dominio.producto_variantes where codigo = 'REM-1-N'), false, 'consulta no modifica variantes');

select pg_temp.como('d2000000-0000-0000-0000-000000000001');
select is((select count(*)::int from dominio.producto_variantes), 1, 'otra organización solo ve las suyas');

reset role;
select * from finish();
rollback;
