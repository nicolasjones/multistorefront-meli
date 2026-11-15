-- Seguridad retroactiva de la exportación de clientes: toda llamada con filas cuenta (también con cursor), el tope de 50000
-- filas rige sobre el acumulado de una ventana de 10 minutos por persona y filtros, y el texto buscado nunca llega a la actividad.
begin;

select plan(34);

insert into organizaciones (id, nombre) values ('11111111-1111-1111-1111-111111111111', 'Organización Uno');
insert into auth.users (id, email) values
  ('d1000000-0000-0000-0000-000000000001', 'admin-uno@example.com'),
  ('d1000000-0000-0000-0000-000000000005', 'admin-otro@example.com'),
  ('d1000000-0000-0000-0000-000000000006', 'exacto-ventana@example.com'),
  ('d1000000-0000-0000-0000-000000000007', 'rechazo-ventana@example.com'),
  ('d1000000-0000-0000-0000-000000000008', 'rechazo-diario@example.com'),
  ('d1000000-0000-0000-0000-000000000009', 'exacto-diario@example.com');
insert into usuarios_organizacion (user_id, organizacion_id, rol_id) values
  ('d1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'administrador'),
  ('d1000000-0000-0000-0000-000000000005', '11111111-1111-1111-1111-111111111111', 'administrador'),
  ('d1000000-0000-0000-0000-000000000006', '11111111-1111-1111-1111-111111111111', 'administrador'),
  ('d1000000-0000-0000-0000-000000000007', '11111111-1111-1111-1111-111111111111', 'administrador'),
  ('d1000000-0000-0000-0000-000000000008', '11111111-1111-1111-1111-111111111111', 'administrador'),
  ('d1000000-0000-0000-0000-000000000009', '11111111-1111-1111-1111-111111111111', 'administrador');
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

-- Reintento del primer lote: cuenta doble (contra la ventana y contra el día); no libera cupo.
create temp table previo as
  select coalesce(sum(filas), 0)::int as s from private.clientes_exportaciones_entregas
   where actor_id = 'd1000000-0000-0000-0000-000000000001';
select pg_temp.como('d1000000-0000-0000-0000-000000000001');
select count(*) from exportar_clientes('beta');
select count(*) from exportar_clientes('beta');
reset role;
select is((select sum(filas)::int from private.clientes_exportaciones_entregas
   where actor_id = 'd1000000-0000-0000-0000-000000000001' and filtros_hash <> 'otra-huella') - (select s from previo), 2,
  'reintento: repetir el primer lote suma las filas otra vez (cuenta doble)');
select is((select count(*)::int from private.clientes_exportaciones_entregas
   where actor_id = 'd1000000-0000-0000-0000-000000000001' and creado_en > now() - interval '10 minutes'),
  (select count(*)::int from private.clientes_exportaciones_entregas where actor_id = 'd1000000-0000-0000-0000-000000000001'),
  'reintento: ninguna entrega previa deja de contar en la ventana');

-- Tope de ventana POR PERSONA: la ventana de la persona queda en 50000 con otra huella de filtros.
insert into private.clientes_exportaciones_entregas (organizacion_id, actor_id, filtros_hash, filas)
select '11111111-1111-1111-1111-111111111111', 'd1000000-0000-0000-0000-000000000001', 'otra-huella',
       50000 - coalesce(sum(e.filas), 0)
  from private.clientes_exportaciones_entregas e where e.actor_id = 'd1000000-0000-0000-0000-000000000001';
create function pg_temp.hint_de(p_sql text) returns text language plpgsql as $f$
declare h text;
begin
  execute p_sql;
  return 'sin error';
exception when others then
  get stacked diagnostics h = pg_exception_hint;
  return coalesce(h, 'sin hint');
end $f$;
select pg_temp.como('d1000000-0000-0000-0000-000000000001');
select is(pg_temp.hint_de($q$select count(*) from exportar_clientes(null, null, false, (select c.id from clientes c order by lower(c.nombre), c.id limit 1))$q$),
  'tope_acumulado', 'el tope de 50000 en 10 minutos corta con el aviso de tope acumulado');
select is(pg_temp.hint_de($q$select count(*) from exportar_clientes('a', 'minorista', true, (select c.id from clientes c order by lower(c.nombre), c.id limit 1))$q$),
  'sin error', 'sin filas no hay nada que contar (control de la prueba siguiente)');
select is(pg_temp.hint_de($q$select count(*) from exportar_clientes('a', null, false, (select c.id from clientes c order by lower(c.nombre), c.id limit 1))$q$),
  'tope_acumulado', 'cambiar el texto de búsqueda NO reinicia el tope');
-- Ataque de la reiteración del primer lote: con la ventana llena, repetir el primer lote (p_limite=1) NO permite volver a bajar por cursor.
select is(pg_temp.hint_de($q$select count(*) from exportar_clientes(null, null, false, null, 1)$q$),
  'tope_acumulado', 'con la ventana llena, repetir el primer lote con p_limite=1 se rechaza');
select is(pg_temp.hint_de($q$select count(*) from exportar_clientes(null, null, false, (select c.id from clientes c order by lower(c.nombre), c.id limit 1))$q$),
  'tope_acumulado', 'tras repetir el primer lote el cursor sigue topado por la ventana');
reset role;
select is((select count(*)::int from registro_actividad where tipo = 'clientes.exportados'), 6,
  'las llamadas rechazadas no dejan evento');

-- Otra persona de la misma organización no comparte contador.
select pg_temp.como('d1000000-0000-0000-0000-000000000005');
select lives_ok(
  $q$select * from exportar_clientes(null, null, false, (select c.id from clientes c order by lower(c.nombre), c.id limit 1))$q$,
  'otra persona no comparte el contador ni el tope');

-- Pasados 10 minutos el tope de ventana se libera.
reset role;
update private.clientes_exportaciones_entregas set creado_en = creado_en - interval '11 minutes' where filtros_hash = 'otra-huella';
select pg_temp.como('d1000000-0000-0000-0000-000000000001');
select lives_ok(
  $q$select * from exportar_clientes(null, null, false, (select c.id from clientes c order by lower(c.nombre), c.id limit 1))$q$,
  'vencida la ventana, la exportación vuelve a permitirse');

-- Tope DIARIO: 24 horas deslizantes, por persona.
reset role;
insert into private.clientes_exportaciones_entregas (organizacion_id, actor_id, filtros_hash, filas, creado_en)
select '11111111-1111-1111-1111-111111111111', 'd1000000-0000-0000-0000-000000000001', 'diario',
       200000 - coalesce(sum(e.filas), 0), now() - interval '2 hours'
  from private.clientes_exportaciones_entregas e
 where e.actor_id = 'd1000000-0000-0000-0000-000000000001' and e.creado_en > now() - interval '1 day';
select pg_temp.como('d1000000-0000-0000-0000-000000000001');
select is(pg_temp.hint_de($q$select count(*) from exportar_clientes(null, 'mayorista', false, (select c.id from clientes c order by lower(c.nombre), c.id limit 1))$q$),
  'tope_diario', 'el tope diario corta aunque la ventana de 10 minutos esté libre');
select is(pg_temp.hint_de($q$select count(*) from exportar_clientes('a', 'minorista', true, (select c.id from clientes c order by lower(c.nombre), c.id limit 1))$q$),
  'sin error', 'control: sin filas no hay nada que contar');
select is(pg_temp.hint_de($q$select count(*) from exportar_clientes('a', null, false, (select c.id from clientes c order by lower(c.nombre), c.id limit 1))$q$),
  'tope_diario', 'cambiar el texto de búsqueda NO reinicia el tope diario');
select is(pg_temp.hint_de($q$select count(*) from exportar_clientes(null, 'minorista', false, null, 1)$q$),
  'tope_diario', 'cambiar la huella de filtros NO reinicia el tope diario (se suma por persona, no por huella)');

-- La purga está acotada: las filas de más de un día se borran y las tablas no crecen sin límite.
reset role;
insert into private.clientes_exportaciones_entregas (organizacion_id, actor_id, filtros_hash, filas, creado_en)
values ('11111111-1111-1111-1111-111111111111', 'd1000000-0000-0000-0000-000000000005', 'viejo', 5, now() - interval '2 days');
insert into private.clientes_exportaciones_ventana (organizacion_id, actor_id, filtros_hash, desde, filas_acumuladas, filas_declaradas)
values ('11111111-1111-1111-1111-111111111111', 'd1000000-0000-0000-0000-000000000005', 'viejo', now() - interval '2 days', 5, 5);
select pg_temp.como('d1000000-0000-0000-0000-000000000005');
select count(*) from exportar_clientes(null, null, false, (select c.id from clientes c order by lower(c.nombre), c.id limit 1));
reset role;
select is((select count(*)::int from private.clientes_exportaciones_entregas where filtros_hash = 'viejo'), 0, 'se purgan las entregas de más de un día');
select is((select count(*)::int from private.clientes_exportaciones_ventana where filtros_hash = 'viejo'), 0, 'se purgan las ventanas de más de un día');

-- Menor: el texto buscado (puede ser un DNI) no se escribe en la actividad.
select pg_temp.como('d1000000-0000-0000-0000-000000000005');
select count(*) from exportar_clientes('30111222');
reset role;
select is((select count(*)::int from registro_actividad where tipo = 'clientes.exportados' and detalle like '%30111222%'), 0,
  'el valor buscado no aparece en la actividad');

-- Rechazo temprano del primer lote: el total (4 clientes: los 3 del caso y el cliente por defecto de la organización) ya se conoce; si lo entregado + el total supera el tope, no se entrega ni cuenta.
reset role;
select count(*) as eventos_antes from registro_actividad where tipo = 'clientes.exportados' \gset
insert into private.clientes_exportaciones_entregas (organizacion_id, actor_id, filtros_hash, filas, creado_en) values
  ('11111111-1111-1111-1111-111111111111', 'd1000000-0000-0000-0000-000000000006', 'relleno', 50000 - 4, now()),
  ('11111111-1111-1111-1111-111111111111', 'd1000000-0000-0000-0000-000000000007', 'relleno', 50000 - 3, now()),
  ('11111111-1111-1111-1111-111111111111', 'd1000000-0000-0000-0000-000000000008', 'relleno', 200000 - 3, now() - interval '2 hours'),
  ('11111111-1111-1111-1111-111111111111', 'd1000000-0000-0000-0000-000000000009', 'relleno', 200000 - 4, now() - interval '2 hours');

select pg_temp.como('d1000000-0000-0000-0000-000000000007');
select is(pg_temp.hint_de($q$select count(*) from exportar_clientes(null, null, false, null, 1)$q$),
  'tope_acumulado', 'primer lote: acumulado + total excede el tope de ventana y se rechaza antes de entregar');
select pg_temp.como('d1000000-0000-0000-0000-000000000008');
select is(pg_temp.hint_de($q$select count(*) from exportar_clientes(null, null, false, null, 1)$q$),
  'tope_diario', 'primer lote: acumulado + total excede el tope diario y se rechaza antes de entregar');
reset role;
select is((select count(*)::int from private.clientes_exportaciones_entregas
  where actor_id in ('d1000000-0000-0000-0000-000000000007', 'd1000000-0000-0000-0000-000000000008') and filtros_hash <> 'relleno'), 0,
  'el rechazo temprano no cuenta ni entrega filas');
select is((select count(*)::int from registro_actividad where tipo = 'clientes.exportados'), :eventos_antes,
  'el rechazo temprano no deja evento');

select pg_temp.como('d1000000-0000-0000-0000-000000000006');
select is((select count(*)::int from exportar_clientes(null, null, false, null, 1)), 1,
  'caso límite: acumulado + total == tope de ventana pasa');
select pg_temp.como('d1000000-0000-0000-0000-000000000009');
select is((select count(*)::int from exportar_clientes(null, null, false, null, 1)), 1,
  'caso límite: acumulado + total == tope diario pasa');
-- Un cursor sin primer lote sigue topando por lote.
reset role;
insert into private.clientes_exportaciones_entregas (organizacion_id, actor_id, filtros_hash, filas, creado_en)
values ('11111111-1111-1111-1111-111111111111', 'd1000000-0000-0000-0000-000000000007', 'relleno2', 1, now());
select pg_temp.como('d1000000-0000-0000-0000-000000000007');
select is(pg_temp.hint_de($q$select count(*) from exportar_clientes(null, null, false, (select c.id from clientes c order by lower(c.nombre), c.id limit 1))$q$),
  'tope_acumulado', 'un cursor sin primer lote sigue topando por lote');

-- Concurrencia (estructura): el cupo se serializa por persona con un advisory lock tomado ANTES de calcular lo acumulado.
reset role;
select ok((select position('perform pg_advisory_xact_lock(' in p.prosrc) > 0
       and position('perform pg_advisory_xact_lock(' in p.prosrc) < position('sum(e.filas)' in p.prosrc)
  from pg_proc p where p.oid = 'public.exportar_clientes(text,text,boolean,uuid,integer,uuid,boolean)'::regprocedure),
  'exportar_clientes toma pg_advisory_xact_lock antes de calcular lo acumulado');

select * from finish();
rollback;
