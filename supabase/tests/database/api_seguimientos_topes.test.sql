-- F-API-01 (MSF-233) · seguimientos MSF-836 y MSF-838, afinados en la revisión:
--   · la purga de eventos corre de a lotes de 50 000 y drena más de un lote en una corrida;
--   · el reintento manual tiene un tope de 200 entregas de la organización esperando para enviarse.
begin;

select no_plan();

insert into organizaciones (id, nombre) values
  ('a6000000-0000-0000-0000-000000000001', 'Organización topes A'),
  ('a6000000-0000-0000-0000-000000000002', 'Organización topes B');
insert into auth.users (id, email) values
  ('f6000000-0000-0000-0000-000000000001', 'admin-topes-a@example.com');
insert into usuarios_organizacion (user_id, organizacion_id, rol_id, estado) values
  ('f6000000-0000-0000-0000-000000000001', 'a6000000-0000-0000-0000-000000000001', 'administrador', 'activo');
insert into public.api_suscripciones (id, organizacion_id, url, tipos, secreto_vault_id) values
  ('d6000000-0000-0000-0000-000000000001', 'a6000000-0000-0000-0000-000000000001', 'https://ejemplo.com/topes', array['stock.actualizado'], gen_random_uuid());

-- ============================================================================
-- Purga por lotes: 60 000 eventos terminados viejos (más de un lote de 50 000) y uno reciente
-- ============================================================================

insert into public.cola_eventos (organizacion_id, tipo, clave_idempotencia, carga, estado, created_at, updated_at)
select 'a6000000-0000-0000-0000-000000000002', 'stock.actualizado', 'lote-' || n, '{}', 'completada', now() - interval '120 days', now() - interval '120 days'
  from generate_series(1, 60000) n;
insert into public.cola_eventos (organizacion_id, tipo, clave_idempotencia, carga, estado) values
  ('a6000000-0000-0000-0000-000000000002', 'stock.actualizado', 'lote-reciente', '{}', 'completada');

select is((select count(*)::int from public.cola_eventos where organizacion_id = 'a6000000-0000-0000-0000-000000000002'), 60001, 'hay 60 001 eventos antes de purgar');
select lives_ok($$select private.purgar_api_llamadas(90)$$, 'la purga corre');
select is((select count(*)::int from public.cola_eventos where organizacion_id = 'a6000000-0000-0000-0000-000000000002'), 1,
  'una sola corrida drena más de un lote de 50 000 y deja el evento reciente');

-- ============================================================================
-- Tope del reintento manual: 200 entregas de la organización esperando para enviarse
-- ============================================================================

insert into public.cola_eventos (id, organizacion_id, tipo, clave_idempotencia, carga, estado)
select ('e6000000-0000-0000-0000-' || lpad(n::text, 12, '0'))::uuid, 'a6000000-0000-0000-0000-000000000001', 'stock.actualizado', 'tope-' || n, '{}', 'completada'
  from generate_series(1, 202) n;

-- 198 pendientes listas para enviarse + 2 agotadas para reintentar
insert into public.api_entregas (organizacion_id, evento_id, suscripcion_id, estado, intentos, proximo_intento_en)
select 'a6000000-0000-0000-0000-000000000001', ('e6000000-0000-0000-0000-' || lpad(n::text, 12, '0'))::uuid,
       'd6000000-0000-0000-0000-000000000001', 'pendiente', 0, now() - interval '1 minute'
  from generate_series(1, 198) n;
insert into public.api_entregas (id, organizacion_id, evento_id, suscripcion_id, estado, intentos) values
  ('c6000000-0000-0000-0000-000000000001', 'a6000000-0000-0000-0000-000000000001', 'e6000000-0000-0000-0000-000000000199', 'd6000000-0000-0000-0000-000000000001', 'agotada', 5),
  ('c6000000-0000-0000-0000-000000000002', 'a6000000-0000-0000-0000-000000000001', 'e6000000-0000-0000-0000-000000000200', 'd6000000-0000-0000-0000-000000000001', 'agotada', 5),
  ('c6000000-0000-0000-0000-000000000003', 'a6000000-0000-0000-0000-000000000001', 'e6000000-0000-0000-0000-000000000201', 'd6000000-0000-0000-0000-000000000001', 'agotada', 5);

select set_config('request.jwt.claims',
  json_build_object('sub', 'f6000000-0000-0000-0000-000000000001', 'role', 'authenticated')::text, true);
set local role authenticated;

select lives_ok($$select public.reintentar_entrega_api('c6000000-0000-0000-0000-000000000001')$$, 'con 198 esperando se puede reintentar (pasa a 199)');
select lives_ok($$select public.reintentar_entrega_api('c6000000-0000-0000-0000-000000000002')$$, 'y una más (pasa a 200)');
select throws_ok($$select public.reintentar_entrega_api('c6000000-0000-0000-0000-000000000003')$$, '54000',
  'Hay demasiadas entregas esperando para enviarse: esperá a que se vacíe la cola antes de reintentar más',
  'con 200 esperando se rechaza otro reintento');

reset role;
select is((select estado from public.api_entregas where id = 'c6000000-0000-0000-0000-000000000003'), 'agotada', 'y la entrega rechazada sigue agotada');

-- Al vaciarse la cola vuelve a poder reintentar.
update public.api_entregas set estado = 'completada' where organizacion_id = 'a6000000-0000-0000-0000-000000000001' and estado = 'pendiente';
set local role authenticated;
select lives_ok($$select public.reintentar_entrega_api('c6000000-0000-0000-0000-000000000003')$$, 'con la cola vacía se puede reintentar de nuevo');
reset role;

select finish();
rollback;
