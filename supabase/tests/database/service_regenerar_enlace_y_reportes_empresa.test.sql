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

-- Dos regeneraciones seguidas: queda un solo token vigente (el último) y las actividades registran ambas.
update rg set token = public.regenerar_enlace_consulta(id)->>'token' where clave = 'a';
reset role;
select is((select count(*)::int from dominio.reparacion_enlaces_consulta
            where reparacion_id = (select id from rg where clave = 'a')), 1, 'tras regenerar dos veces hay un solo enlace vigente');
select is((select token from dominio.reparacion_enlaces_consulta where reparacion_id = (select id from rg where clave = 'a')),
  (select token from rg where clave = 'a'), 'el vigente es el de la última regeneración');
select is((select count(*)::int from public.registro_actividad where tipo = 'reparacion.enlace_regenerado'), 2,
  'cada regeneración registra su actividad');
select is((select empresa_id from public.registro_actividad where tipo = 'reparacion.enlace_regenerado' order by creado_en, id limit 1),
  'a1000000-0000-0000-0000-000000000001'::uuid, 'la actividad lleva la tienda de la reparación');

-- Camino positivo del operador restringido: regenera en SU tienda.
select pg_temp.como('e1000000-0000-0000-0000-000000000002');
select matches(public.regenerar_enlace_consulta((select id from rg where clave = 'a'))->>'token', '^[A-Za-z0-9_-]{32}$',
  'el operador regenera el enlace de una reparación de su tienda');
reset role;
update rg set token = (select e.token from dominio.reparacion_enlaces_consulta e where e.reparacion_id = rg.id) where clave = 'a';

-- Una reparación sin enlace previo: regenerar lo crea.
select pg_temp.como('e1000000-0000-0000-0000-000000000001');
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

-- Tope de frecuencia: 10 regeneraciones por persona por hora.
select pg_temp.como('e1000000-0000-0000-0000-000000000001');
select lives_ok(format($$select public.regenerar_enlace_consulta(%L)$$, (select id from rg where clave = 'a')),
  'las regeneraciones siguientes dentro del tope funcionan') from generate_series(1, 7);
select throws_ok(format($$select public.regenerar_enlace_consulta(%L)$$, (select id from rg where clave = 'a')),
  'P0001', 'DEMASIADAS_REGENERACIONES: probá de nuevo en unos minutos', 'la regeneración 11 de la misma hora se rechaza');
reset role;

-- ============================================================================
-- Reportes acotados a las empresas accesibles
-- ============================================================================

select pg_temp.como('e1000000-0000-0000-0000-000000000001');
select is((select count(*)::int from public.empresas_para_selector()), 2, 'el administrador accede a las dos tiendas');
select pg_temp.como('e1000000-0000-0000-0000-000000000002');
select is((select array_agg(id) from public.empresas_para_selector()),
  array['a1000000-0000-0000-0000-000000000001']::uuid[],
  'el operador con tiendas restringidas solo accede a San Javucho');

-- Lo que arma emitir-acceso-reporte: organizacion_id = '<org>' AND empresa_id IN ('<accesibles del usuario>').
-- Se ejecuta con el rol real del tablero (`superset_analitica`) sobre la vista real, con las empresas que devuelve
-- la RPC real `empresas_para_selector()`.
create temp table clausulas (clave text primary key, clausula text);
grant select, insert on clausulas to public;

select pg_temp.como('e1000000-0000-0000-0000-000000000002');
insert into clausulas
select 'operador', format('organizacion_id = %L AND empresa_id IN (%s)', '11111111-1111-1111-1111-111111111111',
  (select string_agg(quote_literal(id), ', ') from public.empresas_para_selector()));
select pg_temp.como('e1000000-0000-0000-0000-000000000001');
insert into clausulas
select 'administrador', format('organizacion_id = %L AND empresa_id IN (%s)', '11111111-1111-1111-1111-111111111111',
  (select string_agg(quote_literal(id), ', ') from public.empresas_para_selector()));
reset role;

create function pg_temp.contar(p_clave text, p_extra text default 'true') returns bigint language plpgsql as $$
declare v bigint;
begin
  execute format('select count(*) from analitica.service_reparaciones where (%s) and (%s)',
    (select clausula from clausulas where clave = p_clave), p_extra) into v;
  return v;
end $$;
grant execute on function pg_temp.contar(text, text) to public;

create temp table conteos (clave text primary key, n bigint);
grant select, insert on conteos to public;
grant superset_analitica to current_user;
set local role superset_analitica;
insert into conteos values
  ('operador', pg_temp.contar('operador')),
  ('operador_mundo', pg_temp.contar('operador', $$empresa_nombre = 'Mundo JC'$$)),
  ('administrador', pg_temp.contar('administrador')),
  ('sin_clausula', (select count(*) from analitica.service_reparaciones
                     where organizacion_id = '11111111-1111-1111-1111-111111111111'));
reset role;

select is((select n from conteos where clave = 'operador'), 2::bigint,
  'operador restringido: el tablero cuenta lo suyo (las 2 reparaciones de San Javucho)');
select is((select n from conteos where clave = 'operador_mundo'), 0::bigint, 'operador restringido: no ve nada de Mundo JC');
select is((select n from conteos where clave = 'administrador'), 3::bigint, 'el administrador ve las 3 reparaciones de sus dos tiendas');
select is((select n from conteos where clave = 'sin_clausula'), 3::bigint,
  'sin la cláusula por empresa (el riesgo anterior) se verían las 3 reparaciones');

-- Una tienda desactivada desaparece de las empresas accesibles y, con ella, del tablero.
update dominio.empresas set activa = false where id = 'a1000000-0000-0000-0000-000000000001';
select pg_temp.como('e1000000-0000-0000-0000-000000000002');
select is((select count(*)::int from public.empresas_para_selector()), 0, 'una tienda inactiva no es accesible para el operador');
reset role;
update dominio.empresas set activa = true where id = 'a1000000-0000-0000-0000-000000000001';

-- El reporte de Service SIEMPRE filtra por empresa: lo fuerza el trigger de la migración (lo que ejecuta la base).
select is((select count(*)::int from public.reportes where seccion = 'service_tecnico' and not filtro_empresa), 0,
  'ningún reporte de Service registrado (incluido el sembrado por la migración 20270219130300) queda con filtro_empresa = false');
insert into public.reportes (id, superset_dashboard_uuid, nombre, creado_por, seccion, filtro_empresa)
values ('f1000000-0000-0000-0000-0000000000a1', 'dash-service-x', 'Service técnico X',
        'e1000000-0000-0000-0000-000000000001', 'service_tecnico', false);
select is((select filtro_empresa from public.reportes where id = 'f1000000-0000-0000-0000-0000000000a1'), true,
  'un reporte de Service insertado con filtro_empresa = false queda en true');
update public.reportes set filtro_empresa = false where id = 'f1000000-0000-0000-0000-0000000000a1';
select is((select filtro_empresa from public.reportes where id = 'f1000000-0000-0000-0000-0000000000a1'), true,
  'no se puede apagar el filtro de un reporte de Service');
insert into public.reportes (id, superset_dashboard_uuid, nombre, creado_por, seccion)
values ('f1000000-0000-0000-0000-0000000000a2', 'dash-otro', 'Otro tablero', 'e1000000-0000-0000-0000-000000000001', 'ventas');
select is((select filtro_empresa from public.reportes where id = 'f1000000-0000-0000-0000-0000000000a2'), false,
  'los reportes de otras secciones no cambian');
select ok(not has_function_privilege('authenticated', 'private.forzar_filtro_empresa_service()', 'execute'),
  'la función del trigger no es ejecutable por authenticated');

select * from finish();
rollback;
