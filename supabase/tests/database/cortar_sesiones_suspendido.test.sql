-- F-ACC-03 (FR-010): pasar a `suspendido` invalida las sesiones del usuario.
begin;

select plan(4);

-- La columna la crea F-ACC-01 (T001); aquí se asegura dentro de la transacción.
alter table public.usuarios_organizacion
  add column if not exists estado text not null default 'activo';

insert into public.organizaciones (id, nombre) values
  ('91111111-1111-1111-1111-111111111111', 'Organizacion A');

insert into auth.users (id, email) values
  ('91000000-0000-0000-0000-000000000001', 'suspendido@example.com'),
  ('91000000-0000-0000-0000-000000000002', 'activo@example.com');

insert into public.usuarios_organizacion (user_id, organizacion_id, rol_id) values
  ('91000000-0000-0000-0000-000000000001', '91111111-1111-1111-1111-111111111111', 'miembro'),
  ('91000000-0000-0000-0000-000000000002', '91111111-1111-1111-1111-111111111111', 'miembro');

insert into auth.sessions (id, user_id) values
  ('92000000-0000-0000-0000-000000000001', '91000000-0000-0000-0000-000000000001'),
  ('92000000-0000-0000-0000-000000000002', '91000000-0000-0000-0000-000000000002');

update public.usuarios_organizacion
set estado = 'suspendido'
where user_id = '91000000-0000-0000-0000-000000000001';

select is(
  (select count(*) from auth.sessions where user_id = '91000000-0000-0000-0000-000000000001')::int,
  0,
  'suspender a un usuario corta sus sesiones abiertas'
);

select is(
  (select count(*) from auth.sessions where user_id = '91000000-0000-0000-0000-000000000002')::int,
  1,
  'las sesiones de otros usuarios no se tocan'
);

-- Otra actualización sobre un usuario ya suspendido no debe fallar ni tocar sesiones nuevas.
insert into auth.sessions (id, user_id) values
  ('92000000-0000-0000-0000-000000000003', '91000000-0000-0000-0000-000000000001');

update public.usuarios_organizacion
set rol_id = 'miembro'
where user_id = '91000000-0000-0000-0000-000000000001';

select is(
  (select count(*) from auth.sessions where user_id = '91000000-0000-0000-0000-000000000001')::int,
  1,
  'actualizar otra columna de un usuario ya suspendido no vuelve a cortar sesiones'
);

select ok(
  not has_function_privilege('authenticated', 'private.cortar_sesiones_suspendido()', 'execute'),
  'la función de corte no es invocable por usuarios autenticados'
);

select * from finish();

rollback;
