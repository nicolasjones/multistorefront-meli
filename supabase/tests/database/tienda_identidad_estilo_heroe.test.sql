-- MSF-848: «Estilo del encabezado de la portada» (`estilo_heroe`: oscuro | claro) y «Títulos del menú y botones en
-- mayúsculas» (`titulos_mayusculas`) en la identidad visual de la tienda, por configuración.
-- Verifica columnas y checks, el validador compartido (valores por defecto para borradores anteriores a la migración),
-- el resumen de cambios (rótulos nuevos y sin «cambio» fantasma), guardar en borrador, publicar, versiones,
-- restaurar, la vista previa y `publico.identidad_por_dominio` (lista blanca con las dos claves nuevas).
begin;

select plan(39);

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
  ('e1000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'Tienda B', true),
  ('e2000000-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', 'Tienda Dos', true);

insert into dominio.tiendas (organizacion_id, empresa_id, dominio) values
  ('11111111-1111-1111-1111-111111111111', 'e1000000-0000-0000-0000-000000000001', 'heroe-a.ejemplo.com'),
  ('11111111-1111-1111-1111-111111111111', 'e1000000-0000-0000-0000-000000000002', 'heroe-b.ejemplo.com'),
  ('22222222-2222-2222-2222-222222222222', 'e2000000-0000-0000-0000-000000000001', 'heroe-dos.ejemplo.com');

create function pg_temp.como(p_user uuid) returns void language plpgsql as $$
begin
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
  set local role authenticated;
end;
$$;

-- Identidad completa con los valores por defecto de la tienda; solo varían los dos campos nuevos.
create function pg_temp.ident(p_estilo text default null, p_mayusculas text default null) returns jsonb language sql as $$
  select jsonb_build_object(
    'color_primario', '#222222', 'color_primario_oscuro', '#000000', 'color_acento', '#222222', 'color_fondo', '#FFFFFF',
    'color_barra', '#222222', 'tipografia_titulos', 'system-ui', 'tipografia_texto', 'system-ui',
    'logo_ruta', null, 'banner_ruta', null, 'banner_movil_ruta', null)
    || case when p_estilo is null then '{}'::jsonb else jsonb_build_object('estilo_heroe', p_estilo) end
    || case when p_mayusculas is null then '{}'::jsonb else jsonb_build_object('titulos_mayusculas', p_mayusculas::jsonb) end;
$$;

-- ============================================================================
-- Estructura: columnas, defaults y checks
-- ============================================================================

select is(
  (select column_default from information_schema.columns
    where table_schema = 'dominio' and table_name = 'tienda_identidad' and column_name = 'estilo_heroe'),
  '''oscuro''::text', 'estilo_heroe vale oscuro por defecto'
);
select is(
  (select column_default from information_schema.columns
    where table_schema = 'dominio' and table_name = 'tienda_identidad' and column_name = 'titulos_mayusculas'),
  'true', 'titulos_mayusculas vale true por defecto'
);
select throws_ok(
  $$insert into dominio.tienda_identidad (empresa_id, organizacion_id, estilo_heroe)
    values ('e1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'verde')$$,
  '23514', null, 'un estilo de encabezado fuera de la lista cerrada se rechaza'
);
select throws_ok(
  $$insert into dominio.tienda_identidad (empresa_id, organizacion_id, titulos_mayusculas)
    values ('e1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', null)$$,
  '23502', null, 'titulos_mayusculas no admite null'
);
select is(
  (select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'guardar_tienda_identidad'),
  1, 'queda una sola firma de guardar_tienda_identidad (la de 11 argumentos se eliminó)'
);
select is(
  has_function_privilege('anon', 'public.guardar_tienda_identidad(uuid,text,text,text,text,text,text,text,text,text,text,text,boolean)', 'execute'),
  false, 'anon no ejecuta guardar_tienda_identidad'
);
select is(
  has_function_privilege('authenticated', 'public.guardar_tienda_identidad(uuid,text,text,text,text,text,text,text,text,text,text,text,boolean)', 'execute'),
  false, 'authenticated no ejecuta guardar_tienda_identidad: solo publicar_tienda (FR-052)'
);
select is(
  has_function_privilege('authenticated', 'public.publicar_tienda(uuid)', 'execute') and not has_function_privilege('anon', 'public.publicar_tienda(uuid)', 'execute'),
  true, 'publicar_tienda conserva sus grants (authenticated sí, anon no)'
);

-- ============================================================================
-- Validador compartido (borrador y RPC viva)
-- ============================================================================

select is(
  (select private.validar_tienda_identidad('11111111-1111-1111-1111-111111111111', 'e1000000-0000-0000-0000-000000000001', pg_temp.ident())
     -> 'estilo_heroe'),
  '"oscuro"'::jsonb, 'un borrador sin estilo_heroe (anterior a la migración) vale oscuro'
);
select is(
  (select private.validar_tienda_identidad('11111111-1111-1111-1111-111111111111', 'e1000000-0000-0000-0000-000000000001', pg_temp.ident())
     -> 'titulos_mayusculas'),
  'true'::jsonb, 'un borrador sin titulos_mayusculas vale true'
);
select is(
  (select private.validar_tienda_identidad('11111111-1111-1111-1111-111111111111', 'e1000000-0000-0000-0000-000000000001', pg_temp.ident('  CLARO ', 'false'))
     -> 'estilo_heroe'),
  '"claro"'::jsonb, 'el estilo se recorta y pasa a minúsculas'
);
select is(
  (select private.validar_tienda_identidad('11111111-1111-1111-1111-111111111111', 'e1000000-0000-0000-0000-000000000001', pg_temp.ident('claro', 'false'))
     -> 'titulos_mayusculas'),
  'false'::jsonb, 'titulos_mayusculas false se conserva'
);
select is(
  (select private.validar_tienda_identidad('11111111-1111-1111-1111-111111111111', 'e1000000-0000-0000-0000-000000000001', pg_temp.ident('claro', 'null'))
     -> 'titulos_mayusculas'),
  'true'::jsonb, 'titulos_mayusculas null (parámetro omitido en la RPC) vale true'
);
select throws_ok(
  $$select private.validar_tienda_identidad('11111111-1111-1111-1111-111111111111', 'e1000000-0000-0000-0000-000000000001', pg_temp.ident('verde'))$$,
  '22023', 'El estilo del encabezado de la portada debe ser «oscuro» o «claro»', 'un estilo fuera de la lista se rechaza'
);
select throws_ok(
  $$select private.validar_tienda_identidad('11111111-1111-1111-1111-111111111111', 'e1000000-0000-0000-0000-000000000001', pg_temp.ident('claro', '"si"'))$$,
  '22023', 'Las mayúsculas de los títulos deben ser verdadero o falso', 'titulos_mayusculas que no es booleano se rechaza'
);

-- Un borrador viejo (sin las claves) con la identidad por defecto no es un cambio frente a lo publicado por defecto.
select is(
  private.detalle_cambios_tienda('e1000000-0000-0000-0000-000000000001', pg_temp.ident(), null, null),
  '[]'::jsonb, 'sin claves nuevas y con los valores por defecto no hay «cambio» fantasma'
);
select is(
  private.detalle_cambios_tienda('e1000000-0000-0000-0000-000000000001', pg_temp.ident('claro', 'true'), null, null),
  '[{"area": "identidad", "campos": ["estilo del encabezado"]}]'::jsonb, 'cambiar solo el estilo cuenta como «estilo del encabezado»'
);
select is(
  private.detalle_cambios_tienda('e1000000-0000-0000-0000-000000000001', pg_temp.ident('oscuro', 'false'), null, null),
  '[{"area": "identidad", "campos": ["mayúsculas de los títulos"]}]'::jsonb, 'cambiar solo las mayúsculas cuenta como «mayúsculas de los títulos»'
);

-- ============================================================================
-- Borrador, publicación, versiones y vista previa
-- ============================================================================

select pg_temp.como('d1000000-0000-0000-0000-000000000001');

select lives_ok(
  $$select public.guardar_borrador_tienda('e1000000-0000-0000-0000-000000000001', 'identidad', pg_temp.ident('claro', 'false'))$$,
  'guardar en el borrador el estilo claro y sin mayúsculas'
);
select throws_ok(
  $$select public.guardar_borrador_tienda('e1000000-0000-0000-0000-000000000001', 'identidad', pg_temp.ident('verde'))$$,
  '22023', 'El estilo del encabezado de la portada debe ser «oscuro» o «claro»', 'el borrador rechaza un estilo inválido (mismo mensaje que la RPC viva)'
);
select is(
  public.obtener_borrador_tienda('e1000000-0000-0000-0000-000000000001') -> 'cambios' ->> 'resumen',
  'estilo del encabezado y mayúsculas de los títulos', 'el resumen del borrador usa los rótulos nuevos'
);
select is(
  (public.obtener_borrador_tienda('e1000000-0000-0000-0000-000000000001') -> 'cambios' ->> 'total')::int,
  2, 'cada campo nuevo cuenta como un cambio'
);
select is(
  public.vista_previa_tienda('e1000000-0000-0000-0000-000000000001') -> 'identidad' ->> 'estilo_heroe',
  'claro', 'la vista previa muestra el estilo del borrador'
);
select is(
  public.vista_previa_tienda('e1000000-0000-0000-0000-000000000001') -> 'identidad' -> 'titulos_mayusculas',
  'false'::jsonb, 'la vista previa muestra las mayúsculas del borrador (booleano)'
);

reset role;

select is(
  (select estilo_heroe || '|' || titulos_mayusculas::text from publico.identidad_por_dominio('heroe-a.ejemplo.com')),
  'oscuro|true', 'la identidad pública no cambió con el borrador (por defecto oscuro y con mayúsculas)'
);

select pg_temp.como('d1000000-0000-0000-0000-000000000001');
select is(
  public.publicar_tienda('e1000000-0000-0000-0000-000000000001') ->> 'version',
  '2', 'publicar crea la versión 2 (la 1 es la «Configuración inicial»)'
);
reset role;

select is(
  (select estilo_heroe || '|' || titulos_mayusculas::text from publico.identidad_por_dominio('heroe-a.ejemplo.com')),
  'claro|false', 'publicar aplica el estilo y las mayúsculas a la identidad pública'
);
select is(
  (select estilo_heroe || '|' || titulos_mayusculas::text from dominio.tienda_identidad where empresa_id = 'e1000000-0000-0000-0000-000000000001'),
  'claro|false', 'la fila de la identidad guarda los dos campos'
);
select is(
  (select string_agg(numero || ':' || resumen, ' | ' order by numero) from dominio.tienda_versiones where empresa_id = 'e1000000-0000-0000-0000-000000000001'),
  '1:Configuración inicial | 2:estilo del encabezado y mayúsculas de los títulos', 'las versiones registran el resumen con los rótulos nuevos'
);
select is(
  (select instantanea -> 'identidad' ->> 'estilo_heroe' || '|' || (instantanea -> 'identidad' -> 'titulos_mayusculas')::text
     from dominio.tienda_versiones where empresa_id = 'e1000000-0000-0000-0000-000000000001' and numero = 1),
  'oscuro|true', 'la versión 1 guarda el estado de antes de publicar (oscuro, con mayúsculas)'
);
select is(
  (select instantanea -> 'identidad' ->> 'estilo_heroe' || '|' || (instantanea -> 'identidad' -> 'titulos_mayusculas')::text
     from dominio.tienda_versiones where empresa_id = 'e1000000-0000-0000-0000-000000000001' and numero = 2),
  'claro|false', 'la versión 2 guarda el estado publicado'
);

-- Restaurar la versión 1 deja un borrador que vuelve al estilo oscuro y a las mayúsculas.
select pg_temp.como('d1000000-0000-0000-0000-000000000001');
select lives_ok(
  $$select public.restaurar_version_tienda('e1000000-0000-0000-0000-000000000001', 1)$$,
  'restaurar la versión 1 como borrador'
);
select is(
  public.obtener_borrador_tienda('e1000000-0000-0000-0000-000000000001') -> 'cambios' ->> 'resumen',
  'estilo del encabezado y mayúsculas de los títulos', 'restaurar propone volver al estilo oscuro y a las mayúsculas'
);
select is(
  public.vista_previa_tienda('e1000000-0000-0000-0000-000000000001') -> 'identidad' ->> 'estilo_heroe',
  'oscuro', 'la vista previa del borrador restaurado muestra el estilo oscuro'
);

-- ============================================================================
-- Aislamiento y permisos
-- ============================================================================

select pg_temp.como('d1000000-0000-0000-0000-000000000003');
select throws_ok(
  $$select public.guardar_borrador_tienda('e1000000-0000-0000-0000-000000000001', 'identidad', pg_temp.ident('claro', 'false'))$$,
  '42501', null, 'quien no tiene edición en Empresas no guarda el estilo'
);
select pg_temp.como('d2000000-0000-0000-0000-000000000001');
select throws_ok(
  $$select public.guardar_borrador_tienda('e1000000-0000-0000-0000-000000000001', 'identidad', pg_temp.ident('claro', 'false'))$$,
  'P0002', null, 'otra organización no guarda el estilo de esta tienda'
);
reset role;

select is(
  (select estilo_heroe || '|' || titulos_mayusculas::text from publico.identidad_por_dominio('heroe-b.ejemplo.com')),
  'oscuro|true', 'otra tienda sin identidad guardada devuelve los valores por defecto (aislamiento)'
);

set local role anon;
select is(
  (select count(*)::int from publico.identidad_por_dominio('heroe-a.ejemplo.com')),
  1, 'anon lee la identidad por la función pública'
);
reset role;
select is(
  pg_get_function_result('publico.identidad_por_dominio(text)'::regprocedure),
  'TABLE(color_primario text, color_primario_oscuro text, color_acento text, color_fondo text, color_barra text, tipografia_titulos text, tipografia_texto text, logo_ruta text, banner_ruta text, banner_movil_ruta text, estilo_heroe text, titulos_mayusculas boolean)',
  'lista blanca: la función pública agrega solo las dos claves nuevas'
);

select * from finish();
rollback;
