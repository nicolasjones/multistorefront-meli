-- F-API-01 (MSF-233) · seguimientos MSF-836, MSF-837 y MSF-838:
--   836 · la purga diaria borra los eventos terminados viejos y respeta lo que sigue vivo;
--   837 · private.api_entregas_salud cuenta entregas agotadas y entregas o eventos atrasados;
--   838 · el Administrador reintenta una entrega agotada de su organización.
begin;

select no_plan();

insert into organizaciones (id, nombre) values
  ('a4000000-0000-0000-0000-000000000001', 'Organización seguimientos A'),
  ('a4000000-0000-0000-0000-000000000002', 'Organización seguimientos B');

insert into auth.users (id, email) values
  ('f4000000-0000-0000-0000-000000000001', 'admin-seg-a@example.com'),
  ('f4000000-0000-0000-0000-000000000002', 'miembro-seg-a@example.com'),
  ('f4000000-0000-0000-0000-000000000003', 'admin-seg-b@example.com');

insert into usuarios_organizacion (user_id, organizacion_id, rol_id, estado) values
  ('f4000000-0000-0000-0000-000000000001', 'a4000000-0000-0000-0000-000000000001', 'administrador', 'activo'),
  ('f4000000-0000-0000-0000-000000000002', 'a4000000-0000-0000-0000-000000000001', 'miembro', 'activo'),
  ('f4000000-0000-0000-0000-000000000003', 'a4000000-0000-0000-0000-000000000002', 'administrador', 'activo');

insert into public.api_suscripciones (id, organizacion_id, url, tipos, secreto_vault_id) values
  ('d4000000-0000-0000-0000-000000000001', 'a4000000-0000-0000-0000-000000000001', 'https://ejemplo.com/seg', array['stock.actualizado'], gen_random_uuid());

-- ============================================================================
-- 836 · Purga de eventos terminados
-- ============================================================================

insert into public.cola_eventos (id, organizacion_id, tipo, clave_idempotencia, carga, estado, created_at, updated_at) values
  -- completado hace 100 días, con una entrega terminada: se purga junto con su entrega
  ('e4000000-0000-0000-0000-000000000001', 'a4000000-0000-0000-0000-000000000001', 'stock.actualizado', 'seg-1', '{}', 'completada', now() - interval '100 days', now() - interval '100 days'),
  -- completado hace 100 días pero con una entrega pendiente: se queda
  ('e4000000-0000-0000-0000-000000000002', 'a4000000-0000-0000-0000-000000000001', 'stock.actualizado', 'seg-2', '{}', 'completada', now() - interval '100 days', now() - interval '100 days'),
  -- completado hace 10 días: se queda
  ('e4000000-0000-0000-0000-000000000003', 'a4000000-0000-0000-0000-000000000001', 'stock.actualizado', 'seg-3', '{}', 'completada', now() - interval '10 days', now() - interval '10 days'),
  -- agotado hace 100 días y sin entregas: se purga
  ('e4000000-0000-0000-0000-000000000004', 'a4000000-0000-0000-0000-000000000001', 'precio.actualizado', 'seg-4', '{}', 'agotada', now() - interval '100 days', now() - interval '100 days'),
  -- pendiente hace 100 días: se queda (todavía hay que repartirlo)
  ('e4000000-0000-0000-0000-000000000005', 'a4000000-0000-0000-0000-000000000001', 'venta.registrada', 'seg-5', '{}', 'pendiente', now() - interval '100 days', now() - interval '100 days');

insert into public.api_entregas (id, organizacion_id, evento_id, suscripcion_id, estado, intentos, creada_en, actualizada_en) values
  ('c4000000-0000-0000-0000-000000000001', 'a4000000-0000-0000-0000-000000000001', 'e4000000-0000-0000-0000-000000000001', 'd4000000-0000-0000-0000-000000000001', 'completada', 1, now() - interval '100 days', now() - interval '100 days'),
  ('c4000000-0000-0000-0000-000000000002', 'a4000000-0000-0000-0000-000000000001', 'e4000000-0000-0000-0000-000000000002', 'd4000000-0000-0000-0000-000000000001', 'pendiente', 0, now() - interval '100 days', now() - interval '100 days');

select lives_ok($$select private.purgar_api_llamadas(90)$$, 'la purga corre');

select is(
  (select array_agg(id::text order by id) from public.cola_eventos where clave_idempotencia like 'seg-%'),
  array['e4000000-0000-0000-0000-000000000002', 'e4000000-0000-0000-0000-000000000003', 'e4000000-0000-0000-0000-000000000005'],
  'la purga borra el evento completado y el agotado viejos y deja el que tiene entrega viva, el reciente y el pendiente');

select is(
  (select count(*)::int from public.api_entregas where id = 'c4000000-0000-0000-0000-000000000001'),
  0, 'la entrega terminada se va con su evento');

select is(
  (select count(*)::int from public.api_entregas where id = 'c4000000-0000-0000-0000-000000000002'),
  1, 'la entrega pendiente sigue y protege a su evento');

select lives_ok($$select private.purgar_api_llamadas(90)$$, 'una segunda pasada no falla');
select is((select count(*)::int from public.cola_eventos where clave_idempotencia like 'seg-%'), 3, 'y no borra nada más (idempotente)');

select throws_ok($$select private.purgar_api_llamadas(0)$$, '22023', 'RETENCION_INVALIDA', 'una retención inválida se rechaza');

-- ============================================================================
-- 837 · Salud de las entregas
-- ============================================================================

create temporary table base_salud as select * from private.api_entregas_salud(60, 30);

insert into public.cola_eventos (id, organizacion_id, tipo, clave_idempotencia, carga, estado, proximo_intento_en) values
  ('e4000000-0000-0000-0000-000000000010', 'a4000000-0000-0000-0000-000000000001', 'stock.actualizado', 'salud-1', '{}', 'pendiente', now() - interval '2 hours'),
  ('e4000000-0000-0000-0000-000000000011', 'a4000000-0000-0000-0000-000000000001', 'stock.actualizado', 'salud-2', '{}', 'pendiente', now() + interval '1 hour'),
  ('e4000000-0000-0000-0000-000000000012', 'a4000000-0000-0000-0000-000000000001', 'stock.actualizado', 'salud-3', '{}', 'completada', now() - interval '2 hours'),
  ('e4000000-0000-0000-0000-000000000013', 'a4000000-0000-0000-0000-000000000001', 'stock.actualizado', 'salud-4', '{}', 'completada', now()),
  ('e4000000-0000-0000-0000-000000000014', 'a4000000-0000-0000-0000-000000000001', 'stock.actualizado', 'salud-5', '{}', 'completada', now());

insert into public.api_entregas (id, organizacion_id, evento_id, suscripcion_id, estado, intentos, proximo_intento_en, actualizada_en) values
  -- agotada hace poco (cuenta) y agotada hace 3 horas (no cuenta en una ventana de 60 minutos)
  ('c4000000-0000-0000-0000-000000000010', 'a4000000-0000-0000-0000-000000000001', 'e4000000-0000-0000-0000-000000000012', 'd4000000-0000-0000-0000-000000000001', 'agotada', 5, now() - interval '3 hours', now()),
  ('c4000000-0000-0000-0000-000000000011', 'a4000000-0000-0000-0000-000000000001', 'e4000000-0000-0000-0000-000000000013', 'd4000000-0000-0000-0000-000000000001', 'agotada', 5, now() - interval '3 hours', now() - interval '3 hours'),
  -- pendiente que debió enviarse hace 2 horas (atrasada) y pendiente al día
  ('c4000000-0000-0000-0000-000000000012', 'a4000000-0000-0000-0000-000000000001', 'e4000000-0000-0000-0000-000000000014', 'd4000000-0000-0000-0000-000000000001', 'pendiente', 0, now() - interval '2 hours', now());

select is((select agotadas from private.api_entregas_salud(60, 30)) - (select agotadas from base_salud), 1::bigint,
  'cuenta solo la entrega agotada dentro de la ventana');
select is((select entregas_atrasadas from private.api_entregas_salud(60, 30)) - (select entregas_atrasadas from base_salud), 1::bigint,
  'cuenta la entrega pendiente atrasada y no la que está al día');
select is((select eventos_atrasados from private.api_entregas_salud(60, 30)) - (select eventos_atrasados from base_salud), 1::bigint,
  'cuenta el evento pendiente atrasado y no el que espera su turno ni el completado');
select throws_ok($$select * from private.api_entregas_salud(0, 30)$$, '22023', 'PARAMETRO_INVALIDO', 'una ventana inválida se rechaza');

-- ============================================================================
-- 838 · Reintento manual
-- ============================================================================

insert into public.api_entregas (id, organizacion_id, evento_id, suscripcion_id, estado, intentos, ultimo_error_sanitizado, ultimo_estado_http)
select 'c4000000-0000-0000-0000-000000000020', 'a4000000-0000-0000-0000-000000000001', 'e4000000-0000-0000-0000-000000000003',
       'd4000000-0000-0000-0000-000000000001', 'agotada', 5, 'El destino respondió 500', 500;

select set_config('request.jwt.claims',
  json_build_object('sub', 'f4000000-0000-0000-0000-000000000001', 'role', 'authenticated')::text, true);
set local role authenticated;

select lives_ok($$select public.reintentar_entrega_api('c4000000-0000-0000-0000-000000000020')$$, 'el Administrador reintenta una entrega agotada');

reset role;

select is((select estado from public.api_entregas where id = 'c4000000-0000-0000-0000-000000000020'), 'pendiente', 'la entrega vuelve a la cola');
select is((select intentos from public.api_entregas where id = 'c4000000-0000-0000-0000-000000000020'), 0, 'con sus 5 intentos de nuevo');
select is((select ultimo_error_sanitizado from public.api_entregas where id = 'c4000000-0000-0000-0000-000000000020'), 'El destino respondió 500', 'y conserva el último error para ver qué falló');
select ok((select proximo_intento_en <= now() from public.api_entregas where id = 'c4000000-0000-0000-0000-000000000020'), 'lista para enviarse ya');

set local role authenticated;
select throws_ok($$select public.reintentar_entrega_api('c4000000-0000-0000-0000-000000000020')$$, 'P0002', 'La entrega no existe o no está agotada',
  'una entrega que ya no está agotada no se puede reintentar');
select throws_ok($$select public.reintentar_entrega_api('c4000000-0000-0000-0000-0000000000ff')$$, 'P0002', 'La entrega no existe o no está agotada',
  'una entrega inexistente tampoco');
reset role;

-- Otra organización y un rol sin permiso de escritura no pueden reintentar.
update public.api_entregas set estado = 'agotada', intentos = 5 where id = 'c4000000-0000-0000-0000-000000000020';

select set_config('request.jwt.claims',
  json_build_object('sub', 'f4000000-0000-0000-0000-000000000003', 'role', 'authenticated')::text, true);
set local role authenticated;
select throws_ok($$select public.reintentar_entrega_api('c4000000-0000-0000-0000-000000000020')$$, 'P0002', 'La entrega no existe o no está agotada',
  'el Administrador de otra organización no ve ni reintenta la entrega');
reset role;

select set_config('request.jwt.claims',
  json_build_object('sub', 'f4000000-0000-0000-0000-000000000002', 'role', 'authenticated')::text, true);
set local role authenticated;
select throws_ok($$select public.reintentar_entrega_api('c4000000-0000-0000-0000-000000000020')$$, '42501', 'Solo un administrador puede reintentar entregas de avisos',
  'un miembro sin permiso de escritura no puede reintentar');
reset role;

select is((select estado from public.api_entregas where id = 'c4000000-0000-0000-0000-000000000020'), 'agotada', 'las entregas rechazadas no se tocaron');

-- ============================================================================
-- Privilegios
-- ============================================================================

select is(has_function_privilege('anon', 'public.reintentar_entrega_api(uuid)', 'EXECUTE'), false, 'anon no reintenta entregas');
select is(has_function_privilege('authenticated', 'public.reintentar_entrega_api(uuid)', 'EXECUTE'), true, 'authenticated sí (la RPC valida el rol)');
select is(has_function_privilege('authenticated', 'private.api_entregas_salud(integer, integer)', 'EXECUTE'), false, 'authenticated no lee la salud del pipeline');
select is(has_function_privilege('anon', 'private.api_entregas_salud(integer, integer)', 'EXECUTE'), false, 'anon tampoco');
select is(has_function_privilege('kestra_orquestacion', 'private.api_entregas_salud(integer, integer)', 'EXECUTE'), true, 'Kestra sí');
select is(has_function_privilege('kestra_orquestacion', 'private.purgar_api_llamadas(integer)', 'EXECUTE'), true, 'Kestra sigue pudiendo purgar');

select finish();
rollback;
