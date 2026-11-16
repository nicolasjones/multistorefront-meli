-- F-REN-01 (MSF-204, épica MSF-120): permisos del umbral de margen. Cubre FR-005 / SC-002:
-- la RPC de umbral solo con `edicion` en `rentabilidad`, lectura con `lectura`, la matriz de todos
-- los roles de la sección `rentabilidad` (hoy 8: la spec nombra 7 y el rol Técnico, MSF-182, se sumó
-- después), RLS directa sobre `dominio.rentabilidad_config` y bloqueo optimista.
begin;

select plan(20);

insert into organizaciones (id, nombre) values
  ('11111111-1111-1111-1111-111111111111', 'Organización Uno'),
  ('22222222-2222-2222-2222-222222222222', 'Organización Dos');

insert into auth.users (id, email) values
  ('d1000000-0000-0000-0000-000000000001', 'administrador@example.com'),
  ('d1000000-0000-0000-0000-000000000002', 'administracion@example.com'),
  ('d1000000-0000-0000-0000-000000000003', 'operador@example.com'),
  ('d1000000-0000-0000-0000-000000000004', 'consulta@example.com'),
  ('d1000000-0000-0000-0000-000000000005', 'mostrador@example.com'),
  ('d1000000-0000-0000-0000-000000000006', 'deposito@example.com'),
  ('d1000000-0000-0000-0000-000000000007', 'miembro@example.com'),
  ('d1000000-0000-0000-0000-000000000008', 'tecnico@example.com'),
  ('d2000000-0000-0000-0000-000000000001', 'admin-dos@example.com');

insert into usuarios_organizacion (user_id, organizacion_id, rol_id) values
  ('d1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'administrador'),
  ('d1000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'administracion'),
  ('d1000000-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111', 'operador'),
  ('d1000000-0000-0000-0000-000000000004', '11111111-1111-1111-1111-111111111111', 'consulta'),
  ('d1000000-0000-0000-0000-000000000005', '11111111-1111-1111-1111-111111111111', 'mostrador'),
  ('d1000000-0000-0000-0000-000000000006', '11111111-1111-1111-1111-111111111111', 'deposito'),
  ('d1000000-0000-0000-0000-000000000007', '11111111-1111-1111-1111-111111111111', 'miembro'),
  ('d1000000-0000-0000-0000-000000000008', '11111111-1111-1111-1111-111111111111', 'tecnico'),
  ('d2000000-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', 'administrador');

-- Matriz de `rentabilidad` (Roles.dc.html + MSF-182): Administrador = edición, Administración =
-- lectura, el resto = ninguno. Resultado esperado de leer y de guardar con cada rol.
create temporary table t_roles (rol text primary key, user_id uuid, lee text, guarda text);
insert into t_roles values
  ('administrador',  'd1000000-0000-0000-0000-000000000001', 'ok',    'ok'),
  ('administracion', 'd1000000-0000-0000-0000-000000000002', 'ok',    '42501'),
  ('operador',       'd1000000-0000-0000-0000-000000000003', '42501', '42501'),
  ('consulta',       'd1000000-0000-0000-0000-000000000004', '42501', '42501'),
  ('mostrador',      'd1000000-0000-0000-0000-000000000005', '42501', '42501'),
  ('deposito',       'd1000000-0000-0000-0000-000000000006', '42501', '42501'),
  ('miembro',        'd1000000-0000-0000-0000-000000000007', '42501', '42501'),
  ('tecnico',        'd1000000-0000-0000-0000-000000000008', '42501', '42501');

create temporary table t_ts (clave text primary key, val timestamptz);
grant all on t_ts to authenticated;

create function pg_temp.como(p_user uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
  set local role authenticated;
end $$;

-- Ejecuta una sentencia como un usuario y devuelve 'ok' o el SQLSTATE con el que falló.
create function pg_temp.resultado(p_user uuid, p_sql text) returns text language plpgsql as $$
declare
  v text;
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
  set local role authenticated;
  begin
    execute p_sql;
    v := 'ok';
  exception when others then
    v := sqlstate;
  end;
  reset role;
  return v;
end $$;

-- ============================================================================
-- Matriz por rol (SC-002)
-- ============================================================================

select is(
  (select count(*)::int from t_roles),
  (select count(distinct m.rol_id)::int from private.matriz_inicial() m where m.seccion = 'rentabilidad'),
  'la prueba recorre todos los roles de la matriz de rentabilidad'
);

select is(
  (select coalesce(string_agg(rol, ',' order by rol), '') from t_roles
    where pg_temp.resultado(user_id, 'select public.leer_umbral_margen_bajo()') is distinct from lee),
  '', 'leer el umbral: solo Administrador y Administración (lectura)'
);

select is(
  (select coalesce(string_agg(rol, ',' order by rol), '') from t_roles
    where pg_temp.resultado(user_id, 'select public.guardar_umbral_margen_bajo(0.12, null)') is distinct from guarda),
  '', 'guardar el umbral: solo Administrador (edición)'
);

select is(
  (select umbral_margen_bajo from dominio.rentabilidad_config where organizacion_id = '11111111-1111-1111-1111-111111111111'),
  0.12, 'el único guardado válido fue el del Administrador'
);
select is(
  (select count(*)::int from dominio.rentabilidad_config),
  1, 'los roles sin edición no dejaron ninguna fila'
);

-- ============================================================================
-- RLS directa sobre la tabla
-- ============================================================================

select pg_temp.como('d1000000-0000-0000-0000-000000000002');
select is(public.leer_umbral_margen_bajo(), 0.12, 'Administración lee el umbral vigente');
select is((select count(*)::int from dominio.rentabilidad_config), 1, 'Administración ve la fila de su organización');
select is_empty(
  $$update dominio.rentabilidad_config set umbral_margen_bajo = 0.5 returning 1$$,
  'Administración (solo lectura) no puede modificar la fila'
);
select throws_ok(
  $$insert into dominio.rentabilidad_config (organizacion_id, umbral_margen_bajo) values ('22222222-2222-2222-2222-222222222222', 0.3)$$,
  '42501', null, 'Administración no puede insertar'
);
reset role;

select pg_temp.como('d1000000-0000-0000-0000-000000000003');
select is((select count(*)::int from dominio.rentabilidad_config), 0, 'Operador (sin la sección) no ve ninguna fila');
reset role;

select pg_temp.como('d2000000-0000-0000-0000-000000000001');
select is((select count(*)::int from dominio.rentabilidad_config), 0, 'otra organización no ve el umbral de la primera');
select throws_ok(
  $$select public.guardar_umbral_margen_bajo(0.2, now())$$,
  '40001', null, 'sin fila previa, mandar un updated_at es un conflicto'
);
reset role;

select pg_temp.como('d1000000-0000-0000-0000-000000000001');
select throws_ok(
  $$insert into dominio.rentabilidad_config (organizacion_id, umbral_margen_bajo) values ('22222222-2222-2222-2222-222222222222', 0.3)$$,
  '42501', null, 'el Administrador no puede escribir el umbral de otra organización'
);
select throws_ok(
  $$delete from dominio.rentabilidad_config$$,
  '42501', null, 'nadie borra el umbral (sin política ni privilegio DELETE)'
);
select throws_ok(
  $$update dominio.rentabilidad_config set updated_at = now()$$,
  '42501', null, 'updated_at no es editable a mano (bloqueo optimista)'
);

-- ============================================================================
-- Bloqueo optimista
-- ============================================================================

insert into t_ts select 'v1', updated_at from dominio.rentabilidad_config;
insert into t_ts select 'v2', public.guardar_umbral_margen_bajo(0.13, (select val from t_ts where clave = 'v1'));
select isnt((select val from t_ts where clave = 'v2'), (select val from t_ts where clave = 'v1'), 'un cambio real avanza updated_at');
select throws_ok(
  $$select public.guardar_umbral_margen_bajo(0.14, (select val from t_ts where clave = 'v1'))$$,
  '40001', null, 'guardar con un updated_at viejo se rechaza'
);
select is(public.leer_umbral_margen_bajo(), 0.13, 'el rechazo no cambió el valor');
reset role;

select ok(
  not has_table_privilege('authenticated', 'dominio.rentabilidad_config', 'DELETE'),
  'authenticated sin DELETE sobre la tabla'
);
select ok(
  not has_table_privilege('anon', 'dominio.rentabilidad_config', 'INSERT')
  and not has_table_privilege('anon', 'dominio.rentabilidad_config', 'UPDATE'),
  'anon sin escritura sobre la tabla'
);

select * from finish();
rollback;
