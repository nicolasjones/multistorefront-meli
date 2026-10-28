-- MSF-244 · F-CON-04 (épica MSF-130, SC-004, parte base de datos): «Responder por…» NO tiene migración y
-- reusa `public.actualizar_consulta` (MSF-122). Se prueba la llamada exacta que hace el panel
-- (nueva → en_curso, responsable = quien responde, nota y `updated_at` vigentes), que no pisa a otro
-- responsable ni reabre una resuelta, el aislamiento entre dos organizaciones y los permisos por rol.
-- El fixture corre como postgres (RLS no aplica); las verificaciones, como «authenticated».
begin;

select plan(13);

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
  ('a2000000-0000-0000-0000-00000000000c', '22222222-2222-2222-2222-222222222222', 'Empresa Dos');

insert into usuarios_empresas (user_id, empresa_id, organizacion_id, rol_id) values
  ('f1000000-0000-0000-0000-000000000002', 'a1000000-0000-0000-0000-00000000000a', '11111111-1111-1111-1111-111111111111', 'operador'),
  ('f1000000-0000-0000-0000-000000000003', 'a1000000-0000-0000-0000-00000000000a', '11111111-1111-1111-1111-111111111111', 'consulta');
insert into usuario_empresa_activa (user_id, empresa_id) values
  ('f1000000-0000-0000-0000-000000000002', 'a1000000-0000-0000-0000-00000000000a'),
  ('f1000000-0000-0000-0000-000000000003', 'a1000000-0000-0000-0000-00000000000a');

insert into dominio.consultas (id, organizacion_id, empresa_id, origen, nombre, contacto, mensaje, estado, responsable_id, nota_interna) values
  ('c1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'a1000000-0000-0000-0000-00000000000a',
   'formulario', 'Ana', 'ana@example.com', 'Hola', 'nueva', null, 'Nota vigente'),
  ('c1000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'a1000000-0000-0000-0000-00000000000a',
   'whatsapp', 'Beto', '+54 9 11 5555-1234', null, 'resuelta', 'f1000000-0000-0000-0000-000000000001', null),
  ('c2000000-0000-0000-0000-00000000000c', '22222222-2222-2222-2222-222222222222', 'a2000000-0000-0000-0000-00000000000c',
   'formulario', 'Dora', 'dora@example.com', 'Ajena', 'nueva', null, null);

create temp table sellos as select id, updated_at from dominio.consultas;
grant select on sellos to authenticated;

create function pg_temp.como(p_user uuid) returns void language plpgsql as $$
begin
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
  set local role authenticated;
end $$;

-- Permisos por rol (FR-011): la base lo impone, no solo la pantalla.
select pg_temp.como('f1000000-0000-0000-0000-000000000003');
select throws_ok(
  $$select public.actualizar_consulta('c1000000-0000-0000-0000-000000000001', 'en_curso', 'f1000000-0000-0000-0000-000000000003',
      'Nota vigente', (select updated_at from sellos where id = 'c1000000-0000-0000-0000-000000000001'))$$,
  '42501', null, 'con consultas = lectura no se puede responder (registrar)'
);

-- Aislamiento: la otra organización no puede registrar una respuesta sobre esta consulta.
select pg_temp.como('f2000000-0000-0000-0000-000000000001');
select throws_ok(
  $$select public.actualizar_consulta('c1000000-0000-0000-0000-000000000001', 'en_curso', 'f2000000-0000-0000-0000-000000000001',
      'Nota vigente', (select updated_at from sellos where id = 'c1000000-0000-0000-0000-000000000001'))$$,
  '42501', null, 'una consulta de otra organización no se toca ni revela si existe'
);
select pg_temp.como('f1000000-0000-0000-0000-000000000002');
select throws_ok(
  $$select public.actualizar_consulta('c2000000-0000-0000-0000-00000000000c', 'en_curso', 'f1000000-0000-0000-0000-000000000002',
      null, (select updated_at from sellos where id = 'c2000000-0000-0000-0000-00000000000c'))$$,
  '42501', null, 'la organización uno tampoco toca la consulta de la dos'
);

-- La llamada de «Responder» (FR-010): nueva → en_curso, responsable = quien responde, nota y sello vigentes.
select lives_ok(
  $$select public.actualizar_consulta('c1000000-0000-0000-0000-000000000001', 'en_curso', 'f1000000-0000-0000-0000-000000000002',
      'Nota vigente', (select updated_at from sellos where id = 'c1000000-0000-0000-0000-000000000001'))$$,
  'el operador (consultas = edición) responde: queda En curso a su nombre'
);
select is(
  (select (estado, responsable_id, nota_interna)::text from dominio.consultas where id = 'c1000000-0000-0000-0000-000000000001'),
  '(en_curso,f1000000-0000-0000-0000-000000000002,"Nota vigente")',
  'estado, responsable y la nota vigente quedaron guardados'
);
select ok(
  (select c.updated_at > s.updated_at from dominio.consultas c join sellos s on s.id = c.id where c.id = 'c1000000-0000-0000-0000-000000000001'),
  'el sello updated_at avanzó'
);
reset role;
select is(
  (select array_agg(tipo order by tipo) from public.registro_actividad
    where empresa_id = 'a1000000-0000-0000-0000-00000000000a' and tipo like 'consulta.%'),
  array['consulta.asignada', 'consulta.estado_cambiado'],
  'se registró la actividad de estado y de asignación (la nota no cambió)'
);

-- Reintento tras éxito (FR-012): repetir con el sello viejo es idempotente, no un conflicto.
select pg_temp.como('f1000000-0000-0000-0000-000000000002');
select lives_ok(
  $$select public.actualizar_consulta('c1000000-0000-0000-0000-000000000001', 'en_curso', 'f1000000-0000-0000-0000-000000000002',
      'Nota vigente', (select updated_at from sellos where id = 'c1000000-0000-0000-0000-000000000001'))$$,
  'un reintento tras éxito no genera conflicto'
);

-- Conflicto real: alguien cambió la consulta antes (FR-012, 40001).
select throws_ok(
  $$select public.actualizar_consulta('c1000000-0000-0000-0000-000000000001', 'resuelta', 'f1000000-0000-0000-0000-000000000002',
      'Nota vigente', (select updated_at from sellos where id = 'c1000000-0000-0000-0000-000000000001'))$$,
  '40001', null, 'con el sello viejo y un cambio real hay conflicto'
);

-- Una resuelta con responsable ajeno: el panel manda el estado y el responsable actuales → sin cambios.
select lives_ok(
  $$select public.actualizar_consulta('c1000000-0000-0000-0000-000000000002', 'resuelta', 'f1000000-0000-0000-0000-000000000001',
      null, (select updated_at from sellos where id = 'c1000000-0000-0000-0000-000000000002'))$$,
  'responder una resuelta con responsable no cambia nada'
);
select is(
  (select (estado, responsable_id)::text from dominio.consultas where id = 'c1000000-0000-0000-0000-000000000002'),
  '(resuelta,f1000000-0000-0000-0000-000000000001)',
  'no se reabrió ni se pisó al responsable'
);

-- Solo cambian estado, responsable y nota.
select is(
  (select nombre || '/' || contacto from dominio.consultas where id = 'c1000000-0000-0000-0000-000000000001'),
  'Ana/ana@example.com', 'nombre y contacto no se tocan'
);

-- anon no ejecuta actualizar_consulta.
select is(
  has_function_privilege('anon', 'public.actualizar_consulta(uuid, text, uuid, text, timestamptz)', 'execute'),
  false, 'anon NO ejecuta actualizar_consulta'
);

select * from finish();
rollback;
