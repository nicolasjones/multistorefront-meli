-- F-MIG-01 (MSF-299, épica MSF-142): importador de clientes desde el panel actual.
-- Cubre FR-005 (upsert por identificador externo), FR-006 (idempotencia y lote atómico),
-- FR-008 (cargas y filas), FR-009 (solo Administrador, aislamiento por organización, `anon` sin
-- acceso) y el informe de cierre. Datos inventados.
-- El fixture corre como postgres (RLS no aplica) y las verificaciones como "authenticated"
-- vía request.jwt.claims, igual que PostgREST.
begin;

select plan(45);

insert into organizaciones (id, nombre) values
  ('11111111-1111-1111-1111-111111111111', 'Organización Uno'),
  ('22222222-2222-2222-2222-222222222222', 'Organización Dos');

insert into auth.users (id, email) values
  ('e1000000-0000-0000-0000-000000000001', 'admin-uno-migracion@example.com'),
  ('e1000000-0000-0000-0000-000000000002', 'consulta-uno-migracion@example.com'),
  ('e2000000-0000-0000-0000-000000000001', 'admin-dos-migracion@example.com');

insert into usuarios_organizacion (user_id, organizacion_id, rol_id, estado) values
  ('e1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'administrador', 'activo'),
  ('e1000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'consulta', 'activo'),
  ('e2000000-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', 'administrador', 'activo');

insert into dominio.empresas (id, organizacion_id, nombre) values
  ('a1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'Tienda Uno A'),
  ('a1000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'Tienda Uno B'),
  ('a2000000-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', 'Tienda Dos');

create temporary table t_res (k text primary key, v jsonb);
grant all on t_res to authenticated, anon;

create function pg_temp.como(p_user uuid) returns void language plpgsql as $$
begin
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
  set local role authenticated;
end $$;

-- ============================================================================
-- Privilegios: sin escritura directa y sin acceso de `anon`
-- ============================================================================

select is(has_table_privilege('anon', 'public.migracion_cargas', 'SELECT'), false, 'anon no lee migracion_cargas');
select is(has_table_privilege('anon', 'public.migracion_filas', 'SELECT'), false, 'anon no lee migracion_filas');
select is(has_table_privilege('authenticated', 'public.migracion_cargas', 'INSERT'), false, 'authenticated no inserta directo en migracion_cargas');
select is(has_table_privilege('authenticated', 'public.migracion_filas', 'UPDATE'), false, 'authenticated no actualiza directo migracion_filas');
select is(
  (select bool_or(has_function_privilege('anon', p.oid, 'EXECUTE'))
     from pg_proc p
    where p.pronamespace = 'public'::regnamespace
      and p.proname in ('iniciar_carga_migracion', 'previsualizar_lote_clientes', 'aplicar_lote_clientes', 'cerrar_carga_migracion')),
  false,
  'anon no ejecuta ninguna RPC de migración'
);

-- ============================================================================
-- Rol: solo el Administrador migra
-- ============================================================================

select pg_temp.como('e1000000-0000-0000-0000-000000000002');

select throws_ok(
  $$select public.iniciar_carga_migracion('clientes', 'clientes.csv', 9)$$,
  '42501', null, 'un rol de consulta no puede iniciar una carga'
);
select throws_ok(
  $$select public.previsualizar_lote_clientes('[{"fila":2,"id_externo":"P-001","nombre":"X"}]'::jsonb)$$,
  '42501', null, 'un rol de consulta no puede previsualizar'
);

select pg_temp.como('e1000000-0000-0000-0000-000000000001');

select throws_ok(
  $$select public.iniciar_carga_migracion('productos', 'clientes.csv', 9)$$,
  '22023', null, 'una entidad desconocida se rechaza'
);

insert into t_res
select 'carga', to_jsonb(public.iniciar_carga_migracion('clientes', 'clientes-sinteticos.csv', 9));

select isnt(
  (select v #>> '{}' from t_res where k = 'carga'), null,
  'el Administrador inicia la carga y recibe su id'
);

-- Vista previa: clasifica sin escribir nada.
select is(
  (select jsonb_agg(x ->> 'estado' order by x ->> 'fila')
     from jsonb_array_elements(public.previsualizar_lote_clientes(
       '[{"fila":2,"id_externo":"P-001","nombre":"Cliente Uno Sintético","documento":"20-11111111-1"},
         {"fila":3,"id_externo":"P-002","nombre":"Cliente Dos Sintético"},
         {"fila":4,"id_externo":"P-003","nombre":""}]'::jsonb
     )) as x),
  '["nueva", "nueva", "error"]'::jsonb,
  'la vista previa clasifica nueva / nueva / error'
);
select is(
  (select count(*) from clientes where nombre like '%Sintético'),
  0::bigint,
  'la vista previa no escribe clientes'
);

-- ============================================================================
-- Aplicar el lote 1 (FR-005, FR-008)
-- ============================================================================

select pg_temp.como('e1000000-0000-0000-0000-000000000002');

select throws_ok(
  $$select public.aplicar_lote_clientes((select (v #>> '{}')::uuid from t_res where k = 'carga'), 1,
     '[{"fila":2,"id_externo":"P-001","nombre":"X"}]'::jsonb)$$,
  '42501', null, 'un rol de consulta no puede aplicar un lote'
);

select pg_temp.como('e2000000-0000-0000-0000-000000000001');

select throws_ok(
  $$select public.aplicar_lote_clientes((select (v #>> '{}')::uuid from t_res where k = 'carga'), 1,
     '[{"fila":2,"id_externo":"P-001","nombre":"X"}]'::jsonb)$$,
  'P0002', null, 'el Administrador de otra organización no encuentra la carga'
);

select pg_temp.como('e1000000-0000-0000-0000-000000000001');

select lives_ok(
  $$insert into t_res select 'l1', public.aplicar_lote_clientes((select (v #>> '{}')::uuid from t_res where k = 'carga'), 1,
     '[{"fila":2,"id_externo":"P-001","nombre":"Cliente Uno Sintético","documento":"20-11111111-1","correo":"uno@example.com","tipo":"Mayorista","localidad":"Rosario"},
       {"fila":3,"id_externo":"P-002","nombre":"Cliente Dos Sintético","documento":""},
       {"fila":4,"id_externo":"P-003","nombre":""},
       {"fila":5,"id_externo":"P-004","nombre":"Correo malo","correo":"noesmail"},
       {"fila":6,"id_externo":"","nombre":"Sin identificador"}]'::jsonb)$$,
  'se aplica el lote 1'
);

select is(
  (select v - 'errores' from t_res where k = 'l1'),
  '{"nuevos": 2, "actualizados": 0, "omitidos": 0}'::jsonb,
  'el lote 1 crea 2 clientes'
);
select is(
  (select jsonb_agg(e ->> 'motivo' order by (e ->> 'fila')::int) from t_res, jsonb_array_elements(v -> 'errores') as e where k = 'l1'),
  '["Falta el nombre o la razón social", "El correo no tiene un formato válido", "Falta el identificador del panel actual"]'::jsonb,
  'las filas inválidas vuelven con su motivo y no se importan'
);
select is(
  (select tipo from clientes where nombre = 'Cliente Uno Sintético'),
  'mayorista',
  'el tipo del archivo se normaliza y se guarda'
);
select is(
  (select c.nombre from clientes_identificadores_externos v join clientes c on c.id = v.cliente_id
    where v.sistema = 'panel_actual' and v.identificador_externo = 'P-001'),
  'Cliente Uno Sintético',
  'el cliente queda vinculado al identificador del panel actual'
);
select is(
  (select count(*) from clientes_empresas ce join clientes c on c.id = ce.cliente_id where c.nombre = 'Cliente Uno Sintético'),
  2::bigint,
  'el cliente nuevo queda habilitado en todas las tiendas de la organización'
);

-- ============================================================================
-- Idempotencia (FR-006): reaplicar el mismo lote no duplica
-- ============================================================================

select lives_ok(
  $$insert into t_res select 'l1b', public.aplicar_lote_clientes((select (v #>> '{}')::uuid from t_res where k = 'carga'), 1,
     '[{"fila":2,"id_externo":"P-001","nombre":"Cliente Uno Sintético","documento":"20-11111111-1","correo":"uno@example.com","tipo":"Mayorista","localidad":"Rosario"},
       {"fila":3,"id_externo":"P-002","nombre":"Cliente Dos Sintético","documento":""},
       {"fila":4,"id_externo":"P-003","nombre":""},
       {"fila":5,"id_externo":"P-004","nombre":"Correo malo","correo":"noesmail"},
       {"fila":6,"id_externo":"","nombre":"Sin identificador"}]'::jsonb)$$,
  'reaplicar el lote 1 no falla'
);
select is(
  (select v - 'errores' from t_res where k = 'l1b'),
  '{"nuevos": 0, "actualizados": 0, "omitidos": 2}'::jsonb,
  'el reintento omite lo ya aplicado'
);
select is(
  (select count(*) from clientes_identificadores_externos where sistema = 'panel_actual'),
  2::bigint,
  'no se duplican vínculos ni clientes'
);
select is(
  (select count(*) from migracion_filas where carga_id = (select (v #>> '{}')::uuid from t_res where k = 'carga')),
  5::bigint,
  'migracion_filas guarda el resultado de cada fila (una por fila del archivo)'
);

-- ============================================================================
-- Lote 2: actualización, documento repetido, identificador repetido
-- ============================================================================

select lives_ok(
  $$insert into t_res select 'l2', public.aplicar_lote_clientes((select (v #>> '{}')::uuid from t_res where k = 'carga'), 2,
     '[{"fila":9,"id_externo":"P-009","nombre":"Documento repetido","documento":"20111111111"},
       {"fila":10,"id_externo":"P-002","nombre":"Identificador repetido"}]'::jsonb)$$,
  'se aplica el lote 2'
);
select is(
  (select v - 'errores' from t_res where k = 'l2'),
  '{"nuevos": 0, "actualizados": 1, "omitidos": 0}'::jsonb,
  'un identificador ya vinculado en un lote anterior actualiza en vez de crear otro (FR-005)'
);
select is(
  (select v -> 'errores' from t_res where k = 'l2'),
  '[{"fila": 9, "motivo": "Ya existe un cliente con ese DNI/CUIT"}]'::jsonb,
  'documento repetido es error de fila; el identificador existente actualiza (FR-005)'
);
-- Actualización (FR-005): otra carga reimporta un identificador ya vinculado.
insert into t_res
select 'carga_act', to_jsonb(public.iniciar_carga_migracion('clientes', 'reimportacion.csv', 1));

select lives_ok(
  $$insert into t_res select 'l3', public.aplicar_lote_clientes((select (v #>> '{}')::uuid from t_res where k = 'carga_act'), 1,
     '[{"fila":2,"id_externo":"P-001","nombre":"Cliente Uno Renombrado","telefono":"341-555-0001","correo":"","localidad":" "}]'::jsonb)$$,
  'se aplica la reimportación'
);
select is(
  (select v - 'errores' from t_res where k = 'l3'),
  '{"nuevos": 0, "actualizados": 1, "omitidos": 0}'::jsonb,
  'un identificador ya vinculado actualiza el cliente en vez de crear otro'
);
select is(
  (select documento || ' / ' || telefono from clientes where nombre = 'Cliente Uno Renombrado'),
  '20-11111111-1 / 341-555-0001',
  'la actualización solo pisa las columnas que trae el archivo (el documento no mapeado queda)'
);
select is(
  (select correo || ' / ' || localidad from clientes where nombre = 'Cliente Uno Renombrado'),
  'uno@example.com / Rosario',
  'una celda vacía no borra el dato existente'
);

-- ============================================================================
-- Lote atómico: un error inesperado revierte todo el lote
-- ============================================================================

select throws_ok(
  $$select public.aplicar_lote_clientes((select (v #>> '{}')::uuid from t_res where k = 'carga'), 3,
     '[{"fila":7,"id_externo":"P-007","nombre":"Cliente Atómico"},{"id_externo":"P-008","nombre":"Sin número de fila"}]'::jsonb)$$,
  '22023', null, 'una fila sin número de fila aborta el lote'
);
select is(
  (select count(*) from clientes where nombre = 'Cliente Atómico'),
  0::bigint,
  'el lote abortado no dejó ninguna fila aplicada'
);

-- ============================================================================
-- Cierre: informe y estado (FR-008)
-- ============================================================================

select is(
  (select public.cerrar_carga_migracion((select (v #>> '{}')::uuid from t_res where k = 'carga')) ->> 'estado'),
  'fallida',
  'con filas sin aplicar, la carga queda fallida'
);
select lives_ok(
  $$select public.aplicar_lote_clientes((select (v #>> '{}')::uuid from t_res where k = 'carga'), 3,
     '[{"fila":7,"id_externo":"P-007","nombre":"Cliente Atómico"}]'::jsonb)$$,
  'el reintento completa lo pendiente'
);
select lives_ok(
  $$insert into t_res select 'informe', public.cerrar_carga_migracion((select (v #>> '{}')::uuid from t_res where k = 'carga'))$$,
  'se cierra la carga'
);
select is(
  (select jsonb_build_object('estado', v ->> 'estado', 'nuevos', v -> 'nuevos', 'actualizados', v -> 'actualizados', 'con_error', v -> 'con_error')
     from t_res where k = 'informe'),
  '{"estado": "aplicada", "nuevos": 3, "actualizados": 1, "con_error": 4}'::jsonb,
  'el informe cuadra con el archivo: 3 nuevos, 1 actualizado, 4 con error'
);
select is(
  (select estado || ' / ' || nuevos || ' / ' || actualizados || ' / ' || con_error from migracion_cargas
    where id = (select (v #>> '{}')::uuid from t_res where k = 'carga')),
  'aplicada / 3 / 1 / 4',
  'migracion_cargas registra estado y contadores'
);

-- ============================================================================
-- Aislamiento entre organizaciones y por rol
-- ============================================================================

select pg_temp.como('e2000000-0000-0000-0000-000000000001');

select is(
  (select count(*) from migracion_cargas) + (select count(*) from migracion_filas),
  0::bigint,
  'otra organización no ve cargas ni filas'
);

insert into t_res
select 'carga_dos', to_jsonb(public.iniciar_carga_migracion('clientes', 'otra-org.csv', 1));

select lives_ok(
  $$insert into t_res select 'dos', public.aplicar_lote_clientes((select (v #>> '{}')::uuid from t_res where k = 'carga_dos'), 1,
     '[{"fila":2,"id_externo":"P-001","nombre":"Intruso"}]'::jsonb)$$,
  'la otra organización aplica su lote'
);
select is(
  (select v -> 'errores' from t_res where k = 'dos'),
  '[{"fila": 2, "motivo": "El identificador ya está en uso"}]'::jsonb,
  'un identificador de otra organización no se pisa ni se revela que existe'
);
select is(
  (select count(*) from clientes where nombre in ('Intruso', 'Cliente Uno Renombrado')),
  0::bigint,
  'la otra organización no crea ni ve clientes de la primera'
);

select pg_temp.como('e1000000-0000-0000-0000-000000000002');

select is(
  (select count(*) from migracion_cargas),
  0::bigint,
  'un rol de consulta no lee las cargas'
);
select throws_ok(
  $$select public.cerrar_carga_migracion((select (v #>> '{}')::uuid from t_res where k = 'carga'))$$,
  '42501', null, 'un rol de consulta no puede cerrar una carga'
);

-- anon: sin acceso a las RPC.
reset role;
set local role anon;

select throws_ok(
  $$select public.iniciar_carga_migracion('clientes', 'x.csv', 1)$$,
  '42501', null, 'anon no puede iniciar una carga'
);
select throws_ok(
  $$select public.aplicar_lote_clientes('00000000-0000-0000-0000-000000000000', 1, '[]'::jsonb)$$,
  '42501', null, 'anon no puede aplicar un lote'
);

reset role;
select * from finish();
rollback;
