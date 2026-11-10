-- MSF-319 · F-NOT-01 (FR-007, SC-003): agrupación por destinatario + tipo en la ventana de 15 min.
-- El reloj de una transacción no avanza: se simula el paso del tiempo corriendo hacia atrás
-- `ventana_vence_en`.
begin;

select plan(22);

insert into organizaciones (id, nombre) values
  ('11111111-1111-1111-1111-111111111111', 'Organización Uno');

insert into auth.users (id, email) values
  ('a1000000-0000-0000-0000-000000000001', 'admin1@example.com'),
  ('a1000000-0000-0000-0000-000000000002', 'operador1@example.com');

insert into usuarios_organizacion (user_id, organizacion_id, rol_id, estado) values
  ('a1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'administrador', 'activo');

select is(private.ventana_agrupacion_aviso(), interval '15 minutes', 'la ventana de agrupación es de 15 minutos');

-- Tres avisos dentro de la ventana = un grupo de 3.
select is(private.emitir_aviso('consulta_nueva', '11111111-1111-1111-1111-111111111111', '{"n": 1}'), 1, 'primer aviso');
select is(private.emitir_aviso('consulta_nueva', '11111111-1111-1111-1111-111111111111', '{"n": 2}'), 1, 'segundo aviso');
select is(private.emitir_aviso('consulta_nueva', '11111111-1111-1111-1111-111111111111', '{"n": 3}'), 1, 'tercer aviso');
select is((select count(*)::int from public.avisos_pendientes), 3, 'quedan tres avisos');
select is((select count(distinct grupo_id)::int from public.avisos_pendientes), 1, 'los tres comparten grupo');
select is((select count(distinct ventana_vence_en)::int from public.avisos_pendientes), 1,
  'la ventana la abre el primero y los demás se suman a ella');
select ok(
  (select min(ventana_vence_en) = now() + interval '15 minutes' from public.avisos_pendientes),
  'la ventana vence a los 15 minutos del primero'
);
select is((select count(*)::int from private.reclamar_avisos_listos(10)), 0,
  'con la ventana abierta no se reclama nada');

update public.avisos_pendientes set ventana_vence_en = now() - interval '1 minute' where estado = 'pendiente';
create temp table reclamados1 on commit drop as select * from private.reclamar_avisos_listos(10);

select is((select count(*)::int from reclamados1), 1, 'vencida la ventana sale un solo grupo');
select is((select cantidad from reclamados1), 3, 'el grupo resume los tres avisos');
select is((select jsonb_array_length(detalle) from reclamados1), 3, 'el detalle trae cada aviso');
select is((select detalle -> 0 ->> 'n' from reclamados1), '1', 'el detalle respeta el orden de llegada (primero)');
select is((select detalle -> 2 ->> 'n' from reclamados1), '3', 'el detalle respeta el orden de llegada (último)');

-- Un aviso solo = correo individual.
delete from public.avisos_pendientes;
select is(private.emitir_aviso('consulta_nueva', '11111111-1111-1111-1111-111111111111', '{"n": 9}'), 1, 'aviso único');
update public.avisos_pendientes set ventana_vence_en = now() - interval '1 minute' where estado = 'pendiente';
create temp table reclamados2 on commit drop as select * from private.reclamar_avisos_listos(10);

select is((select cantidad from reclamados2), 1, 'un aviso solo sale como correo individual');

-- Fuera de la ventana = grupos distintos.
delete from public.avisos_pendientes;
select is(private.emitir_aviso('consulta_nueva', '11111111-1111-1111-1111-111111111111', '{"n": 10}'), 1, 'aviso A');
update public.avisos_pendientes set ventana_vence_en = now() - interval '1 minute';
select is(private.emitir_aviso('consulta_nueva', '11111111-1111-1111-1111-111111111111', '{"n": 11}'), 1, 'aviso B, con la ventana de A ya vencida');
select is((select count(distinct grupo_id)::int from public.avisos_pendientes), 2,
  'el aviso posterior a la ventana abre un grupo nuevo');

-- Cada destinatario tiene su propio grupo.
delete from public.avisos_pendientes;
insert into usuarios_organizacion (user_id, organizacion_id, rol_id, estado)
values ('a1000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'operador', 'activo');
select is(private.emitir_aviso('consulta_nueva', '11111111-1111-1111-1111-111111111111', '{"n": 20}'), 2,
  'el aviso llega a los dos destinatarios');
select is((select count(distinct grupo_id)::int from public.avisos_pendientes), 2,
  'cada destinatario tiene su propio grupo');
select is((select count(distinct user_id)::int from public.avisos_pendientes), 2,
  'un grupo por destinatario y tipo');

select * from finish();
rollback;
