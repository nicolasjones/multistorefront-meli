-- MSF-853 (gate) · MSF-207 · F-CON-03 (épica MSF-122, SC-005): la dirección de avisos de consultas y
-- el retiro del camino directo del aviso.
-- Cubre FR-009 (la dirección de avisos por empresa) y el gate de MSF-853: la cola
-- `dominio.consultas_avisos`, sus tres RPC y la Edge Function `enviar-aviso-consulta` quedaron sin uso
-- (la revisión de los E2E lo confirmó: no sale correo SMTP de «nueva consulta» por esa vía) y se
-- eliminaron. El aviso vigente sale por `private.emitir_aviso`: ver `avisos_consulta_nueva.test.sql`.
-- El fixture corre como postgres (RLS no aplica); las verificaciones, como «authenticated», «anon» o
-- «service_role», igual que PostgREST.
begin;

select plan(29);

insert into organizaciones (id, nombre) values
  ('11111111-1111-1111-1111-111111111111', 'Organización Uno'),
  ('22222222-2222-2222-2222-222222222222', 'Organización Dos');

insert into auth.users (id, email) values
  ('f1000000-0000-0000-0000-000000000001', 'admin-uno@example.com'),
  ('f2000000-0000-0000-0000-000000000001', 'admin-dos@example.com');

insert into usuarios_organizacion (user_id, organizacion_id, rol_id, estado) values
  ('f1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'administrador', 'activo'),
  ('f2000000-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', 'administrador', 'activo');

-- A tiene correo de contacto; B no tiene ninguno; C es de la otra organización.
insert into dominio.empresas (id, organizacion_id, nombre, correo) values
  ('a1000000-0000-0000-0000-00000000000a', '11111111-1111-1111-1111-111111111111', 'San Javucho', 'contacto@san.example'),
  ('a1000000-0000-0000-0000-00000000000b', '11111111-1111-1111-1111-111111111111', 'Mundo JC', null),
  ('a2000000-0000-0000-0000-00000000000c', '22222222-2222-2222-2222-222222222222', 'Empresa Dos', 'dos@example.com');

create function pg_temp.como(p_user uuid) returns void language plpgsql as $$
begin
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
  set local role authenticated;
end $$;

-- ============================================================================
-- Gate MSF-853: el camino directo del aviso ya no existe
-- ============================================================================

select ok(
  not exists (select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
               where n.nspname = 'dominio' and c.relname = 'consultas_avisos'),
  'la cola del camino directo (dominio.consultas_avisos) ya no existe'
);
select is_empty(
  $$select p.oid::regprocedure from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where p.proname in ('tomar_aviso_consulta', 'cerrar_aviso_consulta', 'avisos_consulta_pendientes')
      and n.nspname in ('public', 'private')$$,
  'las RPC del camino directo ya no existen'
);
select ok(
  not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
               where n.nspname = 'private' and p.proname = 'correo_avisos_consulta'),
  'el ayudante del destinatario efectivo (private.correo_avisos_consulta) ya no existe'
);
select ok(
  exists (select 1 from pg_trigger t
            join pg_class c on c.oid = t.tgrelid
            join pg_namespace n on n.oid = c.relnamespace
           where n.nspname = 'dominio' and c.relname = 'consultas' and t.tgname = 'consultas_encolar_aviso'),
  'el disparador del aviso sigue en dominio.consultas: el camino vigente no se tocó'
);
select ok(
  exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'private' and p.proname = 'encolar_aviso_consulta'),
  'private.encolar_aviso_consulta() sigue: emite por private.emitir_aviso'
);
-- La lista de exclusiones se copia de 20270224110206 tal cual, menos la fila de la tabla borrada: el
-- motivo de una fila ajena a la historia no puede cambiar (MSF-853).
select is(
  (select x.motivo from private.exclusiones_exportacion_total() x
    where x.esquema = 'public' and x.tabla = 'migracion_cargas'),
  'dato derivado o registro de proceso (no es dato de negocio)',
  'la exclusión de public.migracion_cargas conserva su motivo'
);

-- ============================================================================
-- Esquema (Principio VII) y privilegios de la dirección de avisos
-- ============================================================================

select ok(
  exists (select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
           where n.nspname = 'dominio' and c.relname = 'consultas_configuracion' and c.relrowsecurity),
  'consultas_configuracion vive en «dominio» y tiene RLS activada'
);
select ok(
  not exists (select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
               where n.nspname = 'public' and c.relname = 'consultas_configuracion'),
  'no existen copias en «public»'
);
select is(has_table_privilege('anon', 'dominio.consultas_configuracion', 'select'), false, 'anon no lee consultas_configuracion');
select is(has_table_privilege('authenticated', 'dominio.consultas_configuracion', 'insert'), false, 'authenticated no inserta configuración');
select is(
  has_function_privilege('anon', 'public.guardar_correo_avisos_consultas(uuid, text, timestamptz)', 'execute'),
  false, 'anon no ejecuta guardar_correo_avisos_consultas'
);
select is(
  has_function_privilege('authenticated', 'public.guardar_correo_avisos_consultas(uuid, text, timestamptz)', 'execute'),
  true, 'authenticated ejecuta guardar_correo_avisos_consultas'
);
select is_empty(
  $$select p.oid::regprocedure from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'private' and p.proname in ('encolar_aviso_consulta')
      and has_function_privilege('authenticated', p.oid, 'EXECUTE')$$,
  'authenticated no ejecuta los ayudantes internos del aviso'
);

-- ============================================================================
-- guardar_correo_avisos_consultas (FR-009)
-- ============================================================================

select throws_ok(
  $$select public.guardar_correo_avisos_consultas('a1000000-0000-0000-0000-00000000000a', 'x@example.com')$$,
  '42501', null, 'sin empresas = edición la RPC rechaza (42501)'
);

select pg_temp.como('f1000000-0000-0000-0000-000000000001');
select throws_ok(
  $$select public.guardar_correo_avisos_consultas('a1000000-0000-0000-0000-00000000000a', 'no-es-un-correo')$$,
  '22023', null, 'formato de correo inválido'
);
select throws_ok(
  $$select public.guardar_correo_avisos_consultas('a2000000-0000-0000-0000-00000000000c', 'x@example.com')$$,
  '42501', null, 'una empresa de otra organización no se edita ni revela si existe'
);
select lives_ok(
  $$select public.guardar_correo_avisos_consultas('a1000000-0000-0000-0000-00000000000a', '  avisos@san.example ')$$,
  'el administrador fija la dirección de avisos'
);
select is(
  (select correo_avisos from dominio.consultas_configuracion where empresa_id = 'a1000000-0000-0000-0000-00000000000a'),
  'avisos@san.example', 'el correo quedó normalizado'
);
select throws_ok(
  $$select public.guardar_correo_avisos_consultas('a1000000-0000-0000-0000-00000000000a', 'otro@san.example', null)$$,
  '40001', null, 'conflicto de edición: el sello no coincide'
);
select is(
  public.guardar_correo_avisos_consultas('a1000000-0000-0000-0000-00000000000a', 'avisos@san.example', null),
  (select updated_at from dominio.consultas_configuracion where empresa_id = 'a1000000-0000-0000-0000-00000000000a'),
  'repetir el mismo valor es idempotente: devuelve el sello vigente sin conflicto'
);
select lives_ok(
  $$select public.guardar_correo_avisos_consultas('a1000000-0000-0000-0000-00000000000a', 'otro@san.example',
    (select updated_at from dominio.consultas_configuracion where empresa_id = 'a1000000-0000-0000-0000-00000000000a'))$$,
  'con el sello correcto se cambia la dirección'
);
select lives_ok(
  $$select public.guardar_correo_avisos_consultas('a1000000-0000-0000-0000-00000000000a', null,
    (select updated_at from dominio.consultas_configuracion where empresa_id = 'a1000000-0000-0000-0000-00000000000a'))$$,
  'null vuelve al correo de contacto'
);
select is(
  (select correo_avisos from dominio.consultas_configuracion where empresa_id = 'a1000000-0000-0000-0000-00000000000a'),
  null, 'la dirección propia quedó vacía'
);
select is(public.guardar_correo_avisos_consultas('a1000000-0000-0000-0000-00000000000b', null), null,
  'sin fila y sin valor no hay nada que guardar');
select is((select count(*)::int from dominio.consultas_configuracion where empresa_id = 'a1000000-0000-0000-0000-00000000000b'), 0,
  'y no se creó una fila vacía');

select pg_temp.como('f2000000-0000-0000-0000-000000000001');
select is((select count(*)::int from dominio.consultas_configuracion), 0, 'la organización Dos no ve la configuración de la Uno');
select throws_ok(
  $$select public.guardar_correo_avisos_consultas('a1000000-0000-0000-0000-00000000000a', 'x@example.com')$$,
  '42501', null, 'la organización Dos no escribe en una empresa de la Uno'
);

reset role;
set local role anon;
select throws_ok(
  $$select public.guardar_correo_avisos_consultas('a1000000-0000-0000-0000-00000000000a', 'x@example.com')$$,
  '42501', null, 'anon no ejecuta la RPC'
);
reset role;

select is(
  (select count(*)::int from public.registro_actividad
    where tipo = 'consulta.avisos_actualizados' and empresa_id = 'a1000000-0000-0000-0000-00000000000a'),
  3, 'solo los cambios reales quedaron en la actividad (fijar, cambiar y volver al contacto)'
);

select * from finish();
rollback;
