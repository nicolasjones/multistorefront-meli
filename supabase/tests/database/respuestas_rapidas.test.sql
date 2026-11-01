-- MSF-274 · F-CON-06 (épica MSF-144, SC-004): `dominio.respuestas_rapidas`, su vista y sus RPC.
-- Cubre FR-013, FR-014 y FR-017: esquema `dominio` con RLS, aislamiento entre organizaciones y entre
-- empresas, permisos por nivel de la sección `consultas`, escritura directa rechazada, validaciones,
-- actividad sin el texto y `anon` sin acceso. `rls_en_toda_tabla` cubre además que la tabla tenga RLS.
-- El fixture corre como postgres (RLS no aplica) y las verificaciones como «authenticated» o «anon».
begin;

select plan(32);

insert into organizaciones (id, nombre) values
  ('11111111-1111-1111-1111-111111111111', 'Organización Uno'),
  ('22222222-2222-2222-2222-222222222222', 'Organización Dos');

insert into auth.users (id, email) values
  ('f1000000-0000-0000-0000-000000000001', 'admin-uno@example.com'),
  ('f1000000-0000-0000-0000-000000000002', 'operador-uno@example.com'),
  ('f1000000-0000-0000-0000-000000000003', 'consulta-uno@example.com'),
  ('f2000000-0000-0000-0000-000000000001', 'admin-dos@example.com');

insert into usuarios_organizacion (user_id, organizacion_id, rol_id, estado) values
  ('f1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'administrador', 'activo'),
  ('f1000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'operador', 'activo'),
  ('f1000000-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111', 'consulta', 'activo'),
  ('f2000000-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', 'administrador', 'activo');

insert into dominio.empresas (id, organizacion_id, nombre) values
  ('a1000000-0000-0000-0000-00000000000a', '11111111-1111-1111-1111-111111111111', 'San Javucho'),
  ('a1000000-0000-0000-0000-00000000000b', '11111111-1111-1111-1111-111111111111', 'Mundo JC'),
  ('a2000000-0000-0000-0000-00000000000c', '22222222-2222-2222-2222-222222222222', 'Empresa Dos');

-- El operador trabaja en San Javucho; la persona de consulta, en Mundo JC.
insert into usuarios_empresas (user_id, empresa_id, organizacion_id, rol_id) values
  ('f1000000-0000-0000-0000-000000000002', 'a1000000-0000-0000-0000-00000000000a', '11111111-1111-1111-1111-111111111111', 'operador'),
  ('f1000000-0000-0000-0000-000000000003', 'a1000000-0000-0000-0000-00000000000b', '11111111-1111-1111-1111-111111111111', 'consulta');
insert into usuario_empresa_activa (user_id, empresa_id) values
  ('f1000000-0000-0000-0000-000000000002', 'a1000000-0000-0000-0000-00000000000a'),
  ('f1000000-0000-0000-0000-000000000003', 'a1000000-0000-0000-0000-00000000000b');

create function pg_temp.como(p_user uuid) returns void language plpgsql as $$
begin
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
  set local role authenticated;
end $$;

-- Una respuesta por empresa, sembradas por el fixture (sin pasar por la RPC).
insert into dominio.respuestas_rapidas (id, organizacion_id, empresa_id, titulo, texto) values
  ('c1000000-0000-0000-0000-00000000000a', '11111111-1111-1111-1111-111111111111', 'a1000000-0000-0000-0000-00000000000a', 'Gracias SJ', 'Hola {nombre}, gracias por escribir a {tienda}.'),
  ('c1000000-0000-0000-0000-00000000000b', '11111111-1111-1111-1111-111111111111', 'a1000000-0000-0000-0000-00000000000b', 'Gracias MJC', 'Hola {nombre}'),
  ('c2000000-0000-0000-0000-00000000000c', '22222222-2222-2222-2222-222222222222', 'a2000000-0000-0000-0000-00000000000c', 'Gracias Dos', 'Hola {nombre}');

-- ============================================================================
-- Esquema (Principio VII) y privilegios de anon
-- ============================================================================

select ok(
  exists (select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
           where n.nspname = 'dominio' and c.relname = 'respuestas_rapidas' and c.relrowsecurity),
  'respuestas_rapidas vive en «dominio» y tiene RLS activada'
);
select ok(
  not exists (select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
               where n.nspname = 'public' and c.relname = 'respuestas_rapidas'),
  'no existe una copia en «public»'
);
select is(has_table_privilege('anon', 'dominio.respuestas_rapidas', 'select'), false, 'anon no lee la tabla');
select is(has_table_privilege('anon', 'public.respuestas_rapidas_lista', 'select'), false, 'anon no lee la vista');
select is_empty(
  $$select p.oid::regprocedure from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname in ('guardar_respuesta_rapida', 'eliminar_respuesta_rapida')
      and has_function_privilege('anon', p.oid, 'EXECUTE')$$,
  'anon no ejecuta las RPC de respuestas rápidas'
);
select is_empty(
  $$select p.oid::regprocedure from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname in ('guardar_respuesta_rapida', 'eliminar_respuesta_rapida')
      and not has_function_privilege('authenticated', p.oid, 'EXECUTE')$$,
  'authenticated sí ejecuta las RPC de respuestas rápidas'
);
select is(has_table_privilege('authenticated', 'dominio.respuestas_rapidas', 'insert'), false,
  'authenticated no inserta directo en la tabla');
select is(has_table_privilege('authenticated', 'dominio.respuestas_rapidas', 'update'), false,
  'authenticated no actualiza directo la tabla');
select is(has_table_privilege('authenticated', 'dominio.respuestas_rapidas', 'delete'), false,
  'authenticated no borra directo de la tabla');

-- ============================================================================
-- Lectura: organización, empresa accesible y sección consultas (FR-017)
-- ============================================================================

select pg_temp.como('f1000000-0000-0000-0000-000000000001');
select is((select count(*)::int from public.respuestas_rapidas_lista), 2,
  'el administrador de la Uno ve las de sus dos empresas y ninguna de la Dos');

select pg_temp.como('f2000000-0000-0000-0000-000000000001');
select is((select array_agg(titulo) from public.respuestas_rapidas_lista), array['Gracias Dos'],
  'la organización Dos ve solo la suya');

select pg_temp.como('f1000000-0000-0000-0000-000000000002');
select is((select array_agg(titulo) from public.respuestas_rapidas_lista), array['Gracias SJ'],
  'el operador (consultas = edición) ve solo la empresa que tiene asignada');

select pg_temp.como('f1000000-0000-0000-0000-000000000003');
select is((select array_agg(titulo) from public.respuestas_rapidas_lista), array['Gracias MJC'],
  'la persona de consulta (lectura) ve solo la de su empresa');

-- ============================================================================
-- Escritura solo por RPC con consultas = edición (FR-014, FR-017)
-- ============================================================================

select pg_temp.como('f1000000-0000-0000-0000-000000000002');
select throws_ok(
  $$insert into dominio.respuestas_rapidas (organizacion_id, empresa_id, titulo, texto)
    values ('11111111-1111-1111-1111-111111111111', 'a1000000-0000-0000-0000-00000000000a', 'Directo', 'x')$$,
  '42501', null, 'la escritura directa en la tabla se rechaza'
);

select lives_ok(
  $$select public.guardar_respuesta_rapida(null, 'a1000000-0000-0000-0000-00000000000a', '  Horarios ', '  Abrimos a las 9, {nombre}.  ')$$,
  'el operador crea una respuesta en su empresa'
);
select is(
  (select array_agg(titulo || '|' || texto order by titulo) from public.respuestas_rapidas_lista),
  array['Gracias SJ|Hola {nombre}, gracias por escribir a {tienda}.', 'Horarios|Abrimos a las 9, {nombre}.'],
  'título y texto se guardan recortados'
);
select throws_ok(
  $$select public.guardar_respuesta_rapida(null, 'a1000000-0000-0000-0000-00000000000b', 'Ajena', 'x')$$,
  '42501', null, 'no crea en una empresa a la que no tiene acceso'
);
select throws_ok(
  $$select public.guardar_respuesta_rapida(null, 'a2000000-0000-0000-0000-00000000000c', 'Otra org', 'x')$$,
  '42501', null, 'no crea en una empresa de otra organización'
);
select throws_ok(
  $$select public.guardar_respuesta_rapida(null, 'a1000000-0000-0000-0000-00000000000a', '   ', 'x')$$,
  '22023', null, 'título vacío'
);
select throws_ok(
  $$select public.guardar_respuesta_rapida(null, 'a1000000-0000-0000-0000-00000000000a', 'Largo', repeat('x', 1001))$$,
  '22023', null, 'texto de más de 1000 caracteres'
);
select lives_ok(
  $$select public.guardar_respuesta_rapida('c1000000-0000-0000-0000-00000000000a', 'a1000000-0000-0000-0000-00000000000b', 'Gracias SJ 2', 'Hola de nuevo')$$,
  'editar una respuesta propia funciona'
);
select is(
  (select empresa_id from public.respuestas_rapidas_lista where id = 'c1000000-0000-0000-0000-00000000000a'),
  'a1000000-0000-0000-0000-00000000000a'::uuid,
  'la edición no mueve la respuesta de empresa (se ignora el p_empresa_id)'
);
select throws_ok(
  $$select public.guardar_respuesta_rapida('c1000000-0000-0000-0000-00000000000b', 'a1000000-0000-0000-0000-00000000000b', 'Hackeo', 'x')$$,
  '42501', null, 'no edita la respuesta de una empresa sin acceso'
);
select throws_ok(
  $$select public.eliminar_respuesta_rapida('c2000000-0000-0000-0000-00000000000c')$$,
  '42501', null, 'no elimina la respuesta de otra organización'
);
select lives_ok(
  $$select public.eliminar_respuesta_rapida((select id from public.respuestas_rapidas_lista where titulo = 'Horarios'))$$,
  'elimina una respuesta propia'
);

-- La actividad registra el título, nunca el texto.
reset role;
select is(
  (select array_agg(tipo order by tipo) from public.registro_actividad where tipo like 'respuesta_rapida.%'),
  array['respuesta_rapida.creada', 'respuesta_rapida.editada', 'respuesta_rapida.eliminada'],
  'se registran los tres eventos de actividad'
);
select is(
  (select count(*)::int from public.registro_actividad where tipo like 'respuesta_rapida.%' and detalle like '%Abrimos%'),
  0, 'la actividad no copia el texto de la respuesta'
);

-- ============================================================================
-- Solo lectura y sin acceso
-- ============================================================================

select pg_temp.como('f1000000-0000-0000-0000-000000000003');
select throws_ok(
  $$select public.guardar_respuesta_rapida(null, 'a1000000-0000-0000-0000-00000000000b', 'Con lectura', 'x')$$,
  '42501', null, 'con consultas en lectura no se crea'
);
select throws_ok(
  $$select public.eliminar_respuesta_rapida('c1000000-0000-0000-0000-00000000000b')$$,
  '42501', null, 'con consultas en lectura no se elimina'
);

reset role;
update permisos_rol set nivel = 'ninguno'
 where organizacion_id = '11111111-1111-1111-1111-111111111111' and rol_id = 'consulta' and seccion = 'consultas';
select pg_temp.como('f1000000-0000-0000-0000-000000000003');
select is((select count(*)::int from public.respuestas_rapidas_lista), 0, 'sección Consultas en «ninguno»: sin filas');

-- anon: sin acceso a nada.
reset role;
set local role anon;
select throws_ok($$select count(*) from public.respuestas_rapidas_lista$$, '42501', null, 'anon no lee la vista (permiso denegado)');
select throws_ok(
  $$select public.guardar_respuesta_rapida(null, 'a1000000-0000-0000-0000-00000000000a', 'Anon', 'x')$$,
  '42501', null, 'anon no ejecuta guardar_respuesta_rapida'
);

select * from finish();
rollback;
