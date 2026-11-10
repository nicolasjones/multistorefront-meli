-- F-VTA-11 (MSF-377, épica MSF-177, SC-006): anulación de la factura. Cubre FR-040 (motivo, bloqueos, idempotencia,
-- número no reutilizado, permisos), FR-041 (reversión exacta por depósito, reservas liberadas, todo o nada) y FR-048
-- (acciones `anular` / `emitir_nota_credito` sembradas y verificadas en la RPC, no solo en la UI).
-- La concurrencia real (dos sesiones) no cabe en una transacción de pgTAP: se prueba la serie (la segunda anulación ve
-- `anulada` y no revierte dos veces) y que la RPC toma la factura `for update`.
begin;

select no_plan();

insert into organizaciones (id, nombre) values
  ('11111111-1111-1111-1111-111111111111', 'Organización Uno'),
  ('22222222-2222-2222-2222-222222222222', 'Organización Dos');

insert into auth.users (id, email) values
  ('f1000000-0000-0000-0000-000000000001', 'administrador@example.com'),
  ('f1000000-0000-0000-0000-000000000002', 'operador@example.com'),
  ('f1000000-0000-0000-0000-000000000003', 'consulta@example.com'),
  ('f1000000-0000-0000-0000-000000000004', 'administracion@example.com'),
  ('f1000000-0000-0000-0000-000000000005', 'mostrador@example.com'),
  ('f2000000-0000-0000-0000-000000000001', 'admin-dos@example.com');

insert into usuarios_organizacion (user_id, organizacion_id, rol_id, estado) values
  ('f1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'administrador', 'activo'),
  ('f1000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'operador', 'activo'),
  ('f1000000-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111', 'consulta', 'activo'),
  ('f1000000-0000-0000-0000-000000000004', '11111111-1111-1111-1111-111111111111', 'administracion', 'activo'),
  ('f1000000-0000-0000-0000-000000000005', '11111111-1111-1111-1111-111111111111', 'mostrador', 'activo'),
  ('f2000000-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', 'administrador', 'activo');

insert into dominio.empresas (id, organizacion_id, nombre) values
  ('a1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'San Javucho'),
  ('a2000000-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', 'Empresa Dos');

insert into usuarios_empresas (user_id, empresa_id, organizacion_id, rol_id) values
  ('f1000000-0000-0000-0000-000000000002', 'a1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'operador'),
  ('f1000000-0000-0000-0000-000000000003', 'a1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'consulta'),
  ('f1000000-0000-0000-0000-000000000004', 'a1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'administracion'),
  ('f1000000-0000-0000-0000-000000000005', 'a1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'mostrador');

insert into clientes (id, organizacion_id, numero, nombre, tipo, archivado_en) values
  ('c5000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 10, 'Cliente Uno', 'minorista', null);

insert into dominio.categorias (id, organizacion_id, nombre) values
  ('c1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'Joysticks');

-- Joystick y Cable con stock; Consola «A pedido».
insert into dominio.productos (id, organizacion_id, nombre, sku, moneda, precio_lista, categoria_id, disponibilidad_manual, activo) values
  ('b1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'Joystick', 'JOY-1', 'ARS', 1000, 'c1000000-0000-0000-0000-000000000001', null, true),
  ('b1000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'Cable', 'CAB-1', 'ARS', 500, 'c1000000-0000-0000-0000-000000000001', null, true),
  ('b1000000-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111', 'Consola bajo pedido', 'CON-1', 'ARS', 2000, 'c1000000-0000-0000-0000-000000000001', 'a_pedido', true);

insert into dominio.depositos (id, organizacion_id, nombre) values
  ('d1000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'Local');

create temp table datos as
  select (select id from dominio.depositos where organizacion_id = '11111111-1111-1111-1111-111111111111' and por_defecto) as principal;
grant select on datos to public;

insert into dominio.depositos_empresas (deposito_id, empresa_id, organizacion_id)
select d, 'a1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111'
  from (select principal as d from datos union all select 'd1000000-0000-0000-0000-000000000002'::uuid) x
on conflict do nothing;

-- Joystick: 10 en el principal y 4 en Local (14). Cable: 5 en el principal. Consola a pedido: 6 en el principal.
insert into dominio.existencias (producto_id, organizacion_id, cantidad, reservado) values
  ('b1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 14, 0),
  ('b1000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 5, 0),
  ('b1000000-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111', 6, 0)
on conflict (producto_id) do update set cantidad = excluded.cantidad, reservado = excluded.reservado;
insert into dominio.existencias_deposito (producto_id, deposito_id, organizacion_id, cantidad, reservado) values
  ('b1000000-0000-0000-0000-000000000001', (select principal from datos), '11111111-1111-1111-1111-111111111111', 10, 0),
  ('b1000000-0000-0000-0000-000000000001', 'd1000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 4, 0),
  ('b1000000-0000-0000-0000-000000000002', (select principal from datos), '11111111-1111-1111-1111-111111111111', 5, 0),
  ('b1000000-0000-0000-0000-000000000003', (select principal from datos), '11111111-1111-1111-1111-111111111111', 6, 0)
on conflict (producto_id, deposito_id) do update set cantidad = excluded.cantidad, reservado = excluded.reservado;

create function pg_temp.como(p_user uuid) returns void language plpgsql as $$
begin
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
  set local role authenticated;
end $$;

create temp table comps (clave text primary key, id uuid);
grant select, insert, update on comps to public;

create function pg_temp.armar(p_clave text, p_tipo text, p_lineas jsonb) returns void language plpgsql as $$
declare v_c dominio.comprobantes_venta;
begin
  v_c := public.crear_comprobante(p_tipo, 'a1000000-0000-0000-0000-000000000001', 'c5000000-0000-0000-0000-000000000001', 'mostrador', '2026-10-24');
  insert into comps (clave, id) values (p_clave, v_c.id);
  if p_lineas is not null then
    perform public.guardar_lineas_comprobante(v_c.id, p_lineas, v_c.updated_at);
  end if;
end $$;

create function pg_temp.id_de(p_clave text) returns uuid language sql as $$ select id from comps where clave = p_clave $$;
create function pg_temp.upd(p_clave text) returns timestamptz language sql security definer as $$
  select updated_at from dominio.comprobantes_venta where id = (select id from comps where clave = p_clave) $$;
create function pg_temp.est(p_clave text) returns text language sql security definer as $$
  select estado from dominio.comprobantes_venta where id = (select id from comps where clave = p_clave) $$;
create function pg_temp.disp(p_producto uuid, p_deposito uuid) returns text language sql security definer as $$
  select cantidad || '/' || reservado from dominio.existencias_deposito where producto_id = p_producto and deposito_id = p_deposito $$;
create function pg_temp.eventos(p_tipo text) returns integer language sql security definer as $$
  select count(*)::int from public.registro_actividad where tipo = p_tipo $$;
create function pg_temp.detalle_evento(p_tipo text) returns text language sql security definer as $$
  select detalle from public.registro_actividad where tipo = p_tipo order by creado_en desc limit 1 $$;
create function pg_temp.entradas(p_clave text, p_motivo text) returns integer language sql security definer as $$
  select count(*)::int from dominio.movimientos_stock m
    join dominio.motivos_movimiento mo on mo.id = m.motivo_id and mo.organizacion_id = m.organizacion_id
   where m.tipo = 'entrada' and mo.nombre = p_motivo
     and m.nota like '%' || (select numero from dominio.comprobantes_venta where id = (select id from comps where clave = p_clave)) $$;
grant execute on function pg_temp.upd(text), pg_temp.est(text), pg_temp.disp(uuid, uuid), pg_temp.eventos(text),
  pg_temp.entradas(text, text), pg_temp.id_de(text), pg_temp.detalle_evento(text) to public;

-- ============================================================================
-- Armado: las facturas las vende el Operador (ventas en edición)
-- ============================================================================

select pg_temp.como('f1000000-0000-0000-0000-000000000002');

-- A: Joystick 3 del principal + 2 de Local + Consola a pedido 2 del principal.
select pg_temp.armar('A', 'factura', jsonb_build_array(
  jsonb_build_object('producto_id', 'b1000000-0000-0000-0000-000000000001', 'cantidad', 3, 'deposito_id', (select principal from datos)),
  jsonb_build_object('producto_id', 'b1000000-0000-0000-0000-000000000001', 'cantidad', 2, 'deposito_id', 'd1000000-0000-0000-0000-000000000002'),
  jsonb_build_object('producto_id', 'b1000000-0000-0000-0000-000000000003', 'cantidad', 2, 'deposito_id', (select principal from datos))));
-- B (con nota), C (cobrada), D (permisos/motivo/conflicto/éxito de Administración), E (todo o nada): 1 Cable cada una.
select pg_temp.armar(k, 'factura', jsonb_build_array(
  jsonb_build_object('producto_id', 'b1000000-0000-0000-0000-000000000002', 'cantidad', 1, 'deposito_id', (select principal from datos))))
  from unnest(array['B', 'C', 'D', 'E']) k;
-- F: Consola a pedido 1 (la entrega la descontará).
select pg_temp.armar('F', 'factura', jsonb_build_array(
  jsonb_build_object('producto_id', 'b1000000-0000-0000-0000-000000000003', 'cantidad', 1, 'deposito_id', (select principal from datos))));
select pg_temp.armar('borrador', 'factura', jsonb_build_array(
  jsonb_build_object('producto_id', 'b1000000-0000-0000-0000-000000000002', 'cantidad', 1, 'deposito_id', (select principal from datos))));
select pg_temp.armar('presupuesto', 'presupuesto', null);

select public.confirmar_comprobante(pg_temp.id_de(k)) from unnest(array['A', 'B', 'C', 'D', 'E']) k;

select is(pg_temp.disp('b1000000-0000-0000-0000-000000000001', (select principal from datos)), '7/0', 'A descontó 3 del principal');
select is(pg_temp.disp('b1000000-0000-0000-0000-000000000003', (select principal from datos)), '6/2', 'A reservó 2 de la consola «A pedido»');
select is(pg_temp.disp('b1000000-0000-0000-0000-000000000002', (select principal from datos)), '1/0', 'B, C, D y E descontaron 4 cables');

-- ============================================================================
-- Privilegios y acciones sembradas (FR-048)
-- ============================================================================

select is(has_function_privilege('anon', 'public.anular_comprobante(uuid,text,timestamptz)', 'execute'), false, 'anon no anula');
select is(has_function_privilege('authenticated', 'public.anular_comprobante(uuid,text,timestamptz)', 'execute'), true, 'authenticated ejecuta anular_comprobante');
select is(has_function_privilege('authenticated', 'private.revertir_venta_comprobante(uuid)', 'execute'), false, 'authenticated no ejecuta la reversión interna');
select is(has_function_privilege('authenticated', 'private.devolver_stock_nota_credito(uuid)', 'execute'), false, 'authenticated no ejecuta la devolución interna');
select is(has_function_privilege('authenticated', 'private.motivo_sistema_movimiento(uuid,text,text)', 'execute'), false, 'authenticated no ejecuta el motivo de sistema');

reset role;
select is(
  (select array_agg(rol_id order by rol_id) from public.permisos_rol_accion
    where organizacion_id = '11111111-1111-1111-1111-111111111111' and seccion = 'ventas' and accion = 'anular' and permitido),
  array['administracion', 'administrador']::text[], 'anular sembrado solo para Administrador y Administración'
);
select is(
  (select array_agg(rol_id order by rol_id) from public.permisos_rol_accion
    where organizacion_id = '11111111-1111-1111-1111-111111111111' and seccion = 'ventas' and accion = 'emitir_nota_credito' and permitido),
  array['administracion', 'administrador']::text[], 'emitir_nota_credito sembrado solo para Administrador y Administración'
);
select is(
  (select count(*)::int from public.permisos_rol_accion where seccion <> 'ventas' and accion in ('anular', 'emitir_nota_credito')),
  0, 'anular y emitir_nota_credito existen solo en ventas'
);

-- ============================================================================
-- Permisos verificados en la RPC (FR-048)
-- ============================================================================

select pg_temp.como('f1000000-0000-0000-0000-000000000002');
select throws_ok(format($$select public.anular_comprobante(%L, 'Error de carga', pg_temp.upd('D'))$$, pg_temp.id_de('D')),
  '42501', null, 'el Operador (ventas en edición, sin la acción anular) no anula');
select pg_temp.como('f1000000-0000-0000-0000-000000000005');
select throws_ok(format($$select public.anular_comprobante(%L, 'Error de carga', pg_temp.upd('D'))$$, pg_temp.id_de('D')),
  '42501', null, 'Mostrador no anula');
select pg_temp.como('f1000000-0000-0000-0000-000000000003');
select throws_ok(format($$select public.anular_comprobante(%L, 'Error de carga', pg_temp.upd('D'))$$, pg_temp.id_de('D')),
  '42501', null, 'Consulta (solo lectura) no anula');
select is(pg_temp.est('D'), 'confirmada', 'sin permiso la factura sigue confirmada');

-- ============================================================================
-- Motivo obligatorio y conflicto de edición
-- ============================================================================

select pg_temp.como('f1000000-0000-0000-0000-000000000001');
select throws_ok(format($$select public.anular_comprobante(%L, '   ', pg_temp.upd('D'))$$, pg_temp.id_de('D')),
  '22023', 'Escribí el motivo de la anulación', 'el motivo es obligatorio (en blanco)');
select throws_ok(format($$select public.anular_comprobante(%L, null, pg_temp.upd('D'))$$, pg_temp.id_de('D')),
  '22023', 'Escribí el motivo de la anulación', 'el motivo es obligatorio (nulo)');
select throws_ok(format($$select public.anular_comprobante(%L, %L, pg_temp.upd('D'))$$, pg_temp.id_de('D'), repeat('x', 301)),
  '22023', null, 'el motivo no supera los 300 caracteres');
select throws_ok(format($$select public.anular_comprobante(%L, 'Error de carga', '2000-01-01')$$, pg_temp.id_de('D')),
  '40001', null, 'una fecha de edición vieja es un conflicto (bloqueo optimista)');
select is(pg_temp.est('D'), 'confirmada', 'sin motivo o con conflicto nada cambia');

-- ============================================================================
-- Anulación feliz: reversión exacta por depósito y reservas liberadas (FR-040, FR-041)
-- ============================================================================

select is(
  (select estado from public.anular_comprobante(pg_temp.id_de('A'), '  Cliente equivocado  ', pg_temp.upd('A'))),
  'anulada', 'la factura pasa a anulada'
);
select is(pg_temp.disp('b1000000-0000-0000-0000-000000000001', (select principal from datos)), '10/0', 'el principal recupera exactamente sus 3 joysticks');
select is(pg_temp.disp('b1000000-0000-0000-0000-000000000001', 'd1000000-0000-0000-0000-000000000002'), '4/0', 'Local recupera exactamente sus 2 joysticks');
select is((select cantidad from dominio.existencias where producto_id = 'b1000000-0000-0000-0000-000000000001'), 14, 'el total único del joystick vuelve a 14');
select is(pg_temp.disp('b1000000-0000-0000-0000-000000000003', (select principal from datos)), '6/0', '«A pedido»: la reserva se libera y la cantidad no cambia');
select is((select reservado from dominio.existencias where producto_id = 'b1000000-0000-0000-0000-000000000003'), 0, 'el total reservado de la consola vuelve a 0');
select is(
  (select estado from dominio.reservas_stock where referencia like 'comprobante:' || pg_temp.id_de('A') || ':linea:%'),
  'liberada', 'la reserva queda liberada'
);
select is(pg_temp.entradas('A', 'Anulación de factura'), 2, 'dos entradas con motivo «Anulación de factura» (una por línea de stock), ninguna para «A pedido»');
select is(
  (select (anulado_en is not null and anulado_por = 'f1000000-0000-0000-0000-000000000001' and motivo_anulacion = 'Cliente equivocado')::text
     from dominio.comprobantes_venta where id = pg_temp.id_de('A')),
  'true', 'guarda quién, cuándo y el motivo (sin espacios sobrantes)'
);
select is(pg_temp.eventos('comprobante.anulado'), 1, 'registra el evento comprobante.anulado');
select is(
  pg_temp.detalle_evento('comprobante.anulado'),
  'Anuló la factura ' || (select numero from dominio.comprobantes_venta where id = pg_temp.id_de('A')) || ': Cliente equivocado',
  'el evento lleva el número y el motivo'
);

-- ============================================================================
-- Idempotencia y número no reutilizado
-- ============================================================================

select lives_ok(format($$select public.anular_comprobante(%L, 'Otro motivo', pg_temp.upd('A'))$$, pg_temp.id_de('A')), 'reintentar sobre una anulada no falla');
select is(pg_temp.disp('b1000000-0000-0000-0000-000000000001', (select principal from datos)), '10/0', 'el reintento no revierte dos veces');
select is(pg_temp.entradas('A', 'Anulación de factura'), 2, 'el reintento no duplica las entradas');
select is(pg_temp.eventos('comprobante.anulado'), 1, 'el reintento no repite el evento');
select is(
  (select motivo_anulacion from dominio.comprobantes_venta where id = pg_temp.id_de('A')),
  'Cliente equivocado', 'el reintento no pisa el motivo original'
);

select pg_temp.como('f1000000-0000-0000-0000-000000000002');
select pg_temp.armar('nueva', 'factura', null);
select ok(
  (select n.numero_entero > a.numero_entero from dominio.comprobantes_venta n, dominio.comprobantes_venta a
    where n.id = pg_temp.id_de('nueva') and a.id = pg_temp.id_de('A')),
  'la factura siguiente no reutiliza el número de la anulada'
);
select is(
  (select count(*)::int from dominio.comprobantes_venta where id = pg_temp.id_de('A') and estado = 'anulada'),
  1, 'la anulada sigue existiendo (no se borra nada)'
);

-- ============================================================================
-- Bloqueos: nota, cobro, anulada, borrador, presupuesto, nota de crédito
-- ============================================================================

select pg_temp.como('f1000000-0000-0000-0000-000000000001');
select lives_ok(
  format($$select public.emitir_nota_credito(%L, 'devolucion_importe', '[{"importe_sin_iva": 100}]'::jsonb, 'Ajuste comercial')$$, pg_temp.id_de('B')),
  'se emite una nota de crédito sobre B'
);
select throws_ok(format($$select public.anular_comprobante(%L, 'Error de carga', pg_temp.upd('B'))$$, pg_temp.id_de('B')),
  '55000', null, 'una factura con nota de crédito no se anula (se corrige con otra nota)');
select is(pg_temp.est('B'), 'confirmada', 'B sigue confirmada');

reset role;
update dominio.comprobantes_venta set estado = 'cobrado' where id = pg_temp.id_de('C');
select pg_temp.como('f1000000-0000-0000-0000-000000000001');
select throws_ok(format($$select public.anular_comprobante(%L, 'Error de carga', pg_temp.upd('C'))$$, pg_temp.id_de('C')),
  '55000', null, 'una factura cobrada no se anula (se corrige con nota de crédito)');
select is(pg_temp.est('C'), 'cobrado', 'C sigue cobrada');
select is(pg_temp.disp('b1000000-0000-0000-0000-000000000002', (select principal from datos)), '1/0', 'los bloqueos no devolvieron stock');

select throws_ok(format($$select public.anular_comprobante(%L, 'Error de carga', pg_temp.upd('borrador'))$$, pg_temp.id_de('borrador')),
  '55000', null, 'un borrador no se anula');
select throws_ok(format($$select public.anular_comprobante(%L, 'Error de carga', pg_temp.upd('presupuesto'))$$, pg_temp.id_de('presupuesto')),
  '22023', null, 'un presupuesto no se anula');
select throws_ok(
  format($$select public.anular_comprobante((select id from dominio.comprobantes_venta where tipo = 'nota_credito' and comprobante_origen_id = %L), 'Error de carga', now())$$, pg_temp.id_de('B')),
  '22023', null, 'una nota de crédito no se anula'
);

-- ============================================================================
-- Administración anula (acción `anular` por su rol en la tienda)
-- ============================================================================

select pg_temp.como('f1000000-0000-0000-0000-000000000004');
select is(
  (select estado from public.anular_comprobante(pg_temp.id_de('D'), 'Se cargó dos veces', pg_temp.upd('D'))),
  'anulada', 'Administración anula'
);
select is(pg_temp.disp('b1000000-0000-0000-0000-000000000002', (select principal from datos)), '2/0', 'D devolvió su cable al depósito');

-- ============================================================================
-- «A pedido» ya descontada por la entrega: la mercadería vuelve con una entrada
-- ============================================================================

select pg_temp.como('f1000000-0000-0000-0000-000000000002');
select public.confirmar_comprobante(pg_temp.id_de('F'));
select is(pg_temp.disp('b1000000-0000-0000-0000-000000000003', (select principal from datos)), '6/1', 'F reservó 1 consola');
reset role;
-- La entrega (MSF-135) descuenta la reserva: baja la cantidad y el reservado.
update dominio.reservas_stock set estado = 'descontada', resuelto_en = now()
 where referencia like 'comprobante:' || pg_temp.id_de('F') || ':linea:%';
update dominio.existencias_deposito set cantidad = cantidad - 1, reservado = reservado - 1
 where producto_id = 'b1000000-0000-0000-0000-000000000003' and deposito_id = (select principal from datos);
update dominio.existencias set cantidad = cantidad - 1, reservado = reservado - 1
 where producto_id = 'b1000000-0000-0000-0000-000000000003';
select pg_temp.como('f1000000-0000-0000-0000-000000000001');
select lives_ok(format($$select public.anular_comprobante(%L, 'Entrega rechazada', pg_temp.upd('F'))$$, pg_temp.id_de('F')), 'se anula F con la reserva ya descontada');
select is(pg_temp.disp('b1000000-0000-0000-0000-000000000003', (select principal from datos)), '6/0', 'la consola entregada vuelve al depósito');
select is(pg_temp.entradas('F', 'Anulación de factura'), 1, 'una entrada para la línea ya descontada');

-- ============================================================================
-- Todo o nada (FR-041): si la reversión falla, nada cambia
-- ============================================================================

reset role;
update dominio.motivos_movimiento set activo = false
 where organizacion_id = '11111111-1111-1111-1111-111111111111' and nombre = 'Anulación de factura';
select pg_temp.como('f1000000-0000-0000-0000-000000000001');
select throws_ok(format($$select public.anular_comprobante(%L, 'Error de carga', pg_temp.upd('E'))$$, pg_temp.id_de('E')),
  '22023', null, 'con el motivo de sistema inactivo la anulación falla');
select is(pg_temp.est('E'), 'confirmada', 'todo o nada: E sigue confirmada');
select is(pg_temp.disp('b1000000-0000-0000-0000-000000000002', (select principal from datos)), '2/0', 'todo o nada: el stock no se movió');
select is((select anulado_en is null from dominio.comprobantes_venta where id = pg_temp.id_de('E')), true, 'todo o nada: sin marca de anulación');

-- ============================================================================
-- Aislamiento y anon
-- ============================================================================

select pg_temp.como('f2000000-0000-0000-0000-000000000001');
select throws_ok(format($$select public.anular_comprobante(%L, 'Error de carga', now())$$, pg_temp.id_de('E')),
  'P0002', null, 'otra organización no ve el comprobante');
reset role;
set local role anon;
select throws_ok(format($$select public.anular_comprobante(%L, 'Error de carga', now())$$, pg_temp.id_de('E')),
  '42501', null, 'anon no ejecuta la RPC');
reset role;

select * from finish();
rollback;
