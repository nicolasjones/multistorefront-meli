-- MSF-306 · F-TDA-23 (épica MSF-164): páginas de contenido de la tienda.
-- Verifica FR-001 (tabla, RLS, checks, unique, sin anon), FR-002 (RPC: permisos, empresa ajena, slug único
-- y estable, límites, HTML literal), FR-003 (funciones públicas: visibles, orden, null idéntico, lista
-- blanca) y FR-008 (aislamiento entre dos tiendas).
begin;

select plan(44);

-- ============================================================================
-- Fixture (como postgres)
-- ============================================================================

insert into organizaciones (id, nombre) values
  ('11111111-1111-1111-1111-111111111111', 'Organización Uno'),
  ('22222222-2222-2222-2222-222222222222', 'Organización Dos');

insert into auth.users (id, email) values
  ('d1000000-0000-0000-0000-000000000001', 'admin-uno@example.com'),
  ('d1000000-0000-0000-0000-000000000002', 'operador-uno@example.com'),
  ('d2000000-0000-0000-0000-000000000001', 'admin-dos@example.com');

insert into usuarios_organizacion (user_id, organizacion_id, rol_id) values
  ('d1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'administrador'),
  ('d1000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'operador'),
  ('d2000000-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', 'administrador');

insert into dominio.empresas (id, organizacion_id, nombre) values
  ('e1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'Uno A'),
  ('e1000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'Uno B'),
  ('e2000000-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', 'Dos A');

insert into dominio.tiendas (organizacion_id, empresa_id, dominio) values
  ('11111111-1111-1111-1111-111111111111', 'e1000000-0000-0000-0000-000000000001', 'paginas-uno-a.ejemplo.com'),
  ('11111111-1111-1111-1111-111111111111', 'e1000000-0000-0000-0000-000000000002', 'paginas-uno-b.ejemplo.com'),
  ('22222222-2222-2222-2222-222222222222', 'e2000000-0000-0000-0000-000000000001', 'paginas-dos-a.ejemplo.com');

-- ============================================================================
-- Estructura y privilegios (FR-001)
-- ============================================================================

select is(
  (select relrowsecurity from pg_class where oid = 'dominio.tienda_paginas'::regclass),
  true,
  'dominio.tienda_paginas tiene RLS activado'
);
select is(has_table_privilege('anon', 'dominio.tienda_paginas', 'select'), false, 'anon no lee dominio.tienda_paginas');
select is(has_table_privilege('authenticated', 'dominio.tienda_paginas', 'select'), true, 'authenticated lee (filtrado por RLS)');
select is(has_table_privilege('authenticated', 'dominio.tienda_paginas', 'insert'), false, 'authenticated no inserta directo');
select is(has_table_privilege('authenticated', 'dominio.tienda_paginas', 'update'), false, 'authenticated no actualiza directo');
select is(has_table_privilege('authenticated', 'dominio.tienda_paginas', 'delete'), false, 'authenticated no borra directo');
select is(
  (select count(*)::int from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'publico' and c.relkind in ('r', 'p')),
  0,
  'el esquema publico sigue sin tablas'
);
select is(has_function_privilege('anon', 'public.guardar_pagina_tienda(uuid,uuid,text,text,boolean)', 'execute'), false, 'anon no ejecuta guardar_pagina_tienda');
select is(has_function_privilege('anon', 'public.eliminar_pagina_tienda(uuid,uuid)', 'execute'), false, 'anon no ejecuta eliminar_pagina_tienda');
select is(has_function_privilege('authenticated', 'public.guardar_pagina_tienda(uuid,uuid,text,text,boolean)', 'execute'), true, 'authenticated ejecuta guardar_pagina_tienda');
select is(has_function_privilege('anon', 'publico.paginas_por_dominio(text)', 'execute'), true, 'anon ejecuta publico.paginas_por_dominio');
select is(has_function_privilege('anon', 'publico.pagina_por_dominio(text,text)', 'execute'), true, 'anon ejecuta publico.pagina_por_dominio');

-- Checks de la tabla (FR-001), insertando como postgres.
select throws_ok(
  $$insert into dominio.tienda_paginas (organizacion_id, empresa_id, titulo, slug)
    values ('11111111-1111-1111-1111-111111111111', 'e1000000-0000-0000-0000-000000000001', 'X', 'Mal Slug')$$,
  '23514', null, 'un slug con mayúsculas o espacios viola el check de formato'
);
select throws_ok(
  $$insert into dominio.tienda_paginas (organizacion_id, empresa_id, titulo, slug)
    values ('11111111-1111-1111-1111-111111111111', 'e1000000-0000-0000-0000-000000000001', '', 'vacio')$$,
  '23514', null, 'un título vacío viola el check de longitud'
);
select throws_ok(
  $$insert into dominio.tienda_paginas (organizacion_id, empresa_id, titulo, slug)
    values ('22222222-2222-2222-2222-222222222222', 'e1000000-0000-0000-0000-000000000001', 'X', 'cruzada')$$,
  '23503', null, 'la FK compuesta impide una página con organización y empresa que no coinciden'
);

-- ============================================================================
-- Sin permiso de edición (operador) y sin sesión
-- ============================================================================

select set_config(
  'request.jwt.claims',
  json_build_object('sub', 'd1000000-0000-0000-0000-000000000002', 'role', 'authenticated')::text,
  true
);
-- Título largo con separador justo en la posición 70: el corte no deja guion final.
select is(
  private.slug_pagina_tienda(repeat('a', 69) || ' bbb'),
  repeat('a', 69),
  'el slug de un título largo no termina en guion tras el corte a 70'
);

set local role authenticated;

select throws_ok(
  $$select public.guardar_pagina_tienda('e1000000-0000-0000-0000-000000000001', null, 'Envíos', 'Texto', false)$$,
  '42501', null, 'un rol sin edición en Empresas no puede crear una página'
);

-- ============================================================================
-- Administrador de la organización Uno (FR-002)
-- ============================================================================

select set_config(
  'request.jwt.claims',
  json_build_object('sub', 'd1000000-0000-0000-0000-000000000001', 'role', 'authenticated')::text,
  true
);

select lives_ok(
  $$select public.guardar_pagina_tienda('e1000000-0000-0000-0000-000000000001', null, '  Cómo comprar  ', E'Paso 1\n\nPaso 2', null)$$,
  'el administrador crea una página en su empresa'
);
select is(
  (select slug || '|' || titulo || '|' || visible::text from dominio.tienda_paginas
    where empresa_id = 'e1000000-0000-0000-0000-000000000001'),
  'como-comprar|Cómo comprar|false',
  'se crea oculta, con el título recortado y el slug sin tildes'
);

-- Mismo título: sufijo numérico.
select lives_ok(
  $$select public.guardar_pagina_tienda('e1000000-0000-0000-0000-000000000001', null, 'Como comprar', '', false)$$,
  'un título que genera el mismo slug se acepta'
);
select is(
  (select string_agg(slug, ',' order by slug) from dominio.tienda_paginas where empresa_id = 'e1000000-0000-0000-0000-000000000001'),
  'como-comprar,como-comprar-2',
  'el slug repetido recibe un sufijo numérico'
);

-- El slug no cambia al editar el título.
select lives_ok(
  $$select public.guardar_pagina_tienda(
      'e1000000-0000-0000-0000-000000000001',
      (select id from dominio.tienda_paginas where slug = 'como-comprar' and empresa_id = 'e1000000-0000-0000-0000-000000000001'),
      'Cómo comprar en la tienda', 'Nuevo texto', true)$$,
  'el administrador edita título, texto y visibilidad'
);
select is(
  (select slug || '|' || titulo || '|' || visible::text from dominio.tienda_paginas
    where empresa_id = 'e1000000-0000-0000-0000-000000000001' and slug = 'como-comprar'),
  'como-comprar|Cómo comprar en la tienda|true',
  'editar no cambia el slug'
);

-- Con visible null al editar se conserva.
select lives_ok(
  $$select public.guardar_pagina_tienda(
      'e1000000-0000-0000-0000-000000000001',
      (select id from dominio.tienda_paginas where slug = 'como-comprar' and empresa_id = 'e1000000-0000-0000-0000-000000000001'),
      'Cómo comprar en la tienda', 'Nuevo texto', null)$$,
  'editar con visible null no falla'
);
select is(
  (select visible from dominio.tienda_paginas where slug = 'como-comprar' and empresa_id = 'e1000000-0000-0000-0000-000000000001'),
  true,
  'visible null conserva el valor actual'
);

-- Texto con HTML: literal (texto plano).
select lives_ok(
  $$select public.guardar_pagina_tienda('e1000000-0000-0000-0000-000000000001', null, 'Envíos', '<script>alert(1)</script>', true)$$,
  'un texto con HTML se acepta como texto plano'
);
select is(
  (select contenido from dominio.tienda_paginas where slug = 'envios' and empresa_id = 'e1000000-0000-0000-0000-000000000001'),
  '<script>alert(1)</script>',
  'el HTML queda literal en la base'
);

-- Límites y empresa ajena: error y no se guarda nada.
select throws_ok(
  $$select public.guardar_pagina_tienda('e1000000-0000-0000-0000-000000000001', null, '   ', 'x', false)$$,
  '22023', 'El título es obligatorio', 'un título vacío se rechaza'
);
select throws_ok(
  format($$select public.guardar_pagina_tienda('e1000000-0000-0000-0000-000000000001', null, %L, 'x', false)$$, repeat('a', 81)),
  '22023', 'El título no puede superar los 80 caracteres', 'un título de 81 caracteres se rechaza'
);
select throws_ok(
  format($$select public.guardar_pagina_tienda('e1000000-0000-0000-0000-000000000001', null, 'Largo', %L, false)$$, repeat('a', 10001)),
  '22023', 'El contenido no puede superar los 10000 caracteres', 'un contenido de 10001 caracteres se rechaza'
);
select throws_ok(
  $$select public.guardar_pagina_tienda('e2000000-0000-0000-0000-000000000001', null, 'Ajena', 'x', false)$$,
  '42501', null, 'no se puede crear una página en una empresa de otra organización'
);
select is(
  (select count(*)::int from dominio.tienda_paginas where titulo in ('Ajena', 'Largo')),
  0,
  'los intentos rechazados no guardan nada'
);

-- ============================================================================
-- Lectura pública (FR-003, FR-008)
-- ============================================================================

-- Una página oculta y una en la otra tienda del mismo organización.
select public.guardar_pagina_tienda('e1000000-0000-0000-0000-000000000001', null, 'Borrador interno', 'secreto', false);
select public.guardar_pagina_tienda('e1000000-0000-0000-0000-000000000002', null, 'Envíos', 'Texto de Uno B', true);

reset role;
set local role anon;

select is(
  (select jsonb_path_query_array(publico.paginas_por_dominio('paginas-uno-a.ejemplo.com'), '$.paginas[*].slug')::text),
  '["como-comprar", "envios"]',
  'la lista pública trae solo las visibles, ordenadas por título'
);
select is(
  (select jsonb_path_query_array(publico.paginas_por_dominio('paginas-uno-a.ejemplo.com'), '$.paginas[0]')::text),
  '[{"slug": "como-comprar", "titulo": "Cómo comprar en la tienda"}]',
  'lista blanca: solo titulo y slug (sin id, contenido, organización ni fechas)'
);
select is(
  publico.pagina_por_dominio('paginas-uno-b.ejemplo.com', 'envios') ->> 'contenido',
  'Texto de Uno B',
  'cada tienda lee su propia página «envios»'
);
select is(
  publico.pagina_por_dominio('paginas-uno-a.ejemplo.com', 'envios') ->> 'contenido',
  '<script>alert(1)</script>',
  'la otra tienda con el mismo slug lee la suya (aislamiento)'
);
select is(
  (select array_agg(k order by k) from jsonb_object_keys(publico.pagina_por_dominio('paginas-uno-a.ejemplo.com', 'envios')) k),
  array['contenido', 'slug', 'titulo'],
  'pagina_por_dominio devuelve solo titulo, slug y contenido'
);
select ok(
  publico.pagina_por_dominio('paginas-uno-a.ejemplo.com', 'borrador-interno') is null
  and publico.pagina_por_dominio('paginas-uno-a.ejemplo.com', 'no-existe') is null
  and publico.pagina_por_dominio('paginas-dos-a.ejemplo.com', 'como-comprar') is null
  and publico.pagina_por_dominio('no-existe.ejemplo.com', 'envios') is null,
  'null idéntico: oculta, inexistente, de otra empresa y host desconocido'
);
select ok(
  publico.paginas_por_dominio('no-existe.ejemplo.com') is null
  and publico.paginas_por_dominio('') is null,
  'host desconocido o inválido devuelve null'
);

reset role;

-- Empresa desactivada: mismo null que un host desconocido.
update dominio.empresas set activa = false where id = 'e1000000-0000-0000-0000-000000000002';
set local role anon;
select ok(
  publico.paginas_por_dominio('paginas-uno-b.ejemplo.com') is null
  and publico.pagina_por_dominio('paginas-uno-b.ejemplo.com', 'envios') is null,
  'una empresa desactivada devuelve null en ambas funciones'
);
reset role;

-- ============================================================================
-- Eliminar y aislamiento entre organizaciones (RLS)
-- ============================================================================

select set_config(
  'request.jwt.claims',
  json_build_object('sub', 'd2000000-0000-0000-0000-000000000001', 'role', 'authenticated')::text,
  true
);
set local role authenticated;

select is((select count(*)::int from dominio.tienda_paginas), 0, 'otra organización no ve las páginas de la Uno (RLS)');
select throws_ok(
  $$select public.eliminar_pagina_tienda('e1000000-0000-0000-0000-000000000001', (select id from dominio.tienda_paginas limit 1))$$,
  '42501', null, 'otra organización no puede eliminar páginas ajenas'
);

reset role;
select set_config(
  'request.jwt.claims',
  json_build_object('sub', 'd1000000-0000-0000-0000-000000000001', 'role', 'authenticated')::text,
  true
);
set local role authenticated;

select lives_ok(
  $$select public.eliminar_pagina_tienda('e1000000-0000-0000-0000-000000000001', (select id from dominio.tienda_paginas where slug = 'envios' and empresa_id = 'e1000000-0000-0000-0000-000000000001'))$$,
  'el administrador elimina una página'
);
select is(
  (select count(*)::int from dominio.tienda_paginas where slug = 'envios' and empresa_id = 'e1000000-0000-0000-0000-000000000001'),
  0,
  'la página eliminada ya no existe'
);

select * from finish();
rollback;
