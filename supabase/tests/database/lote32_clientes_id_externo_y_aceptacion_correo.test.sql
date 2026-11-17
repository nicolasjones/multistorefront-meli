-- MSF-596 y MSF-666 (lote 32): el identificador externo de un cliente es único por (organización, sistema, identificador)
-- y la migración/acción masiva cargan la aceptación de correo masivo con quién y cuándo.
begin;

select no_plan();

insert into organizaciones (id, nombre) values
  ('11111111-1111-1111-1111-111111111111', 'Organización Uno'),
  ('22222222-2222-2222-2222-222222222222', 'Organización Dos');

insert into auth.users (id, email) values
  ('e1000000-0000-0000-0000-000000000001', 'admin-uno@example.com'),
  ('e1000000-0000-0000-0000-000000000002', 'consulta-uno@example.com'),
  ('e2000000-0000-0000-0000-000000000001', 'admin-dos@example.com');

insert into usuarios_organizacion (user_id, organizacion_id, rol_id, estado) values
  ('e1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'administrador', 'activo'),
  ('e1000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'consulta', 'activo'),
  ('e2000000-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', 'administrador', 'activo');

insert into dominio.empresas (id, organizacion_id, nombre) values
  ('a1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'Tienda Uno'),
  ('a2000000-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', 'Tienda Dos');

insert into dominio.clientes (id, organizacion_id, numero, nombre, tipo) values
  ('c1000000-0000-0000-0000-00000000000a', '11111111-1111-1111-1111-111111111111', 10, 'Cliente 1A', 'minorista'),
  ('c1000000-0000-0000-0000-00000000000b', '11111111-1111-1111-1111-111111111111', 11, 'Cliente 1B', 'minorista'),
  ('c2000000-0000-0000-0000-00000000000a', '22222222-2222-2222-2222-222222222222', 10, 'Cliente 2A', 'minorista');

create temporary table t_res (k text primary key, v jsonb);
grant all on t_res to authenticated, anon;

create function pg_temp.como(p_user uuid) returns void language plpgsql as $$
begin
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
  set local role authenticated;
end $$;
create function pg_temp.aplicar(p_k text, p_carga text, p_filas jsonb) returns void language plpgsql as $$
begin
  insert into t_res select p_k, public.aplicar_lote_clientes((select (v #>> '{}')::uuid from t_res where k = p_carga), 1, p_filas);
end $$;

-- ============================================================================
-- MSF-596: estructura
-- ============================================================================
select is((select count(*)::int from pg_constraint where conname = 'clientes_identificadores_externos_sistema_identificador_key'), 0,
  'el único global (sistema, identificador) ya no existe');
select is((select pg_get_constraintdef(oid) from pg_constraint where conname = 'clientes_identificadores_externos_org_sistema_identificador_key'),
  'UNIQUE (organizacion_id, sistema, identificador_externo)', 'el único es por (organización, sistema, identificador)');
select is((select is_nullable from information_schema.columns where table_schema = 'public' and table_name = 'clientes_identificadores_externos' and column_name = 'organizacion_id'),
  'NO', 'organizacion_id es obligatoria');

-- ============================================================================
-- MSF-596: vincular
-- ============================================================================
select pg_temp.como('e1000000-0000-0000-0000-000000000001');
select lives_ok($$select public.vincular_identificador_externo('c1000000-0000-0000-0000-00000000000a', 'sis', 'EXT-1')$$, 'la organización uno vincula EXT-1');
select pg_temp.como('e2000000-0000-0000-0000-000000000001');
select lives_ok($$select public.vincular_identificador_externo('c2000000-0000-0000-0000-00000000000a', 'sis', 'EXT-1')$$,
  'la organización dos vincula el MISMO identificador del mismo sistema (antes: 23505)');
reset role;
select is((select count(*)::int from public.clientes_identificadores_externos where sistema = 'sis' and identificador_externo = 'EXT-1'), 2, 'hay un vínculo por organización');
select is((select organizacion_id from public.clientes_identificadores_externos where cliente_id = 'c2000000-0000-0000-0000-00000000000a'),
  '22222222-2222-2222-2222-222222222222'::uuid, 'el vínculo guarda la organización de su cliente');

select pg_temp.como('e1000000-0000-0000-0000-000000000001');
select throws_ok($$select public.vincular_identificador_externo('c1000000-0000-0000-0000-00000000000b', 'sis', 'EXT-1')$$,
  '23505', 'El identificador externo ya está vinculado a otro cliente', 'dentro de la misma organización sigue siendo único');
select is((select (public.vincular_identificador_externo('c1000000-0000-0000-0000-00000000000a', 'sis', 'EXT-1')).cliente_id),
  'c1000000-0000-0000-0000-00000000000a'::uuid, 'revincular el mismo par al mismo cliente es idempotente');
select throws_ok($$select public.vincular_identificador_externo('c2000000-0000-0000-0000-00000000000a', 'sis', 'EXT-9')$$,
  '42501', 'No puede gestionar identificadores externos de esta organización', 'vincular un cliente de otra organización sigue prohibido');
select pg_temp.como('e1000000-0000-0000-0000-000000000002');
select throws_ok($$select public.vincular_identificador_externo('c1000000-0000-0000-0000-00000000000b', 'sis', 'EXT-2')$$,
  '42501', 'No puede gestionar identificadores externos de esta organización', 'un rol sin administración no vincula');
select pg_temp.como('e2000000-0000-0000-0000-000000000001');
select is((select count(*)::int from public.clientes_identificadores_externos), 1, 'la organización dos ve solo su vínculo');

-- El disparador toma la organización del cliente aunque se intente otra
reset role;
insert into public.clientes_identificadores_externos (cliente_id, organizacion_id, sistema, identificador_externo)
  values ('c1000000-0000-0000-0000-00000000000b', '22222222-2222-2222-2222-222222222222', 'sis', 'EXT-3');
select is((select organizacion_id from public.clientes_identificadores_externos where identificador_externo = 'EXT-3'),
  '11111111-1111-1111-1111-111111111111'::uuid, 'el disparador pisa una organización distinta a la del cliente');
select throws_ok($$insert into public.clientes_identificadores_externos (cliente_id, sistema, identificador_externo)
  values ('00000000-0000-0000-0000-0000000000ff', 'sis', 'EXT-4')$$, 'P0002', 'El cliente 00000000-0000-0000-0000-0000000000ff no existe', 'un cliente inexistente no se vincula');

-- ============================================================================
-- MSF-596: carga (aplicar_lote_clientes) y conciliación
-- ============================================================================
select pg_temp.como('e1000000-0000-0000-0000-000000000001');
insert into t_res select 'carga1', to_jsonb(public.iniciar_carga_migracion('clientes', 'c1.csv', 5));
select pg_temp.como('e2000000-0000-0000-0000-000000000001');
insert into t_res select 'carga2', to_jsonb(public.iniciar_carga_migracion('clientes', 'c2.csv', 1));

select pg_temp.como('e1000000-0000-0000-0000-000000000001');
select pg_temp.aplicar('l1', 'carga1', '[{"fila":2,"id_externo":"IMP-1","nombre":"Importado 1"}]'::jsonb);
select pg_temp.como('e2000000-0000-0000-0000-000000000001');
select pg_temp.aplicar('l2', 'carga2', '[{"fila":2,"id_externo":"IMP-1","nombre":"Importado Dos"}]'::jsonb);
select is((select v ->> 'nuevos' from t_res where k = 'l1'), '1', 'la organización uno crea su cliente IMP-1');
select is((select v ->> 'nuevos' from t_res where k = 'l2'), '1', 'la organización dos crea el suyo con el MISMO IMP-1 (sin «ya está en uso»)');
select is((select v -> 'errores' from t_res where k = 'l2'), '[]'::jsonb, 'sin errores en la organización dos');
select is((select count(*)::int from dominio.clientes where nombre = 'Importado Dos'), 1, 'el cliente de la dos existe');

-- Reimportar en la uno actualiza SU cliente (no el de la otra organización)
select pg_temp.como('e1000000-0000-0000-0000-000000000001');
insert into t_res select 'carga3', to_jsonb(public.iniciar_carga_migracion('clientes', 'c3.csv', 1));
select pg_temp.aplicar('l3', 'carga3', '[{"fila":2,"id_externo":"IMP-1","nombre":"Importado 1 editado"}]'::jsonb);
select is((select v ->> 'actualizados' from t_res where k = 'l3'), '1', 'reimportar el identificador actualiza el cliente de la propia organización');
reset role;
select is((select nombre from dominio.clientes where organizacion_id = '22222222-2222-2222-2222-222222222222' and nombre like 'Importado%'),
  'Importado Dos', 'y no toca al de la otra organización');

-- ============================================================================
-- MSF-666: aceptación de correo en la importación
-- ============================================================================
select pg_temp.como('e1000000-0000-0000-0000-000000000001');
insert into t_res select 'carga4', to_jsonb(public.iniciar_carga_migracion('clientes', 'c4.csv', 5));
select pg_temp.aplicar('l4', 'carga4', '[
  {"fila":2,"id_externo":"ACE-1","nombre":"Acepta Sí","acepta_correo":"Sí"},
  {"fila":3,"id_externo":"ACE-2","nombre":"Sin dato"},
  {"fila":4,"id_externo":"ACE-3","nombre":"Dice no","acepta_correo":"no"},
  {"fila":5,"id_externo":"ACE-4","nombre":"Valor raro","acepta_correo":"quizás"},
  {"fila":6,"id_externo":"ACE-5","nombre":"Celda vacía","acepta_correo":""}]'::jsonb);
select is((select v ->> 'nuevos' from t_res where k = 'l4'), '4', 'se crean las cuatro filas válidas');
select is((select v -> 'errores' -> 0 ->> 'motivo' from t_res where k = 'l4'), 'La aceptación de correo debe ser sí o no', 'un valor que no es sí/no es error de esa fila');
select is((select jsonb_agg(nombre || ':' || acepta_correo_masivo::text order by nombre) from dominio.clientes where nombre in ('Acepta Sí', 'Sin dato', 'Dice no', 'Celda vacía')),
  '["Acepta Sí:true", "Celda vacía:false", "Dice no:false", "Sin dato:false"]'::jsonb, 'solo «sí» acepta; vacío o sin columna = sin aceptación (sin valor por defecto)');
select is((select acepta_correo_masivo_por from dominio.clientes where nombre = 'Acepta Sí'), 'e1000000-0000-0000-0000-000000000001'::uuid, 'queda quién marcó la aceptación');
select ok((select acepta_correo_masivo_en is not null from dominio.clientes where nombre = 'Acepta Sí'), 'y cuándo');
select ok((select acepta_correo_masivo_en is null and acepta_correo_masivo_por is null from dominio.clientes where nombre = 'Sin dato'), 'sin aceptación no hay quién ni cuándo');

-- Reimportar: vacío no cambia; «sí» sobre uno existente lo marca; «sí» ya aceptado no cambia lo anterior
insert into t_res select 'carga5', to_jsonb(public.iniciar_carga_migracion('clientes', 'c5.csv', 3));
select pg_temp.aplicar('l5', 'carga5', '[
  {"fila":2,"id_externo":"ACE-1","nombre":"Acepta Sí","acepta_correo":""},
  {"fila":3,"id_externo":"ACE-2","nombre":"Sin dato","acepta_correo":"si"}]'::jsonb);
select is((select jsonb_agg(nombre || ':' || acepta_correo_masivo::text order by nombre) from dominio.clientes where nombre in ('Acepta Sí', 'Sin dato')),
  '["Acepta Sí:true", "Sin dato:true"]'::jsonb, 'una celda vacía no borra la aceptación y «si» marca la de un cliente existente');

-- ============================================================================
-- MSF-666: acción masiva
-- ============================================================================
select is(has_function_privilege('anon', 'public.marcar_aceptacion_correo_clientes(uuid[],boolean)', 'execute'), false, 'anon no ejecuta la acción masiva');
select is(has_function_privilege('authenticated', 'public.marcar_aceptacion_correo_clientes(uuid[],boolean)', 'execute'), true, 'authenticated sí');
select is(has_column_privilege('authenticated', 'dominio.clientes', 'acepta_correo_masivo_en', 'UPDATE'), false, 'authenticated no escribe el momento de la aceptación');
select is(has_column_privilege('authenticated', 'dominio.clientes', 'acepta_correo_masivo_por', 'UPDATE'), false, 'ni quién la marcó');

select is(public.marcar_aceptacion_correo_clientes(array['c1000000-0000-0000-0000-00000000000a', 'c1000000-0000-0000-0000-00000000000b', 'c2000000-0000-0000-0000-00000000000a']::uuid[], true),
  2, 'marca los dos clientes propios y ignora el de otra organización');
reset role;
select is((select acepta_correo_masivo from dominio.clientes where id = 'c2000000-0000-0000-0000-00000000000a'), false, 'el cliente ajeno quedó como estaba');
select is((select acepta_correo_masivo_por from dominio.clientes where id = 'c1000000-0000-0000-0000-00000000000a'), 'e1000000-0000-0000-0000-000000000001'::uuid, 'queda quién lo marcó');
select is((select count(*)::int from public.registro_actividad where tipo = 'clientes.aceptacion_correo_marcada' and detalle like '%2 cliente(s)%'), 1, 'la Actividad deja la cantidad');

select pg_temp.como('e1000000-0000-0000-0000-000000000001');
select is(public.marcar_aceptacion_correo_clientes(array['c1000000-0000-0000-0000-00000000000a']::uuid[], true), 0, 'repetir no cambia nada (idempotente)');
select is(public.marcar_aceptacion_correo_clientes(array['c1000000-0000-0000-0000-00000000000a']::uuid[], false), 1, 'desmarcar cambia');
select ok((select acepta_correo_masivo_en is null and acepta_correo_masivo_por is null from dominio.clientes where id = 'c1000000-0000-0000-0000-00000000000a'), 'al desmarcar se vacían quién y cuándo');
select throws_ok($$select public.marcar_aceptacion_correo_clientes(array['c1000000-0000-0000-0000-00000000000a']::uuid[], null)$$, '22023', 'Indicá si los clientes aceptan o no el correo masivo', 'acepta nulo');
select throws_ok($$select public.marcar_aceptacion_correo_clientes(array[]::uuid[], true)$$, '22023', 'Elegí al menos un cliente', 'lista vacía');
select throws_ok($$select public.marcar_aceptacion_correo_clientes(null, true)$$, '22023', 'Elegí al menos un cliente', 'lista nula');
select throws_ok($$select public.marcar_aceptacion_correo_clientes((select array_agg(gen_random_uuid()) from generate_series(1, 5001)), true)$$, '22023', 'Se pueden marcar hasta 5000 clientes por vez', 'más de 5000');

select pg_temp.como('e1000000-0000-0000-0000-000000000002');
select throws_ok($$select public.marcar_aceptacion_correo_clientes(array['c1000000-0000-0000-0000-00000000000a']::uuid[], true)$$,
  '42501', 'Solo un administrador puede marcar la aceptación de correo', 'un rol sin administración no marca');
select pg_temp.como('e2000000-0000-0000-0000-000000000001');
select is(public.marcar_aceptacion_correo_clientes(array['c1000000-0000-0000-0000-00000000000a', 'c1000000-0000-0000-0000-00000000000b']::uuid[], true), 0,
  'el administrador de otra organización no cambia nada de la primera');
reset role;
select is((select acepta_correo_masivo from dominio.clientes where id = 'c1000000-0000-0000-0000-00000000000b'), true, 'y el cliente 1B sigue como lo dejó su organización');
set local role anon;
select throws_ok($$select public.marcar_aceptacion_correo_clientes(array['c1000000-0000-0000-0000-00000000000a']::uuid[], true)$$, '42501', null, 'anon no ejecuta (permission denied)');

-- API directa: el interruptor por la API estampa quién y cuándo (disparador), sin poder falsificarlos
reset role;
select pg_temp.como('e1000000-0000-0000-0000-000000000001');
update dominio.clientes set acepta_correo_masivo = true where id = 'c1000000-0000-0000-0000-00000000000a';
select is((select acepta_correo_masivo_por from dominio.clientes where id = 'c1000000-0000-0000-0000-00000000000a'), 'e1000000-0000-0000-0000-000000000001'::uuid, 'el interruptor por la API también deja quién');
select throws_ok($$update dominio.clientes set acepta_correo_masivo_por = 'e2000000-0000-0000-0000-000000000001' where id = 'c1000000-0000-0000-0000-00000000000a'$$,
  '42501', 'permission denied for table clientes', 'no se puede escribir quién directamente');

select * from finish();
rollback;
