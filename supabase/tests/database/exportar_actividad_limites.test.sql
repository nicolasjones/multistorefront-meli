-- MSF-170 (seguimiento de la revisión posterior a #793): límites de exportar_actividad.
-- Reciclaje del crédito de «misma página», filtros y corte fijados por id, y candado por persona contra la carrera del
-- límite por hora (en una sola sesión se verifica que el candado se toma; la concurrencia real no se puede simular en pgTAP).
begin;

select plan(12);

insert into organizaciones (id, nombre) values ('77777777-7777-7777-7777-777777777777', 'Organización Límites');
insert into auth.users (id, email) values ('b7000000-0000-0000-0000-000000000001', 'admin-limites@example.com');
insert into usuarios_organizacion (user_id, organizacion_id, rol_id) values
  ('b7000000-0000-0000-0000-000000000001', '77777777-7777-7777-7777-777777777777', 'administrador');
insert into registro_actividad (organizacion_id, tipo, detalle, creado_en)
select '77777777-7777-7777-7777-777777777777', 'lim.evento', 'Evento ' || g, '2026-09-01 00:00:00+00'::timestamptz + (g || ' seconds')::interval
  from generate_series(1, 5) g;
insert into registro_actividad (organizacion_id, tipo, detalle, creado_en)
values ('77777777-7777-7777-7777-777777777777', 'lim.otro', 'Otro', '2026-09-02 00:00:00+00');

select set_config('request.jwt.claims', json_build_object('sub', 'b7000000-0000-0000-0000-000000000001', 'role', 'authenticated')::text, true);
set local role authenticated;

-- Candado por organización y persona: se toma antes de contar el límite por hora.
select public.exportar_actividad(p_tipo => 'lim.evento', p_limite => 1);
-- La clave esperada: hashtextextended(org || uid, 0); en pg_locks la clave bigint se parte en classid (32 bits altos) y
-- objid (32 bits bajos), con objsubid = 1. Así no pasa si otro código toma un candado distinto.
select ok(
  exists (
    select 1
      from pg_locks l,
           lateral (select hashtextextended('77777777-7777-7777-7777-777777777777' || 'b7000000-0000-0000-0000-000000000001', 0) as k) h
     where l.locktype = 'advisory' and l.pid = pg_backend_pid() and l.granted and l.objsubid = 1
       and l.classid::bigint = ((h.k >> 32) & 4294967295)
       and l.objid::bigint = (h.k & 4294967295)),
  'la exportación toma el candado asesor transaccional de su organización y persona (carrera del límite por hora)');
select ok(
  (select prosrc ~ 'pg_advisory_xact_lock\(hashtextextended\(v_org::text' from pg_proc where oid = 'public.exportar_actividad(date, date, uuid, uuid, text, text, timestamptz, timestamptz, uuid, integer, integer, uuid, boolean)'::regprocedure),
  'y la función lo toma con la clave de organización y persona');

-- Reciclaje del crédito: una página de 3, repetida con un límite menor, no devuelve filas al contador.
select public.exportar_actividad(p_tipo => 'lim.evento', p_limite => 3, p_exportacion => 'c7000000-0000-0000-0000-000000000001');
reset role;
select is((select entregadas from private.exportaciones_actividad where id = 'c7000000-0000-0000-0000-000000000001'), 3, 'una página de 3 filas suma 3');
select set_config('request.jwt.claims', json_build_object('sub', 'b7000000-0000-0000-0000-000000000001', 'role', 'authenticated')::text, true);
set local role authenticated;
select public.exportar_actividad(p_tipo => 'lim.evento', p_limite => 1, p_exportacion => 'c7000000-0000-0000-0000-000000000001');
reset role;
select is((select entregadas from private.exportaciones_actividad where id = 'c7000000-0000-0000-0000-000000000001'), 4,
  'repetir el mismo cursor con un límite menor NO resta el crédito: entregadas pasa a 4 (antes bajaba a 1)');

-- Reintento de la MISMA página con el MISMO límite: no suma.
set local role authenticated;
select public.exportar_actividad(p_tipo => 'lim.evento', p_limite => 3, p_exportacion => 'c7000000-0000-0000-0000-000000000003');
select public.exportar_actividad(p_tipo => 'lim.evento', p_limite => 3, p_exportacion => 'c7000000-0000-0000-0000-000000000003');
reset role;
select is((select entregadas from private.exportaciones_actividad where id = 'c7000000-0000-0000-0000-000000000003'), 3,
  'reintentar la misma página con el mismo límite no suma entregadas');
-- Reintento con un límite MAYOR: reemplaza la entrega anterior (2 filas) por la nueva (3), no suma 2 + 3.
set local role authenticated;
select public.exportar_actividad(p_tipo => 'lim.evento', p_limite => 2, p_exportacion => 'c7000000-0000-0000-0000-000000000004');
select public.exportar_actividad(p_tipo => 'lim.evento', p_limite => 3, p_exportacion => 'c7000000-0000-0000-0000-000000000004');
reset role;
select is((select entregadas from private.exportaciones_actividad where id = 'c7000000-0000-0000-0000-000000000004'), 3,
  'reintentar la misma página con un límite mayor cuenta las filas únicas (3), no 2 + 3');

-- Filtros y corte fijados por id.
set local role authenticated;
select set_config('t.f1', public.exportar_actividad(p_tipo => 'lim.evento', p_limite => 2, p_exportacion => 'c7000000-0000-0000-0000-000000000002')::text, true);
select throws_ok(
  format($q$select public.exportar_actividad(p_tipo => 'lim.otro', p_limite => 2, p_exportacion => 'c7000000-0000-0000-0000-000000000002',
    p_cursor_creado_en => %L::timestamptz, p_cursor_id => %L::uuid)$q$,
    current_setting('t.f1')::jsonb -> 'siguiente' ->> 'creado_en', current_setting('t.f1')::jsonb -> 'siguiente' ->> 'id'),
  '22023', 'Los filtros no coinciden con los de la exportación iniciada: iniciá una nueva', 'cambiar el tipo con el mismo id se rechaza');
select throws_ok(
  format($q$select public.exportar_actividad(p_limite => 2, p_exportacion => 'c7000000-0000-0000-0000-000000000002',
    p_cursor_creado_en => %L::timestamptz, p_cursor_id => %L::uuid)$q$,
    current_setting('t.f1')::jsonb -> 'siguiente' ->> 'creado_en', current_setting('t.f1')::jsonb -> 'siguiente' ->> 'id'),
  '22023', 'Los filtros no coinciden con los de la exportación iniciada: iniciá una nueva', 'quitar el filtro con el mismo id también se rechaza');
select is(
  (public.exportar_actividad(p_tipo => 'lim.evento', p_limite => 2, p_exportacion => 'c7000000-0000-0000-0000-000000000002',
     p_corte => '2000-01-01 00:00:00+00',
     p_cursor_creado_en => (current_setting('t.f1')::jsonb -> 'siguiente' ->> 'creado_en')::timestamptz,
     p_cursor_id => (current_setting('t.f1')::jsonb -> 'siguiente' ->> 'id')::uuid) ->> 'corte')::timestamptz,
  (current_setting('t.f1')::jsonb ->> 'corte')::timestamptz,
  'el corte de la primera llamada manda: un p_corte distinto en las siguientes se ignora');
reset role;

-- Adopción de filas viejas: una exportación en curso durante el despliegue (sin hash ni corte) adopta los de su próxima
-- llamada y no falla.
insert into private.exportaciones_actividad (id, organizacion_id, usuario_id, cerrada, filtros_hash, corte)
values ('c7000000-0000-0000-0000-000000000005', '77777777-7777-7777-7777-777777777777', 'b7000000-0000-0000-0000-000000000001', false, null, null);
set local role authenticated;
select lives_ok(
  $$select public.exportar_actividad(p_tipo => 'lim.evento', p_limite => 2, p_exportacion => 'c7000000-0000-0000-0000-000000000005')$$,
  'una fila abierta sin hash ni corte no hace fallar la próxima llamada');
reset role;
select is((select filtros_hash is not null and corte is not null from private.exportaciones_actividad where id = 'c7000000-0000-0000-0000-000000000005'), true,
  'y adopta el hash y el corte de esa llamada');
set local role authenticated;
select throws_ok(
  $$select public.exportar_actividad(p_tipo => 'lim.otro', p_limite => 2, p_exportacion => 'c7000000-0000-0000-0000-000000000005')$$,
  '22023', 'Los filtros no coinciden con los de la exportación iniciada: iniciá una nueva', 'una vez adoptados, otro filtro con ese id se rechaza');
reset role;

select * from finish();
rollback;
