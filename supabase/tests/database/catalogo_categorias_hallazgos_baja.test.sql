-- Seguimiento de la revisión de F-CAT-08 (hallazgos Baja 2, 3 y 5): candado en la baja directa, límite del orden y mensaje de permiso al asignar.
begin;

select plan(11);

insert into organizaciones (id, nombre) values ('11111111-1111-1111-1111-111111111111', 'Organización Uno');
insert into auth.users (id, email) values
  ('c1000000-0000-0000-0000-000000000001', 'administrador@example.com'),
  ('c1000000-0000-0000-0000-000000000002', 'operador@example.com');
insert into usuarios_organizacion (user_id, organizacion_id, rol_id, estado) values
  ('c1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'administrador', 'activo'),
  ('c1000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'operador', 'activo');
insert into dominio.productos (id, organizacion_id, nombre, sku, precio_lista) values
  ('a1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'Joystick', 'JOY-1', 49.90);
-- Sin el candado del insert: así el assert de la baja ve solo el candado que toma el disparador de baja.
alter table dominio.categorias disable trigger categorias_normalizar;
insert into dominio.categorias (id, organizacion_id, nombre, posicion) values
  ('d1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'Consolas', 0),
  ('d1000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'Accesorios', 1);
set constraints all immediate;
alter table dominio.categorias enable trigger categorias_normalizar;

create function pg_temp.como(p_user uuid) returns void language plpgsql as $$
begin
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
  set local role authenticated;
end $$;

-- 2) Baja directa: el disparador existe y no es ejecutable por la API.
select is(
  (select count(*)::int from pg_trigger where tgrelid = 'dominio.categorias'::regclass and tgname = 'categorias_baja_candado' and not tgisinternal),
  1, 'dominio.categorias tiene el disparador de candado en la baja');
select is(
  (select tgtype & 1 = 1 and tgtype & 2 = 2 and tgtype & 8 = 8 from pg_trigger where tgname = 'categorias_baja_candado'),
  true, 'es por fila, before y de delete');
select is(
  (select has_function_privilege('authenticated', 'private.bloquear_categoria_baja()', 'execute')
       or has_function_privilege('anon', 'private.bloquear_categoria_baja()', 'execute')),
  false, 'la función del candado no se ejecuta desde la API');

-- El DELETE directo (RLS de edición) sigue funcionando y toma el candado de la organización.
select pg_temp.como('c1000000-0000-0000-0000-000000000001');
select is(
  (select count(*)::int from pg_locks where locktype = 'advisory' and pid = pg_backend_pid()
      and ((classid::bigint << 32) | objid::bigint) = hashtextextended('categorias:11111111-1111-1111-1111-111111111111', 0)),
  0, 'antes de borrar la transacción no tiene el candado de la organización');
select lives_ok($$delete from dominio.categorias where id = 'd1000000-0000-0000-0000-000000000002'$$, 'el delete directo sigue permitido a quien edita');
select is(
  (select count(*)::int from pg_locks where locktype = 'advisory' and pid = pg_backend_pid()
      and ((classid::bigint << 32) | objid::bigint) = hashtextextended('categorias:11111111-1111-1111-1111-111111111111', 0)),
  1, 'el delete directo tomó el candado asesor de la organización');
select is((select count(*)::int from dominio.categorias), 1, 'y la categoría se borró');
-- eliminar_categoria (misma transacción, candado reentrante) no se bloquea a sí misma.
select lives_ok($$select public.eliminar_categoria('d1000000-0000-0000-0000-000000000001')$$, 'eliminar_categoria sigue funcionando con el candado de la baja');

-- 3) Límite del orden.
select throws_ok(
  $$select public.reordenar_categorias((select jsonb_agg(jsonb_build_object('id', gen_random_uuid(), 'padre_id', null, 'posicion', g)) from generate_series(0, 5000) g))$$,
  '22023', 'El orden admite hasta 5000 categorías por vez', 'reordenar rechaza más de 5000 categorías');

-- 5) Sin lectura en categorías: permiso (42501), no «no existe».
reset role;
insert into public.permisos_rol (organizacion_id, rol_id, seccion, nivel)
values ('11111111-1111-1111-1111-111111111111', 'operador', 'categorias', 'ninguno')
on conflict (organizacion_id, rol_id, seccion) do update set nivel = 'ninguno';
insert into dominio.categorias (id, organizacion_id, nombre, posicion) values
  ('d1000000-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111', 'Nueva', 0);
select pg_temp.como('c1000000-0000-0000-0000-000000000002');
select throws_ok(
  $$select public.asignar_categoria_producto('a1000000-0000-0000-0000-000000000001', 'd1000000-0000-0000-0000-000000000003')$$,
  '42501', 'Tu rol no puede ver categorías, así que no puede asignarlas', 'sin lectura en categorías: error de permiso');
select lives_ok(
  $$select public.asignar_categoria_producto('a1000000-0000-0000-0000-000000000001', null)$$,
  'quitar la categoría no exige leer categorías');

select * from finish();
rollback;
