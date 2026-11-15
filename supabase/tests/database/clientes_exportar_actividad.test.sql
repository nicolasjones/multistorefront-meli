-- MSF-508 (Principio III): exportar_clientes registra `clientes.exportados` en la actividad,
-- una vez por exportación (primer lote), con total y filtros, solo si el permiso pasó y hay filas.
begin;

select plan(10);

insert into organizaciones (id, nombre) values
  ('11111111-1111-1111-1111-111111111111', 'Organización Uno'),
  ('22222222-2222-2222-2222-222222222222', 'Organización Dos');
insert into auth.users (id, email) values
  ('d1000000-0000-0000-0000-000000000001', 'admin-uno@example.com'),
  ('d4000000-0000-0000-0000-000000000001', 'consulta-uno@example.com'),
  ('d2000000-0000-0000-0000-000000000001', 'admin-dos@example.com');
insert into usuarios_organizacion (user_id, organizacion_id, rol_id) values
  ('d1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'administrador'),
  ('d4000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'consulta'),
  ('d2000000-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', 'administrador');
insert into clientes (organizacion_id, numero, nombre, tipo) values
  ('11111111-1111-1111-1111-111111111111', 11, 'Alfa', 'minorista'),
  ('11111111-1111-1111-1111-111111111111', 12, 'Beta', 'mayorista'),
  ('11111111-1111-1111-1111-111111111111', 13, 'Gamma', 'mayorista');

create function pg_temp.como(p_user uuid) returns void language plpgsql as $$
begin
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
  set local role authenticated;
end $$;

select pg_temp.como('d1000000-0000-0000-0000-000000000001');
select is((select count(*)::int from exportar_clientes()), 4, 'el envoltorio devuelve las filas activas de la organización (3 + Consumidor final)');
reset role;
select is((select count(*)::int from registro_actividad where tipo = 'clientes.exportados'), 1, 'la exportación deja un evento');
select matches((select detalle from registro_actividad where tipo = 'clientes.exportados'), '^Exportó 4 clientes a Excel$', 'detalle con el total y sin filtros');

select pg_temp.como('d1000000-0000-0000-0000-000000000001');
select is((select count(*)::int from exportar_clientes(null, null, false, (select id from exportar_clientes(null, null, false, null, 2) order by lower(nombre) desc, id desc limit 1), 2)), 2, 'segundo lote devuelve filas');
reset role;
select is((select count(*)::int from registro_actividad where tipo = 'clientes.exportados'), 2, 'el segundo lote no registra (solo +1 del primer lote usado como cursor)');

select pg_temp.como('d1000000-0000-0000-0000-000000000001');
select count(*) from exportar_clientes('alf', 'minorista', false);
reset role;
select is((select count(*)::int from registro_actividad where tipo = 'clientes.exportados'
  and detalle = 'Exportó 1 cliente a Excel (filtros: tipo minorista, con texto)'), 1, 'el detalle lista los filtros sin el texto buscado');

select pg_temp.como('d4000000-0000-0000-0000-000000000001');
select throws_ok($$select * from exportar_clientes()$$, '42501', null, 'sin permiso: rechazado');
select throws_ok($$select * from exportar_clientes(null, null, false, '00000000-0000-0000-0000-000000000001'::uuid)$$, '42501', null, 'sin permiso: también se rechaza con cursor');
reset role;
select is((select count(*)::int from registro_actividad where tipo = 'clientes.exportados'), 3, 'sin permiso no se registra');

select pg_temp.como('d2000000-0000-0000-0000-000000000001');
select count(*) from exportar_clientes('nada-que-coincida-xyz');
reset role;
select is((select count(*)::int from registro_actividad where tipo = 'clientes.exportados'), 3, 'sin filas no se registra');

select * from finish();
rollback;
