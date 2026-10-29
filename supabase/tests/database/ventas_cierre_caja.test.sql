-- F-VTA-33 (MSF-349, épica MSF-193, spec 20261027-100000-ventas-mejoras, FR-020…FR-026, SC-003):
-- cierre de caja diario.
--
-- Cubre: tablas en `dominio` con RLS y sin escritura directa; el resumen por forma de pago y cuenta;
-- el cierre idempotente; el cobro de una fecha cerrada rechazado (inserción directa, modificación y
-- `registrar_cobro` de MSF-195); reabrir habilita y volver a cerrar rehace el resumen; solo el
-- Administrador cierra y reabre; eventos de actividad; aislamiento por organización y empresa;
-- `anon` sin acceso.
--
-- El fixture corre como postgres (RLS no aplica) y las verificaciones como «authenticated» vía
-- request.jwt.claims, igual que PostgREST.
begin;

select no_plan();

insert into organizaciones (id, nombre) values
  ('11111111-1111-1111-1111-111111111111', 'Organización Uno'),
  ('22222222-2222-2222-2222-222222222222', 'Organización Dos');

insert into auth.users (id, email) values
  ('d1000000-0000-0000-0000-000000000001', 'admin-uno@example.com'),
  ('d1000000-0000-0000-0000-000000000002', 'mostrador-uno@example.com'),
  ('d2000000-0000-0000-0000-000000000001', 'admin-dos@example.com');

insert into usuarios_organizacion (user_id, organizacion_id, rol_id, estado) values
  ('d1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'administrador', 'activo'),
  ('d1000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'mostrador', 'activo'),
  ('d2000000-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', 'administrador', 'activo');

insert into dominio.empresas (id, organizacion_id, nombre) values
  ('a1000000-0000-0000-0000-00000000000a', '11111111-1111-1111-1111-111111111111', 'San Javucho'),
  ('a1000000-0000-0000-0000-00000000000b', '11111111-1111-1111-1111-111111111111', 'Mundo JC'),
  ('a2000000-0000-0000-0000-00000000000c', '22222222-2222-2222-2222-222222222222', 'Empresa Dos');

-- El mostrador trabaja solo en San Javucho.
insert into usuarios_empresas (user_id, empresa_id, organizacion_id, rol_id) values
  ('d1000000-0000-0000-0000-000000000002', 'a1000000-0000-0000-0000-00000000000a', '11111111-1111-1111-1111-111111111111', 'mostrador');

insert into clientes (id, organizacion_id, numero, nombre, tipo) values
  ('c1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 10, 'Cliente Uno', 'minorista');

insert into dominio.formas_pago (id, organizacion_id, empresa_id, nombre, tipo, exige_cuenta_cobro, genera_deuda, activo) values
  ('b1000000-0000-0000-0000-00000000000a', '11111111-1111-1111-1111-111111111111', 'a1000000-0000-0000-0000-00000000000a', 'Efectivo', 'efectivo', false, false, true),
  ('b1000000-0000-0000-0000-00000000000b', '11111111-1111-1111-1111-111111111111', 'a1000000-0000-0000-0000-00000000000a', 'Transferencia', 'transferencia', true, false, true),
  ('b1000000-0000-0000-0000-00000000000d', '11111111-1111-1111-1111-111111111111', 'a1000000-0000-0000-0000-00000000000b', 'Efectivo', 'efectivo', false, false, true);

insert into dominio.cuentas_cobro (id, organizacion_id, nombre, titular, banco, activa) values
  ('e1000000-0000-0000-0000-00000000000a', '11111111-1111-1111-1111-111111111111', 'Banco Uno', 'Titular Uno', 'Galicia', true);
insert into dominio.cuentas_cobro_empresas (cuenta_id, empresa_id, organizacion_id) values
  ('e1000000-0000-0000-0000-00000000000a', 'a1000000-0000-0000-0000-00000000000a', '11111111-1111-1111-1111-111111111111');

insert into dominio.comprobantes_venta
  (id, organizacion_id, empresa_id, cliente_id, tipo, numero, fecha, estado, total_sin_iva, total_con_iva, confirmado_en) values
  ('f1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'a1000000-0000-0000-0000-00000000000a', 'c1000000-0000-0000-0000-000000000001', 'factura', '0001-00000001', (current_date - 3), 'confirmada', 5000, 5000, now()),
  ('f1000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'a1000000-0000-0000-0000-00000000000b', 'c1000000-0000-0000-0000-000000000001', 'factura', '0001-00000002', (current_date - 3), 'confirmada', 5000, 5000, now());

-- Cobros de hoy-3 (fechas relativas al reloj de la base) en San Javucho: efectivo 100 + 200 y transferencia 500 a Banco Uno; y uno
-- de Mundo JC (otra tienda, mismo día). Se insertan como postgres, con la fecha del cobro fija.
insert into dominio.cobros_comprobante
  (organizacion_id, empresa_id, comprobante_id, importe, forma_pago_id, cuenta_cobro_id, origen, registrado_por, registrado_por_nombre, registrado_en)
values
  ('11111111-1111-1111-1111-111111111111', 'a1000000-0000-0000-0000-00000000000a', 'f1000000-0000-0000-0000-000000000001', 100, 'b1000000-0000-0000-0000-00000000000a', null, 'manual', 'd1000000-0000-0000-0000-000000000002', 'Mostrador Uno', ((current_date - 3)::text || ' 12:00:00+00')::timestamptz),
  ('11111111-1111-1111-1111-111111111111', 'a1000000-0000-0000-0000-00000000000a', 'f1000000-0000-0000-0000-000000000001', 200, 'b1000000-0000-0000-0000-00000000000a', null, 'manual', 'd1000000-0000-0000-0000-000000000002', 'Mostrador Uno', ((current_date - 3)::text || ' 13:00:00+00')::timestamptz),
  ('11111111-1111-1111-1111-111111111111', 'a1000000-0000-0000-0000-00000000000a', 'f1000000-0000-0000-0000-000000000001', 500, 'b1000000-0000-0000-0000-00000000000b', 'e1000000-0000-0000-0000-00000000000a', 'manual', 'd1000000-0000-0000-0000-000000000002', 'Mostrador Uno', ((current_date - 3)::text || ' 14:00:00+00')::timestamptz),
  ('11111111-1111-1111-1111-111111111111', 'a1000000-0000-0000-0000-00000000000b', 'f1000000-0000-0000-0000-000000000002', 900, 'b1000000-0000-0000-0000-00000000000d', null, 'manual', 'd1000000-0000-0000-0000-000000000001', 'Admin Uno', ((current_date - 3)::text || ' 12:00:00+00')::timestamptz);

create function pg_temp.como(p_user uuid) returns void language plpgsql as $$
begin
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
  set local role authenticated;
end $$;

-- ============================================================================
-- Esquema y RLS (FR-020)
-- ============================================================================

select ok(
  (select count(*) = 2 from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'dominio' and c.relname in ('cierres_caja', 'cierres_caja_detalle') and c.relrowsecurity),
  'cierres_caja y cierres_caja_detalle viven en «dominio» y tienen RLS activada'
);
select is(
  (select count(*)::int from pg_policies
    where schemaname = 'dominio' and tablename in ('cierres_caja', 'cierres_caja_detalle') and cmd <> 'SELECT'),
  0, 'las tablas del cierre no tienen políticas de escritura'
);
select ok(
  not has_table_privilege('anon', 'dominio.cierres_caja', 'select')
  and not has_table_privilege('anon', 'dominio.cierres_caja_detalle', 'select'),
  'anon no tiene privilegios sobre las tablas del cierre'
);
select ok(
  not has_table_privilege('authenticated', 'dominio.cierres_caja', 'insert')
  and not has_table_privilege('authenticated', 'dominio.cierres_caja_detalle', 'insert'),
  'authenticated no escribe directo en las tablas del cierre'
);
select ok(
  not has_function_privilege('anon', 'public.cerrar_caja(uuid, date)', 'execute')
  and not has_function_privilege('anon', 'public.reabrir_caja(uuid)', 'execute')
  and not has_function_privilege('anon', 'public.listar_cierres_caja(uuid, integer, integer)', 'execute'),
  'anon no ejecuta las RPC del cierre de caja'
);
select ok(
  not has_function_privilege('authenticated', 'private.caja_cerrada(uuid, date)', 'execute'),
  'authenticated no ejecuta private.caja_cerrada'
);

-- ============================================================================
-- Permisos: solo el Administrador cierra y reabre (FR-025)
-- ============================================================================

select pg_temp.como('d1000000-0000-0000-0000-000000000002');
select throws_ok(
  $$select public.cerrar_caja('a1000000-0000-0000-0000-00000000000a', (current_date - 3))$$,
  '42501', null, 'el mostrador no puede cerrar la caja'
);

select pg_temp.como('d2000000-0000-0000-0000-000000000001');
select throws_ok(
  $$select public.cerrar_caja('a1000000-0000-0000-0000-00000000000a', (current_date - 3))$$,
  '42501', null, 'el administrador de otra organización no cierra la caja de esta tienda'
);

select pg_temp.como('d1000000-0000-0000-0000-000000000001');
select throws_ok(
  $$select public.cerrar_caja('a1000000-0000-0000-0000-00000000000a', current_date + 1)$$,
  '22023', null, 'no se cierra la caja de un día futuro'
);

-- ============================================================================
-- Cierre y resumen (FR-021)
-- ============================================================================

select is(
  (select estado from public.cerrar_caja('a1000000-0000-0000-0000-00000000000a', (current_date - 3))),
  'cerrada', 'el administrador cierra la caja del día'
);

reset role;
select is(
  (select count(*)::int from dominio.cierres_caja_detalle d
     join dominio.cierres_caja c on c.id = d.cierre_id
    where c.fecha = (current_date - 3) and c.empresa_id = 'a1000000-0000-0000-0000-00000000000a'),
  2, 'el resumen tiene una fila por forma de pago y cuenta'
);
select is(
  (select d.total from dominio.cierres_caja_detalle d
    where d.forma_pago_id = 'b1000000-0000-0000-0000-00000000000a' and d.cuenta_cobro_id is null),
  300.00::numeric, 'efectivo suma 100 + 200 y no mezcla el cobro de otra tienda'
);
select is(
  (select d.total from dominio.cierres_caja_detalle d
    where d.forma_pago_id = 'b1000000-0000-0000-0000-00000000000b'
      and d.cuenta_cobro_id = 'e1000000-0000-0000-0000-00000000000a'),
  500.00::numeric, 'la transferencia queda separada por cuenta de cobro'
);
select is(
  (select count(*)::int from public.registro_actividad where tipo = 'caja.cerrada'),
  1, 'cerrar registra el evento caja.cerrada'
);

-- Idempotente: un segundo cierre del mismo día devuelve el existente.
select pg_temp.como('d1000000-0000-0000-0000-000000000001');
select is(
  (select id from public.cerrar_caja('a1000000-0000-0000-0000-00000000000a', (current_date - 3))),
  (select id from dominio.cierres_caja where fecha = (current_date - 3) and empresa_id = 'a1000000-0000-0000-0000-00000000000a'),
  'cerrar dos veces devuelve el mismo cierre'
);
reset role;
select is(
  (select count(*)::int from dominio.cierres_caja where fecha = (current_date - 3) and empresa_id = 'a1000000-0000-0000-0000-00000000000a'),
  1, 'un solo cierre por empresa y fecha'
);
select is(
  (select count(*)::int from public.registro_actividad where tipo = 'caja.cerrada'),
  1, 'el segundo cierre no duplica el evento'
);

-- ============================================================================
-- Bloqueo de cobros de una fecha cerrada (FR-022, CA-VTA-33-1)
-- ============================================================================

select throws_ok(
  $$insert into dominio.cobros_comprobante
      (organizacion_id, empresa_id, comprobante_id, importe, forma_pago_id, origen, registrado_por, registrado_por_nombre, registrado_en)
    values ('11111111-1111-1111-1111-111111111111', 'a1000000-0000-0000-0000-00000000000a',
            'f1000000-0000-0000-0000-000000000001', 50, 'b1000000-0000-0000-0000-00000000000a', 'manual',
            'd1000000-0000-0000-0000-000000000002', 'Mostrador Uno', ((current_date - 3)::text || ' 18:00:00+00')::timestamptz)$$,
  '55000', null, 'no se registra un cobro en una fecha cerrada'
);
select throws_ok(
  $$update dominio.cobros_comprobante set aprobado_por = 'd1000000-0000-0000-0000-000000000001',
           aprobado_por_nombre = 'Admin Uno', aprobado_en = now()
     where importe = 500 and registrado_en::date = (current_date - 3)$$,
  '55000', null, 'no se modifica un cobro de una fecha cerrada'
);
-- Otra tienda, mismo día: no está cerrada.
select lives_ok(
  $$update dominio.cobros_comprobante set aprobado_por = 'd1000000-0000-0000-0000-000000000001',
           aprobado_por_nombre = 'Admin Uno', aprobado_en = now()
     where importe = 900$$,
  'el cobro de otra tienda del mismo día sigue modificable'
);

-- Vía la RPC de MSF-195: se cierra HOY y registrar_cobro (que cobra con la hora actual) se rechaza.
select pg_temp.como('d1000000-0000-0000-0000-000000000001');
select lives_ok(
  $$select public.cerrar_caja('a1000000-0000-0000-0000-00000000000a', (now() at time zone 'America/Argentina/Buenos_Aires')::date)$$,
  'se cierra la caja de hoy'
);
select throws_ok(
  $$select public.registrar_cobro('f1000000-0000-0000-0000-000000000001', 50, 'b1000000-0000-0000-0000-00000000000a')$$,
  '55000', null, 'registrar_cobro (MSF-195) se rechaza con la caja de hoy cerrada'
);
select lives_ok(
  $$select public.registrar_cobro('f1000000-0000-0000-0000-000000000002', 50, 'b1000000-0000-0000-0000-00000000000d')$$,
  'registrar_cobro sigue funcionando en la tienda con la caja abierta'
);

-- ============================================================================
-- Reabrir (FR-023)
-- ============================================================================

select pg_temp.como('d1000000-0000-0000-0000-000000000002');
select throws_ok(
  format($$select public.reabrir_caja(%L)$$, '00000000-0000-0000-0000-000000000000'),
  '42501', null, 'el mostrador no puede reabrir la caja'
);

select pg_temp.como('d1000000-0000-0000-0000-000000000001');
select is(
  (select estado from public.reabrir_caja((select id from public.listar_cierres_caja() where fecha = (now() at time zone 'America/Argentina/Buenos_Aires')::date))),
  'reabierta', 'el administrador reabre la caja'
);
select is(
  (select estado from public.reabrir_caja((select id from public.listar_cierres_caja() where fecha = (now() at time zone 'America/Argentina/Buenos_Aires')::date))),
  'reabierta', 'reabrir es idempotente'
);
select lives_ok(
  $$select public.registrar_cobro('f1000000-0000-0000-0000-000000000001', 50, 'b1000000-0000-0000-0000-00000000000a')$$,
  'con la caja reabierta se vuelve a registrar el cobro'
);

reset role;
select is(
  (select count(*)::int from public.registro_actividad where tipo = 'caja.reabierta'),
  1, 'reabrir registra el evento caja.reabierta (una vez)'
);
select isnt(
  (select reabierto_por from dominio.cierres_caja where fecha = (now() at time zone 'America/Argentina/Buenos_Aires')::date), null,
  'reabrir registra quién y cuándo'
);

-- Volver a cerrar rehace el resumen con el cobro nuevo.
select pg_temp.como('d1000000-0000-0000-0000-000000000001');
select is(
  (select estado from public.cerrar_caja('a1000000-0000-0000-0000-00000000000a', (now() at time zone 'America/Argentina/Buenos_Aires')::date)),
  'cerrada', 'se vuelve a cerrar la caja reabierta'
);
reset role;
select is(
  (select sum(d.total) from dominio.cierres_caja_detalle d join dominio.cierres_caja c on c.id = d.cierre_id
    where c.fecha = (now() at time zone 'America/Argentina/Buenos_Aires')::date and c.empresa_id = 'a1000000-0000-0000-0000-00000000000a'),
  50.00::numeric, 'el nuevo resumen incluye el cobro registrado con la caja reabierta'
);
select is(
  (select count(*)::int from dominio.cierres_caja where fecha = (now() at time zone 'America/Argentina/Buenos_Aires')::date and empresa_id = 'a1000000-0000-0000-0000-00000000000a'),
  1, 'reabrir y cerrar reutiliza el mismo cierre'
);

-- ============================================================================
-- Lectura y aislamiento (FR-024, FR-025)
-- ============================================================================

select pg_temp.como('d1000000-0000-0000-0000-000000000001');
select cmp_ok(
  (select count(*)::int from public.listar_cierres_caja()), '>=', 2,
  'el administrador lista los cierres de su organización'
);
select is(
  (select count(*)::int from public.listar_cierres_caja('a1000000-0000-0000-0000-00000000000b')),
  0, 'filtrar por una tienda sin cierres no devuelve filas'
);
select is(
  (select jsonb_array_length(detalle) from public.listar_cierres_caja() where fecha = (current_date - 3)),
  2, 'el listado trae el detalle por forma de pago y cuenta'
);

-- El mostrador (solo San Javucho) puede leer, no escribir.
select pg_temp.como('d1000000-0000-0000-0000-000000000002');
select cmp_ok(
  (select count(*)::int from public.listar_cierres_caja()), '>=', 2,
  'ventas puede leer los cierres de su tienda'
);

-- Otra organización no ve nada.
select pg_temp.como('d2000000-0000-0000-0000-000000000001');
select is(
  (select count(*)::int from public.listar_cierres_caja()),
  0, 'otra organización no ve los cierres'
);
select is(
  (select count(*)::int from dominio.cierres_caja),
  0, 'la RLS oculta los cierres a otra organización'
);

-- Día de caja en la zona de la organización (Buenos Aires, UTC-3 por defecto): un cobro de las 22:30
-- locales del 05/01 es del 06/01 en UTC, pero pertenece al cierre del 05/01.
reset role;
insert into dominio.cobros_comprobante
  (organizacion_id, empresa_id, comprobante_id, importe, forma_pago_id, origen, registrado_por, registrado_por_nombre, registrado_en)
values ('11111111-1111-1111-1111-111111111111', 'a1000000-0000-0000-0000-00000000000b',
        'f1000000-0000-0000-0000-000000000002', 77, 'b1000000-0000-0000-0000-00000000000d', 'manual',
        'd1000000-0000-0000-0000-000000000001', 'Admin Uno', ((current_date - 2)::text || ' 01:30:00+00')::timestamptz);
select pg_temp.como('d1000000-0000-0000-0000-000000000001');
select is(
  (select sum(d.total) from public.cerrar_caja('a1000000-0000-0000-0000-00000000000b', (current_date - 3)) c
     join dominio.cierres_caja_detalle d on d.cierre_id = c.id),
  977::numeric, 'el cobro de las 22:30 locales entra al cierre del día local'
);
reset role;
select throws_ok(
  $$insert into dominio.cobros_comprobante
      (organizacion_id, empresa_id, comprobante_id, importe, forma_pago_id, origen, registrado_por, registrado_por_nombre, registrado_en)
    values ('11111111-1111-1111-1111-111111111111', 'a1000000-0000-0000-0000-00000000000b',
            'f1000000-0000-0000-0000-000000000002', 5, 'b1000000-0000-0000-0000-00000000000d', 'manual',
            'd1000000-0000-0000-0000-000000000001', 'Admin Uno', ((current_date - 2)::text || ' 02:00:00+00')::timestamptz)$$,
  '55000', null, 'un cobro de las 23:00 locales cae en el día local cerrado'
);

select * from finish();

rollback;
