-- F-PRE-04 (MSF-286, épica MSF-116) · SC-005: historial de cotizaciones inmutable y `listar_cotizaciones`.
-- Cubre FR-016 (update/delete/truncate rechazados para todos los roles, salvo las acciones referenciales
-- de la base), FR-017 (orden, variación contra la fila anterior, paginación por cursor), aislamiento
-- entre dos organizaciones, permisos de `cotizacion_dolar` y `anon` sin ejecución.
begin;

select plan(35);

insert into organizaciones (id, nombre) values
  ('11111111-1111-1111-1111-111111111111', 'Organización Uno'),
  ('22222222-2222-2222-2222-222222222222', 'Organización Dos'),
  ('33333333-3333-3333-3333-333333333333', 'Organización Tres');

insert into auth.users (id, email) values
  ('d1000000-0000-0000-0000-000000000001', 'administrador@example.com'),
  ('d1000000-0000-0000-0000-000000000002', 'operador@example.com'),
  ('d1000000-0000-0000-0000-000000000003', 'deposito@example.com'),
  ('d2000000-0000-0000-0000-000000000001', 'admin-dos@example.com'),
  ('d9000000-0000-0000-0000-000000000009', 'quien-se-va@example.com');

-- cotizacion_dolar: administrador = edición, operador = lectura, deposito = ninguno.
insert into usuarios_organizacion (user_id, organizacion_id, rol_id) values
  ('d1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'administrador'),
  ('d1000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'operador'),
  ('d1000000-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111', 'deposito'),
  ('d2000000-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', 'administrador');

create function pg_temp.como(p_user uuid) returns void language plpgsql as $$
begin
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
  set local role authenticated;
end $$;

-- Organización Uno: 1000 → 1050 → 1050 (tres cargas, de la más vieja a la más nueva).
insert into dominio.cotizaciones (id, organizacion_id, valor, valor_anterior, variacion_pct, cargada_por, cargada_por_nombre, cargada_en, recalculo_aplicado, precios_recalculados) values
  ('c1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 1000, null, null, null, 'Javier', now() - interval '3 days', true, 12),
  ('c1000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 1050, 1000, 5, null, 'Emilse', now() - interval '2 days', true, 38),
  ('c1000000-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111', 1050, 1050, 0, null, 'Javier', now() - interval '1 day', false, 0);
-- Organización Dos: una carga vieja y otra reciente, de quien después se va.
insert into dominio.cotizaciones (organizacion_id, valor, cargada_por_nombre, cargada_en) values
  ('22222222-2222-2222-2222-222222222222', 2000, 'Marta', now() - interval '1 day');
-- Quien carga y se va (FK `on delete set null`) y una organización que se borra (FK `on delete cascade`).
insert into dominio.cotizaciones (id, organizacion_id, valor, cargada_por, cargada_por_nombre) values
  ('c9000000-0000-0000-0000-000000000009', '22222222-2222-2222-2222-222222222222', 2100, 'd9000000-0000-0000-0000-000000000009', 'Quien se va');
insert into dominio.cotizaciones (organizacion_id, valor, cargada_por_nombre) values
  ('33333333-3333-3333-3333-333333333333', 3000, 'Se borra con la organización');

-- ============================================================================
-- Privilegios
-- ============================================================================

select is(has_function_privilege('anon', 'public.listar_cotizaciones(integer, text)', 'EXECUTE'), false, 'anon no ejecuta listar_cotizaciones');
select is(has_function_privilege('authenticated', 'public.listar_cotizaciones(integer, text)', 'EXECUTE'), true, 'authenticated ejecuta listar_cotizaciones');
select is(
  has_table_privilege('authenticated', 'dominio.cotizaciones', 'insert')
    or has_table_privilege('authenticated', 'dominio.cotizaciones', 'update')
    or has_table_privilege('authenticated', 'dominio.cotizaciones', 'delete')
    or has_table_privilege('anon', 'dominio.cotizaciones', 'select'),
  false, 'authenticated no escribe el historial y anon no lo lee'
);

-- NOTA: TRUNCATE no llega al disparador cuando otra tabla referencia a cotizaciones:
-- Postgres responde 0A000 antes de evaluar triggers. Se verifica el RESULTADO
-- (nadie puede vaciar el historial), no el codigo de error ni el trigger.
-- ============================================================================
-- Inmutabilidad (FR-016): el dueño de la tabla (sin RLS ni grants de por medio)
-- ============================================================================

reset role;
select throws_ok($$update dominio.cotizaciones set valor = 1 where id = 'c1000000-0000-0000-0000-000000000001'$$, '42501', null, 'el dueño no puede modificar una fila');
select throws_ok($$delete from dominio.cotizaciones where id = 'c1000000-0000-0000-0000-000000000001'$$, '42501', null, 'el dueño no puede borrar una fila');
select throws_ok($$truncate dominio.cotizaciones$$, null, null, 'el dueño no puede vaciar el historial');
select throws_ok(
  $$update dominio.cotizaciones set cargada_por = null where id = 'c9000000-0000-0000-0000-000000000009'$$, '42501', null,
  'ni siquiera desasociar a quien cargó, si el cambio es directo'
);

-- Rol de servicio y administrador: el trigger es la segunda barrera, además de la falta de grants.
set local role service_role;
select throws_ok($$update dominio.cotizaciones set valor = 1$$, '42501', null, 'service_role no puede modificar el historial');
select throws_ok($$delete from dominio.cotizaciones$$, '42501', null, 'service_role no puede borrar el historial');

select pg_temp.como('d1000000-0000-0000-0000-000000000001');
select throws_ok($$update dominio.cotizaciones set valor = 1$$, '42501', null, 'el administrador no puede modificar el historial');
select throws_ok($$delete from dominio.cotizaciones$$, '42501', null, 'el administrador no puede borrar el historial');
select throws_ok($$truncate dominio.cotizaciones$$, null, null, 'el administrador no puede vaciar el historial');

-- Con los grants concedidos a propósito (se deshacen con el rollback), el rechazo ya es del trigger y no de los privilegios.
reset role;
grant usage on schema dominio to service_role, authenticated;
grant update, delete, truncate on dominio.cotizaciones to service_role, authenticated;
set local role service_role;
select throws_ok($$update dominio.cotizaciones set valor = 1$$, '42501', null, 'con grant, service_role sigue sin poder modificar (trigger)');
select throws_ok($$delete from dominio.cotizaciones$$, '42501', null, 'con grant, service_role sigue sin poder borrar (trigger)');
select throws_ok($$truncate dominio.cotizaciones$$, null, null, 'con grant, service_role sigue sin poder vaciar (trigger)');
select pg_temp.como('d1000000-0000-0000-0000-000000000001');
select throws_ok($$truncate dominio.cotizaciones$$, null, null, 'con grant, el administrador sigue sin poder vaciar (trigger)');

reset role;
select is((select valor from dominio.cotizaciones where id = 'c1000000-0000-0000-0000-000000000001'), 1000::numeric, 'la fila quedó intacta');

-- ============================================================================
-- Acciones referenciales de la base (única excepción)
-- ============================================================================

select lives_ok($$delete from auth.users where id = 'd9000000-0000-0000-0000-000000000009'$$, 'se puede borrar a quien cargó una cotización');
select is(
  (select cargada_por_nombre || '/' || coalesce(cargada_por::text, 'sin usuario') from dominio.cotizaciones where id = 'c9000000-0000-0000-0000-000000000009'),
  'Quien se va/sin usuario', 'la fila se conserva con el nombre y sin el usuario'
);
select lives_ok($$delete from public.organizaciones where id = '33333333-3333-3333-3333-333333333333'$$, 'se puede borrar una organización con historial');
select is((select count(*)::int from dominio.cotizaciones where organizacion_id = '33333333-3333-3333-3333-333333333333'), 0, 'su historial se va con ella');

-- ============================================================================
-- listar_cotizaciones: orden, variación y paginación (FR-017)
-- ============================================================================

select pg_temp.como('d1000000-0000-0000-0000-000000000001');

select is(jsonb_array_length(public.listar_cotizaciones(10, null) -> 'filas'), 3, 'lista las 3 cargas de la organización y ninguna otra');
select is(
  (select jsonb_agg(f ->> 'cargada_por_nombre') from jsonb_array_elements(public.listar_cotizaciones(10, null) -> 'filas') f),
  '["Javier", "Emilse", "Javier"]'::jsonb, 'más nueva primero'
);
select is(
  (select jsonb_agg(f -> 'variacion_pct') from jsonb_array_elements(public.listar_cotizaciones(10, null) -> 'filas') f),
  '[0.0000, 5.0000, null]'::jsonb, 'variación contra la fila anterior; la primera carga no tiene'
);
select is(
  (public.listar_cotizaciones(10, null) -> 'filas' -> 1 ->> 'precios_recalculados')::int, 38,
  'devuelve los precios recalculados de cada carga'
);

-- Página de 2: la última fila de la página toma su variación de la fila de más (no la pierde).
select is(jsonb_array_length(public.listar_cotizaciones(2, null) -> 'filas'), 2, 'la primera página trae solo p_limite filas');
select isnt(public.listar_cotizaciones(2, null) ->> 'siguiente_cursor', null, 'hay cursor cuando queda otra página');
select is((public.listar_cotizaciones(2, null) -> 'filas' -> 1 ->> 'variacion_pct')::numeric, 5::numeric, 'la última fila de la página conserva su variación');
select is(
  (select jsonb_agg(f ->> 'cargada_por_nombre') from jsonb_array_elements(
    public.listar_cotizaciones(2, public.listar_cotizaciones(2, null) ->> 'siguiente_cursor') -> 'filas') f),
  '["Javier"]'::jsonb, 'la segunda página sigue donde terminó la primera'
);
select is(
  public.listar_cotizaciones(2, public.listar_cotizaciones(2, null) ->> 'siguiente_cursor') ->> 'siguiente_cursor', null,
  'en la última página no hay cursor'
);
select throws_ok($$select public.listar_cotizaciones(10, 'no-es-un-cursor')$$, '22023', null, 'un cursor inválido se rechaza');

-- ============================================================================
-- Permisos y aislamiento
-- ============================================================================

select pg_temp.como('d1000000-0000-0000-0000-000000000002');
select is(jsonb_array_length(public.listar_cotizaciones(10, null) -> 'filas'), 3, 'con lectura se puede consultar el historial');

select pg_temp.como('d1000000-0000-0000-0000-000000000003');
select throws_ok($$select public.listar_cotizaciones(10, null)$$, '42501', null, 'sin acceso a cotizacion_dolar: rechazado');

select pg_temp.como('d2000000-0000-0000-0000-000000000001');
select is(
  (select jsonb_agg((f ->> 'valor')::numeric) from jsonb_array_elements(public.listar_cotizaciones(10, null) -> 'filas') f),
  '[2100, 2000]'::jsonb, 'la organización Dos ve solo su historial, la más nueva primero'
);

reset role;
set local role anon;
select throws_ok($$select public.listar_cotizaciones(10, null)$$, '42501', null, 'anon no puede ejecutar listar_cotizaciones');

select * from finish();
rollback;
