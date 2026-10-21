-- MSF-293 (F-VTA-37, SC-001): historial de ventas importado.
-- Cubre: tablas `dominio.historial_*` (RLS por organización/empresa/sección de `ventas`, ninguna
-- escritura para `authenticated`/`anon`, sin FKs ni disparadores a tablas vivas), la RPC
-- `solicitar_importacion_historial` (permiso, tipo, archivo, simultaneidad, `anon` sin ejecución),
-- `historial_ultimo_numero` y las funciones del worker (idempotencia, tienda desconocida, sin
-- grants directos). El fixture corre como postgres (RLS no aplica); las verificaciones, con el rol
-- que corresponda. Las llamadas del worker se hacen como postgres (dueño de las funciones, que no
-- es superusuario en el CI): el gate de rol se verifica con has_function_privilege, igual que en
-- backups_postgres.test.sql. `set session authorization` requiere superusuario y fallaría.
begin;

select plan(53);

insert into organizaciones (id, nombre) values
  ('11111111-1111-1111-1111-111111111111', 'Organización Uno'),
  ('22222222-2222-2222-2222-222222222222', 'Organización Dos');

insert into auth.users (id, email) values
  ('d1000000-0000-0000-0000-000000000011', 'admin-uno@example.com'),
  ('d1000000-0000-0000-0000-000000000012', 'mostrador-uno@example.com'),
  ('d1000000-0000-0000-0000-000000000013', 'deposito-uno@example.com'),
  ('d2000000-0000-0000-0000-000000000011', 'admin-dos@example.com');

insert into usuarios_organizacion (user_id, organizacion_id, rol_id) values
  ('d1000000-0000-0000-0000-000000000011', '11111111-1111-1111-1111-111111111111', 'administrador'),
  ('d1000000-0000-0000-0000-000000000012', '11111111-1111-1111-1111-111111111111', 'miembro'),
  ('d1000000-0000-0000-0000-000000000013', '11111111-1111-1111-1111-111111111111', 'miembro'),
  ('d2000000-0000-0000-0000-000000000011', '22222222-2222-2222-2222-222222222222', 'administrador');

insert into dominio.empresas (id, organizacion_id, nombre) values
  ('a1000000-0000-0000-0000-0000000000a1', '11111111-1111-1111-1111-111111111111', 'San Javucho'),
  ('a1000000-0000-0000-0000-0000000000a2', '11111111-1111-1111-1111-111111111111', 'Mundo JC'),
  ('a2000000-0000-0000-0000-0000000000a1', '22222222-2222-2222-2222-222222222222', 'Empresa Dos');

-- Mostrador y Depósito trabajan solo en la tienda San Javucho; `ventas` es por empresa activa:
-- mostrador = edición (matriz); a depósito su organización lo deja sin acceso (ver abajo).
insert into usuarios_empresas (user_id, empresa_id, organizacion_id, rol_id) values
  ('d1000000-0000-0000-0000-000000000012', 'a1000000-0000-0000-0000-0000000000a1', '11111111-1111-1111-1111-111111111111', 'mostrador'),
  ('d1000000-0000-0000-0000-000000000013', 'a1000000-0000-0000-0000-0000000000a1', '11111111-1111-1111-1111-111111111111', 'deposito');
insert into usuario_empresa_activa (user_id, empresa_id) values
  ('d1000000-0000-0000-0000-000000000012', 'a1000000-0000-0000-0000-0000000000a1'),
  ('d1000000-0000-0000-0000-000000000013', 'a1000000-0000-0000-0000-0000000000a1');

insert into dominio.historial_comprobantes (organizacion_id, empresa_id, tipo, numero, fecha, cliente_nombre, total) values
  ('11111111-1111-1111-1111-111111111111', 'a1000000-0000-0000-0000-0000000000a1', 'Factura', '9', '2020-01-10', 'Cliente Uno', 100),
  ('11111111-1111-1111-1111-111111111111', 'a1000000-0000-0000-0000-0000000000a1', 'Factura', '10', '2020-02-10', 'Cliente Dos', 200),
  ('11111111-1111-1111-1111-111111111111', 'a1000000-0000-0000-0000-0000000000a2', 'Factura', '11', '2020-03-10', 'Cliente Tres', 300),
  ('22222222-2222-2222-2222-222222222222', 'a2000000-0000-0000-0000-0000000000a1', 'Factura', '99', '2020-03-10', 'Cliente Otra Org', 999);
insert into dominio.historial_cotizaciones_dolar (organizacion_id, fecha, dolar_comprador, dolar_vendedor) values
  ('11111111-1111-1111-1111-111111111111', '2020-01-10', 59.5, 63.5),
  ('22222222-2222-2222-2222-222222222222', '2020-01-10', 1, 2);

-- Catálogo y conexión del importador. El catálogo lo crea la RPC al primer uso; el fixture lo
-- inserta para poder crear la conexión directamente (la FK exige que exista).
insert into sistemas_externos (id, descripcion)
values ('historial-ventas', 'Importación del historial de ventas del panel anterior (CSV/Excel), sin sistema externo real')
on conflict (id) do nothing;
insert into conexiones (id, organizacion_id, sistema_externo, credencial_vault_id) values
  ('c1000000-0000-0000-0000-0000000000c1', '11111111-1111-1111-1111-111111111111', 'historial-ventas', gen_random_uuid());
insert into storage.objects (bucket_id, name) values
  ('historial-importaciones', '11111111-1111-1111-1111-111111111111/comprobantes.csv'),
  ('historial-importaciones', '11111111-1111-1111-1111-111111111111/cobros.csv'),
  ('historial-importaciones', '11111111-1111-1111-1111-111111111111/cotizaciones.xlsx'),
  ('historial-importaciones', '22222222-2222-2222-2222-222222222222/comprobantes.csv');

create function pg_temp.como(p_user uuid) returns void language plpgsql as $$
begin
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
  set local role authenticated;
end $$;

-- ============================================================================
-- Estructura: esquema, RLS, sin FKs ni disparadores hacia tablas vivas (FR-001, FR-008)
-- ============================================================================

select is(
  (select count(*)::int from pg_tables where schemaname = 'dominio' and tablename like 'historial\_%'),
  3,
  'las tres tablas del historial viven en el esquema dominio'
);

select is(
  (select count(*)::int from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'dominio' and c.relname like 'historial\_%' and c.relrowsecurity),
  3,
  'las tres tablas del historial tienen RLS activado'
);

select is(
  (select count(*)::int from pg_constraint k
     join pg_class t on t.oid = k.conrelid join pg_namespace tn on tn.oid = t.relnamespace
     join pg_class r on r.oid = k.confrelid
    where k.contype = 'f' and tn.nspname = 'dominio' and t.relname like 'historial\_%'
      and r.relname not in ('organizaciones')),
  0,
  'el historial no tiene FKs a tablas vivas: empresa_id es una relación lógica (FR-008)'
);

select is(
  (select count(*)::int from pg_constraint k
     join pg_class r on r.oid = k.confrelid join pg_namespace rn on rn.oid = r.relnamespace
    where k.contype = 'f' and rn.nspname = 'dominio' and r.relname like 'historial\_%'),
  0,
  'ninguna tabla viva referencia al historial'
);

select is(
  (select count(*)::int from pg_trigger g
     join pg_class t on t.oid = g.tgrelid join pg_namespace n on n.oid = t.relnamespace
    where not g.tgisinternal and n.nspname = 'dominio' and t.relname like 'historial\_%'),
  0,
  'el historial no tiene disparadores'
);

-- ============================================================================
-- Administrador de la Uno: lee todas las tiendas de su organización, escribe nada
-- ============================================================================

select pg_temp.como('d1000000-0000-0000-0000-000000000011');

select is(
  (select count(*)::int from dominio.historial_comprobantes), 3,
  'el administrador ve los comprobantes de todas sus tiendas y de ninguna otra organización'
);

select throws_ok(
  $$ insert into dominio.historial_comprobantes (organizacion_id, empresa_id, numero, fecha, cliente_nombre, total)
     values ('11111111-1111-1111-1111-111111111111', 'a1000000-0000-0000-0000-0000000000a1', 'X', '2020-01-01', 'X', 1) $$,
  '42501', null, 'ni el administrador puede insertar en el historial'
);

select throws_ok(
  $$ update dominio.historial_comprobantes set total = 1 $$,
  '42501', null, 'ni el administrador puede modificar el historial'
);

select throws_ok(
  $$ delete from dominio.historial_comprobantes $$,
  '42501', null, 'ni el administrador puede borrar del historial'
);

select throws_ok(
  $$ insert into dominio.historial_cobros (organizacion_id, empresa_id, fecha, comprobante_numero, cliente_nombre, importe)
     values ('11111111-1111-1111-1111-111111111111', 'a1000000-0000-0000-0000-0000000000a1', '2020-01-01', 'X', 'X', 1) $$,
  '42501', null, 'los cobros archivados tampoco admiten inserción'
);

select throws_ok(
  $$ insert into dominio.historial_cotizaciones_dolar (organizacion_id, fecha, dolar_comprador, dolar_vendedor)
     values ('11111111-1111-1111-1111-111111111111', '2021-01-01', 1, 1) $$,
  '42501', null, 'las cotizaciones archivadas tampoco admiten inserción'
);

select is(
  (select count(*)::int from dominio.historial_cotizaciones_dolar), 1,
  'el administrador ve las cotizaciones de su organización'
);

-- ============================================================================
-- Aislamiento por empresa y por sección de ventas
-- ============================================================================

select pg_temp.como('d1000000-0000-0000-0000-000000000012');

select is(
  (select count(*)::int from dominio.historial_comprobantes), 2,
  'mostrador ve solo los comprobantes de su tienda asignada'
);

select is(
  (select count(*)::int from dominio.historial_cotizaciones_dolar), 1,
  'mostrador ve las cotizaciones (globales de la organización)'
);

select pg_temp.como('d1000000-0000-0000-0000-000000000013');

-- La matriz inicial le da a `deposito` lectura de la sección ventas (Roles.dc.html);
-- la organización lo configura "sin acceso" con su propia fila en permisos_rol. La escribe un
-- administrador: el fixture la inserta como postgres porque `authenticated` no tiene INSERT directo.
reset role;
insert into public.permisos_rol (organizacion_id, rol_id, seccion, nivel) values
  ('11111111-1111-1111-1111-111111111111', 'miembro', 'ventas', 'ninguno')
on conflict (organizacion_id, rol_id, seccion) do update set nivel = excluded.nivel;
select pg_temp.como('d1000000-0000-0000-0000-000000000013');

select is(
  (select count(*)::int from dominio.historial_comprobantes), 0,
  'depósito, configurado sin acceso a la sección ventas, no ve filas'
);

select is(
  (select count(*)::int from dominio.historial_cotizaciones_dolar), 0,
  'depósito tampoco ve las cotizaciones'
);

reset role;
set local role anon;

select throws_ok(
  $$ select count(*) from dominio.historial_comprobantes $$,
  '42501', null, 'anon no tiene privilegios sobre el historial'
);

-- ============================================================================
-- historial_ultimo_numero (FR-009)
-- ============================================================================

select pg_temp.como('d1000000-0000-0000-0000-000000000011');

select is(public.historial_ultimo_numero('comprobantes'), '11',
  'el último número es el mayor numéricamente (11 y no 9)');

select is(public.historial_ultimo_numero('comprobantes', 'a1000000-0000-0000-0000-0000000000a1'), '10',
  'el último número se puede pedir por tienda');

select is(public.historial_ultimo_numero('cobros'), null,
  'sin cobros importados el último número es nulo');

select throws_ok(
  $$ select public.historial_ultimo_numero('cotizaciones') $$,
  '22023', null, 'un tipo sin numeración se rechaza'
);

select pg_temp.como('d1000000-0000-0000-0000-000000000012');

select is(public.historial_ultimo_numero('comprobantes'), '10',
  'mostrador obtiene el último número solo de lo que su RLS le deja ver');

select ok(
  not has_function_privilege('anon', 'public.historial_ultimo_numero(text, uuid)', 'execute'),
  'anon no ejecuta historial_ultimo_numero'
);

-- ============================================================================
-- solicitar_importacion_historial (FR-003)
-- ============================================================================

select throws_ok(
  $$ select public.solicitar_importacion_historial('comprobantes', '11111111-1111-1111-1111-111111111111/comprobantes.csv') $$,
  '42501', null, 'quien no puede escribir en la organización no solicita importaciones'
);

select pg_temp.como('d1000000-0000-0000-0000-000000000011');

select throws_ok(
  $$ select public.solicitar_importacion_historial('ventas', '11111111-1111-1111-1111-111111111111/comprobantes.csv') $$,
  '22023', null, 'un tipo desconocido se rechaza'
);

select throws_ok(
  $$ select public.solicitar_importacion_historial('comprobantes', '11111111-1111-1111-1111-111111111111/no-existe.csv') $$,
  '22023', null, 'una planilla que no está en el bucket se rechaza'
);

select throws_ok(
  $$ select public.solicitar_importacion_historial('comprobantes', '22222222-2222-2222-2222-222222222222/comprobantes.csv') $$,
  '22023', null, 'una planilla de otra organización se rechaza'
);

select isnt(
  public.solicitar_importacion_historial('comprobantes', '11111111-1111-1111-1111-111111111111/comprobantes.csv'),
  null,
  'el administrador solicita la importación de comprobantes y recibe el id de la ejecución'
);

select throws_ok(
  $$ select public.solicitar_importacion_historial('comprobantes', '11111111-1111-1111-1111-111111111111/comprobantes.csv') $$,
  'P0001', null, 'una segunda importación simultánea del mismo tipo se rechaza (YA_EN_CURSO)'
);

select isnt(
  public.solicitar_importacion_historial('cotizaciones', '11111111-1111-1111-1111-111111111111/cotizaciones.xlsx'),
  null,
  'otro tipo no queda bloqueado por la importación en curso'
);

select isnt(
  public.solicitar_importacion_historial('cobros', '11111111-1111-1111-1111-111111111111/cobros.csv'),
  null,
  'los cobros se importan en paralelo a los demás tipos'
);

select pg_temp.como('d2000000-0000-0000-0000-000000000011');

select throws_ok(
  $$ select public.solicitar_importacion_historial('comprobantes', '22222222-2222-2222-2222-222222222222/comprobantes.csv') $$,
  'P0001', null, 'una organización sin la conexión historial-ventas no importa (SIN_CONEXION_HISTORIAL)'
);

reset role;

select ok(
  not has_function_privilege('anon', 'public.solicitar_importacion_historial(text, text)', 'execute'),
  'anon no ejecuta solicitar_importacion_historial'
);

select is(
  (select count(*)::int from ejecuciones_worker
    where organizacion_id = '11111111-1111-1111-1111-111111111111' and origen = 'manual'
      and actor = 'd1000000-0000-0000-0000-000000000011' and estado = 'en_curso'),
  3,
  'cada solicitud deja una ejecución manual auditable con su actor'
);

select is(
  (select count(*)::int from despachos_ejecucion d join ejecuciones_worker e on e.id = d.ejecucion_id
    where e.detalle ? 'archivo'),
  3,
  'cada solicitud deja su orden de despacho para Kestra'
);

-- ============================================================================
-- Funciones del worker (FR-005…FR-007): sin grants para la app, idempotentes
-- ============================================================================

select ok(
  not has_function_privilege('authenticated', 'private.importar_historial_lote(uuid, text, jsonb)', 'execute')
  and not has_function_privilege('anon', 'private.importar_historial_lote(uuid, text, jsonb)', 'execute'),
  'ni authenticated ni anon ejecutan el insertador del historial'
);

select ok(
  has_function_privilege('workers_orquestacion', 'private.importar_historial_lote(uuid, text, jsonb)', 'execute'),
  'los workers ejecutan el insertador del historial'
);

-- Rol worker de la organización Uno (como lo deja aprovisionar_servidor_organizacion).
create role worker_testhist nologin;
grant workers_orquestacion to worker_testhist;
grant usage on schema private to worker_testhist;
insert into servidores_organizacion
  (organizacion_id, host, usuario_ssh, credencial_ssh_vault_id, rol_db, credencial_db_vault_id)
values ('11111111-1111-1111-1111-111111111111', 'worker.test', 'ssh', gen_random_uuid(), 'worker_testhist', gen_random_uuid());

do $$
begin
  perform set_config('t.ejec_c', (select id::text from ejecuciones_worker where detalle->>'tipo' = 'comprobantes'), false);
  perform set_config('t.ejec_b', (select id::text from ejecuciones_worker where detalle->>'tipo' = 'cobros'), false);
  perform set_config('t.ejec_k', (select id::text from ejecuciones_worker where detalle->>'tipo' = 'cotizaciones'), false);
  -- Sin claims de la sesión anterior: el worker se identifica por su rol de base.
  perform set_config('request.jwt.claims', '', false);
end $$;

-- `detalle` forjado (iniciar_ejecucion_worker acepta cualquiera): archivo de otra organización.
update ejecuciones_worker set detalle = jsonb_set(detalle, '{archivo}', '"22222222-2222-2222-2222-222222222222/comprobantes.csv"')
where id = current_setting('t.ejec_k')::uuid;

-- (sin cambio de sesión: postgres es el dueño de la función)

select throws_ok(
  format($f$ select * from private.datos_importacion_historial('%s'::uuid) $f$, current_setting('t.ejec_k')),
  'P0001', null, 'un archivo de otra organización en el detalle se rechaza'
);
select throws_ok(
  format($f$ select * from private.importar_historial_lote('%s'::uuid, 'cotizaciones', '[]'::jsonb) $f$, current_setting('t.ejec_k')),
  'P0001', null, 'el insertador tampoco acepta un archivo de otra organización'
);

-- (sin cambio de sesión: postgres es el dueño de la función)
update ejecuciones_worker set detalle = jsonb_set(detalle, '{archivo}', '"11111111-1111-1111-1111-111111111111/cotizaciones.xlsx"')
where id = current_setting('t.ejec_k')::uuid;
-- (sin cambio de sesión: postgres es el dueño de la función)

select is(
  (select tipo from private.datos_importacion_historial(current_setting('t.ejec_c')::uuid)),
  'comprobantes',
  'el worker obtiene el tipo de su ejecución en curso'
);

select is(
  (select count(*)::int from private.empresas_importacion_historial(current_setting('t.ejec_c')::uuid)),
  2,
  'el worker obtiene las tiendas de su organización (y solo esas)'
);

select is(
  (select nuevas || '/' || existentes from private.importar_historial_lote(
    current_setting('t.ejec_c')::uuid, 'comprobantes',
    $j$[
      {"tienda":"San Javucho","tipo":"Factura","numero":"9","fecha":"2020-01-10","cliente_nombre":"Cliente Uno","total":100},
      {"tienda":" san javucho ","tipo":"Factura","numero":"12","fecha":"2020-04-10","cliente_nombre":"Cliente Nuevo","total":50}
    ]$j$::jsonb)),
  '1/1',
  'el lote inserta la fila nueva y cuenta la existente (tienda sin distinguir mayúsculas ni espacios)'
);

select is(
  (select nuevas || '/' || existentes from private.importar_historial_lote(
    current_setting('t.ejec_c')::uuid, 'comprobantes',
    $j$[
      {"tienda":"San Javucho","tipo":"Factura","numero":"9","fecha":"2020-01-10","cliente_nombre":"Cliente Uno","total":100},
      {"tienda":"San Javucho","tipo":"Factura","numero":"12","fecha":"2020-04-10","cliente_nombre":"Cliente Nuevo","total":50}
    ]$j$::jsonb)),
  '0/2',
  'reimportar el mismo lote no duplica filas (idempotente)'
);

select throws_ok(
  format($f$ select * from private.importar_historial_lote('%s'::uuid, 'comprobantes',
    '[{"tienda":"Tienda Inexistente","tipo":"Factura","numero":"77","fecha":"2020-05-10","cliente_nombre":"X","total":1}]'::jsonb) $f$,
    current_setting('t.ejec_c')),
  '22023', null, 'una tienda que no existe en la organización hace fallar el lote'
);

select throws_ok(
  format($f$ select * from private.importar_historial_lote('%s'::uuid, 'cobros', '[]'::jsonb) $f$,
    current_setting('t.ejec_c')),
  'P0001', null, 'el lote debe coincidir con el tipo de la ejecución'
);

select is(
  (select nuevas || '/' || existentes from private.importar_historial_lote(
    current_setting('t.ejec_b')::uuid, 'cobros',
    $j$[{"tienda":"Mundo JC","fecha":"2020-06-01","comprobante_numero":"11","cliente_nombre":"Cliente Tres","cuenta_cobro":"Caja","aprobado_por":"Ana","importe":300}]$j$::jsonb)),
  '1/0',
  'el worker importa cobros'
);

select is(
  (select nuevas || '/' || existentes from private.importar_historial_lote(
    current_setting('t.ejec_k')::uuid, 'cotizaciones',
    $j$[{"fecha":"2020-01-11","dolar_comprador":60,"dolar_vendedor":64,"cargado_por":"Ana"}]$j$::jsonb)),
  '1/0',
  'el worker importa cotizaciones'
);

select throws_ok(
  $$ select count(*) from dominio.historial_comprobantes $$,
  '42501', null, 'el rol del worker no tiene acceso directo a las tablas del historial'
);

-- (sin cambio de sesión: postgres es el dueño de la función)

-- Números con más de 18 dígitos siguen comparándose numéricamente (FR-009).
insert into dominio.historial_comprobantes
  (organizacion_id, empresa_id, tipo, numero, fecha, cliente_nombre, total) values
  ('11111111-1111-1111-1111-111111111111', 'a1000000-0000-0000-0000-0000000000a1', 'Factura', '9999999999999999999', '2020-04-11', 'Cliente Largo', 1),
  ('11111111-1111-1111-1111-111111111111', 'a1000000-0000-0000-0000-0000000000a1', 'Factura', '10000000000000000000', '2020-04-12', 'Cliente Largo', 1);
insert into dominio.historial_cobros
  (organizacion_id, empresa_id, fecha, comprobante_numero, cliente_nombre, importe) values
  ('11111111-1111-1111-1111-111111111111', 'a1000000-0000-0000-0000-0000000000a1', '2020-04-11', '9999999999999999999', 'Cliente Largo', 1),
  ('11111111-1111-1111-1111-111111111111', 'a1000000-0000-0000-0000-0000000000a1', '2020-04-12', '10000000000000000000', 'Cliente Largo', 1);

select pg_temp.como('d1000000-0000-0000-0000-000000000011');

select is(public.historial_ultimo_numero('comprobantes'), '10000000000000000000',
  'el último número de comprobante compara números de más de 18 dígitos correctamente');
select is(public.historial_ultimo_numero('cobros'), '10000000000000000000',
  'el último número de cobro compara números de más de 18 dígitos correctamente');
reset role;

select is(
  (select count(*)::int from dominio.historial_comprobantes where numero = '12'), 1,
  'el comprobante nuevo quedó una sola vez, con su número original'
);

select is(
  (select count(*)::int from dominio.historial_cobros where organizacion_id = '11111111-1111-1111-1111-111111111111'), 1,
  'el cobro importado quedó en su tabla'
);

select is(
  (select count(*)::int from dominio.historial_cotizaciones_dolar where organizacion_id = '11111111-1111-1111-1111-111111111111'), 2,
  'la cotización importada se suma a la existente'
);

select * from finish();
rollback;
