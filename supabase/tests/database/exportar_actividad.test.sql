-- F-AUD-03 (MSF-278, épica MSF-170): exportar la actividad a CSV.
-- Cubre FR-010/FR-011 (permiso, filtros, tope), SC-004 (el total coincide con listar_actividad) y SC-005
-- (sin la acción no hay exportación; anon no ejecuta). Corre como postgres para armar el fixture y como
-- "authenticated" (request.jwt.claims, igual que PostgREST) para verificar.
--
-- Ojo con `now()`: dentro de esta transacción es una constante. Los eventos `actividad.exportada` que van
-- registrando las llamadas tienen `creado_en = now()`, o sea ≤ al corte, y entran en las exportaciones
-- siguientes. En producción cada llamada es su propia transacción y el corte de la primera es anterior al
-- evento. Por eso los conteos de abajo filtran por tipo o por período cuando una llamada previa ya registró.
begin;

select plan(54);

-- ============================================================================
-- Fixture (mismo que registro_actividad.test.sql)
-- ============================================================================

insert into organizaciones (id, nombre) values
  ('11111111-1111-1111-1111-111111111111', 'Organización Uno'),
  ('22222222-2222-2222-2222-222222222222', 'Organización Dos');

insert into auth.users (id, email) values
  ('b1000000-0000-0000-0000-000000000001', 'administrador@example.com'),
  ('b1000000-0000-0000-0000-000000000002', 'operador@example.com'),
  ('b1000000-0000-0000-0000-000000000003', 'consulta@example.com'),
  ('b1000000-0000-0000-0000-000000000006', 'administracion@example.com'),
  ('b2000000-0000-0000-0000-000000000001', 'admin-dos@example.com'),
  ('b9000000-0000-0000-0000-000000000009', 'sin-organizacion@example.com');

insert into usuarios_organizacion (user_id, organizacion_id, rol_id) values
  ('b1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'administrador'),
  ('b1000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'operador'),
  ('b1000000-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111', 'consulta'),
  ('b1000000-0000-0000-0000-000000000006', '11111111-1111-1111-1111-111111111111', 'administracion'),
  ('b2000000-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', 'administrador');

insert into auth.users (id, email) values
  ('b8000000-0000-0000-0000-000000000001', 'soporte-activo@example.com'),
  ('b8000000-0000-0000-0000-000000000002', 'soporte-sin-org@example.com');
insert into superadmins (user_id) values
  ('b8000000-0000-0000-0000-000000000001'), ('b8000000-0000-0000-0000-000000000002');
-- Modo soporte: el primero entró a la Organización Uno; el segundo no entró a ninguna.
insert into superadmin_organizacion_activa (user_id, organizacion_id) values
  ('b8000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111');

insert into dominio.empresas (id, organizacion_id, nombre) values
  ('e1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'Empresa A1'),
  ('e1000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'Empresa A2');

-- Horas elegidas para cruzar la medianoche de Buenos Aires (UTC-3):
--   a1: 2026-10-01 02:30 UTC = 30/09 23:30 en Buenos Aires
--   a2: 2026-10-01 03:30 UTC = 01/10 00:30 en Buenos Aires
insert into registro_actividad (id, organizacion_id, empresa_id, actor_id, actor_nombre, tipo, detalle, creado_en) values
  ('a0000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'e1000000-0000-0000-0000-000000000001',
    'b1000000-0000-0000-0000-000000000001', 'Ana Admin', 'producto.creado', 'Creó el producto Lámpara 100%', '2026-10-01 02:30:00+00'),
  ('a0000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'e1000000-0000-0000-0000-000000000002',
    'b1000000-0000-0000-0000-000000000002', 'Omar Operador', 'empresa.pausada', 'Se pausó la empresa', '2026-10-01 03:30:00+00'),
  ('a0000000-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111', null,
    'b1000000-0000-0000-0000-000000000001', 'Ana Admin', 'usuario.rol_cambiado', 'Cambió el rol de Ana', '2026-10-02 15:00:00+00'),
  ('a0000000-0000-0000-0000-000000000004', '11111111-1111-1111-1111-111111111111', 'e1000000-0000-0000-0000-000000000001',
    'b1000000-0000-0000-0000-000000000001', 'Ana Admin', 'producto.creado', 'Creó el producto Cañería', '2026-10-03 15:00:00+00'),
  ('a0000000-0000-0000-0000-000000000005', '22222222-2222-2222-2222-222222222222', null,
    'b2000000-0000-0000-0000-000000000001', 'Admin Dos', 'otra.cosa', 'Evento de la otra organización', '2026-10-02 12:00:00+00');

-- Organización Dos: exactamente 50.000 eventos 'carga.masiva' (filtro justo en el tope) + 1 'carga.extra' + el
-- 'otra.cosa' de arriba: el total sin filtro es 50.002 (excede el tope).
insert into registro_actividad (organizacion_id, tipo, detalle, creado_en)
select '22222222-2222-2222-2222-222222222222', 'carga.masiva', 'Evento ' || g,
       '2026-09-01 00:00:00+00'::timestamptz + (g || ' seconds')::interval
  from generate_series(1, 50000) g;
insert into registro_actividad (organizacion_id, tipo, detalle, creado_en)
values ('22222222-2222-2222-2222-222222222222', 'carga.extra', 'Evento extra', '2026-08-01 00:00:00+00');

create function pg_temp.como(p_user uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
  set local role authenticated;
end $$;

-- ============================================================================
-- Privilegios (SC-005)
-- ============================================================================

select is(has_function_privilege('anon', 'public.exportar_actividad(date, date, uuid, uuid, text, text, timestamptz, timestamptz, uuid, integer, integer, uuid, boolean)', 'EXECUTE'), false, 'anon no ejecuta exportar_actividad');
select is(has_function_privilege('authenticated', 'public.exportar_actividad(date, date, uuid, uuid, text, text, timestamptz, timestamptz, uuid, integer, integer, uuid, boolean)', 'EXECUTE'), true, 'authenticated ejecuta exportar_actividad');

-- ============================================================================
-- Permiso: solo quien tiene edición en Actividad y la acción exportar (CA-AUD-03-2)
-- ============================================================================

select pg_temp.como('b1000000-0000-0000-0000-000000000002');
select throws_ok($$select public.exportar_actividad()$$, '42501', null, 'el operador (lectura) no exporta aunque la matriz le dé la acción exportar');
reset role;

select pg_temp.como('b1000000-0000-0000-0000-000000000006');
select throws_ok($$select public.exportar_actividad()$$, '42501', null, 'administración (lectura) no exporta');
reset role;

select pg_temp.como('b1000000-0000-0000-0000-000000000003');
select throws_ok($$select public.exportar_actividad()$$, '42501', null, 'consulta (ninguno) no exporta');
reset role;

select pg_temp.como('b9000000-0000-0000-0000-000000000009');
select throws_ok($$select public.exportar_actividad()$$, '42501', null, 'una persona sin organización no exporta');
reset role;

-- ============================================================================
-- Administrador: filtro completo, columnas y orden (CA-AUD-03-1, SC-004)
-- ============================================================================

select pg_temp.como('b1000000-0000-0000-0000-000000000001');

-- Primera llamada sin filtros: todavía no hay eventos de exportación, así que son los 4 del fixture.
select set_config('t.todo', public.exportar_actividad(p_con_total => true)::text, true);
select is((current_setting('t.todo')::jsonb ->> 'total')::int, 4, 'el administrador exporta los 4 eventos de su organización (total real)');
select is(jsonb_array_length(current_setting('t.todo')::jsonb -> 'filas'), 4, 'la entrega trae las 4 filas');
select is(current_setting('t.todo')::jsonb -> 'filas' -> 0 ->> 'detalle', 'Creó el producto Cañería', 'va de lo más nuevo a lo más viejo, igual que el listado');
select is(current_setting('t.todo')::jsonb ->> 'recortado', 'false', 'con 4 filas no se recorta');

-- El total coincide con el «N» del listado para el mismo filtro (SC-004).
select is(
  (public.exportar_actividad(p_tipo => 'producto.creado', p_con_total => true) ->> 'total')::int,
  (select max(total)::int from public.listar_actividad(p_tipo => 'producto.creado')),
  'el total exportado coincide con el total de listar_actividad para el mismo filtro');
select is(jsonb_array_length(public.exportar_actividad(p_tipo => 'producto.creado') -> 'filas'), 2, 'el filtro por tipo trae solo esas filas');

-- Período en la zona de Buenos Aires: el 01/10 solo entra a2 (a1 es del 30/09 por la noche).
select is(jsonb_array_length(public.exportar_actividad(p_desde => '2026-10-01', p_hasta => '2026-10-01') -> 'filas'), 1, 'el período se mide en America/Argentina/Buenos_Aires');

-- Texto: sin tildes ni mayúsculas, y % se busca literal.
select is(jsonb_array_length(public.exportar_actividad(p_texto => 'LAMPARA') -> 'filas'), 1, 'la búsqueda de texto ignora tildes y mayúsculas');
select is(jsonb_array_length(public.exportar_actividad(p_texto => '%') -> 'filas'), 1, 'el % del texto se busca literal, no como comodín');

-- Tienda y usuario.
select is(jsonb_array_length(public.exportar_actividad(p_empresa => 'e1000000-0000-0000-0000-000000000001') -> 'filas'), 2, 'el filtro por tienda trae solo esa tienda');
select is((public.exportar_actividad(p_actor => 'b1000000-0000-0000-0000-000000000002', p_con_total => true) ->> 'total')::int, 1, 'el filtro por usuario trae solo sus eventos');

-- ============================================================================
-- Lotes y corte estable
-- ============================================================================

select set_config('t.p1', public.exportar_actividad(p_tipo => 'producto.creado', p_limite => 1)::text, true);
select is(jsonb_array_length(current_setting('t.p1')::jsonb -> 'filas'), 1, 'un lote de 1 trae 1 fila');
select is(current_setting('t.p1')::jsonb ->> 'hay_mas', 'true', 'avisa que hay más páginas');
select set_config('t.p2', public.exportar_actividad(p_tipo => 'producto.creado', p_limite => 1,
  p_cursor_creado_en => (current_setting('t.p1')::jsonb -> 'siguiente' ->> 'creado_en')::timestamptz,
  p_cursor_id => (current_setting('t.p1')::jsonb -> 'siguiente' ->> 'id')::uuid)::text, true);
select is(current_setting('t.p2')::jsonb -> 'filas' -> 0 ->> 'detalle', 'Creó el producto Lámpara 100%', 'el cursor sigue con la fila que sigue, sin repetir ni saltear');
select is(current_setting('t.p2')::jsonb ->> 'hay_mas', 'false', 'la última página dice que no hay más');
select is(current_setting('t.p1')::jsonb ->> 'total', '2', 'la primera llamada de una exportación trae el total (lo necesita la constancia)');
select throws_ok($$select public.exportar_actividad(p_cursor_id => 'a0000000-0000-0000-0000-000000000001')$$, '22023', null, 'un cursor incompleto se rechaza');
select is(
  (public.exportar_actividad(p_corte => '2026-10-01 12:00:00+00', p_con_total => true) ->> 'total')::int, 2,
  'con corte, solo entra lo anterior o igual a ese instante');

-- Parámetros inválidos.
select throws_ok($$select public.exportar_actividad(p_limite => 0)$$, '22023', null, 'un límite de 0 se rechaza');
select throws_ok($$select public.exportar_actividad(p_limite => 1001)$$, '22023', null, 'un límite mayor a 1000 se rechaza');
select lives_ok($$select public.exportar_actividad(p_entregadas => -1, p_tipo => 'zzz.inexistente')$$, 'p_entregadas lo manda el cliente y se ignora (no valida ni cuenta)');

-- ============================================================================
-- Registro de actividad.exportada (RF-AUD-03-2)
-- ============================================================================

select ok(
  exists (select 1 from registro_actividad where tipo = 'actividad.exportada' and detalle = 'Inició la exportación de 4 registros de la actividad a CSV'),
  'la exportación completa quedó registrada en la actividad, sin filtros');

select public.exportar_actividad(p_desde => '2026-10-01', p_hasta => '2026-10-03', p_tipo => 'producto.creado');
select ok(
  exists (select 1 from registro_actividad where tipo = 'actividad.exportada'
    and detalle = 'Inició la exportación de 1 registro de la actividad a CSV (filtros: desde el 01/10/2026, hasta el 03/10/2026, tipo producto.creado)'),
  'el evento deja los filtros usados, en palabras y sin ids');
reset role;

-- ============================================================================
-- Aislamiento y tope de 50.000 (CA-AUD-03-3), con el conteo en el servidor
-- ============================================================================

select pg_temp.como('b2000000-0000-0000-0000-000000000001');
select set_config('t.tope', public.exportar_actividad(p_limite => 100, p_con_total => true)::text, true);
select is((current_setting('t.tope')::jsonb ->> 'total')::int, 50002, 'el total es el real aunque supere el tope, y es solo de su organización');
select is(current_setting('t.tope')::jsonb ->> 'recortado', 'true', 'pasado el tope se avisa que se recortó');
select ok(
  exists (select 1 from registro_actividad where tipo = 'actividad.exportada' and detalle = 'Inició la exportación de 50002 registros de la actividad a CSV (supera el tope de 50000)'),
  'la primera llamada deja la constancia aunque el filtro exceda el tope, con el total real y el aviso del tope');

-- Un cliente que miente con p_entregadas = 0 en cada página no saltea el tope: lo cuenta el servidor.
do $$
declare r jsonb; c timestamptz; i uuid; n integer := 0;
begin
  loop
    r := public.exportar_actividad(p_limite => 1000, p_entregadas => 0, p_cursor_creado_en => c, p_cursor_id => i,
                                   p_exportacion => 'c0000000-0000-0000-0000-0000000000a1');
    n := n + jsonb_array_length(r -> 'filas');
    exit when not (r ->> 'hay_mas')::boolean;
    c := (r -> 'siguiente' ->> 'creado_en')::timestamptz;
    i := (r -> 'siguiente' ->> 'id')::uuid;
  end loop;
  perform set_config('t.mentira', n::text, true);
end $$;
select is(current_setting('t.mentira')::int, 50000, 'con p_entregadas = 0 mentido en cada página el archivo igual se corta en 50.000');
select throws_ok(
  $q$select public.exportar_actividad(p_limite => 1000, p_exportacion => 'c0000000-0000-0000-0000-0000000000a1')$q$,
  '22023', 'Esa exportación ya está registrada: iniciá una nueva', 'al llegar al tope el id queda cerrado');

-- Filtro de exactamente 50.000 filas: entra completo, sin recorte, en 50 lotes.
do $$
declare r jsonb; c timestamptz; i uuid; n integer := 0; llamadas integer := 0;
begin
  loop
    r := public.exportar_actividad(p_tipo => 'carga.masiva', p_limite => 1000, p_cursor_creado_en => c, p_cursor_id => i,
                                   p_exportacion => 'c0000000-0000-0000-0000-0000000000a2', p_con_total => (c is null));
    if llamadas = 0 then
      perform set_config('t.exacto_total', r ->> 'total', true);
      perform set_config('t.exacto_recortado', r ->> 'recortado', true);
    end if;
    n := n + jsonb_array_length(r -> 'filas');
    llamadas := llamadas + 1;
    exit when not (r ->> 'hay_mas')::boolean;
    c := (r -> 'siguiente' ->> 'creado_en')::timestamptz;
    i := (r -> 'siguiente' ->> 'id')::uuid;
  end loop;
  perform set_config('t.exacto_n', n::text, true);
  perform set_config('t.exacto_llamadas', llamadas::text, true);
end $$;
select is(current_setting('t.exacto_total')::int, 50000, 'un filtro de exactamente 50.000 filas informa ese total');
select is(current_setting('t.exacto_recortado'), 'false', 'y no se recorta (50.000 no excede el tope)');
select is(current_setting('t.exacto_n')::int, 50000, 'se entregan las 50.000 filas');
select is(current_setting('t.exacto_llamadas')::int, 50, 'en 50 lotes de 1.000');
reset role;

-- ============================================================================
-- Constancia en la primera llamada, cierre del id y abandono (MSF-170, hallazgo 1)
-- ============================================================================

select pg_temp.como('b1000000-0000-0000-0000-000000000001');
-- Exportación de 2 lotes (límite 1) con el mismo id.
select set_config('t.m1', public.exportar_actividad(p_desde => '2026-09-30', p_hasta => '2026-10-03', p_tipo => 'producto.creado',
  p_limite => 1, p_exportacion => 'c0000000-0000-0000-0000-000000000001', p_con_total => true)::text, true);
select is(current_setting('t.m1')::jsonb ->> 'total', '2', 'la primera llamada trae el total real');
select is(current_setting('t.m1')::jsonb ->> 'exportacion', 'c0000000-0000-0000-0000-000000000001', 'la respuesta devuelve el id de la corrida');
-- Abandonar tras la primera página ya dejó la constancia.
select is((select count(*)::int from registro_actividad where tipo = 'actividad.exportada' and detalle = 'Inició la exportación de 2 registros de la actividad a CSV (filtros: desde el 30/09/2026, hasta el 03/10/2026, tipo producto.creado)'), 1,
  'con un lote entregado y más pendientes la constancia ya está (paginar y abandonar no evita el rastro)');
select set_config('t.m2', public.exportar_actividad(p_desde => '2026-09-30', p_hasta => '2026-10-03', p_tipo => 'producto.creado',
  p_limite => 1, p_exportacion => 'c0000000-0000-0000-0000-000000000001',
  p_cursor_creado_en => (current_setting('t.m1')::jsonb -> 'siguiente' ->> 'creado_en')::timestamptz,
  p_cursor_id => (current_setting('t.m1')::jsonb -> 'siguiente' ->> 'id')::uuid)::text, true);
select is(current_setting('t.m2')::jsonb ->> 'hay_mas', 'false', 'la segunda página es la última');
select is((select count(*)::int from registro_actividad where tipo = 'actividad.exportada' and detalle like '%desde el 30/09/2026, hasta el 03/10/2026, tipo producto.creado%'), 1,
  'una exportación de varios lotes registra el evento exactamente UNA vez');
-- Id cerrado: reutilizarlo (incluido el reintento de la última página) se RECHAZA.
select throws_ok(
  $q$select public.exportar_actividad(p_desde => '2026-09-30', p_hasta => '2026-10-03', p_tipo => 'producto.creado',
       p_limite => 1, p_exportacion => 'c0000000-0000-0000-0000-000000000001',
       p_cursor_creado_en => (current_setting('t.m1')::jsonb -> 'siguiente' ->> 'creado_en')::timestamptz,
       p_cursor_id => (current_setting('t.m1')::jsonb -> 'siguiente' ->> 'id')::uuid)$q$,
  '22023', 'Esa exportación ya está registrada: iniciá una nueva', 'un id de exportación ya cerrado no se puede reutilizar (22023)');
select is((select count(*)::int from registro_actividad where tipo = 'actividad.exportada' and detalle like '%desde el 30/09/2026, hasta el 03/10/2026, tipo producto.creado%'), 1,
  'y el rechazo no registra el evento una segunda vez');
reset role;
select is((select cerrada and entregadas = 2 from private.exportaciones_actividad where id = 'c0000000-0000-0000-0000-000000000001'), true,
  'el servidor lleva el conteo y cierra el id al entregar la última fila');
select pg_temp.como('b1000000-0000-0000-0000-000000000001');
-- Otra exportación (otro id) con los mismos filtros sí es otra constancia.
select public.exportar_actividad(p_desde => '2026-09-30', p_hasta => '2026-10-03', p_tipo => 'producto.creado', p_exportacion => 'c0000000-0000-0000-0000-000000000002');
select is((select count(*)::int from registro_actividad where tipo = 'actividad.exportada' and detalle like '%desde el 30/09/2026, hasta el 03/10/2026, tipo producto.creado%'), 2,
  'otra exportación (otro id) deja su propia constancia');

-- Repetir la misma página (mismo id y mismo cursor) no suma lo entregado dos veces.
select set_config('t.r1', public.exportar_actividad(p_tipo => 'producto.creado', p_limite => 1, p_exportacion => 'c0000000-0000-0000-0000-000000000003')::text, true);
select public.exportar_actividad(p_tipo => 'producto.creado', p_limite => 1, p_exportacion => 'c0000000-0000-0000-0000-000000000003');
reset role;
select is((select entregadas from private.exportaciones_actividad where id = 'c0000000-0000-0000-0000-000000000003'), 1,
  'repetir la misma página no suma entregadas dos veces');
select pg_temp.como('b1000000-0000-0000-0000-000000000001');
select public.exportar_actividad(p_tipo => 'producto.creado', p_limite => 1, p_exportacion => 'c0000000-0000-0000-0000-000000000003',
  p_cursor_creado_en => (current_setting('t.r1')::jsonb -> 'siguiente' ->> 'creado_en')::timestamptz,
  p_cursor_id => (current_setting('t.r1')::jsonb -> 'siguiente' ->> 'id')::uuid);
reset role;
select is((select entregadas = 2 and cerrada from private.exportaciones_actividad where id = 'c0000000-0000-0000-0000-000000000003'), true,
  'y la página siguiente sí suma: 2 filas entregadas y el id cerrado');

-- ============================================================================
-- Superadmin en modo soporte (MSF-278, hallazgo 5): nivel_seccion nunca devuelve NULL
-- ============================================================================

select pg_temp.como('b8000000-0000-0000-0000-000000000001');
select is(private.nivel_seccion('actividad'), 'edicion', 'el superadmin en modo soporte resuelve edición en Actividad (no NULL)');
select is(private.puede_accion('actividad', 'exportar'), true, 'el superadmin en modo soporte puede la acción exportar (no NULL)');
select lives_ok($$select public.exportar_actividad(p_tipo => 'producto.creado')$$, 'el superadmin en modo soporte exporta la organización que entró');
reset role;

select pg_temp.como('b8000000-0000-0000-0000-000000000002');
select throws_ok($$select public.exportar_actividad()$$, '42501', null, 'el superadmin que no entró a ninguna organización no exporta');
reset role;

-- Límite de exportaciones nuevas por persona y hora: el control real es la constancia, no el tope.
insert into private.exportaciones_actividad (id, organizacion_id, usuario_id, cerrada)
select gen_random_uuid(), '22222222-2222-2222-2222-222222222222', 'b2000000-0000-0000-0000-000000000001', true
  from generate_series(1, 60);
select pg_temp.como('b2000000-0000-0000-0000-000000000001');
select throws_ok($$select public.exportar_actividad(p_tipo => 'carga.extra')$$, '22023',
  'Superaste el límite de 60 exportaciones por hora: esperá un rato e intentá de nuevo', 'pasadas 60 exportaciones nuevas en una hora se rechaza la siguiente');
reset role;

select * from finish();
rollback;
