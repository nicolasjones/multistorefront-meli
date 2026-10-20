-- F-SVC-02 (MSF-283, épica MSF-182): alta y edición de reparaciones. Cubre SC-003: aislamiento entre
-- dos organizaciones en `reparaciones` y `reparacion_historial`, numeración correlativa por empresa,
-- cliente / modelo / empresa / técnico ajenos o inactivos rechazados, conflicto de edición, anuladas
-- no editables, máscara de costos por rol, conteos de uso, actividad y `anon` sin ejecución.
-- La concurrencia real no se puede simular en una sola transacción: se prueba la serie sin saltos ni
-- repetidos y que el número se tome bajo `pg_advisory_xact_lock`.
-- Matriz vigente de `service_tecnico`: administrador y operador `edicion`; consulta, mostrador y
-- administración `lectura`; depósito `ninguno`. `ver_costos`: solo administrador y administración.
begin;

select no_plan();

insert into organizaciones (id, nombre) values
  ('11111111-1111-1111-1111-111111111111', 'Organización Uno'),
  ('22222222-2222-2222-2222-222222222222', 'Organización Dos');

insert into auth.users (id, email) values
  ('e1000000-0000-0000-0000-000000000001', 'administrador@example.com'),
  ('e1000000-0000-0000-0000-000000000002', 'operador@example.com'),
  ('e1000000-0000-0000-0000-000000000003', 'consulta@example.com'),
  ('e1000000-0000-0000-0000-000000000005', 'deposito@example.com'),
  ('e1000000-0000-0000-0000-000000000006', 'administracion@example.com'),
  ('e2000000-0000-0000-0000-000000000001', 'admin-dos@example.com');

insert into usuarios_organizacion (user_id, organizacion_id, rol_id, estado) values
  ('e1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'administrador', 'activo'),
  ('e1000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'operador', 'activo'),
  ('e1000000-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111', 'consulta', 'activo'),
  ('e1000000-0000-0000-0000-000000000005', '11111111-1111-1111-1111-111111111111', 'deposito', 'activo'),
  ('e1000000-0000-0000-0000-000000000006', '11111111-1111-1111-1111-111111111111', 'administracion', 'activo'),
  ('e2000000-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', 'administrador', 'activo');

insert into dominio.empresas (id, organizacion_id, nombre) values
  ('a1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'San Javucho'),
  ('a1000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'Mundo JC'),
  ('a2000000-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', 'Empresa Dos');

-- El operador, consulta y administración solo acceden a San Javucho (la lectura exige tienda accesible).
insert into usuarios_empresas (user_id, empresa_id, organizacion_id, rol_id) values
  ('e1000000-0000-0000-0000-000000000002', 'a1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'operador'),
  ('e1000000-0000-0000-0000-000000000003', 'a1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'consulta'),
  ('e1000000-0000-0000-0000-000000000006', 'a1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'administracion');

insert into clientes (id, organizacion_id, numero, nombre, tipo, archivado_en) values
  ('c5000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 10, 'Distribuidora Norte', 'mayorista', null),
  ('c5000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 11, 'Cliente archivado', 'minorista', now()),
  ('c6000000-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', 10, 'Cliente de la Dos', 'minorista', null);

create function pg_temp.como(p_user uuid) returns void language plpgsql as $$
begin
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
  set local role authenticated;
end $$;

-- Modelos y estado sembrados por organización (F-SVC-01).
create temp table datos as
  select
    (select id from dominio.modelos_equipo where organizacion_id = '11111111-1111-1111-1111-111111111111' and equipo = 'Nintendo Switch' and modelo = 'Estándar') as modelo_uno,
    (select id from dominio.modelos_equipo where organizacion_id = '11111111-1111-1111-1111-111111111111' and equipo = 'Nintendo Switch' and modelo = 'Lite') as modelo_inactivo,
    (select id from dominio.modelos_equipo where organizacion_id = '22222222-2222-2222-2222-222222222222' limit 1) as modelo_dos,
    (select id from dominio.estados_reparacion where organizacion_id = '11111111-1111-1111-1111-111111111111' and nombre = 'Recibido') as estado_recibido;
grant select on datos to public;
update dominio.modelos_equipo set activo = false where id = (select modelo_inactivo from datos);

create temp table reps (clave text primary key, id uuid);
grant select, insert on reps to public;

-- ============================================================================
-- Esquema, RLS y privilegios
-- ============================================================================

select ok(to_regclass('dominio.reparaciones') is not null and to_regclass('public.reparaciones') is null,
  'reparaciones vive en dominio, no en public');
select ok(to_regclass('dominio.reparacion_historial') is not null and to_regclass('public.reparacion_historial') is null,
  'reparacion_historial vive en dominio, no en public');
select is(
  (select bool_and(c.relrowsecurity) from pg_class c
    where c.oid in ('dominio.reparaciones'::regclass, 'dominio.reparacion_historial'::regclass)),
  true, 'RLS activa en las dos tablas'
);
select is(
  (select count(*) from unnest(array[
    'public.crear_reparacion(uuid,uuid,uuid,text,text,text,text,numeric,numeric,uuid,date)',
    'public.actualizar_reparacion(uuid,timestamptz,uuid,uuid,text,text,text,text,numeric,numeric,uuid,date,date)',
    'public.obtener_reparacion(uuid)',
    'public.tecnicos_de_service()',
    'public.uso_modelo_equipo(uuid)',
    'public.uso_estado_reparacion(uuid)'
  ]) as f where has_function_privilege('anon', f::regprocedure, 'execute'))::int,
  0, 'anon no ejecuta ninguna RPC de reparaciones'
);
select is(
  (select count(*) from unnest(array[
    'public.crear_reparacion(uuid,uuid,uuid,text,text,text,text,numeric,numeric,uuid,date)',
    'public.actualizar_reparacion(uuid,timestamptz,uuid,uuid,text,text,text,text,numeric,numeric,uuid,date,date)',
    'public.obtener_reparacion(uuid)',
    'public.tecnicos_de_service()',
    'public.uso_modelo_equipo(uuid)',
    'public.uso_estado_reparacion(uuid)'
  ]) as f where has_function_privilege('authenticated', f::regprocedure, 'execute'))::int,
  6, 'authenticated ejecuta las seis RPC'
);
select is(
  (select count(*) from information_schema.role_table_grants
    where grantee = 'anon' and table_schema = 'dominio' and table_name in ('reparaciones', 'reparacion_historial'))::int,
  0, 'anon sin privilegios sobre las tablas'
);
select is(
  (select count(*) from information_schema.role_table_grants
    where grantee = 'authenticated' and table_schema = 'dominio'
      and table_name in ('reparaciones', 'reparacion_historial')
      and privilege_type in ('INSERT', 'UPDATE', 'DELETE'))::int,
  0, 'ni insert, ni update, ni delete directos para authenticated'
);
select ok(
  (select prosrc from pg_proc where oid = 'private.siguiente_numero_reparacion(uuid)'::regprocedure) like '%pg_advisory_xact_lock%',
  'el número se toma bajo bloqueo transaccional por empresa'
);

-- ============================================================================
-- Alta y numeración por empresa (FR-012, FR-013)
-- ============================================================================

select pg_temp.como('e1000000-0000-0000-0000-000000000001');

insert into reps (clave, id)
select 'r1', (public.crear_reparacion(
  'a1000000-0000-0000-0000-000000000001', 'c5000000-0000-0000-0000-000000000001', (select modelo_uno from datos),
  'Juan 11 5555-5555', 'SN-1', 'Cargador', 'No enciende', 120.50, 30, null, null
)->>'id')::uuid;
insert into reps (clave, id)
select 'r2', (public.crear_reparacion(
  'a1000000-0000-0000-0000-000000000001', 'c5000000-0000-0000-0000-000000000001', (select modelo_uno from datos)
)->>'id')::uuid;
insert into reps (clave, id)
select 'r3', (public.crear_reparacion(
  'a1000000-0000-0000-0000-000000000001', 'c5000000-0000-0000-0000-000000000001', (select modelo_uno from datos)
)->>'id')::uuid;
insert into reps (clave, id)
select 'otra', (public.crear_reparacion(
  'a1000000-0000-0000-0000-000000000002', 'c5000000-0000-0000-0000-000000000001', (select modelo_uno from datos)
)->>'id')::uuid;

select is(
  public.obtener_reparacion((select id from reps where clave = 'r1'))->>'codigo',
  'R-0001', 'la primera reparación de la tienda es R-0001'
);
select is(
  public.obtener_reparacion((select id from reps where clave = 'r3'))->>'codigo',
  'R-0003', 'la serie es correlativa dentro de la tienda'
);
select is(
  public.obtener_reparacion((select id from reps where clave = 'otra'))->>'codigo',
  'R-0001', 'otra tienda de la organización tiene su propia serie'
);
select is(
  public.obtener_reparacion((select id from reps where clave = 'r1'))->>'estado',
  'Recibido', 'nace en el primer estado activo por orden'
);
select is(
  (public.obtener_reparacion((select id from reps where clave = 'r1'))->>'ingreso_en')::date,
  (now() at time zone 'America/Argentina/Buenos_Aires')::date, 'el ingreso es la fecha de hoy'
);
select is(
  (public.obtener_reparacion((select id from reps where clave = 'r1'))->>'costo_mano_obra')::numeric,
  120.50, 'el administrador (ver_costos) ve el costo de mano de obra'
);

reset role;

select is(
  (select array_agg(numero order by numero) from dominio.reparaciones where empresa_id = 'a1000000-0000-0000-0000-000000000001'),
  array[1, 2, 3], 'numeración sin saltos ni repetidos en la tienda'
);
select is(
  (select count(*)::int from dominio.reparacion_historial h
    where h.tipo = 'alta' and h.estado_nuevo_id = (select estado_recibido from datos)
      and h.usuario_id = 'e1000000-0000-0000-0000-000000000001'
      and h.reparacion_id in (select id from reps)),
  4, 'cada alta escribe su evento en el historial con el estado inicial y el usuario'
);
select is(
  (select count(*)::int from registro_actividad where tipo = 'reparacion.creada'),
  4, 'cada alta registra la actividad reparacion.creada'
);
select is(
  (select count(*)::int from registro_actividad
    where tipo = 'reparacion.creada' and detalle ~ '^Creó la reparación R-[0-9]{4}$'),
  4, 'la actividad usa el código visible, no ids'
);

-- ============================================================================
-- Rechazos del alta (FR-013)
-- ============================================================================

select pg_temp.como('e1000000-0000-0000-0000-000000000001');

select throws_ok(
  $$select public.crear_reparacion('a1000000-0000-0000-0000-000000000001', 'c6000000-0000-0000-0000-000000000001', (select modelo_uno from datos))$$,
  '22023', null, 'un cliente de otra organización se rechaza');
select throws_ok(
  $$select public.crear_reparacion('a1000000-0000-0000-0000-000000000001', 'c5000000-0000-0000-0000-000000000002', (select modelo_uno from datos))$$,
  '22023', null, 'un cliente archivado se rechaza');
select throws_ok(
  $$select public.crear_reparacion('a1000000-0000-0000-0000-000000000001', null, (select modelo_uno from datos))$$,
  '22023', null, 'el cliente es obligatorio');
select throws_ok(
  $$select public.crear_reparacion('a1000000-0000-0000-0000-000000000001', 'c5000000-0000-0000-0000-000000000001', (select modelo_dos from datos))$$,
  '22023', null, 'un modelo de otra organización se rechaza');
select throws_ok(
  $$select public.crear_reparacion('a1000000-0000-0000-0000-000000000001', 'c5000000-0000-0000-0000-000000000001', (select modelo_inactivo from datos))$$,
  '22023', null, 'un modelo desactivado no se ofrece en altas nuevas');
select throws_ok(
  $$select public.crear_reparacion('a1000000-0000-0000-0000-000000000001', 'c5000000-0000-0000-0000-000000000001', null)$$,
  '22023', null, 'el modelo es obligatorio');
select throws_ok(
  $$select public.crear_reparacion('a2000000-0000-0000-0000-000000000001', 'c5000000-0000-0000-0000-000000000001', (select modelo_uno from datos))$$,
  '42501', null, 'una tienda de otra organización se rechaza');
select throws_ok(
  $$select public.crear_reparacion('a1000000-0000-0000-0000-000000000001', 'c5000000-0000-0000-0000-000000000001', (select modelo_uno from datos), '', null, '', '', null, null, 'e1000000-0000-0000-0000-000000000003', null)$$,
  '22023', null, 'un técnico sin edición en Service técnico se rechaza');
select throws_ok(
  $$select public.crear_reparacion('a1000000-0000-0000-0000-000000000001', 'c5000000-0000-0000-0000-000000000001', (select modelo_uno from datos), '', null, '', '', null, null, null, date '2000-01-01')$$,
  '22023', null, 'la entrega prevista no puede ser anterior al ingreso');
select throws_ok(
  $$select public.crear_reparacion('a1000000-0000-0000-0000-000000000001', 'c5000000-0000-0000-0000-000000000001', (select modelo_uno from datos), '', null, '', '', -1, null, null, null)$$,
  '22023', null, 'los importes no pueden ser negativos');
select lives_ok(
  $$insert into reps (clave, id) select 'tecnico', (public.crear_reparacion('a1000000-0000-0000-0000-000000000001', 'c5000000-0000-0000-0000-000000000001', (select modelo_uno from datos), '', null, '', '', null, null, 'e1000000-0000-0000-0000-000000000002', null)->>'id')::uuid$$,
  'un técnico con edición en Service técnico se acepta');

-- ============================================================================
-- Escritura directa y costos sin select directo (FR-011, FR-021)
-- ============================================================================

select throws_ok(
  $$insert into dominio.reparaciones (empresa_id, numero, cliente_id, modelo_id, estado_id, ingreso_en)
    values ('a1000000-0000-0000-0000-000000000001', 99, 'c5000000-0000-0000-0000-000000000001', (select modelo_uno from datos), (select estado_recibido from datos), current_date)$$,
  '42501', null, 'no hay insert directo en reparaciones');
select throws_ok($$update dominio.reparaciones set falla = 'x'$$, '42501', null, 'no hay update directo');
select throws_ok($$delete from dominio.reparaciones$$, '42501', null, 'no hay delete');
select throws_ok($$select costo_mano_obra from dominio.reparaciones$$, '42501', null, 'los costos no tienen select directo');
select throws_ok($$select count(*) from dominio.reparaciones where costo_repuestos > 0$$, '42501', null, 'ni siquiera para filtrar');
select lives_ok($$select id, numero, falla from dominio.reparaciones$$, 'el resto de las columnas sí se leen');
select throws_ok(
  $$insert into dominio.reparacion_historial (reparacion_id, tipo) select id, 'alta' from reps limit 1$$,
  '42501', null, 'el historial no admite escritura directa');
select throws_ok($$delete from dominio.reparacion_historial$$, '42501', null, 'el historial no se borra');
select is(
  (select count(*)::int from dominio.reparacion_historial), 5, 'el historial es legible para quien tiene nivel'
);

-- ============================================================================
-- Edición: bloqueo optimista, validaciones, anuladas (FR-017)
-- ============================================================================

select throws_ok(
  $$select public.actualizar_reparacion((select id from reps where clave = 'r3'), timestamptz '2000-01-01',
      'c5000000-0000-0000-0000-000000000001', (select modelo_uno from datos))$$,
  '40001', null, 'una edición con un updated_at viejo es un conflicto');

select lives_ok(
  $$select public.actualizar_reparacion(
      (select id from reps where clave = 'r3'),
      (public.obtener_reparacion((select id from reps where clave = 'r3'))->>'updated_at')::timestamptz,
      'c5000000-0000-0000-0000-000000000001', (select modelo_uno from datos),
      'Contacto nuevo', 'SN-9', 'Funda', 'Pantalla rota', 10, 20, 'e1000000-0000-0000-0000-000000000002', null, null)$$,
  'una edición válida se guarda');
select is(
  public.obtener_reparacion((select id from reps where clave = 'r3'))->>'falla',
  'Pantalla rota', 'la edición cambia los datos');
select is(
  (public.obtener_reparacion((select id from reps where clave = 'r3'))->>'costo_repuestos')::numeric,
  20::numeric, 'quien tiene ver_costos edita los costos');
select is(
  public.obtener_reparacion((select id from reps where clave = 'r3'))->>'codigo',
  'R-0003', 'la edición no cambia el número');
select is(
  public.obtener_reparacion((select id from reps where clave = 'r3'))->>'estado',
  'Recibido', 'la edición no cambia el estado');

select throws_ok(
  $$select public.actualizar_reparacion(
      (select id from reps where clave = 'r3'),
      (public.obtener_reparacion((select id from reps where clave = 'r3'))->>'updated_at')::timestamptz,
      'c5000000-0000-0000-0000-000000000001', (select modelo_uno from datos),
      '', null, '', '', null, null, null, null, date '2000-01-01')$$,
  '22023', null, 'la entrega prevista anterior al ingreso se rechaza al editar');
select throws_ok(
  $$select public.actualizar_reparacion(
      (select id from reps where clave = 'r3'),
      (public.obtener_reparacion((select id from reps where clave = 'r3'))->>'updated_at')::timestamptz,
      null, (select modelo_uno from datos))$$,
  '22023', null, 'cliente obligatorio al editar');
select throws_ok(
  $$select public.actualizar_reparacion(
      (select id from reps where clave = 'r3'),
      (public.obtener_reparacion((select id from reps where clave = 'r3'))->>'updated_at')::timestamptz,
      'c5000000-0000-0000-0000-000000000001', (select modelo_inactivo from datos))$$,
  '22023', null, 'no se cambia a un modelo desactivado');

-- Un guardado idéntico no avanza updated_at ni duplica la actividad.
create temp table antes as
  select (select count(*) from registro_actividad where tipo = 'reparacion.editada')::int as editadas,
         (select updated_at from dominio.reparaciones where id = (select id from reps where clave = 'r3')) as marca;
grant select on antes to public;
select lives_ok(
  $$select public.actualizar_reparacion(
      (select id from reps where clave = 'r3'),
      (public.obtener_reparacion((select id from reps where clave = 'r3'))->>'updated_at')::timestamptz,
      'c5000000-0000-0000-0000-000000000001', (select modelo_uno from datos),
      'Contacto nuevo', 'SN-9', 'Funda', 'Pantalla rota', 10, 20, 'e1000000-0000-0000-0000-000000000002', null, null)$$,
  'guardar sin cambios no falla');
select is(
  (select updated_at from dominio.reparaciones where id = (select id from reps where clave = 'r3')),
  (select marca from antes), 'guardar sin cambios no mueve updated_at');
select is(
  (select count(*)::int from registro_actividad where tipo = 'reparacion.editada'),
  (select editadas from antes), 'guardar sin cambios no registra actividad');
select is(
  (select count(*)::int from registro_actividad where tipo = 'reparacion.editada'),
  1, 'la edición real registró reparacion.editada una sola vez');

reset role;
update dominio.reparaciones set anulada_en = now(), anulada_motivo = 'Prueba'
 where id = (select id from reps where clave = 'r2');
select pg_temp.como('e1000000-0000-0000-0000-000000000001');
select throws_ok(
  $$select public.actualizar_reparacion(
      (select id from reps where clave = 'r2'),
      (public.obtener_reparacion((select id from reps where clave = 'r2'))->>'updated_at')::timestamptz,
      'c5000000-0000-0000-0000-000000000001', (select modelo_uno from datos))$$,
  '55000', null, 'una reparación anulada no se edita');

-- ============================================================================
-- Operador (edición sin ver_costos), una sola tienda
-- ============================================================================

select pg_temp.como('e1000000-0000-0000-0000-000000000002');

select lives_ok(
  $$insert into reps (clave, id) select 'operador', (public.crear_reparacion('a1000000-0000-0000-0000-000000000001', 'c5000000-0000-0000-0000-000000000001', (select modelo_uno from datos))->>'id')::uuid$$,
  'el operador crea una reparación en su tienda sin costos');
select throws_ok(
  $$select public.crear_reparacion('a1000000-0000-0000-0000-000000000001', 'c5000000-0000-0000-0000-000000000001', (select modelo_uno from datos), '', null, '', '', 5, null, null, null)$$,
  '42501', null, 'sin ver_costos no se aceptan costos al crear');
select throws_ok(
  $$select public.crear_reparacion('a1000000-0000-0000-0000-000000000002', 'c5000000-0000-0000-0000-000000000001', (select modelo_uno from datos))$$,
  '42501', null, 'no se crea en una tienda a la que no se accede');
select is(
  public.obtener_reparacion((select id from reps where clave = 'r1'))->>'costo_mano_obra',
  null, 'sin ver_costos el costo de mano de obra llega nulo');
select is(
  public.obtener_reparacion((select id from reps where clave = 'r1'))->>'costo_repuestos',
  null, 'sin ver_costos el costo de repuestos llega nulo');
select is(
  (public.obtener_reparacion((select id from reps where clave = 'r1'))->>'puede_ver_costos')::boolean,
  false, 'la respuesta indica que no puede ver costos');
select throws_ok(
  $$select public.actualizar_reparacion(
      (select id from reps where clave = 'r1'),
      (public.obtener_reparacion((select id from reps where clave = 'r1'))->>'updated_at')::timestamptz,
      'c5000000-0000-0000-0000-000000000001', (select modelo_uno from datos),
      '', null, '', '', 1, null, null, null, null)$$,
  '42501', null, 'sin ver_costos no se editan costos');
select lives_ok(
  $$select public.actualizar_reparacion(
      (select id from reps where clave = 'r1'),
      (public.obtener_reparacion((select id from reps where clave = 'r1'))->>'updated_at')::timestamptz,
      'c5000000-0000-0000-0000-000000000001', (select modelo_uno from datos),
      'Contacto', 'SN-1', 'Cargador', 'No enciende más', null, null, null, null, null)$$,
  'el operador edita sin tocar costos');
select throws_ok(
  $$select public.actualizar_reparacion(
      (select id from reps where clave = 'otra'),
      (select updated_at from dominio.reparaciones where id = (select id from reps where clave = 'otra')),
      'c5000000-0000-0000-0000-000000000001', (select modelo_uno from datos))$$,
  '42501', null, 'no se edita una reparación de una tienda a la que no se accede');
select throws_ok($$select costo_mano_obra from dominio.reparaciones$$, '42501', null, 'el operador no lee costos por la tabla');

reset role;
select is(
  (select costo_mano_obra from dominio.reparaciones where id = (select id from reps where clave = 'r1')),
  120.50::numeric, 'editar sin costos conserva los costos cargados');

-- ============================================================================
-- Consulta (lectura), Depósito (ninguno) y Administración (lectura + ver_costos)
-- ============================================================================

select pg_temp.como('e1000000-0000-0000-0000-000000000003');
select throws_ok(
  $$select public.crear_reparacion('a1000000-0000-0000-0000-000000000001', 'c5000000-0000-0000-0000-000000000001', (select modelo_uno from datos))$$,
  '42501', null, 'con lectura no se crea');
select throws_ok(
  $$select public.actualizar_reparacion((select id from reps where clave = 'r1'), now(), 'c5000000-0000-0000-0000-000000000001', (select modelo_uno from datos))$$,
  '42501', null, 'con lectura no se edita');
select is(
  public.obtener_reparacion((select id from reps where clave = 'r1'))->>'codigo',
  'R-0001', 'con lectura se ve la reparación');
select is(
  public.obtener_reparacion((select id from reps where clave = 'r1'))->>'costo_mano_obra',
  null, 'con lectura y sin ver_costos el costo llega nulo');
select ok((select count(*) from dominio.reparaciones) > 0, 'con lectura se listan las reparaciones');

select pg_temp.como('e1000000-0000-0000-0000-000000000005');
select throws_ok(
  $$select public.obtener_reparacion((select id from reps where clave = 'r1'))$$,
  '42501', null, 'con ninguno no se ve la reparación');
select is((select count(*)::int from dominio.reparaciones), 0, 'con ninguno la tabla no devuelve filas');
select is((select count(*)::int from dominio.reparacion_historial), 0, 'con ninguno el historial no devuelve filas');
select throws_ok($$select * from public.tecnicos_de_service()$$, '42501', null, 'con ninguno no se listan técnicos');

select pg_temp.como('e1000000-0000-0000-0000-000000000006');
select is(
  (public.obtener_reparacion((select id from reps where clave = 'r1'))->>'costo_mano_obra')::numeric,
  120.50, 'administración (lectura + ver_costos) ve los costos');
select throws_ok(
  $$select public.crear_reparacion('a1000000-0000-0000-0000-000000000001', 'c5000000-0000-0000-0000-000000000001', (select modelo_uno from datos))$$,
  '42501', null, 'administración (solo lectura) no crea');

-- ============================================================================
-- Aislamiento entre organizaciones (SC-003)
-- ============================================================================

select pg_temp.como('e2000000-0000-0000-0000-000000000001');
select is((select count(*)::int from dominio.reparaciones), 0, 'la organización Dos no ve reparaciones de la Uno');
select is((select count(*)::int from dominio.reparacion_historial), 0, 'la organización Dos no ve el historial de la Uno');
select throws_ok(
  $$select public.obtener_reparacion((select id from reps where clave = 'r1'))$$,
  'P0002', null, 'obtener una reparación ajena no revela que existe');
select throws_ok(
  $$select public.actualizar_reparacion((select id from reps where clave = 'r1'), now(), 'c6000000-0000-0000-0000-000000000001', (select modelo_dos from datos))$$,
  'P0002', null, 'editar una reparación ajena no encuentra nada');
select throws_ok(
  $$select public.crear_reparacion('a2000000-0000-0000-0000-000000000001', 'c5000000-0000-0000-0000-000000000001', (select modelo_dos from datos))$$,
  '22023', null, 'la Dos no usa clientes de la Uno');
select throws_ok(
  $$select public.crear_reparacion('a1000000-0000-0000-0000-000000000001', 'c6000000-0000-0000-0000-000000000001', (select modelo_dos from datos))$$,
  '42501', null, 'la Dos no usa tiendas de la Uno');
select is((select count(*)::int from public.uso_modelo_equipo()), 0, 'el uso de la Dos no cuenta reparaciones de la Uno');
select is(
  (select array_agg(nombre) from public.tecnicos_de_service()),
  array['Técnico sin nombre'], 'los técnicos de la Dos son solo los de la Dos (sin email)'
);

-- ============================================================================
-- Técnicos y uso (FR-016, FR-019)
-- ============================================================================

select pg_temp.como('e1000000-0000-0000-0000-000000000001');
select is(
  (select array_agg(nombre order by nombre) from public.tecnicos_de_service()),
  array['Técnico sin nombre', 'Técnico sin nombre'],
  'los técnicos elegibles son quienes tienen edición en Service técnico, sin emails'
);
select is(
  (select cantidad::int from public.uso_modelo_equipo((select modelo_uno from datos))),
  6, 'uso del modelo: todas las reparaciones que lo usan (incluida la anulada)'
);
select is(
  (select cantidad::int from public.uso_estado_reparacion((select estado_recibido from datos))),
  6, 'uso del estado: todas las reparaciones que lo usan'
);
select is(
  (select count(*)::int from public.uso_modelo_equipo((select modelo_inactivo from datos))),
  0, 'un modelo sin reparaciones no aparece en el uso'
);
select is((select count(*)::int from public.uso_modelo_equipo()), 1, 'sin id devuelve todos los modelos en uso');

-- ============================================================================
-- Devolución del Revisor: lectura por tienda, técnico dado de baja, ingreso futuro
-- ============================================================================

select pg_temp.como('e1000000-0000-0000-0000-000000000002');
select is(
  (select count(*) from dominio.reparaciones where id = (select id from reps where clave = 'otra')),
  0::bigint, 'el operador no lee por select una reparación de una tienda a la que no accede');
select throws_ok(
  $$select public.obtener_reparacion((select id from reps where clave = 'otra'))$$,
  'P0002', null, 'el operador no obtiene por id una reparación de otra tienda');
select is(
  (select count(*) from dominio.reparacion_historial where reparacion_id = (select id from reps where clave = 'otra')),
  0::bigint, 'el operador no lee la bitácora de otra tienda');

select pg_temp.como('e1000000-0000-0000-0000-000000000001');
select throws_ok(
  $$select public.actualizar_reparacion(
      (select id from reps where clave = 'r3'),
      (public.obtener_reparacion((select id from reps where clave = 'r3'))->>'updated_at')::timestamptz,
      'c5000000-0000-0000-0000-000000000001', (select modelo_uno from datos),
      '', null, '', '', null, null, null, current_date + 5, null)$$,
  '22023', null, 'el ingreso futuro se rechaza al editar');

-- Si la baja borra la membresía del técnico asignado, la reparación se sigue pudiendo editar.
reset role;
delete from usuarios_organizacion where user_id = 'e1000000-0000-0000-0000-000000000002';
select pg_temp.como('e1000000-0000-0000-0000-000000000001');
select lives_ok(
  $$select public.actualizar_reparacion(
      (select id from reps where clave = 'r3'),
      (public.obtener_reparacion((select id from reps where clave = 'r3'))->>'updated_at')::timestamptz,
      'c5000000-0000-0000-0000-000000000001', (select modelo_uno from datos),
      'Contacto tras la baja', 'SN-9', 'Funda', 'Pantalla rota', null, null, 'e1000000-0000-0000-0000-000000000002', null, null)$$,
  'editar con el técnico asignado dado de baja se guarda');

select * from finish();
rollback;
