-- F-MIG-03 (MSF-330, épica MSF-142): archivo consultable del historial de ingresos de mercadería.
-- Cubre FR-030 (carga idempotente por id_externo), FR-031 (solo lectura: escritura directa
-- rechazada, `anon` sin acceso, solo Administrador carga), FR-032 (stock e ingresos vivos intactos)
-- y aislamiento por organización. Datos inventados.
begin;

select plan(34);

insert into organizaciones (id, nombre) values
  ('11111111-1111-1111-1111-111111111111', 'Organización Uno'),
  ('22222222-2222-2222-2222-222222222222', 'Organización Dos');

insert into auth.users (id, email) values
  ('e1000000-0000-0000-0000-000000000001', 'admin-uno-archivo@example.com'),
  ('e1000000-0000-0000-0000-000000000002', 'consulta-uno-archivo@example.com'),
  ('e2000000-0000-0000-0000-000000000001', 'admin-dos-archivo@example.com');

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

-- Estado de stock antes de cargar (FR-032).
insert into t_res
select 'antes', jsonb_build_object(
  'existencias', (select count(*) from dominio.existencias),
  'movimientos', (select count(*) from dominio.movimientos_stock),
  'ingresos', (select count(*) from dominio.ingresos_mercaderia),
  'lineas', (select count(*) from dominio.ingresos_mercaderia_lineas)
);

-- ============================================================================
-- Privilegios: solo lectura y sin acceso de `anon`
-- ============================================================================

select is(has_table_privilege('anon', 'dominio.archivo_ingresos_mercaderia', 'SELECT'), false, 'anon no lee el archivo');
select is(has_table_privilege('authenticated', 'dominio.archivo_ingresos_mercaderia', 'SELECT'), true, 'authenticated lee el archivo');
select is(has_table_privilege('authenticated', 'dominio.archivo_ingresos_mercaderia', 'INSERT'), false, 'authenticated no inserta directo');
select is(has_table_privilege('authenticated', 'dominio.archivo_ingresos_mercaderia', 'UPDATE'), false, 'authenticated no actualiza directo');
select is(has_table_privilege('authenticated', 'dominio.archivo_ingresos_mercaderia', 'DELETE'), false, 'authenticated no borra directo');
select is(
  (select bool_or(has_function_privilege('anon', p.oid, 'EXECUTE'))
     from pg_proc p
    where p.pronamespace = 'public'::regnamespace
      and p.proname in ('previsualizar_lote_archivo_ingresos', 'aplicar_lote_archivo_ingresos')),
  false,
  'anon no ejecuta las RPC del archivo'
);
select is(
  (select relrowsecurity from pg_class where oid = 'dominio.archivo_ingresos_mercaderia'::regclass),
  true,
  'el archivo tiene RLS activa'
);

-- ============================================================================
-- Rol: solo el Administrador carga
-- ============================================================================

select pg_temp.como('e1000000-0000-0000-0000-000000000002');

select throws_ok(
  $$select public.previsualizar_lote_archivo_ingresos('[{"fila":2,"id_externo":"ING-1"}]'::jsonb)$$,
  '42501', null, 'un rol de consulta no puede previsualizar'
);

select pg_temp.como('e1000000-0000-0000-0000-000000000001');

insert into t_res
select 'carga', to_jsonb(public.iniciar_carga_migracion('ingresos_archivo', 'ingresos-sinteticos.csv', 5));

select throws_ok(
  $$select public.aplicar_lote_archivo_ingresos((select (v #>> '{}')::uuid from t_res where k = 'carga'), 1, '"no es lista"'::jsonb)$$,
  '22023', null, 'las filas deben ser una lista'
);

-- ============================================================================
-- Vista previa: clasifica sin escribir
-- ============================================================================

select is(
  (select jsonb_agg(x ->> 'estado' order by (x ->> 'fila')::int)
     from jsonb_array_elements(public.previsualizar_lote_archivo_ingresos(
       '[{"fila":2,"id_externo":"ING-1","fecha":"2026-03-15","producto":"Producto Sintético","cantidad":"5","proveedor":"Proveedor Sintético","operador":"Operador Sintético"},
         {"fila":3,"id_externo":"ING-2","fecha":"16/03/2026","producto":"Otro Producto Sintético","cantidad":"2"},
         {"fila":4,"id_externo":"ING-3","fecha":"31/02/2026","producto":"X","cantidad":"1"},
         {"fila":5,"id_externo":"ING-4","fecha":"2026-03-17","producto":"X","cantidad":"0"},
         {"fila":6,"id_externo":"","fecha":"2026-03-17","producto":"X","cantidad":"1"}]'::jsonb
     )) as x),
  '["nueva", "nueva", "error", "error", "error"]'::jsonb,
  'la vista previa clasifica nueva / nueva / error (fecha imposible, cantidad 0, sin identificador)'
);
select is((select count(*) from dominio.archivo_ingresos_mercaderia), 0::bigint, 'la vista previa no escribe');

-- ============================================================================
-- Aplicar (FR-030)
-- ============================================================================

select pg_temp.como('e1000000-0000-0000-0000-000000000002');
select throws_ok(
  $$select public.aplicar_lote_archivo_ingresos((select (v #>> '{}')::uuid from t_res where k = 'carga'), 1,
     '[{"fila":2,"id_externo":"ING-1","fecha":"2026-03-15","producto":"X","cantidad":"1"}]'::jsonb)$$,
  '42501', null, 'un rol de consulta no puede aplicar un lote'
);

select pg_temp.como('e2000000-0000-0000-0000-000000000001');
select throws_ok(
  $$select public.aplicar_lote_archivo_ingresos((select (v #>> '{}')::uuid from t_res where k = 'carga'), 1,
     '[{"fila":2,"id_externo":"ING-1","fecha":"2026-03-15","producto":"X","cantidad":"1"}]'::jsonb)$$,
  'P0002', null, 'el Administrador de otra organización no encuentra la carga'
);

select pg_temp.como('e1000000-0000-0000-0000-000000000001');

select lives_ok(
  $$insert into t_res select 'l1', public.aplicar_lote_archivo_ingresos((select (v #>> '{}')::uuid from t_res where k = 'carga'), 1,
     '[{"fila":2,"id_externo":"ING-1","fecha":"2026-03-15","producto":"Producto Sintético","cantidad":"5","proveedor":"Proveedor Sintético","operador":"Operador Sintético"},
       {"fila":3,"id_externo":"ING-2","fecha":"16/03/2026","producto":"Otro Producto Sintético","cantidad":"2"},
       {"fila":4,"id_externo":"ING-3","fecha":"31/02/2026","producto":"X","cantidad":"1"},
       {"fila":5,"id_externo":"ING-1","fecha":"2026-03-17","producto":"Repetido","cantidad":"9"}]'::jsonb)$$,
  'se aplica el lote 1'
);
select is(
  (select v - 'errores' from t_res where k = 'l1'),
  '{"nuevos": 2, "actualizados": 0, "omitidos": 0}'::jsonb,
  'el lote 1 crea 2 filas del archivo'
);
select is(
  (select jsonb_agg(e ->> 'motivo' order by (e ->> 'fila')::int) from t_res, jsonb_array_elements(v -> 'errores') as e where k = 'l1'),
  '["La fecha no es válida (usá AAAA-MM-DD o DD/MM/AAAA)", "El identificador está repetido en el archivo"]'::jsonb,
  'fecha imposible e identificador repetido en el archivo son error de fila'
);
select is(
  (select producto || '|' || cantidad || '|' || proveedor || '|' || operador || '|' || fecha
     from dominio.archivo_ingresos_mercaderia where id_externo = 'ING-1'),
  'Producto Sintético|5|Proveedor Sintético|Operador Sintético|2026-03-15',
  'la fila queda con producto, cantidad, proveedor, operador (texto) y fecha'
);
select is(
  (select fecha from dominio.archivo_ingresos_mercaderia where id_externo = 'ING-2'),
  '2026-03-16'::date,
  'la fecha DD/MM/AAAA se normaliza'
);

-- ============================================================================
-- Idempotencia (FR-030): reaplicar no duplica
-- ============================================================================

select lives_ok(
  $$insert into t_res select 'l1b', public.aplicar_lote_archivo_ingresos((select (v #>> '{}')::uuid from t_res where k = 'carga'), 1,
     '[{"fila":2,"id_externo":"ING-1","fecha":"2026-03-15","producto":"Producto Sintético","cantidad":"5"},
       {"fila":3,"id_externo":"ING-2","fecha":"16/03/2026","producto":"Otro Producto Sintético","cantidad":"2"}]'::jsonb)$$,
  'reaplicar el lote 1 no falla'
);
select is(
  (select v - 'errores' from t_res where k = 'l1b'),
  '{"nuevos": 0, "actualizados": 0, "omitidos": 2}'::jsonb,
  'el reintento omite lo ya aplicado'
);

-- Otra carga con el mismo id_externo actualiza en vez de duplicar.
insert into t_res
select 'carga2', to_jsonb(public.iniciar_carga_migracion('ingresos_archivo', 'reimportacion.csv', 1));
select lives_ok(
  $$insert into t_res select 'l2', public.aplicar_lote_archivo_ingresos((select (v #>> '{}')::uuid from t_res where k = 'carga2'), 1,
     '[{"fila":2,"id_externo":"ING-1","fecha":"2026-03-15","producto":"Producto Sintético","cantidad":"7","operador":""}]'::jsonb)$$,
  'se aplica la reimportación'
);
select is(
  (select v - 'errores' from t_res where k = 'l2'),
  '{"nuevos": 0, "actualizados": 1, "omitidos": 0}'::jsonb,
  'un id_externo existente actualiza'
);
select is(
  (select count(*) || '|' || max(cantidad) || '|' || max(operador) from dominio.archivo_ingresos_mercaderia where id_externo = 'ING-1'),
  '1|7|Operador Sintético',
  'no se duplica y una celda vacía no borra el operador'
);

-- ============================================================================
-- Solo lectura (FR-031): escritura directa rechazada
-- ============================================================================

select throws_ok(
  $$insert into dominio.archivo_ingresos_mercaderia (id_externo, fecha, producto, cantidad)
    values ('DIRECTO', '2026-03-15', 'X', 1)$$,
  '42501', null, 'el Administrador no inserta directo'
);
select throws_ok(
  $$update dominio.archivo_ingresos_mercaderia set cantidad = 99$$,
  '42501', null, 'el Administrador no actualiza directo'
);
select throws_ok(
  $$delete from dominio.archivo_ingresos_mercaderia$$,
  '42501', null, 'el Administrador no borra directo'
);

-- ============================================================================
-- Aislamiento y stock intacto (FR-032)
-- ============================================================================

select pg_temp.como('e1000000-0000-0000-0000-000000000001');
select is((select count(*) from dominio.archivo_ingresos_mercaderia), 2::bigint, 'la organización dueña lee sus 2 filas');

select pg_temp.como('e2000000-0000-0000-0000-000000000001');
select is((select count(*) from dominio.archivo_ingresos_mercaderia), 0::bigint, 'otra organización no ve el archivo');

reset role;
select is(
  (select jsonb_build_object(
     'existencias', (select count(*) from dominio.existencias),
     'movimientos', (select count(*) from dominio.movimientos_stock),
     'ingresos', (select count(*) from dominio.ingresos_mercaderia),
     'lineas', (select count(*) from dominio.ingresos_mercaderia_lineas))),
  (select v from t_res where k = 'antes'),
  'la carga no modificó existencias, movimientos ni ingresos vivos'
);

-- Número de fila no entero: error claro 22023 (no un cast crudo)
select pg_temp.como('e1000000-0000-0000-0000-000000000001');
select throws_ok(
  $$select public.previsualizar_lote_archivo_ingresos('[{"fila":1.5,"id_externo":"X"}]'::jsonb)$$,
  '22023', 'Cada fila debe traer su número de fila (entero positivo)', 'la vista previa rechaza una fila decimal'
);
select throws_ok(
  $$select public.previsualizar_lote_archivo_ingresos('[{"fila":1e20,"id_externo":"X"}]'::jsonb)$$,
  '22023', 'Cada fila debe traer su número de fila (entero positivo)', 'la vista previa rechaza una fila fuera de rango'
);
select throws_ok(
  $$select public.aplicar_lote_archivo_ingresos((select (v #>> '{}')::uuid from t_res where k = 'carga'), 1,
     '[{"fila":1.5,"id_externo":"X","fecha":"2026-03-15","producto":"X","cantidad":"1"}]'::jsonb)$$,
  '22023', 'Cada fila debe traer su número de fila (entero positivo)', 'aplicar rechaza una fila decimal'
);

select throws_ok(
  $$select public.previsualizar_lote_archivo_ingresos('[{"fila":0,"id_externo":"X"}]'::jsonb)$$,
  '22023', 'Cada fila debe traer su número de fila (entero positivo)', 'la vista previa rechaza la fila 0'
);
select throws_ok(
  $$select public.aplicar_lote_archivo_ingresos((select (v #>> '{}')::uuid from t_res where k = 'carga'), 1,
     '[{"fila":0,"id_externo":"X","fecha":"2026-03-15","producto":"X","cantidad":"1"}]'::jsonb)$$,
  '22023', 'Cada fila debe traer su número de fila (entero positivo)', 'aplicar rechaza la fila 0'
);

select * from finish();
rollback;
