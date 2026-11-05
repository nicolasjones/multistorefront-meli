-- F-TDA-07 (MSF-235, épica MSF-133): versiones de la tienda y restauración como borrador.
-- Verifica FR-071 (listado: más nueva primero, autor, vigente), FR-073 (restaurar reemplaza el borrador sin
-- publicar ni tocar lo publicado), FR-074 (omite productos eliminados), FR-075 (no reescribe el historial;
-- publicar después crea versión nueva), permisos (anon, rol sin edición) y aislamiento entre organizaciones.
begin;

select plan(32);

-- ============================================================================
-- Fixture (como postgres)
-- ============================================================================

insert into organizaciones (id, nombre) values
  ('11111111-1111-1111-1111-111111111111', 'Organización Uno'),
  ('22222222-2222-2222-2222-222222222222', 'Organización Dos');

insert into auth.users (id, email) values
  ('d1000000-0000-0000-0000-000000000001', 'admin-uno@example.com'),
  ('d1000000-0000-0000-0000-000000000003', 'consulta-uno@example.com'),
  ('d2000000-0000-0000-0000-000000000001', 'admin-dos@example.com');

insert into usuarios_organizacion (user_id, organizacion_id, rol_id, estado) values
  ('d1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'administrador', 'activo'),
  ('d1000000-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111', 'consulta', 'activo'),
  ('d2000000-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', 'administrador', 'activo');

insert into dominio.empresas (id, organizacion_id, nombre, activa) values
  ('e1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'Tienda A', true),
  ('e2000000-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', 'Tienda Dos', true);

insert into dominio.tiendas (organizacion_id, empresa_id, dominio) values
  ('11111111-1111-1111-1111-111111111111', 'e1000000-0000-0000-0000-000000000001', 'ver-a.ejemplo.com'),
  ('22222222-2222-2222-2222-222222222222', 'e2000000-0000-0000-0000-000000000001', 'ver-dos.ejemplo.com');

insert into dominio.productos (id, organizacion_id, nombre, sku, precio_lista, moneda, activo) values
  ('a1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'Joystick', 'VJOY-1', 49.90, 'USD', true),
  ('a1000000-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111', 'Funda', 'VFUN-1', 5, 'USD', true);

insert into dominio.producto_empresa (producto_id, empresa_id, organizacion_id) values
  ('a1000000-0000-0000-0000-000000000001', 'e1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111'),
  ('a1000000-0000-0000-0000-000000000003', 'e1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111');

create function pg_temp.como(p_user uuid) returns void language plpgsql as $$
begin
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
  set local role authenticated;
end;
$$;

create function pg_temp.ident(p_color text) returns jsonb language sql as $$
  select jsonb_build_object(
    'color_primario', p_color, 'color_primario_oscuro', '#000000', 'color_acento', '#222222', 'color_fondo', '#FFFFFF',
    'tipografia_titulos', 'system-ui', 'tipografia_texto', 'system-ui',
    'logo_ruta', null, 'banner_ruta', null, 'banner_movil_ruta', null);
$$;

-- ============================================================================
-- Privilegios
-- ============================================================================

select is(has_function_privilege('anon', 'public.listar_versiones_tienda(uuid)', 'execute'), false, 'anon no ejecuta listar_versiones_tienda');
select is(has_function_privilege('anon', 'public.restaurar_version_tienda(uuid, integer)', 'execute'), false, 'anon no ejecuta restaurar_version_tienda');
select is(has_function_privilege('authenticated', 'public.listar_versiones_tienda(uuid)', 'execute'), true, 'authenticated ejecuta listar_versiones_tienda');
select is(has_function_privilege('authenticated', 'public.restaurar_version_tienda(uuid, integer)', 'execute'), true, 'authenticated ejecuta restaurar_version_tienda');

-- ============================================================================
-- Historial: v1 «Configuración inicial» (auto), v2 (rojo + 2 productos ocultos), v3 (verde)
-- ============================================================================

select pg_temp.como('d1000000-0000-0000-0000-000000000001');

select is(public.listar_versiones_tienda('e1000000-0000-0000-0000-000000000001'), '[]'::jsonb, 'sin publicar, el listado está vacío (FR-071)');

do $$ begin
  perform public.guardar_borrador_tienda('e1000000-0000-0000-0000-000000000001', 'identidad', pg_temp.ident('#C8102E'));
  perform public.guardar_borrador_tienda('e1000000-0000-0000-0000-000000000001', 'catalogo',
    '{"categorias":[],"productos":[{"id":"a1000000-0000-0000-0000-000000000001","visible":false,"destacado":false},{"id":"a1000000-0000-0000-0000-000000000003","visible":false,"destacado":false}]}'::jsonb);
  perform public.publicar_tienda('e1000000-0000-0000-0000-000000000001');
  perform public.guardar_borrador_tienda('e1000000-0000-0000-0000-000000000001', 'identidad', pg_temp.ident('#00FF00'));
  perform public.publicar_tienda('e1000000-0000-0000-0000-000000000001');
end $$;

select is(jsonb_array_length(public.listar_versiones_tienda('e1000000-0000-0000-0000-000000000001')), 3, 'el listado trae las tres versiones');
select is((public.listar_versiones_tienda('e1000000-0000-0000-0000-000000000001') -> 0 ->> 'numero')::int, 3, 'la más nueva va primero');
select is((public.listar_versiones_tienda('e1000000-0000-0000-0000-000000000001') -> 0 ->> 'vigente')::boolean, true, 'la última figura como vigente');
select is((public.listar_versiones_tienda('e1000000-0000-0000-0000-000000000001') -> 1 ->> 'vigente')::boolean, false, 'las anteriores no son vigentes');
select is(public.listar_versiones_tienda('e1000000-0000-0000-0000-000000000001') -> 0 ->> 'publicada_por', 'admin-uno@example.com', 'trae el nombre de quien publicó');
select is(public.listar_versiones_tienda('e1000000-0000-0000-0000-000000000001') -> 2 ->> 'resumen', 'Configuración inicial', 'la versión 1 es la configuración inicial');

-- ============================================================================
-- Restaurar: borrador, no publica, omite eliminados (FR-073, FR-074)
-- ============================================================================

reset role;
delete from dominio.productos where id = 'a1000000-0000-0000-0000-000000000003';
select pg_temp.como('d1000000-0000-0000-0000-000000000001');

select is(
  public.restaurar_version_tienda('e1000000-0000-0000-0000-000000000001', 2) ->> 'hay_borrador', 'true',
  'restaurar la versión 2 deja un borrador'
);
select is(
  public.obtener_borrador_tienda('e1000000-0000-0000-0000-000000000001') -> 'identidad' ->> 'color_primario',
  (select instantanea -> 'identidad' ->> 'color_primario' from dominio.tienda_versiones where empresa_id = 'e1000000-0000-0000-0000-000000000001' and numero = 2),
  'el borrador toma la identidad de la versión'
);
select is(
  (select count(*)::int from jsonb_array_elements(public.obtener_borrador_tienda('e1000000-0000-0000-0000-000000000001') -> 'catalogo' -> 'productos') p
    where p ->> 'id' = 'a1000000-0000-0000-0000-000000000001' and (p ->> 'visible')::boolean = false),
  1, 'el borrador conserva los productos de la versión'
);
select is(
  (select count(*)::int from jsonb_array_elements(public.obtener_borrador_tienda('e1000000-0000-0000-0000-000000000001') -> 'catalogo' -> 'productos') p
    where p ->> 'id' = 'a1000000-0000-0000-0000-000000000003'),
  0, 'omite el producto que ya no existe (FR-074)'
);
select is(
  (select count(*)::int from dominio.tienda_versiones where empresa_id = 'e1000000-0000-0000-0000-000000000001'),
  3, 'restaurar no crea versión ni reescribe el historial (FR-075)'
);
select is(
  (select lower(color_primario) from dominio.tienda_identidad where empresa_id = 'e1000000-0000-0000-0000-000000000001'),
  '#00ff00', 'restaurar no toca lo publicado'
);
select is(
  (select count(*)::int from public.registro_actividad where tipo = 'tienda.version_restaurada' and empresa_id = 'e1000000-0000-0000-0000-000000000001'),
  1, 'queda auditoría de la restauración'
);

-- Restaurar otra versión REEMPLAZA el borrador: la 1 no oculta nada, así que el Joystick oculto vuelve a visible.
select lives_ok(
  $$select public.restaurar_version_tienda('e1000000-0000-0000-0000-000000000001', 1)$$,
  'restaurar la versión 1 reemplaza el borrador anterior'
);
select is(
  (select count(*)::int from jsonb_array_elements(public.obtener_borrador_tienda('e1000000-0000-0000-0000-000000000001') -> 'catalogo' -> 'productos') p
    where p ->> 'id' = 'a1000000-0000-0000-0000-000000000001' and (p ->> 'visible')::boolean = true),
  1, 'lo que la versión no menciona vuelve al predeterminado'
);
select is(
  public.obtener_borrador_tienda('e1000000-0000-0000-0000-000000000001') -> 'identidad' ->> 'color_primario',
  (select instantanea -> 'identidad' ->> 'color_primario' from dominio.tienda_versiones where empresa_id = 'e1000000-0000-0000-0000-000000000001' and numero = 1),
  'el borrador toma la identidad de la versión 1'
);

-- Publicar después crea una versión nueva y deja intactas las anteriores (FR-075).
select is(public.publicar_tienda('e1000000-0000-0000-0000-000000000001') ->> 'version', '4', 'publicar lo restaurado crea la versión 4');
select is(
  (select instantanea -> 'identidad' ->> 'color_primario' from dominio.tienda_versiones where empresa_id = 'e1000000-0000-0000-0000-000000000001' and numero = 4),
  (select instantanea -> 'identidad' ->> 'color_primario' from dominio.tienda_versiones where empresa_id = 'e1000000-0000-0000-0000-000000000001' and numero = 1),
  'la versión 4 queda igual a la 1'
);
select is(
  (select lower(instantanea -> 'identidad' ->> 'color_primario') from dominio.tienda_versiones where empresa_id = 'e1000000-0000-0000-0000-000000000001' and numero = 3),
  '#00ff00', 'la versión 3 no se reescribió'
);

-- ============================================================================
-- Errores y permisos
-- ============================================================================

select throws_ok(
  $$select public.restaurar_version_tienda('e1000000-0000-0000-0000-000000000001', 99)$$,
  'P0002', null, 'una versión inexistente no se restaura'
);
select throws_ok(
  $$select public.restaurar_version_tienda('e1000000-0000-0000-0000-000000000001', 4)$$,
  '22023', null, 'la versión vigente no se restaura'
);

select pg_temp.como('d1000000-0000-0000-0000-000000000003');
select throws_ok(
  $$select public.restaurar_version_tienda('e1000000-0000-0000-0000-000000000001', 2)$$,
  '42501', null, 'quien no tiene edición en Empresas no restaura'
);

select pg_temp.como('d2000000-0000-0000-0000-000000000001');
select throws_ok(
  $$select public.listar_versiones_tienda('e1000000-0000-0000-0000-000000000001')$$,
  'P0002', null, 'otra organización no lista las versiones de esta empresa'
);
select throws_ok(
  $$select public.restaurar_version_tienda('e1000000-0000-0000-0000-000000000001', 2)$$,
  'P0002', null, 'otra organización no restaura versiones de esta empresa'
);
select is((select count(*)::int from dominio.tienda_versiones), 0, 'RLS: otra organización no ve ninguna versión');

reset role;
set local role anon;
select throws_ok($$select public.listar_versiones_tienda('e1000000-0000-0000-0000-000000000001')$$, '42501', null, 'anon no lista versiones');
select throws_ok($$select public.restaurar_version_tienda('e1000000-0000-0000-0000-000000000001', 2)$$, '42501', null, 'anon no restaura versiones');
reset role;

select * from finish();
rollback;
