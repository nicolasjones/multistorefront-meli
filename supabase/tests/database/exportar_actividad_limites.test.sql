-- MSF-170 (seguimiento de la revisión posterior a #793): límites de exportar_actividad.
-- Reciclaje del crédito de «misma página», filtros y corte fijados por id, y candado por persona contra la carrera del
-- límite por hora (en una sola sesión se verifica que el candado se toma; la concurrencia real no se puede simular en pgTAP).
begin;

select plan(6);

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
select ok(
  (select count(*) >= 1 from pg_locks where locktype = 'advisory' and pid = pg_backend_pid() and granted),
  'la exportación toma un candado asesor transaccional por organización y persona (carrera del límite por hora)');

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

select * from finish();
rollback;
