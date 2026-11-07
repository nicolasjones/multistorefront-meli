-- F-PRE-11 (MSF-439, épica MSF-363): precios promocionales por empresa.
-- Cubre FR-011…FR-018 / SC-004: tabla y RLS, aislamiento entre organizaciones y entre empresas, permisos por
-- rol, no solapamiento (contiguas sí, anuladas no bloquean), vencimiento en los bordes de desde/hasta,
-- anulación, bloqueo optimista, idempotencia, eventos de actividad, IVA con y sin interruptor, estado
-- derivado en la vista, `precio_anterior` en la tienda pública y `anon` sin ejecución ni escritura.
-- Las fechas son RELATIVAS a now() (no dependen del día en que corre). Las llamadas públicas se hacen como
-- `anon` y se guardan en una tabla temporal; las verificaciones corren como postgres.
begin;

select plan(90);

-- ============================================================================
-- Fixture (como postgres: RLS no aplica)
-- ============================================================================

insert into organizaciones (id, nombre) values
  ('11111111-1111-1111-1111-111111111111', 'Organización Uno'),
  ('22222222-2222-2222-2222-222222222222', 'Organización Dos');

insert into auth.users (id, email) values
  ('d1000000-0000-0000-0000-000000000001', 'admin-uno@example.com'),
  ('d1000000-0000-0000-0000-000000000002', 'consulta-uno@example.com'),
  ('d2000000-0000-0000-0000-000000000001', 'admin-dos@example.com');
insert into usuarios_organizacion (user_id, organizacion_id, rol_id, estado) values
  ('d1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'administrador', 'activo'),
  ('d1000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'consulta', 'activo'),
  ('d2000000-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', 'administrador', 'activo');

-- E1 «Tienda A» (+10 % y precios con IVA) · E2 «Tienda B» (sin regla, sin IVA) · E3 (org 2).
insert into dominio.empresas (id, organizacion_id, nombre, activa) values
  ('e1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'Tienda A', true),
  ('e1000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'Tienda B', true),
  ('e2000000-0000-0000-0000-000000000003', '22222222-2222-2222-2222-222222222222', 'Tienda Dos', true);
insert into dominio.tiendas (organizacion_id, empresa_id, dominio) values
  ('11111111-1111-1111-1111-111111111111', 'e1000000-0000-0000-0000-000000000001', 'promo-a.ejemplo.com'),
  ('11111111-1111-1111-1111-111111111111', 'e1000000-0000-0000-0000-000000000002', 'promo-b.ejemplo.com'),
  ('22222222-2222-2222-2222-222222222222', 'e2000000-0000-0000-0000-000000000003', 'promo-dos.ejemplo.com');
insert into dominio.precios_empresa (empresa_id, organizacion_id, base, ajuste_pct, mostrar_con_iva) values
  ('e1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'central_ajuste', 10, true),
  ('e1000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'central', 0, false);

-- Alfa ARS 1000 · Beta ARS 3000 (org 1) · Ajeno ARS 700 (org 2). IVA 21 % por defecto.
insert into dominio.productos (id, organizacion_id, nombre, sku, precio_lista, moneda, activo) values
  ('a1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'Alfa', 'PR-1', 1000, 'ARS', true),
  ('a1000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'Beta', 'PR-2', 3000, 'ARS', true),
  ('b2000000-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', 'Ajeno', 'PD-1', 700, 'ARS', true);
-- Con IVA visible el precio necesita alícuota: se asigna la de 21 % a los productos de la organización 1.
update dominio.productos set alicuota_iva_id = (select id from dominio.alicuotas_iva
  where organizacion_id = '11111111-1111-1111-1111-111111111111' and nombre = '21 %')
 where organizacion_id = '11111111-1111-1111-1111-111111111111';
insert into dominio.producto_empresa (producto_id, empresa_id, organizacion_id)
select p.id, e.id, '11111111-1111-1111-1111-111111111111'
  from dominio.productos p
  cross join (values ('e1000000-0000-0000-0000-000000000001'::uuid), ('e1000000-0000-0000-0000-000000000002'::uuid)) e(id)
 where p.organizacion_id = '11111111-1111-1111-1111-111111111111';
insert into dominio.producto_empresa (producto_id, empresa_id, organizacion_id) values
  ('b2000000-0000-0000-0000-000000000001', 'e2000000-0000-0000-0000-000000000003', '22222222-2222-2222-2222-222222222222');

-- Promociones sembradas (UUID fijos):
--   pA  E1/Alfa 800  programada  [+1 d, +3 d)
--   pB  E2/Beta 2500 vigente     [-1 h, +1 d)
--   pC  E1/Alfa 900  vencida     [-2 d, -1 d)
--   pD  E1/Beta 1000 anulada     [-1 h, +1 d)
insert into dominio.promociones_precio (id, organizacion_id, empresa_id, producto_id, precio_promocional, desde, hasta, anulada_at) values
  ('c1000000-0000-0000-0000-00000000000a', '11111111-1111-1111-1111-111111111111', 'e1000000-0000-0000-0000-000000000001', 'a1000000-0000-0000-0000-000000000001', 800, now() + interval '1 day', now() + interval '3 days', null),
  ('c1000000-0000-0000-0000-00000000000b', '11111111-1111-1111-1111-111111111111', 'e1000000-0000-0000-0000-000000000002', 'a1000000-0000-0000-0000-000000000002', 2500, now() - interval '1 hour', now() + interval '1 day', null),
  ('c1000000-0000-0000-0000-00000000000c', '11111111-1111-1111-1111-111111111111', 'e1000000-0000-0000-0000-000000000001', 'a1000000-0000-0000-0000-000000000001', 900, now() - interval '2 days', now() - interval '1 day', null),
  ('c1000000-0000-0000-0000-00000000000d', '11111111-1111-1111-1111-111111111111', 'e1000000-0000-0000-0000-000000000001', 'a1000000-0000-0000-0000-000000000002', 1000, now() - interval '1 hour', now() + interval '1 day', now());

create function pg_temp.como(p_user uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
  set local role authenticated;
end $$;

create temp table guardadas (clave text primary key, id uuid, actualizado timestamptz);
grant all on guardadas to authenticated;

-- ============================================================================
-- FR-011 · estructura, esquema, RLS, privilegios (como postgres)
-- ============================================================================

select is(
  (select n.nspname::text from pg_class c join pg_namespace n on n.oid = c.relnamespace where c.oid = 'dominio.promociones_precio'::regclass),
  'dominio', 'promociones_precio vive en el esquema dominio'
);
select is((select relrowsecurity from pg_class where oid = 'dominio.promociones_precio'::regclass), true, 'promociones_precio tiene RLS');
select is(has_table_privilege('anon', 'dominio.promociones_precio', 'select'), false, 'anon no lee promociones_precio');
select is(has_table_privilege('anon', 'dominio.promociones_precio', 'insert'), false, 'anon no inserta en promociones_precio');
select is(has_table_privilege('authenticated', 'dominio.promociones_precio', 'select'), true, 'authenticated lee promociones_precio');
select is(has_table_privilege('authenticated', 'dominio.promociones_precio', 'insert'), false, 'authenticated no escribe directo: solo por RPC');
select is(has_table_privilege('authenticated', 'dominio.promociones_precio', 'delete'), false, 'sin delete para authenticated');
select is(
  (select count(*)::int from pg_policies where schemaname = 'dominio' and tablename = 'promociones_precio' and cmd in ('DELETE', 'ALL')),
  0, 'sin política DELETE'
);
select throws_ok(
  $$insert into dominio.promociones_precio (organizacion_id, empresa_id, producto_id, precio_promocional, desde, hasta)
    values ('11111111-1111-1111-1111-111111111111', 'e1000000-0000-0000-0000-000000000001', 'a1000000-0000-0000-0000-000000000001', 0, now(), now() + interval '1 day')$$,
  '23514', null, 'precio_promocional debe ser > 0'
);
select throws_ok(
  $$insert into dominio.promociones_precio (organizacion_id, empresa_id, producto_id, precio_promocional, desde, hasta)
    values ('11111111-1111-1111-1111-111111111111', 'e1000000-0000-0000-0000-000000000001', 'a1000000-0000-0000-0000-000000000001', 10, now() + interval '9 days', now() + interval '9 days')$$,
  '23514', null, 'hasta debe ser posterior a desde'
);
select throws_ok(
  $$insert into dominio.promociones_precio (organizacion_id, empresa_id, producto_id, precio_promocional, desde, hasta)
    values ('11111111-1111-1111-1111-111111111111', 'e2000000-0000-0000-0000-000000000003', 'a1000000-0000-0000-0000-000000000001', 10, now() + interval '9 days', now() + interval '10 days')$$,
  '23503', null, 'FK compuesta: una empresa de otra organización no entra'
);
select throws_ok(
  $$insert into dominio.promociones_precio (organizacion_id, empresa_id, producto_id, precio_promocional, desde, hasta)
    values ('11111111-1111-1111-1111-111111111111', 'e1000000-0000-0000-0000-000000000001', 'b2000000-0000-0000-0000-000000000001', 10, now() + interval '9 days', now() + interval '10 days')$$,
  '23503', null, 'FK compuesta: un producto de otra organización no entra'
);

-- FR-012 en la base (el disparador no depende de la pantalla ni de la RPC).
select throws_ok(
  $$insert into dominio.promociones_precio (organizacion_id, empresa_id, producto_id, precio_promocional, desde, hasta)
    values ('11111111-1111-1111-1111-111111111111', 'e1000000-0000-0000-0000-000000000001', 'a1000000-0000-0000-0000-000000000001', 10, now() + interval '2 days', now() + interval '4 days')$$,
  '23P01', null, 'solape con una promoción no anulada: 23P01'
);

-- ============================================================================
-- FR-014 · cálculo único, bordes de vigencia, IVA con y sin interruptor (como postgres)
-- ============================================================================

-- E1/Alfa: normal 1.000 +10 % = 1.100, con IVA 21 % = 1.331. Promoción pA 800 → 968.
select is(
  (select precio from private.precio_vigente_empresa('a1000000-0000-0000-0000-000000000001', 'e1000000-0000-0000-0000-000000000001', now())),
  1331::numeric, 'sin promoción vigente (pA programada): el precio normal con IVA'
);
select is(
  (select precio_anterior from private.precio_vigente_empresa('a1000000-0000-0000-0000-000000000001', 'e1000000-0000-0000-0000-000000000001', now())),
  null, 'sin promoción vigente: precio_anterior null'
);
select is(
  (select precio from private.precio_vigente_empresa('a1000000-0000-0000-0000-000000000001', 'e1000000-0000-0000-0000-000000000001', now() + interval '1 day' - interval '1 second')),
  1331::numeric, 'borde: un segundo antes de desde sigue el precio normal'
);
select is(
  (select precio from private.precio_vigente_empresa('a1000000-0000-0000-0000-000000000001', 'e1000000-0000-0000-0000-000000000001', now() + interval '1 day')),
  968::numeric, 'borde: en desde rige la promoción (800 con IVA 21 % = 968)'
);
select is(
  (select precio_anterior from private.precio_vigente_empresa('a1000000-0000-0000-0000-000000000001', 'e1000000-0000-0000-0000-000000000001', now() + interval '2 days')),
  1331::numeric, 'entre desde y hasta: precio_anterior es el normal'
);
select is(
  (select precio from private.precio_vigente_empresa('a1000000-0000-0000-0000-000000000001', 'e1000000-0000-0000-0000-000000000001', now() + interval '3 days' - interval '1 second')),
  968::numeric, 'borde: un segundo antes de hasta sigue la promoción'
);
select is(
  (select precio from private.precio_vigente_empresa('a1000000-0000-0000-0000-000000000001', 'e1000000-0000-0000-0000-000000000001', now() + interval '3 days')),
  1331::numeric, 'borde: en hasta (excluyente) vuelve el precio normal'
);
select is(
  (select precio from private.precio_vigente_empresa('a1000000-0000-0000-0000-000000000001', 'e1000000-0000-0000-0000-000000000001', now() + interval '10 days')),
  1331::numeric, 'después de hasta: el precio normal'
);
select is(
  (select precio from private.precio_vigente_empresa('a1000000-0000-0000-0000-000000000001', 'e1000000-0000-0000-0000-000000000001', now() - interval '36 hours')),
  1089::numeric, 'una promoción pasada rige dentro de su rango (pC: 900 con IVA 21 % = 1.089)'
);
select is(
  (select precio from private.precio_vigente_empresa('a1000000-0000-0000-0000-000000000001', 'e1000000-0000-0000-0000-000000000001', now() - interval '1 day')),
  1331::numeric, 'una promoción vencida (pC) ya no rige a partir de su hasta'
);
-- E2/Beta (sin IVA): normal 3.000, promoción pB 2.500 sin IVA.
select is(
  (select precio from private.precio_vigente_empresa('a1000000-0000-0000-0000-000000000002', 'e1000000-0000-0000-0000-000000000002', now())),
  2500::numeric, 'empresa sin IVA visible: el precio promocional tal cual'
);
select is(
  (select precio_anterior from private.precio_vigente_empresa('a1000000-0000-0000-0000-000000000002', 'e1000000-0000-0000-0000-000000000002', now())),
  3000::numeric, 'empresa sin IVA visible: precio_anterior = normal'
);
-- La promoción de E2 no la hereda E1 (E1/Beta tiene solo la anulada pD).
select is(
  (select precio from private.precio_vigente_empresa('a1000000-0000-0000-0000-000000000002', 'e1000000-0000-0000-0000-000000000001', now())),
  3993::numeric, 'la promoción de B no se ve en A, y la anulada (pD) no rige: 3.000 +10 % +IVA = 3.993'
);
select is(
  (select precio from private.precio_vigente_empresa('a1000000-0000-0000-0000-000000000001', 'e1000000-0000-0000-0000-000000000002', now() + interval '2 days')),
  1000::numeric, 'la promoción de A no se ve en B (Alfa en B: 1.000)'
);
-- Paridad: sin promoción ≡ precio_final_publico.
select is(
  (select precio from private.precio_vigente_empresa('a1000000-0000-0000-0000-000000000001', 'e1000000-0000-0000-0000-000000000002', now())),
  private.precio_final_publico('a1000000-0000-0000-0000-000000000001', 'e1000000-0000-0000-0000-000000000002'),
  'sin promoción el resultado es idéntico a private.precio_final_publico'
);
select is(
  (select precio from private.precio_vigente_empresa('b2000000-0000-0000-0000-000000000001', 'e1000000-0000-0000-0000-000000000001', now())),
  null, 'producto de otra organización: null (no inventa un precio)'
);

-- ============================================================================
-- Administrador (org 1): RPC
-- ============================================================================

select pg_temp.como('d1000000-0000-0000-0000-000000000001');

insert into guardadas
select 'nueva', (j ->> 'id')::uuid, (j ->> 'updated_at')::timestamptz
  from (select public.guardar_promocion_precio(
          null, 'e1000000-0000-0000-0000-000000000001', 'a1000000-0000-0000-0000-000000000002', 700,
          now() + interval '5 days', now() + interval '6 days', null) j) s;

select isnt((select id from guardadas where clave = 'nueva'), null, 'administrador: crea una promoción (guardar_promocion_precio)');
select is(
  (select estado from public.promociones_precio_estado where id = (select id from guardadas where clave = 'nueva')),
  'programada', 'la recién creada con desde futuro figura programada'
);

-- Idempotencia del alta: la misma promoción no se duplica.
select is(
  (public.guardar_promocion_precio(null, 'e1000000-0000-0000-0000-000000000001', 'a1000000-0000-0000-0000-000000000002', 700,
     now() + interval '5 days', now() + interval '6 days', null) ->> 'id')::uuid,
  (select id from guardadas where clave = 'nueva'), 'repetir el alta devuelve la misma promoción'
);
select is(
  (select count(*)::int from dominio.promociones_precio where empresa_id = 'e1000000-0000-0000-0000-000000000001' and producto_id = 'a1000000-0000-0000-0000-000000000002' and anulada_at is null),
  1, 'repetir el alta no duplica'
);

-- FR-012 por la RPC: solape rechazado con error legible; contiguas y anuladas no bloquean.
select throws_ok(
  $$select public.guardar_promocion_precio(null, 'e1000000-0000-0000-0000-000000000001', 'a1000000-0000-0000-0000-000000000001', 700, now() + interval '2 days', now() + interval '4 days', null)$$,
  '23P01', 'Ya hay otra promoción de este producto en esta empresa que se solapa con esas fechas', 'solape: 23P01 con mensaje legible'
);
select lives_ok(
  $$select public.guardar_promocion_precio(null, 'e1000000-0000-0000-0000-000000000001', 'a1000000-0000-0000-0000-000000000001', 700, now() + interval '3 days', now() + interval '4 days', null)$$,
  'contiguas (desde = hasta de la otra) se permiten'
);
select lives_ok(
  $$select public.guardar_promocion_precio(null, 'e1000000-0000-0000-0000-000000000001', 'a1000000-0000-0000-0000-000000000002', 650, now() - interval '30 minutes', now() + interval '2 days', null)$$,
  'una promoción anulada (pD) no bloquea el mismo rango'
);

-- Validaciones.
select throws_ok(
  $$select public.guardar_promocion_precio(null, 'e1000000-0000-0000-0000-000000000001', 'a1000000-0000-0000-0000-000000000001', 0, now() + interval '20 days', now() + interval '21 days', null)$$,
  '22023', null, 'precio 0: 22023'
);
select throws_ok(
  $$select public.guardar_promocion_precio(null, 'e1000000-0000-0000-0000-000000000001', 'a1000000-0000-0000-0000-000000000001', 10, now() + interval '21 days', now() + interval '20 days', null)$$,
  '22023', null, 'hasta antes de desde: 22023'
);
select throws_ok(
  $$select public.guardar_promocion_precio(null, 'e1000000-0000-0000-0000-000000000001', 'a1000000-0000-0000-0000-000000000001', 10, now() - interval '9 days', now() - interval '8 days', null)$$,
  '22023', null, 'una promoción que ya venció no se crea'
);
select throws_ok(
  $$select public.guardar_promocion_precio(null, 'e2000000-0000-0000-0000-000000000003', 'a1000000-0000-0000-0000-000000000001', 10, now() + interval '20 days', now() + interval '21 days', null)$$,
  'P0002', null, 'empresa de otra organización: P0002'
);
select throws_ok(
  $$select public.guardar_promocion_precio(null, 'e1000000-0000-0000-0000-000000000001', 'b2000000-0000-0000-0000-000000000001', 10, now() + interval '20 days', now() + interval '21 days', null)$$,
  'P0002', null, 'producto de otra organización: P0002'
);

-- Edición con bloqueo optimista.
insert into guardadas
select 'pA', id, updated_at from dominio.promociones_precio where id = 'c1000000-0000-0000-0000-00000000000a';

select lives_ok(
  $$select public.guardar_promocion_precio('c1000000-0000-0000-0000-00000000000a', 'e1000000-0000-0000-0000-000000000001', 'a1000000-0000-0000-0000-000000000001', 850,
      now() + interval '1 day', now() + interval '3 days', (select actualizado from guardadas where clave = 'pA'))$$,
  'editar con el updated_at leído'
);
select is(
  (select precio_promocional from dominio.promociones_precio where id = 'c1000000-0000-0000-0000-00000000000a'),
  850.00::numeric, 'la edición cambió el precio'
);
select throws_ok(
  $$select public.guardar_promocion_precio('c1000000-0000-0000-0000-00000000000a', 'e1000000-0000-0000-0000-000000000001', 'a1000000-0000-0000-0000-000000000001', 860,
      now() + interval '1 day', now() + interval '3 days', (select actualizado from guardadas where clave = 'pA'))$$,
  '40001', 'La promoción fue modificada por otra persona', 'editar con un updated_at viejo: 40001'
);
select throws_ok(
  $$select public.guardar_promocion_precio('c1000000-0000-0000-0000-00000000000c', 'e1000000-0000-0000-0000-000000000001', 'a1000000-0000-0000-0000-000000000001', 950,
      now() - interval '2 days', now() - interval '1 day', null)$$,
  '22023', 'La promoción ya venció y no se puede editar', 'una promoción vencida no se edita'
);
select throws_ok(
  $$select public.guardar_promocion_precio('c1000000-0000-0000-0000-00000000000a', 'e1000000-0000-0000-0000-000000000002', 'a1000000-0000-0000-0000-000000000001', 850,
      now() + interval '1 day', now() + interval '3 days', null)$$,
  '22023', null, 'no se cambia la empresa de una promoción existente'
);

-- Estado derivado (FR-015).
select is((select estado from public.promociones_precio_estado where id = 'c1000000-0000-0000-0000-00000000000a'), 'programada', 'estado derivado: programada');
select is((select estado from public.promociones_precio_estado where id = 'c1000000-0000-0000-0000-00000000000b'), 'vigente', 'estado derivado: vigente');
select is((select estado from public.promociones_precio_estado where id = 'c1000000-0000-0000-0000-00000000000c'), 'vencida', 'estado derivado: vencida');
select is((select estado from public.promociones_precio_estado where id = 'c1000000-0000-0000-0000-00000000000d'), 'anulada', 'estado derivado: anulada');
select is(
  (select precio_vigente from public.promociones_precio_estado where id = 'c1000000-0000-0000-0000-00000000000b'),
  2500::numeric, 'la vista da el precio vigente de la promoción vigente'
);
select is(
  (select precio_normal from public.promociones_precio_estado where id = 'c1000000-0000-0000-0000-00000000000b'),
  3000::numeric, 'la vista da el precio normal de la empresa'
);
select is(
  (select precio_vigente from public.promociones_precio_estado where id = 'c1000000-0000-0000-0000-00000000000a'),
  1331::numeric, 'una promoción programada no cambia el precio vigente (normal con IVA)'
);
select ok(
  (select reloptions @> array['security_invoker=true'] from pg_class where oid = 'public.promociones_precio_estado'::regclass),
  'promociones_precio_estado es security_invoker'
);

-- Anulación.
select lives_ok(
  $$select public.anular_promocion_precio('c1000000-0000-0000-0000-00000000000b', (select updated_at from dominio.promociones_precio where id = 'c1000000-0000-0000-0000-00000000000b'))$$,
  'administrador: anula una promoción vigente'
);
select is((select estado from public.promociones_precio_estado where id = 'c1000000-0000-0000-0000-00000000000b'), 'anulada', 'anulada figura anulada');
select lives_ok(
  $$select public.anular_promocion_precio('c1000000-0000-0000-0000-00000000000b', null)$$,
  'anular una ya anulada es idempotente'
);
select throws_ok(
  $$select public.anular_promocion_precio('c1000000-0000-0000-0000-00000000000a', now() - interval '1 year')$$,
  '40001', null, 'anular con un updated_at viejo: 40001'
);
select throws_ok(
  $$select public.anular_promocion_precio('c1000000-0000-0000-0000-00000000000c', null)$$,
  '22023', null, 'una promoción vencida no se anula'
);
select throws_ok(
  $$select public.anular_promocion_precio('c1000000-0000-0000-0000-0000000000ff', null)$$,
  'P0002', null, 'promoción inexistente: P0002'
);

-- Eventos de actividad (como postgres: la actividad se lee con otra sección).
reset role;
select is(
  (select count(*)::int from public.registro_actividad where organizacion_id = '11111111-1111-1111-1111-111111111111' and tipo = 'promocion_precio.programada'),
  3, 'eventos promocion_precio.programada: uno por alta real (el reintento idempotente no suma)'
);
select is(
  (select count(*)::int from public.registro_actividad where organizacion_id = '11111111-1111-1111-1111-111111111111' and tipo = 'promocion_precio.actualizada'),
  1, 'evento promocion_precio.actualizada'
);
select is(
  (select count(*)::int from public.registro_actividad where organizacion_id = '11111111-1111-1111-1111-111111111111' and tipo = 'promocion_precio.anulada'),
  1, 'evento promocion_precio.anulada (una sola: la repetición no suma)'
);

-- ============================================================================
-- Consulta (lectura): ve, no escribe
-- ============================================================================

select pg_temp.como('d1000000-0000-0000-0000-000000000002');

select ok((select count(*) from public.promociones_precio_estado) >= 4, 'consulta (productos=lectura) ve las promociones');
select throws_ok(
  $$select public.guardar_promocion_precio(null, 'e1000000-0000-0000-0000-000000000001', 'a1000000-0000-0000-0000-000000000001', 10, now() + interval '30 days', now() + interval '31 days', null)$$,
  '42501', null, 'consulta no crea promociones'
);
select throws_ok(
  $$select public.anular_promocion_precio('c1000000-0000-0000-0000-00000000000a', null)$$,
  '42501', null, 'consulta no anula promociones'
);
select throws_ok(
  $$update dominio.promociones_precio set precio_promocional = 1$$,
  '42501', null, 'consulta no actualiza la tabla directo'
);

-- ============================================================================
-- Otra organización: aislamiento
-- ============================================================================

select pg_temp.como('d2000000-0000-0000-0000-000000000001');

select is((select count(*)::int from public.promociones_precio_estado), 0, 'la otra organización no ve ninguna promoción de la org 1');
select is((select count(*)::int from dominio.promociones_precio), 0, 'ni en la tabla (RLS)');
select throws_ok(
  $$select public.anular_promocion_precio('c1000000-0000-0000-0000-00000000000a', null)$$,
  'P0002', null, 'no puede anular una promoción ajena'
);
select throws_ok(
  $$select public.guardar_promocion_precio('c1000000-0000-0000-0000-00000000000a', 'e2000000-0000-0000-0000-000000000003', 'b2000000-0000-0000-0000-000000000001', 1,
      now() + interval '1 day', now() + interval '3 days', null)$$,
  'P0002', null, 'no puede editar una promoción ajena'
);
select is(
  (select count(*)::int from private.precios_promocion_sesion('a1000000-0000-0000-0000-000000000001', 'e1000000-0000-0000-0000-000000000001', 100)),
  0, 'la variante de sesión no responde por productos de otra organización'
);
reset role;

-- ============================================================================
-- FR-017 · tienda pública (como anon): precio vigente y precio_anterior
-- ============================================================================

create temp table res (clave text primary key, j jsonb);
grant all on res to anon;

-- pB se anuló arriba: se programa una vigente nueva para B/Beta como postgres, sin pasar por la RPC.
update dominio.promociones_precio set anulada_at = null where id = 'c1000000-0000-0000-0000-00000000000b';

-- Beta destacada en B: la home debe mostrar el mismo precio vigente que catálogo y ficha.
insert into dominio.productos_tienda (empresa_id, producto_id, organizacion_id, visible, destacado) values
  ('e1000000-0000-0000-0000-000000000002', 'a1000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', true, true);

select set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);
set local role anon;

insert into res values
  ('dest_b', publico.destacados_por_dominio('promo-b.ejemplo.com')),
  ('bus_b', publico.busqueda_pagina_por_dominio('promo-b.ejemplo.com', 'beta')),
  ('sug_b', publico.sugerencias_busqueda_por_dominio('promo-b.ejemplo.com', 'beta')),
  ('cat_b', publico.catalogo_pagina_por_dominio('promo-b.ejemplo.com')),
  ('cat_b_asc', publico.catalogo_pagina_por_dominio('promo-b.ejemplo.com', null, false, null, 'precio_asc', 1)),
  ('cat_b_max', publico.catalogo_pagina_por_dominio('promo-b.ejemplo.com', null, false, 2000, 'relevancia', 1)),
  ('cat_a', publico.catalogo_pagina_por_dominio('promo-a.ejemplo.com')),
  ('beta_b', publico.producto_por_dominio('promo-b.ejemplo.com', 'a1000000-0000-0000-0000-000000000002')),
  ('alfa_b', publico.producto_por_dominio('promo-b.ejemplo.com', 'a1000000-0000-0000-0000-000000000001')),
  ('beta_a', publico.producto_por_dominio('promo-a.ejemplo.com', 'a1000000-0000-0000-0000-000000000002')),
  ('alfa_a', publico.producto_por_dominio('promo-a.ejemplo.com', 'a1000000-0000-0000-0000-000000000001'));

reset role;

select is(
  (select (p ->> 'precio_anterior')::numeric from res, jsonb_array_elements(j -> 'productos') p where clave = 'cat_b' and p ->> 'nombre' = 'Beta'),
  3000::numeric, 'catálogo de B: precio_anterior de Beta'
);
select is(
  (select (p ->> 'precio')::numeric from res, jsonb_array_elements(j -> 'productos') p where clave = 'cat_b' and p ->> 'nombre' = 'Beta'),
  2500::numeric, 'catálogo de B: precio de Beta con promoción'
);
select is(
  (select p -> 'precio_anterior' from res, jsonb_array_elements(j -> 'productos') p where clave = 'cat_b' and p ->> 'nombre' = 'Alfa'),
  'null'::jsonb, 'catálogo de B: Alfa sin promoción, precio_anterior null'
);
select is(
  (select jsonb_build_array((p ->> 'precio')::numeric, (p ->> 'precio_anterior')::numeric) from res, jsonb_array_elements(j -> 'productos') p where clave = 'dest_b' and p ->> 'nombre' = 'Beta'),
  '[2500, 3000]'::jsonb, 'destacados de B: Beta con el precio vigente y el anterior'
);
select is(
  (select jsonb_build_array((p ->> 'precio')::numeric, (p ->> 'precio_anterior')::numeric) from res, jsonb_array_elements(j -> 'productos') p where clave = 'bus_b' and p ->> 'nombre' = 'Beta'),
  '[2500, 3000]'::jsonb, 'resultados de búsqueda de B: Beta con el precio vigente y el anterior'
);
select is(
  (select jsonb_build_array((p ->> 'precio')::numeric, (p ->> 'precio_anterior')::numeric) from res, jsonb_array_elements(j -> 'productos') p where clave = 'sug_b' and p ->> 'nombre' = 'Beta'),
  '[2500, 3000]'::jsonb, 'sugerencias de B: Beta con el precio vigente y el anterior'
);
select is(
  (select jsonb_agg(k order by k) from (select distinct jsonb_object_keys(p) k from res, jsonb_array_elements(j -> 'productos') p where clave = 'dest_b') s),
  '["categoria_id", "disponible", "id", "imagen", "nombre", "precio", "precio_anterior"]'::jsonb,
  'lista blanca de destacados: solo suma precio_anterior'
);
select is(
  (select jsonb_agg(p ->> 'nombre' order by ord) from res, jsonb_array_elements(j -> 'productos') with ordinality t(p, ord) where clave = 'cat_b_asc'),
  '["Alfa", "Beta"]'::jsonb, 'el orden por precio usa el precio vigente (1.000 < 2.500)'
);
select is(
  (select jsonb_agg(p ->> 'nombre') from res, jsonb_array_elements(j -> 'productos') p where clave = 'cat_b_max'),
  '["Alfa"]'::jsonb, 'el precio máximo filtra por el precio vigente (2.500 > 2.000)'
);
select is(
  (select jsonb_agg(k order by k) from (select distinct jsonb_object_keys(p) k from res, jsonb_array_elements(j -> 'productos') p where clave = 'cat_b') s),
  '["categoria_id", "destacado", "disponible", "id", "imagen", "nombre", "precio", "precio_anterior"]'::jsonb,
  'lista blanca del catálogo: solo suma precio_anterior'
);
select is(
  (select jsonb_agg(k order by k) from (select jsonb_object_keys(j) k from res where clave = 'beta_b') s),
  '["categoria", "compatibilidad", "descripcion", "disponible", "id", "imagenes", "nombre", "precio", "precio_anterior", "sku"]'::jsonb,
  'lista blanca de la ficha: solo suma precio_anterior'
);
select is(
  (select p -> 'precio_anterior' from res, jsonb_array_elements(j -> 'productos') p where clave = 'cat_a' and p ->> 'nombre' = 'Beta'),
  'null'::jsonb, 'catálogo de A: la promoción de B no se filtra'
);

-- ============================================================================
-- anon: sin ejecución ni escritura
-- ============================================================================

select is(has_function_privilege('anon', 'public.guardar_promocion_precio(uuid, uuid, uuid, numeric, timestamptz, timestamptz, timestamptz)', 'execute'), false, 'anon no ejecuta guardar_promocion_precio');
select is(has_function_privilege('anon', 'public.anular_promocion_precio(uuid, timestamptz)', 'execute'), false, 'anon no ejecuta anular_promocion_precio');
select is(has_function_privilege('anon', 'private.precio_vigente_empresa(uuid, uuid, timestamptz)', 'execute'), false, 'anon no ejecuta private.precio_vigente_empresa');
select is(has_function_privilege('authenticated', 'private.precio_vigente_empresa(uuid, uuid, timestamptz)', 'execute'), false, 'authenticated tampoco ejecuta el cálculo sin guardia');
select is(has_table_privilege('anon', 'public.promociones_precio_estado', 'select'), false, 'anon no lee la vista de estado');
select is(has_function_privilege('anon', 'publico.catalogo_pagina_por_dominio(text, uuid, boolean, numeric, text, integer)', 'execute'), true, 'anon sigue ejecutando el catálogo público');

select * from finish();
rollback;
