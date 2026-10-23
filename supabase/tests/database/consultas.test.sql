-- MSF-186 · F-CON-01 (épica MSF-122, SC-001): `dominio.consultas`, la RPC pública de alta, la
-- edición con bloqueo optimista y la superficie de lectura de la bandeja.
-- Cubre FR-001…FR-004: esquema `dominio` con RLS, aislamiento entre organizaciones y entre
-- empresas, los tres niveles de permiso, alta solo por la RPC pública, validaciones,
-- conflicto de edición, responsable inválido, eventos de actividad y `anon` solo con la RPC.
-- El fixture corre como postgres (RLS no aplica) y las verificaciones como «authenticated»
-- o «anon», igual que PostgREST.
begin;

select plan(49);

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

insert into dominio.tiendas (organizacion_id, empresa_id, dominio) values
  ('11111111-1111-1111-1111-111111111111', 'a1000000-0000-0000-0000-00000000000a', 'sanjavucho.localhost'),
  ('11111111-1111-1111-1111-111111111111', 'a1000000-0000-0000-0000-00000000000b', 'mundojc.localhost'),
  ('22222222-2222-2222-2222-222222222222', 'a2000000-0000-0000-0000-00000000000c', 'empresa-dos.localhost');

insert into dominio.productos (id, organizacion_id, nombre, precio_lista) values
  ('b1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'Funda', 10),
  ('b2000000-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', 'Ajeno', 10);

create function pg_temp.como(p_user uuid) returns void language plpgsql as $$
begin
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
  set local role authenticated;
end $$;

-- ============================================================================
-- Esquema (Principio VII) y privilegios de anon
-- ============================================================================

select ok(
  exists (select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
           where n.nspname = 'dominio' and c.relname = 'consultas' and c.relrowsecurity),
  'consultas vive en «dominio» y tiene RLS activada'
);
select ok(
  not exists (select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
               where n.nspname = 'public' and c.relname = 'consultas'),
  'no existe una copia en «public»'
);
select is(has_table_privilege('anon', 'dominio.consultas', 'select'), false, 'anon no lee dominio.consultas');
select is(has_table_privilege('anon', 'dominio.consultas', 'insert'), false, 'anon no inserta en dominio.consultas');
select is(has_table_privilege('anon', 'public.consultas_bandeja', 'select'), false, 'anon no lee la bandeja');
select is(
  has_function_privilege('anon', 'publico.crear_consulta_publica(text, text, text, text, text, uuid)', 'execute'),
  true, 'anon ejecuta publico.crear_consulta_publica'
);
select is_empty(
  $$select p.oid::regprocedure from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname in ('actualizar_consulta', 'contar_consultas_nuevas', 'responsables_consultas')
      and has_function_privilege('anon', p.oid, 'EXECUTE')$$,
  'anon no ejecuta ninguna RPC interna de consultas'
);
select is_empty(
  $$select p.oid::regprocedure from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'private' and p.proname in ('responsables_posibles', 'normalizar_consulta')
      and has_function_privilege('authenticated', p.oid, 'EXECUTE')$$,
  'authenticated no ejecuta los ayudantes internos que dan acceso sin chequeo'
);

-- ============================================================================
-- Alta pública (FR-002)
-- ============================================================================

reset role;
set local role anon;

select lives_ok(
  $$select publico.crear_consulta_publica('MundoJC.LocalHost:443.', 'formulario', '  Ana Pérez ', 'ana@example.com', 'Hola, ¿tienen stock?', 'b1000000-0000-0000-0000-000000000001')$$,
  'el formulario de una tienda crea una consulta (host normalizado)'
);
select lives_ok(
  $$select publico.crear_consulta_publica('sanjavucho.localhost', 'whatsapp', 'Carlos', '+54 9 11 5555-1234')$$,
  'WhatsApp puede venir sin mensaje ni producto'
);
select throws_ok(
  $$select publico.crear_consulta_publica('no-existe.ejemplo.com', 'formulario', 'X', 'x@example.com', 'Hola')$$,
  'P0002', 'No se encontró la tienda', 'host desconocido: error genérico'
);

reset role;
update dominio.empresas set activa = false where id = 'a2000000-0000-0000-0000-00000000000c';
set local role anon;
select throws_ok(
  $$select publico.crear_consulta_publica('empresa-dos.localhost', 'formulario', 'X', 'x@example.com', 'Hola')$$,
  'P0002', 'No se encontró la tienda', 'empresa desactivada: el mismo error genérico'
);
select throws_ok(
  $$select publico.crear_consulta_publica('mundojc.localhost', 'formulario', 'Ana', 'no-es-contacto', 'Hola')$$,
  '22023', null, 'contacto que no es correo ni teléfono'
);
select throws_ok(
  $$select publico.crear_consulta_publica('mundojc.localhost', 'formulario', '   ', 'ana@example.com', 'Hola')$$,
  '22023', null, 'nombre vacío'
);
select throws_ok(
  $$select publico.crear_consulta_publica('mundojc.localhost', 'formulario', 'Ana', 'ana@example.com', null)$$,
  '22023', null, 'el formulario exige mensaje'
);
select throws_ok(
  $$select publico.crear_consulta_publica('mundojc.localhost', 'telegram', 'Ana', 'ana@example.com', 'Hola')$$,
  '22023', null, 'origen desconocido'
);
select throws_ok(
  $$select publico.crear_consulta_publica('mundojc.localhost', 'formulario', 'Ana', 'ana@example.com', repeat('x', 2001))$$,
  '22023', null, 'mensaje demasiado largo'
);
select throws_ok(
  $$select publico.crear_consulta_publica('mundojc.localhost', 'formulario', 'Ana', 'ana@example.com', 'Hola', 'b2000000-0000-0000-0000-000000000001')$$,
  '22023', null, 'producto de otra organización'
);
select throws_ok(
  $$insert into dominio.consultas (organizacion_id, empresa_id, origen, nombre, contacto, mensaje)
    values ('11111111-1111-1111-1111-111111111111', 'a1000000-0000-0000-0000-00000000000a', 'formulario', 'X', 'x@example.com', 'Hola')$$,
  '42501', null, 'anon no inserta directo'
);

reset role;
select is((select count(*)::int from dominio.consultas), 2, 'los rechazos no guardaron nada: solo las dos altas válidas');
select is(
  (select count(*)::int from dominio.consultas
    where empresa_id = 'a1000000-0000-0000-0000-00000000000b' and estado = 'nueva' and nombre = 'Ana Pérez'
      and origen = 'formulario' and producto_id = 'b1000000-0000-0000-0000-000000000001'),
  1, 'la consulta quedó Nueva, en la empresa dueña del dominio y con el nombre normalizado'
);

-- Una consulta de la otra organización (fixture directo).
insert into dominio.consultas (id, organizacion_id, empresa_id, origen, nombre, contacto, mensaje) values
  ('c2000000-0000-0000-0000-00000000000c', '22222222-2222-2222-2222-222222222222',
   'a2000000-0000-0000-0000-00000000000c', 'formulario', 'Dora', 'dora@example.com', 'Consulta ajena');
update dominio.empresas set activa = true where id = 'a2000000-0000-0000-0000-00000000000c';

-- ============================================================================
-- Lectura: organización, empresa accesible y sección consultas
-- ============================================================================

select pg_temp.como('f1000000-0000-0000-0000-000000000001');
select is((select count(*)::int from dominio.consultas), 2,
  'el administrador de la Uno ve las consultas de sus dos empresas y ninguna de la Dos');

select pg_temp.como('f2000000-0000-0000-0000-000000000001');
select is((select array_agg(nombre) from dominio.consultas), array['Dora'],
  'la organización Dos ve solo la suya');

select pg_temp.como('f1000000-0000-0000-0000-000000000002');
select is((select array_agg(nombre) from dominio.consultas), array['Carlos'],
  'el operador (consultas = edición) ve solo la empresa que tiene asignada');

select pg_temp.como('f1000000-0000-0000-0000-000000000003');
select is((select array_agg(nombre) from dominio.consultas), array['Ana Pérez'],
  'la persona de consulta (lectura) ve solo la de su empresa');

select pg_temp.como('f1000000-0000-0000-0000-000000000001');
select is(
  (select array_agg(producto_nombre order by nombre) from public.consultas_bandeja where empresa_id = 'a1000000-0000-0000-0000-00000000000b'),
  array['Funda'], 'la bandeja resuelve el nombre del producto'
);
select is(
  (select array_agg(empresa_nombre order by empresa_nombre) from public.consultas_bandeja),
  array['Mundo JC', 'San Javucho'], 'la bandeja muestra el nombre de la empresa y respeta el aislamiento'
);
select is(public.contar_consultas_nuevas(), 2, 'el contador suma las nuevas visibles');
select is(public.contar_consultas_nuevas('a1000000-0000-0000-0000-00000000000b'), 1, 'el contador filtra por empresa');
select pg_temp.como('f1000000-0000-0000-0000-000000000002');
select is(public.contar_consultas_nuevas(), 1, 'el contador respeta la empresa accesible');

-- ============================================================================
-- Escritura: solo por RPC
-- ============================================================================

select throws_ok(
  $$update dominio.consultas set estado = 'resuelta'$$,
  '42501', null, 'ni quien tiene edición actualiza directo'
);
select throws_ok(
  $$delete from dominio.consultas$$,
  '42501', null, 'nadie borra'
);
select throws_ok(
  $$insert into dominio.consultas (organizacion_id, empresa_id, origen, nombre, contacto, mensaje)
    values ('11111111-1111-1111-1111-111111111111', 'a1000000-0000-0000-0000-00000000000a', 'formulario', 'X', 'x@example.com', 'Hola')$$,
  '42501', null, 'ni inserta directo'
);

-- ============================================================================
-- responsables_consultas
-- ============================================================================

select pg_temp.como('f1000000-0000-0000-0000-000000000001');
select is(
  (select array_agg(user_id order by user_id) from public.responsables_consultas('a1000000-0000-0000-0000-00000000000a')),
  array['f1000000-0000-0000-0000-000000000001', 'f1000000-0000-0000-0000-000000000002']::uuid[],
  'en San Javucho se puede asignar al administrador y al operador asignado, no a quien no tiene la empresa'
);
select throws_ok(
  $$select * from public.responsables_consultas('a2000000-0000-0000-0000-00000000000c')$$,
  '42501', null, 'no lista responsables de una empresa ajena'
);

-- ============================================================================
-- actualizar_consulta (FR-003)
-- ============================================================================

select pg_temp.como('f1000000-0000-0000-0000-000000000003');
select throws_ok(
  format($$select public.actualizar_consulta(%L, 'resuelta', null, null, now())$$, (select id from dominio.consultas limit 1)),
  '42501', null, 'con consultas = lectura no se edita'
);

select pg_temp.como('f1000000-0000-0000-0000-000000000002');
select throws_ok(
  $$select public.actualizar_consulta((select id from public.consultas_bandeja limit 1), 'bogus', null, null, now())$$,
  '22023', null, 'estado inválido'
);

reset role;
create temp table consulta_a as
  select id, updated_at from dominio.consultas where empresa_id = 'a1000000-0000-0000-0000-00000000000a';
create temp table consulta_b as
  select id, updated_at from dominio.consultas where empresa_id = 'a1000000-0000-0000-0000-00000000000b';
grant select on consulta_a, consulta_b to authenticated;

select pg_temp.como('f1000000-0000-0000-0000-000000000002');
select throws_ok(
  $$select public.actualizar_consulta((select id from consulta_b), 'resuelta', null, null, (select updated_at from consulta_b))$$,
  '42501', null, 'una empresa sin acceso no se edita ni revela si existe'
);
select throws_ok(
  $$select public.actualizar_consulta((select id from consulta_a), 'en_curso', 'f2000000-0000-0000-0000-000000000001', null, (select updated_at from consulta_a))$$,
  '22023', null, 'el responsable de otra organización se rechaza'
);
select throws_ok(
  $$select public.actualizar_consulta((select id from consulta_a), 'en_curso', 'f1000000-0000-0000-0000-000000000003', null, (select updated_at from consulta_a))$$,
  '22023', null, 'el responsable sin acceso a la empresa se rechaza'
);
select lives_ok(
  $$select public.actualizar_consulta((select id from consulta_a), 'en_curso', 'f1000000-0000-0000-0000-000000000002', '  Llamar mañana ', (select updated_at from consulta_a))$$,
  'asignar, anotar y pasar a En curso'
);
select is(
  (select (estado, responsable_id, nota_interna)::text from dominio.consultas where id = (select id from consulta_a)),
  '(en_curso,f1000000-0000-0000-0000-000000000002,"Llamar mañana")',
  'quedó guardado, con la nota recortada'
);
select ok(
  (select c.updated_at > a.updated_at from dominio.consultas c join consulta_a a on a.id = c.id),
  'el sello updated_at avanzó'
);
select throws_ok(
  $$select public.actualizar_consulta((select id from consulta_a), 'resuelta', null, null, (select updated_at from consulta_a))$$,
  '40001', null, 'con el sello viejo y un cambio real: conflicto de edición'
);
select lives_ok(
  $$select public.actualizar_consulta((select id from consulta_a), 'en_curso', 'f1000000-0000-0000-0000-000000000002', 'Llamar mañana', (select updated_at from consulta_a))$$,
  'repetir lo ya guardado es idempotente aunque el sello sea el viejo'
);
select is(
  (select nombre || '/' || contacto from dominio.consultas where id = (select id from consulta_a)),
  'Carlos/+54 9 11 5555-1234',
  'solo cambian estado, responsable y nota'
);

reset role;
select is(
  (select array_agg(tipo order by tipo) from public.registro_actividad
    where empresa_id = 'a1000000-0000-0000-0000-00000000000a' and tipo like 'consulta.%'),
  array['consulta.asignada', 'consulta.estado_cambiado', 'consulta.nota_actualizada'],
  'un evento por campo cambiado y ninguno por la repetición idempotente'
);

-- «Consultas» en ninguno para la persona de consulta: sin filas aunque consulte directo.
update permisos_rol set nivel = 'ninguno'
 where organizacion_id = '11111111-1111-1111-1111-111111111111' and rol_id = 'consulta' and seccion = 'consultas';
select pg_temp.como('f1000000-0000-0000-0000-000000000003');
select is((select count(*)::int from dominio.consultas), 0, 'sección Consultas en «ninguno»: sin filas');
select throws_ok(
  $$select * from public.responsables_consultas('a1000000-0000-0000-0000-00000000000b')$$,
  '42501', null, 'ni lista responsables'
);

select * from finish();
rollback;
