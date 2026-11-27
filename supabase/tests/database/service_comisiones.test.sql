-- MSF-187 / MSF-953 / MSF-954 / MSF-957 (lote 100): comisiones de técnicos de Service.
-- Cubre, con filas reales armadas por las RPC del producto (crear_reparacion, agregar_item_reparacion,
-- registrar_entrega_reparacion): privilegios y RLS; el permiso propio `ver_comisiones` (independiente de `ver_costos`);
-- reglas de comisión (validaciones, duplicado, vigencia, precedencia); reparto entre N técnicos (suma 100, congelado al
-- entregar, cambio posterior solo con permiso y motivo, registro en la actividad); «Mis comisiones» (solo lo propio, sin
-- costos); resumen del equipo = suma del detalle; tiendas accesibles; aislamiento entre organizaciones; exportación total.
-- Matriz vigente de `service_tecnico`: administrador `edicion` + ver_costos + ver_comisiones; técnico `edicion` sin acciones;
-- administración `lectura` + ver_costos + ver_comisiones; operador `edicion`; consulta `lectura`; depósito `ninguno`.
begin;

select no_plan();

insert into organizaciones (id, nombre) values
  ('11111111-1111-1111-1111-111111111111', 'Organización Uno'),
  ('22222222-2222-2222-2222-222222222222', 'Organización Dos');

insert into auth.users (id, email) values
  ('e1000000-0000-0000-0000-000000000001', 'administrador@example.com'),
  ('e1000000-0000-0000-0000-000000000002', 'operador@example.com'),
  ('e1000000-0000-0000-0000-000000000003', 'consulta@example.com'),
  ('e1000000-0000-0000-0000-000000000004', 'administracion@example.com'),
  ('e1000000-0000-0000-0000-000000000005', 'deposito@example.com'),
  ('e1000000-0000-0000-0000-000000000008', 'tecnico-uno@example.com'),
  ('e1000000-0000-0000-0000-000000000009', 'tecnico-dos@example.com'),
  ('e2000000-0000-0000-0000-000000000001', 'admin-dos@example.com'),
  ('e2000000-0000-0000-0000-000000000008', 'tecnico-de-la-dos@example.com');

insert into usuarios_organizacion (user_id, organizacion_id, rol_id, estado) values
  ('e1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'administrador', 'activo'),
  ('e1000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'operador', 'activo'),
  ('e1000000-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111', 'consulta', 'activo'),
  ('e1000000-0000-0000-0000-000000000004', '11111111-1111-1111-1111-111111111111', 'administracion', 'activo'),
  ('e1000000-0000-0000-0000-000000000005', '11111111-1111-1111-1111-111111111111', 'deposito', 'activo'),
  ('e1000000-0000-0000-0000-000000000008', '11111111-1111-1111-1111-111111111111', 'tecnico', 'activo'),
  ('e1000000-0000-0000-0000-000000000009', '11111111-1111-1111-1111-111111111111', 'tecnico', 'activo'),
  ('e2000000-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', 'administrador', 'activo'),
  ('e2000000-0000-0000-0000-000000000008', '22222222-2222-2222-2222-222222222222', 'tecnico', 'activo');

insert into perfiles_usuario (user_id, nombre, apellido) values
  ('e1000000-0000-0000-0000-000000000008', 'Tomás', 'Uno'),
  ('e1000000-0000-0000-0000-000000000009', 'Tamara', 'Dos');

insert into dominio.empresas (id, organizacion_id, nombre) values
  ('a1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'San Javucho'),
  ('a1000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'Mundo JC'),
  ('a2000000-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', 'Empresa Dos');

-- Administración solo accede a San Javucho (prueba que el resumen respeta las tiendas accesibles).
insert into usuarios_empresas (user_id, empresa_id, organizacion_id, rol_id) values
  ('e1000000-0000-0000-0000-000000000004', 'a1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'administracion'),
  ('e1000000-0000-0000-0000-000000000003', 'a1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'consulta'),
  ('e1000000-0000-0000-0000-000000000002', 'a1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'operador'),
  ('e1000000-0000-0000-0000-000000000008', 'a1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'tecnico'),
  ('e1000000-0000-0000-0000-000000000008', 'a1000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'tecnico'),
  ('e1000000-0000-0000-0000-000000000009', 'a1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'tecnico');

insert into dominio.clientes (id, organizacion_id, numero, nombre, tipo, archivado_en) values
  ('c5000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 10, 'Distribuidora Norte', 'mayorista', null);

-- Independencia de los dos permisos: Operador ve costos pero NO comisiones; Consulta ve comisiones pero NO costos.
update permisos_rol_accion set permitido = true
 where organizacion_id = '11111111-1111-1111-1111-111111111111' and rol_id = 'operador'
   and seccion = 'service_tecnico' and accion = 'ver_costos';
update permisos_rol_accion set permitido = true
 where organizacion_id = '11111111-1111-1111-1111-111111111111' and rol_id = 'consulta'
   and seccion = 'service_tecnico' and accion = 'ver_comisiones';

create function pg_temp.como(p_user uuid) returns void language plpgsql as $$
begin
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
  set local role authenticated;
end $$;

create temp table datos as
  select
    (select id from dominio.modelos_equipo where organizacion_id = '11111111-1111-1111-1111-111111111111' and equipo = 'Nintendo Switch' and modelo = 'Estándar') as modelo_uno,
    (select id from dominio.estados_reparacion where organizacion_id = '11111111-1111-1111-1111-111111111111' and cierra order by orden limit 1) as cierra_uno,
    (now() at time zone 'America/Argentina/Buenos_Aires')::date as hoy;
grant select on datos to public;

create temp table reps (clave text primary key, id uuid);
grant select, insert on reps to public;

-- ============================================================================
-- Privilegios y diseño
-- ============================================================================

select is(
  (select count(*) from unnest(array[
    'public.mis_comisiones(date,date)', 'public.comisiones_resumen(date,date)',
    'public.comisiones_de_tecnico(uuid,date,date)', 'public.guardar_regla_comision(uuid,numeric,date)',
    'public.listar_reglas_comision()', 'public.obtener_reparto_comision(uuid)',
    'public.guardar_reparto_comision(uuid,jsonb,text)'
  ]) as f where has_function_privilege('anon', f::regprocedure, 'execute'))::int,
  0, 'anon no ejecuta ninguna RPC de comisiones');
select is(
  (select count(*) from unnest(array[
    'public.mis_comisiones(date,date)', 'public.comisiones_resumen(date,date)',
    'public.comisiones_de_tecnico(uuid,date,date)', 'public.guardar_regla_comision(uuid,numeric,date)',
    'public.listar_reglas_comision()', 'public.obtener_reparto_comision(uuid)',
    'public.guardar_reparto_comision(uuid,jsonb,text)'
  ]) as f where has_function_privilege('authenticated', f::regprocedure, 'execute'))::int,
  7, 'authenticated ejecuta las siete RPC de comisiones');
select is(
  (select count(*) from unnest(array[
    'private.comisiones_calculadas(uuid,date,date,uuid)', 'private.comisiones_detalle_json(uuid,uuid,date,date,boolean)',
    'private.nombre_de_tecnico(uuid)', 'private.validar_periodo_comisiones(date,date)',
    'private.validar_reparto_comision()', 'private.congelar_reparto_comision()'
  ]) as f where has_function_privilege('anon', f::regprocedure, 'execute') or has_function_privilege('authenticated', f::regprocedure, 'execute'))::int,
  0, 'las funciones private de comisiones no son ejecutables por la API');
select is(
  (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname in ('public', 'private')
      and p.proname in ('mis_comisiones', 'comisiones_resumen', 'comisiones_de_tecnico', 'guardar_regla_comision',
                        'listar_reglas_comision', 'obtener_reparto_comision', 'guardar_reparto_comision',
                        'comisiones_calculadas', 'comisiones_detalle_json', 'nombre_de_tecnico', 'congelar_reparto_comision',
                        'validar_reparto_comision')
      and (not p.prosecdef or p.proconfig is null or not ('search_path=""' = any (p.proconfig))))::int,
  0, 'todas son security definer con search_path vacío');
select is(
  (select count(*) from pg_class c where c.oid in ('dominio.comision_reglas'::regclass, 'dominio.reparacion_comision_reparto'::regclass,
     'dominio.reparacion_comision_historial'::regclass) and c.relrowsecurity)::int,
  3, 'las tres tablas nuevas tienen RLS activada');
select is(
  (select count(*) from information_schema.role_table_grants
    where table_schema = 'dominio' and table_name in ('comision_reglas', 'reparacion_comision_reparto', 'reparacion_comision_historial')
      and grantee in ('anon', 'authenticated', 'PUBLIC') and privilege_type <> 'SELECT')::int,
  0, 'las tablas nuevas no admiten escritura directa');
select is(
  (select count(*) from information_schema.role_table_grants
    where table_schema = 'dominio' and table_name in ('comision_reglas', 'reparacion_comision_reparto', 'reparacion_comision_historial') and grantee = 'anon')::int,
  0, 'anon no tiene ningún privilegio sobre las tablas nuevas');
select is(
  (select count(*) from private.conjuntos_exportacion_total() where esquema = 'dominio'
     and tabla in ('comision_reglas', 'reparacion_comision_reparto', 'reparacion_comision_historial'))::int,
  3, 'las tres tablas entran en la exportación total');
select ok(
  (select prosrc like '%for update%' from pg_proc where oid = 'public.guardar_reparto_comision(uuid,jsonb,text)'::regprocedure),
  'guardar_reparto_comision bloquea la reparación (for update): dos cambios simultáneos se serializan');

-- ============================================================================
-- Permiso propio ver_comisiones (MSF-957): sembrado, independiente de ver_costos, columna de permisos_actuales
-- ============================================================================

select is(
  (select string_agg(rol_id, ',' order by rol_id) from permisos_rol_accion
    where organizacion_id = '11111111-1111-1111-1111-111111111111' and seccion = 'service_tecnico'
      and accion = 'ver_comisiones' and permitido),
  'administracion,administrador,consulta', 'sembrada: Administración y Administrador (más Consulta, cambiada a mano en este test)');
select is(
  (select count(*)::int from permisos_rol_accion
    where organizacion_id = '11111111-1111-1111-1111-111111111111' and accion = 'ver_comisiones' and seccion <> 'service_tecnico'),
  0, 'ver_comisiones existe solo en service_tecnico');
select is(
  (select count(*)::int from permisos_rol_accion
    where organizacion_id = '11111111-1111-1111-1111-111111111111' and accion = 'ver_comisiones' and seccion = 'service_tecnico'),
  8, 'una fila por rol (8 roles) en service_tecnico');

select pg_temp.como('e1000000-0000-0000-0000-000000000001');
select is((select private.puede_accion('service_tecnico', 'ver_comisiones')), true, 'Administrador puede ver_comisiones');
select is((select ver_comisiones from public.permisos_actuales() where seccion = 'service_tecnico'), true, 'permisos_actuales expone ver_comisiones (Administrador)');
select is((select private.puede_accion('ventas', 'ver_comisiones')), false, 'ver_comisiones no aplica fuera de service_tecnico');
select pg_temp.como('e1000000-0000-0000-0000-000000000004');
select is((select private.puede_accion('service_tecnico', 'ver_comisiones')), true, 'Administración (solo lectura en Service) puede ver_comisiones');
select pg_temp.como('e1000000-0000-0000-0000-000000000008');
select is((select private.puede_accion('service_tecnico', 'ver_comisiones')), false, 'el Técnico no puede ver_comisiones');
select is((select ver_comisiones from public.permisos_actuales() where seccion = 'service_tecnico'), false, 'permisos_actuales: Técnico sin ver_comisiones');
select is((select private.puede_accion('service_tecnico', 'ver_costos')), false, 'el Técnico tampoco ve costos');
select pg_temp.como('e1000000-0000-0000-0000-000000000002');
select is((select private.puede_accion('service_tecnico', 'ver_costos')), true, 'Operador ve costos...');
select is((select private.puede_accion('service_tecnico', 'ver_comisiones')), false, '...pero ver_costos NO implica ver_comisiones');
select pg_temp.como('e1000000-0000-0000-0000-000000000003');
select is((select private.puede_accion('service_tecnico', 'ver_comisiones')), true, 'Consulta con ver_comisiones...');
select is((select private.puede_accion('service_tecnico', 'ver_costos')), false, '...no necesita ver_costos: ver_comisiones tampoco depende de él');
select pg_temp.como('e1000000-0000-0000-0000-000000000005');
select is((select private.puede_accion('service_tecnico', 'ver_comisiones')), false, 'Depósito (sin acceso a Service) no puede ver_comisiones');
reset role;

-- Un rol con la acción en true pero sin nivel en la sección no la tiene (la acción exige al menos lectura).
update permisos_rol_accion set permitido = true
 where organizacion_id = '11111111-1111-1111-1111-111111111111' and rol_id = 'deposito'
   and seccion = 'service_tecnico' and accion = 'ver_comisiones';
select pg_temp.como('e1000000-0000-0000-0000-000000000005');
select is((select private.puede_accion('service_tecnico', 'ver_comisiones')), false, 'ver_comisiones en true pero nivel ninguno: sigue en false');
reset role;
update permisos_rol_accion set permitido = false
 where organizacion_id = '11111111-1111-1111-1111-111111111111' and rol_id = 'deposito'
   and seccion = 'service_tecnico' and accion = 'ver_comisiones';

-- ============================================================================
-- Reglas de comisión
-- ============================================================================

-- Las reglas con vigencia pasada no se pueden cargar por la RPC (una regla no reescribe lo entregado): el escenario las
-- siembra como fixture. Precedencia: la regla del técnico gana aunque la general sea MÁS NUEVA (general 5 % desde -29,
-- técnico Uno 15 % desde -30, técnico Dos 10 % desde -31, general vieja 10 % desde -31).
reset role;
insert into dominio.comision_reglas (organizacion_id, tecnico_id, porcentaje, vigente_desde) values
  ('11111111-1111-1111-1111-111111111111', null, 10, (select hoy - 31 from datos)),
  ('11111111-1111-1111-1111-111111111111', 'e1000000-0000-0000-0000-000000000008', 15, (select hoy - 30 from datos)),
  ('11111111-1111-1111-1111-111111111111', 'e1000000-0000-0000-0000-000000000009', 10, (select hoy - 31 from datos)),
  ('11111111-1111-1111-1111-111111111111', null, 5, (select hoy - 29 from datos));

select pg_temp.como('e1000000-0000-0000-0000-000000000001');

select is(
  (select public.guardar_regla_comision('e1000000-0000-0000-0000-000000000008', 20, (select hoy + 5 from datos))->>'vigente_desde'),
  (select (hoy + 5)::text from datos), 'alta de una regla del técnico Uno (20 %) desde dentro de 5 días');
select lives_ok(
  $$select public.guardar_regla_comision(null, 0, (select hoy + 1 from datos))$$,
  'frontera: 0 % y mañana (hoy + 1) son válidos; una regla de 0 % «apaga» la comisión');
select lives_ok(
  $$select public.guardar_regla_comision('e1000000-0000-0000-0000-000000000009', 100, (select hoy + 90 from datos))$$,
  'frontera: 100 % y hoy + 90 días son válidos');

select throws_ok(
  $$select public.guardar_regla_comision(null, 100.01, (select hoy + 3 from datos))$$,
  '22023', 'El porcentaje tiene que estar entre 0 y 100', 'porcentaje 100,01 rechazado');
select throws_ok(
  $$select public.guardar_regla_comision(null, -0.01, (select hoy + 3 from datos))$$,
  '22023', 'El porcentaje tiene que estar entre 0 y 100', 'porcentaje negativo rechazado');
select throws_ok(
  $$select public.guardar_regla_comision(null, null, (select hoy + 3 from datos))$$,
  '22023', 'El porcentaje tiene que estar entre 0 y 100', 'porcentaje nulo rechazado');
select throws_ok(
  $$select public.guardar_regla_comision(null, 12.345, (select hoy + 3 from datos))$$,
  '22023', 'El porcentaje admite hasta dos decimales', 'más de dos decimales rechazado');
select throws_ok(
  $$select public.guardar_regla_comision(null, 5, (select hoy from datos))$$,
  '22023', 'La vigencia tiene que estar entre mañana y 90 días adelante', 'hoy rechazado: reescribiría las entregas de hoy');
select throws_ok(
  $$select public.guardar_regla_comision(null, 5, (select hoy - 1 from datos))$$,
  '22023', 'La vigencia tiene que estar entre mañana y 90 días adelante', 'ayer rechazado');
select throws_ok(
  $$select public.guardar_regla_comision(null, 5, (select hoy + 91 from datos))$$,
  '22023', 'La vigencia tiene que estar entre mañana y 90 días adelante', 'hoy + 91 días rechazado');
select throws_ok(
  $$select public.guardar_regla_comision(null, 5, null)$$,
  '22023', 'La vigencia tiene que estar entre mañana y 90 días adelante', 'vigencia nula rechazada');
select throws_ok(
  $$select public.guardar_regla_comision('e2000000-0000-0000-0000-000000000008', 5, (select hoy + 3 from datos))$$,
  '22023', 'El técnico no pertenece a la organización', 'un técnico de otra organización se rechaza');
select throws_ok(
  $$select public.guardar_regla_comision(null, 7, (select hoy + 1 from datos))$$,
  '23505', 'Ya hay una regla para ese alcance y esa fecha. Elegí otra fecha.', 'misma regla general y misma fecha: duplicado');
select throws_ok(
  $$select public.guardar_regla_comision('e1000000-0000-0000-0000-000000000008', 7, (select hoy + 5 from datos))$$,
  '23505', 'Ya hay una regla para ese alcance y esa fecha. Elegí otra fecha.', 'misma regla del técnico y misma fecha: duplicado');

select is(
  (select count(*)::int from jsonb_array_elements(public.listar_reglas_comision()) r where r->>'estado' = 'vigente'),
  3, 'listar: vigentes = general (5 %), técnico Uno (15 %) y técnico Dos (10 %); las futuras y la reemplazada no cuentan');
select is(
  (select string_agg(r->>'porcentaje' || ':' || (r->>'estado'), ',' order by r->>'porcentaje', r->>'estado')
     from jsonb_array_elements(public.listar_reglas_comision()) r),
  '0.00:futura,10.00:reemplazada,10.00:vigente,100.00:futura,15.00:vigente,20.00:futura,5.00:vigente',
  'listar: estados vigente, reemplazada (general 10 %) y futura');
select is(
  (select r->>'tecnico' from jsonb_array_elements(public.listar_reglas_comision()) r where r->>'porcentaje' = '15.00'),
  'Tomás Uno', 'listar: nombre del técnico del perfil');
select is(
  (select r->'tecnico' from jsonb_array_elements(public.listar_reglas_comision()) r where r->>'porcentaje' = '5.00'),
  'null'::jsonb, 'listar: la regla general no lleva técnico');

-- La Actividad no recibe el porcentaje ni el técnico de la regla (se lee con otro permiso).
select is(
  (select count(*)::int from registro_actividad where tipo = 'comision.regla_guardada' and detalle = 'Cargó una regla de comisión'),
  3, 'la actividad de las reglas es un evento neutro, sin porcentaje ni técnico');
select is(
  (select count(*)::int from registro_actividad where tipo = 'comision.regla_guardada' and detalle ~ '[0-9%]|Tom'),
  0, 'ningún evento de regla lleva números ni nombres');

-- Permisos de las reglas
select pg_temp.como('e1000000-0000-0000-0000-000000000008');
select throws_ok(
  $$select public.guardar_regla_comision(null, 5, (select hoy from datos))$$,
  '42501', 'Tu rol no puede cargar reglas de comisión', 'el Técnico no carga reglas');
select throws_ok(
  $$select public.listar_reglas_comision()$$,
  '42501', 'Tu rol no puede ver las reglas de comisión', 'el Técnico no lista reglas');
select pg_temp.como('e1000000-0000-0000-0000-000000000002');
select throws_ok(
  $$select public.guardar_regla_comision(null, 5, (select hoy from datos))$$,
  '42501', 'Tu rol no puede cargar reglas de comisión', 'ver_costos sin ver_comisiones no carga reglas');
select pg_temp.como('e1000000-0000-0000-0000-000000000004');
select throws_ok(
  $$select public.guardar_regla_comision(null, 5, (select hoy from datos))$$,
  '42501', 'Tu rol no puede cargar reglas de comisión', 'ver_comisiones con Service en solo lectura no carga reglas (exige edición)');
select is(jsonb_array_length(public.listar_reglas_comision()), 7, 'pero sí las lista (ver_comisiones)');
select pg_temp.como('e1000000-0000-0000-0000-000000000005');
select throws_ok(
  $$select public.listar_reglas_comision()$$,
  '42501', 'Tu rol no puede ver las reglas de comisión', 'Depósito no lista reglas');
select pg_temp.como('e2000000-0000-0000-0000-000000000001');
select is(public.listar_reglas_comision(), '[]'::jsonb, 'la otra organización no ve reglas ajenas');

-- RLS directa
select pg_temp.como('e1000000-0000-0000-0000-000000000001');
select is((select count(*)::int from dominio.comision_reglas), 7, 'RLS: el Administrador ve las reglas de su organización');
select pg_temp.como('e1000000-0000-0000-0000-000000000008');
select is((select count(*)::int from dominio.comision_reglas), 0, 'RLS: el Técnico no lee reglas (sin ver_comisiones)');
select throws_ok(
  $$insert into dominio.comision_reglas (tecnico_id, porcentaje, vigente_desde) values (null, 90, current_date)$$,
  '42501', null, 'sin escritura directa en reglas');
select pg_temp.como('e2000000-0000-0000-0000-000000000001');
select is((select count(*)::int from dominio.comision_reglas), 0, 'RLS: otra organización no ve reglas');
reset role;

-- ============================================================================
-- Armado de reparaciones reales
-- ============================================================================

select pg_temp.como('e1000000-0000-0000-0000-000000000001');

-- R1: técnico Uno; MO 10.000 + 5.000 y un repuesto de 20.000 (no cuenta). Reparto por defecto.
insert into reps select 'r1', (public.crear_reparacion(p_empresa_id => 'a1000000-0000-0000-0000-000000000001',
  p_cliente_id => 'c5000000-0000-0000-0000-000000000001', p_modelo_id => (select modelo_uno from datos),
  p_tecnico_id => 'e1000000-0000-0000-0000-000000000008')->>'id')::uuid;
select public.agregar_item_reparacion((select id from reps where clave = 'r1'), 'mano_obra', 'Cambio de pantalla', null, 1, 10000);
select public.agregar_item_reparacion((select id from reps where clave = 'r1'), 'mano_obra', 'Limpieza', null, 1, 5000);
select public.agregar_item_reparacion((select id from reps where clave = 'r1'), 'repuesto', 'Pantalla libre', null, 1, 20000);

-- R2: técnico Dos; MO 20.000.
insert into reps select 'r2', (public.crear_reparacion(p_empresa_id => 'a1000000-0000-0000-0000-000000000001',
  p_cliente_id => 'c5000000-0000-0000-0000-000000000001', p_modelo_id => (select modelo_uno from datos),
  p_tecnico_id => 'e1000000-0000-0000-0000-000000000009')->>'id')::uuid;
select public.agregar_item_reparacion((select id from reps where clave = 'r2'), 'mano_obra', 'Reballing', null, 1, 20000);

-- R3: técnico Uno; MO 10.000; reparto 60/40 con el técnico Dos.
insert into reps select 'r3', (public.crear_reparacion(p_empresa_id => 'a1000000-0000-0000-0000-000000000001',
  p_cliente_id => 'c5000000-0000-0000-0000-000000000001', p_modelo_id => (select modelo_uno from datos),
  p_tecnico_id => 'e1000000-0000-0000-0000-000000000008')->>'id')::uuid;
select public.agregar_item_reparacion((select id from reps where clave = 'r3'), 'mano_obra', 'Cambio de joystick', null, 1, 10000);

-- R4 sin técnico; R5 (se anula); R6 sin entrega; R7 en otra tienda; R8 y R9 con entrega antigua.
insert into reps select 'r4', (public.crear_reparacion(p_empresa_id => 'a1000000-0000-0000-0000-000000000001',
  p_cliente_id => 'c5000000-0000-0000-0000-000000000001', p_modelo_id => (select modelo_uno from datos))->>'id')::uuid;
select public.agregar_item_reparacion((select id from reps where clave = 'r4'), 'mano_obra', 'Sin técnico', null, 1, 1000);
insert into reps select 'r5', (public.crear_reparacion(p_empresa_id => 'a1000000-0000-0000-0000-000000000001',
  p_cliente_id => 'c5000000-0000-0000-0000-000000000001', p_modelo_id => (select modelo_uno from datos),
  p_tecnico_id => 'e1000000-0000-0000-0000-000000000008')->>'id')::uuid;
select public.agregar_item_reparacion((select id from reps where clave = 'r5'), 'mano_obra', 'Anulada', null, 1, 1000);
insert into reps select 'r6', (public.crear_reparacion(p_empresa_id => 'a1000000-0000-0000-0000-000000000001',
  p_cliente_id => 'c5000000-0000-0000-0000-000000000001', p_modelo_id => (select modelo_uno from datos),
  p_tecnico_id => 'e1000000-0000-0000-0000-000000000008')->>'id')::uuid;
select public.agregar_item_reparacion((select id from reps where clave = 'r6'), 'mano_obra', 'Sin entregar', null, 1, 1000);
insert into reps select 'r7', (public.crear_reparacion(p_empresa_id => 'a1000000-0000-0000-0000-000000000002',
  p_cliente_id => 'c5000000-0000-0000-0000-000000000001', p_modelo_id => (select modelo_uno from datos),
  p_tecnico_id => 'e1000000-0000-0000-0000-000000000008')->>'id')::uuid;
select public.agregar_item_reparacion((select id from reps where clave = 'r7'), 'mano_obra', 'Otra tienda', null, 1, 2000);
insert into reps select 'r8', (public.crear_reparacion(p_empresa_id => 'a1000000-0000-0000-0000-000000000001',
  p_cliente_id => 'c5000000-0000-0000-0000-000000000001', p_modelo_id => (select modelo_uno from datos),
  p_tecnico_id => 'e1000000-0000-0000-0000-000000000008')->>'id')::uuid;
select public.agregar_item_reparacion((select id from reps where clave = 'r8'), 'mano_obra', 'Antes de toda regla', null, 1, 10000);
insert into reps select 'r9', (public.crear_reparacion(p_empresa_id => 'a1000000-0000-0000-0000-000000000001',
  p_cliente_id => 'c5000000-0000-0000-0000-000000000001', p_modelo_id => (select modelo_uno from datos),
  p_tecnico_id => 'e1000000-0000-0000-0000-000000000008')->>'id')::uuid;
select public.agregar_item_reparacion((select id from reps where clave = 'r9'), 'mano_obra', 'Regla general vigente', null, 1, 10000);

-- ============================================================================
-- Reparto (MSF-953): lectura, validaciones y permisos ANTES de entregar
-- ============================================================================

select is(
  public.obtener_reparto_comision((select id from reps where clave = 'r1'))->'reparto',
  '[{"tecnico_id": "e1000000-0000-0000-0000-000000000008", "nombre": "Tomás Uno", "porcentaje": 100}]'::jsonb,
  'sin reparto guardado: 100 % al técnico asignado');
select is(
  (select array(select jsonb_object_keys(public.obtener_reparto_comision((select id from reps where clave = 'r1'))) order by 1)),
  array['anulada', 'congelado', 'por_defecto', 'puede_editar', 'reparacion_id', 'reparto'],
  'claves exactas de obtener_reparto_comision (sin importes)');
select is(public.obtener_reparto_comision((select id from reps where clave = 'r1'))->>'por_defecto', 'true', 'por_defecto = true');
select is(public.obtener_reparto_comision((select id from reps where clave = 'r1'))->>'congelado', 'false', 'antes de entregar no está congelado');
select is(public.obtener_reparto_comision((select id from reps where clave = 'r4'))->'reparto', '[]'::jsonb, 'sin técnico asignado: reparto vacío');

select throws_ok(
  $$select public.guardar_reparto_comision((select id from reps where clave = 'r3'),
    '[{"tecnico_id":"e1000000-0000-0000-0000-000000000008","porcentaje":60},{"tecnico_id":"e1000000-0000-0000-0000-000000000009","porcentaje":39.99}]')$$,
  '22023', 'Los porcentajes del reparto tienen que sumar 100 %', 'suma 99,99: rechazada');
select throws_ok(
  $$select public.guardar_reparto_comision((select id from reps where clave = 'r3'),
    '[{"tecnico_id":"e1000000-0000-0000-0000-000000000008","porcentaje":60},{"tecnico_id":"e1000000-0000-0000-0000-000000000009","porcentaje":40.01}]')$$,
  '22023', 'Los porcentajes del reparto tienen que sumar 100 %', 'suma 100,01: rechazada');
select throws_ok(
  $$select public.guardar_reparto_comision((select id from reps where clave = 'r3'),
    '[{"tecnico_id":"e1000000-0000-0000-0000-000000000008","porcentaje":50},{"tecnico_id":"e1000000-0000-0000-0000-000000000008","porcentaje":50}]')$$,
  '22023', 'Un técnico no puede repetirse en el reparto', 'técnico repetido: rechazado');
select throws_ok(
  $$select public.guardar_reparto_comision((select id from reps where clave = 'r3'),
    '[{"tecnico_id":"e1000000-0000-0000-0000-000000000008","porcentaje":0},{"tecnico_id":"e1000000-0000-0000-0000-000000000009","porcentaje":100}]')$$,
  '22023', 'Cada porcentaje tiene que ser mayor que 0, hasta 100 y con dos decimales como máximo', 'porcentaje 0: rechazado');
select throws_ok(
  $$select public.guardar_reparto_comision((select id from reps where clave = 'r3'),
    '[{"tecnico_id":"e1000000-0000-0000-0000-000000000008","porcentaje":100.5}]')$$,
  '22023', 'Cada porcentaje tiene que ser mayor que 0, hasta 100 y con dos decimales como máximo', 'porcentaje 100,5: rechazado');
select throws_ok(
  $$select public.guardar_reparto_comision((select id from reps where clave = 'r3'),
    '[{"tecnico_id":"e1000000-0000-0000-0000-000000000008","porcentaje":33.333},{"tecnico_id":"e1000000-0000-0000-0000-000000000009","porcentaje":66.667}]')$$,
  '22023', 'Cada porcentaje tiene que ser mayor que 0, hasta 100 y con dos decimales como máximo', 'tres decimales: rechazado');
select throws_ok(
  $$select public.guardar_reparto_comision((select id from reps where clave = 'r3'),
    '[{"tecnico_id":"e2000000-0000-0000-0000-000000000008","porcentaje":100}]')$$,
  '22023', 'El técnico no pertenece a la organización', 'un técnico de otra organización: rechazado');
select throws_ok(
  $$select public.guardar_reparto_comision((select id from reps where clave = 'r3'), '[{"tecnico_id":"no-es-un-uuid","porcentaje":100}]')$$,
  '22023', 'Cada línea del reparto lleva un técnico y un porcentaje', 'tecnico_id que no es un uuid: rechazado sin error de conversión');
select throws_ok(
  $$select public.guardar_reparto_comision((select id from reps where clave = 'r3'), '[{"tecnico_id":"e1000000-0000-0000-0000-000000000008","porcentaje":"100"}]')$$,
  '22023', 'Cada línea del reparto lleva un técnico y un porcentaje', 'porcentaje como texto: rechazado');
select throws_ok(
  $$select public.guardar_reparto_comision((select id from reps where clave = 'r3'), '{"a":1}')$$,
  '22023', 'El reparto tiene que ser una lista de técnicos con su porcentaje', 'no es una lista: rechazado');
select throws_ok(
  $$select public.guardar_reparto_comision((select id from reps where clave = 'r3'), null)$$,
  '22023', 'El reparto tiene que ser una lista de técnicos con su porcentaje', 'nulo: rechazado');
select throws_ok(
  $$select public.guardar_reparto_comision((select id from reps where clave = 'r3'),
    (select jsonb_agg(jsonb_build_object('tecnico_id', 'e1000000-0000-0000-0000-000000000008', 'porcentaje', 9)) from generate_series(1, 11)))$$,
  '22023', 'El reparto admite hasta 10 técnicos', 'frontera: 11 líneas rechazadas');

-- Frontera válida: 2 decimales y suma exacta 100 con tres técnicos; luego el reparto del escenario (60/40).
select lives_ok(
  $$select public.guardar_reparto_comision((select id from reps where clave = 'r3'),
    '[{"tecnico_id":"e1000000-0000-0000-0000-000000000008","porcentaje":33.33},{"tecnico_id":"e1000000-0000-0000-0000-000000000009","porcentaje":33.33},{"tecnico_id":"e1000000-0000-0000-0000-000000000001","porcentaje":33.34}]')$$,
  'tres técnicos con 33,33 + 33,33 + 33,34 = 100 es válido');

-- El Técnico (edición, sin ver_comisiones) puede repartir ANTES de entregar.
select pg_temp.como('e1000000-0000-0000-0000-000000000008');
select is(
  public.guardar_reparto_comision((select id from reps where clave = 'r3'),
    '[{"tecnico_id":"e1000000-0000-0000-0000-000000000008","porcentaje":60},{"tecnico_id":"e1000000-0000-0000-0000-000000000009","porcentaje":40}]')->'reparto',
  '[{"tecnico_id": "e1000000-0000-0000-0000-000000000008", "nombre": "Tomás Uno", "porcentaje": 60.00},
    {"tecnico_id": "e1000000-0000-0000-0000-000000000009", "nombre": "Tamara Dos", "porcentaje": 40.00}]'::jsonb,
  'antes de entregar alcanza con edición: queda 60/40');
select is(
  (select count(*)::int from dominio.reparacion_comision_reparto where reparacion_id = (select id from reps where clave = 'r3')),
  2, 'el reemplazo no deja filas de más (2 filas)');
select is(
  public.obtener_reparto_comision((select id from reps where clave = 'r3'))->>'por_defecto', 'false', 'con reparto guardado: por_defecto = false');
select is(
  public.guardar_reparto_comision((select id from reps where clave = 'r5'),
    '[{"tecnico_id":"e1000000-0000-0000-0000-000000000009","porcentaje":100}]')->'reparto'->0->>'nombre',
  'Tamara Dos', 'se reparte el 100 % a otro técnico antes de entregar');
select is(
  public.guardar_reparto_comision((select id from reps where clave = 'r5'), '[]', 'Motivo que antes de entregar no se guarda')->>'por_defecto',
  'true', 'lista vacía antes de entregar: vuelve al reparto por defecto');

-- Permisos del reparto
select pg_temp.como('e1000000-0000-0000-0000-000000000003');
select throws_ok(
  $$select public.guardar_reparto_comision((select id from reps where clave = 'r3'), '[]')$$,
  '42501', 'Tu rol no puede cambiar el reparto de comisión', 'Consulta (solo lectura) no cambia el reparto');
select is(
  public.obtener_reparto_comision((select id from reps where clave = 'r3'))->>'puede_editar', 'false', 'Consulta ve el reparto sin poder editarlo');
select pg_temp.como('e1000000-0000-0000-0000-000000000005');
select throws_ok(
  $$select public.obtener_reparto_comision((select id from reps where clave = 'r3'))$$,
  '42501', 'Tu rol no puede ver el reparto de comisión', 'Depósito no ve el reparto');
select pg_temp.como('e2000000-0000-0000-0000-000000000001');
select throws_ok(
  $$select public.obtener_reparto_comision((select id from reps where clave = 'r3'))$$,
  'PT404', 'La reparación no existe', 'otra organización: PT404 sin revelar la existencia');
select throws_ok(
  $$select public.guardar_reparto_comision((select id from reps where clave = 'r3'), '[]')$$,
  'PT404', 'La reparación no existe', 'otra organización no cambia el reparto');
select pg_temp.como('e1000000-0000-0000-0000-000000000001');
select throws_ok(
  $$select public.obtener_reparto_comision('00000000-0000-0000-0000-00000000dead')$$,
  'PT404', 'La reparación no existe', 'reparación inexistente: PT404');

-- ============================================================================
-- Entrega: el reparto se congela
-- ============================================================================

select public.registrar_entrega_reparacion((select id from reps where clave = r.clave), (select cierra_uno from datos), (select hoy from datos), 'Cliente')
  from (values ('r1'), ('r2'), ('r3'), ('r4'), ('r5'), ('r7'), ('r8'), ('r9')) r(clave);

select is(
  (select porcentaje::text || '@' || tecnico_id::text from dominio.reparacion_comision_reparto
    where reparacion_id = (select id from reps where clave = 'r1')),
  '100.00@e1000000-0000-0000-0000-000000000008', 'al entregar se congela el reparto por defecto (100 % al técnico asignado)');
select is(
  (select count(*)::int from dominio.reparacion_comision_reparto where reparacion_id = (select id from reps where clave = 'r3')),
  2, 'un reparto personalizado queda como estaba (no se duplica)');
select is(
  (select count(*)::int from dominio.reparacion_comision_reparto where reparacion_id = (select id from reps where clave = 'r4')),
  0, 'sin técnico asignado no hay nada que congelar');
select is(
  (select count(*)::int from dominio.reparacion_comision_reparto where reparacion_id = (select id from reps where clave = 'r6')),
  0, 'sin entrega no hay reparto guardado');
select is(public.obtener_reparto_comision((select id from reps where clave = 'r1'))->>'congelado', 'true', 'obtener: congelado = true');

-- Escenario: fechas de entrega, anulada y cambio de técnico asignado posterior a la entrega.
reset role;
update dominio.reparaciones set entrega_real = (select hoy - 40 from datos) where id = (select id from reps where clave = 'r8');
update dominio.reparaciones set entrega_real = (select hoy - 31 from datos) where id = (select id from reps where clave = 'r9');
update dominio.reparaciones set anulada_en = now(), anulada_motivo = 'Prueba' where id = (select id from reps where clave = 'r5');
-- Reasignar el técnico de R1 DESPUÉS de entregar no mueve la comisión: el reparto está congelado.
update dominio.reparaciones set tecnico_id = 'e1000000-0000-0000-0000-000000000009' where id = (select id from reps where clave = 'r1');

-- ============================================================================
-- «Mis comisiones» (MSF-954)
-- ============================================================================

select pg_temp.como('e1000000-0000-0000-0000-000000000008');

-- Período hoy-30 .. hoy. Técnico Uno: R1 15.000 × 15 % = 2.250; R3 10.000 × 15 % × 60 % = 900; R7 2.000 × 15 % = 300.
select is(
  (select (public.mis_comisiones((select hoy - 30 from datos), (select hoy from datos))->>'total')::numeric),
  3450::numeric, 'Mis comisiones: total del técnico Uno = 2.250 + 900 + 300');
select is(
  (select (public.mis_comisiones((select hoy - 30 from datos), (select hoy from datos))->>'reparaciones')::int),
  3, 'tres reparaciones (anulada, sin entrega y sin técnico no cuentan)');
select is(
  (select sum((f->>'comision')::numeric) from jsonb_array_elements(
     public.mis_comisiones((select hoy - 30 from datos), (select hoy from datos))->'filas') f),
  3450::numeric, 'la suma del detalle es el total');
select is(
  (select f->>'comision' from jsonb_array_elements(
     public.mis_comisiones((select hoy - 30 from datos), (select hoy from datos))->'filas') f
    where f->>'reparacion_id' = (select id::text from reps where clave = 'r1')),
  '2250.00', 'R1: base 15.000 (solo mano de obra) al 15 % = 2.250 aunque el técnico asignado hoy sea otro (reparto congelado)');
select is(
  (select f->>'porcentaje_reparto' from jsonb_array_elements(
     public.mis_comisiones((select hoy - 30 from datos), (select hoy from datos))->'filas') f
    where f->>'reparacion_id' = (select id::text from reps where clave = 'r3')),
  '60.00', 'R3: su parte del reparto es 60 %');
select is(
  (select f->>'comision' from jsonb_array_elements(
     public.mis_comisiones((select hoy - 30 from datos), (select hoy from datos))->'filas') f
    where f->>'reparacion_id' = (select id::text from reps where clave = 'r3')),
  '900.00', 'R3: 10.000 × 15 % × 60 % = 900');
select is(
  (select array(select jsonb_object_keys(public.mis_comisiones((select hoy - 30 from datos), (select hoy from datos))) order by 1)),
  array['desde', 'filas', 'hasta', 'reparaciones', 'sin_regla', 'total', 'truncado'],
  'claves exactas de Mis comisiones');
select is(
  (select array(select k from jsonb_object_keys(
     public.mis_comisiones((select hoy - 30 from datos), (select hoy from datos))->'filas'->0) k order by k)),
  array['base', 'codigo', 'comision', 'empresa', 'entrega_real', 'equipo', 'porcentaje_regla', 'porcentaje_reparto', 'reparacion_id'],
  'cada fila: sin costos, sin márgenes, sin cliente, sin otros técnicos');
select is(
  (select count(*)::int from jsonb_array_elements(
     public.mis_comisiones((select hoy - 30 from datos), (select hoy from datos))->'filas') f
    where f->>'reparacion_id' in (select id::text from reps where clave in ('r2', 'r4', 'r5', 'r6'))),
  0, 'no aparecen las reparaciones de otros, sin técnico, anuladas ni sin entregar');
select is(
  (select (public.mis_comisiones((select hoy - 45 from datos), (select hoy - 35 from datos))->>'sin_regla')::int),
  1, 'antes de toda regla vigente: la reparación cuenta como «sin regla» con comisión 0');
select is(
  (select (public.mis_comisiones((select hoy - 45 from datos), (select hoy - 35 from datos))->>'total')::numeric),
  0::numeric, '...y su comisión es 0');
-- R9 entregada hoy-31: la regla del técnico (desde hoy-30) todavía no rige, rige la general del 10 %.
select is(
  (select (public.mis_comisiones((select hoy - 31 from datos), (select hoy - 31 from datos))->>'total')::numeric),
  1000::numeric, 'vigencia por fecha de entrega: el día -31 rige la regla general (10 %) y no la del técnico (desde -30)');
select is(
  (select (public.mis_comisiones((select hoy - 30 from datos), (select hoy - 30 from datos))->>'reparaciones')::int),
  0, 'frontera inferior inclusiva: el día -31 queda fuera de -30..-30');

-- Fronteras del período: 366 días sí, 367 no
select lives_ok(
  $$select public.mis_comisiones((select hoy - 365 from datos), (select hoy from datos))$$, '366 días: válido');
select throws_ok(
  $$select public.mis_comisiones((select hoy - 366 from datos), (select hoy from datos))$$,
  '22023', 'El período no puede superar 366 días', '367 días: rechazado');
select throws_ok(
  $$select public.mis_comisiones((select hoy from datos), (select hoy - 1 from datos))$$,
  '22023', 'La fecha desde no puede ser posterior a la fecha hasta', 'desde posterior a hasta: rechazado');
select throws_ok(
  $$select public.mis_comisiones(null, (select hoy from datos))$$,
  '22023', 'Indicá desde qué fecha', 'desde nulo: rechazado');
select throws_ok(
  $$select public.mis_comisiones((select hoy from datos), null)$$,
  '22023', 'Indicá hasta qué fecha', 'hasta nulo: rechazado');

-- Técnico Dos: ve solo lo suyo (R2 20.000 × 10 % = 2.000 y su 40 % de R3: 10.000 × 10 % × 40 % = 400).
select pg_temp.como('e1000000-0000-0000-0000-000000000009');
select is(
  (select (public.mis_comisiones((select hoy - 30 from datos), (select hoy from datos))->>'total')::numeric),
  2400::numeric, 'el técnico Dos ve 2.000 + 400, nada del técnico Uno');
select is(
  (select count(*)::int from jsonb_array_elements(
     public.mis_comisiones((select hoy - 30 from datos), (select hoy from datos))->'filas') f
    where f->>'reparacion_id' = (select id::text from reps where clave = 'r1')),
  0, 'la R1 que se le reasignó DESPUÉS de entregar no es suya: el reparto estaba congelado');

-- Sin acceso a Service o sin sesión
select pg_temp.como('e1000000-0000-0000-0000-000000000005');
select throws_ok(
  $$select public.mis_comisiones((select hoy - 30 from datos), (select hoy from datos))$$,
  '42501', 'Tu rol no puede ver comisiones', 'Depósito (sin Service) no ve Mis comisiones');
select pg_temp.como('e2000000-0000-0000-0000-000000000008');
select is(
  (select (public.mis_comisiones((select hoy - 30 from datos), (select hoy from datos))->>'reparaciones')::int),
  0, 'un técnico de otra organización no ve las reparaciones de ésta');
reset role;
select is(
  (select count(*)::int from pg_proc where proname = 'mis_comisiones' and pronargs = 2),
  1, 'mis_comisiones no recibe el usuario: solo dos fechas (el usuario sale del JWT)');

-- ============================================================================
-- Resumen del equipo (MSF-957) y detalle por técnico
-- ============================================================================

select pg_temp.como('e1000000-0000-0000-0000-000000000001');
select is(
  (select (public.comisiones_resumen((select hoy - 30 from datos), (select hoy from datos))->>'total')::numeric),
  5850::numeric, 'resumen: total del equipo = 3.450 + 2.400');
select is(
  (select (t->>'comision')::numeric from jsonb_array_elements(
     public.comisiones_resumen((select hoy - 30 from datos), (select hoy from datos))->'tecnicos') t
    where t->>'tecnico_id' = 'e1000000-0000-0000-0000-000000000008'),
  3450::numeric, 'resumen: técnico Uno 3.450');
select is(
  (select (t->>'base')::numeric from jsonb_array_elements(
     public.comisiones_resumen((select hoy - 30 from datos), (select hoy from datos))->'tecnicos') t
    where t->>'tecnico_id' = 'e1000000-0000-0000-0000-000000000009'),
  24000::numeric, 'resumen: base atribuida del técnico Dos = 20.000 + 40 % de 10.000');
select is(
  (select t->>'nombre' from jsonb_array_elements(
     public.comisiones_resumen((select hoy - 30 from datos), (select hoy from datos))->'tecnicos') t
    where t->>'tecnico_id' = 'e1000000-0000-0000-0000-000000000009'),
  'Tamara Dos', 'resumen: el nombre sale del perfil, no del correo');
select is(
  (select array(select jsonb_object_keys(public.comisiones_resumen((select hoy - 30 from datos), (select hoy from datos))) order by 1)),
  array['desde', 'hasta', 'reparaciones', 'sin_regla', 'tecnicos', 'total'], 'claves exactas del resumen');
select is(
  (select (public.comisiones_resumen((select hoy - 30 from datos), (select hoy from datos))->'tecnicos'->0->>'tecnico_id')),
  'e1000000-0000-0000-0000-000000000008', 'orden: mayor comisión primero');
-- Resumen = suma del detalle, para cada técnico
select is(
  (select (public.comisiones_de_tecnico('e1000000-0000-0000-0000-000000000008', (select hoy - 30 from datos), (select hoy from datos))->>'total')::numeric),
  3450::numeric, 'el detalle del técnico Uno suma lo mismo que su fila del resumen');
select is(
  (select (public.comisiones_de_tecnico('e1000000-0000-0000-0000-000000000009', (select hoy - 30 from datos), (select hoy from datos))->>'total')::numeric),
  2400::numeric, 'el detalle del técnico Dos suma lo mismo que su fila del resumen');
select is(
  (select jsonb_array_length(public.comisiones_de_tecnico('e1000000-0000-0000-0000-000000000009', (select hoy - 30 from datos), (select hoy from datos))->'filas')),
  2, 'detalle del técnico Dos: dos filas');
select throws_ok(
  $$select public.comisiones_de_tecnico(null, (select hoy - 30 from datos), (select hoy from datos))$$,
  '22023', 'Elegí un técnico', 'detalle sin técnico: rechazado');
select is(
  (select (public.comisiones_de_tecnico('e2000000-0000-0000-0000-000000000008', (select hoy - 30 from datos), (select hoy from datos))->>'reparaciones')::int),
  0, 'un técnico de otra organización devuelve vacío, sin distinguir');

-- Tiendas accesibles: Administración solo accede a San Javucho (sin R7 de Mundo JC: 300).
select pg_temp.como('e1000000-0000-0000-0000-000000000004');
select is(
  (select (public.comisiones_resumen((select hoy - 30 from datos), (select hoy from datos))->>'total')::numeric),
  5550::numeric, 'Administración (solo San Javucho): el resumen excluye la otra tienda');
select is(
  (select (public.comisiones_de_tecnico('e1000000-0000-0000-0000-000000000008', (select hoy - 30 from datos), (select hoy from datos))->>'total')::numeric),
  3150::numeric, 'y el detalle también, igual que su fila del resumen');

-- Quién puede y quién no
select pg_temp.como('e1000000-0000-0000-0000-000000000003');
select is(
  (select (public.comisiones_resumen((select hoy - 30 from datos), (select hoy from datos))->>'total')::numeric),
  5550::numeric, 'Consulta con ver_comisiones y SIN ver_costos ve el resumen (solo su tienda, como Administración)');
select pg_temp.como('e1000000-0000-0000-0000-000000000002');
select throws_ok(
  $$select public.comisiones_resumen((select hoy - 30 from datos), (select hoy from datos))$$,
  '42501', 'Tu rol no puede ver las comisiones del equipo', 'Operador con ver_costos y SIN ver_comisiones no ve el resumen');
select throws_ok(
  $$select public.comisiones_de_tecnico('e1000000-0000-0000-0000-000000000008', (select hoy - 30 from datos), (select hoy from datos))$$,
  '42501', 'Tu rol no puede ver las comisiones del equipo', 'ni el detalle de otro técnico');
select pg_temp.como('e1000000-0000-0000-0000-000000000008');
select throws_ok(
  $$select public.comisiones_resumen((select hoy - 30 from datos), (select hoy from datos))$$,
  '42501', 'Tu rol no puede ver las comisiones del equipo', 'el Técnico no ve el resumen del equipo');
select throws_ok(
  $$select public.comisiones_de_tecnico('e1000000-0000-0000-0000-000000000009', (select hoy - 30 from datos), (select hoy from datos))$$,
  '42501', 'Tu rol no puede ver las comisiones del equipo', 'el Técnico no ve el detalle de otro técnico');
select pg_temp.como('e2000000-0000-0000-0000-000000000001');
select is(
  (select (public.comisiones_resumen((select hoy - 30 from datos), (select hoy from datos))->>'total')::numeric),
  0::numeric, 'otra organización: resumen en cero');
select is(
  public.comisiones_resumen((select hoy - 30 from datos), (select hoy from datos))->'tecnicos', '[]'::jsonb,
  'otra organización: sin técnicos');
select throws_ok(
  $$select public.comisiones_resumen((select hoy - 400 from datos), (select hoy from datos))$$,
  '22023', 'El período no puede superar 366 días', 'resumen: período de más de 366 días rechazado');

-- ============================================================================
-- Cambio del reparto DESPUÉS de entregar: permiso + motivo + registro
-- ============================================================================

select pg_temp.como('e1000000-0000-0000-0000-000000000008');
select throws_ok(
  $$select public.guardar_reparto_comision((select id from reps where clave = 'r3'),
    '[{"tecnico_id":"e1000000-0000-0000-0000-000000000008","porcentaje":100}]', 'Me corresponde todo')$$,
  '42501', 'La reparación ya fue entregada: solo quien ve comisiones puede cambiar el reparto',
  'entregada: el Técnico (edición, sin ver_comisiones) no puede cambiarlo');
select is(
  public.obtener_reparto_comision((select id from reps where clave = 'r3'))->>'puede_editar', 'false', 'entregada: el Técnico lo ve pero no puede editarlo');
select pg_temp.como('e1000000-0000-0000-0000-000000000002');
select throws_ok(
  $$select public.guardar_reparto_comision((select id from reps where clave = 'r3'),
    '[{"tecnico_id":"e1000000-0000-0000-0000-000000000008","porcentaje":100}]', 'Ajuste')$$,
  '42501', 'La reparación ya fue entregada: solo quien ve comisiones puede cambiar el reparto',
  'entregada: ver_costos sin ver_comisiones tampoco');
select pg_temp.como('e1000000-0000-0000-0000-000000000004');
select throws_ok(
  $$select public.guardar_reparto_comision((select id from reps where clave = 'r3'),
    '[{"tecnico_id":"e1000000-0000-0000-0000-000000000008","porcentaje":100}]', 'Ajuste')$$,
  '42501', 'Tu rol no puede cambiar el reparto de comisión', 'ver_comisiones con Service en solo lectura: tampoco (exige edición)');

select pg_temp.como('e1000000-0000-0000-0000-000000000001');
select is(public.obtener_reparto_comision((select id from reps where clave = 'r3'))->>'puede_editar', 'true', 'entregada: el Administrador puede editarlo');
select throws_ok(
  $$select public.guardar_reparto_comision((select id from reps where clave = 'r3'),
    '[{"tecnico_id":"e1000000-0000-0000-0000-000000000008","porcentaje":100}]')$$,
  '22023', 'Indicá el motivo del cambio (entre 3 y 500 caracteres)', 'entregada: sin motivo se rechaza');
select throws_ok(
  $$select public.guardar_reparto_comision((select id from reps where clave = 'r3'),
    '[{"tecnico_id":"e1000000-0000-0000-0000-000000000008","porcentaje":100}]', '  ab ')$$,
  '22023', 'Indicá el motivo del cambio (entre 3 y 500 caracteres)', 'entregada: motivo de 2 caracteres (frontera 3) se rechaza');
select throws_ok(
  $$select public.guardar_reparto_comision((select id from reps where clave = 'r3'),
    '[{"tecnico_id":"e1000000-0000-0000-0000-000000000008","porcentaje":100}]', repeat('x', 501))$$,
  '22023', 'Indicá el motivo del cambio (entre 3 y 500 caracteres)', 'entregada: motivo de 501 caracteres (frontera 500) se rechaza');
select throws_ok(
  $$select public.guardar_reparto_comision((select id from reps where clave = 'r3'), '[]', 'Quitar el reparto')$$,
  '22023', 'Una reparación entregada necesita un reparto que sume 100 %', 'entregada: no se puede dejar sin reparto');
select throws_ok(
  $$select public.guardar_reparto_comision((select id from reps where clave = 'r3'),
    '[{"tecnico_id":"e1000000-0000-0000-0000-000000000008","porcentaje":70},{"tecnico_id":"e1000000-0000-0000-0000-000000000009","porcentaje":20}]', 'Corrección')$$,
  '22023', 'Los porcentajes del reparto tienen que sumar 100 %', 'entregada: la suma también se valida');
select is(
  (select count(*)::int from registro_actividad where tipo = 'comision.reparto_cambiado'),
  4, 'hasta acá hay 4 cambios aceptados antes de entregar (3 técnicos y 60/40 en R3, dos en R5); los rechazados no registran nada');
select lives_ok(
  $$select public.guardar_reparto_comision((select id from reps where clave = 'r3'),
    '[{"tecnico_id":"e1000000-0000-0000-0000-000000000008","porcentaje":70},{"tecnico_id":"e1000000-0000-0000-0000-000000000009","porcentaje":30}]', 'Corrección acordada con el taller')$$,
  'entregada: con ver_comisiones, motivo y suma 100 se permite');
-- Antes/después, nombres, porcentajes y motivo van al historial propio (solo con ver_comisiones); la Actividad, que se lee con otro
-- permiso, recibe un evento neutro sin nombres, porcentajes ni motivo.
select is(
  (select detalle from registro_actividad where tipo = 'comision.reparto_cambiado' and detalle not like '%Corrección%'
     and detalle like '%R-' || lpad((select numero::text from dominio.reparaciones where id = (select id from reps where clave = 'r3')), 4, '0') limit 1),
  'Cambió el reparto de comisión de R-' || lpad((select numero::text from dominio.reparaciones where id = (select id from reps where clave = 'r3')), 4, '0'),
  'la actividad solo dice qué reparación cambió');
select is(
  (select count(*)::int from registro_actividad where tipo = 'comision.reparto_cambiado'
     and (detalle ~ '[%]|Tom|Tam|Corrección' or valor_anterior is not null or valor_nuevo is not null)),
  0, 'ningún evento de reparto lleva nombres, porcentajes, motivo ni valores anterior y nuevo');
select is(
  (select motivo from dominio.reparacion_comision_historial where entregada),
  'Corrección acordada con el taller', 'el historial guarda el motivo');
select is(
  (select antes from dominio.reparacion_comision_historial where entregada),
  '[{"tecnico": "Tomás Uno", "porcentaje": 60.00}, {"tecnico": "Tamara Dos", "porcentaje": 40.00}]'::jsonb,
  'el historial guarda el reparto anterior');
select is(
  (select despues from dominio.reparacion_comision_historial where entregada),
  '[{"tecnico": "Tomás Uno", "porcentaje": 70}, {"tecnico": "Tamara Dos", "porcentaje": 30}]'::jsonb,
  'el historial guarda el reparto nuevo');
select is(
  (select usuario_id from dominio.reparacion_comision_historial where entregada),
  'e1000000-0000-0000-0000-000000000001'::uuid, 'el historial guarda quién lo cambió');
select is(
  (select count(*)::int from dominio.reparacion_comision_historial where not entregada and motivo is not null),
  0, 'antes de entregar el motivo no se guarda');
select is(
  (select count(*)::int from dominio.reparacion_comision_historial where not entregada),
  4, 'los 4 cambios anteriores a la entrega también quedan en el historial (sin motivo)');
select is(
  (select count(*)::int from dominio.reparacion_comision_historial), 5, 'RLS: el Administrador (ver_comisiones) ve el historial');
select pg_temp.como('e1000000-0000-0000-0000-000000000008');
select is((select count(*)::int from dominio.reparacion_comision_historial), 0, 'RLS: el Técnico no lee el historial');
select pg_temp.como('e1000000-0000-0000-0000-000000000002');
select is((select count(*)::int from dominio.reparacion_comision_historial), 0, 'RLS: ver_costos sin ver_comisiones no lee el historial');
select pg_temp.como('e1000000-0000-0000-0000-000000000003');
select is((select count(*)::int from dominio.reparacion_comision_historial), 5, 'RLS: Consulta con ver_comisiones lo lee');
select pg_temp.como('e2000000-0000-0000-0000-000000000001');
select is((select count(*)::int from dominio.reparacion_comision_historial), 0, 'RLS: otra organización no lo lee');
select throws_ok(
  $$insert into dominio.reparacion_comision_historial (reparacion_id, entregada, antes, despues) values (gen_random_uuid(), false, '[]', '[]')$$,
  '42501', null, 'sin escritura directa en el historial');
select pg_temp.como('e1000000-0000-0000-0000-000000000001');
select is(
  (select (public.comisiones_de_tecnico('e1000000-0000-0000-0000-000000000008', (select hoy - 30 from datos), (select hoy from datos))->>'total')::numeric),
  3450::numeric + 150::numeric, 'el cambio posterior recalcula: R3 del técnico Uno pasa de 900 a 1.050 (70 %)');
select is(
  (select (public.comisiones_resumen((select hoy - 30 from datos), (select hoy from datos))->>'total')::numeric),
  5900::numeric, 'el total del equipo pasa de 5.850 a 5.900: R3 de 900 + 400 a 1.050 + 300 (cada técnico tiene su propia regla: 15 % y 10 %)');

-- Anulada: no se cambia.
select throws_ok(
  $$select public.guardar_reparto_comision((select id from reps where clave = 'r5'), '[]')$$,
  '55000', 'La reparación está anulada y no se puede modificar', 'una reparación anulada no admite cambios de reparto');
select is(public.obtener_reparto_comision((select id from reps where clave = 'r5'))->>'puede_editar', 'false', 'anulada: no se ofrece editar');

-- ============================================================================
-- Suma 100 también como garantía de la base (disparador diferido), no solo de la RPC
-- ============================================================================

reset role;
select throws_ok(
  $t$do $b$ begin
      update dominio.reparacion_comision_reparto set porcentaje = 90
       where reparacion_id = (select id from reps where clave = 'r2');
      set constraints all immediate;
    end $b$$t$,
  '22023', 'Los porcentajes del reparto tienen que sumar 100 %', 'el disparador diferido rechaza un reparto que no suma 100');
select throws_ok(
  $$insert into dominio.reparacion_comision_reparto (organizacion_id, reparacion_id, tecnico_id, porcentaje)
    values ('11111111-1111-1111-1111-111111111111', (select id from reps where clave = 'r2'), 'e1000000-0000-0000-0000-000000000001', 0)$$,
  '23514', null, 'un porcentaje 0 no entra (check)');
select throws_ok(
  $$insert into dominio.reparacion_comision_reparto (organizacion_id, reparacion_id, tecnico_id, porcentaje)
    values ('22222222-2222-2222-2222-222222222222', (select id from reps where clave = 'r2'), 'e2000000-0000-0000-0000-000000000008', 100)$$,
  '23503', null, 'no se reparte una reparación de otra organización (FK compuesta)');

-- Baja de un técnico: su parte queda sin técnico y el 100 % del reparto se conserva.
delete from auth.users where id = 'e1000000-0000-0000-0000-000000000009';
select is(
  (select count(*)::int from dominio.reparacion_comision_reparto where reparacion_id = (select id from reps where clave = 'r3') and tecnico_id is null),
  1, 'al borrarse el técnico Dos su fila queda sin técnico (no se pierde el 100 %)');
select pg_temp.como('e1000000-0000-0000-0000-000000000001');
select is(
  (select t->>'nombre' from jsonb_array_elements(
     public.comisiones_resumen((select hoy - 30 from datos), (select hoy from datos))->'tecnicos') t where t->>'tecnico_id' is null),
  'Técnico dado de baja', 'el resumen muestra «Técnico dado de baja» en vez de perder la comisión');
reset role;

-- ============================================================================
-- Tope de 1.000 filas del detalle (`truncado`): fronteras 1.000 / 1.001 con reparaciones reales del técnico Uno
-- ============================================================================

select pg_temp.como('e1000000-0000-0000-0000-000000000001');
create temp table previas as
  select (public.comisiones_de_tecnico('e1000000-0000-0000-0000-000000000008', (select hoy - 30 from datos), (select hoy from datos))->>'reparaciones')::int as n;
grant select on previas to public;
reset role;
insert into dominio.reparaciones (organizacion_id, empresa_id, numero, cliente_id, modelo_id, estado_id, tecnico_id, ingreso_en, entrega_real)
select '11111111-1111-1111-1111-111111111111', 'a1000000-0000-0000-0000-000000000001', 1000 + g,
       'c5000000-0000-0000-0000-000000000001', (select modelo_uno from datos), (select cierra_uno from datos),
       'e1000000-0000-0000-0000-000000000008', (select hoy from datos), (select hoy from datos)
  from generate_series(1, 1000 - (select n from previas)) g;
select pg_temp.como('e1000000-0000-0000-0000-000000000001');
select is(
  (public.comisiones_de_tecnico('e1000000-0000-0000-0000-000000000008', (select hoy - 30 from datos), (select hoy from datos))->>'reparaciones')::int,
  1000, 'frontera: el técnico Uno tiene exactamente 1.000 reparaciones en el período');
select is(
  public.comisiones_de_tecnico('e1000000-0000-0000-0000-000000000008', (select hoy - 30 from datos), (select hoy from datos))->>'truncado',
  'false', 'con 1.000 filas el detalle no está truncado');
reset role;
insert into dominio.reparaciones (organizacion_id, empresa_id, numero, cliente_id, modelo_id, estado_id, tecnico_id, ingreso_en, entrega_real)
values ('11111111-1111-1111-1111-111111111111', 'a1000000-0000-0000-0000-000000000001', 5000,
        'c5000000-0000-0000-0000-000000000001', (select modelo_uno from datos), (select cierra_uno from datos),
        'e1000000-0000-0000-0000-000000000008', (select hoy from datos), (select hoy from datos));
select pg_temp.como('e1000000-0000-0000-0000-000000000001');
select is(
  public.comisiones_de_tecnico('e1000000-0000-0000-0000-000000000008', (select hoy - 30 from datos), (select hoy from datos))->>'truncado',
  'true', 'con 1.001 filas el detalle está truncado');
select is(
  jsonb_array_length(public.comisiones_de_tecnico('e1000000-0000-0000-0000-000000000008', (select hoy - 30 from datos), (select hoy from datos))->'filas'),
  1000, 'y devuelve las 1.000 más recientes');
select is(
  (public.comisiones_de_tecnico('e1000000-0000-0000-0000-000000000008', (select hoy - 30 from datos), (select hoy from datos))->>'reparaciones')::int,
  1001, 'mientras el conteo y el total incluyen todas');
reset role;

select * from finish();
rollback;
