-- MSF-620 (lote 32): Depósito (stock en edición, categorías en ninguno) ve las categorías en «Toma de inventario» sin
-- ganar permisos de escritura; otra organización y los roles sin stock siguen sin verlas.
begin;

select no_plan();

insert into organizaciones (id, nombre) values
  ('11111111-1111-1111-1111-111111111111', 'Organización Uno'),
  ('22222222-2222-2222-2222-222222222222', 'Organización Dos');

insert into auth.users (id, email) values
  ('d1000000-0000-0000-0000-000000000001', 'deposito-uno@example.com'),
  ('d1000000-0000-0000-0000-000000000002', 'consulta-uno@example.com'),
  ('d1000000-0000-0000-0000-000000000003', 'tecnico-uno@example.com'),
  ('d2000000-0000-0000-0000-000000000001', 'deposito-dos@example.com');

insert into usuarios_organizacion (user_id, organizacion_id, rol_id, estado) values
  ('d1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'deposito', 'activo'),
  ('d1000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'consulta', 'activo'),
  ('d1000000-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111', 'tecnico', 'activo'),
  ('d2000000-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', 'deposito', 'activo');

insert into dominio.categorias (id, organizacion_id, nombre) values
  ('c1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'Joysticks'),
  ('c2000000-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', 'Ajenas');

create function pg_temp.como(p_user uuid) returns void language plpgsql as $$
begin
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
  set local role authenticated;
end $$;

select pg_temp.como('d1000000-0000-0000-0000-000000000001');
select is((select private.nivel_seccion('categorias')), 'ninguno', 'Depósito tiene categorías en ninguno (matriz inicial)');
select is((select private.nivel_seccion('stock')), 'edicion', 'y stock en edición');
select is((select array_agg(nombre) from dominio.categorias), array['Joysticks']::text[], 'Depósito ve las categorías de su organización (y solo esas)');
select throws_ok($$insert into dominio.categorias (organizacion_id, nombre) values ('11111111-1111-1111-1111-111111111111', 'Nueva')$$,
  '42501', 'new row violates row-level security policy for table "categorias"', 'Depósito no crea categorías');
with u as (update dominio.categorias set nombre = 'Pisada' returning 1) select is((select count(*)::int from u), 0, 'Depósito no modifica categorías');
with d as (delete from dominio.categorias returning 1) select is((select count(*)::int from d), 0, 'Depósito no borra categorías');

-- Quien solo LEE stock (Técnico: stock en lectura, categorías en ninguno) no gana lectura de categorías: la toma de
-- inventario se confirma con stock en edición.
select pg_temp.como('d1000000-0000-0000-0000-000000000003');
select is((select private.nivel_seccion('stock')), 'lectura', 'Técnico lee stock');
select is((select private.nivel_seccion('categorias')), 'ninguno', 'y no tiene categorías');
select is((select count(*)::int from dominio.categorias), 0, 'sin stock en edición ni categorías no ve categorías');

-- Consulta (categorías en lectura) sigue viéndolas por su sección.
select pg_temp.como('d1000000-0000-0000-0000-000000000002');
select is((select count(*)::int from dominio.categorias), 1, 'Consulta las ve (por categorías o por stock)');

-- Otra organización: solo las suyas
select pg_temp.como('d2000000-0000-0000-0000-000000000001');
select is((select array_agg(nombre) from dominio.categorias), array['Ajenas']::text[], 'Depósito de otra organización ve solo las suyas');

-- anon: nada
reset role;
set local role anon;
select throws_ok($$select count(*) from dominio.categorias$$, '42501', 'permission denied for schema dominio', 'anon no lee categorías');

select * from finish();
rollback;
