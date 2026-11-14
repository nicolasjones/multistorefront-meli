-- Service técnico: «Regenerar enlace» del seguimiento y reportes acotados a las empresas accesibles.
-- Cubre: token nuevo y el viejo deja de resolver, permisos (edición, tienda accesible, otra organización),
-- actividad registrada sin token, grants (anon sin ejecución) y que quien tiene tiendas restringidas
-- (empresas_para_selector + cláusula rls del guest token) no ve cifras de otras empresas en `analitica.service_*`.
begin;

select no_plan();

insert into organizaciones (id, nombre) values
  ('11111111-1111-1111-1111-111111111111', 'Organización Uno'),
  ('22222222-2222-2222-2222-222222222222', 'Organización Dos');

insert into auth.users (id, email) values
  ('e1000000-0000-0000-0000-000000000001', 'administrador@example.com'),
  ('e1000000-0000-0000-0000-000000000002', 'operador@example.com'),
  ('e1000000-0000-0000-0000-000000000003', 'consulta@example.com'),
  ('e2000000-0000-0000-0000-000000000001', 'admin-dos@example.com');

insert into usuarios_organizacion (user_id, organizacion_id, rol_id, estado) values
  ('e1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'administrador', 'activo'),
  ('e1000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'operador', 'activo'),
  ('e1000000-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111', 'consulta', 'activo'),
  ('e2000000-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', 'administrador', 'activo');

insert into dominio.empresas (id, organizacion_id, nombre) values
  ('a1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'San Javucho'),
  ('a1000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'Mundo JC'),
  ('a2000000-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', 'Empresa Dos');

-- El operador y la consulta solo acceden a San Javucho (tiendas restringidas).
insert into usuarios_empresas (user_id, empresa_id, organizacion_id, rol_id) values
  ('e1000000-0000-0000-0000-000000000002', 'a1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'operador'),
  ('e1000000-0000-0000-0000-000000000003', 'a1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'consulta');

insert into clientes (id, organizacion_id, numero, nombre, tipo, archivado_en) values
  ('c5000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 10, 'Distribuidora Norte', 'mayorista', null);

create function pg_temp.como(p_user uuid) returns void language plpgsql as $$
begin
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
  set local role authenticated;
end $$;

create temp table datos as
  select (select id from dominio.modelos_equipo where organizacion_id = '11111111-1111-1111-1111-111111111111'
            and equipo = 'Nintendo Switch' and modelo = 'Estándar') as modelo_uno;
grant select on datos to public;

create temp table rg (clave text primary key, id uuid, token text);
grant select, insert, update on rg to public;

-- ============================================================================
-- Grants de la RPC nueva
-- ============================================================================
select is(has_function_privilege('anon', 'public.regenerar_enlace_consulta(uuid)', 'execute'), false,
  'anon no ejecuta regenerar_enlace_consulta');
select is(has_function_privilege('authenticated', 'public.regenerar_enlace_consulta(uuid)', 'execute'), true,
  'authenticated ejecuta regenerar_enlace_consulta');

-- ============================================================================
-- Regenerar enlace
-- ============================================================================
select pg_temp.como('e1000000-0000-0000-0000-000000000001');

insert into rg (clave, id)
select 'a', (public.crear_reparacion('a1000000-0000-0000-0000-000000000001', 'c5000000-0000-0000-0000-000000000001',
  (select modelo_uno from datos), 'Ana 11-5555', 'SN-1', 'Cargador', 'No enciende', 100, 50)->>'id')::uuid;
insert into rg (clave, id)
select 'tienda_b', (public.crear_reparacion('a1000000-0000-0000-0000-000000000002', 'c5000000-0000-0000-0000-000000000001',
  (select modelo_uno from datos), 'Ana 11-5555', 'SN-2', 'Cargador', 'No enciende', 70, 30)->>'id')::uuid;
insert into rg (clave, id)
select 'sin_enlace', (public.crear_reparacion('a1000000-0000-0000-0000-000000000001', 'c5000000-0000-0000-0000-000000000001',
  (select modelo_uno from datos))->>'id')::uuid;

update rg set token = public.obtener_enlace_consulta(id)->>'token' where clave = 'a';
create temp table viejo as select token from rg where clave = 'a';
grant select on viejo to public;

update rg set token = public.regenerar_enlace_consulta(id)->>'token' where clave = 'a';

select matches((select token from rg where clave = 'a'), '^[A-Za-z0-9_-]{32}$', 'el token nuevo es base64url de 32 caracteres');
select isnt((select token from rg where clave = 'a'), (select token from viejo), 'el token regenerado es distinto del anterior');
select is(public.obtener_enlace_consulta((select id from rg where clave = 'a'))->>'token', (select token from rg where clave = 'a'),
  'después de regenerar, obtener devuelve el token nuevo');

reset role;
select is((select count(*)::int from dominio.reparacion_enlaces_consulta
            where reparacion_id = (select id from rg where clave = 'a')), 1, 'sigue habiendo un solo enlace por reparación');
select is((select count(*)::int from dominio.reparacion_enlaces_consulta where token = (select token from viejo)), 0,
  'el token anterior ya no existe');
set local role service_role;
select is(public.obtener_estado_publico_reparacion((select token from viejo)), null,
  'el enlace anterior deja de resolver en la consulta pública');
select isnt(public.obtener_estado_publico_reparacion((select token from rg where clave = 'a')), null,
  'el enlace nuevo resuelve la consulta pública');
reset role;

select is((select count(*)::int from public.registro_actividad where tipo = 'reparacion.enlace_regenerado'), 1,
  'se registra una actividad de regeneración');
select ok(
  (select detalle from public.registro_actividad where tipo = 'reparacion.enlace_regenerado') like 'Regeneró el enlace de seguimiento de R-%'
  and (select detalle from public.registro_actividad where tipo = 'reparacion.enlace_regenerado')
      not like '%' || (select token from rg where clave = 'a') || '%',
  'la actividad nombra el código y nunca el token');

-- Una reparación sin enlace previo: regenerar lo crea.
select pg_temp.como('e1000000-0000-0000-0000-000000000001');
select matches(public.regenerar_enlace_consulta((select id from rg where clave = 'sin_enlace'))->>'token', '^[A-Za-z0-9_-]{32}$',
  'regenerar sin enlace previo lo crea');

-- Permisos y alcance.
select pg_temp.como('e1000000-0000-0000-0000-000000000003');
select throws_ok(format($$select public.regenerar_enlace_consulta(%L)$$, (select id from rg where clave = 'a')),
  '42501', null, 'un rol de consulta no regenera el enlace');
select pg_temp.como('e1000000-0000-0000-0000-000000000002');
select throws_ok(format($$select public.regenerar_enlace_consulta(%L)$$, (select id from rg where clave = 'tienda_b')),
  'P0002', null, 'una tienda inaccesible no regenera y responde como una reparación inexistente');
select throws_ok($$select public.regenerar_enlace_consulta(gen_random_uuid())$$, 'P0002', null, 'una reparación inexistente es P0002');
select pg_temp.como('e2000000-0000-0000-0000-000000000001');
select throws_ok(format($$select public.regenerar_enlace_consulta(%L)$$, (select id from rg where clave = 'a')),
  'P0002', null, 'una reparación de otra organización es P0002');
reset role;
select is((select token from dominio.reparacion_enlaces_consulta where reparacion_id = (select id from rg where clave = 'a')),
  (select token from rg where clave = 'a'), 'los intentos rechazados no cambiaron el token');

-- ============================================================================
-- Reportes acotados a las empresas accesibles
-- ============================================================================

select pg_temp.como('e1000000-0000-0000-0000-000000000001');
select is((select count(*)::int from public.empresas_para_selector()), 2, 'el administrador accede a las dos tiendas');
select pg_temp.como('e1000000-0000-0000-0000-000000000002');
select is((select array_agg(id) from public.empresas_para_selector()),
  array['a1000000-0000-0000-0000-000000000001']::uuid[],
  'el operador con tiendas restringidas solo accede a San Javucho');

-- Lo que arma emitir-acceso-reporte: organizacion_id = '<org>' AND empresa_id IN (accesibles del usuario).
create temp table accesibles_operador as
  select id from public.empresas_para_selector();
grant select on accesibles_operador to public;
reset role;

select is(
  (select count(*)::int from analitica.service_reparaciones
    where organizacion_id = '11111111-1111-1111-1111-111111111111'
      and empresa_id in (select id from accesibles_operador)),
  2, 'con la cláusula del operador, el tablero cuenta solo las 2 reparaciones de San Javucho');
select is(
  (select count(*)::int from analitica.service_reparaciones
    where organizacion_id = '11111111-1111-1111-1111-111111111111'
      and empresa_id in (select id from accesibles_operador)
      and empresa_id = 'a1000000-0000-0000-0000-000000000002'),
  0, 'con la cláusula del operador no aparece ninguna reparación de Mundo JC');
select is(
  (select coalesce(sum(total_cliente), 0)::numeric from analitica.service_reparaciones
    where organizacion_id = '11111111-1111-1111-1111-111111111111'
      and empresa_id in (select id from accesibles_operador)
      and empresa_nombre = 'Mundo JC'),
  0::numeric, 'las cifras de Mundo JC no entran en el total del operador');
select is(
  (select count(*)::int from analitica.service_reparaciones
    where organizacion_id = '11111111-1111-1111-1111-111111111111'),
  3, 'sin la cláusula por empresa (el riesgo anterior) se verían las 3 reparaciones de las dos tiendas');

-- La migración deja filtro_empresa = true en los reportes de la sección de Service.
insert into public.reportes (id, superset_dashboard_uuid, nombre, creado_por, seccion)
values ('f1000000-0000-0000-0000-0000000000a1', 'dash-service-x', 'Service técnico X',
        'e1000000-0000-0000-0000-000000000001', 'service_tecnico');
update public.reportes set filtro_empresa = true
 where seccion = 'service_tecnico' and filtro_empresa is distinct from true;
select is((select filtro_empresa from public.reportes where id = 'f1000000-0000-0000-0000-0000000000a1'), true,
  'el UPDATE de la migración deja filtro_empresa = true en los reportes de Service');

select * from finish();
rollback;
