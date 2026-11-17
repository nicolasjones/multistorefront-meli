-- Comportamiento de las correcciones del lote 33 (MSF-918/922/923): las políticas «denegar todo» niegan de verdad,
-- las cotizaciones conservan su clave natural y ganan PK, y la FK de conexiones está validada y rige.
begin;

select plan(12);

-- Semilla como dueño (RLS no aplica al rol postgres).
insert into public.organizaciones (id, nombre) values ('33333333-3333-3333-3333-333333333333', 'Org lote 33');
insert into auth.users (id, email) values ('44444444-4444-4444-4444-444444444444', 'lote33@example.com');
insert into public.eventos_membresia (organizacion_id, actor_user_id, accion) values ('33333333-3333-3333-3333-333333333333', '44444444-4444-4444-4444-444444444444', 'miembro_agregado');
insert into public.intentos_acceso (correo_hash, bloqueado_hasta) values ('hash-lote33', now() + interval '1 hour');

-- Denegar todo: authenticated no ve ni escribe una tabla con la política explícita.
set local role authenticated;
select is((select count(*)::int from public.eventos_membresia), 0,
  'authenticated lee 0 filas de eventos_membresia aunque hay una sembrada (tiene SELECT pero la política deniega)');
select throws_ok($$insert into public.intentos_acceso (correo_hash) values ('x')$$, '42501', null,
  'authenticated no inserta en intentos_acceso (sin grant)');
reset role;

set local role anon;
select throws_ok($$select 1 from public.intentos_acceso$$, '42501', null, 'anon no lee intentos_acceso');
reset role;

select is((select count(*)::int from public.intentos_acceso where correo_hash = 'hash-lote33'), 1,
  'el dueño sigue viendo la fila (la política no afecta a funciones definer ni al dueño)');

-- Cotizaciones: PK sustituta + clave natural intacta.
select is((select count(*)::int from pg_constraint where conrelid = 'dominio.cotizacion_aplicada'::regclass and contype = 'p'), 1,
  'cotizacion_aplicada tiene clave primaria');
select is((select count(*)::int from pg_constraint where conrelid = 'dominio.cotizacion_pendiente'::regclass and contype = 'p'), 1,
  'cotizacion_pendiente tiene clave primaria');

insert into dominio.cotizacion_aplicada (organizacion_id, valor) values ('33333333-3333-3333-3333-333333333333', 1000);
select isnt((select id from dominio.cotizacion_aplicada where organizacion_id = '33333333-3333-3333-3333-333333333333'), null,
  'la fila nueva recibe id por defecto');
select throws_ok(
  $$insert into dominio.cotizacion_aplicada (organizacion_id, valor) values ('33333333-3333-3333-3333-333333333333', 2000)$$,
  '23505', null, 'la clave natural (organizacion, empresa nula) sigue siendo única');

-- FK de conexiones validada y vigente.
select is((select convalidated from pg_constraint where conname = 'conexiones_sistema_externo_fkey'), true,
  'conexiones_sistema_externo_fkey está validada');
select throws_ok(
  $$insert into public.conexiones (organizacion_id, sistema_externo, credencial_vault_id)
    values ('33333333-3333-3333-3333-333333333333', 'sistema_que_no_existe', gen_random_uuid())$$,
  '23503', null, 'una conexión con un sistema fuera del catálogo se rechaza');

-- Las funciones migradas a search_path vacío siguen funcionando.
select is(public.bloqueo_acceso_hasta(null), null::timestamptz, 'bloqueo_acceso_hasta(null) sigue devolviendo null con search_path vacío');
select lives_ok($$select public.bloqueo_acceso_hasta('a@b.com')$$, 'bloqueo_acceso_hasta recorre su consulta (private.hash_correo_acceso y public.intentos_acceso calificados) con search_path vacío');

select * from finish();
rollback;
