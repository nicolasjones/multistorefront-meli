-- F-TDA-02 (MSF-266, épica MSF-147): identidad visual de la tienda online.
-- Verifica FR-020, FR-024 (checks de color y tipografía), FR-028 (RPC: permisos, idempotencia,
-- revoke), FR-029 (bucket y políticas, evento de auditoría) y FR-030 (función pública, `anon`
-- solo lee por función). Aislamiento entre organizaciones (SC-001).
begin;

select plan(52);

-- ============================================================================
-- Fixture (como postgres)
-- ============================================================================

insert into organizaciones (id, nombre) values
  ('11111111-1111-1111-1111-111111111111', 'Organización Uno'),
  ('22222222-2222-2222-2222-222222222222', 'Organización Dos');

insert into auth.users (id, email) values
  ('d1000000-0000-0000-0000-000000000001', 'admin-uno@example.com'),
  ('d1000000-0000-0000-0000-000000000002', 'miembro-uno@example.com'),
  ('d2000000-0000-0000-0000-000000000001', 'admin-dos@example.com');

insert into usuarios_organizacion (user_id, organizacion_id, rol_id) values
  ('d1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'administrador'),
  ('d1000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'miembro'),
  ('d2000000-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', 'administrador');

insert into dominio.empresas (id, organizacion_id, nombre, activa) values
  ('e1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'Uno A', true),
  ('e1000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'Uno B', false),
  ('e2000000-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', 'Dos A', true);

insert into dominio.tiendas (organizacion_id, empresa_id, dominio) values
  ('11111111-1111-1111-1111-111111111111', 'e1000000-0000-0000-0000-000000000001', 'uno-a.ejemplo.com'),
  ('11111111-1111-1111-1111-111111111111', 'e1000000-0000-0000-0000-000000000002', 'uno-b.ejemplo.com'),
  ('22222222-2222-2222-2222-222222222222', 'e2000000-0000-0000-0000-000000000001', 'dos-a.ejemplo.com');

-- ============================================================================
-- Estructura y privilegios (FR-020, FR-028, FR-030)
-- ============================================================================

select is(
  (select relrowsecurity from pg_class where oid = 'dominio.tienda_identidad'::regclass),
  true,
  'dominio.tienda_identidad tiene RLS activado'
);
select is(has_table_privilege('anon', 'dominio.tienda_identidad', 'select'), false, 'anon no lee dominio.tienda_identidad');
select is(has_table_privilege('authenticated', 'dominio.tienda_identidad', 'insert'), false, 'authenticated no inserta directo: solo por la RPC');
select is(has_table_privilege('authenticated', 'dominio.tienda_identidad', 'update'), false, 'authenticated no actualiza directo: solo por la RPC');
select is(has_table_privilege('authenticated', 'dominio.tienda_identidad', 'delete'), false, 'authenticated no borra directo');
select is(
  has_function_privilege('anon', 'public.guardar_tienda_identidad(uuid,text,text,text,text,text,text,text,text,text)', 'execute'),
  false,
  'anon no ejecuta public.guardar_tienda_identidad'
);
select is(
  has_function_privilege('authenticated', 'public.guardar_tienda_identidad(uuid,text,text,text,text,text,text,text,text,text)', 'execute'),
  true,
  'authenticated ejecuta public.guardar_tienda_identidad'
);
select is(
  has_function_privilege('anon', 'publico.identidad_por_dominio(text)', 'execute'),
  true,
  'anon ejecuta publico.identidad_por_dominio'
);
select is(
  (select count(*)::int
     from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'publico' and c.relkind in ('r', 'p')),
  0,
  'el esquema publico sigue sin tablas'
);

-- ============================================================================
-- Checks de la tabla (FR-020, FR-024)
-- ============================================================================

select throws_ok(
  $$insert into dominio.tienda_identidad (empresa_id, organizacion_id, color_primario)
    values ('e1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'rojo')$$,
  '23514', null, 'un color que no es #RRGGBB se rechaza'
);
select throws_ok(
  $$insert into dominio.tienda_identidad (empresa_id, organizacion_id, color_fondo)
    values ('e1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', '#FFF')$$,
  '23514', null, 'el color abreviado #RGB se rechaza'
);
select throws_ok(
  $$insert into dominio.tienda_identidad (empresa_id, organizacion_id, tipografia_titulos)
    values ('e1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'Comic Sans')$$,
  '23514', null, 'una tipografía de Títulos fuera de la lista se rechaza'
);
select throws_ok(
  $$insert into dominio.tienda_identidad (empresa_id, organizacion_id, tipografia_texto)
    values ('e1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'x;}body{display:none')$$,
  '23514', null, 'una tipografía de Texto fuera de la lista se rechaza (no inyecta CSS)'
);
select throws_ok(
  $$insert into dominio.tienda_identidad (empresa_id, organizacion_id, logo_ruta)
    values ('e1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111',
            '22222222-2222-2222-2222-222222222222/e2000000-0000-0000-0000-000000000001/logo.png')$$,
  '23514', null, 'la ruta del logo no puede apuntar a la carpeta de otra empresa'
);
select throws_ok(
  $$insert into dominio.tienda_identidad (empresa_id, organizacion_id)
    values ('e2000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111')$$,
  '23503', null, 'la FK compuesta impide cruzar la identidad con una empresa de otra organización'
);

-- ============================================================================
-- Bucket (FR-029)
-- ============================================================================

select is(
  (select public::text || '|' || file_size_limit::text from storage.buckets where id = 'tienda-identidad'),
  'true|3145728',
  'bucket tienda-identidad: lectura pública y tope de 3 MB'
);
select is(
  (select array_to_string(allowed_mime_types, ',') from storage.buckets where id = 'tienda-identidad'),
  'image/png,image/svg+xml,image/jpeg,image/webp',
  'bucket tienda-identidad: solo PNG, SVG, JPG y WebP'
);

-- ============================================================================
-- Tema base sin fila y lectura anónima (FR-030)
-- ============================================================================

select set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);
set local role anon;

select is(
  (select color_primario || '|' || tipografia_titulos || '|' || coalesce(logo_ruta, 'sin-logo')
     from publico.identidad_por_dominio('uno-a.ejemplo.com')),
  '#222222|system-ui|sin-logo',
  'sin fila de identidad, la función pública devuelve el tema base'
);
select is(
  (select count(*)::int from publico.identidad_por_dominio('desconocido.ejemplo.com')),
  0,
  'dominio desconocido: sin filas'
);
select is(
  (select count(*)::int from publico.identidad_por_dominio('uno-b.ejemplo.com')),
  0,
  'empresa desactivada: sin filas (igual que dominio desconocido)'
);
select throws_ok(
  $$select * from dominio.tienda_identidad$$,
  '42501', null, 'anon no puede leer dominio.tienda_identidad'
);
select throws_ok(
  $$select public.guardar_tienda_identidad('e1000000-0000-0000-0000-000000000001', '#112233', '#112233', '#112233', '#FFFFFF', 'Lato', 'Lato')$$,
  '42501', null, 'anon no puede guardar identidad'
);
select throws_ok(
  $$insert into storage.objects (bucket_id, name, owner) values
      ('tienda-identidad', '11111111-1111-1111-1111-111111111111/e1000000-0000-0000-0000-000000000001/logo.png', null)$$,
  '42501', null, 'anon no sube archivos al bucket'
);
reset role;

-- ============================================================================
-- RPC: permisos (FR-028)
-- ============================================================================

select set_config(
  'request.jwt.claims',
  json_build_object('sub', 'd1000000-0000-0000-0000-000000000002', 'role', 'authenticated')::text,
  true
);
set local role authenticated;

select throws_ok(
  $$select public.guardar_tienda_identidad('e1000000-0000-0000-0000-000000000001', '#112233', '#112233', '#112233', '#FFFFFF', 'Lato', 'Lato')$$,
  '42501', null, 'un miembro sin edición en Empresas no puede guardar'
);
select throws_ok(
  $$insert into storage.objects (bucket_id, name, owner) values
      ('tienda-identidad', '11111111-1111-1111-1111-111111111111/e1000000-0000-0000-0000-000000000001/logo.png', 'd1000000-0000-0000-0000-000000000002')$$,
  '42501', null, 'un miembro sin edición no sube al bucket'
);
reset role;

-- ============================================================================
-- RPC: validaciones, guardado e idempotencia (FR-028)
-- ============================================================================

select set_config(
  'request.jwt.claims',
  json_build_object('sub', 'd1000000-0000-0000-0000-000000000001', 'role', 'authenticated')::text,
  true
);
set local role authenticated;

select throws_ok(
  $$select public.guardar_tienda_identidad('e2000000-0000-0000-0000-000000000001', '#112233', '#112233', '#112233', '#FFFFFF', 'Lato', 'Lato')$$,
  'P0002', null, 'no se guarda la identidad de una empresa de otra organización'
);
select throws_ok(
  $$select public.guardar_tienda_identidad('e1000000-0000-0000-0000-000000000001', 'azul', '#112233', '#112233', '#FFFFFF', 'Lato', 'Lato')$$,
  '22023', null, 'color primario inválido'
);
select throws_ok(
  $$select public.guardar_tienda_identidad('e1000000-0000-0000-0000-000000000001', '#112233', '#112233', '#112233', null, 'Lato', 'Lato')$$,
  '22023', null, 'color de fondo ausente'
);
select throws_ok(
  $$select public.guardar_tienda_identidad('e1000000-0000-0000-0000-000000000001', '#112233', '#112233', '#112233', '#FFFFFF', 'Comic Sans', 'Lato')$$,
  '22023', null, 'tipografía de Títulos fuera de la lista'
);
select throws_ok(
  $$select public.guardar_tienda_identidad('e1000000-0000-0000-0000-000000000001', '#112233', '#112233', '#112233', '#FFFFFF', 'Lato', 'Papyrus')$$,
  '22023', null, 'tipografía de Texto fuera de la lista'
);
select throws_ok(
  $$select public.guardar_tienda_identidad('e1000000-0000-0000-0000-000000000001', '#112233', '#112233', '#112233', '#FFFFFF', 'Lato', 'Lato',
      '11111111-1111-1111-1111-111111111111/e1000000-0000-0000-0000-000000000002/logo.png')$$,
  '22023', null, 'el logo debe estar en la carpeta de la propia empresa'
);
select throws_ok(
  $$select public.guardar_tienda_identidad('e1000000-0000-0000-0000-000000000001', '#112233', '#112233', '#112233', '#FFFFFF', 'Lato', 'Lato',
      null, '11111111-1111-1111-1111-111111111111/e1000000-0000-0000-0000-000000000001/../x.png')$$,
  '22023', null, 'una ruta con subcarpetas o «..» se rechaza'
);

select is(
  (select color_primario || '|' || color_fondo || '|' || tipografia_titulos
     from public.guardar_tienda_identidad(
       'e1000000-0000-0000-0000-000000000001', ' #c8102e ', '#7a0a12', '#C8102E', '#ffffff', 'Barlow Condensed', 'Barlow',
       '11111111-1111-1111-1111-111111111111/e1000000-0000-0000-0000-000000000001/logo-1.png',
       '11111111-1111-1111-1111-111111111111/e1000000-0000-0000-0000-000000000001/banner-1.webp',
       null)),
  '#C8102E|#FFFFFF|Barlow Condensed',
  'guardar normaliza los colores a mayúsculas y devuelve la fila'
);
reset role;

select is(
  (select count(*)::int from public.registro_actividad
    where tipo = 'tienda.identidad_actualizada' and organizacion_id = '11111111-1111-1111-1111-111111111111'
      and empresa_id = 'e1000000-0000-0000-0000-000000000001'
      and actor_id = 'd1000000-0000-0000-0000-000000000001'),
  1,
  'guardar deja el evento tienda.identidad_actualizada con actor y empresa'
);

create temp table _antes as
  select updated_at from dominio.tienda_identidad where empresa_id = 'e1000000-0000-0000-0000-000000000001';

select set_config(
  'request.jwt.claims',
  json_build_object('sub', 'd1000000-0000-0000-0000-000000000001', 'role', 'authenticated')::text,
  true
);
set local role authenticated;

select lives_ok(
  $$select public.guardar_tienda_identidad(
      'e1000000-0000-0000-0000-000000000001', '#C8102E', '#7A0A12', '#C8102E', '#FFFFFF', 'Barlow Condensed', 'Barlow',
      '11111111-1111-1111-1111-111111111111/e1000000-0000-0000-0000-000000000001/logo-1.png',
      '11111111-1111-1111-1111-111111111111/e1000000-0000-0000-0000-000000000001/banner-1.webp',
      null)$$,
  'guardar los mismos valores otra vez no falla'
);
reset role;

select is(
  (select count(*)::int from public.registro_actividad where tipo = 'tienda.identidad_actualizada'),
  1,
  'idempotente: guardar sin cambios no registra otro evento'
);
select is(
  (select i.updated_at = a.updated_at
     from dominio.tienda_identidad i, _antes a
    where i.empresa_id = 'e1000000-0000-0000-0000-000000000001'),
  true,
  'idempotente: guardar sin cambios no toca updated_at'
);

select set_config(
  'request.jwt.claims',
  json_build_object('sub', 'd1000000-0000-0000-0000-000000000001', 'role', 'authenticated')::text,
  true
);
set local role authenticated;
select lives_ok(
  $$select public.guardar_tienda_identidad(
      'e1000000-0000-0000-0000-000000000001', '#C8102E', '#7A0A12', '#C8102E', '#FAF7F0', 'Playfair Display', 'Lato',
      '11111111-1111-1111-1111-111111111111/e1000000-0000-0000-0000-000000000001/logo-1.png', null, null)$$,
  'guardar con cambios (quitar banner, nuevo fondo y tipografías) funciona'
);
reset role;

select is(
  (select count(*)::int from public.registro_actividad where tipo = 'tienda.identidad_actualizada'),
  2,
  'un cambio real registra un segundo evento'
);
select is(
  (select detalle like '%Uno A%' from public.registro_actividad
    where tipo = 'tienda.identidad_actualizada' order by creado_en desc, id limit 1),
  true,
  'el detalle del evento nombra la empresa'
);

-- ============================================================================
-- Aislamiento entre organizaciones (SC-001)
-- ============================================================================

select set_config(
  'request.jwt.claims',
  json_build_object('sub', 'd2000000-0000-0000-0000-000000000001', 'role', 'authenticated')::text,
  true
);
set local role authenticated;

select is(
  (select count(*)::int from dominio.tienda_identidad),
  0,
  'el administrador de la organización Dos no ve la identidad de la organización Uno'
);
select lives_ok(
  $$select public.guardar_tienda_identidad('e2000000-0000-0000-0000-000000000001', '#0A7D32', '#075A24', '#0A7D32', '#FFFFFF', 'Sora', 'Sora')$$,
  'la organización Dos guarda su propia identidad'
);
reset role;

select set_config(
  'request.jwt.claims',
  json_build_object('sub', 'd1000000-0000-0000-0000-000000000001', 'role', 'authenticated')::text,
  true
);
set local role authenticated;
select is(
  (select color_primario from dominio.tienda_identidad),
  '#C8102E',
  'el administrador de Uno ve solo su identidad (y no la de Dos)'
);

-- ============================================================================
-- Storage: políticas (FR-029)
-- ============================================================================

select lives_ok(
  $$insert into storage.objects (bucket_id, name, owner) values
      ('tienda-identidad', '11111111-1111-1111-1111-111111111111/e1000000-0000-0000-0000-000000000001/logo-2.png', 'd1000000-0000-0000-0000-000000000001')$$,
  'administrador: sube un archivo a la carpeta de su organización y empresa'
);
select throws_ok(
  $$insert into storage.objects (bucket_id, name, owner) values
      ('tienda-identidad', '22222222-2222-2222-2222-222222222222/e2000000-0000-0000-0000-000000000001/x.png', 'd1000000-0000-0000-0000-000000000001')$$,
  '42501', null, 'administrador: no sube bajo el prefijo de otra organización'
);
select throws_ok(
  $$insert into storage.objects (bucket_id, name, owner) values
      ('tienda-identidad', '11111111-1111-1111-1111-111111111111/e2000000-0000-0000-0000-000000000001/x.png', 'd1000000-0000-0000-0000-000000000001')$$,
  '42501', null, 'administrador: no sube sobre una empresa que no es de su organización'
);
select throws_ok(
  $$insert into storage.objects (bucket_id, name, owner) values
      ('tienda-identidad', '11111111-1111-1111-1111-111111111111/e1000000-0000-0000-0000-000000000001/sub/x.png', 'd1000000-0000-0000-0000-000000000001')$$,
  '42501', null, 'administrador: no sube con subcarpetas extra'
);
select throws_ok(
  $$insert into storage.objects (bucket_id, name, owner) values
      ('tienda-identidad', '11111111-1111-1111-1111-111111111111/e1000000-0000-0000-0000-000000000001/x.exe', 'd1000000-0000-0000-0000-000000000001')$$,
  '42501', null, 'administrador: no sube con extensión no permitida'
);
select lives_ok(
  $$delete from storage.objects where bucket_id = 'tienda-identidad'
      and name = '11111111-1111-1111-1111-111111111111/e1000000-0000-0000-0000-000000000001/logo-2.png'$$,
  'administrador: borra un archivo de su organización'
);
reset role;

-- ============================================================================
-- Función pública con identidad guardada (FR-030)
-- ============================================================================

select set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);
set local role anon;

select is(
  (select color_primario || '|' || color_fondo || '|' || tipografia_titulos || '|' || tipografia_texto || '|' || coalesce(banner_ruta, 'sin-banner')
     from publico.identidad_por_dominio('Uno-A.Ejemplo.com:443')),
  '#C8102E|#FAF7F0|Playfair Display|Lato|sin-banner',
  'la función pública devuelve la identidad guardada y normaliza el host'
);
select is(
  (select color_primario from publico.identidad_por_dominio('dos-a.ejemplo.com')),
  '#0A7D32',
  'cada dominio devuelve solo la identidad de su propia tienda'
);
reset role;

select is(
  pg_get_function_result('publico.identidad_por_dominio(text)'::regprocedure),
  'TABLE(color_primario text, color_primario_oscuro text, color_acento text, color_fondo text, tipografia_titulos text, tipografia_texto text, logo_ruta text, banner_ruta text, banner_movil_ruta text)',
  'lista blanca: la función pública no expone organizacion_id, empresa_id ni fechas'
);

select * from finish();
rollback;
