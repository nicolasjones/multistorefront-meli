-- F-VTA-25 (épica MSF-145, spec 20261024-130000-ventas-motos, FR-020, FR-021, FR-022, FR-023, FR-024;
-- SC-005, SC-006 y SC-007): rendición de los envíos en moto y tarjeta «Motos sin rendir».
--
-- Cubre: `rendir_envios_moto` (por fila y en lote; solo enviados y no rendidos; todo o nada ante un id
-- inexistente, ajeno, no enviado o una mezcla de mensajeros; idempotencia con los ya rendidos ignorados
-- y sin contar para la regla de un solo mensajero; solo escribe `rendido` y `rendido_en`; totales: el
-- total a rendir es la suma del abono, el costo va aparte y el neto es informativo; permisos: solo el
-- Administrador, Operador/Consulta/anon rechazados con 42501; evento `envio_moto.rendido` único por
-- rendición efectiva) y `resumen_motos_sin_rendir` (suma, cantidad y filtro de tienda).
--
-- Los envíos se cargan desde el fixture (postgres, RLS no aplica); las verificaciones corren como
-- «authenticated» vía request.jwt.claims, igual que PostgREST. Prefijos hexadecimales: a empresas, b
-- formas de envío, c clientes, d usuarios, e envíos, f comprobantes.
begin;

select no_plan();

-- ============================================================================
-- Fixture
-- ============================================================================

insert into organizaciones (id, nombre) values
  ('11111111-1111-1111-1111-111111111111', 'Organización Uno'),
  ('22222222-2222-2222-2222-222222222222', 'Organización Dos');

insert into auth.users (id, email) values
  ('d1000000-0000-0000-0000-000000000001', 'admin-uno@example.com'),
  ('d1000000-0000-0000-0000-000000000005', 'consulta-uno@example.com'),
  ('d1000000-0000-0000-0000-000000000012', 'operador-a-uno@example.com'),
  ('d2000000-0000-0000-0000-000000000001', 'admin-dos@example.com');

insert into usuarios_organizacion (user_id, organizacion_id, rol_id, estado) values
  ('d1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'administrador', 'activo'),
  ('d1000000-0000-0000-0000-000000000005', '11111111-1111-1111-1111-111111111111', 'consulta', 'activo'),
  ('d1000000-0000-0000-0000-000000000012', '11111111-1111-1111-1111-111111111111', 'operador', 'activo'),
  ('d2000000-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', 'administrador', 'activo');

insert into dominio.empresas (id, organizacion_id, nombre) values
  ('a1000000-0000-0000-0000-00000000000a', '11111111-1111-1111-1111-111111111111', 'San Javucho'),
  ('a1000000-0000-0000-0000-00000000000b', '11111111-1111-1111-1111-111111111111', 'Mundo JC'),
  ('a2000000-0000-0000-0000-00000000000c', '22222222-2222-2222-2222-222222222222', 'Empresa Dos');

-- Consulta y el Operador trabajan en San Javucho. El Administrador llega a todas por el rol.
insert into usuarios_empresas (user_id, empresa_id, organizacion_id, rol_id) values
  ('d1000000-0000-0000-0000-000000000005', 'a1000000-0000-0000-0000-00000000000a', '11111111-1111-1111-1111-111111111111', 'consulta'),
  ('d1000000-0000-0000-0000-000000000012', 'a1000000-0000-0000-0000-00000000000a', '11111111-1111-1111-1111-111111111111', 'operador');

insert into clientes (id, organizacion_id, numero, nombre, tipo) values
  ('c1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 10, 'Cliente Uno', 'minorista'),
  ('c2000000-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', 20, 'Cliente Dos', 'minorista');

insert into dominio.formas_envio (id, organizacion_id, empresa_id, nombre, tipo) values
  ('b1000000-0000-0000-0000-00000000000a', '11111111-1111-1111-1111-111111111111', 'a1000000-0000-0000-0000-00000000000a', 'Moto', 'moto'),
  ('b1000000-0000-0000-0000-00000000000c', '11111111-1111-1111-1111-111111111111', 'a1000000-0000-0000-0000-00000000000b', 'Moto', 'moto'),
  ('b2000000-0000-0000-0000-00000000000d', '22222222-2222-2222-2222-222222222222', 'a2000000-0000-0000-0000-00000000000c', 'Moto', 'moto');

-- Rendir registra el cobro en el libro (decisión del 2026-11-12): las facturas no traen forma de pago y el cobro usa la
-- forma «Contrarreembolso» de la tienda.
insert into dominio.formas_pago (id, organizacion_id, empresa_id, nombre, tipo, exige_cuenta_cobro, genera_deuda, activo) values
  ('9a000000-0000-0000-0000-00000000000a', '11111111-1111-1111-1111-111111111111', 'a1000000-0000-0000-0000-00000000000a', 'Contrarreembolso', 'contrarreembolso', false, false, true),
  ('9a000000-0000-0000-0000-00000000000b', '11111111-1111-1111-1111-111111111111', 'a1000000-0000-0000-0000-00000000000b', 'Contrarreembolso', 'contrarreembolso', false, false, true),
  ('9a000000-0000-0000-0000-00000000000c', '22222222-2222-2222-2222-222222222222', 'a2000000-0000-0000-0000-00000000000c', 'Contrarreembolso', 'contrarreembolso', false, false, true);

-- Ocho facturas con forma de envío moto: seis en San Javucho (F1…F6), una en Mundo JC (F7) y una de la
-- otra organización (F8).
insert into dominio.comprobantes_venta
  (id, organizacion_id, empresa_id, cliente_id, tipo, numero, fecha, estado, total_sin_iva, total_con_iva, confirmado_en, envio_id)
select ('f' || n.k || '000000-0000-0000-0000-00000000000' || n.i)::uuid,
       n.org, n.emp, n.cli, 'factura', '0001-0000000' || n.i, date '2027-02-01' + n.i, 'confirmada',
       100, 100, now(), n.forma
  from (values
    ('1', 1, '11111111-1111-1111-1111-111111111111'::uuid, 'a1000000-0000-0000-0000-00000000000a'::uuid, 'c1000000-0000-0000-0000-000000000001'::uuid, 'b1000000-0000-0000-0000-00000000000a'::uuid),
    ('1', 2, '11111111-1111-1111-1111-111111111111'::uuid, 'a1000000-0000-0000-0000-00000000000a'::uuid, 'c1000000-0000-0000-0000-000000000001'::uuid, 'b1000000-0000-0000-0000-00000000000a'::uuid),
    ('1', 3, '11111111-1111-1111-1111-111111111111'::uuid, 'a1000000-0000-0000-0000-00000000000a'::uuid, 'c1000000-0000-0000-0000-000000000001'::uuid, 'b1000000-0000-0000-0000-00000000000a'::uuid),
    ('1', 4, '11111111-1111-1111-1111-111111111111'::uuid, 'a1000000-0000-0000-0000-00000000000a'::uuid, 'c1000000-0000-0000-0000-000000000001'::uuid, 'b1000000-0000-0000-0000-00000000000a'::uuid),
    ('1', 5, '11111111-1111-1111-1111-111111111111'::uuid, 'a1000000-0000-0000-0000-00000000000a'::uuid, 'c1000000-0000-0000-0000-000000000001'::uuid, 'b1000000-0000-0000-0000-00000000000a'::uuid),
    ('1', 6, '11111111-1111-1111-1111-111111111111'::uuid, 'a1000000-0000-0000-0000-00000000000a'::uuid, 'c1000000-0000-0000-0000-000000000001'::uuid, 'b1000000-0000-0000-0000-00000000000a'::uuid),
    ('1', 7, '11111111-1111-1111-1111-111111111111'::uuid, 'a1000000-0000-0000-0000-00000000000b'::uuid, 'c1000000-0000-0000-0000-000000000001'::uuid, 'b1000000-0000-0000-0000-00000000000c'::uuid),
    ('2', 8, '22222222-2222-2222-2222-222222222222'::uuid, 'a2000000-0000-0000-0000-00000000000c'::uuid, 'c2000000-0000-0000-0000-000000000001'::uuid, 'b2000000-0000-0000-0000-00000000000d'::uuid)
  ) as n(k, i, org, emp, cli, forma);

-- Envíos (id e…0N = envío del comprobante f…0N):
--   E1 Juan,  enviado, abona 1000, costo 100        E5 Ana,   enviado, YA RENDIDO, abona 700, costo 70
--   E2 JUAN,  enviado, abona  500, costo  50        E6 Juan,  enviado, abona 0, costo 10
--   E3 Ana,   enviado, abona  300, costo  30        E7 Marta, enviado (Mundo JC), abona 400, costo 40
--   E4 Juan,  NO enviado, abona 200, costo 20       E8 Pedro, enviado (otra organización), abona 900, costo 90
insert into dominio.envios_moto
  (id, organizacion_id, comprobante_id, mensajero, costo_envio, abono, enviado, rendido, rendido_en)
values
  ('e1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'f1000000-0000-0000-0000-000000000001', 'Juan', 100, 1000, true, false, null),
  ('e1000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'f1000000-0000-0000-0000-000000000002', 'JUAN', 50, 500, true, false, null),
  ('e1000000-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111', 'f1000000-0000-0000-0000-000000000003', 'Ana', 30, 300, true, false, null),
  ('e1000000-0000-0000-0000-000000000004', '11111111-1111-1111-1111-111111111111', 'f1000000-0000-0000-0000-000000000004', 'Juan', 20, 200, false, false, null),
  ('e1000000-0000-0000-0000-000000000005', '11111111-1111-1111-1111-111111111111', 'f1000000-0000-0000-0000-000000000005', 'Ana', 70, 700, true, true, now() - interval '2 days'),
  ('e1000000-0000-0000-0000-000000000006', '11111111-1111-1111-1111-111111111111', 'f1000000-0000-0000-0000-000000000006', 'Juan', 10, 0, true, false, null),
  ('e1000000-0000-0000-0000-000000000007', '11111111-1111-1111-1111-111111111111', 'f1000000-0000-0000-0000-000000000007', 'Marta', 40, 400, true, false, null),
  ('e2000000-0000-0000-0000-000000000008', '22222222-2222-2222-2222-222222222222', 'f2000000-0000-0000-0000-000000000008', 'Pedro', 90, 900, true, false, null);

-- Foto de los envíos antes de rendir: la rendición solo puede cambiar `rendido` y `rendido_en`.
create temp table envios_antes as
  select id, comprobante_id, mensajero, guia, costo_envio, abono, enviado, created_at, updated_at
    from dominio.envios_moto;

-- Verifica como «authenticated» (RLS y permisos), igual que PostgREST.
create function pg_temp.como(p_user uuid) returns void language plpgsql as $$
begin
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
  set local role authenticated;
end $$;

-- ============================================================================
-- Privilegios y forma de las RPC
-- ============================================================================

select is(
  (select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname in ('rendir_envios_moto', 'resumen_motos_sin_rendir')
      and has_function_privilege('anon', p.oid, 'execute')),
  0, 'anon no ejecuta las RPC de rendición'
);
select is(
  (select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname in ('rendir_envios_moto', 'resumen_motos_sin_rendir')
      and has_function_privilege('authenticated', p.oid, 'execute')),
  2, 'authenticated ejecuta las RPC de rendición'
);
select is(
  (select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname in ('rendir_envios_moto', 'resumen_motos_sin_rendir')
      and p.prosecdef and coalesce(p.proconfig, array[]::text[]) @> array['search_path=""']),
  2, 'las RPC de rendición son security definer con search_path vacío'
);
select is(
  (select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname ilike '%revert%' and p.proname ilike '%moto%'),
  0, 'no existe una RPC de reversión de la rendición (fuera de alcance)'
);

-- ============================================================================
-- Tarjeta «Motos sin rendir» (FR-023)
-- ============================================================================

-- Suma el abono de lo no rendido con abono > 0: E1 1000 + E2 500 + E3 300 + E4 200 (aunque no esté
-- enviado) + E7 400 = 2400 en 5 entregas. E5 está rendido y E6 no abona nada.
select pg_temp.como('d1000000-0000-0000-0000-000000000001');
select is(
  (select monto from public.resumen_motos_sin_rendir()),
  2400.00::numeric, 'la tarjeta suma el abono de los envíos sin rendir con abono mayor a 0'
);
select is(
  (select entregas from public.resumen_motos_sin_rendir()),
  5, 'la tarjeta cuenta los envíos sin rendir con abono mayor a 0 (sin el rendido ni el de abono 0)'
);
select is(
  (select monto from public.resumen_motos_sin_rendir('a1000000-0000-0000-0000-00000000000a')),
  2000.00::numeric, 'el filtro de tienda acota el monto a San Javucho'
);
select is(
  (select entregas from public.resumen_motos_sin_rendir('a1000000-0000-0000-0000-00000000000b')),
  1, 'el filtro de tienda acota la cantidad a Mundo JC'
);
reset role;

select pg_temp.como('d1000000-0000-0000-0000-000000000012');
select is(
  (select monto from public.resumen_motos_sin_rendir()),
  2000.00::numeric, 'el Operador de San Javucho solo suma su tienda'
);
reset role;

select pg_temp.como('d1000000-0000-0000-0000-000000000005');
select is(
  (select entregas from public.resumen_motos_sin_rendir()),
  4, 'Consulta (solo lectura) ve la tarjeta de su tienda'
);
reset role;

select pg_temp.como('d2000000-0000-0000-0000-000000000001');
select is(
  (select monto from public.resumen_motos_sin_rendir()),
  900.00::numeric, 'otra organización solo suma lo suyo'
);
reset role;

select set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);
set local role anon;
select throws_ok(
  $$select * from public.resumen_motos_sin_rendir()$$,
  '42501', null, 'anon no ve la tarjeta'
);
reset role;

-- ============================================================================
-- Permisos de la rendición (FR-020): solo el Administrador
-- ============================================================================

select pg_temp.como('d1000000-0000-0000-0000-000000000012');
select throws_ok(
  $$select public.rendir_envios_moto(array['e1000000-0000-0000-0000-000000000001']::uuid[])$$,
  '42501', null, 'el Operador no rinde'
);
reset role;
select pg_temp.como('d1000000-0000-0000-0000-000000000005');
select throws_ok(
  $$select public.rendir_envios_moto(array['e1000000-0000-0000-0000-000000000001']::uuid[])$$,
  '42501', null, 'Consulta no rinde'
);
reset role;
select set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);
set local role anon;
select throws_ok(
  $$select public.rendir_envios_moto(array['e1000000-0000-0000-0000-000000000001']::uuid[])$$,
  '42501', null, 'anon no rinde'
);
reset role;
select pg_temp.como('d2000000-0000-0000-0000-000000000001');
select throws_ok(
  $$select public.rendir_envios_moto(array['e1000000-0000-0000-0000-000000000001']::uuid[])$$,
  '42501', null, 'el Administrador de otra organización no rinde envíos ajenos (mismo 42501 que si no existieran)'
);
reset role;

-- ============================================================================
-- Todo o nada (FR-021)
-- ============================================================================

select pg_temp.como('d1000000-0000-0000-0000-000000000001');
select throws_ok($$select public.rendir_envios_moto(null)$$, '22023', null, 'una lista nula se rechaza');
select throws_ok($$select public.rendir_envios_moto(array[]::uuid[])$$, '22023', null, 'una lista vacía se rechaza');
select throws_ok(
  $$select public.rendir_envios_moto(array['e1000000-0000-0000-0000-000000000001', null]::uuid[])$$,
  '22023', null, 'una lista con un id nulo se rechaza'
);
select throws_ok(
  $$select public.rendir_envios_moto(array['e1000000-0000-0000-0000-000000000099']::uuid[])$$,
  '42501', null, 'un id inexistente se rechaza'
);
select throws_ok(
  $$select public.rendir_envios_moto(array['e1000000-0000-0000-0000-000000000001', 'e1000000-0000-0000-0000-000000000099']::uuid[])$$,
  '42501', null, 'un id inexistente junto a uno válido aborta todo'
);
select throws_ok(
  $$select public.rendir_envios_moto(array['e1000000-0000-0000-0000-000000000001', 'e2000000-0000-0000-0000-000000000008']::uuid[])$$,
  '42501', null, 'un id de otra organización junto a uno válido aborta todo'
);
select throws_ok(
  $$select public.rendir_envios_moto(array['e1000000-0000-0000-0000-000000000004']::uuid[])$$,
  '22023', null, 'un envío no enviado no se rinde'
);
select throws_ok(
  $$select public.rendir_envios_moto(array['e1000000-0000-0000-0000-000000000001', 'e1000000-0000-0000-0000-000000000004']::uuid[])$$,
  '22023', null, 'un envío no enviado junto a uno válido aborta todo'
);
select throws_ok(
  $$select public.rendir_envios_moto(array['e1000000-0000-0000-0000-000000000001', 'e1000000-0000-0000-0000-000000000003']::uuid[])$$,
  '22023', null, 'una mezcla de mensajeros (Juan y Ana) aborta todo'
);
select throws_ok(
  $$select public.rendir_envios_moto(array['e1000000-0000-0000-0000-000000000001', 'e1000000-0000-0000-0000-000000000007']::uuid[])$$,
  '22023', null, 'una mezcla de mensajeros de distintas tiendas aborta todo'
);
reset role;

select is(
  (select count(*)::int from dominio.envios_moto where rendido),
  1, 'los rechazos no rindieron nada: sigue rendido solo E5'
);
select is(
  (select count(*)::int from public.registro_actividad where tipo = 'envio_moto.rendido'),
  0, 'los rechazos no dejan eventos'
);

-- ============================================================================
-- Rendir en lote (FR-020, FR-021, FR-022, FR-024)
-- ============================================================================

-- Dos envíos del mismo mensajero escrito distinto (Juan / JUAN).
select pg_temp.como('d1000000-0000-0000-0000-000000000001');
select set_config('t.res',
  public.rendir_envios_moto(array['e1000000-0000-0000-0000-000000000001', 'e1000000-0000-0000-0000-000000000002']::uuid[])::text,
  true);
select is((current_setting('t.res')::jsonb ->> 'cantidad')::int, 2, 'el lote rinde los dos envíos');
select is(lower(current_setting('t.res')::jsonb ->> 'mensajero'), 'juan', 'devuelve el mensajero (sin distinguir mayúsculas)');
select is((current_setting('t.res')::jsonb ->> 'total_abono')::numeric, 1500::numeric, 'el total a rendir es la suma del abono');
select is((current_setting('t.res')::jsonb ->> 'total_costo')::numeric, 150::numeric, 'el costo se devuelve aparte');
select is((current_setting('t.res')::jsonb ->> 'neto')::numeric, 1350::numeric, 'el neto es abono menos costo (informativo)');
reset role;

select ok(
  (select bool_and(rendido and rendido_en is not null) from dominio.envios_moto
    where id in ('e1000000-0000-0000-0000-000000000001', 'e1000000-0000-0000-0000-000000000002')),
  'los envíos del lote quedan rendidos con su fecha'
);
select is(
  (select count(*)::int from dominio.envios_moto e join envios_antes a using (id)
    where e.id in ('e1000000-0000-0000-0000-000000000001', 'e1000000-0000-0000-0000-000000000002')
      and (e.comprobante_id, e.mensajero, e.guia, e.costo_envio, e.abono, e.enviado, e.created_at, e.updated_at)
          is distinct from (a.comprobante_id, a.mensajero, a.guia, a.costo_envio, a.abono, a.enviado, a.created_at, a.updated_at)),
  0, 'la rendición escribe solo rendido y rendido_en: ninguna otra columna cambia'
);
select is(
  (select count(*)::int from dominio.envios_moto where rendido),
  3, 'solo se rindieron los dos del lote (E5 ya lo estaba)'
);

-- Evento único (FR-024).
select is(
  (select count(*)::int from public.registro_actividad where tipo = 'envio_moto.rendido'),
  1, 'el lote deja un solo evento envio_moto.rendido'
);
select is(
  (select actor_id from public.registro_actividad where tipo = 'envio_moto.rendido'),
  'd1000000-0000-0000-0000-000000000001'::uuid, 'el evento guarda quién rindió'
);
select is(
  (select empresa_id from public.registro_actividad where tipo = 'envio_moto.rendido'),
  'a1000000-0000-0000-0000-00000000000a'::uuid, 'el evento guarda la tienda de los envíos'
);
select ok(
  (select detalle like '%0001-00000001%' and detalle like '%0001-00000002%'
      and detalle ilike '%juan%' and detalle like '%2 envío%' and detalle like '%1500%'
      and detalle like '%150%' and detalle like '%1350%'
     from public.registro_actividad where tipo = 'envio_moto.rendido'),
  'el evento nombra los comprobantes, el mensajero, la cantidad y los totales'
);

-- Idempotencia: repetir el mismo pedido no cambia nada, devuelve 0 y no duplica el evento.
select pg_temp.como('d1000000-0000-0000-0000-000000000001');
select set_config('t.res',
  public.rendir_envios_moto(array['e1000000-0000-0000-0000-000000000001', 'e1000000-0000-0000-0000-000000000002']::uuid[])::text,
  true);
select is((current_setting('t.res')::jsonb ->> 'cantidad')::int, 0, 'reintentar sobre lo ya rendido devuelve cantidad 0');
select is((current_setting('t.res')::jsonb ->> 'total_abono')::numeric, 0::numeric, 'y total 0');
select is((current_setting('t.res')::jsonb ->> 'neto')::numeric, 0::numeric, 'y neto 0');
select ok((current_setting('t.res')::jsonb -> 'mensajero') = 'null'::jsonb, 'y mensajero nulo');
select set_config('t.res',
  public.rendir_envios_moto(array['e1000000-0000-0000-0000-000000000005']::uuid[])::text, true);
select is((current_setting('t.res')::jsonb ->> 'cantidad')::int, 0, 'un envío ya rendido antes también devuelve 0');
reset role;

select is(
  (select count(*)::int from public.registro_actividad where tipo = 'envio_moto.rendido'),
  1, 'reintentar no duplica el evento'
);
select is(
  (select count(*)::int from dominio.envios_moto where rendido),
  3, 'reintentar no rinde nada más'
);

-- Los ya rendidos se ignoran y no cuentan para la regla de un solo mensajero: E1 (Juan, rendido) y E5
-- (Ana, rendido) no bloquean la rendición de E3 (Ana).
select pg_temp.como('d1000000-0000-0000-0000-000000000001');
select set_config('t.res',
  public.rendir_envios_moto(array['e1000000-0000-0000-0000-000000000001', 'e1000000-0000-0000-0000-000000000003',
                                  'e1000000-0000-0000-0000-000000000005']::uuid[])::text,
  true);
select is((current_setting('t.res')::jsonb ->> 'cantidad')::int, 1, 'solo cuenta el envío que pasa a rendido');
select is(current_setting('t.res')::jsonb ->> 'mensajero', 'Ana', 'el mensajero es el de lo que se rindió, no el de los ya rendidos');
select is((current_setting('t.res')::jsonb ->> 'total_abono')::numeric, 300::numeric, 'el total solo suma lo que se rindió ahora');
reset role;
select is(
  (select count(*)::int from public.registro_actividad where tipo = 'envio_moto.rendido'),
  2, 'esa rendición deja su propio evento'
);
select ok(
  (select detalle like '%0001-00000003%' and detalle not like '%0001-00000001%' and detalle not like '%0001-00000005%'
     from public.registro_actividad where tipo = 'envio_moto.rendido' and detalle like '%0001-00000003%'),
  'el evento no lista los comprobantes que ya estaban rendidos'
);

-- Por fila: un envío de otra tienda (Mundo JC) y uno con abono 0.
select pg_temp.como('d1000000-0000-0000-0000-000000000001');
select set_config('t.res',
  public.rendir_envios_moto(array['e1000000-0000-0000-0000-000000000007']::uuid[])::text, true);
select is((current_setting('t.res')::jsonb ->> 'total_abono')::numeric, 400::numeric, 'rendir por fila devuelve el abono del envío');
select set_config('t.res',
  public.rendir_envios_moto(array['e1000000-0000-0000-0000-000000000006']::uuid[])::text, true);
select is((current_setting('t.res')::jsonb ->> 'total_abono')::numeric, 0::numeric, 'un envío con abono 0 se rinde con total 0');
select is((current_setting('t.res')::jsonb ->> 'neto')::numeric, -10::numeric, 'y su neto informativo es menos el costo');
reset role;
select is(
  (select empresa_id from public.registro_actividad where tipo = 'envio_moto.rendido' and detalle like '%0001-00000007%'),
  'a1000000-0000-0000-0000-00000000000b'::uuid, 'el evento de un envío de Mundo JC guarda esa tienda'
);
select is(
  (select count(*)::int from public.registro_actividad where tipo = 'envio_moto.rendido'),
  4, 'hay un evento por cada rendición efectiva (4), ninguno por los reintentos'
);

-- ============================================================================
-- La tarjeta se recalcula al rendir (FR-023)
-- ============================================================================

-- Quedan sin rendir: E4 (200, no enviado). E8 es de otra organización.
select pg_temp.como('d1000000-0000-0000-0000-000000000001');
select is(
  (select monto from public.resumen_motos_sin_rendir()),
  200.00::numeric, 'tras rendir, la tarjeta suma solo lo pendiente (un envío sin marcar Enviado también suma)'
);
select is(
  (select entregas from public.resumen_motos_sin_rendir()),
  1, 'y cuenta solo lo pendiente'
);
select is(
  (select entregas from public.resumen_motos_sin_rendir('a1000000-0000-0000-0000-00000000000b')),
  0, 'Mundo JC quedó sin pendientes'
);
reset role;

-- El envío de otra organización no se tocó.
select ok(
  (select not rendido and rendido_en is null from dominio.envios_moto where id = 'e2000000-0000-0000-0000-000000000008'),
  'el envío de la otra organización quedó intacto'
);

select * from finish();

rollback;
