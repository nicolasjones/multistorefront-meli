-- MSF-840 (lote 101): el reclamo de eventos y de entregas reparte el lote entre organizaciones (round-robin) y conserva el
-- orden por antigüedad dentro de cada una.
begin;

select plan(15);

insert into organizaciones (id, nombre) values
  ('a1000000-0000-4000-8000-000000000001', 'Org grande'),
  ('a2000000-0000-4000-8000-000000000002', 'Org chica'),
  ('a3000000-0000-4000-8000-000000000003', 'Org mediana');

-- Org grande: 30 eventos (los más viejos); chica: 3; mediana: 12. Antigüedad creciente con n.
insert into public.cola_eventos (organizacion_id, tipo, clave_idempotencia, carga, created_at, proximo_intento_en)
select 'a1000000-0000-4000-8000-000000000001', 'zz.equidad', 'g' || n, '{}', '2020-01-01'::timestamptz + n * interval '1 second', '2020-01-01'::timestamptz + n * interval '1 second'
  from generate_series(1, 30) n;
insert into public.cola_eventos (organizacion_id, tipo, clave_idempotencia, carga, created_at, proximo_intento_en)
select 'a2000000-0000-4000-8000-000000000002', 'zz.equidad', 'c' || n, '{}', '2020-01-01'::timestamptz + (100 + n) * interval '1 second', '2020-01-01'::timestamptz + (100 + n) * interval '1 second'
  from generate_series(1, 3) n;
insert into public.cola_eventos (organizacion_id, tipo, clave_idempotencia, carga, created_at, proximo_intento_en)
select 'a3000000-0000-4000-8000-000000000003', 'zz.equidad', 'm' || n, '{}', '2020-01-01'::timestamptz + (200 + n) * interval '1 second', '2020-01-01'::timestamptz + (200 + n) * interval '1 second'
  from generate_series(1, 12) n;
-- Otro tipo: no entra en el reclamo de 'zz.equidad' (tipos de prueba: los reales reciben eventos de los triggers de la base).
insert into public.cola_eventos (organizacion_id, tipo, clave_idempotencia, carga)
values ('a2000000-0000-4000-8000-000000000002', 'zz.otro', 'otro', '{}');

create temp table pg_temp.lote1 as
  select * from private.reclamar_eventos_interno('zz.equidad', 9, 300, 3);

select is((select count(*)::int from pg_temp.lote1), 9, 'el lote trae el límite pedido');
select is((select count(*)::int from pg_temp.lote1 where organizacion_id = 'a1000000-0000-4000-8000-000000000001'), 3,
  'la organización grande recibe 3 de 9 (un tercio) aunque tenga los eventos más viejos');
select is((select count(*)::int from pg_temp.lote1 where organizacion_id = 'a2000000-0000-4000-8000-000000000002'), 3,
  'la chica recibe 3');
select is((select count(*)::int from pg_temp.lote1 where organizacion_id = 'a3000000-0000-4000-8000-000000000003'), 3,
  'la mediana recibe 3');
select is(
  (select string_agg(clave_idempotencia, ',' order by clave_idempotencia) from pg_temp.lote1 where organizacion_id = 'a1000000-0000-4000-8000-000000000001'),
  'g1,g2,g3', 'dentro de una organización se reclaman los más antiguos (FIFO)');

-- Segundo lote de 20: la chica ya no tiene (sus 3 salieron), el cupo no se desperdicia: 9 de cada una de las otras dos y 2 más.
create temp table pg_temp.lote2 as
  select * from private.reclamar_eventos_interno('zz.equidad', 20, 300, 3);
select is((select count(*)::int from pg_temp.lote2), 20, 'el segundo lote se llena completo');
select is((select count(*)::int from pg_temp.lote2 where organizacion_id = 'a2000000-0000-4000-8000-000000000002'), 0,
  'la chica ya no tiene pendientes');
select is((select count(*)::int from pg_temp.lote2 where organizacion_id = 'a3000000-0000-4000-8000-000000000003'), 9,
  'la mediana recibe sus 9 restantes (12 - 3)');
select is((select count(*)::int from pg_temp.lote2 where organizacion_id = 'a1000000-0000-4000-8000-000000000001'), 11,
  'la grande recibe el cupo que sobra (20 - 9)');

-- Frontera del límite: 1 evento = el más antiguo de la primera ronda.
select is((select clave_idempotencia from private.reclamar_eventos_interno('zz.equidad', 1, 300, 3)), 'g15',
  'un lote de 1 trae el más antiguo de la ronda más baja (la grande, tras sus 14 ya reclamados (g1 a g14))');
select is((select count(*)::int from private.reclamar_eventos_interno('zz.otro', 100, 300, 3)), 1,
  'otro tipo se reclama aparte');

-- Entregas: misma regla. Dos suscripciones activas (una por organización) y una pausada de la mediana.
insert into public.api_suscripciones (id, organizacion_id, url, tipos, secreto_vault_id, activa) values
  ('b1000000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-000000000001', 'https://destino-uno.example/h', array['precio.actualizado'], gen_random_uuid(), true),
  ('b2000000-0000-4000-8000-000000000002', 'a2000000-0000-4000-8000-000000000002', 'https://destino-dos.example/h', array['precio.actualizado'], gen_random_uuid(), true),
  ('b3000000-0000-4000-8000-000000000003', 'a3000000-0000-4000-8000-000000000003', 'https://destino-tres.example/h', array['precio.actualizado'], gen_random_uuid(), false);

insert into public.api_entregas (organizacion_id, evento_id, suscripcion_id, creada_en, proximo_intento_en)
select 'a1000000-0000-4000-8000-000000000001', e.id, 'b1000000-0000-4000-8000-000000000001', e.created_at, e.created_at
  from public.cola_eventos e where e.organizacion_id = 'a1000000-0000-4000-8000-000000000001' and e.clave_idempotencia in (select 'g' || n from generate_series(1, 20) n);
insert into public.api_entregas (organizacion_id, evento_id, suscripcion_id, creada_en, proximo_intento_en)
select 'a2000000-0000-4000-8000-000000000002', e.id, 'b2000000-0000-4000-8000-000000000002', e.created_at, e.created_at
  from public.cola_eventos e where e.organizacion_id = 'a2000000-0000-4000-8000-000000000002' and e.clave_idempotencia in ('c1', 'c2');
insert into public.api_entregas (organizacion_id, evento_id, suscripcion_id, creada_en, proximo_intento_en)
select 'a3000000-0000-4000-8000-000000000003', e.id, 'b3000000-0000-4000-8000-000000000003', e.created_at, e.created_at
  from public.cola_eventos e where e.organizacion_id = 'a3000000-0000-4000-8000-000000000003' and e.clave_idempotencia in ('m1', 'm2', 'm3');

create temp table pg_temp.entregas1 as select * from private.api_reclamar_entregas(6, 300);
select is((select count(*)::int from pg_temp.entregas1), 6, 'el lote de entregas trae el límite');
select is((select count(*)::int from pg_temp.entregas1 where organizacion_id = 'a2000000-0000-4000-8000-000000000002'), 2,
  'la organización chica recibe sus 2 entregas aunque la grande tenga las más viejas');
select is((select count(*)::int from pg_temp.entregas1 where organizacion_id = 'a1000000-0000-4000-8000-000000000001'), 4,
  'la grande recibe el resto del cupo');
select is((select count(*)::int from pg_temp.entregas1 where organizacion_id = 'a3000000-0000-4000-8000-000000000003'), 0,
  'una suscripción pausada no entrega (sus entregas se conservan)');

select * from finish();
rollback;
