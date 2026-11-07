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

select plan(43);

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

-- 50.001 eventos más en la Organización Dos para probar el tope de 50.000 (total real = 50.002).
insert into registro_actividad (organizacion_id, tipo, detalle, creado_en)
select '22222222-2222-2222-2222-222222222222', 'carga.masiva', 'Evento ' || g,
       '2026-09-01 00:00:00+00'::timestamptz + (g || ' seconds')::interval
  from generate_series(1, 50001) g;

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
  p_cursor_id => (current_setting('t.p1')::jsonb -> 'siguiente' ->> 'id')::uuid, p_entregadas => 1)::text, true);
select is(current_setting('t.p2')::jsonb -> 'filas' -> 0 ->> 'detalle', 'Creó el producto Lámpara 100%', 'el cursor sigue con la fila que sigue, sin repetir ni saltear');
select is(current_setting('t.p2')::jsonb ->> 'hay_mas', 'false', 'la última página dice que no hay más');
select is(current_setting('t.p1')::jsonb ->> 'total', null, 'sin p_con_total no se calcula el total');
select throws_ok($$select public.exportar_actividad(p_cursor_id => 'a0000000-0000-0000-0000-000000000001')$$, '22023', null, 'un cursor incompleto se rechaza');
select is(
  (public.exportar_actividad(p_corte => '2026-10-01 12:00:00+00', p_con_total => true) ->> 'total')::int, 2,
  'con corte, solo entra lo anterior o igual a ese instante');

-- Parámetros inválidos.
select throws_ok($$select public.exportar_actividad(p_limite => 0)$$, '22023', null, 'un límite de 0 se rechaza');
select throws_ok($$select public.exportar_actividad(p_limite => 1001)$$, '22023', null, 'un límite mayor a 1000 se rechaza');
select throws_ok($$select public.exportar_actividad(p_entregadas => -1)$$, '22023', null, 'unas entregadas negativas se rechazan');

-- ============================================================================
-- Registro de actividad.exportada (RF-AUD-03-2)
-- ============================================================================

select ok(
  exists (select 1 from registro_actividad where tipo = 'actividad.exportada' and detalle = 'Exportó 4 registros de la actividad a CSV'),
  'la exportación completa quedó registrada en la actividad, sin filtros');

select public.exportar_actividad(p_desde => '2026-10-01', p_hasta => '2026-10-03', p_tipo => 'producto.creado');
select ok(
  exists (select 1 from registro_actividad where tipo = 'actividad.exportada'
    and detalle = 'Exportó 1 registro de la actividad a CSV (filtros: desde el 01/10/2026, hasta el 03/10/2026, tipo producto.creado)'),
  'el evento deja los filtros usados, en palabras y sin ids');
reset role;

-- ============================================================================
-- Aislamiento y tope de 50.000 (CA-AUD-03-3)
-- ============================================================================

select pg_temp.como('b2000000-0000-0000-0000-000000000001');
select set_config('t.tope', public.exportar_actividad(p_entregadas => 49990, p_limite => 100, p_con_total => true)::text, true);
select is((current_setting('t.tope')::jsonb ->> 'total')::int, 50002, 'el total es el real aunque supere el tope, y es solo de su organización');
select is(current_setting('t.tope')::jsonb ->> 'recortado', 'true', 'pasado el tope se avisa que se recortó');
select is(jsonb_array_length(current_setting('t.tope')::jsonb -> 'filas'), 10, 'el archivo no pasa de 50.000 filas (49.990 + 10)');
select is(jsonb_array_length(public.exportar_actividad(p_entregadas => 50000, p_limite => 100) -> 'filas'), 0, 'más allá de las 50.000 no entrega filas');
select ok(
  exists (select 1 from registro_actividad where tipo = 'actividad.exportada' and detalle = 'Exportó 50000 registros de la actividad a CSV'),
  'el evento cuenta lo que se exportó (el tope), no el total');
reset role;

-- ============================================================================
-- Constancia idempotente por exportación (MSF-278, hallazgo 4)
-- ============================================================================

select pg_temp.como('b1000000-0000-0000-0000-000000000001');
-- Exportación de 2 lotes (límite 1) con el mismo id: el evento queda registrado UNA sola vez.
select set_config('t.m1', public.exportar_actividad(p_desde => '2026-09-30', p_hasta => '2026-10-03', p_tipo => 'producto.creado',
  p_limite => 1, p_exportacion => 'c0000000-0000-0000-0000-000000000001', p_con_total => true)::text, true);
select is(current_setting('t.m1')::jsonb ->> 'total', '2', 'la primera llamada trae el total real');
select is((select count(*)::int from registro_actividad where tipo = 'actividad.exportada' and detalle like '%desde el 30/09/2026, hasta el 03/10/2026, tipo producto.creado%'), 0,
  'con un lote entregado y más pendientes todavía no hay constancia');
select set_config('t.m2', public.exportar_actividad(p_desde => '2026-09-30', p_hasta => '2026-10-03', p_tipo => 'producto.creado',
  p_limite => 1, p_entregadas => 1, p_exportacion => 'c0000000-0000-0000-0000-000000000001',
  p_cursor_creado_en => (current_setting('t.m1')::jsonb -> 'siguiente' ->> 'creado_en')::timestamptz,
  p_cursor_id => (current_setting('t.m1')::jsonb -> 'siguiente' ->> 'id')::uuid)::text, true);
select is((select count(*)::int from registro_actividad where tipo = 'actividad.exportada' and detalle = 'Exportó 2 registros de la actividad a CSV (filtros: desde el 30/09/2026, hasta el 03/10/2026, tipo producto.creado)'), 1,
  'una exportación de varios lotes registra el evento exactamente UNA vez');
-- Reintento de la última página con el mismo id: no se registra de nuevo.
select public.exportar_actividad(p_desde => '2026-09-30', p_hasta => '2026-10-03', p_tipo => 'producto.creado',
  p_limite => 1, p_entregadas => 1, p_exportacion => 'c0000000-0000-0000-0000-000000000001',
  p_cursor_creado_en => (current_setting('t.m1')::jsonb -> 'siguiente' ->> 'creado_en')::timestamptz,
  p_cursor_id => (current_setting('t.m1')::jsonb -> 'siguiente' ->> 'id')::uuid);
select is((select count(*)::int from registro_actividad where tipo = 'actividad.exportada' and detalle like '%desde el 30/09/2026, hasta el 03/10/2026, tipo producto.creado%'), 1,
  'un reintento de la última página no registra el evento dos veces');
-- Otra exportación (otro id) con los mismos filtros sí es otra constancia.
select public.exportar_actividad(p_desde => '2026-09-30', p_hasta => '2026-10-03', p_tipo => 'producto.creado', p_exportacion => 'c0000000-0000-0000-0000-000000000002');
select is((select count(*)::int from registro_actividad where tipo = 'actividad.exportada' and detalle like '%desde el 30/09/2026, hasta el 03/10/2026, tipo producto.creado%'), 2,
  'otra exportación (otro id) deja su propia constancia');
reset role;

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

select * from finish();
rollback;
