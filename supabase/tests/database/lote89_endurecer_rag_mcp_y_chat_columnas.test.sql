-- Lote 89 (MSF-728, MSF-729, MSF-730; migración 20270507800000): unicidad de fragmentos, barrido de versiones atascadas,
-- vencimiento de ejecuciones MCP dentro de iniciar_ejecucion_mcp, una fila por funcionalidad en fuentes/acciones MCP y
-- `fuentes_chat_ia.columnas`. Datos inventados; la deduplicación y la verificación MCP se prueban con las mismas funciones que
-- usa la migración. Incluye el aislamiento entre organizaciones (políticas de escritura y deduplicación de fragmentos).
begin;

select plan(97);

insert into organizaciones (id, nombre) values
  ('f1111111-1111-1111-1111-111111111180', 'Org L89'),
  ('f2222222-2222-2222-2222-222222222280', 'Otra org L89');
insert into auth.users (id, email) values
  ('f1000000-0000-0000-0000-000000000080', 'subidor-l89@example.com'),
  ('f2000000-0000-0000-0000-000000000099', 'admin-otra-l89@example.com');
insert into usuarios_organizacion (user_id, organizacion_id, rol_id, estado) values
  ('f1000000-0000-0000-0000-000000000080', 'f1111111-1111-1111-1111-111111111180', 'administrador', 'activo'),
  ('f2000000-0000-0000-0000-000000000099', 'f2222222-2222-2222-2222-222222222280', 'administrador', 'activo');
insert into features (id, nombre) values ('busqueda-documental', 'Búsqueda documental') on conflict do nothing;
insert into organizaciones_features (feature_id, organizacion_id, habilitado_por) values
  ('busqueda-documental', 'f1111111-1111-1111-1111-111111111180', 'f1000000-0000-0000-0000-000000000080'),
  ('busqueda-documental', 'f2222222-2222-2222-2222-222222222280', 'f2000000-0000-0000-0000-000000000099')
  on conflict do nothing;
create or replace function pg_temp.como(p_user uuid) returns void language plpgsql as $f$
begin
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
  set local role authenticated;
end $f$;
insert into features (id, nombre) values ('mcp-servidor', 'MCP servidor'), ('f-l80', 'Funcionalidad L80'), ('f-l80-b', 'Funcionalidad L80 B')
  on conflict (id) do nothing;
insert into organizaciones_features (feature_id, organizacion_id, habilitado_por) values
  ('mcp-servidor', 'f1111111-1111-1111-1111-111111111180', 'f1000000-0000-0000-0000-000000000080'),
  ('f-l80', 'f1111111-1111-1111-1111-111111111180', 'f1000000-0000-0000-0000-000000000080'),
  ('f-l80-b', 'f1111111-1111-1111-1111-111111111180', 'f1000000-0000-0000-0000-000000000080')
  on conflict do nothing;
insert into capacidades_mcp (feature_id, lectura, ejecucion) values ('f-l80', true, true), ('f-l80-b', true, true)
  on conflict (feature_id) do update set ejecucion = true;
insert into credenciales_mcp (id, organizacion_id, hash, creada_por, revocada_en) values
  ('f2000000-0000-0000-0000-000000000001', 'f1111111-1111-1111-1111-111111111180', '\x01', 'f1000000-0000-0000-0000-000000000080', null),
  ('f2000000-0000-0000-0000-000000000002', 'f1111111-1111-1111-1111-111111111180', '\x02', 'f1000000-0000-0000-0000-000000000080', null),
  ('f2000000-0000-0000-0000-000000000003', 'f1111111-1111-1111-1111-111111111180', '\x03', 'f1000000-0000-0000-0000-000000000080', now());

insert into documentos (id, organizacion_id, nombre, subido_por)
  values ('f3000000-0000-0000-0000-000000000001', 'f1111111-1111-1111-1111-111111111180', 'l80.pdf', 'f1000000-0000-0000-0000-000000000080');

insert into documentos (id, organizacion_id, nombre, subido_por)
  values ('f3000000-0000-0000-0000-000000000002', 'f2222222-2222-2222-2222-222222222280', 'ajeno.pdf', 'f2000000-0000-0000-0000-000000000099');
insert into versiones_documento (id, documento_id, storage_path, estado, subida_por, motivo_error)
  values ('f4000000-0000-0000-0000-0000000000b1', 'f3000000-0000-0000-0000-000000000002', 'vb', 'procesando', 'f2000000-0000-0000-0000-000000000099', 'reclamo-b');

insert into documentos (id, organizacion_id, nombre, subido_por) values
  ('f3000000-0000-0000-0000-000000000003', 'f1111111-1111-1111-1111-111111111180', 'guardas.pdf', 'f1000000-0000-0000-0000-000000000080'),
  ('f3000000-0000-0000-0000-000000000004', 'f1111111-1111-1111-1111-111111111180', 'guardas2.pdf', 'f1000000-0000-0000-0000-000000000080');
insert into versiones_documento (id, documento_id, storage_path, estado, subida_por, motivo_error) values
  ('f4000000-0000-0000-0000-0000000000a9', 'f3000000-0000-0000-0000-000000000003', 'va', 'activa', 'f1000000-0000-0000-0000-000000000080', 'reclamo-igual'),
  ('f4000000-0000-0000-0000-0000000000aa', 'f3000000-0000-0000-0000-000000000004', 'vf', 'fallida', 'f1000000-0000-0000-0000-000000000080', 'reclamo-igual');

-- ===== A1: unicidad (version_id, orden) =====
insert into versiones_documento (id, documento_id, storage_path, estado, subida_por, motivo_error, subida_en) values
  ('f4000000-0000-0000-0000-000000000001', 'f3000000-0000-0000-0000-000000000001', 'v1', 'procesando', 'f1000000-0000-0000-0000-000000000080', null, now() - interval '40 minutes'),
  ('f4000000-0000-0000-0000-000000000002', 'f3000000-0000-0000-0000-000000000001', 'v2', 'procesando', 'f1000000-0000-0000-0000-000000000080', 'indexando:' || (extract(epoch from clock_timestamp()) * 1000)::bigint || ':vivo', now() - interval '40 minutes'),
  ('f4000000-0000-0000-0000-000000000003', 'f3000000-0000-0000-0000-000000000001', 'v3', 'procesando', 'f1000000-0000-0000-0000-000000000080', 'indexando:' || ((extract(epoch from clock_timestamp()) * 1000)::bigint - 20 * 60 * 1000) || ':vencido', now() - interval '40 minutes'),
  ('f4000000-0000-0000-0000-000000000004', 'f3000000-0000-0000-0000-000000000001', 'v4', 'procesando', 'f1000000-0000-0000-0000-000000000080', null, now() - interval '5 minutes'),
  ('f4000000-0000-0000-0000-000000000005', 'f3000000-0000-0000-0000-000000000001', 'v5', 'activa', 'f1000000-0000-0000-0000-000000000080', null, now() - interval '40 minutes'),
  ('f4000000-0000-0000-0000-000000000006', 'f3000000-0000-0000-0000-000000000001', 'v6', 'procesando', 'f1000000-0000-0000-0000-000000000080', 'indexando:basura:x', now() - interval '40 minutes'),
  ('f4000000-0000-0000-0000-0000000000f8', 'f3000000-0000-0000-0000-000000000001', 'v8', 'procesando', 'f1000000-0000-0000-0000-000000000080', 'indexando:' || ((extract(epoch from clock_timestamp()) * 1000)::bigint + 3600000) || ':futuro', now() - interval '40 minutes'),
  ('f4000000-0000-0000-0000-000000000007', 'f3000000-0000-0000-0000-000000000001', 'v7', 'procesando', 'f1000000-0000-0000-0000-000000000080', 'reclamo-propio', now() - interval '1 minute');

create temp table filas as
select jsonb_agg(jsonb_build_object('texto', 'texto ' || n, 'embedding', '[' || array_to_string(array_fill(0, array[1536]), ',') || ']', 'orden', n) order by n) as j
  from generate_series(1, 3) n;

select is(public.insertar_fragmentos_si_dueno('f4000000-0000-0000-0000-000000000007', 'f1111111-1111-1111-1111-111111111180', 'reclamo-propio', (select j from filas)), true, 'dueña: inserta 3 filas');
select is(public.insertar_fragmentos_si_dueno('f4000000-0000-0000-0000-000000000007', 'f1111111-1111-1111-1111-111111111180', 'reclamo-propio', (select j from filas)), true, 'reintento con las mismas filas: sigue devolviendo true (idempotente, sin 23505)');
select is((select count(*) from fragmentos_indexados where version_id = 'f4000000-0000-0000-0000-000000000007'), 3::bigint, 'el reintento no duplicó fragmentos');
select throws_ok($$insert into fragmentos_indexados (version_id, organizacion_id, texto, embedding, orden) select 'f4000000-0000-0000-0000-000000000007', 'f1111111-1111-1111-1111-111111111180', 'dup', embedding, 1 from fragmentos_indexados where version_id = 'f4000000-0000-0000-0000-000000000007' limit 1$$,
  '23505', 'duplicate key value violates unique constraint "fragmentos_indexados_version_orden_uidx"', 'un insert directo duplicado es rechazado por el índice único');
select is((select indisunique from pg_index where indexrelid = 'public.fragmentos_indexados_version_orden_uidx'::regclass), true, 'el índice sobre (version_id, orden) es único');

-- Deduplicación determinista (la misma función que corre la migración): sin el índice, con duplicados.
drop index public.fragmentos_indexados_version_orden_uidx;
insert into fragmentos_indexados (id, version_id, organizacion_id, texto, embedding, orden)
select ('f5000000-0000-0000-0000-00000000000' || n)::uuid, 'f4000000-0000-0000-0000-000000000007', 'f1111111-1111-1111-1111-111111111180', 'repetido ' || n, (select embedding from fragmentos_indexados where version_id = 'f4000000-0000-0000-0000-000000000007' limit 1), 1
  from generate_series(1, 3) n;
select is((select count(*) from fragmentos_indexados where version_id = 'f4000000-0000-0000-0000-000000000007' and orden = 1), 4::bigint, 'sin índice hay 4 fragmentos con orden 1');
select is(private.deduplicar_fragmentos_indexados(), 3::bigint, 'la deduplicación borra 3 repetidos');
select is((select count(*) from fragmentos_indexados where version_id = 'f4000000-0000-0000-0000-000000000007' and orden = 1), 1::bigint, 'queda uno por (version_id, orden)');
select is(private.deduplicar_fragmentos_indexados(), 0::bigint, 'la deduplicación es idempotente');
create unique index if not exists fragmentos_indexados_version_orden_uidx on public.fragmentos_indexados (version_id, orden);
select is((select count(*) from pg_indexes where indexname = 'fragmentos_indexados_version_orden_uidx'), 1::bigint, 'el índice único se recrea después de deduplicar');
drop index public.fragmentos_indexados_version_orden_uidx;
insert into fragmentos_indexados (id, version_id, organizacion_id, texto, embedding, orden) values
  ('00000000-0000-0000-0000-0000000000a2', 'f4000000-0000-0000-0000-000000000007', 'f1111111-1111-1111-1111-111111111180', 'segundo', (select embedding from fragmentos_indexados where version_id = 'f4000000-0000-0000-0000-000000000007' limit 1), 99),
  ('00000000-0000-0000-0000-0000000000a1', 'f4000000-0000-0000-0000-000000000007', 'f1111111-1111-1111-1111-111111111180', 'primero', (select embedding from fragmentos_indexados where version_id = 'f4000000-0000-0000-0000-000000000007' limit 1), 99);
select is(private.deduplicar_fragmentos_indexados(), 1::bigint, 'borra el repetido del caso controlado');
select is((select texto from fragmentos_indexados where version_id = 'f4000000-0000-0000-0000-000000000007' and orden = 99), 'primero', 'entre repetidos de la dueña conserva el de menor id (criterio determinista, no cronológico)');

-- Deduplicación entre organizaciones: el fragmento ajeno (org A dentro de la versión de la org B) se borra aunque tenga MENOR id
-- que el legítimo; el legítimo de la dueña se conserva. Un fragmento ajeno sin conflicto también se borra.
insert into fragmentos_indexados (id, version_id, organizacion_id, texto, embedding, orden) values
  ('00000000-0000-0000-0000-0000000000c1', 'f4000000-0000-0000-0000-0000000000b1', 'f1111111-1111-1111-1111-111111111180', 'ajeno que choca', (select embedding from fragmentos_indexados where version_id = 'f4000000-0000-0000-0000-000000000007' limit 1), 5),
  ('ffffffff-0000-0000-0000-0000000000c2', 'f4000000-0000-0000-0000-0000000000b1', 'f2222222-2222-2222-2222-222222222280', 'legítimo de la dueña', (select embedding from fragmentos_indexados where version_id = 'f4000000-0000-0000-0000-000000000007' limit 1), 5),
  ('00000000-0000-0000-0000-0000000000c3', 'f4000000-0000-0000-0000-0000000000b1', 'f1111111-1111-1111-1111-111111111180', 'ajeno sin choque', (select embedding from fragmentos_indexados where version_id = 'f4000000-0000-0000-0000-000000000007' limit 1), 6),
  ('ffffffff-0000-0000-0000-0000000000c4', 'f4000000-0000-0000-0000-0000000000b1', 'f2222222-2222-2222-2222-222222222280', 'legítimo 2 de la dueña', (select embedding from fragmentos_indexados where version_id = 'f4000000-0000-0000-0000-000000000007' limit 1), 7);
select is(private.deduplicar_fragmentos_indexados(), 2::bigint, 'borra los 2 fragmentos de otra organización dentro de la versión ajena');
select is((select array_agg(texto order by orden) from fragmentos_indexados where version_id = 'f4000000-0000-0000-0000-0000000000b1'), array['legítimo de la dueña', 'legítimo 2 de la dueña'], 'la dueña conserva todos sus fragmentos y el ajeno (de menor id) se fue');
select is((select count(*) from fragmentos_indexados where version_id = 'f4000000-0000-0000-0000-0000000000b1' and organizacion_id = 'f1111111-1111-1111-1111-111111111180'), 0::bigint, 'no queda ningún fragmento de la otra organización en la versión');
select is(private.deduplicar_fragmentos_indexados(), 0::bigint, 'la deduplicación entre organizaciones es idempotente');
create unique index if not exists fragmentos_indexados_version_orden_uidx on public.fragmentos_indexados (version_id, orden);

-- Un fragmento ajeno que ya ocupa un orden (instalación previa a esta migración) es sobrescrito por el dueño con el reclamo vigente.
insert into fragmentos_indexados (version_id, organizacion_id, texto, embedding, orden)
  select 'f4000000-0000-0000-0000-0000000000b1', 'f1111111-1111-1111-1111-111111111180', 'ajeno ocupando', embedding, 20 from fragmentos_indexados where version_id = 'f4000000-0000-0000-0000-000000000007' limit 1;
select is(public.insertar_fragmentos_si_dueno('f4000000-0000-0000-0000-0000000000b1', 'f2222222-2222-2222-2222-222222222280', 'reclamo-b',
  (select jsonb_agg(jsonb_build_object('texto', 'del dueño', 'embedding', '[' || array_to_string(array_fill(0, array[1536]), ',') || ']', 'orden', 20))) ), true, 'el dueño inserta sobre un orden ocupado por un ajeno');
select is((select organizacion_id::text || '/' || texto from fragmentos_indexados where version_id = 'f4000000-0000-0000-0000-0000000000b1' and orden = 20), 'f2222222-2222-2222-2222-222222222280/del dueño', 'el contenido y la organización del dueño reemplazan al ajeno (no se descarta en silencio)');

-- Conflicto parcial en la versión 7: una fila existente con texto distinto y una nueva.
select is(public.insertar_fragmentos_si_dueno('f4000000-0000-0000-0000-000000000007', 'f1111111-1111-1111-1111-111111111180', 'reclamo-propio',
  (select jsonb_agg(jsonb_build_object('texto', t.texto, 'embedding', '[' || array_to_string(array_fill(0, array[1536]), ',') || ']', 'orden', t.orden)) from (values ('texto cambiado', 1), ('texto nuevo', 50)) t(texto, orden))), true, 'lote con una fila existente (otro texto) y una nueva: true');
select is((select texto from fragmentos_indexados where version_id = 'f4000000-0000-0000-0000-000000000007' and orden = 1), 'texto cambiado', 'la fila existente toma el contenido del dueño (no conserva el viejo en silencio)');
select is((select texto from fragmentos_indexados where version_id = 'f4000000-0000-0000-0000-000000000007' and orden = 50), 'texto nuevo', 'la fila nueva se inserta');
select is((select count(*) from fragmentos_indexados where version_id = 'f4000000-0000-0000-0000-000000000007' and orden in (2, 3)), 2::bigint, 'el dueño legítimo no pierde sus demás fragmentos');
select throws_ok($$select public.insertar_fragmentos_si_dueno('f4000000-0000-0000-0000-000000000007', 'f1111111-1111-1111-1111-111111111180', 'reclamo-propio', '[{"texto":"a","embedding":"[0]","orden":7},{"texto":"b","embedding":"[0]","orden":7}]'::jsonb)$$,
  '22023', 'p_filas tiene valores de orden repetidos', 'orden repetido dentro de p_filas: 22023');
select is((select count(*) from fragmentos_indexados where version_id = 'f4000000-0000-0000-0000-000000000007' and orden = 7), 0::bigint, 'el lote rechazado no insertó nada');

-- Guarda de estado: una versión activa o fallida nunca recibe fragmentos aunque su motivo_error coincida con p_reclamo (con do update los
-- sobrescribiría); tampoco con p_reclamo nulo contra un motivo_error nulo.
insert into fragmentos_indexados (version_id, organizacion_id, texto, embedding, orden)
select v, 'f1111111-1111-1111-1111-111111111180', 'original', (select embedding from fragmentos_indexados where version_id = 'f4000000-0000-0000-0000-000000000007' limit 1), 0
  from unnest(array['f4000000-0000-0000-0000-0000000000a9', 'f4000000-0000-0000-0000-0000000000aa', 'f4000000-0000-0000-0000-000000000005']::uuid[]) v;
select is(public.insertar_fragmentos_si_dueno('f4000000-0000-0000-0000-0000000000a9', 'f1111111-1111-1111-1111-111111111180', 'reclamo-igual',
  (select jsonb_agg(jsonb_build_object('texto', 'pisado', 'embedding', '[' || array_to_string(array_fill(0, array[1536]), ',') || ']', 'orden', o)) from generate_series(0, 1) o)), false, 'versión activa con motivo_error igual al reclamo: no es dueña (false)');
select is(public.insertar_fragmentos_si_dueno('f4000000-0000-0000-0000-0000000000aa', 'f1111111-1111-1111-1111-111111111180', 'reclamo-igual',
  (select jsonb_agg(jsonb_build_object('texto', 'pisado', 'embedding', '[' || array_to_string(array_fill(0, array[1536]), ',') || ']', 'orden', o)) from generate_series(0, 1) o)), false, 'versión fallida con motivo_error igual al reclamo: no es dueña (false)');
select is(public.insertar_fragmentos_si_dueno('f4000000-0000-0000-0000-000000000005', 'f1111111-1111-1111-1111-111111111180', null,
  (select jsonb_agg(jsonb_build_object('texto', 'pisado', 'embedding', '[' || array_to_string(array_fill(0, array[1536]), ',') || ']', 'orden', o)) from generate_series(0, 1) o)), false, 'versión activa con motivo_error nulo y reclamo nulo: no es dueña (false)');
select is((select array_agg(texto || ':' || orden order by version_id, orden) from fragmentos_indexados where version_id in ('f4000000-0000-0000-0000-0000000000a9', 'f4000000-0000-0000-0000-0000000000aa', 'f4000000-0000-0000-0000-000000000005')), array['original:0', 'original:0', 'original:0'], 'los fragmentos de las versiones activa y fallida quedaron intactos y sin filas nuevas');

-- Otras guardas de insertar_fragmentos_si_dueno (versión 7: procesando con reclamo-propio): cada una rechaza y no toca nada.
select throws_ok($$select public.insertar_fragmentos_si_dueno('f4000000-0000-0000-0000-000000000007', 'f1111111-1111-1111-1111-111111111180', 'reclamo-propio', '{"a":1}'::jsonb)$$, '22023', 'p_filas debe ser un arreglo', 'p_filas que no es un arreglo: 22023');
select throws_ok($$select public.insertar_fragmentos_si_dueno('f4000000-0000-0000-0000-000000000007', 'f1111111-1111-1111-1111-111111111180', 'reclamo-propio', null)$$, '22023', 'p_filas debe ser un arreglo', 'p_filas nulo: 22023');
select is(public.insertar_fragmentos_si_dueno('f4000000-0000-0000-0000-000000000007', 'f1111111-1111-1111-1111-111111111180', 'reclamo-ajeno', '[{"texto":"x","embedding":"[0]","orden":60}]'::jsonb), false, 'reclamo distinto al de la versión: no es dueña');
select is(public.insertar_fragmentos_si_dueno('f4000000-0000-0000-0000-000000000007', 'f2222222-2222-2222-2222-222222222280', 'reclamo-propio', '[{"texto":"x","embedding":"[0]","orden":60}]'::jsonb), false, 'organización que no es la de la versión: no es dueña');
select is(public.insertar_fragmentos_si_dueno('00000000-0000-0000-0000-00000000dead', 'f1111111-1111-1111-1111-111111111180', 'reclamo-propio', '[{"texto":"x","embedding":"[0]","orden":60}]'::jsonb), false, 'versión inexistente: no es dueña');
select is((select count(*) from fragmentos_indexados where orden = 60), 0::bigint, 'ninguna de las llamadas rechazadas insertó nada');

-- Con el índice único válido la comprobación de la migración pasa.
select lives_ok($$select private.exigir_indice_fragmentos_valido()$$, 'con el índice válido la comprobación pasa');
-- El caso del índice INVALID real vive en lote89b_indice_invalido.test.sql (requiere un create unique index concurrently fuera de transacción).

-- Políticas de escritura: la versión debe ser de la organización del usuario.
select pg_temp.como('f1000000-0000-0000-0000-000000000080');
select throws_ok($$insert into fragmentos_indexados (version_id, organizacion_id, texto, embedding, orden) values ('f4000000-0000-0000-0000-0000000000b1', 'f1111111-1111-1111-1111-111111111180', 'intruso', array_fill(0.1, array[1536])::vector, 30)$$,
  '42501', 'new row violates row-level security policy for table "fragmentos_indexados"', 'insertar en una versión de otra organización (con la organización propia) es rechazado');
select throws_ok($$insert into fragmentos_indexados (version_id, organizacion_id, texto, embedding, orden) values ('f4000000-0000-0000-0000-0000000000b1', 'f2222222-2222-2222-2222-222222222280', 'intruso 2', array_fill(0.1, array[1536])::vector, 31)$$,
  '42501', 'new row violates row-level security policy for table "fragmentos_indexados"', 'insertar declarando la organización ajena también es rechazado');
select throws_ok($$update fragmentos_indexados set version_id = 'f4000000-0000-0000-0000-0000000000b1' where version_id = 'f4000000-0000-0000-0000-000000000007' and orden = 2$$,
  '42501', 'new row violates row-level security policy for table "fragmentos_indexados"', 'mover un fragmento propio a una versión ajena es rechazado');
select lives_ok($$insert into fragmentos_indexados (version_id, organizacion_id, texto, embedding, orden) values ('f4000000-0000-0000-0000-000000000007', 'f1111111-1111-1111-1111-111111111180', 'propio', array_fill(0.1, array[1536])::vector, 31)$$, 'insertar en una versión propia sigue permitido');
reset role;

-- ===== A2: barrido de versiones atascadas =====
select is(has_function_privilege('service_role', 'public.liberar_versiones_documento_atascadas(int)', 'execute'), true, 'service_role ejecuta el barrido público');
select is(has_function_privilege('authenticated', 'public.liberar_versiones_documento_atascadas(int)', 'execute'), false, 'authenticated no ejecuta el barrido público');
select is(has_function_privilege('anon', 'public.liberar_versiones_documento_atascadas(int)', 'execute'), false, 'anon no ejecuta el barrido público');
select is(has_function_privilege('service_role', 'private.liberar_versiones_documento_atascadas(int)', 'execute'), false, 'service_role no ejecuta el barrido privado directamente');
select is(has_function_privilege('authenticated', 'private.liberar_versiones_documento_atascadas(int)', 'execute'), false, 'authenticated no ejecuta el barrido privado');
select is((select prosecdef from pg_proc where oid = 'private.liberar_versiones_documento_atascadas(int)'::regprocedure), true, 'el barrido privado es security definer');
select is((select proconfig from pg_proc where oid = 'private.liberar_versiones_documento_atascadas(int)'::regprocedure), array['search_path=""'], 'el barrido privado fija search_path vacío');
select is((select proconfig from pg_proc where oid = 'public.liberar_versiones_documento_atascadas(int)'::regprocedure), array['search_path=""'], 'el barrido público fija search_path vacío');

-- Fragmentos de una versión que se va a marcar fallida y de una con candado vivo.
insert into fragmentos_indexados (version_id, organizacion_id, texto, embedding, orden)
select v, 'f1111111-1111-1111-1111-111111111180', 'huérfano', (select embedding from fragmentos_indexados where version_id = 'f4000000-0000-0000-0000-000000000007' limit 1), 1
  from unnest(array['f4000000-0000-0000-0000-000000000001', 'f4000000-0000-0000-0000-000000000002']::uuid[]) v;

select throws_ok($$select public.liberar_versiones_documento_atascadas(0)$$, '22023', 'p_minutos debe ser un entero mayor o igual a 1', 'p_minutos 0 es rechazado');
select throws_ok($$select public.liberar_versiones_documento_atascadas(null)$$, '22023', 'p_minutos debe ser un entero mayor o igual a 1', 'p_minutos nulo es rechazado');
select throws_ok($$select public.liberar_versiones_documento_atascadas(-5)$$, '22023', 'p_minutos debe ser un entero mayor o igual a 1', 'p_minutos negativo es rechazado');

select is(public.liberar_versiones_documento_atascadas(30), 4, 'marca 4 versiones: sin candado, candado vencido, candado ilegible y candado con instante futuro');
select is((select estado from versiones_documento where id = 'f4000000-0000-0000-0000-000000000001'), 'fallida', 'procesando de hace 40 min sin candado: fallida');
select is((select motivo_error from versiones_documento where id = 'f4000000-0000-0000-0000-000000000001'), 'Se interrumpió el procesamiento: más de 30 minutos sin completarse. Subí el archivo de nuevo.', 'motivo_error claro');
select is((select estado from versiones_documento where id = 'f4000000-0000-0000-0000-000000000003'), 'fallida', 'candado vencido (20 min): fallida');
select is((select estado from versiones_documento where id = 'f4000000-0000-0000-0000-000000000006'), 'fallida', 'candado ilegible: fallida');
select is((select estado from versiones_documento where id = 'f4000000-0000-0000-0000-0000000000f8'), 'fallida', 'candado con instante futuro (reloj corrido): no protege, se marca fallida');
select is((select estado from versiones_documento where id = 'f4000000-0000-0000-0000-000000000002'), 'procesando', 'candado vigente: no se pisa');
select is((select estado from versiones_documento where id = 'f4000000-0000-0000-0000-000000000004'), 'procesando', 'subida hace 5 min: no se toca');
select is((select estado from versiones_documento where id = 'f4000000-0000-0000-0000-000000000005'), 'activa', 'versión activa: no se toca');
select is((select estado from versiones_documento where id = 'f4000000-0000-0000-0000-000000000007'), 'procesando', 'subida reciente con reclamo propio: no se toca');
select is((select count(*) from fragmentos_indexados where version_id = 'f4000000-0000-0000-0000-000000000001'), 0::bigint, 'se borran los fragmentos huérfanos de la versión marcada');
select is((select count(*) from fragmentos_indexados where version_id = 'f4000000-0000-0000-0000-000000000002'), 1::bigint, 'los de la versión con candado vigente se conservan');
select is(public.liberar_versiones_documento_atascadas(30), 0, 'idempotente: segunda corrida no marca nada');
select is(public.liberar_versiones_documento_atascadas(), 0, 'el default (30) funciona sin argumento');

-- ===== B1: una fila por funcionalidad en fuentes_mcp / acciones_mcp =====
insert into fuentes_mcp (feature_id, vista) values ('f-l80', 'v_l80_a');
insert into acciones_mcp (feature_id, rpc) values ('f-l80', 'rpc_l80_a');
select throws_ok($$insert into fuentes_mcp (feature_id, vista) values ('f-l80', 'v_l80_b')$$, '23505', 'duplicate key value violates unique constraint "fuentes_mcp_feature_unica_idx"', 'una segunda vista para la misma funcionalidad es rechazada');
select throws_ok($$insert into acciones_mcp (feature_id, rpc) values ('f-l80', 'rpc_l80_b')$$, '23505', 'duplicate key value violates unique constraint "acciones_mcp_feature_unica_idx"', 'una segunda acción para la misma funcionalidad es rechazada');
drop index public.fuentes_mcp_feature_unica_idx;
drop index public.acciones_mcp_feature_unica_idx;
select lives_ok($$select private.exigir_una_fila_por_funcionalidad_mcp()$$, 'sin duplicados la verificación no aborta');
insert into fuentes_mcp (feature_id, vista) values ('f-l80', 'v_l80_0');
select throws_ok($$select private.exigir_una_fila_por_funcionalidad_mcp()$$, '23505', 'fuentes_mcp tiene más de una fila por feature_id (f-l80): dejá una sola por funcionalidad y reaplicá la migración', 'fuentes duplicadas: la migración aborta nombrando la funcionalidad');
select is((select count(*) from fuentes_mcp where feature_id = 'f-l80'), 2::bigint, 'no borró ninguna fila en silencio');
delete from fuentes_mcp where feature_id = 'f-l80' and vista = 'v_l80_0';
insert into acciones_mcp (feature_id, rpc) values ('f-l80', 'rpc_l80_0');
select throws_ok($$select private.exigir_una_fila_por_funcionalidad_mcp()$$, '23505', 'acciones_mcp tiene más de una fila por feature_id (f-l80): dejá una sola por funcionalidad y reaplicá la migración', 'acciones duplicadas: la migración aborta nombrando la funcionalidad');
delete from acciones_mcp where feature_id = 'f-l80' and rpc = 'rpc_l80_0';
select lives_ok($$select private.exigir_una_fila_por_funcionalidad_mcp()$$, 'resueltos los duplicados la verificación pasa');
create unique index if not exists fuentes_mcp_feature_unica_idx on public.fuentes_mcp (feature_id);
create unique index if not exists acciones_mcp_feature_unica_idx on public.acciones_mcp (feature_id);

-- ===== B2: vencimiento dentro de iniciar_ejecucion_mcp =====
select is(private.ejecucion_mcp_vence_min(), 10, 'el vencimiento es de 10 minutos');
select is(has_function_privilege('service_role', 'public.iniciar_ejecucion_mcp(uuid, text)', 'execute'), true, 'service_role sigue ejecutando iniciar_ejecucion_mcp');
select is(has_function_privilege('authenticated', 'public.iniciar_ejecucion_mcp(uuid, text)', 'execute'), false, 'authenticated sigue sin ejecutar iniciar_ejecucion_mcp');
select ok(public.iniciar_ejecucion_mcp('f2000000-0000-0000-0000-000000000001', 'f-l80') is not null, 'inicia una ejecución');
select throws_ok($$select public.iniciar_ejecucion_mcp('f2000000-0000-0000-0000-000000000001', 'f-l80')$$, '23505', 'duplicate key value violates unique constraint "ejecuciones_mcp_en_curso_idx"', 'una segunda ejecución vigente es rechazada (EJECUCION_EN_CURSO)');
update ejecuciones_mcp set iniciada_en = now() - interval '9 minutes' where credencial_id = 'f2000000-0000-0000-0000-000000000001';
select throws_ok($$select public.iniciar_ejecucion_mcp('f2000000-0000-0000-0000-000000000001', 'f-l80')$$, '23505', 'duplicate key value violates unique constraint "ejecuciones_mcp_en_curso_idx"', 'a los 9 minutos todavía no vence');
select ok(public.iniciar_ejecucion_mcp('f2000000-0000-0000-0000-000000000002', 'f-l80') is not null, 'otra credencial inicia sin interferir');
-- Una ejecución ya cerrada (completada) de 11 minutos no se reescribe como vencida.
insert into ejecuciones_mcp (credencial_id, feature_id, estado, iniciada_en, finalizada_en) values ('f2000000-0000-0000-0000-000000000001', 'f-l80', 'completada', now() - interval '11 minutes', now() - interval '10 minutes');
-- Aislamiento del vencimiento: abandonadas (11 min) de OTRA credencial y de OTRA funcionalidad de la misma credencial no se tocan.
insert into ejecuciones_mcp (credencial_id, feature_id, estado, iniciada_en) values ('f2000000-0000-0000-0000-000000000001', 'f-l80-b', 'en_curso', now() - interval '11 minutes');
update ejecuciones_mcp set iniciada_en = now() - interval '11 minutes' where credencial_id = 'f2000000-0000-0000-0000-000000000002' and feature_id = 'f-l80';
update ejecuciones_mcp set iniciada_en = now() - interval '11 minutes' where credencial_id = 'f2000000-0000-0000-0000-000000000001' and feature_id = 'f-l80';
select ok(public.iniciar_ejecucion_mcp('f2000000-0000-0000-0000-000000000001', 'f-l80') is not null, 'a los 11 minutos la abandonada vence y se inicia una nueva');
select is((select count(*) from ejecuciones_mcp where credencial_id = 'f2000000-0000-0000-0000-000000000001' and estado = 'fallida' and motivo_error = 'vencida' and finalizada_en is not null), 1::bigint, 'la abandonada quedó fallida/vencida con fecha de cierre');
select is((select count(*) from ejecuciones_mcp where credencial_id = 'f2000000-0000-0000-0000-000000000002' and feature_id = 'f-l80' and estado = 'en_curso'), 1::bigint, 'la ejecución de 11 minutos de OTRA credencial sigue en_curso');
select is((select count(*) from ejecuciones_mcp where credencial_id = 'f2000000-0000-0000-0000-000000000001' and feature_id = 'f-l80-b' and estado = 'en_curso'), 1::bigint, 'la ejecución de 11 minutos de OTRA funcionalidad de la misma credencial sigue en_curso');
select is((select count(*) from ejecuciones_mcp where credencial_id = 'f2000000-0000-0000-0000-000000000001' and feature_id = 'f-l80' and estado = 'completada' and motivo_error is null), 1::bigint, 'una ejecución completada no se reescribe como vencida');
select throws_ok($$select public.iniciar_ejecucion_mcp('f2000000-0000-0000-0000-000000000003', 'f-l80')$$, '42501', 'Credencial inválida o revocada', 'credencial revocada: 42501');
select throws_ok($$select public.iniciar_ejecucion_mcp('f2000000-0000-0000-0000-000000000001', 'f-l80-sin-capacidad')$$, '42501', 'Funcionalidad no ejecutable para esta organización', 'funcionalidad no ejecutable: 42501');

-- ===== C: fuentes_chat_ia.columnas =====
insert into fuentes_chat_ia (feature_id, vista) values ('f-l80', 'v_chat_l80_null');
insert into fuentes_chat_ia (feature_id, vista, columnas) values ('f-l80', 'v_chat_l80_ok', array['sku', 'nombre_2']);
select is((select columnas from fuentes_chat_ia where vista = 'v_chat_l80_null'), null, 'columnas NULL por defecto (comportamiento anterior)');
select is((select columnas from fuentes_chat_ia where vista = 'v_chat_l80_ok'), array['sku', 'nombre_2'], 'columnas válidas se guardan');
select throws_ok($$insert into fuentes_chat_ia (feature_id, vista, columnas) values ('f-l80', 'x1', '{}')$$, '23514', 'new row for relation "fuentes_chat_ia" violates check constraint "fuentes_chat_ia_columnas_validas"', 'lista vacía rechazada');
select throws_ok($$insert into fuentes_chat_ia (feature_id, vista, columnas) values ('f-l80', 'x2', array['Sku'])$$, '23514', 'new row for relation "fuentes_chat_ia" violates check constraint "fuentes_chat_ia_columnas_validas"', 'mayúsculas rechazadas');
select throws_ok($$insert into fuentes_chat_ia (feature_id, vista, columnas) values ('f-l80', 'x3', array['a;b'])$$, '23514', 'new row for relation "fuentes_chat_ia" violates check constraint "fuentes_chat_ia_columnas_validas"', 'punto y coma rechazado');
select throws_ok($$insert into fuentes_chat_ia (feature_id, vista, columnas) values ('f-l80', 'x4', array['a|b'])$$, '23514', 'new row for relation "fuentes_chat_ia" violates check constraint "fuentes_chat_ia_columnas_validas"', 'separador dentro de un elemento rechazado');
select throws_ok($$insert into fuentes_chat_ia (feature_id, vista, columnas) values ('f-l80', 'x5', array['a', ''])$$, '23514', 'new row for relation "fuentes_chat_ia" violates check constraint "fuentes_chat_ia_columnas_validas"', 'elemento vacío rechazado');
select throws_ok($$insert into fuentes_chat_ia (feature_id, vista, columnas) values ('f-l80', 'x6', array['a', null])$$, '23514', 'new row for relation "fuentes_chat_ia" violates check constraint "fuentes_chat_ia_columnas_validas"', 'elemento nulo rechazado');
select throws_ok($$insert into fuentes_chat_ia (feature_id, vista, columnas) values ('f-l80', 'x8', array['a', 'a'])$$, '23514', 'new row for relation "fuentes_chat_ia" violates check constraint "fuentes_chat_ia_columnas_validas"', 'columnas repetidas rechazadas (igual que el handler)');
select throws_ok($$insert into fuentes_chat_ia (feature_id, vista, columnas) values ('f-l80', 'x9', array['a', 'b', 'c', 'b'])$$, '23514', 'new row for relation "fuentes_chat_ia" violates check constraint "fuentes_chat_ia_columnas_validas"', 'columnas repetidas no contiguas rechazadas');
select lives_ok($$insert into fuentes_chat_ia (feature_id, vista, columnas) values ('f-l80', 'x10', array['a', 'ab', 'b', 'a_1', 'xa'])$$, 'prefijos y sufijos de otros nombres no cuentan como repetidos');
select throws_ok($$insert into fuentes_chat_ia (feature_id, vista, columnas) values ('f-l80', 'x7', (select array_agg('c' || n) from generate_series(1, 51) n))$$, '23514', 'new row for relation "fuentes_chat_ia" violates check constraint "fuentes_chat_ia_columnas_validas"', 'más de 50 columnas rechazado');

select * from finish();
rollback;
