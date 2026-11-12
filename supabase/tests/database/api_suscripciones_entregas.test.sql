-- F-API-01 (MSF-403, FR-010, FR-012, SC-003): suscripciones a avisos y
-- entregas durables.
--
-- Comprueba la validación SSRF al guardar, que el secreto de firma se ve una
-- sola vez y queda en Vault, que el fan-out es idempotente por evento y
-- suscripción, y que la entrega se reintenta con espera creciente hasta quedar
-- `agotada` al quinto intento.
begin;

select no_plan();

insert into organizaciones (id, nombre) values
  ('11111111-1111-1111-1111-111111111111', 'Organización A');

insert into auth.users (id, email) values
  ('f1000000-0000-0000-0000-000000000001', 'admin-api-a@example.com'),
  ('f1000000-0000-0000-0000-000000000002', 'miembro-api-a@example.com');

insert into usuarios_organizacion (user_id, organizacion_id, rol_id, estado) values
  ('f1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'administrador', 'activo'),
  ('f1000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'miembro', 'activo');

create temporary table suscripciones (
  clave text primary key,
  id uuid not null,
  secreto text not null
);
grant all on suscripciones to authenticated, service_role;

-- ============================================================================
-- Tablas, RLS y privilegios
-- ============================================================================

select has_table('public', 'api_suscripciones', 'existe la tabla public.api_suscripciones');
select has_table('public', 'api_entregas', 'existe la tabla public.api_entregas');

select is(
  (select relrowsecurity from pg_class where oid = 'public.api_suscripciones'::regclass),
  true,
  'RLS habilitada en api_suscripciones'
);

select is(
  (select relrowsecurity from pg_class where oid = 'public.api_entregas'::regclass),
  true,
  'RLS habilitada en api_entregas'
);

select is(
  has_column_privilege('authenticated', 'public.api_suscripciones', 'secreto_vault_id', 'SELECT'),
  false,
  'el navegador no puede leer la referencia al secreto de Vault'
);

select is(
  has_table_privilege('authenticated', 'public.api_suscripciones', 'INSERT'),
  false,
  'authenticated no inscribe suscripciones directo (solo por RPC)'
);

select is(
  has_table_privilege('authenticated', 'public.api_entregas', 'INSERT'),
  false,
  'authenticated no inscribe entregas directo (solo por funciones)'
);

-- ============================================================================
-- SSRF al guardar (FR-010)
-- ============================================================================

select set_config(
  'request.jwt.claims',
  json_build_object('sub', 'f1000000-0000-0000-0000-000000000001', 'role', 'authenticated')::text,
  true
);
set local role authenticated;

select throws_ok(
  $$select public.crear_suscripcion_api('http://ejemplo.com/aviso', array['stock.actualizado'])$$,
  '22023',
  null,
  'una URL sin https se rechaza'
);

select throws_ok(
  $$select public.crear_suscripcion_api('https://localhost/aviso', array['stock.actualizado'])$$,
  '22023',
  null,
  'localhost se rechaza'
);

select throws_ok(
  $$select public.crear_suscripcion_api('https://10.0.0.5/aviso', array['stock.actualizado'])$$,
  '22023',
  null,
  'una IP privada se rechaza'
);

select throws_ok(
  $$select public.crear_suscripcion_api('https://127.0.0.1/aviso', array['stock.actualizado'])$$,
  '22023',
  null,
  'loopback se rechaza'
);

select throws_ok(
  $$select public.crear_suscripcion_api('https://169.254.169.254/aviso', array['stock.actualizado'])$$,
  '22023',
  null,
  'la IP de metadatos del proveedor se rechaza'
);

-- Notaciones de IPv4 que el sistema resuelve a direcciones internas aunque no
-- parezcan una IP (FR-010).
select throws_ok(
  $$select public.crear_suscripcion_api('https://127.1/aviso', array['stock.actualizado'])$$,
  '22023',
  null,
  'una IPv4 abreviada se rechaza'
);

select throws_ok(
  $$select public.crear_suscripcion_api('https://0177.0.0.1/aviso', array['stock.actualizado'])$$,
  '22023',
  null,
  'una IPv4 con ceros a la izquierda se rechaza'
);

select throws_ok(
  $$select public.crear_suscripcion_api('https://2130706433/aviso', array['stock.actualizado'])$$,
  '22023',
  null,
  'una IPv4 en decimal se rechaza'
);

select throws_ok(
  $$select public.crear_suscripcion_api('https://0x7f000001/aviso', array['stock.actualizado'])$$,
  '22023',
  null,
  'una IPv4 en hexadecimal se rechaza'
);

select throws_ok(
  $$select public.crear_suscripcion_api('https://[::1]/aviso', array['stock.actualizado'])$$,
  '22023',
  null,
  'una IP IPv6 literal se rechaza'
);

select throws_ok(
  $$select public.crear_suscripcion_api('https://usuario:clave@ejemplo.com/aviso', array['stock.actualizado'])$$,
  '22023',
  null,
  'una URL con credenciales se rechaza'
);

select throws_ok(
  $$select public.crear_suscripcion_api('https://ejemplo.com/aviso', array['ventas.entregadas'])$$,
  '22023',
  null,
  'un tipo de evento desconocido se rechaza'
);

select throws_ok(
  $$select public.crear_suscripcion_api('https://ejemplo.com/aviso', array[]::text[])$$,
  '22023',
  null,
  'una suscripción sin tipos se rechaza'
);

reset role;

-- Un miembro que no es Administrador no crea suscripciones.
select set_config(
  'request.jwt.claims',
  json_build_object('sub', 'f1000000-0000-0000-0000-000000000002', 'role', 'authenticated')::text,
  true
);
set local role authenticated;

select throws_ok(
  $$select public.crear_suscripcion_api('https://ejemplo.com/aviso', array['stock.actualizado'])$$,
  '42501',
  null,
  'un miembro sin rol administrador no puede crear suscripciones'
);

reset role;

-- ============================================================================
-- Crear la suscripción: el secreto se ve una sola vez y queda en Vault.
-- ============================================================================

select set_config(
  'request.jwt.claims',
  json_build_object('sub', 'f1000000-0000-0000-0000-000000000001', 'role', 'authenticated')::text,
  true
);
set local role authenticated;

with creada as (
  select public.crear_suscripcion_api('https://ejemplo.com/aviso', array['stock.actualizado', 'precio.actualizado']) as c
)
insert into suscripciones (clave, id, secreto) select 'principal', (c).id, (c).secreto from creada;

reset role;

select is(
  (select count(*)::int from public.api_suscripciones),
  1,
  'la suscripción queda creada'
);

select is(
  (select url from public.api_suscripciones),
  'https://ejemplo.com/aviso',
  'la suscripción guarda la URL'
);

select is(
  (select array_to_string(tipos, ',') from public.api_suscripciones),
  'stock.actualizado,precio.actualizado',
  'la suscripción guarda los tipos de evento'
);

select is(
  (select activa from public.api_suscripciones),
  true,
  'la suscripción nace activa'
);

select is(
  (select decrypted_secret from vault.decrypted_secrets
    where id = (select secreto_vault_id from public.api_suscripciones)),
  (select secreto from suscripciones where clave = 'principal'),
  'el secreto de firma queda en Vault'
);

select is(
  (select count(*)::int from public.api_suscripciones s
    where to_jsonb(s)::text like '%' || (select secreto from suscripciones where clave = 'principal') || '%'),
  0,
  'el secreto en claro no queda en la fila de la suscripción'
);

-- Pausar y reanudar.
select set_config(
  'request.jwt.claims',
  json_build_object('sub', 'f1000000-0000-0000-0000-000000000001', 'role', 'authenticated')::text,
  true
);
set local role authenticated;

select lives_ok(
  $$select public.actualizar_suscripcion_api((select id from suscripciones where clave = 'principal'), false)$$,
  'el administrador pausa la suscripción'
);

reset role;

select is(
  (select activa from public.api_suscripciones),
  false,
  'la suscripción queda pausada'
);

-- ============================================================================
-- Fan-out idempotente (FR-012, SC-003)
-- ============================================================================

insert into public.cola_eventos (organizacion_id, tipo, clave_idempotencia, carga)
values ('11111111-1111-1111-1111-111111111111', 'stock.actualizado', 'evento-de-prueba', '{"producto_id": "b1"}');

select is(
  (select private.api_fanout_evento((select id from public.cola_eventos where clave_idempotencia = 'evento-de-prueba'))),
  0,
  'una suscripción pausada no genera entregas'
);

select set_config(
  'request.jwt.claims',
  json_build_object('sub', 'f1000000-0000-0000-0000-000000000001', 'role', 'authenticated')::text,
  true
);
set local role authenticated;

select lives_ok(
  $$select public.actualizar_suscripcion_api((select id from suscripciones where clave = 'principal'), true)$$,
  'el administrador reanuda la suscripción'
);

reset role;

select is(
  (select private.api_fanout_evento((select id from public.cola_eventos where clave_idempotencia = 'evento-de-prueba'))),
  1,
  'el fan-out genera una entrega por suscripción activa'
);

select is(
  (select private.api_fanout_evento((select id from public.cola_eventos where clave_idempotencia = 'evento-de-prueba'))),
  0,
  'el fan-out es idempotente: el mismo evento no genera una segunda entrega'
);

select is(
  (select count(*)::int from public.api_entregas where evento_id = (select id from public.cola_eventos where clave_idempotencia = 'evento-de-prueba')),
  1,
  'queda una sola entrega para el evento'
);

-- Un evento de otro tipo no genera entregas.
insert into public.cola_eventos (organizacion_id, tipo, clave_idempotencia, carga)
values ('11111111-1111-1111-1111-111111111111', 'venta.registrada', 'evento-de-venta', '{}');

select is(
  (select private.api_fanout_evento((select id from public.cola_eventos where clave_idempotencia = 'evento-de-venta'))),
  0,
  'un evento del que la suscripción no escucha no genera entregas'
);

-- ============================================================================
-- Reclamo, resolución y reintentos (FR-012)
-- ============================================================================

select is(
  (select count(*)::int from private.api_reclamar_entregas(10, 60)),
  1,
  'se reclama la entrega pendiente'
);

select is(
  (select estado from public.api_entregas),
  'reclamada',
  'la entrega queda reclamada'
);

select is(
  (select intentos from public.api_entregas),
  1,
  'la entrega cuenta el intento'
);

select is(
  (select count(*)::int from private.api_entrega_para_entregar((select id from public.api_entregas))),
  1,
  'la entrega reclamada expone destino y secreto de firma'
);

-- Un fallo deja la entrega pendiente para el reintento y guarda el error
-- saneado (sin credenciales).
select lives_ok(
  $$select private.api_resolver_entrega(
    (select id from public.api_entregas),
    'pendiente',
    500,
    'falló https://usuario:clave@ejemplo.com/aviso')$$,
  'la entrega se resuelve como pendiente'
);

select is(
  (select estado from public.api_entregas),
  'pendiente',
  'tras el fallo la entrega vuelve a pendiente'
);

select is(
  (select ultimo_estado_http from public.api_entregas),
  500,
  'la entrega guarda el último estado HTTP'
);

select ok(
  (select ultimo_error_sanitizado not like '%clave@%' from public.api_entregas),
  'el error guardado no lleva credenciales'
);

select ok(
  (select proximo_intento_en between now() + interval '55 seconds' and now() + interval '65 seconds'
     from public.api_entregas),
  'el reintento espera 60 s × 2^(intentos-1)'
);

select is(
  (select count(*)::int from private.api_entrega_para_entregar((select id from public.api_entregas))),
  0,
  'una entrega ya resuelta no expone destino ni secreto de firma'
);

-- El segundo fallo espera el doble: la espera crece con cada intento. Se
-- adelanta el reloj de la entrega para no esperar los 60 s reales.
update public.api_entregas set proximo_intento_en = now() - interval '1 second';

select is(
  (select count(*)::int from private.api_reclamar_entregas(10, 60)),
  1,
  'la entrega se vuelve a reclamar para el segundo intento'
);

select is(
  (select intentos from public.api_entregas),
  2,
  'el segundo intento se cuenta'
);

select lives_ok(
  $$select private.api_resolver_entrega((select id from public.api_entregas), 'pendiente', 500, 'falló otra vez')$$,
  'el segundo intento se resuelve'
);

select ok(
  (select proximo_intento_en between now() + interval '115 seconds' and now() + interval '125 seconds'
     from public.api_entregas),
  'el segundo reintento espera 120 s × 2^(intentos-1)'
);

-- Al quinto intento la entrega queda agotada.
update public.api_entregas set intentos = 4, proximo_intento_en = now() - interval '1 second';

select is(
  (select count(*)::int from private.api_reclamar_entregas(10, 60)),
  1,
  'la entrega se vuelve a reclamar'
);

select is(
  (select intentos from public.api_entregas),
  5,
  'la entrega va por el quinto intento'
);

select lives_ok(
  $$select private.api_resolver_entrega((select id from public.api_entregas), 'pendiente', 500, 'falló otra vez')$$,
  'el quinto intento se resuelve'
);

select is(
  (select estado from public.api_entregas),
  'agotada',
  'al quinto intento la entrega queda agotada'
);

-- ============================================================================
-- Visibilidad: el Administrador ve las entregas de su organización.
-- ============================================================================

select set_config(
  'request.jwt.claims',
  json_build_object('sub', 'f1000000-0000-0000-0000-000000000001', 'role', 'authenticated')::text,
  true
);
set local role authenticated;

select is(
  (select count(*)::int from public.api_entregas),
  1,
  'el administrador ve la entrega'
);

select is(
  (select count(*)::int from public.api_suscripciones),
  1,
  'el administrador ve su suscripción'
);

reset role;

select * from finish();
rollback;
