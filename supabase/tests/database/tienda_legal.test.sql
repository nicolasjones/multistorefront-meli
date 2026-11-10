-- F-TDA-22 (MSF-289, épica MSF-149): información legal de la tienda.
-- Verifica FR-030 (tabla: RLS, privilegios, check de URL) y FR-031 (función pública: lista blanca,
-- orden, aislamiento entre tiendas, null idéntico).
begin;

select plan(23);

-- ============================================================================
-- Fixture (como postgres)
-- ============================================================================

insert into organizaciones (id, nombre) values
  ('11111111-1111-1111-1111-111111111111', 'Organización Uno'),
  ('22222222-2222-2222-2222-222222222222', 'Organización Dos');

insert into auth.users (id, email) values
  ('d1000000-0000-0000-0000-000000000001', 'admin-uno@example.com'),
  ('d2000000-0000-0000-0000-000000000001', 'admin-dos@example.com');

insert into usuarios_organizacion (user_id, organizacion_id, rol_id) values
  ('d1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'administrador'),
  ('d2000000-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', 'administrador');

insert into dominio.empresas (id, organizacion_id, nombre, razon_social, cuit, direccion, whatsapp) values
  ('e1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'Uno A', 'Uno A S.A.', '30711111114', 'Calle 1 100', '+5491100000001'),
  ('e1000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'Uno B', null, null, null, null),
  ('e1000000-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111', 'Uno C', 'Uno C S.R.L.', null, null, null),
  ('e2000000-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', 'Dos A', 'Dos A S.A.', '30722222223', 'Calle 2 200', null);

insert into dominio.tiendas (organizacion_id, empresa_id, dominio) values
  ('11111111-1111-1111-1111-111111111111', 'e1000000-0000-0000-0000-000000000001', 'legal-uno-a.ejemplo.com'),
  ('11111111-1111-1111-1111-111111111111', 'e1000000-0000-0000-0000-000000000002', 'legal-uno-b.ejemplo.com'),
  ('11111111-1111-1111-1111-111111111111', 'e1000000-0000-0000-0000-000000000003', 'legal-uno-c.ejemplo.com'),
  ('22222222-2222-2222-2222-222222222222', 'e2000000-0000-0000-0000-000000000001', 'legal-dos-a.ejemplo.com');

insert into dominio.tienda_legal_enlaces (organizacion_id, empresa_id, titulo, url, orden) values
  ('11111111-1111-1111-1111-111111111111', 'e1000000-0000-0000-0000-000000000001', 'Términos', 'https://uno.ejemplo.com/terminos', 2),
  ('11111111-1111-1111-1111-111111111111', 'e1000000-0000-0000-0000-000000000001', 'Arrepentimiento', 'https://uno.ejemplo.com/arrepentimiento', 1),
  ('22222222-2222-2222-2222-222222222222', 'e2000000-0000-0000-0000-000000000001', 'Defensa del consumidor', 'https://dos.ejemplo.com/defensa', 1);

-- ============================================================================
-- Estructura y privilegios (FR-030)
-- ============================================================================

select is(
  (select relrowsecurity from pg_class where oid = 'dominio.tienda_legal_enlaces'::regclass),
  true,
  'dominio.tienda_legal_enlaces tiene RLS activado'
);
select is(has_table_privilege('anon', 'dominio.tienda_legal_enlaces', 'select'), false, 'anon no lee la tabla');
select is(has_table_privilege('anon', 'dominio.tienda_legal_enlaces', 'insert'), false, 'anon no inserta');
select is(has_table_privilege('authenticated', 'dominio.tienda_legal_enlaces', 'select'), true, 'authenticated lee (filtrado por RLS)');
select is(has_table_privilege('authenticated', 'dominio.tienda_legal_enlaces', 'insert'), false, 'authenticated no inserta');
select is(has_table_privilege('authenticated', 'dominio.tienda_legal_enlaces', 'update'), false, 'authenticated no actualiza');
select is(has_table_privilege('authenticated', 'dominio.tienda_legal_enlaces', 'delete'), false, 'authenticated no borra');
select is(
  (select count(*)::int from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'publico' and c.relkind in ('r', 'p')),
  0,
  'el esquema publico sigue sin tablas'
);
select is(has_function_privilege('anon', 'publico.legal_por_dominio(text)', 'execute'), true, 'anon ejecuta publico.legal_por_dominio');

-- Check de URL: solo https.
select throws_ok(
  $$insert into dominio.tienda_legal_enlaces (organizacion_id, empresa_id, titulo, url)
    values ('11111111-1111-1111-1111-111111111111', 'e1000000-0000-0000-0000-000000000001', 'Malo', 'javascript:alert(1)')$$,
  '23514', null, 'una URL javascript: se rechaza'
);
select throws_ok(
  $$insert into dominio.tienda_legal_enlaces (organizacion_id, empresa_id, titulo, url)
    values ('11111111-1111-1111-1111-111111111111', 'e1000000-0000-0000-0000-000000000001', 'Malo', 'http://x.ejemplo.com')$$,
  '23514', null, 'una URL http: se rechaza'
);
select throws_ok(
  $$insert into dominio.tienda_legal_enlaces (organizacion_id, empresa_id, titulo, url)
    values ('11111111-1111-1111-1111-111111111111', 'e1000000-0000-0000-0000-000000000001', repeat('a', 81), 'https://x.ejemplo.com')$$,
  '23514', null, 'un título de más de 80 caracteres se rechaza'
);
select throws_ok(
  $$insert into dominio.tienda_legal_enlaces (organizacion_id, empresa_id, titulo, url)
    values ('11111111-1111-1111-1111-111111111111', 'e2000000-0000-0000-0000-000000000001', 'Cruzado', 'https://x.ejemplo.com')$$,
  '23503', null, 'la empresa tiene que ser de la misma organización (FK compuesta)'
);

-- ============================================================================
-- Función pública (FR-031) como anon
-- ============================================================================

select set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);
set local role anon;

select is(
  publico.legal_por_dominio('legal-uno-a.ejemplo.com'),
  jsonb_build_object(
    'razon_social', 'Uno A S.A.',
    'cuit', '30711111114',
    'direccion', 'Calle 1 100',
    'enlaces', jsonb_build_array(
      jsonb_build_object('titulo', 'Arrepentimiento', 'url', 'https://uno.ejemplo.com/arrepentimiento'),
      jsonb_build_object('titulo', 'Términos', 'url', 'https://uno.ejemplo.com/terminos')
    )
  ),
  'datos de la tienda con enlaces por orden y solo la lista blanca (sin whatsapp ni ids)'
);
select is(
  publico.legal_por_dominio('LEGAL-UNO-A.ejemplo.com:443'),
  publico.legal_por_dominio('legal-uno-a.ejemplo.com'),
  'el host se normaliza (mayúsculas y puerto)'
);
select is(
  publico.legal_por_dominio('legal-uno-b.ejemplo.com'),
  jsonb_build_object('razon_social', null, 'cuit', null, 'direccion', null, 'enlaces', '[]'::jsonb),
  'empresa sin datos: campos null y lista vacía'
);
select is(
  publico.legal_por_dominio('legal-uno-c.ejemplo.com') -> 'razon_social',
  to_jsonb('Uno C S.R.L.'::text),
  'datos parciales: solo lo que existe'
);
select is(
  publico.legal_por_dominio('legal-dos-a.ejemplo.com') -> 'enlaces',
  jsonb_build_array(jsonb_build_object('titulo', 'Defensa del consumidor', 'url', 'https://dos.ejemplo.com/defensa')),
  'aislamiento: la otra tienda ve solo sus enlaces'
);
select is(
  publico.legal_por_dominio('legal-uno-a.ejemplo.com') -> 'enlaces' @> '[{"titulo":"Defensa del consumidor"}]'::jsonb,
  false,
  'aislamiento: los enlaces de otra empresa no aparecen'
);
select is(publico.legal_por_dominio('no-existe.ejemplo.com'), null, 'host desconocido: null');
select is(publico.legal_por_dominio('###'), null, 'host inválido: null');

-- Empresa desactivada: null idéntico al desconocido; reactivar cambia el resultado.
reset role;
update dominio.empresas set activa = false where id = 'e1000000-0000-0000-0000-000000000001';
set local role anon;
select is(publico.legal_por_dominio('legal-uno-a.ejemplo.com'), publico.legal_por_dominio('no-existe.ejemplo.com'), 'empresa desactivada: null idéntico al desconocido');

-- ============================================================================
-- RLS de la tabla para authenticated (aislamiento por organización)
-- ============================================================================

reset role;
select set_config('request.jwt.claims', json_build_object('sub', 'd2000000-0000-0000-0000-000000000001', 'role', 'authenticated')::text, true);
set local role authenticated;
select is(
  (select count(*)::int from dominio.tienda_legal_enlaces where empresa_id = 'e1000000-0000-0000-0000-000000000001'),
  0,
  'una organización no lee los enlaces de otra'
);

select * from finish();
rollback;
