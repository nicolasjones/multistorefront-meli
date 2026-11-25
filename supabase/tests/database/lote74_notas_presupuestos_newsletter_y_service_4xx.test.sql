-- Lote 74 (MSF-599, MSF-654 y MSF-655, undécima ola): las RPC de notas de crédito, presupuestos, cotización del dólar, newsletter
-- y Service técnico contestan `PT404` (HTTP 404) cuando el dato no existe, `PT412` (HTTP 412) ante un conflicto de edición y
-- `PT409` (HTTP 409) cuando el estado o la regla de negocio no admite la acción (antes `P0002`, `40001` y `55000`, HTTP 500), con
-- el mismo mensaje de negocio de siempre. Cada afirmación comprueba código y mensaje; hay al menos una por función migrada.
-- Se comprueba también lo que NO cambia (bandera apagada y tienda inexistente del newsletter).
-- Fixture como postgres; verificaciones como «authenticated» con request.jwt.claims, igual que PostgREST.
begin;

select plan(45);

insert into organizaciones (id, nombre) values
  ('11111111-1111-1111-1111-111111111111', 'Organización Uno'),
  ('22222222-2222-2222-2222-222222222222', 'Organización Dos');
insert into auth.users (id, email) values
  ('d1000000-0000-0000-0000-000000000001', 'admin-uno@example.com'),
  ('d2000000-0000-0000-0000-000000000001', 'admin-dos@example.com');
insert into usuarios_organizacion (user_id, organizacion_id, rol_id, estado) values
  ('d1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'administrador', 'activo'),
  ('d2000000-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', 'administrador', 'activo');
insert into dominio.empresas (id, organizacion_id, nombre, activa) values
  ('e1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'San Javucho', true),
  ('e2000000-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', 'Tienda Dos', true);
insert into dominio.clientes (id, organizacion_id, numero, nombre, tipo) values
  ('c1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 10, 'Cliente Uno', 'minorista');

-- Newsletter: tienda con dominio, interruptor encendido, un suscriptor confirmado y tres borradores (el primero se envía abajo).
insert into dominio.tiendas (organizacion_id, empresa_id, dominio) values
  ('11111111-1111-1111-1111-111111111111', 'e1000000-0000-0000-0000-000000000001', 'lote74.ejemplo.com');
insert into dominio.newsletter_configuracion (empresa_id, organizacion_id, activo) values
  ('e1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', true);
insert into dominio.newsletter_suscriptores (id, organizacion_id, empresa_id, correo, estado, version_consentimiento, baja_en, creado_en) values
  ('51000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'e1000000-0000-0000-0000-000000000001', 'ana@ejemplo.com', 'confirmado', 'v1', null, now() - interval '5 hours');
insert into dominio.newsletters (id, organizacion_id, empresa_id, nombre_interno, asunto, mensaje, incluir_destacados, incluir_promociones) values
  ('b1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'e1000000-0000-0000-0000-000000000001', 'Enviado', 'Novedades', 'Hola a todos', false, false),
  ('b1000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'e1000000-0000-0000-0000-000000000001', 'Borrador', 'Borrador', 'Hola borrador', false, false);

create function pg_temp.como(p_user uuid) returns void language plpgsql as $$
begin
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
  set local role authenticated;
end $$;
grant execute on function pg_temp.como(uuid) to public;
create temp table datos as
  select
    (select id from dominio.modelos_equipo where organizacion_id = '11111111-1111-1111-1111-111111111111' and equipo = 'Nintendo Switch' and modelo = 'Estándar') as modelo_uno,
    (select id from dominio.estados_reparacion where organizacion_id = '11111111-1111-1111-1111-111111111111' and nombre = 'En diagnóstico') as diagnostico,
    (select id from dominio.estados_reparacion where organizacion_id = '11111111-1111-1111-1111-111111111111' and cierra order by orden limit 1) as cierra_uno;
grant select on datos to public;
create temp table reps (clave text primary key, id uuid);
grant select, insert on reps to public;

-- Bandera apagada: sigue con 55000 (falla de configuración del entorno, no una regla de negocio de la persona).
select pg_temp.como('d1000000-0000-0000-0000-000000000001');
select throws_ok($$select public.enviar_newsletter('b1000000-0000-0000-0000-000000000001', 1, 'aaaaaaaa-0000-0000-0000-000000000001')$$,
  '55000', 'El newsletter no está habilitado en este entorno', 'enviar_newsletter: con la bandera apagada sigue con 55000');
select throws_ok($$select public.guardar_newsletter(null, null, 'e1000000-0000-0000-0000-000000000001', 'N', 'A', 'B', false, false)$$,
  '55000', 'El newsletter no está habilitado en este entorno', 'guardar_newsletter: con la bandera apagada sigue con 55000');
reset role;
update public.banderas_plataforma set activa = true where clave = 'newsletter';
select pg_temp.como('d1000000-0000-0000-0000-000000000001');

-- ============================================================================
-- Notas de crédito, presupuestos y cotización
-- ============================================================================
select throws_ok($$select public.emitir_nota_credito('ffffffff-0000-0000-0000-000000000000', 'devolucion_importe', '[{"importe_sin_iva": 100}]'::jsonb, 'Ajuste')$$,
  'PT404', 'La factura no existe', 'emitir_nota_credito: una factura inexistente responde 404');
select throws_ok($$select public.detalle_anulacion_nota_credito('ffffffff-0000-0000-0000-000000000000')$$,
  'PT404', 'El comprobante no existe', 'detalle_anulacion_nota_credito: un comprobante inexistente responde 404');
select throws_ok($$select public.facturar_presupuesto('ffffffff-0000-0000-0000-000000000000')$$,
  'PT404', 'El presupuesto no existe', 'facturar_presupuesto: un presupuesto inexistente responde 404');
select throws_ok($$select public.confirmar_cotizacion()$$,
  'PT404', 'sin_cotizacion_pendiente', 'confirmar_cotizacion: sin cotización pendiente responde 404');

-- ============================================================================
-- Newsletter
-- ============================================================================
select throws_ok($$select public.detalle_newsletter('ffffffff-0000-0000-0000-000000000000')$$,
  'PT404', 'El newsletter no existe', 'detalle_newsletter: un newsletter inexistente responde 404');
select throws_ok($$select public.descartar_newsletter('ffffffff-0000-0000-0000-000000000000')$$,
  'PT404', 'El newsletter no existe', 'descartar_newsletter: un newsletter inexistente responde 404');
select throws_ok($$select public.cancelar_envio_newsletter('ffffffff-0000-0000-0000-000000000000')$$,
  'PT404', 'El newsletter no existe', 'cancelar_envio_newsletter: un newsletter inexistente responde 404');
select throws_ok($$select public.enviar_newsletter('ffffffff-0000-0000-0000-000000000000', 1, 'aaaaaaaa-0000-0000-0000-000000000009')$$,
  'PT404', 'El newsletter no existe', 'enviar_newsletter: un newsletter inexistente responde 404');
select throws_ok($$select public.guardar_newsletter('ffffffff-0000-0000-0000-000000000000', 1, 'e1000000-0000-0000-0000-000000000001', 'N', 'A', 'B', false, false)$$,
  'PT404', 'El newsletter no existe', 'guardar_newsletter: un borrador inexistente responde 404');
select throws_ok($$select public.guardar_newsletter(null, null, 'ffffffff-0000-0000-0000-000000000000', 'N', 'A', 'B', false, false)$$,
  'P0002', 'La tienda no existe', 'guardar_newsletter: una tienda inexistente sigue con P0002 (la lanza un auxiliar de private)');
select throws_ok($$select public.dar_de_baja_suscriptor_newsletter('ffffffff-0000-0000-0000-000000000000')$$,
  'PT404', 'El suscriptor no existe', 'dar_de_baja_suscriptor_newsletter: un suscriptor inexistente responde 404');
select throws_ok($$select public.borrar_datos_suscriptor_newsletter('ffffffff-0000-0000-0000-000000000000')$$,
  'PT404', 'El suscriptor no existe', 'borrar_datos_suscriptor_newsletter: un suscriptor inexistente responde 404');

select throws_ok($$select public.enviar_newsletter('b1000000-0000-0000-0000-000000000002', 7, 'aaaaaaaa-0000-0000-0000-000000000002')$$,
  'PT412', 'El borrador cambió: recargá para ver la última versión', 'enviar_newsletter: una versión vieja es un conflicto (412)');
select throws_ok($$select public.guardar_newsletter('b1000000-0000-0000-0000-000000000002', 7, 'e1000000-0000-0000-0000-000000000001', 'N', 'A', 'B', false, false)$$,
  'PT412', 'El borrador cambió: recargá para ver la última versión', 'guardar_newsletter: una versión vieja es un conflicto (412)');
select throws_ok($$select public.cancelar_envio_newsletter('b1000000-0000-0000-0000-000000000002')$$,
  'PT409', 'El newsletter todavía no se envió', 'cancelar_envio_newsletter: un borrador no se cancela (409)');

-- Se envía el primero: a partir de ahí no se reenvía con otra clave, no se edita y no se descarta.
select lives_ok($$select public.enviar_newsletter('b1000000-0000-0000-0000-000000000001', 1, 'aaaaaaaa-0000-0000-0000-000000000001')$$,
  'se envía el primer newsletter');
select throws_ok($$select public.enviar_newsletter('b1000000-0000-0000-0000-000000000001', 2, 'aaaaaaaa-0000-0000-0000-000000000099')$$,
  'PT409', 'Este newsletter ya se envió', 'enviar_newsletter: otra clave sobre un envío cerrado es un estado (409)');
select throws_ok($$select public.guardar_newsletter('b1000000-0000-0000-0000-000000000001', 2, 'e1000000-0000-0000-0000-000000000001', 'N', 'A', 'B', false, false)$$,
  'PT409', 'Un newsletter enviado no se puede editar', 'guardar_newsletter: un enviado no se edita (409)');
select throws_ok($$select public.descartar_newsletter('b1000000-0000-0000-0000-000000000001')$$,
  'PT409', 'Un newsletter enviado no se puede descartar', 'descartar_newsletter: un enviado no se descarta (409)');

-- Otra organización: no ve nada (mismo código y mensaje que si no existiera).
select pg_temp.como('d2000000-0000-0000-0000-000000000001');
select throws_ok($$select public.detalle_newsletter('b1000000-0000-0000-0000-000000000001')$$,
  'PT404', 'El newsletter no existe', 'detalle_newsletter: otra organización no ve el newsletter (404)');
select throws_ok($$select public.cancelar_envio_newsletter('b1000000-0000-0000-0000-000000000001')$$,
  'PT404', 'El newsletter no existe', 'cancelar_envio_newsletter: otra organización no ve el newsletter (404)');
select throws_ok($$select public.dar_de_baja_suscriptor_newsletter('51000000-0000-0000-0000-000000000001')$$,
  'PT404', 'El suscriptor no existe', 'dar_de_baja_suscriptor_newsletter: otra organización no ve al suscriptor (404)');
select throws_ok($$select public.borrar_datos_suscriptor_newsletter('51000000-0000-0000-0000-000000000001')$$,
  'PT404', 'El suscriptor no existe', 'borrar_datos_suscriptor_newsletter: otra organización no ve al suscriptor (404)');

-- ============================================================================
-- Service técnico
-- ============================================================================
select pg_temp.como('d1000000-0000-0000-0000-000000000001');
insert into reps (clave, id)
select 'entregada', (public.crear_reparacion('e1000000-0000-0000-0000-000000000001', 'c1000000-0000-0000-0000-000000000001', (select modelo_uno from datos))->>'id')::uuid;
insert into reps (clave, id)
select 'anulada', (public.crear_reparacion('e1000000-0000-0000-0000-000000000001', 'c1000000-0000-0000-0000-000000000001', (select modelo_uno from datos))->>'id')::uuid;
insert into reps (clave, id)
select 'abierta', (public.crear_reparacion('e1000000-0000-0000-0000-000000000001', 'c1000000-0000-0000-0000-000000000001', (select modelo_uno from datos))->>'id')::uuid;

select lives_ok($$select public.registrar_entrega_reparacion((select id from reps where clave = 'entregada'), (select cierra_uno from datos), (now() at time zone 'America/Argentina/Buenos_Aires')::date, 'María Pérez')$$,
  'se entrega la primera reparación');
select lives_ok($$select public.anular_reparacion((select id from reps where clave = 'anulada'), 'Cliente desistió')$$,
  'se anula la segunda reparación');

select throws_ok($$select public.actualizar_reparacion(gen_random_uuid(), now(), 'c1000000-0000-0000-0000-000000000001', (select modelo_uno from datos))$$,
  'PT404', 'La reparación no existe', 'actualizar_reparacion: una reparación inexistente responde 404');
select throws_ok($$select public.anular_reparacion(gen_random_uuid(), 'x')$$,
  'PT404', 'La reparación no existe', 'anular_reparacion: una reparación inexistente responde 404');
select throws_ok($$select public.cambiar_estado_reparacion(gen_random_uuid(), (select diagnostico from datos))$$,
  'PT404', 'La reparación no existe', 'cambiar_estado_reparacion: una reparación inexistente responde 404');
select throws_ok($$select public.registrar_entrega_reparacion(gen_random_uuid(), (select cierra_uno from datos), current_date, 'x')$$,
  'PT404', 'La reparación no existe', 'registrar_entrega_reparacion: una reparación inexistente responde 404');
select throws_ok($$select public.generar_comprobante_reparacion(gen_random_uuid())$$,
  'PT404', 'La reparación no existe', 'generar_comprobante_reparacion: una reparación inexistente responde 404');
select throws_ok($$select public.reingresar_por_garantia(gen_random_uuid(), 'Falla')$$,
  'PT404', 'La reparación no existe', 'reingresar_por_garantia: una reparación inexistente responde 404');

select throws_ok($$select public.actualizar_reparacion((select id from reps where clave = 'abierta'), timestamptz '2000-01-01', 'c1000000-0000-0000-0000-000000000001', (select modelo_uno from datos))$$,
  'PT412', 'La reparación fue modificada por otra persona', 'actualizar_reparacion: una versión vieja es un conflicto (412)');
select throws_ok($$select public.actualizar_reparacion((select id from reps where clave = 'anulada'), (public.obtener_reparacion((select id from reps where clave = 'anulada'))->>'updated_at')::timestamptz, 'c1000000-0000-0000-0000-000000000001', (select modelo_uno from datos))$$,
  'PT409', 'La reparación está anulada y no se puede editar', 'actualizar_reparacion: una anulada no se edita (409)');
select throws_ok($$select public.anular_reparacion((select id from reps where clave = 'anulada'), 'Otra vez')$$,
  'PT409', 'La reparación ya está anulada', 'anular_reparacion: una anulada no se anula otra vez (409)');
select throws_ok($$select public.cambiar_estado_reparacion((select id from reps where clave = 'anulada'), (select diagnostico from datos))$$,
  'PT409', 'La reparación está anulada y no se puede modificar', 'cambiar_estado_reparacion: una anulada no cambia de estado (409)');
select throws_ok($$select public.cambiar_estado_reparacion((select id from reps where clave = 'entregada'), (select diagnostico from datos))$$,
  'PT409', 'La reparación ya fue entregada o cerrada y no admite más cambios de estado', 'cambiar_estado_reparacion: una entregada no cambia de estado (409)');
select throws_ok($$select public.registrar_entrega_reparacion((select id from reps where clave = 'anulada'), (select cierra_uno from datos), current_date, 'Juan')$$,
  'PT409', 'La reparación está anulada y no se puede modificar', 'registrar_entrega_reparacion: una anulada no se entrega (409)');
select throws_ok($$select public.registrar_entrega_reparacion((select id from reps where clave = 'entregada'), (select cierra_uno from datos), current_date, 'Otro')$$,
  'PT409', 'La reparación ya fue entregada o cerrada', 'registrar_entrega_reparacion: una entregada no se entrega dos veces (409)');
select throws_ok($$select public.generar_comprobante_reparacion((select id from reps where clave = 'anulada'))$$,
  'PT409', 'La reparación está anulada: no se puede generar su comprobante', 'generar_comprobante_reparacion: una anulada no genera comprobante (409)');
select throws_ok($$select public.reingresar_por_garantia((select id from reps where clave = 'anulada'), 'Falla')$$,
  'PT409', 'La reparación está anulada: no se puede reingresar por garantía', 'reingresar_por_garantia: una anulada no se reingresa (409)');
select throws_ok($$select public.reingresar_por_garantia((select id from reps where clave = 'abierta'), 'Falla')$$,
  'PT409', 'Solo se puede reingresar por garantía una reparación entregada', 'reingresar_por_garantia: una no entregada no se reingresa (409)');

-- Otra organización: la reparación no existe para ella.
select pg_temp.como('d2000000-0000-0000-0000-000000000001');
select throws_ok($$select public.anular_reparacion((select id from reps where clave = 'abierta'), 'x')$$,
  'PT404', 'La reparación no existe', 'anular_reparacion: otra organización no ve la reparación (404)');

-- Lo que no cambia: los auxiliares de private siguen con su código (ítems de una reparación).
select pg_temp.como('d1000000-0000-0000-0000-000000000001');
select throws_ok($$select public.quitar_item_reparacion(gen_random_uuid())$$,
  'P0002', 'El ítem no existe', 'quitar_item_reparacion: no se toca en esta ola (sigue con P0002)');

select * from finish();
rollback;
