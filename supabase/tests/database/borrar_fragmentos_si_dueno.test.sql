-- Deuda m1 de indexar-documento: public/private.borrar_fragmentos_si_dueno borra los fragmentos de una versión
-- solo si sigue en manos de quien llama (no `activa`, no retomada por otra invocación), y solo la ejecuta service_role.
-- Datos inventados.
begin;

select plan(22);

insert into organizaciones (id, nombre) values ('d1111111-1111-1111-1111-111111111111', 'Org Fragmentos');
insert into auth.users (id, email) values ('d1000000-0000-0000-0000-000000000001', 'subidor-frag@example.com');

insert into documentos (id, organizacion_id, nombre, subido_por) values
  ('d3000000-0000-0000-0000-000000000001', 'd1111111-1111-1111-1111-111111111111', 'a.pdf', 'd1000000-0000-0000-0000-000000000001'),
  ('d3000000-0000-0000-0000-000000000002', 'd1111111-1111-1111-1111-111111111111', 'b.pdf', 'd1000000-0000-0000-0000-000000000001'),
  ('d3000000-0000-0000-0000-000000000003', 'd1111111-1111-1111-1111-111111111111', 'c.pdf', 'd1000000-0000-0000-0000-000000000001'),
  ('d3000000-0000-0000-0000-000000000004', 'd1111111-1111-1111-1111-111111111111', 'd.pdf', 'd1000000-0000-0000-0000-000000000001');

-- 1 propia (procesando con el reclamo), 2 retomada por otra (procesando con otro reclamo), 3 activa, 4 fallida.
insert into versiones_documento (id, documento_id, storage_path, estado, subida_por, motivo_error) values
  ('d4000000-0000-0000-0000-000000000001', 'd3000000-0000-0000-0000-000000000001', 'r1', 'procesando', 'd1000000-0000-0000-0000-000000000001', 'reclamo-propio'),
  ('d4000000-0000-0000-0000-000000000002', 'd3000000-0000-0000-0000-000000000002', 'r2', 'procesando', 'd1000000-0000-0000-0000-000000000001', 'reclamo-de-otra'),
  ('d4000000-0000-0000-0000-000000000003', 'd3000000-0000-0000-0000-000000000003', 'r3', 'activa', 'd1000000-0000-0000-0000-000000000001', null),
  ('d4000000-0000-0000-0000-000000000004', 'd3000000-0000-0000-0000-000000000004', 'r4', 'fallida', 'd1000000-0000-0000-0000-000000000001', 'No pudimos');

insert into fragmentos_indexados (version_id, organizacion_id, texto, embedding, orden)
select v, 'd1111111-1111-1111-1111-111111111111', 'texto ' || n, ('[' || array_to_string(array_fill(0, array[1536]), ',') || ']')::public.vector, n
  from (values ('d4000000-0000-0000-0000-000000000001'::uuid), ('d4000000-0000-0000-0000-000000000002'), ('d4000000-0000-0000-0000-000000000003'), ('d4000000-0000-0000-0000-000000000004')) as t (v),
       generate_series(1, 2) as n;

-- Privilegios: solo service_role (las dos funciones).
select is(has_function_privilege('service_role', 'public.borrar_fragmentos_si_dueno(uuid, uuid, text)', 'execute'), true, 'service_role ejecuta la función pública');
select is(has_function_privilege('authenticated', 'public.borrar_fragmentos_si_dueno(uuid, uuid, text)', 'execute'), false, 'authenticated no ejecuta la función pública');
select is(has_function_privilege('anon', 'public.borrar_fragmentos_si_dueno(uuid, uuid, text)', 'execute'), false, 'anon no ejecuta la función pública');
-- El grant a service_role sobre la función privada era superfluo (lote 41): el envoltorio público es security definer y la llama como dueño.
select is(has_function_privilege('service_role', 'private.borrar_fragmentos_si_dueno(uuid, uuid, text)', 'execute'), false, 'service_role no ejecuta la función privada directamente (el envoltorio la llama como dueño)');
select is(has_function_privilege('authenticated', 'private.borrar_fragmentos_si_dueno(uuid, uuid, text)', 'execute'), false, 'authenticated no ejecuta la función privada');
select is(has_function_privilege('anon', 'private.borrar_fragmentos_si_dueno(uuid, uuid, text)', 'execute'), false, 'anon no ejecuta la función privada');

-- Definición endurecida.
select is((select prosecdef from pg_proc where oid = 'private.borrar_fragmentos_si_dueno(uuid, uuid, text)'::regprocedure), true, 'la función privada es security definer');
select is((select proconfig from pg_proc where oid = 'private.borrar_fragmentos_si_dueno(uuid, uuid, text)'::regprocedure), array['search_path=""'], 'la función privada fija search_path vacío');

-- Una versión retomada por otra invocación: no se borra nada.
select is(public.borrar_fragmentos_si_dueno('d4000000-0000-0000-0000-000000000002', 'd1111111-1111-1111-1111-111111111111', 'reclamo-propio'), false, 'retomada por otra invocación: no es dueña');
select is((select count(*) from fragmentos_indexados where version_id = 'd4000000-0000-0000-0000-000000000002'), 2::bigint, 'los fragmentos de la versión retomada siguen');

-- Una versión activa: nunca se borra.
select is(public.borrar_fragmentos_si_dueno('d4000000-0000-0000-0000-000000000003', 'd1111111-1111-1111-1111-111111111111', 'reclamo-propio'), false, 'versión activa: no es dueña');
select is((select count(*) from fragmentos_indexados where version_id = 'd4000000-0000-0000-0000-000000000003'), 2::bigint, 'los fragmentos de la versión activa siguen');

-- Versión inexistente.
select is(public.borrar_fragmentos_si_dueno('00000000-0000-0000-0000-00000000dead', 'd1111111-1111-1111-1111-111111111111', 'reclamo-propio'), false, 'versión inexistente: false');

-- Dueña (procesando con el reclamo propio): borra.
select is(public.borrar_fragmentos_si_dueno('d4000000-0000-0000-0000-000000000001', 'd1111111-1111-1111-1111-111111111111', 'reclamo-propio'), true, 'procesando con el reclamo propio: es dueña');
select is((select count(*) from fragmentos_indexados where version_id = 'd4000000-0000-0000-0000-000000000001'), 0::bigint, 'se borraron los fragmentos de la versión propia');

-- Ya fallida por esta invocación: borra (la limpieza posterior a marcarFallida).
select is(public.borrar_fragmentos_si_dueno('d4000000-0000-0000-0000-000000000004', 'd1111111-1111-1111-1111-111111111111', 'reclamo-propio'), true, 'versión fallida: se limpian sus fragmentos');
select is((select count(*) from fragmentos_indexados where version_id = 'd4000000-0000-0000-0000-000000000004'), 0::bigint, 'se borraron los fragmentos de la versión fallida');

-- Otra organización: no es dueña aunque el reclamo coincida (se restaura el reclamo para aislar el caso).
insert into organizaciones (id, nombre) values ('d2222222-2222-2222-2222-222222222222', 'Otra org');
update versiones_documento set estado = 'procesando', motivo_error = 'reclamo-propio' where id = 'd4000000-0000-0000-0000-000000000004';
insert into fragmentos_indexados (version_id, organizacion_id, texto, embedding, orden)
  values ('d4000000-0000-0000-0000-000000000004', 'd1111111-1111-1111-1111-111111111111', 'x', ('[' || array_to_string(array_fill(0, array[1536]), ',') || ']')::public.vector, 1);
select is(public.borrar_fragmentos_si_dueno('d4000000-0000-0000-0000-000000000004', 'd2222222-2222-2222-2222-222222222222', 'reclamo-propio'), false, 'otra organización: no es dueña');
select is((select count(*) from fragmentos_indexados where version_id = 'd4000000-0000-0000-0000-000000000004'), 1::bigint, 'los fragmentos no se borran con otra organización');
select is(public.borrar_fragmentos_si_dueno('d4000000-0000-0000-0000-000000000004', 'd1111111-1111-1111-1111-111111111111', 'reclamo-propio'), true, 'con la organización correcta sí');

-- Bloqueo `for share` sobre la fila de la versión (lote 41): mientras el borrado está en curso, una activación o un reclamo
-- concurrentes (un `update` de la versión) tienen que esperar. En pgTAP (una sola transacción) no se puede lanzar una segunda
-- conexión sobre filas sin confirmar, así que se verifica el bloqueo con `pgrowlocks` (contrib de PostgreSQL): tras la llamada,
-- la fila de la versión figura con «For Share» tomado por esta transacción. El caso de dos conexiones reales (el `update` espera
-- y se libera al terminar) queda como prueba manual documentada en docs/funciones-edge-endurecimiento.md.
do $$ begin
  if exists (select 1 from pg_available_extensions where name = 'pgrowlocks') then
    create extension if not exists pgrowlocks with schema public;
    perform set_config('lote41.hay_pgrowlocks', 'si', true);
  else
    perform set_config('lote41.hay_pgrowlocks', 'no', true);
  end if;
end $$;
select public.borrar_fragmentos_si_dueno('d4000000-0000-0000-0000-000000000001', 'd1111111-1111-1111-1111-111111111111', 'reclamo-propio');
select case when current_setting('lote41.hay_pgrowlocks') = 'si'
  then is((select bool_or(r.modes @> array['For Share']) from public.pgrowlocks('public.versiones_documento') r
            join public.versiones_documento v on v.ctid = r.locked_row where v.id = 'd4000000-0000-0000-0000-000000000001'), true,
    'el borrado toma «for share» sobre la fila de la versión (una activación concurrente espera)')
  else fail('pgrowlocks no disponible en este Postgres: sin él el bloqueo for share queda sin cobertura (prueba manual en docs/funciones-edge-endurecimiento.md)') end;

-- Sin fragmentos: sigue siendo dueña.
select is(public.borrar_fragmentos_si_dueno('d4000000-0000-0000-0000-000000000001', 'd1111111-1111-1111-1111-111111111111', 'reclamo-propio'), true, 'sin fragmentos: dueña igual (idempotente)');

select * from finish();
rollback;
