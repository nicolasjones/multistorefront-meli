-- Vías de carga de `dominio.clientes.condicion_iva`: alta y edición por la API (grant de columna +
-- RLS) y la importación de clientes (`aplicar_lote_clientes`). Datos inventados.
-- El fixture corre como postgres (RLS no aplica) y las verificaciones como "authenticated"
-- vía request.jwt.claims, igual que PostgREST.
begin;

select plan(29);

insert into organizaciones (id, nombre) values
  ('11111111-1111-1111-1111-111111111111', 'Organización Uno'),
  ('22222222-2222-2222-2222-222222222222', 'Organización Dos');

insert into auth.users (id, email) values
  ('e1000000-0000-0000-0000-000000000001', 'admin-condicion-iva@example.com'),
  ('e1000000-0000-0000-0000-000000000002', 'consulta-condicion-iva@example.com'),
  ('e2000000-0000-0000-0000-000000000001', 'admin-dos-condicion-iva@example.com');

insert into usuarios_organizacion (user_id, organizacion_id, rol_id, estado) values
  ('e1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'administrador', 'activo'),
  ('e1000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'consulta', 'activo'),
  ('e2000000-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', 'administrador', 'activo');

insert into dominio.empresas (id, organizacion_id, nombre) values
  ('a1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'Tienda Uno A');

create temporary table t_res (k text primary key, v jsonb);
grant all on t_res to authenticated, anon;

create function pg_temp.como(p_user uuid) returns void language plpgsql as $$
begin
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
  set local role authenticated;
end $$;

-- ============================================================================
-- Privilegios de columna
-- ============================================================================

select is(has_column_privilege('authenticated', 'dominio.clientes', 'condicion_iva', 'INSERT'), true,
  'authenticated puede insertar condicion_iva');
select is(has_column_privilege('authenticated', 'dominio.clientes', 'condicion_iva', 'UPDATE'), true,
  'authenticated puede actualizar condicion_iva');
select is(has_column_privilege('anon', 'dominio.clientes', 'condicion_iva', 'INSERT')
       or has_column_privilege('anon', 'dominio.clientes', 'condicion_iva', 'UPDATE'), false,
  'anon no escribe condicion_iva');

-- ============================================================================
-- API: alta y edición con la sesión del Administrador
-- ============================================================================

select pg_temp.como('e1000000-0000-0000-0000-000000000001');

select lives_ok(
  $$insert into dominio.clientes (organizacion_id, nombre, condicion_iva)
    values ('11111111-1111-1111-1111-111111111111', 'Cliente API', 'Responsable Inscripto')$$,
  'el alta por la API acepta condicion_iva'
);
select is(
  (select condicion_iva from dominio.clientes where nombre = 'Cliente API'),
  'Responsable Inscripto', 'la condición de IVA del alta queda guardada'
);
select lives_ok(
  $$update dominio.clientes set condicion_iva = 'Monotributo' where nombre = 'Cliente API'$$,
  'la edición por la API acepta condicion_iva'
);
select is(
  (select condicion_iva from dominio.clientes where nombre = 'Cliente API'),
  'Monotributo', 'la condición de IVA editada queda guardada'
);
select throws_ok(
  format($$update dominio.clientes set condicion_iva = %L where nombre = 'Cliente API'$$, repeat('x', 61)),
  '23514', null, 'más de 60 caracteres lo rechaza el check de la tabla'
);

-- ============================================================================
-- Negativos de seguridad
-- ============================================================================

-- Rol sin edición (consulta): ni alta ni edición de condicion_iva.
select pg_temp.como('e1000000-0000-0000-0000-000000000002');
select throws_ok(
  $$insert into dominio.clientes (organizacion_id, nombre, condicion_iva)
    values ('11111111-1111-1111-1111-111111111111', 'Cliente sin permiso', 'Exento')$$,
  '42501', null, 'un rol sin edición no inserta clientes con condicion_iva'
);
with u as (update dominio.clientes set condicion_iva = 'Exento' where nombre = 'Cliente API' returning 1)
  insert into t_res select 'u1', to_jsonb((select count(*) from u));
select is((select v from t_res where k = 'u1'), '0'::jsonb, 'un rol sin edición no actualiza condicion_iva (0 filas)');

-- Otra organización: no toca clientes ajenos ni inserta con organizacion_id ajeno.
select pg_temp.como('e2000000-0000-0000-0000-000000000001');
with u as (update dominio.clientes set condicion_iva = 'Exento' where nombre = 'Cliente API' returning 1)
  insert into t_res select 'u2', to_jsonb((select count(*) from u));
select is((select v from t_res where k = 'u2'), '0'::jsonb, 'otra organización no actualiza condicion_iva de clientes ajenos (0 filas)');
select throws_ok(
  $$insert into dominio.clientes (organizacion_id, nombre, condicion_iva)
    values ('11111111-1111-1111-1111-111111111111', 'Cliente ajeno', 'Exento')$$,
  '42501', null, 'otra organización no inserta con organizacion_id ajeno'
);

-- anon: un insert real se rechaza por privilegios.
reset role;
set local role anon;
select throws_ok(
  $$insert into dominio.clientes (organizacion_id, nombre, condicion_iva)
    values ('11111111-1111-1111-1111-111111111111', 'Cliente anon', 'Exento')$$,
  '42501', null, 'anon no inserta clientes con condicion_iva'
);

reset role;
select is(
  (select condicion_iva from dominio.clientes where nombre = 'Cliente API'),
  'Monotributo', 'ningún intento negativo cambió la condición de IVA'
);

select pg_temp.como('e1000000-0000-0000-0000-000000000001');

-- ============================================================================
-- Importación (aplicar_lote_clientes)
-- ============================================================================

insert into t_res select 'carga', to_jsonb(public.iniciar_carga_migracion('clientes', 'clientes-iva.csv', 3));

insert into t_res select 'l1', public.aplicar_lote_clientes((select (v #>> '{}')::uuid from t_res where k = 'carga'), 1,
  '[{"fila":2,"id_externo":"IVA-001","nombre":"Importado Uno","condicion_iva":"Responsable Inscripto"},
    {"fila":3,"id_externo":"IVA-002","nombre":"Importado Dos"},
    {"fila":4,"id_externo":"IVA-003","nombre":"Importado Tres","condicion_iva":"0123456789012345678901234567890123456789012345678901234567890123456789"}]'::jsonb);

select is((select v ->> 'nuevos' from t_res where k = 'l1'), '2', 'se crean las dos filas válidas');
select is(
  (select jsonb_agg(x ->> 'fila') from jsonb_array_elements((select v -> 'errores' from t_res where k = 'l1')) x),
  '["4"]'::jsonb, 'la condición de IVA de más de 60 caracteres es error de esa fila'
);
select is(
  (select jsonb_agg(condicion_iva order by nombre) from dominio.clientes where nombre like 'Importado%'),
  '[null, "Responsable Inscripto"]'::jsonb,
  'la importación completa condicion_iva cuando la fila la trae (y la deja vacía si no)'
);

-- Reimportar: una celda con valor actualiza; una celda vacía no borra el dato existente.
insert into t_res select 'carga2', to_jsonb(public.iniciar_carga_migracion('clientes', 'clientes-iva-2.csv', 2));
insert into t_res select 'l2', public.aplicar_lote_clientes((select (v #>> '{}')::uuid from t_res where k = 'carga2'), 1,
  '[{"fila":2,"id_externo":"IVA-001","nombre":"Importado Uno","condicion_iva":""},
    {"fila":3,"id_externo":"IVA-002","nombre":"Importado Dos","condicion_iva":"Exento"}]'::jsonb);

select is((select v ->> 'actualizados' from t_res where k = 'l2'), '2', 'la reimportación actualiza las dos filas');
select is(
  (select condicion_iva from dominio.clientes where nombre = 'Importado Uno'),
  'Responsable Inscripto', 'una celda vacía no borra la condición de IVA existente'
);
select is(
  (select condicion_iva from dominio.clientes where nombre = 'Importado Dos'),
  'Exento', 'una celda con valor actualiza la condición de IVA'
);

-- ============================================================================
-- Bordes de la importación
-- ============================================================================

insert into t_res select 'carga3', to_jsonb(public.iniciar_carga_migracion('clientes', 'clientes-iva-3.csv', 6));
insert into t_res select 'l3', public.aplicar_lote_clientes((select (v #>> '{}')::uuid from t_res where k = 'carga3'), 1,
  format('[{"fila":2,"id_externo":"B-60","nombre":"Borde Sesenta","condicion_iva":%s},
           {"fila":3,"id_externo":"B-61","nombre":"Borde Sesenta y uno","condicion_iva":%s},
           {"fila":4,"id_externo":"B-ESP","nombre":"Borde Espacios","condicion_iva":"   "},
           {"fila":5,"id_externo":"B-NUL","nombre":"Borde Nulo","condicion_iva":null}]',
    to_json(repeat('a', 60)), to_json(repeat('b', 61)))::jsonb);

select is((select v ->> 'nuevos' from t_res where k = 'l3'), '3', '60 caracteres, solo espacios y null se aceptan');
select is(
  (select jsonb_agg(x ->> 'fila') from jsonb_array_elements((select v -> 'errores' from t_res where k = 'l3')) x),
  '["3"]'::jsonb, '61 caracteres es error solo de esa fila'
);
select is((select length(condicion_iva) from dominio.clientes where nombre = 'Borde Sesenta'), 60, '60 caracteres queda guardado completo');
select is((select count(*) from dominio.clientes where nombre = 'Borde Sesenta y uno'), 0::bigint, 'la fila de 61 caracteres no crea el cliente');
select is(
  (select jsonb_agg(condicion_iva order by nombre) from dominio.clientes where nombre in ('Borde Espacios', 'Borde Nulo')),
  '[null, null]'::jsonb, 'solo espacios y null quedan en null sin error'
);

-- Reimportar con 61 caracteres no pisa el dato existente.
insert into t_res select 'carga4', to_jsonb(public.iniciar_carga_migracion('clientes', 'clientes-iva-4.csv', 2));
insert into t_res select 'l4', public.aplicar_lote_clientes((select (v #>> '{}')::uuid from t_res where k = 'carga4'), 1,
  format('[{"fila":2,"id_externo":"B-60","nombre":"Borde Sesenta","condicion_iva":%s}]', to_json(repeat('c', 61)))::jsonb);
select is((select jsonb_array_length(v -> 'errores') from t_res where k = 'l4'), 1, 'reimportar con 61 caracteres es error de fila');
select is((select condicion_iva from dominio.clientes where nombre = 'Borde Sesenta'), repeat('a', 60), 'reimportar con 61 no pisa el valor existente');

-- Rol sin permiso de escritura: aplicar_lote_clientes se rechaza.
select pg_temp.como('e1000000-0000-0000-0000-000000000002');
select throws_ok(
  $$select public.aplicar_lote_clientes((select (v #>> '{}')::uuid from t_res where k = 'carga3'), 2,
    '[{"fila":2,"id_externo":"X-1","nombre":"Sin permiso","condicion_iva":"Exento"}]'::jsonb)$$,
  '42501', null, 'un rol sin escritura no aplica lotes de clientes'
);
reset role;
select is((select count(*) from dominio.clientes where nombre = 'Sin permiso'), 0::bigint, 'el lote rechazado no creó nada');

select * from finish();
rollback;
