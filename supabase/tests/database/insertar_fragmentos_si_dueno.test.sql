-- Lote 41: public/private.insertar_fragmentos_si_dueno inserta los fragmentos de una versión solo si ésta sigue `procesando`
-- con el reclamo propio y es de la organización indicada; solo la ejecuta service_role. Datos inventados.
begin;

select plan(22);

insert into organizaciones (id, nombre) values
  ('e1111111-1111-1111-1111-111111111111', 'Org Inserta'),
  ('e2222222-2222-2222-2222-222222222222', 'Otra org inserta');
insert into auth.users (id, email) values ('e1000000-0000-0000-0000-000000000001', 'subidor-ins@example.com');

insert into documentos (id, organizacion_id, nombre, subido_por)
select ('e3000000-0000-0000-0000-00000000000' || n)::uuid, 'e1111111-1111-1111-1111-111111111111', n || '.pdf', 'e1000000-0000-0000-0000-000000000001'
  from generate_series(1, 5) n;

-- 1 propia (procesando con el reclamo), 2 retomada por otra, 3 activa, 4 fallida, 5 procesando sin reclamo.
insert into versiones_documento (id, documento_id, storage_path, estado, subida_por, motivo_error) values
  ('e4000000-0000-0000-0000-000000000001', 'e3000000-0000-0000-0000-000000000001', 'r1', 'procesando', 'e1000000-0000-0000-0000-000000000001', 'reclamo-propio'),
  ('e4000000-0000-0000-0000-000000000002', 'e3000000-0000-0000-0000-000000000002', 'r2', 'procesando', 'e1000000-0000-0000-0000-000000000001', 'reclamo-de-otra'),
  ('e4000000-0000-0000-0000-000000000003', 'e3000000-0000-0000-0000-000000000003', 'r3', 'activa', 'e1000000-0000-0000-0000-000000000001', null),
  ('e4000000-0000-0000-0000-000000000004', 'e3000000-0000-0000-0000-000000000004', 'r4', 'fallida', 'e1000000-0000-0000-0000-000000000001', 'No pudimos'),
  ('e4000000-0000-0000-0000-000000000005', 'e3000000-0000-0000-0000-000000000005', 'r5', 'procesando', 'e1000000-0000-0000-0000-000000000001', null);

create temp table filas as
select jsonb_agg(jsonb_build_object('texto', 'texto ' || n, 'embedding', '[' || array_to_string(array_fill(0, array[1536]), ',') || ']', 'orden', n) order by n) as j
  from generate_series(1, 3) n;

-- Privilegios: solo service_role; la función privada no se otorga a nadie (el envoltorio la llama como dueño).
select is(has_function_privilege('service_role', 'public.insertar_fragmentos_si_dueno(uuid, uuid, text, jsonb)', 'execute'), true, 'service_role ejecuta la función pública');
select is(has_function_privilege('authenticated', 'public.insertar_fragmentos_si_dueno(uuid, uuid, text, jsonb)', 'execute'), false, 'authenticated no ejecuta la función pública');
select is(has_function_privilege('anon', 'public.insertar_fragmentos_si_dueno(uuid, uuid, text, jsonb)', 'execute'), false, 'anon no ejecuta la función pública');
select is(has_function_privilege('service_role', 'private.insertar_fragmentos_si_dueno(uuid, uuid, text, jsonb)', 'execute'), false, 'service_role no ejecuta la función privada directamente');
select is(has_function_privilege('authenticated', 'private.insertar_fragmentos_si_dueno(uuid, uuid, text, jsonb)', 'execute'), false, 'authenticated no ejecuta la función privada');
select is(has_function_privilege('anon', 'private.insertar_fragmentos_si_dueno(uuid, uuid, text, jsonb)', 'execute'), false, 'anon no ejecuta la función privada');

-- Definición endurecida.
select is((select prosecdef from pg_proc where oid = 'private.insertar_fragmentos_si_dueno(uuid, uuid, text, jsonb)'::regprocedure), true, 'la función privada es security definer');
select is((select proconfig from pg_proc where oid = 'private.insertar_fragmentos_si_dueno(uuid, uuid, text, jsonb)'::regprocedure), array['search_path=""'], 'la función privada fija search_path vacío');
select is((select proconfig from pg_proc where oid = 'public.insertar_fragmentos_si_dueno(uuid, uuid, text, jsonb)'::regprocedure), array['search_path=""'], 'la función pública fija search_path vacío');

-- No es dueña: no se inserta nada.
select is(public.insertar_fragmentos_si_dueno('e4000000-0000-0000-0000-000000000002', 'e1111111-1111-1111-1111-111111111111', 'reclamo-propio', (select j from filas)), false, 'retomada por otra invocación: no inserta');
select is(public.insertar_fragmentos_si_dueno('e4000000-0000-0000-0000-000000000003', 'e1111111-1111-1111-1111-111111111111', 'reclamo-propio', (select j from filas)), false, 'versión activa: no inserta');
select is(public.insertar_fragmentos_si_dueno('e4000000-0000-0000-0000-000000000004', 'e1111111-1111-1111-1111-111111111111', 'reclamo-propio', (select j from filas)), false, 'versión fallida: no inserta');
select is(public.insertar_fragmentos_si_dueno('e4000000-0000-0000-0000-000000000005', 'e1111111-1111-1111-1111-111111111111', 'reclamo-propio', (select j from filas)), false, 'procesando sin reclamo: no inserta');
select is(public.insertar_fragmentos_si_dueno('00000000-0000-0000-0000-00000000dead', 'e1111111-1111-1111-1111-111111111111', 'reclamo-propio', (select j from filas)), false, 'versión inexistente: false');
select is(public.insertar_fragmentos_si_dueno('e4000000-0000-0000-0000-000000000001', 'e2222222-2222-2222-2222-222222222222', 'reclamo-propio', (select j from filas)), false, 'otra organización: no inserta aunque el reclamo coincida');
select is(public.insertar_fragmentos_si_dueno('e4000000-0000-0000-0000-000000000001', 'e1111111-1111-1111-1111-111111111111', 'reclamo-ajeno', (select j from filas)), false, 'reclamo que no es el de la versión: no inserta');
select is((select count(*) from fragmentos_indexados where version_id::text like 'e4000000-%'), 0::bigint, 'ninguno de los intentos fallidos insertó fragmentos');

-- p_filas inválido.
select throws_ok($$select public.insertar_fragmentos_si_dueno('e4000000-0000-0000-0000-000000000001', 'e1111111-1111-1111-1111-111111111111', 'reclamo-propio', '{"a":1}'::jsonb)$$, '22023', null, 'p_filas que no es un arreglo: 22023');

-- Dueña: inserta con la versión y la organización de la función, y el vector se guarda.
select is(public.insertar_fragmentos_si_dueno('e4000000-0000-0000-0000-000000000001', 'e1111111-1111-1111-1111-111111111111', 'reclamo-propio', (select j from filas)), true, 'procesando con el reclamo propio: es dueña e inserta');
select is((select array_agg(orden order by orden) from fragmentos_indexados where version_id = 'e4000000-0000-0000-0000-000000000001' and organizacion_id = 'e1111111-1111-1111-1111-111111111111'), array[1, 2, 3], 'se insertaron las 3 filas con la versión y la organización de la función');
select is((select vector_dims(embedding) from fragmentos_indexados where version_id = 'e4000000-0000-0000-0000-000000000001' limit 1), 1536, 'el embedding se guardó con 1536 dimensiones');

-- Sin filas: dueña igual y no inserta.
select is(public.insertar_fragmentos_si_dueno('e4000000-0000-0000-0000-000000000001', 'e1111111-1111-1111-1111-111111111111', 'reclamo-propio', '[]'::jsonb), true, 'sin filas: dueña igual (idempotente)');

select * from finish();
rollback;
