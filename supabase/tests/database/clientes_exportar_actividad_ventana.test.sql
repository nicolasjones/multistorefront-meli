-- Seguridad retroactiva de la exportación de clientes: toda llamada con filas cuenta (también con cursor), el tope de 50000
-- filas rige sobre el acumulado de una ventana de 10 minutos por persona y filtros, y el texto buscado nunca llega a la actividad.
begin;

select plan(16);

insert into organizaciones (id, nombre) values ('11111111-1111-1111-1111-111111111111', 'Organización Uno');
insert into auth.users (id, email) values
  ('d1000000-0000-0000-0000-000000000001', 'admin-uno@example.com'),
  ('d1000000-0000-0000-0000-000000000005', 'admin-otro@example.com');
insert into usuarios_organizacion (user_id, organizacion_id, rol_id) values
  ('d1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'administrador'),
  ('d1000000-0000-0000-0000-000000000005', '11111111-1111-1111-1111-111111111111', 'administrador');
insert into clientes (organizacion_id, numero, nombre, tipo, documento) values
  ('11111111-1111-1111-1111-111111111111', 11, 'Alfa', 'minorista', '30111222'),
  ('11111111-1111-1111-1111-111111111111', 12, 'Beta', 'mayorista', null),
  ('11111111-1111-1111-1111-111111111111', 13, 'Gamma', 'mayorista', null);

create function pg_temp.como(p_user uuid) returns void language plpgsql as $$
begin
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
  set local role authenticated;
end $$;

-- Sin el primer lote: un cursor cualquiera (el primer cliente en orden) descarga el resto.
select pg_temp.como('d1000000-0000-0000-0000-000000000001');
select is((select count(*)::int from exportar_clientes(null, null, false,
  (select c.id from clientes c order by lower(c.nombre), c.id limit 1))), 3,
  'con cursor se descargan las filas restantes');
reset role;
select is((select count(*)::int from registro_actividad where tipo = 'clientes.exportados'), 1,
  'una llamada con cursor y sin primer lote deja un evento');
select is((select detalle from registro_actividad where tipo = 'clientes.exportados'),
  'Exportó 3 clientes a Excel (continuación)', 'el evento cuenta las filas devueltas');

-- Segunda llamada con cursor en la misma ventana: filas nuevas sin declarar, otro evento por esas filas.
select pg_temp.como('d1000000-0000-0000-0000-000000000001');
select count(*) from exportar_clientes(null, null, false, (select c.id from clientes c order by lower(c.nombre), c.id limit 1));
reset role;
select is((select count(*)::int from registro_actividad where tipo = 'clientes.exportados'), 2,
  'la segunda llamada con cursor también se registra');
select is((select filas_acumuladas from private.clientes_exportaciones_ventana limit 1), 6, 'la ventana acumula las filas entregadas');

-- Exportación paginada normal: primer lote declara el total y el cursor no agrega eventos.
select pg_temp.como('d1000000-0000-0000-0000-000000000001');
select count(*) from exportar_clientes(null, 'mayorista', false, null, 1);
select count(*) from exportar_clientes(null, 'mayorista', false,
  (select c.id from clientes c where c.tipo = 'mayorista' order by lower(c.nombre), c.id limit 1), 1);
reset role;
select is((select count(*)::int from registro_actividad where tipo = 'clientes.exportados' and detalle like '%tipo mayorista%'), 1,
  'una exportación paginada deja un único evento');
select is((select detalle from registro_actividad where tipo = 'clientes.exportados' and detalle like '%tipo mayorista%'),
  'Exportó 2 clientes a Excel (filtros: tipo mayorista)', 'el único evento declara el total de la exportación');

-- Exportación paginada normal (lotes con cursor): EXACTAMENTE un evento, con el total correcto de la exportación.
select pg_temp.como('d1000000-0000-0000-0000-000000000001');
select count(*) from exportar_clientes(null, 'minorista', false, null, 1);
select count(*) from exportar_clientes(null, 'minorista', false,
  (select c.id from clientes c where c.tipo = 'minorista' and not c.archivado_en is not null order by lower(c.nombre), c.id limit 1), 1);
reset role;
select is((select array_agg(detalle) from registro_actividad where tipo = 'clientes.exportados' and detalle like '%tipo minorista%'),
  array['Exportó 2 clientes a Excel (filtros: tipo minorista)'], 'paginada normal: exactamente un evento con el total correcto');

-- Cursor sin primer lote: cada fila entregada queda declarada en algún evento (suma de eventos sin filtros = filas entregadas = 6).
select is((select sum(substring(detalle from '^Exportó ([0-9]+) ')::int)::int from registro_actividad
  where tipo = 'clientes.exportados' and detalle not like '%filtros:%'),
  (select filas_acumuladas from private.clientes_exportaciones_ventana where filas_acumuladas = 6 limit 1),
  'cursor sin primer lote: filas declaradas en eventos = filas entregadas');

-- Tope acumulado: 49999 entregadas en la ventana + 3 filas supera 50000.
update private.clientes_exportaciones_ventana set filas_acumuladas = 49999, filas_declaradas = 49999
 where actor_id = 'd1000000-0000-0000-0000-000000000001' and filtros_hash = (select filtros_hash from private.clientes_exportaciones_ventana
   where filas_acumuladas = 6 limit 1);
select pg_temp.como('d1000000-0000-0000-0000-000000000001');
select throws_ok(
  $q$select * from exportar_clientes(null, null, false, (select c.id from clientes c order by lower(c.nombre), c.id limit 1))$q$,
  '54000', null, 'el tope de 50000 filas corta sobre el acumulado de la ventana');
reset role;
select is((select count(*)::int from registro_actividad where tipo = 'clientes.exportados'), 4,
  'la llamada rechazada no deja evento ni suma filas');
select is((select max(filas_acumuladas) from private.clientes_exportaciones_ventana), 49999, 'la ventana conserva el acumulado previo');

-- Otra persona de la misma organización no comparte ventana.
select pg_temp.como('d1000000-0000-0000-0000-000000000005');
select lives_ok(
  $q$select * from exportar_clientes(null, null, false, (select c.id from clientes c order by lower(c.nombre), c.id limit 1))$q$,
  'otra persona no comparte la ventana ni el tope');

-- Pasados 10 minutos la ventana se reinicia.
reset role;
update private.clientes_exportaciones_ventana set desde = desde - interval '11 minutes'
 where actor_id = 'd1000000-0000-0000-0000-000000000001' and filas_acumuladas = 49999;
select pg_temp.como('d1000000-0000-0000-0000-000000000001');
select lives_ok(
  $q$select * from exportar_clientes(null, null, false, (select c.id from clientes c order by lower(c.nombre), c.id limit 1))$q$,
  'vencida la ventana, la exportación vuelve a permitirse');
reset role;
select is((select count(*)::int from private.clientes_exportaciones_ventana
  where actor_id = 'd1000000-0000-0000-0000-000000000001' and filas_acumuladas = 3), 1, 'la ventana vencida empieza de cero');

-- Menor: el texto buscado (puede ser un DNI) no se escribe en la actividad.
select pg_temp.como('d1000000-0000-0000-0000-000000000001');
select count(*) from exportar_clientes('30111222');
reset role;
select is((select count(*)::int from registro_actividad where tipo = 'clientes.exportados' and detalle like '%30111222%'), 0,
  'el valor buscado no aparece en la actividad');

select * from finish();
rollback;
