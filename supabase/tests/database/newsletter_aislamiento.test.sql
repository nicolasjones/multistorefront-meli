-- Newsletter de la tienda, Fase 1 (T005): aislamiento por organización y por tienda de las tablas nuevas (RF-NL-22, SC-003).
-- El fixture corre como postgres; las lecturas, como `authenticated` con request.jwt.claims.
begin;

select no_plan();

insert into organizaciones (id, nombre) values
  ('11111111-1111-1111-1111-111111111111', 'Organización Uno'),
  ('22222222-2222-2222-2222-222222222222', 'Organización Dos');

insert into auth.users (id, email) values
  ('d1000000-0000-0000-0000-000000000001', 'admin-uno@example.com'),
  ('d1000000-0000-0000-0000-000000000002', 'ventas-a@example.com'),
  ('d1000000-0000-0000-0000-000000000003', 'sinclientes@example.com'),
  ('d2000000-0000-0000-0000-000000000001', 'admin-dos@example.com');

insert into usuarios_organizacion (user_id, organizacion_id, rol_id) values
  ('d1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'administrador'),
  ('d1000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'consulta'),
  ('d1000000-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111', 'consulta'),
  ('d2000000-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', 'administrador');

insert into dominio.empresas (id, organizacion_id, nombre, activa) values
  ('e1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'Tienda A', true),
  ('e1000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'Tienda B', true),
  ('e2000000-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', 'Tienda Dos', true);

-- La persona de «consulta» solo accede a la tienda A.
insert into usuarios_empresas (user_id, empresa_id, organizacion_id, rol_id) values
  ('d1000000-0000-0000-0000-000000000002', 'e1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'consulta');
insert into usuario_empresa_activa (user_id, empresa_id) values ('d1000000-0000-0000-0000-000000000002', 'e1000000-0000-0000-0000-000000000001');

insert into dominio.newsletter_configuracion (empresa_id, organizacion_id, activo) values
  ('e1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', true),
  ('e1000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', true),
  ('e2000000-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', true);

insert into dominio.newsletter_suscriptores (organizacion_id, empresa_id, correo, version_consentimiento, confirmacion_hash) values
  ('11111111-1111-1111-1111-111111111111', 'e1000000-0000-0000-0000-000000000001', 'a@ejemplo.com', 'v1', repeat('a', 64)),
  ('11111111-1111-1111-1111-111111111111', 'e1000000-0000-0000-0000-000000000002', 'b@ejemplo.com', 'v1', repeat('b', 64)),
  ('22222222-2222-2222-2222-222222222222', 'e2000000-0000-0000-0000-000000000001', 'dos@ejemplo.com', 'v1', repeat('c', 64)),
  -- La misma dirección en dos tiendas (D7): consentimiento y baja separados.
  ('11111111-1111-1111-1111-111111111111', 'e1000000-0000-0000-0000-000000000002', 'a@ejemplo.com', 'v1', repeat('d', 64));

create function pg_temp.como(p_user uuid) returns void language plpgsql as $$
begin
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
  set local role authenticated;
end $$;

select is((select count(*)::int from dominio.newsletter_suscriptores), 4, 'D7: la misma dirección convive en dos tiendas');
select throws_ok(
  $$insert into dominio.newsletter_suscriptores (organizacion_id, empresa_id, correo, version_consentimiento)
    values ('11111111-1111-1111-1111-111111111111', 'e1000000-0000-0000-0000-000000000001', 'a@ejemplo.com', 'v1')$$,
  '23505', null, 'el correo es único por tienda');

-- Administrador de la organización 1: ve las dos tiendas, nunca la otra organización.
select pg_temp.como('d1000000-0000-0000-0000-000000000001');
select is((select array_agg(correo order by correo) from dominio.newsletter_suscriptores), array['a@ejemplo.com', 'a@ejemplo.com', 'b@ejemplo.com'], 'SC-003: el administrador solo ve las tiendas de su organización');
select is((select count(*)::int from dominio.newsletter_configuracion), 2, 'SC-003: la configuración tampoco cruza organizaciones');
select throws_ok($$select confirmacion_hash from dominio.newsletter_suscriptores$$, '42501', null, 'el hash de confirmación no se puede leer');
select throws_ok(
  $$insert into dominio.newsletter_suscriptores (organizacion_id, empresa_id, correo, version_consentimiento)
    values ('11111111-1111-1111-1111-111111111111', 'e1000000-0000-0000-0000-000000000001', 'x@ejemplo.com', 'v1')$$,
  '42501', null, 'authenticated no inserta directo');
select throws_ok($$update dominio.newsletter_configuracion set activo = false$$, '42501', null, 'authenticated no actualiza directo la configuración');

-- Persona con acceso solo a la tienda A.
select pg_temp.como('d1000000-0000-0000-0000-000000000002');
select is((select array_agg(distinct empresa_id) from dominio.newsletter_suscriptores), array['e1000000-0000-0000-0000-000000000001'::uuid], 'SC-003: solo ve la tienda a la que accede');
select is((select count(*)::int from dominio.newsletter_configuracion), 1, 'la configuración de la tienda inaccesible tampoco se ve');

-- Administrador de la otra organización.
select pg_temp.como('d2000000-0000-0000-0000-000000000001');
select is((select array_agg(correo) from dominio.newsletter_suscriptores), array['dos@ejemplo.com'], 'SC-003: la otra organización solo ve lo suyo');

reset role;
select * from finish();
rollback;
