-- MSF-561 · Cierre MSF-189 (SC-007): recorrido completo de «Consulta nueva» a nivel base.
-- Apagado: la consulta no genera correo. Encendido: tres consultas = un correo agrupado.
-- Las consultas se simulan con `private.emitir_aviso` porque el punto de Consultas todavía no lo
-- llama (FR-012, MSF-562); cuando se conecte, este recorrido no cambia.
begin;

select plan(7);

insert into organizaciones (id, nombre) values
  ('11111111-1111-1111-1111-111111111111', 'Organización Uno');

insert into auth.users (id, email) values
  ('a1000000-0000-0000-0000-000000000001', 'admin1@example.com');

insert into usuarios_organizacion (user_id, organizacion_id, rol_id, estado) values
  ('a1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'administrador', 'activo');

-- 1. «Consulta nueva» apagada: una consulta no deja nada para enviar.
insert into preferencias_aviso (user_id, tipo_aviso, activo)
values ('a1000000-0000-0000-0000-000000000001', 'consulta_nueva', false);

select is(private.emitir_aviso('consulta_nueva', '11111111-1111-1111-1111-111111111111', '{"n": 1}'), 0,
  'apagado: no hay destinatarios');
select is((select count(*)::int from public.avisos_pendientes), 0, 'apagado: no se encola nada');
update public.avisos_pendientes set ventana_vence_en = now() - interval '1 minute';
select is((select count(*)::int from private.reclamar_avisos_listos(10)), 0, 'apagado: no sale ningún correo');

-- 2. Encendido: tres consultas = un solo correo agrupado.
update public.preferencias_aviso set activo = true
where user_id = 'a1000000-0000-0000-0000-000000000001' and tipo_aviso = 'consulta_nueva';

select is(private.emitir_aviso('consulta_nueva', '11111111-1111-1111-1111-111111111111', '{"n": 1}'), 1, 'encendido: consulta 1');
select is(private.emitir_aviso('consulta_nueva', '11111111-1111-1111-1111-111111111111', '{"n": 2}'), 1, 'encendido: consulta 2');
select is(private.emitir_aviso('consulta_nueva', '11111111-1111-1111-1111-111111111111', '{"n": 3}'), 1, 'encendido: consulta 3');

update public.avisos_pendientes set ventana_vence_en = now() - interval '1 minute' where estado = 'pendiente';
create temp table correos on commit drop as select * from private.reclamar_avisos_listos(10);
select results_eq(
  $$select count(*)::int, max(cantidad)::int from correos$$,
  $$values (1, 3)$$,
  'encendido: sale un solo correo que agrupa las tres consultas'
);

select * from finish();
rollback;
