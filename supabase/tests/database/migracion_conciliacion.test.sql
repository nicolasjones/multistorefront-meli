-- F-MIG-04 (MSF-343, épica MSF-142): informe de conciliación de una carga de migración.
-- Cubre FR-040 (origen vs. cargado, diferencia calculada por el sistema, verificación contra el
-- destino), FR-042 / SC-004 (dos corridas del mismo archivo dan el mismo informe, sin duplicados)
-- y FR-044 / SC-006 (solo Administrador, aislamiento por organización, `anon` sin acceso).
-- Datos inventados. El fixture corre como postgres y las verificaciones como "authenticated"
-- vía request.jwt.claims, igual que PostgREST.
begin;

select plan(24);

insert into organizaciones (id, nombre) values
  ('11111111-1111-1111-1111-111111111111', 'Organización Uno'),
  ('22222222-2222-2222-2222-222222222222', 'Organización Dos');

insert into auth.users (id, email) values
  ('e1000000-0000-0000-0000-000000000001', 'admin-uno-migconc@example.com'),
  ('e1000000-0000-0000-0000-000000000002', 'consulta-uno-migconc@example.com'),
  ('e2000000-0000-0000-0000-000000000001', 'admin-dos-migconc@example.com');

insert into usuarios_organizacion (user_id, organizacion_id, rol_id, estado) values
  ('e1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'administrador', 'activo'),
  ('e1000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'consulta', 'activo'),
  ('e2000000-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', 'administrador', 'activo');

create temporary table t_res (k text primary key, v jsonb);
grant all on t_res to authenticated, anon;

create function pg_temp.como(p_user uuid) returns void language plpgsql as $$
begin
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
  set local role authenticated;
end $$;

-- ============================================================================
-- Privilegios
-- ============================================================================

select is(
  has_function_privilege('anon', 'public.informe_conciliacion_migracion(uuid)', 'EXECUTE'),
  false,
  'anon no ejecuta el informe de conciliación'
);
select is(
  has_function_privilege('authenticated', 'public.informe_conciliacion_migracion(uuid)', 'EXECUTE'),
  true,
  'authenticated ejecuta el informe de conciliación'
);

-- ============================================================================
-- Clientes · primera corrida: 3 filas (2 válidas, 1 con error)
-- ============================================================================

select pg_temp.como('e1000000-0000-0000-0000-000000000001');

insert into t_res select 'c1', to_jsonb(public.iniciar_carga_migracion('clientes', 'clientes-sinteticos.csv', 3));
select lives_ok(
  $$select public.aplicar_lote_clientes((select (v #>> '{}')::uuid from t_res where k = 'c1'), 1,
     '[{"fila":2,"id_externo":"CLI-1","nombre":"Cliente Uno Sintético"},
       {"fila":3,"id_externo":"CLI-2","nombre":"Cliente Dos Sintético"},
       {"fila":4,"id_externo":"CLI-3","nombre":""}]'::jsonb)$$,
  'primera corrida: se aplica el lote de clientes'
);
select lives_ok(
  $$select public.cerrar_carga_migracion((select (v #>> '{}')::uuid from t_res where k = 'c1'))$$,
  'primera corrida: se cierra la carga'
);
insert into t_res select 'i1', public.informe_conciliacion_migracion((select (v #>> '{}')::uuid from t_res where k = 'c1'));

select is(
  (select v - 'carga' - 'creada_en' - 'cerrada_en' from t_res where k = 'i1'),
  '{"entidad": "clientes", "archivo": "clientes-sinteticos.csv", "estado": "aplicada",
    "origen": {"filas": 3},
    "cargado": {"nuevos": 2, "actualizados": 0, "con_error": 1, "omitidos": 0},
    "diferencia": 0,
    "destino": {"verificadas": 2, "diferencia": 0},
    "conciliado": true,
    "errores": [{"fila": 4, "motivo": "Falta el nombre o la razón social"}]}'::jsonb,
  'el informe cuadra: 2 nuevos + 0 actualizados + 1 con error = 3 filas del archivo, destino verificado'
);

-- ============================================================================
-- Clientes · segunda corrida del MISMO archivo (SC-004): sin duplicados
-- ============================================================================

insert into t_res select 'c2', to_jsonb(public.iniciar_carga_migracion('clientes', 'clientes-sinteticos.csv', 3));
select lives_ok(
  $$select public.aplicar_lote_clientes((select (v #>> '{}')::uuid from t_res where k = 'c2'), 1,
     '[{"fila":2,"id_externo":"CLI-1","nombre":"Cliente Uno Sintético"},
       {"fila":3,"id_externo":"CLI-2","nombre":"Cliente Dos Sintético"},
       {"fila":4,"id_externo":"CLI-3","nombre":""}]'::jsonb)$$,
  'segunda corrida: se vuelve a aplicar el mismo archivo'
);
select lives_ok(
  $$select public.cerrar_carga_migracion((select (v #>> '{}')::uuid from t_res where k = 'c2'))$$,
  'segunda corrida: se cierra la carga'
);
insert into t_res select 'i2', public.informe_conciliacion_migracion((select (v #>> '{}')::uuid from t_res where k = 'c2'));

select is(
  (select jsonb_build_array(v -> 'cargado', v -> 'diferencia', v -> 'conciliado') from t_res where k = 'i2'),
  '[{"nuevos": 0, "actualizados": 2, "con_error": 1, "omitidos": 0}, 0, true]'::jsonb,
  'la segunda corrida actualiza los 2 ya cargados, no crea ninguno y concilia sin diferencia'
);

reset role;
select is(
  (select count(*) from public.clientes where organizacion_id = '11111111-1111-1111-1111-111111111111'),
  2::bigint,
  'dos corridas no duplican clientes (SC-004)'
);

-- El informe es repetible: consultarlo de nuevo da lo mismo (solo lee).
select pg_temp.como('e1000000-0000-0000-0000-000000000001');
select is(
  public.informe_conciliacion_migracion((select (v #>> '{}')::uuid from t_res where k = 'c1')),
  (select v from t_res where k = 'i1'),
  'consultar de nuevo el informe de una carga devuelve lo mismo'
);

-- ============================================================================
-- Carga incompleta: faltan filas => omitidos y diferencia distinta de cero
-- ============================================================================

insert into t_res select 'c3', to_jsonb(public.iniciar_carga_migracion('clientes', 'clientes-incompleto.csv', 3));
select lives_ok(
  $$select public.aplicar_lote_clientes((select (v #>> '{}')::uuid from t_res where k = 'c3'), 1,
     '[{"fila":2,"id_externo":"CLI-1","nombre":"Cliente Uno Sintético"}]'::jsonb)$$,
  'se aplica solo una fila de las 3 declaradas'
);
select is(
  (select jsonb_build_array(x -> 'diferencia', x -> 'cargado' -> 'omitidos', x -> 'conciliado')
     from (select public.informe_conciliacion_migracion((select (v #>> '{}')::uuid from t_res where k = 'c3')) as x) q),
  '[2, 2, false]'::jsonb,
  'una carga a medias informa 2 filas omitidas, diferencia 2 y no conciliada'
);

-- ============================================================================
-- Destino alterado: el informe lo detecta aunque los contadores de la carga digan que está bien
-- ============================================================================

reset role;
delete from public.clientes_identificadores_externos
 where sistema = 'panel_actual' and identificador_externo = 'CLI-2';
select pg_temp.como('e1000000-0000-0000-0000-000000000001');
select is(
  (select jsonb_build_array(x -> 'destino' -> 'verificadas', x -> 'destino' -> 'diferencia', x -> 'conciliado')
     from (select public.informe_conciliacion_migracion((select (v #>> '{}')::uuid from t_res where k = 'c1')) as x) q),
  '[1, 1, false]'::jsonb,
  'si falta un vínculo en el destino, la verificación lo marca y la carga deja de estar conciliada'
);

-- ============================================================================
-- Proveedores y archivo de ingresos: verificación contra su tabla destino
-- ============================================================================

insert into t_res select 'p1', to_jsonb(public.iniciar_carga_migracion('proveedores', 'proveedores-sinteticos.csv', 2));
select lives_ok(
  $$select public.aplicar_lote_proveedores((select (v #>> '{}')::uuid from t_res where k = 'p1'), 1,
     '[{"fila":2,"id_externo":"PRV-1","razon_social":"Proveedor Uno Sintético SRL","cuit":"30-90000011-8"},
       {"fila":3,"id_externo":"PRV-2","razon_social":"Proveedor Dos Sintético SRL","cuit":"30900000126"}]'::jsonb)$$,
  'se aplican los proveedores'
);
select public.cerrar_carga_migracion((select (v #>> '{}')::uuid from t_res where k = 'p1'));
select is(
  (select jsonb_build_array(x -> 'conciliado', x -> 'destino' -> 'verificadas')
     from (select public.informe_conciliacion_migracion((select (v #>> '{}')::uuid from t_res where k = 'p1')) as x) q),
  '[true, 2]'::jsonb,
  'proveedores: 2 filas aplicadas, 2 verificadas en dominio.proveedores'
);

insert into t_res select 'a1', to_jsonb(public.iniciar_carga_migracion('ingresos_archivo', 'ingresos-sinteticos.csv', 2));
select lives_ok(
  $$select public.aplicar_lote_archivo_ingresos((select (v #>> '{}')::uuid from t_res where k = 'a1'), 1,
     '[{"fila":2,"id_externo":"ING-1","fecha":"2026-03-15","producto":"Producto Sintético","cantidad":"5","operador":"Operador Uno"},
       {"fila":3,"id_externo":"ING-2","fecha":"2026-03-16","producto":"Producto Sintético","cantidad":"0"}]'::jsonb)$$,
  'se aplica el archivo de ingresos'
);
select public.cerrar_carga_migracion((select (v #>> '{}')::uuid from t_res where k = 'a1'));
select is(
  (select jsonb_build_array(x -> 'conciliado', x -> 'cargado' -> 'nuevos', x -> 'cargado' -> 'con_error', x -> 'destino' -> 'verificadas')
     from (select public.informe_conciliacion_migracion((select (v #>> '{}')::uuid from t_res where k = 'a1')) as x) q),
  '[true, 1, 1, 1]'::jsonb,
  'archivo de ingresos: 1 nuevo, 1 con error, 1 verificada en el archivo'
);

-- ============================================================================
-- Rol y aislamiento (FR-044)
-- ============================================================================

select pg_temp.como('e1000000-0000-0000-0000-000000000002');
select throws_ok(
  $$select public.informe_conciliacion_migracion((select (v #>> '{}')::uuid from t_res where k = 'c1'))$$,
  '42501', null, 'un rol de consulta no puede pedir el informe'
);

select pg_temp.como('e2000000-0000-0000-0000-000000000001');
select throws_ok(
  $$select public.informe_conciliacion_migracion((select (v #>> '{}')::uuid from t_res where k = 'c1'))$$,
  'P0002', null, 'el Administrador de otra organización no encuentra la carga'
);
select throws_ok(
  $$select public.informe_conciliacion_migracion('00000000-0000-0000-0000-000000000000')$$,
  'P0002', null, 'una carga inexistente no se encuentra'
);

-- La otra organización, con el MISMO identificador externo, no mezcla destinos.
insert into t_res select 'd1', to_jsonb(public.iniciar_carga_migracion('proveedores', 'proveedores-dos.csv', 1));
select lives_ok(
  $$select public.aplicar_lote_proveedores((select (v #>> '{}')::uuid from t_res where k = 'd1'), 1,
     '[{"fila":2,"id_externo":"PRV-1","razon_social":"Proveedor Org Dos Sintético","cuit":"30900000118"}]'::jsonb)$$,
  'la organización Dos carga un proveedor con el mismo id externo'
);
select public.cerrar_carga_migracion((select (v #>> '{}')::uuid from t_res where k = 'd1'));
select is(
  (select jsonb_build_array(x -> 'conciliado', x -> 'destino' -> 'verificadas')
     from (select public.informe_conciliacion_migracion((select (v #>> '{}')::uuid from t_res where k = 'd1')) as x) q),
  '[true, 1]'::jsonb,
  'la organización Dos concilia su propia carga sin mezclar destinos'
);

select pg_temp.como('e1000000-0000-0000-0000-000000000001');
select throws_ok(
  $$select public.informe_conciliacion_migracion((select (v #>> '{}')::uuid from t_res where k = 'd1'))$$,
  'P0002', null, 'la organización Uno no ve el informe de la organización Dos'
);

reset role;
select is(
  (select provolatile::text from pg_proc where proname = 'informe_conciliacion_migracion' and pronamespace = 'public'::regnamespace),
  's',
  'la función es stable: solo lee'
);

select * from finish();
rollback;
