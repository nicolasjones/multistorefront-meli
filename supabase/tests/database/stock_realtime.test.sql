-- F-STK-01 (MSF-268, épica MSF-231): `dominio.existencias` en la publicación de Realtime
-- y aislamiento por organización de las filas que Realtime entrega (SC-007).
begin;

select plan(5);

insert into organizaciones (id, nombre) values
  ('11111111-1111-1111-1111-111111111111', 'Organización Uno'),
  ('22222222-2222-2222-2222-222222222222', 'Organización Dos');

insert into auth.users (id, email) values
  ('d1000000-0000-0000-0000-000000000003', 'consulta@example.com'),
  ('d2000000-0000-0000-0000-000000000001', 'admin-dos@example.com');

insert into usuarios_organizacion (user_id, organizacion_id, rol_id) values
  ('d1000000-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111', 'consulta'),
  ('d2000000-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', 'administrador');

insert into dominio.productos (id, organizacion_id, nombre, sku, precio_lista) values
  ('a1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'Producto Uno', 'P-UNO', 10),
  ('a2000000-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', 'Producto Dos', 'P-DOS', 10);

create function pg_temp.como(p_user uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
  set local role authenticated;
end $$;

select ok(
  exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'dominio' and tablename = 'existencias'
  ),
  'dominio.existencias está en la publicación supabase_realtime'
);

-- La RLS que Realtime aplica a cada suscriptor es la de la tabla.
select pg_temp.como('d1000000-0000-0000-0000-000000000003');
select is(
  (select count(*)::int from dominio.existencias where producto_id = 'a1000000-0000-0000-0000-000000000001'),
  1, 'la organización dueña ve sus existencias'
);
select is(
  (select count(*)::int from dominio.existencias where producto_id = 'a2000000-0000-0000-0000-000000000001'),
  0, 'una organización no ve las existencias de otra'
);

reset role;
select pg_temp.como('d2000000-0000-0000-0000-000000000001');
select is(
  (select count(*)::int from dominio.existencias where producto_id = 'a1000000-0000-0000-0000-000000000001'),
  0, 'la otra organización tampoco ve las de la primera'
);
select is(
  (select count(*)::int from dominio.existencias where producto_id = 'a2000000-0000-0000-0000-000000000001'),
  1, 'y ve las suyas'
);

select * from finish();
rollback;
