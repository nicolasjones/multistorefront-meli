-- Orquestación de workers multi-organización (spec 013). Ver
-- specs/013-orquestacion-multi-organizacion/data-model.md y contracts/.
--
-- Kestra (kestra_orquestacion) es, igual que en backups_postgres.test.sql,
-- un rol de servicio con conexión JDBC directa, no un "authenticated" con
-- JWT. Por el mismo motivo que ese archivo documenta (postgres, el rol de
-- conexión de este test, no es superusuario acá y no tiene membresía en
-- kestra_orquestacion para poder asumirlo con SET ROLE — y SET ROLE de
-- cualquier forma no cambiaría session_user, que es justo lo que estas
-- funciones miran, ver el comentario de private.organizacion_del_rol_actual
-- en la migración): las llamadas que solo kestra_orquestacion puede hacer
-- se ejecutan como postgres directamente (dueño de las funciones, el
-- revoke no le aplica) para probar su lógica de negocio, y por separado se
-- confirma con has_function_privilege que el GRANT real está bien puesto.
-- Verificar que kestra_orquestacion, conectado de verdad, puede ejecutarlas
-- de punta a punta es responsabilidad de quickstart.md, no de esta suite.
begin;

select plan(93);

-- ============================================================================
-- Fixture
-- ============================================================================

insert into organizaciones (id, nombre) values
  ('d1111111-1111-1111-1111-111111111111', 'Organización X'),
  ('d2222222-2222-2222-2222-222222222222', 'Organización Y');

-- Fixture de catálogo (spec catálogo-sistemas-externos): conexiones.sistema_externo
-- ahora tiene FK a sistemas_externos, este valor de prueba necesita su fila.
insert into sistemas_externos (id, descripcion) values
  ('sistema-de-prueba', 'Sistema de prueba (fixture de tests, sin valor de negocio)');

insert into auth.users (id, email) values
  ('d5000000-0000-0000-0000-000000000005', 'superadmin-orquestacion@example.com'),
  ('d1000000-0000-0000-0000-000000000001', 'admin-x-orquestacion@example.com'),
  ('d2000000-0000-0000-0000-000000000001', 'admin-y-orquestacion@example.com'),
  ('d3000000-0000-0000-0000-000000000001', 'miembro-x-orquestacion@example.com');

insert into superadmins (user_id) values ('d5000000-0000-0000-0000-000000000005');

insert into usuarios_organizacion (user_id, organizacion_id, rol_id) values
  ('d1000000-0000-0000-0000-000000000001', 'd1111111-1111-1111-1111-111111111111', 'administrador'),
  ('d2000000-0000-0000-0000-000000000001', 'd2222222-2222-2222-2222-222222222222', 'administrador'),
  ('d3000000-0000-0000-0000-000000000001', 'd1111111-1111-1111-1111-111111111111', 'miembro');

create temporary table t_ids (key text primary key, val uuid);
create temporary table t_txt (key text primary key, val text);
create temporary table t_rpc (key text primary key, payload jsonb);
grant all on t_ids to authenticated;
grant all on t_txt to authenticated;
grant all on t_rpc to authenticated;

-- ============================================================================
-- private.es_administrador_de (FR-009)
-- ============================================================================

select set_config(
  'request.jwt.claims',
  json_build_object('sub', 'd1000000-0000-0000-0000-000000000001', 'role', 'authenticated')::text,
  true
);
set local role authenticated;

select is(
  (select private.es_administrador_de('d1111111-1111-1111-1111-111111111111')),
  true,
  'admin de X: es_administrador_de(X) da true'
);

select is(
  (select private.es_administrador_de('d2222222-2222-2222-2222-222222222222')),
  false,
  'admin de X: es_administrador_de(Y) da false'
);

reset role;

select set_config(
  'request.jwt.claims',
  json_build_object('sub', 'd3000000-0000-0000-0000-000000000001', 'role', 'authenticated')::text,
  true
);
set local role authenticated;

select is(
  (select private.es_administrador_de('d1111111-1111-1111-1111-111111111111')),
  false,
  'miembro sin rol administrador de X: es_administrador_de(X) da false'
);

reset role;

select set_config(
  'request.jwt.claims',
  json_build_object('sub', 'd5000000-0000-0000-0000-000000000005', 'role', 'authenticated')::text,
  true
);
set local role authenticated;

select is(
  (select private.es_administrador_de('d1111111-1111-1111-1111-111111111111')),
  true,
  'superadmin: es_administrador_de(cualquier organización) da true'
);

reset role;

-- ============================================================================
-- public.aprovisionar_servidor_organizacion (FR-014, US5)
-- ============================================================================

select set_config(
  'request.jwt.claims',
  json_build_object('sub', 'd1000000-0000-0000-0000-000000000001', 'role', 'authenticated')::text,
  true
);
set local role authenticated;

select throws_ok(
  $$select public.aprovisionar_servidor_organizacion('d1111111-1111-1111-1111-111111111111', 'host-x.example.com', 'deploy', 'clave-ssh-x')$$,
  '42501',
  null,
  'un administrador de organización no puede aprovisionar un servidor (solo superadmin)'
);

reset role;

select set_config(
  'request.jwt.claims',
  json_build_object('sub', 'd5000000-0000-0000-0000-000000000005', 'role', 'authenticated')::text,
  true
);
set local role authenticated;

select throws_ok(
  $$select public.aprovisionar_servidor_organizacion('00000000-0000-0000-0000-000000000000', 'host.example.com', 'deploy', 'clave-ssh')$$,
  'P0002',
  null,
  'aprovisionar_servidor_organizacion rechaza una organización que no existe'
);

insert into t_txt (key, val)
select 'password_x', password_rol
from public.aprovisionar_servidor_organizacion(
  'd1111111-1111-1111-1111-111111111111', 'host-x.example.com', 'deploy', 'clave-ssh-x'
);

select ok(
  (select length(val) > 0 from t_txt where key = 'password_x'),
  'aprovisionar_servidor_organizacion devuelve la contraseña del rol en el resultado (FR-014)'
);

select is(
  (select rol_db from servidores_organizacion where organizacion_id = 'd1111111-1111-1111-1111-111111111111'),
  'worker_' || replace('d1111111-1111-1111-1111-111111111111', '-', ''),
  'el rol_db generado sigue la convención worker_<organizacion_id sin guiones> (R5)'
);

select throws_ok(
  $$select public.aprovisionar_servidor_organizacion('d1111111-1111-1111-1111-111111111111', 'otro-host.example.com', 'deploy', 'otra-clave')$$,
  '23505',
  null,
  'una organización con servidor ya aprovisionado no puede aprovisionarse de nuevo'
);

-- Segunda organización, para los bloques de aislamiento más abajo.
insert into t_txt (key, val)
select 'password_y', password_rol
from public.aprovisionar_servidor_organizacion(
  'd2222222-2222-2222-2222-222222222222', 'host-y.example.com', 'deploy', 'clave-ssh-y'
);

reset role;

-- ============================================================================
-- El rol worker_* creado puede resolver su propia organización, y solo esa
-- (R5) — grants puntuales, no un grupo worker_* genérico.
-- ============================================================================

select is(
  has_function_privilege(
    (select rol_db from servidores_organizacion where organizacion_id = 'd1111111-1111-1111-1111-111111111111'),
    'private.organizacion_del_rol_actual()',
    'EXECUTE'
  ),
  true,
  'el rol worker_* de X puede ejecutar organizacion_del_rol_actual (otorgado al aprovisionar, no heredado de authenticated)'
);

select is(
  has_function_privilege('authenticated', 'private.organizacion_del_rol_actual()', 'EXECUTE'),
  false,
  'authenticated NO tiene EXECUTE de organizacion_del_rol_actual — no es un mecanismo para sesiones con JWT'
);

select is(
  has_schema_privilege(
    (select rol_db from servidores_organizacion where organizacion_id = 'd1111111-1111-1111-1111-111111111111'),
    'private',
    'USAGE'
  ),
  true,
  'el rol worker_* de X tiene USAGE sobre el schema private (necesario para el EXECUTE de arriba)'
);

-- session_user real dentro de esta suite es "postgres" (no hay forma de
-- asumir el rol worker_* recién creado sin una conexión nueva, ver
-- encabezado): confirma que un rol_db que nadie tiene conectado hoy no
-- resuelve a ninguna organización — no hay falso positivo.
select is(
  (select private.organizacion_del_rol_actual()),
  null,
  'organizacion_del_rol_actual() da null para session_user = postgres (no matchea ningún rol_db real)'
);

-- ============================================================================
-- private.obtener_credencial_para_worker (spec 014): el grupo de workers
-- recibe el único EXECUTE y la función vincula session_user con su organización.
-- La suite no puede abrir una segunda conexión como worker_*; el recorrido
-- autenticado con ese rol queda en quickstart.md. Aquí se prueba la membresía,
-- los grants efectivos, el mapeo cruzado y que postgres tampoco evade el guard.
-- ============================================================================

select ok(
  exists (select 1 from pg_catalog.pg_roles where rolname = 'workers_orquestacion' and not rolcanlogin),
  'workers_orquestacion existe como rol de grupo sin login'
);
select ok(
  pg_has_role(
    (select rol_db from servidores_organizacion where organizacion_id = 'd1111111-1111-1111-1111-111111111111'),
    'workers_orquestacion',
    'member'
  ),
  'el worker de X pertenece a workers_orquestacion al aprovisionarlo'
);
select ok(
  pg_has_role(
    (select rol_db from servidores_organizacion where organizacion_id = 'd2222222-2222-2222-2222-222222222222'),
    'workers_orquestacion',
    'member'
  ),
  'el worker de Y pertenece a workers_orquestacion al aprovisionarlo'
);
select ok(
  not pg_has_role('kestra_orquestacion', 'workers_orquestacion', 'member'),
  'kestra_orquestacion no pertenece al grupo de workers'
);
select is(
  has_function_privilege('workers_orquestacion', 'private.obtener_credencial_para_worker(uuid)', 'EXECUTE'),
  true,
  'workers_orquestacion tiene EXECUTE sobre la función de credencial efímera'
);
select is(
  has_function_privilege(
    (select rol_db from servidores_organizacion where organizacion_id = 'd1111111-1111-1111-1111-111111111111'),
    'private.obtener_credencial_para_worker(uuid)',
    'EXECUTE'
  ),
  true,
  'el worker de X hereda EXECUTE de la función'
);
select is(
  has_function_privilege('kestra_orquestacion', 'private.obtener_credencial_para_worker(uuid)', 'EXECUTE'),
  false,
  'kestra_orquestacion no puede obtener credenciales de workers'
);
select is(
  has_function_privilege('anon', 'private.obtener_credencial_para_worker(uuid)', 'EXECUTE'),
  false,
  'anon no puede obtener credenciales de workers'
);
select is(
  has_function_privilege('authenticated', 'private.obtener_credencial_para_worker(uuid)', 'EXECUTE'),
  false,
  'authenticated no puede obtener credenciales de workers'
);
select is(
  has_table_privilege(
    (select rol_db from servidores_organizacion where organizacion_id = 'd1111111-1111-1111-1111-111111111111'),
    'public.conexiones',
    'SELECT'
  ),
  false,
  'el worker de X no tiene SELECT directo sobre conexiones'
);
select is(
  has_table_privilege(
    (select rol_db from servidores_organizacion where organizacion_id = 'd1111111-1111-1111-1111-111111111111'),
    'vault.decrypted_secrets',
    'SELECT'
  ),
  false,
  'el worker de X no tiene SELECT directo sobre Vault'
);
select is(
  (select rol_db from servidores_organizacion where organizacion_id = 'd1111111-1111-1111-1111-111111111111'),
  'worker_d1111111111111111111111111111111',
  'el rol de worker X queda ligado a su organización antes de crear conexiones'
);
select is(
  (
    select count(*)::integer
    from servidores_organizacion s
    join servidores_organizacion otra on otra.rol_db = s.rol_db
    where s.rol_db = (select rol_db from servidores_organizacion where organizacion_id = 'd1111111-1111-1111-1111-111111111111')
      and otra.organizacion_id = 'd2222222-2222-2222-2222-222222222222'
  ),
  0,
  'el rol worker X no puede quedar ligado al servidor de Y'
);
select throws_ok(
  $$select private.obtener_credencial_para_worker('00000000-0000-0000-0000-000000000000')$$,
  '42501',
  null,
  'postgres no evita el guard de membresía antes de cualquier lectura'
);
select throws_ok(
  $$select private.obtener_credencial_para_worker('ffffffff-ffff-ffff-ffff-ffffffffffff')$$,
  '42501',
  null,
  'el guard no revela si una conexión solicitada existe'
);

-- ============================================================================
-- public.crear_conexion / actualizar_credencial_conexion (FR-009, US3)
-- ============================================================================

select set_config(
  'request.jwt.claims',
  json_build_object('sub', 'd3000000-0000-0000-0000-000000000001', 'role', 'authenticated')::text,
  true
);
set local role authenticated;

select throws_ok(
  $$select public.crear_conexion('d1111111-1111-1111-1111-111111111111', 'sistema-de-prueba', 'credencial-secreta')$$,
  '42501',
  null,
  'un miembro sin rol administrador no puede crear una conexión (US3 AC3)'
);

reset role;

select set_config(
  'request.jwt.claims',
  json_build_object('sub', 'd1000000-0000-0000-0000-000000000001', 'role', 'authenticated')::text,
  true
);
set local role authenticated;

select throws_ok(
  $$select public.crear_conexion('d2222222-2222-2222-2222-222222222222', 'sistema-de-prueba', 'credencial-secreta')$$,
  '42501',
  null,
  'el administrador de X no puede crear una conexión para Y'
);

insert into t_rpc (key, payload)
select 'conexion_x', public.crear_conexion('d1111111-1111-1111-1111-111111111111', 'sistema-de-prueba', 'credencial-secreta-x');

insert into t_ids (key, val)
select 'conexion_x', ((select payload from t_rpc where key = 'conexion_x')->>'id')::uuid;

select is(
  (select estado from conexiones where id = (select val from t_ids where key = 'conexion_x')),
  'activa',
  'crear_conexion crea la fila con estado activa'
);

select ok(
  not ((select payload from t_rpc where key = 'conexion_x') ? 'credencial_vault_id'),
  'crear_conexion no devuelve credencial_vault_id en su respuesta RPC (FR-006)'
);

select throws_ok(
  $$select public.actualizar_credencial_conexion('00000000-0000-0000-0000-000000000000', 'nueva-credencial')$$,
  'P0002',
  null,
  'actualizar_credencial_conexion rechaza una conexión que no existe'
);

select lives_ok(
  format($$select public.actualizar_credencial_conexion('%s', 'credencial-rotada-x')$$, (select val from t_ids where key = 'conexion_x')),
  'el administrador de X puede rotar la credencial de su propia conexión'
);

reset role;

select set_config(
  'request.jwt.claims',
  json_build_object('sub', 'd2000000-0000-0000-0000-000000000001', 'role', 'authenticated')::text,
  true
);
set local role authenticated;

select throws_ok(
  format($$select public.actualizar_credencial_conexion('%s', 'otra-credencial')$$, (select val from t_ids where key = 'conexion_x')),
  '42501',
  null,
  'el administrador de Y no puede rotar la credencial de una conexión de X'
);

reset role;

-- Segunda conexión, para los bloques de aislamiento de obtener_credencial_* más abajo.
select set_config(
  'request.jwt.claims',
  json_build_object('sub', 'd2000000-0000-0000-0000-000000000001', 'role', 'authenticated')::text,
  true
);
set local role authenticated;

insert into t_ids (key, val)
select 'conexion_y', ((public.crear_conexion('d2222222-2222-2222-2222-222222222222', 'sistema-de-prueba', 'credencial-secreta-y')->>'id')::uuid);

reset role;

-- ============================================================================
-- public.obtener_credencial_conexion / obtener_credencial_servidor (R4)
-- ============================================================================

select set_config(
  'request.jwt.claims',
  json_build_object('sub', 'd1000000-0000-0000-0000-000000000001', 'role', 'authenticated')::text,
  true
);
set local role authenticated;

select is(
  (select public.obtener_credencial_conexion((select val from t_ids where key = 'conexion_x'))),
  'credencial-rotada-x',
  'el administrador de X puede leer (descifrada) la credencial rotada de su propia conexión'
);

select throws_ok(
  format($$select public.obtener_credencial_conexion('%s')$$, (select val from t_ids where key = 'conexion_y')),
  '42501',
  null,
  'el administrador de X no puede leer la credencial de una conexión de Y'
);

reset role;

select set_config(
  'request.jwt.claims',
  json_build_object('sub', 'd3000000-0000-0000-0000-000000000001', 'role', 'authenticated')::text,
  true
);
set local role authenticated;

select throws_ok(
  format($$select public.obtener_credencial_conexion('%s')$$, (select val from t_ids where key = 'conexion_x')),
  '42501',
  null,
  'un miembro sin rol administrador de X no puede leer la credencial de una conexión de X'
);

reset role;

select throws_ok(
  format($$select public.obtener_credencial_conexion('%s')$$, (select val from t_ids where key = 'conexion_x')),
  '42501',
  null,
  'llamar obtener_credencial_conexion como postgres (dueño de la función) también se rechaza — el chequeo interno no confía implícitamente en el dueño'
);

select is(
  has_function_privilege('kestra_orquestacion', 'public.obtener_credencial_conexion(uuid)', 'EXECUTE'),
  true,
  'kestra_orquestacion tiene EXECUTE de obtener_credencial_conexion'
);

select is(
  has_function_privilege('anon', 'public.obtener_credencial_conexion(uuid)', 'EXECUTE'),
  false,
  'anon no tiene EXECUTE de obtener_credencial_conexion'
);

select set_config(
  'request.jwt.claims',
  json_build_object('sub', 'd1000000-0000-0000-0000-000000000001', 'role', 'authenticated')::text,
  true
);
set local role authenticated;

select is(
  (select public.obtener_credencial_servidor('d1111111-1111-1111-1111-111111111111')),
  'clave-ssh-x',
  'el administrador de X puede leer la credencial SSH de su propio servidor'
);

select throws_ok(
  $$select public.obtener_credencial_servidor('d2222222-2222-2222-2222-222222222222')$$,
  '42501',
  null,
  'el administrador de X no puede leer la credencial del servidor de Y'
);

reset role;

select is(
  has_function_privilege('kestra_orquestacion', 'public.obtener_credencial_servidor(uuid)', 'EXECUTE'),
  true,
  'kestra_orquestacion tiene EXECUTE de obtener_credencial_servidor'
);

-- ============================================================================
-- private.datos_despacho_conexion (T015, resolución de host/puerto/usuario
-- para la tarea SSH del flow — kestra_orquestacion no tiene select directo
-- sobre servidores_organizacion/conexiones, mismo criterio que kestra_backups)
-- ============================================================================

select is(
  has_function_privilege('kestra_orquestacion', 'private.datos_despacho_conexion(uuid, text)', 'EXECUTE'),
  true,
  'kestra_orquestacion tiene EXECUTE de datos_despacho_conexion'
);
select is(
  has_function_privilege('authenticated', 'private.datos_despacho_conexion(uuid, text)', 'EXECUTE'),
  false,
  'authenticated no tiene EXECUTE de datos_despacho_conexion — solo kestra_orquestacion la necesita'
);

select is(
  (select host from private.datos_despacho_conexion('d1111111-1111-1111-1111-111111111111', 'sistema-de-prueba')),
  'host-x.example.com',
  'datos_despacho_conexion resuelve el host del servidor de X para su conexión a sistema-de-prueba'
);
select is(
  (select conexion_id from private.datos_despacho_conexion('d1111111-1111-1111-1111-111111111111', 'sistema-de-prueba')),
  (select val from t_ids where key = 'conexion_x'),
  'y el conexion_id es el de la conexión de X, no otro'
);

select throws_ok(
  $$select private.datos_despacho_conexion('d1111111-1111-1111-1111-111111111111', 'sistema-sin-conexion')$$,
  'P0002',
  null,
  'datos_despacho_conexion falla si la organización no tiene conexión a ese sistema_externo'
);

-- ============================================================================
-- private.organizaciones_activas_para_conector (T018): el universo del flow
-- genérico se limita a conexiones activas y excluye flows dedicados (FR-005).
-- ============================================================================

select is(
  has_function_privilege('kestra_orquestacion', 'private.organizaciones_activas_para_conector(text)', 'EXECUTE'),
  true,
  'kestra_orquestacion puede enumerar organizaciones activas para un conector'
);
select is(
  has_function_privilege('authenticated', 'private.organizaciones_activas_para_conector(text)', 'EXECUTE'),
  false,
  'authenticated no puede enumerar el universo de despacho del flow'
);
select is(
  (select count(*)::int from private.organizaciones_activas_para_conector('sistema-de-prueba')),
  2,
  'el universo incluye las dos organizaciones con conexión activa'
);

insert into excepciones_flow_generico (organizacion_id, conector_id)
values ('d1111111-1111-1111-1111-111111111111', 'sistema-de-prueba');

select is(
  (select count(*)::int from private.organizaciones_activas_para_conector('sistema-de-prueba')),
  1,
  'el universo excluye una organización atendida por flow dedicado'
);

delete from excepciones_flow_generico
where organizacion_id = 'd1111111-1111-1111-1111-111111111111'
  and conector_id = 'sistema-de-prueba';

-- ============================================================================
-- private.marcar_conexion_activa / marcar_conexion_credencial_invalida /
-- registrar_alerta — solo kestra_orquestacion (R8, R9)
-- ============================================================================

select is(
  has_function_privilege('kestra_orquestacion', 'private.marcar_conexion_activa(uuid)', 'EXECUTE'),
  true,
  'kestra_orquestacion puede ejecutar marcar_conexion_activa'
);
select is(
  has_function_privilege('authenticated', 'private.marcar_conexion_activa(uuid)', 'EXECUTE'),
  false,
  'authenticated no puede ejecutar marcar_conexion_activa'
);
select is(
  has_function_privilege('kestra_orquestacion', 'private.marcar_conexion_credencial_invalida(uuid, text)', 'EXECUTE'),
  true,
  'kestra_orquestacion puede ejecutar marcar_conexion_credencial_invalida'
);
select is(
  has_function_privilege('authenticated', 'private.marcar_conexion_credencial_invalida(uuid, text)', 'EXECUTE'),
  false,
  'authenticated no puede ejecutar marcar_conexion_credencial_invalida'
);
select is(
  has_function_privilege('kestra_orquestacion', 'private.registrar_alerta(text, uuid, uuid, text)', 'EXECUTE'),
  true,
  'kestra_orquestacion puede ejecutar registrar_alerta'
);
select is(
  has_function_privilege('authenticated', 'private.registrar_alerta(text, uuid, uuid, text)', 'EXECUTE'),
  false,
  'authenticated no puede ejecutar registrar_alerta'
);

-- Lógica de negocio, llamada como postgres (dueño): ver encabezado.
select lives_ok(
  format($$select private.marcar_conexion_credencial_invalida('%s', 'usuario/clave inválidos')$$, (select val from t_ids where key = 'conexion_x')),
  'marcar_conexion_credencial_invalida no lanza error'
);

select is(
  (select estado from conexiones where id = (select val from t_ids where key = 'conexion_x')),
  'credencial_invalida',
  'la conexión queda en credencial_invalida (FR-013)'
);

select is(
  (select count(*)::int from alertas where conexion_id = (select val from t_ids where key = 'conexion_x')),
  0,
  'marcar_conexion_credencial_invalida NO registra la alerta — eso es responsabilidad exclusiva del subflow de alertas (contracts/alertas.md)'
);

select lives_ok(
  format($$select private.marcar_conexion_activa('%s')$$, (select val from t_ids where key = 'conexion_x')),
  'marcar_conexion_activa no lanza error'
);

select is(
  (select estado from conexiones where id = (select val from t_ids where key = 'conexion_x')),
  'activa',
  'la conexión vuelve a activa sin ninguna acción del administrador (FR-013, R9)'
);

select throws_ok(
  $$select private.registrar_alerta('otro-tipo', 'd1111111-1111-1111-1111-111111111111', null, 'motivo cualquiera')$$,
  '22023',
  null,
  'registrar_alerta rechaza un tipo que no es tecnica ni credencial'
);

select lives_ok(
  format(
    $$select private.registrar_alerta('credencial', 'd1111111-1111-1111-1111-111111111111', '%s', 'usuario/clave inválidos')$$,
    (select val from t_ids where key = 'conexion_x')
  ),
  'registrar_alerta inserta una alerta de tipo credencial'
);

select lives_ok(
  $$select private.registrar_alerta('tecnica', null, null, 'servidor central sin espacio en disco')$$,
  'registrar_alerta acepta organizacion_id/conexion_id nulos para una falla técnica sin organización puntual'
);

-- ============================================================================
-- private.procesar_falla_orquestacion — motivo seguro y tipo explícito (014)
-- ============================================================================

select is(
  has_function_privilege('kestra_orquestacion', 'private.procesar_falla_orquestacion(uuid, uuid, text, text)', 'EXECUTE'),
  true,
  'kestra_orquestacion puede ejecutar el handler seguro de cuatro argumentos'
);

select is(
  has_function_privilege('authenticated', 'private.procesar_falla_orquestacion(uuid, uuid, text, text)', 'EXECUTE'),
  false,
  'authenticated no puede ejecutar el handler seguro de cuatro argumentos'
);

select lives_ok(
  format(
    $$select private.procesar_falla_orquestacion('d1111111-1111-1111-1111-111111111111', '%s', 'credencial', 'CREDENCIAL_INVALIDA:%s')$$,
    (select val from t_ids where key = 'conexion_x'),
    (select val from t_ids where key = 'conexion_x')
  ),
  'el handler conserva una clasificación de credencial y un motivo seguro'
);

select is(
  (select estado from conexiones where id = (select val from t_ids where key = 'conexion_x')),
  'credencial_invalida',
  'el handler seguro conserva el estado de credencial inválida'
);

select is(
  (select motivo from alertas where conexion_id = (select val from t_ids where key = 'conexion_x') order by id desc limit 1),
  'CREDENCIAL_INVALIDA:' || (select val::text from t_ids where key = 'conexion_x'),
  'el handler persiste únicamente el motivo seguro de credencial'
);

select lives_ok(
  format(
    $$select private.procesar_falla_orquestacion('d1111111-1111-1111-1111-111111111111', '%s', 'tecnica', 'FALLA_TECNICA_SANITIZADA')$$,
    (select val from t_ids where key = 'conexion_x')
  ),
  'el handler conserva una clasificación técnica con un motivo sanitizado'
);

select is(
  (select tipo || ':' || motivo from alertas where conexion_id = (select val from t_ids where key = 'conexion_x') order by id desc limit 1),
  'tecnica:FALLA_TECNICA_SANITIZADA',
  'el diagnóstico técnico persiste solo tipo y motivo permitidos, sin credencial'
);

select throws_ok(
  $$select private.procesar_falla_orquestacion('d1111111-1111-1111-1111-111111111111', 'd1111111-1111-1111-1111-111111111111', 'tecnica', 'detalle no sanitizado')$$,
  '22023',
  null,
  'el handler rechaza un motivo técnico que no pertenece al contrato sanitizado'
);

-- ============================================================================
-- Columnas *_vault_id: nunca legibles directo por authenticated (R4)
-- ============================================================================

select is(
  has_column_privilege('authenticated', 'conexiones', 'credencial_vault_id', 'SELECT'),
  false,
  'authenticated no tiene SELECT sobre conexiones.credencial_vault_id'
);
select is(
  has_column_privilege('authenticated', 'servidores_organizacion', 'credencial_ssh_vault_id', 'SELECT'),
  false,
  'authenticated no tiene SELECT sobre servidores_organizacion.credencial_ssh_vault_id'
);
select is(
  has_column_privilege('authenticated', 'servidores_organizacion', 'credencial_db_vault_id', 'SELECT'),
  false,
  'authenticated no tiene SELECT sobre servidores_organizacion.credencial_db_vault_id'
);

select set_config(
  'request.jwt.claims',
  json_build_object('sub', 'd1000000-0000-0000-0000-000000000001', 'role', 'authenticated')::text,
  true
);
set local role authenticated;

select throws_ok(
  $$select credencial_vault_id from conexiones$$,
  '42501',
  null,
  'un intento real de leer credencial_vault_id se rechaza (el grant es real, no solo teórico)'
);

reset role;

-- ============================================================================
-- RLS: servidores_organizacion y conexiones — aislamiento entre X e Y
-- ============================================================================

select set_config(
  'request.jwt.claims',
  json_build_object('sub', 'd1000000-0000-0000-0000-000000000001', 'role', 'authenticated')::text,
  true
);
set local role authenticated;

select is(
  (select count(*)::int from servidores_organizacion),
  1,
  'el administrador de X ve exactamente 1 servidor (el suyo)'
);
select is(
  (select organizacion_id from servidores_organizacion),
  'd1111111-1111-1111-1111-111111111111',
  'y es el de X, no el de Y'
);
select is(
  (select count(*)::int from conexiones),
  1,
  'el administrador de X ve exactamente 1 conexión (la suya)'
);

reset role;

select set_config(
  'request.jwt.claims',
  json_build_object('sub', 'd3000000-0000-0000-0000-000000000001', 'role', 'authenticated')::text,
  true
);
set local role authenticated;

select is(
  (select count(*)::int from servidores_organizacion),
  0,
  'un miembro de X sin rol administrador no ve el servidor de su propia organización (FR-009: gestión, no lectura de datos, restringida a admin)'
);
select is(
  (select count(*)::int from conexiones),
  0,
  'un miembro de X sin rol administrador no ve las conexiones de su propia organización'
);

reset role;

select set_config(
  'request.jwt.claims',
  json_build_object('sub', 'd5000000-0000-0000-0000-000000000005', 'role', 'authenticated')::text,
  true
);
set local role authenticated;

select is(
  (select count(*)::int from servidores_organizacion),
  2,
  'el superadmin ve los servidores de ambas organizaciones'
);
select is(
  (select count(*)::int from conexiones),
  2,
  'el superadmin ve las conexiones de ambas organizaciones'
);

reset role;

-- ============================================================================
-- RLS: excepciones_flow_generico — solo superadmin (FR-005)
-- ============================================================================

select set_config(
  'request.jwt.claims',
  json_build_object('sub', 'd1000000-0000-0000-0000-000000000001', 'role', 'authenticated')::text,
  true
);
set local role authenticated;

select throws_ok(
  $$insert into excepciones_flow_generico (organizacion_id, conector_id) values ('d1111111-1111-1111-1111-111111111111', 'conector-de-prueba')$$,
  '42501',
  null,
  'un administrador de organización no puede insertar una excepción (solo superadmin)'
);

reset role;

select set_config(
  'request.jwt.claims',
  json_build_object('sub', 'd5000000-0000-0000-0000-000000000005', 'role', 'authenticated')::text,
  true
);
set local role authenticated;

select lives_ok(
  $$insert into excepciones_flow_generico (organizacion_id, conector_id) values ('d1111111-1111-1111-1111-111111111111', 'conector-de-prueba')$$,
  'el superadmin sí puede insertar una excepción'
);

reset role;

select set_config(
  'request.jwt.claims',
  json_build_object('sub', 'd1000000-0000-0000-0000-000000000001', 'role', 'authenticated')::text,
  true
);
set local role authenticated;

select is(
  (select count(*)::int from excepciones_flow_generico),
  0,
  'un administrador de organización no puede ver excepciones tampoco (solo superadmin)'
);

reset role;

-- ============================================================================
-- RLS: alertas — superadmin ve todo, administrador solo credencial de su
-- propia organización (FR-012)
-- ============================================================================

select set_config(
  'request.jwt.claims',
  json_build_object('sub', 'd1000000-0000-0000-0000-000000000001', 'role', 'authenticated')::text,
  true
);
set local role authenticated;

select is(
  (select count(*)::int from alertas where tipo = 'credencial'),
  2,
  'el administrador de X ve las alertas de credencial de su propia organización'
);
select is(
  (select count(*)::int from alertas where tipo = 'tecnica'),
  0,
  'el administrador de X no ve la alerta técnica (audiencia exclusiva de quien opera la plataforma)'
);

reset role;

select set_config(
  'request.jwt.claims',
  json_build_object('sub', 'd2000000-0000-0000-0000-000000000001', 'role', 'authenticated')::text,
  true
);
set local role authenticated;

select is(
  (select count(*)::int from alertas),
  0,
  'el administrador de Y no ve ninguna alerta (todas son de X o sin organización)'
);

reset role;

select set_config(
  'request.jwt.claims',
  json_build_object('sub', 'd5000000-0000-0000-0000-000000000005', 'role', 'authenticated')::text,
  true
);
set local role authenticated;

select cmp_ok(
  (select count(*)::int from alertas),
  '>=',
  2,
  'el superadmin ve todas las alertas, incluida la técnica sin organización'
);

reset role;

select * from finish();

rollback;
