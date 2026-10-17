-- Organización recién dada de alta (MSF-162, F-ORG-02, FR-001/FR-002/FR-003, escenario 4).
-- Reproduce el estado que deja la Edge Function `crear-organizacion` (service-role: fila en
-- `organizaciones` + membresía `administrador` del fundador) y verifica con el rol `authenticated`
-- que la organización nueva queda aislada de las demás, que nadie puede darla de alta por
-- PostgREST (sin policy/privilegio de INSERT) y que se mantiene un usuario, una organización.
-- Tablas involucradas, todas en `public` (Principio VII): organizaciones, usuarios_organizacion,
-- clientes. No se crean ni alteran tablas.
begin;

select plan(12);

insert into organizaciones (id, nombre) values
  ('b1000000-0000-0000-0000-00000000000a', 'Organización Existente'),
  ('b2000000-0000-0000-0000-00000000000b', 'Organización Nueva');

insert into auth.users (id, email) values
  ('b1000000-0000-0000-0000-000000000001', 'admin-existente@example.com'),
  ('b2000000-0000-0000-0000-000000000001', 'fundador-nuevo@example.com'),
  ('b5000000-0000-0000-0000-000000000005', 'superadmin-alta@example.com');

insert into superadmins (user_id) values ('b5000000-0000-0000-0000-000000000005');

insert into usuarios_organizacion (user_id, organizacion_id, rol_id) values
  ('b1000000-0000-0000-0000-000000000001', 'b1000000-0000-0000-0000-00000000000a', 'administrador'),
  ('b2000000-0000-0000-0000-000000000001', 'b2000000-0000-0000-0000-00000000000b', 'administrador');

insert into clientes (id, organizacion_id, nombre) values
  ('b1000000-0000-0000-0000-0000000000c1', 'b1000000-0000-0000-0000-00000000000a', 'Cliente de la existente');

-- Un usuario, una organización (FR-002): el mismo usuario no puede tener otra membresía.
select throws_ok(
  $$insert into usuarios_organizacion (user_id, organizacion_id, rol_id) values ('b2000000-0000-0000-0000-000000000001', 'b1000000-0000-0000-0000-00000000000a', 'administrador')$$,
  '23505', null,
  'el fundador no puede quedar en una segunda organización (un usuario, una organización)'
);

-- Fundador de la organización nueva
select set_config('request.jwt.claims', json_build_object('sub', 'b2000000-0000-0000-0000-000000000001', 'role', 'authenticated')::text, true);
set local role authenticated;

select is((select count(*) from organizaciones)::int, 1, 'el fundador ve solo la organización nueva');
select is((select nombre from organizaciones), 'Organización Nueva', 'la organización que ve es la suya');
select is((select count(*) from clientes)::int, 0, 'el fundador no ve datos de la organización existente');
select is((select count(*) from usuarios_organizacion)::int, 1, 'el fundador ve solo su propia membresía');

select throws_ok(
  $$insert into clientes (organizacion_id, nombre) values ('b1000000-0000-0000-0000-00000000000a', 'Intento cruzado')$$,
  '42501', null,
  'el fundador no puede escribir datos en la organización existente'
);

select throws_ok(
  $$insert into organizaciones (nombre) values ('Alta directa')$$,
  '42501', null,
  'un administrador no puede crear organizaciones por la API (solo la Edge Function)'
);

-- Administrador de la organización existente
reset role;
select set_config('request.jwt.claims', json_build_object('sub', 'b1000000-0000-0000-0000-000000000001', 'role', 'authenticated')::text, true);
set local role authenticated;

select is((select count(*) from organizaciones)::int, 1, 'la organización existente no ve la organización nueva');
select is((select count(*) from clientes)::int, 1, 'la organización existente conserva sus datos');

-- Superadmin: tampoco crea organizaciones por la API
reset role;
select set_config('request.jwt.claims', json_build_object('sub', 'b5000000-0000-0000-0000-000000000005', 'role', 'authenticated')::text, true);
set local role authenticated;

select throws_ok(
  $$insert into organizaciones (nombre) values ('Alta directa del superadmin')$$,
  '42501', null,
  'ni el superadmin crea organizaciones por la API: el alta pasa por crear-organizacion'
);

reset role;

select ok(
  not has_table_privilege('anon', 'public.organizaciones', 'insert'),
  'anon no tiene INSERT sobre organizaciones'
);
select ok(
  has_table_privilege('service_role', 'public.organizaciones', 'insert')
    and has_table_privilege('service_role', 'public.usuarios_organizacion', 'insert'),
  'service_role (la Edge Function) puede insertar organización y membresía'
);

select * from finish();
rollback;
