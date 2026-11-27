-- MSF-595: los estados configurables (`dominio.estados_consulta`) conectados a `dominio.consultas.estado`.
-- Cubre: siembra de los tres estados de base por organización (trigger de alta y adopción de uno propio con el mismo nombre),
-- clave estable (id del estado; inmutable para quien usa la app), los de base no se desactivan, `actualizar_consulta` con un
-- estado propio activo, un estado inexistente (PT404), uno desactivado (PT412 con detail estado), una consulta que ya estaba en
-- un estado que luego se desactiva (se muestra y se guarda sin cambiarlo; no se puede volver a elegirlo desde otro) y el
-- aislamiento entre organizaciones. El fixture corre como postgres; las verificaciones, como «authenticated».
begin;

select plan(29);

insert into organizaciones (id, nombre) values
  ('11111111-1111-1111-1111-111111111111', 'Organización Uno'),
  ('22222222-2222-2222-2222-222222222222', 'Organización Dos');
insert into auth.users (id, email) values
  ('f5950000-0000-0000-0000-000000000001', 'admin-595@example.com'),
  ('f5950000-0000-0000-0000-000000000002', 'admin-dos-595@example.com');
insert into usuarios_organizacion (user_id, organizacion_id, rol_id, estado) values
  ('f5950000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'administrador', 'activo'),
  ('f5950000-0000-0000-0000-000000000002', '22222222-2222-2222-2222-222222222222', 'administrador', 'activo');
insert into dominio.empresas (id, organizacion_id, nombre) values
  ('a5950000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'Tienda Uno'),
  ('a5950000-0000-0000-0000-000000000002', '22222222-2222-2222-2222-222222222222', 'Tienda Dos');
insert into dominio.consultas (id, organizacion_id, empresa_id, origen, nombre, contacto, mensaje) values
  ('c5950000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'a5950000-0000-0000-0000-000000000001', 'formulario', 'Ana', 'ana@example.com', 'Hola'),
  ('c5950000-0000-0000-0000-000000000002', '22222222-2222-2222-2222-222222222222', 'a5950000-0000-0000-0000-000000000002', 'formulario', 'Beto', 'beto@example.com', 'Hola');

-- `detail` del error (la web lo usa para distinguir «estado desactivado» de «conflicto de edición»).
create function pg_temp.detalle_de(p_sql text) returns text language plpgsql as $$
declare v_detalle text;
begin
  execute p_sql;
  return 'sin error';
exception when others then
  get stacked diagnostics v_detalle = pg_exception_detail;
  return coalesce(nullif(v_detalle, ''), 'sin detail');
end $$;

create function pg_temp.como(p_user uuid) returns void language plpgsql as $$
begin
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
  set local role authenticated;
end $$;

-- ============================================================================
-- Siembra: cada organización nace con sus tres estados de base, de sistema y activos
-- ============================================================================
select is(
  (select array_agg(clave order by orden) from dominio.estados_consulta where organizacion_id = '11111111-1111-1111-1111-111111111111'),
  array['nueva', 'en_curso', 'resuelta'],
  'una organización nueva tiene sus tres estados de base, en ese orden'
);
select is(
  (select count(*)::int from dominio.estados_consulta
    where organizacion_id = '11111111-1111-1111-1111-111111111111' and es_sistema and activo),
  3, 'los tres de base son de sistema y están activos'
);
select is(
  (select array_agg(nombre order by orden) from dominio.estados_consulta where organizacion_id = '22222222-2222-2222-2222-222222222222'),
  array['Nueva', 'En curso', 'Resuelta'], 'cada organización tiene los suyos, con su nombre visible'
);

-- Una organización con un estado propio «Nueva» desactivado: la siembra lo ADOPTA (no duplica, lo reactiva y lo marca de sistema).
insert into organizaciones (id, nombre) values ('33333333-3333-3333-3333-333333333333', 'Organización Tres');
alter table dominio.estados_consulta disable trigger estados_consulta_proteger_sistema;
delete from dominio.estados_consulta where organizacion_id = '33333333-3333-3333-3333-333333333333';
alter table dominio.estados_consulta enable trigger estados_consulta_proteger_sistema;
insert into dominio.estados_consulta (id, organizacion_id, nombre, activo, orden) values
  ('d5950000-0000-0000-0000-0000000000a1', '33333333-3333-3333-3333-333333333333', ' nueva ', false, 5);
select private.sembrar_estados_consulta('33333333-3333-3333-3333-333333333333');
select is(
  (select count(*)::int from dominio.estados_consulta where organizacion_id = '33333333-3333-3333-3333-333333333333'),
  3, 'la siembra no duplica un estado propio con el mismo nombre'
);
select is(
  (select row(clave, es_sistema, activo)::text from dominio.estados_consulta where id = 'd5950000-0000-0000-0000-0000000000a1'),
  '(nueva,t,t)', 'el estado propio se adopta como el de base: clave nueva, de sistema y reactivado'
);
select private.sembrar_estados_consulta('33333333-3333-3333-3333-333333333333');
select is(
  (select count(*)::int from dominio.estados_consulta where organizacion_id = '33333333-3333-3333-3333-333333333333'),
  3, 'sembrar de nuevo no agrega nada (idempotente)'
);

-- ============================================================================
-- Lista configurable: clave y estados de base
-- ============================================================================
-- Un estado propio de la Dos, con clave conocida: la Uno no lo ve ni lo puede elegir.
insert into dominio.estados_consulta (organizacion_id, nombre, clave) values ('22222222-2222-2222-2222-222222222222', 'Solo Dos', 'dos-solo');

select pg_temp.como('f5950000-0000-0000-0000-000000000001');

select public.crear_estado_consulta('Descartada');
select is(
  (select clave = id::text from dominio.estados_consulta where nombre = 'Descartada' and organizacion_id = '11111111-1111-1111-1111-111111111111'),
  true, 'un estado creado por el Administrador usa su id como clave'
);
select throws_ok(
  $$update dominio.estados_consulta set clave = 'otra' where nombre = 'Descartada'$$,
  '23514', 'La clave de un estado no se puede cambiar', 'quien usa la app no cambia la clave de un estado'
);
select throws_ok(
  $$insert into dominio.estados_consulta (organizacion_id, nombre, clave) values ('11111111-1111-1111-1111-111111111111', 'Colado', 'nueva2')$$,
  '23514', 'La clave de un estado la asigna el sistema', 'quien usa la app no elige la clave de un estado nuevo'
);
select throws_ok(
  $$select public.cambiar_estado_estado_consulta((select id from dominio.estados_consulta where clave = 'resuelta'), false)$$,
  '23514', 'El estado «Resuelta» es de sistema: lo necesita el flujo de las consultas y no se puede desactivar',
  'los tres de base no se desactivan (resuelta)'
);
select throws_ok(
  $$select public.cambiar_estado_estado_consulta((select id from dominio.estados_consulta where clave = 'nueva'), false)$$,
  '23514', 'El estado «Nueva» es de sistema: lo necesita el flujo de las consultas y no se puede desactivar',
  'los tres de base no se desactivan (nueva)'
);
select throws_ok(
  $$select public.cambiar_estado_estado_consulta((select id from dominio.estados_consulta where clave = 'en_curso'), false)$$,
  '23514', 'El estado «En curso» es de sistema: lo necesita el flujo de las consultas y no se puede desactivar',
  'los tres de base no se desactivan (en_curso)'
);

-- ============================================================================
-- actualizar_consulta con estados configurados
-- ============================================================================
select is(
  public.actualizar_consulta('c5950000-0000-0000-0000-000000000001', 'en_curso', null, null,
    (select updated_at from dominio.consultas where id = 'c5950000-0000-0000-0000-000000000001')) is not null,
  true, 'un estado de base sigue funcionando'
);
select lives_ok(
  format($$select public.actualizar_consulta('c5950000-0000-0000-0000-000000000001', %L, null, null, %L)$$,
    (select clave from dominio.estados_consulta where nombre = 'Descartada'),
    (select updated_at from dominio.consultas where id = 'c5950000-0000-0000-0000-000000000001')),
  'una consulta pasa a un estado propio activo de la organización'
);
select is(
  (select estado from dominio.consultas where id = 'c5950000-0000-0000-0000-000000000001'),
  (select clave from dominio.estados_consulta where nombre = 'Descartada' and organizacion_id = '11111111-1111-1111-1111-111111111111'),
  'la consulta guarda la clave del estado propio'
);
select is(
  (select count(*)::int from public.registro_actividad
    where tipo = 'consulta.estado_cambiado' and detalle = 'Cambió el estado de una consulta de «Tienda Uno» a «Descartada»'),
  1,
  'la actividad nombra el estado propio con su nombre, no con la clave'
);
select is(
  (select estado from public.consultas_bandeja where id = 'c5950000-0000-0000-0000-000000000001'),
  (select clave from dominio.estados_consulta where nombre = 'Descartada' and organizacion_id = '11111111-1111-1111-1111-111111111111'),
  'la bandeja devuelve la clave: la pantalla la resuelve contra la lista'
);

select throws_ok(
  $$select public.actualizar_consulta('c5950000-0000-0000-0000-000000000001', 'no_existe', null, null, now())$$,
  'PT404', 'El estado elegido no existe', 'un estado que la organización no tiene: PT404'
);
select throws_ok(
  format($$select public.actualizar_consulta('c5950000-0000-0000-0000-000000000001', %L, null, null, now())$$,
    'dos-solo'),
  'PT404', 'El estado elegido no existe', 'la clave de un estado de OTRA organización no vale (aislamiento): PT404'
);
select throws_ok(
  $$select public.actualizar_consulta('c5950000-0000-0000-0000-000000000001', '', null, null, now())$$,
  '22023', 'Estado inválido', 'un estado vacío: 22023'
);

-- Desactivar el estado en el que ya está la consulta.
select public.cambiar_estado_estado_consulta((select id from dominio.estados_consulta where nombre = 'Descartada'), false);
select is(
  (select estado from public.consultas_bandeja where id = 'c5950000-0000-0000-0000-000000000001'),
  (select clave from dominio.estados_consulta where nombre = 'Descartada' and organizacion_id = '11111111-1111-1111-1111-111111111111'),
  'una consulta en un estado que se desactiva sigue mostrándose en él'
);
select lives_ok(
  format($$select public.actualizar_consulta('c5950000-0000-0000-0000-000000000001', %L, null, 'Nota nueva', %L)$$,
    (select clave from dominio.estados_consulta where nombre = 'Descartada'),
    (select updated_at from dominio.consultas where id = 'c5950000-0000-0000-0000-000000000001')),
  'y se puede guardar la nota sin cambiar el estado desactivado'
);
select throws_ok(
  format($$select public.actualizar_consulta('c5950000-0000-0000-0000-000000000002', %L, null, null, now())$$,
    (select clave from dominio.estados_consulta where nombre = 'Descartada')),
  '42501', 'No tenés permiso para editar consultas', 'una consulta de otra organización no se edita aunque exista el estado'
);
select pg_temp.como('f5950000-0000-0000-0000-000000000001');
select throws_ok(
  format($$select public.actualizar_consulta('c5950000-0000-0000-0000-000000000001', %L, null, null, now())$$,
    (select clave from dominio.estados_consulta where nombre = 'Descartada')),
  'PT412', 'La consulta fue modificada por otra persona', 'el mismo estado desactivado con un sello viejo sigue siendo conflicto de edición (PT412 sin detail)'
);

-- Elegir un estado desactivado desde otro estado: PT412 con detail estado.
select lives_ok(
  format($$select public.actualizar_consulta('c5950000-0000-0000-0000-000000000001', 'resuelta', null, null, %L)$$,
    (select updated_at from dominio.consultas where id = 'c5950000-0000-0000-0000-000000000001')),
  'la consulta sale del estado desactivado a uno de base'
);
select throws_ok(
  format($$select public.actualizar_consulta('c5950000-0000-0000-0000-000000000001', %L, null, null, %L)$$,
    (select clave from dominio.estados_consulta where nombre = 'Descartada'),
    (select updated_at from dominio.consultas where id = 'c5950000-0000-0000-0000-000000000001')),
  'PT412', 'El estado elegido está desactivado', 'volver a un estado desactivado no se puede: PT412'
);

select is(
  pg_temp.detalle_de($$select public.actualizar_consulta('c5950000-0000-0000-0000-000000000001', 'no_existe', null, null, now())$$),
  'estado', 'PT404 trae detail = estado'
);
select is(
  pg_temp.detalle_de(format($$select public.actualizar_consulta('c5950000-0000-0000-0000-000000000001', %L, null, null, %L)$$,
    (select clave from dominio.estados_consulta where nombre = 'Descartada' and organizacion_id = '11111111-1111-1111-1111-111111111111'),
    (select updated_at from dominio.consultas where id = 'c5950000-0000-0000-0000-000000000001'))),
  'estado', 'PT412 por estado desactivado trae detail = estado'
);
select is(
  pg_temp.detalle_de($$select public.actualizar_consulta('c5950000-0000-0000-0000-000000000001', 'resuelta', null, 'otra nota', '2000-01-01T00:00:00Z')$$),
  'sin detail', 'el PT412 del conflicto de edición NO trae detail (la web lo distingue por eso)'
);

select * from finish();
rollback;
