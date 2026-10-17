-- F-CLI-03 (MSF-301, épica MSF-180): tipo de cliente y Consumidor final.
-- Cubre SC-003 (FR-008, FR-009, FR-010, FR-013): un Consumidor final por
-- organización (existente o nueva), inmutable incluso para postgres, `tipo`
-- restringido a minorista/mayorista y `escala_de_cliente` con RLS y sin `anon`.
-- Corre como postgres para armar el fixture y como "authenticated"
-- (request.jwt.claims, igual que PostgREST) para verificar.
begin;

select plan(31);

insert into organizaciones (id, nombre) values
  ('11111111-1111-1111-1111-111111111111', 'Organización Uno'),
  ('22222222-2222-2222-2222-222222222222', 'Organización Dos');

insert into auth.users (id, email) values
  ('d1000000-0000-0000-0000-000000000001', 'admin-uno@example.com'),
  ('d2000000-0000-0000-0000-000000000001', 'admin-dos@example.com');

insert into usuarios_organizacion (user_id, organizacion_id, rol_id) values
  ('d1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'administrador'),
  ('d2000000-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', 'administrador');

create function pg_temp.como(p_user uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
  set local role authenticated;
end $$;

-- ============================================================================
-- Un Consumidor final por organización (FR-009)
-- ============================================================================

select is(
  (select count(*)::int from clientes where organizacion_id = '11111111-1111-1111-1111-111111111111' and es_consumidor_final),
  1, 'la organización Uno tiene exactamente un Consumidor final'
);
select is(
  (select count(*)::int from clientes where es_consumidor_final
     and organizacion_id in ('11111111-1111-1111-1111-111111111111', '22222222-2222-2222-2222-222222222222')),
  2, 'cada organización creada tiene el suyo (disparador en organizaciones)'
);
select results_eq(
  $$select nombre, tipo, archivado_en is null, numero from clientes
     where organizacion_id = '11111111-1111-1111-1111-111111111111' and es_consumidor_final$$,
  $$values ('Consumidor final'::text, 'minorista'::text, true, 1)$$,
  'el Consumidor final es minorista, está activo y recibe el número 1'
);
select is(
  (select count(*)::int from organizaciones o
    where not exists (select 1 from clientes c where c.organizacion_id = o.id and c.es_consumidor_final)),
  0, 'ninguna organización existente queda sin Consumidor final (backfill + disparador)'
);
select throws_ok(
  $$insert into clientes (organizacion_id, nombre, tipo, es_consumidor_final)
    values ('11111111-1111-1111-1111-111111111111', 'Otro mostrador', 'minorista', true)$$,
  '23505', null, 'no puede haber un segundo Consumidor final en la organización'
);
select throws_ok(
  $$insert into clientes (organizacion_id, nombre, tipo, es_consumidor_final)
    values ('22222222-2222-2222-2222-222222222222', 'Mostrador mayorista', 'mayorista', true)$$,
  '23514', null, 'un Consumidor final no puede ser mayorista (restricción en base)'
);

-- ============================================================================
-- Inmutabilidad: ni siquiera postgres lo toca (FR-009)
-- ============================================================================

select throws_ok(
  $$update clientes set nombre = 'Renombrado' where organizacion_id = '11111111-1111-1111-1111-111111111111' and es_consumidor_final$$,
  '42501', null, 'el Consumidor final no se edita (ni como postgres)'
);
select throws_ok(
  $$update clientes set archivado_en = now() where organizacion_id = '11111111-1111-1111-1111-111111111111' and es_consumidor_final$$,
  '42501', null, 'el Consumidor final no se archiva'
);
select throws_ok(
  $$update clientes set tipo = 'mayorista' where organizacion_id = '11111111-1111-1111-1111-111111111111' and es_consumidor_final$$,
  '42501', null, 'el Consumidor final no cambia de tipo'
);
select throws_ok(
  $$delete from clientes where organizacion_id = '11111111-1111-1111-1111-111111111111' and es_consumidor_final$$,
  '42501', null, 'el Consumidor final no se borra'
);

insert into clientes (id, organizacion_id, nombre, tipo) values
  ('c3000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'Cliente minorista', 'minorista'),
  ('c3000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'Cliente mayorista', 'mayorista'),
  ('c3000000-0000-0000-0000-000000000003', '22222222-2222-2222-2222-222222222222', 'Cliente de la Dos', 'minorista');

select throws_ok(
  $$update clientes set es_consumidor_final = true where id = 'c3000000-0000-0000-0000-000000000001'$$,
  '42501', null, 'un cliente común no se convierte en Consumidor final'
);

-- ============================================================================
-- Desde la aplicación (rol authenticated, administrador de la Uno)
-- ============================================================================

select pg_temp.como('d1000000-0000-0000-0000-000000000001');
select is(
  (select count(*)::int from clientes where es_consumidor_final), 1,
  'el administrador ve el Consumidor final de su organización en el listado'
);
select throws_ok(
  $$update clientes set nombre = 'Renombrado' where es_consumidor_final$$,
  '42501', null, 'el administrador no edita el Consumidor final'
);
select throws_ok(
  $$update clientes set archivado_en = now() where es_consumidor_final$$,
  '42501', null, 'el administrador no archiva el Consumidor final'
);
select throws_ok(
  $$delete from clientes where es_consumidor_final$$,
  '42501', null, 'el administrador no borra el Consumidor final'
);
select throws_ok(
  $$insert into clientes (organizacion_id, nombre, es_consumidor_final) values ('11111111-1111-1111-1111-111111111111', 'Falso mostrador', true)$$,
  '42501', null, 'el llamador no puede fijar `es_consumidor_final` al insertar'
);
select throws_ok(
  $$update clientes set es_consumidor_final = true where id = 'c3000000-0000-0000-0000-000000000001'$$,
  '42501', null, 'el llamador no puede cambiar `es_consumidor_final`'
);

-- Tipo (FR-008)
select lives_ok(
  $$insert into clientes (id, organizacion_id, nombre) values ('c3000000-0000-0000-0000-000000000004', '11111111-1111-1111-1111-111111111111', 'Sin tipo explícito')$$,
  'alta sin tipo: se acepta'
);
select is(
  (select tipo from clientes where id = 'c3000000-0000-0000-0000-000000000004'),
  'minorista', 'el tipo por defecto es minorista'
);
select throws_ok(
  $$insert into clientes (organizacion_id, nombre, tipo) values ('11111111-1111-1111-1111-111111111111', 'Tipo raro', 'distribuidor')$$,
  '23514', null, 'un tipo fuera de minorista/mayorista se rechaza'
);
select throws_ok(
  $$update clientes set tipo = null where id = 'c3000000-0000-0000-0000-000000000001'$$,
  '23502', null, 'el tipo no puede quedar vacío'
);
select lives_ok(
  $$update clientes set tipo = 'mayorista' where id = 'c3000000-0000-0000-0000-000000000001'$$,
  'el administrador cambia el tipo de un cliente común'
);
reset role;

-- ============================================================================
-- escala_de_cliente (FR-010, FR-013)
-- ============================================================================

select pg_temp.como('d1000000-0000-0000-0000-000000000001');
select is(
  escala_de_cliente('c3000000-0000-0000-0000-000000000004'), 'x1', 'minorista → x1'
);
select is(
  escala_de_cliente('c3000000-0000-0000-0000-000000000002'), 'por_cantidad', 'mayorista → por_cantidad'
);
select is(
  escala_de_cliente((select id from clientes where es_consumidor_final)), 'x1', 'Consumidor final → x1'
);
select is(
  escala_de_cliente('c3000000-0000-0000-0000-000000000003'), null, 'cliente de otra organización → nulo (RLS)'
);
select is(
  escala_de_cliente('c3000000-0000-0000-0000-0000000000ff'), null, 'cliente inexistente → nulo'
);
reset role;

select ok(not has_function_privilege('anon', 'public.escala_de_cliente(uuid)', 'execute'), 'anon no ejecuta escala_de_cliente');
select ok(has_function_privilege('authenticated', 'public.escala_de_cliente(uuid)', 'execute'), 'authenticated ejecuta escala_de_cliente');

-- ============================================================================
-- Organización nueva y cascada
-- ============================================================================

insert into organizaciones (id, nombre) values ('33333333-3333-3333-3333-333333333333', 'Organización Tres');
select is(
  (select count(*)::int from clientes where organizacion_id = '33333333-3333-3333-3333-333333333333' and es_consumidor_final),
  1, 'una organización nueva recibe su Consumidor final automáticamente'
);
select lives_ok(
  $$delete from organizaciones where id = '33333333-3333-3333-3333-333333333333'$$,
  'borrar la organización arrastra su Consumidor final (cascada permitida)'
);

select * from finish();
rollback;
