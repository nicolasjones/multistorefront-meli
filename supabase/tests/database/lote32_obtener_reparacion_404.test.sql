-- MSF-638 (lote 32): `obtener_reparacion` responde PT404 (HTTP 404) cuando la reparación no existe o no es visible, con el
-- MISMO código y mensaje para «no existe», «es de otra organización» y «es de una tienda inaccesible» (sin oráculo de
-- existencia); un rol sin la sección service_tecnico sigue recibiendo 42501 (HTTP 403).
begin;

select no_plan();

insert into organizaciones (id, nombre) values
  ('11111111-1111-1111-1111-111111111111', 'Organización Uno'),
  ('22222222-2222-2222-2222-222222222222', 'Organización Dos');

insert into auth.users (id, email) values
  ('e1000000-0000-0000-0000-000000000001', 'administrador@example.com'),
  ('e1000000-0000-0000-0000-000000000002', 'operador@example.com'),
  ('e1000000-0000-0000-0000-000000000005', 'deposito@example.com'),
  ('e2000000-0000-0000-0000-000000000001', 'admin-dos@example.com');

insert into usuarios_organizacion (user_id, organizacion_id, rol_id, estado) values
  ('e1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'administrador', 'activo'),
  ('e1000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'operador', 'activo'),
  ('e1000000-0000-0000-0000-000000000005', '11111111-1111-1111-1111-111111111111', 'deposito', 'activo'),
  ('e2000000-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', 'administrador', 'activo');

insert into dominio.empresas (id, organizacion_id, nombre) values
  ('a1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'San Javucho'),
  ('a1000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'Mundo JC'),
  ('a2000000-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', 'Empresa Dos');

-- El operador solo accede a San Javucho.
insert into usuarios_empresas (user_id, empresa_id, organizacion_id, rol_id) values
  ('e1000000-0000-0000-0000-000000000002', 'a1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'operador'),
  ('e1000000-0000-0000-0000-000000000005', 'a1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'deposito');

insert into dominio.clientes (id, organizacion_id, numero, nombre, tipo) values
  ('c5000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 10, 'Distribuidora Norte', 'mayorista'),
  ('c6000000-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', 10, 'Cliente de la Dos', 'minorista');

create function pg_temp.como(p_user uuid) returns void language plpgsql as $$
begin
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
  set local role authenticated;
end $$;

create temp table datos as
  select
    (select id from dominio.modelos_equipo where organizacion_id = '11111111-1111-1111-1111-111111111111' and equipo = 'Nintendo Switch' and modelo = 'Estándar') as modelo_uno,
    (select id from dominio.modelos_equipo where organizacion_id = '22222222-2222-2222-2222-222222222222' limit 1) as modelo_dos;
grant select on datos to public;
create temp table reps (clave text primary key, id uuid);
grant select, insert on reps to public;

select pg_temp.como('e1000000-0000-0000-0000-000000000001');
insert into reps (clave, id) select 'propia', (public.crear_reparacion('a1000000-0000-0000-0000-000000000001', 'c5000000-0000-0000-0000-000000000001', (select modelo_uno from datos))->>'id')::uuid;
insert into reps (clave, id) select 'otra_tienda', (public.crear_reparacion('a1000000-0000-0000-0000-000000000002', 'c5000000-0000-0000-0000-000000000001', (select modelo_uno from datos))->>'id')::uuid;
select pg_temp.como('e2000000-0000-0000-0000-000000000001');
insert into reps (clave, id) select 'otra_org', (public.crear_reparacion('a2000000-0000-0000-0000-000000000001', 'c6000000-0000-0000-0000-000000000001', (select modelo_dos from datos))->>'id')::uuid;

select is(has_function_privilege('anon', 'public.obtener_reparacion(uuid)', 'execute'), false, 'anon no ejecuta obtener_reparacion');
select is(has_function_privilege('authenticated', 'public.obtener_reparacion(uuid)', 'execute'), true, 'authenticated sí');

-- Dentro del alcance responde
select pg_temp.como('e1000000-0000-0000-0000-000000000002');
select is(public.obtener_reparacion((select id from reps where clave = 'propia'))->>'codigo', 'R-0001', 'el operador lee la reparación de su tienda');

-- Fuera del alcance: PT404 con el mismo mensaje, sea cual sea el motivo
select throws_ok(format($$select public.obtener_reparacion(%L)$$, (select id from reps where clave = 'otra_tienda')),
  'PT404', 'La reparación no existe', 'una tienda inaccesible responde 404');
select throws_ok(format($$select public.obtener_reparacion(%L)$$, (select id from reps where clave = 'otra_org')),
  'PT404', 'La reparación no existe', 'una reparación de otra organización responde 404');
select throws_ok($$select public.obtener_reparacion('00000000-0000-0000-0000-0000000000ff')$$,
  'PT404', 'La reparación no existe', 'una reparación inexistente responde igual (sin oráculo de existencia)');

-- El administrador de la otra organización tampoco ve la de la primera
select pg_temp.como('e2000000-0000-0000-0000-000000000001');
select throws_ok(format($$select public.obtener_reparacion(%L)$$, (select id from reps where clave = 'propia')),
  'PT404', 'La reparación no existe', 'la otra organización recibe 404 por una reparación ajena');
select is(public.obtener_reparacion((select id from reps where clave = 'otra_org'))->>'codigo', 'R-0001', 'y lee la suya');

-- Sin la sección service_tecnico: 403 (42501), igual para cualquier id
select pg_temp.como('e1000000-0000-0000-0000-000000000005');
select throws_ok(format($$select public.obtener_reparacion(%L)$$, (select id from reps where clave = 'propia')),
  '42501', 'Tu rol no puede ver reparaciones', 'Depósito (sin service_tecnico) recibe 403 por una reparación existente');
select throws_ok($$select public.obtener_reparacion('00000000-0000-0000-0000-0000000000ff')$$,
  '42501', 'Tu rol no puede ver reparaciones', 'y 403 por una inexistente: el rol no decide si existe');

select * from finish();
rollback;
