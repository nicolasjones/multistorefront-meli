-- F-VTA-10 (MSF-365, épica MSF-177, SC-004): estados del comprobante y de cobro.
-- Cubre FR-020 (tabla `dominio.transiciones_estado_comprobante`: RLS, `check`, sin escritura directa), FR-021
-- (siembra por organización y matriz por rol), FR-022 (transición permitida/negada por rol, idempotencia, bloqueo
-- optimista, evento), FR-025 (historial y aislamiento) y FR-026 (Cobrado/Deuda solo por la función `private`).
-- `rls_en_toda_tabla` / `aislamiento_organizaciones` recorren la tabla nueva sin tocarla. La concurrencia real (dos
-- sesiones) no cabe en una transacción de pgTAP: se prueba el bloqueo optimista (fecha vieja = 40001) y que la RPC
-- toma la fila `for update` (la segunda ve lo que dejó la primera: idempotencia).
begin;

select no_plan();

insert into organizaciones (id, nombre) values
  ('11111111-1111-1111-1111-111111111111', 'Organización Uno'),
  ('22222222-2222-2222-2222-222222222222', 'Organización Dos');

insert into auth.users (id, email) values
  ('f1000000-0000-0000-0000-000000000001', 'administrador@example.com'),
  ('f1000000-0000-0000-0000-000000000002', 'mostrador@example.com'),
  ('f1000000-0000-0000-0000-000000000003', 'deposito@example.com'),
  ('f1000000-0000-0000-0000-000000000004', 'administracion@example.com'),
  ('f1000000-0000-0000-0000-000000000005', 'consulta@example.com'),
  ('f2000000-0000-0000-0000-000000000001', 'admin-dos@example.com');

insert into usuarios_organizacion (user_id, organizacion_id, rol_id, estado) values
  ('f1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'administrador', 'activo'),
  ('f1000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'mostrador', 'activo'),
  ('f1000000-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111', 'deposito', 'activo'),
  ('f1000000-0000-0000-0000-000000000004', '11111111-1111-1111-1111-111111111111', 'administracion', 'activo'),
  ('f1000000-0000-0000-0000-000000000005', '11111111-1111-1111-1111-111111111111', 'consulta', 'activo'),
  ('f2000000-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', 'administrador', 'activo');

insert into dominio.empresas (id, organizacion_id, nombre) values
  ('a1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'San Javucho'),
  ('a2000000-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', 'Empresa Dos');

insert into usuarios_empresas (user_id, empresa_id, organizacion_id, rol_id) values
  ('f1000000-0000-0000-0000-000000000002', 'a1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'mostrador'),
  ('f1000000-0000-0000-0000-000000000003', 'a1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'deposito'),
  ('f1000000-0000-0000-0000-000000000004', 'a1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'administracion'),
  ('f1000000-0000-0000-0000-000000000005', 'a1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'consulta');

insert into clientes (id, organizacion_id, numero, nombre, tipo, archivado_en) values
  ('c5000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 10, 'Cliente Uno', 'minorista', null);

-- Facturas armadas directo (la confirmación es de F-VTA-07): F1 y F2 confirmadas, F3 borrador, F4 anulada,
-- F5 presupuesto. Los números F-0001 y F-00010 prueban que el historial no mezcla un número que es prefijo de otro.
insert into dominio.comprobantes_venta
  (id, organizacion_id, empresa_id, cliente_id, tipo, numero, fecha, estado, total_sin_iva, total_con_iva) values
  ('e1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'a1000000-0000-0000-0000-000000000001', 'c5000000-0000-0000-0000-000000000001', 'factura', 'F-0001', '2026-10-24', 'confirmada', 100, 121),
  ('e1000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'a1000000-0000-0000-0000-000000000001', 'c5000000-0000-0000-0000-000000000001', 'factura', 'F-00010', '2026-10-24', 'confirmada', 100, 121),
  ('e1000000-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111', 'a1000000-0000-0000-0000-000000000001', 'c5000000-0000-0000-0000-000000000001', 'factura', 'F-0003', '2026-10-24', 'borrador', 100, 121),
  ('e1000000-0000-0000-0000-000000000004', '11111111-1111-1111-1111-111111111111', 'a1000000-0000-0000-0000-000000000001', 'c5000000-0000-0000-0000-000000000001', 'factura', 'F-0004', '2026-10-24', 'anulada', 100, 121),
  ('e1000000-0000-0000-0000-000000000005', '11111111-1111-1111-1111-111111111111', 'a1000000-0000-0000-0000-000000000001', 'c5000000-0000-0000-0000-000000000001', 'presupuesto', 'P-0001', '2026-10-24', 'pendiente', 100, 121);

create function pg_temp.como(p_user uuid) returns void language plpgsql as $$
begin
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
  set local role authenticated;
end $$;

create function pg_temp.id_f(n int) returns uuid language sql as $$ select ('e1000000-0000-0000-0000-00000000000' || n)::uuid $$;
create function pg_temp.upd(n int) returns timestamptz language sql security definer as $$
  select updated_at from dominio.comprobantes_venta where id = pg_temp.id_f(n) $$;
create function pg_temp.est(n int) returns text language sql security definer as $$
  select estado from dominio.comprobantes_venta where id = pg_temp.id_f(n) $$;
create function pg_temp.eventos(n int) returns integer language sql security definer as $$
  select count(*)::int from public.registro_actividad a
   where a.tipo = 'comprobante.estado_cambiado'
     and a.detalle like '% en la factura ' || (select numero from dominio.comprobantes_venta where id = pg_temp.id_f(n)) $$;
grant execute on function pg_temp.upd(int), pg_temp.est(int), pg_temp.eventos(int), pg_temp.id_f(int) to public;

-- ============================================================================
-- FR-020 · Tabla: RLS, `check`, sin escritura directa, `anon` sin acceso
-- ============================================================================

select is(
  (select relrowsecurity from pg_class where oid = 'dominio.transiciones_estado_comprobante'::regclass),
  true, 'transiciones_estado_comprobante tiene RLS'
);
select is(has_table_privilege('anon', 'dominio.transiciones_estado_comprobante', 'select'), false, 'anon no lee la matriz');
select is(has_table_privilege('authenticated', 'dominio.transiciones_estado_comprobante', 'select'), true, 'authenticated lee la matriz (con RLS)');
select is(
  has_table_privilege('authenticated', 'dominio.transiciones_estado_comprobante', 'insert')
    or has_table_privilege('authenticated', 'dominio.transiciones_estado_comprobante', 'update')
    or has_table_privilege('authenticated', 'dominio.transiciones_estado_comprobante', 'delete'),
  false, 'sin escritura directa para authenticated'
);
select throws_ok(
  $$insert into dominio.transiciones_estado_comprobante (organizacion_id, tipo, estado_desde, estado_hasta, rol_id)
    values ('11111111-1111-1111-1111-111111111111', 'factura', 'confirmada', 'inventado', 'mostrador')$$,
  '23514', null, 'el check rechaza un estado inválido'
);
select throws_ok(
  $$insert into dominio.transiciones_estado_comprobante (organizacion_id, tipo, estado_desde, estado_hasta, rol_id)
    values ('11111111-1111-1111-1111-111111111111', 'factura', 'aceptado', 'aceptado', 'mostrador')$$,
  '23514', null, 'el check rechaza una transición al mismo estado'
);

-- ============================================================================
-- Privilegios de las funciones
-- ============================================================================

select is(has_function_privilege('anon', 'public.cambiar_estado_comprobante(uuid, text, timestamptz)', 'execute'), false, 'anon no cambia estados');
select is(has_function_privilege('authenticated', 'public.cambiar_estado_comprobante(uuid, text, timestamptz)', 'execute'), true, 'authenticated ejecuta cambiar_estado_comprobante');
select is(has_function_privilege('anon', 'public.historial_comprobante(uuid)', 'execute'), false, 'anon no lee el historial');
select is(has_function_privilege('authenticated', 'public.historial_comprobante(uuid)', 'execute'), true, 'authenticated ejecuta historial_comprobante');
select is(has_function_privilege('anon', 'public.transiciones_permitidas_comprobante(uuid)', 'execute'), false, 'anon no lee las transiciones permitidas');
select is(has_function_privilege('authenticated', 'public.transiciones_permitidas_comprobante(uuid)', 'execute'), true, 'authenticated ejecuta transiciones_permitidas_comprobante');
select is(has_function_privilege('authenticated', 'private.marcar_estado_cobro_comprobante(uuid, text)', 'execute'), false, 'authenticated NO ejecuta marcar_estado_cobro_comprobante (FR-026)');
select is(has_function_privilege('anon', 'private.marcar_estado_cobro_comprobante(uuid, text)', 'execute'), false, 'anon NO ejecuta marcar_estado_cobro_comprobante');
select is(has_function_privilege('authenticated', 'private.sembrar_transiciones_comprobante(uuid)', 'execute'), false, 'authenticated NO ejecuta la siembra');

-- ============================================================================
-- FR-021 · Siembra por organización y matriz por rol
-- ============================================================================

select is(
  (select count(*)::int from dominio.transiciones_estado_comprobante where organizacion_id = '11111111-1111-1111-1111-111111111111'),
  27, 'la organización existente quedó sembrada: 21 manuales (7 transiciones × 3 roles) y 6 del sistema'
);
select is(
  (select count(*)::int from dominio.transiciones_estado_comprobante where organizacion_id = '22222222-2222-2222-2222-222222222222'),
  27, 'la segunda organización también'
);
insert into organizaciones (id, nombre) values ('33333333-3333-3333-3333-333333333333', 'Organización Nueva');
select is(
  (select count(*)::int from dominio.transiciones_estado_comprobante where organizacion_id = '33333333-3333-3333-3333-333333333333'),
  27, 'una organización nueva se siembra sola (mismo punto de siembra)'
);
select lives_ok($$select private.sembrar_transiciones_comprobante('33333333-3333-3333-3333-333333333333')$$, 'la siembra es idempotente');
select is(
  (select count(*)::int from dominio.transiciones_estado_comprobante where organizacion_id = '33333333-3333-3333-3333-333333333333'),
  27, 'resembrar no duplica filas'
);
select is(
  (select string_agg(estado_desde || '>' || estado_hasta, ',' order by estado_desde, estado_hasta)
     from dominio.transiciones_estado_comprobante
    where organizacion_id = '11111111-1111-1111-1111-111111111111' and rol_id = 'mostrador'),
  'aceptado>en_proceso,confirmada>aceptado,confirmada>en_proceso', 'Mostrador: Pendiente → Aceptado / En proceso y Aceptado → En proceso'
);
select is(
  (select string_agg(estado_desde || '>' || estado_hasta, ',' order by estado_desde, estado_hasta)
     from dominio.transiciones_estado_comprobante
    where organizacion_id = '11111111-1111-1111-1111-111111111111' and rol_id = 'deposito'),
  'aceptado>armando,armando>incompleto,en_proceso>armando,incompleto>armando', 'Depósito: Armando, Incompleto y su vuelta'
);
select is(
  (select count(*)::int from dominio.transiciones_estado_comprobante
    where organizacion_id = '11111111-1111-1111-1111-111111111111' and rol_id in ('administrador', 'administracion')
      and estado_hasta in ('cobrado', 'deuda')),
  0, 'ninguna persona tiene Cobrado/Deuda en la matriz'
);
select is(
  (select count(*)::int from dominio.transiciones_estado_comprobante
    where organizacion_id = '11111111-1111-1111-1111-111111111111' and rol_id = 'sistema' and estado_hasta in ('cobrado', 'deuda')),
  6, 'Cobrado/Deuda quedan para el actor sistema'
);

-- RLS de lectura: el vendedor de la organización Uno lee la suya, no la de Dos ni la Nueva.
select pg_temp.como('f1000000-0000-0000-0000-000000000002');
select is((select count(*)::int from dominio.transiciones_estado_comprobante), 27, 'Mostrador lee solo la matriz de su organización');
select throws_ok(
  $$insert into dominio.transiciones_estado_comprobante (organizacion_id, tipo, estado_desde, estado_hasta, rol_id)
    values ('11111111-1111-1111-1111-111111111111', 'factura', 'armando', 'aceptado', 'mostrador')$$,
  '42501', null, 'Mostrador no escribe la matriz'
);

-- ============================================================================
-- FR-022 · Transiciones por rol
-- ============================================================================

-- Mostrador: Pendiente (confirmada) → Aceptado.
select is(
  (select estado from public.cambiar_estado_comprobante(pg_temp.id_f(1), 'aceptado', pg_temp.upd(1))),
  'aceptado', 'Mostrador pasa la factura de Pendiente a Aceptado'
);
select is(pg_temp.eventos(1), 1, 'registra comprobante.estado_cambiado');

-- Idempotencia: pedir el mismo estado (aun con fecha vieja) devuelve el actual y no duplica el evento.
select is(
  (select estado from public.cambiar_estado_comprobante(pg_temp.id_f(1), 'aceptado', '2000-01-01')),
  'aceptado', 'reintentar el mismo estado devuelve el actual'
);
select is(pg_temp.eventos(1), 1, 'el reintento no duplica el evento');

-- Una transición que su rol no tiene: Mostrador no arma.
select throws_ok(
  format($$select public.cambiar_estado_comprobante(%L, 'armando', %L)$$, pg_temp.id_f(1), pg_temp.upd(1)),
  '42501', null, 'Mostrador no puede pasar a Armando'
);
select is(pg_temp.est(1), 'aceptado', 'la transición negada no cambió el estado');
-- Una transición que ningún rol tiene: Aceptado → Pendiente.
select throws_ok(
  format($$select public.cambiar_estado_comprobante(%L, 'pendiente', %L)$$, pg_temp.id_f(1), pg_temp.upd(1)),
  '42501', null, 'no se puede volver a Pendiente: la matriz no lo tiene'
);

-- Transiciones permitidas que ve la pantalla.
select is(public.transiciones_permitidas_comprobante(pg_temp.id_f(1)), array['en_proceso'], 'Mostrador, desde Aceptado, solo puede ir a En proceso');
select is(public.transiciones_permitidas_comprobante(pg_temp.id_f(2)), array['aceptado', 'en_proceso'], 'Mostrador, desde Pendiente, puede ir a Aceptado o En proceso');

-- Pedir «pendiente» equivale a `confirmada`: es el estado que ya tiene F2.
select is((select estado from public.cambiar_estado_comprobante(pg_temp.id_f(2), 'pendiente', pg_temp.upd(2))), 'confirmada', 'pedir Pendiente sobre una confirmada es idempotente');

-- Depósito (ventas en lectura): Aceptado → Armando → Incompleto → Armando.
select pg_temp.como('f1000000-0000-0000-0000-000000000003');
select is(public.transiciones_permitidas_comprobante(pg_temp.id_f(1)), array['armando'], 'Depósito, desde Aceptado, solo puede ir a Armando');
-- Bloqueo optimista: con la fecha vieja, 40001 y no cambia.
select throws_ok(
  format($$select public.cambiar_estado_comprobante(%L, 'armando', '2000-01-01')$$, pg_temp.id_f(1)),
  '40001', null, 'bloqueo optimista: con una fecha vieja se rechaza'
);
select is(pg_temp.est(1), 'aceptado', 'el conflicto no cambió el estado');
select is(
  (select estado from public.cambiar_estado_comprobante(pg_temp.id_f(1), 'armando', pg_temp.upd(1))),
  'armando', 'Depósito pasa Aceptado → Armando'
);
select is(
  (select estado from public.cambiar_estado_comprobante(pg_temp.id_f(1), 'incompleto', pg_temp.upd(1))),
  'incompleto', 'Depósito pasa Armando → Incompleto'
);
select is(
  (select estado from public.cambiar_estado_comprobante(pg_temp.id_f(1), 'armando', pg_temp.upd(1))),
  'armando', 'Depósito vuelve Incompleto → Armando'
);
select throws_ok(
  format($$select public.cambiar_estado_comprobante(%L, 'aceptado', %L)$$, pg_temp.id_f(2), pg_temp.upd(2)),
  '42501', null, 'Depósito no acepta (es de Mostrador)'
);
select is(pg_temp.eventos(1), 4, 'cada cambio real dejó un evento (Aceptado, Armando, Incompleto, Armando)');

-- Administración: todas las manuales.
select pg_temp.como('f1000000-0000-0000-0000-000000000004');
select is(
  (select estado from public.cambiar_estado_comprobante(pg_temp.id_f(2), 'en_proceso', pg_temp.upd(2))),
  'en_proceso', 'Administración pasa Pendiente → En proceso (transición de Mostrador)'
);
select is(
  (select estado from public.cambiar_estado_comprobante(pg_temp.id_f(2), 'armando', pg_temp.upd(2))),
  'armando', 'Administración pasa En proceso → Armando (transición de Depósito)'
);

-- Administrador de la organización.
select pg_temp.como('f1000000-0000-0000-0000-000000000001');
select is(
  (select estado from public.cambiar_estado_comprobante(pg_temp.id_f(2), 'incompleto', pg_temp.upd(2))),
  'incompleto', 'Administrador pasa Armando → Incompleto'
);

-- ============================================================================
-- FR-026 · Cobrado y Deuda: ninguna persona, ni el Administrador
-- ============================================================================

select throws_ok(
  format($$select public.cambiar_estado_comprobante(%L, 'cobrado', %L)$$, pg_temp.id_f(2), pg_temp.upd(2)),
  '42501', null, 'el Administrador no puede fijar Cobrado a mano'
);
select throws_ok(
  format($$select public.cambiar_estado_comprobante(%L, 'deuda', %L)$$, pg_temp.id_f(2), pg_temp.upd(2)),
  '42501', null, 'el Administrador no puede fijar Deuda a mano'
);
select throws_ok(
  format($$select private.marcar_estado_cobro_comprobante(%L, 'cobrado')$$, pg_temp.id_f(2)),
  '42501', null, 'una persona (authenticated) no llama a la función de cobro'
);

-- ============================================================================
-- FR-022 · Documentos que no admiten cambios
-- ============================================================================

select throws_ok(
  format($$select public.cambiar_estado_comprobante(%L, 'aceptado', %L)$$, pg_temp.id_f(3), pg_temp.upd(3)),
  '55000', null, 'un borrador no admite cambios de estado'
);
select throws_ok(
  format($$select public.cambiar_estado_comprobante(%L, 'aceptado', %L)$$, pg_temp.id_f(4), pg_temp.upd(4)),
  '55000', null, 'una factura anulada no admite cambios de estado'
);
select throws_ok(
  format($$select public.cambiar_estado_comprobante(%L, 'aceptado', %L)$$, pg_temp.id_f(5), pg_temp.upd(5)),
  '22023', null, 'un presupuesto no cambia de estado por esta vía'
);
select throws_ok(
  format($$select public.cambiar_estado_comprobante(%L, 'anulada', %L)$$, pg_temp.id_f(2), pg_temp.upd(2)),
  '22023', null, 'anular no es un cambio de estado manual (es la anulación de F-VTA-11)'
);
select throws_ok(
  format($$select public.cambiar_estado_comprobante(%L, 'borrador', %L)$$, pg_temp.id_f(2), pg_temp.upd(2)),
  '22023', null, 'no se vuelve a borrador'
);
select throws_ok(
  format($$select public.cambiar_estado_comprobante(%L, 'inventado', %L)$$, pg_temp.id_f(2), pg_temp.upd(2)),
  '22023', null, 'un estado desconocido se rechaza'
);
select is(public.transiciones_permitidas_comprobante(pg_temp.id_f(3)), '{}'::text[], 'un borrador no tiene transiciones');
select is(public.transiciones_permitidas_comprobante(pg_temp.id_f(5)), '{}'::text[], 'un presupuesto no tiene transiciones');

-- ============================================================================
-- Consulta (sin transiciones), otra organización y anon
-- ============================================================================

select pg_temp.como('f1000000-0000-0000-0000-000000000005');
select is(public.transiciones_permitidas_comprobante(pg_temp.id_f(2)), '{}'::text[], 'Consulta ve todos los chips deshabilitados');
select throws_ok(
  format($$select public.cambiar_estado_comprobante(%L, 'armando', %L)$$, pg_temp.id_f(2), pg_temp.upd(2)),
  '42501', null, 'Consulta no cambia estados'
);
select pg_temp.como('f2000000-0000-0000-0000-000000000001');
select throws_ok(
  format($$select public.cambiar_estado_comprobante(%L, 'aceptado', now())$$, pg_temp.id_f(2)),
  'P0002', null, 'otra organización no ve el comprobante'
);
select throws_ok(format($$select public.historial_comprobante(%L)$$, pg_temp.id_f(1)), 'P0002', null, 'otra organización no lee el historial');
select throws_ok(format($$select public.transiciones_permitidas_comprobante(%L)$$, pg_temp.id_f(1)), 'P0002', null, 'otra organización no lee las transiciones');
select is((select count(*)::int from dominio.transiciones_estado_comprobante where organizacion_id <> '22222222-2222-2222-2222-222222222222'), 0, 'otra organización no lee la matriz ajena');
reset role;
set local role anon;
select throws_ok(
  format($$select public.cambiar_estado_comprobante(%L, 'aceptado', now())$$, pg_temp.id_f(2)),
  '42501', null, 'anon no ejecuta la RPC'
);
reset role;

-- ============================================================================
-- FR-026 · La función de cobro (privada, la llamará MSF-195)
-- ============================================================================

select lives_ok(format($$select private.marcar_estado_cobro_comprobante(%L, 'cobrado')$$, pg_temp.id_f(2)), 'el sistema marca la factura como Cobrada');
select is(pg_temp.est(2), 'cobrado', 'queda Cobrado');
select lives_ok(format($$select private.marcar_estado_cobro_comprobante(%L, 'cobrado')$$, pg_temp.id_f(2)), 'repetir es idempotente');
select lives_ok(format($$select private.marcar_estado_cobro_comprobante(%L, 'deuda')$$, pg_temp.id_f(2)), 'Cobrado → Deuda');
select is(pg_temp.est(2), 'deuda', 'queda Deuda');
select is(
  (select count(*)::int from public.registro_actividad
    where tipo = 'comprobante.estado_cambiado' and actor_id is null and detalle like 'Estado: % en la factura F-00010'),
  2, 'los cambios de cobro dejan evento con actor sistema (sin duplicar en el reintento)'
);
select throws_ok(format($$select private.marcar_estado_cobro_comprobante(%L, 'aceptado')$$, pg_temp.id_f(2)), '22023', null, 'la función de cobro solo acepta cobrado o deuda');
select throws_ok(format($$select private.marcar_estado_cobro_comprobante(%L, 'cobrado')$$, pg_temp.id_f(3)), '55000', null, 'un borrador no se cobra');
select throws_ok(format($$select private.marcar_estado_cobro_comprobante(%L, 'cobrado')$$, pg_temp.id_f(4)), '55000', null, 'una anulada no se cobra');
select throws_ok(format($$select private.marcar_estado_cobro_comprobante(%L, 'cobrado')$$, pg_temp.id_f(5)), '22023', null, 'un presupuesto no se cobra');
-- Una Deuda puede volver a Cobrado (el cliente paga).
select lives_ok(format($$select private.marcar_estado_cobro_comprobante(%L, 'cobrado')$$, pg_temp.id_f(2)), 'Deuda → Cobrado');

-- ============================================================================
-- FR-025 · Historial
-- ============================================================================

-- Un evento de otra fuente del mismo comprobante y fechas distintas (en una transacción todos comparten `now()`)
-- para probar el orden descendente.
select private.insertar_actividad(
  '11111111-1111-1111-1111-111111111111', 'f1000000-0000-0000-0000-000000000002', 'comprobante.creado',
  'Creó la factura F-0001 en San Javucho', 'a1000000-0000-0000-0000-000000000001');
update public.registro_actividad set creado_en = now() - interval '3 hours' where tipo = 'comprobante.creado';
update public.registro_actividad set creado_en = now() - interval '150 minutes'
 where detalle = 'Estado: Pendiente → Aceptado en la factura F-0001';
update public.registro_actividad set creado_en = now() - interval '120 minutes'
 where detalle = 'Estado: Aceptado → Armando en la factura F-0001';
update public.registro_actividad set creado_en = now() - interval '90 minutes'
 where detalle = 'Estado: Armando → Incompleto en la factura F-0001';
update public.registro_actividad set creado_en = now() - interval '60 minutes'
 where detalle = 'Estado: Incompleto → Armando en la factura F-0001';

select pg_temp.como('f1000000-0000-0000-0000-000000000002');
select is(
  (select count(*)::int from public.historial_comprobante(pg_temp.id_f(1))),
  5, 'F-0001: creación + 4 cambios de estado, sin los eventos de F-00010 (un número no es prefijo del otro)'
);
select is(
  (select accion from public.historial_comprobante(pg_temp.id_f(1)) order by cuando asc limit 1),
  'Creó la factura F-0001 en San Javucho', 'el evento más viejo es la creación'
);
select is(
  (select accion from public.historial_comprobante(pg_temp.id_f(1)) limit 1),
  'Estado: Incompleto → Armando', 'orden descendente: primero el cambio más reciente, sin el sufijo técnico'
);
select ok(
  exists (select 1 from public.historial_comprobante(pg_temp.id_f(1)) where accion = 'Estado: Pendiente → Aceptado'),
  'el cambio de Mostrador figura como «Estado: Pendiente → Aceptado»'
);
select ok(
  (select bool_and(quien is not null and empresa = 'San Javucho' and empresa_id = 'a1000000-0000-0000-0000-000000000001')
     from public.historial_comprobante(pg_temp.id_f(1))),
  'cada fila trae quién y la tienda'
);
select is(
  (select count(*)::int from public.historial_comprobante(pg_temp.id_f(2)) where quien = 'Sistema'),
  3, 'F-00010: los tres cambios del cobro (Cobrado, Deuda, Cobrado) figuran hechos por «Sistema»'
);
select is(
  (select count(*)::int from public.historial_comprobante(pg_temp.id_f(2))),
  6, 'F-00010: 3 cambios de personas y 3 del sistema, sin los de F-0001'
);

-- Quien ve ventas (aun en lectura) lee el historial; anon no.
select pg_temp.como('f1000000-0000-0000-0000-000000000003');
select lives_ok(format($$select * from public.historial_comprobante(%L)$$, pg_temp.id_f(1)), 'Depósito (ventas en lectura) lee el historial');
reset role;
set local role anon;
select throws_ok(format($$select * from public.historial_comprobante(%L)$$, pg_temp.id_f(1)), '42501', null, 'anon no lee el historial');
reset role;

select * from finish();
rollback;
