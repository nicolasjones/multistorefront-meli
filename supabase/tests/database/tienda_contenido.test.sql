-- F-TDA-03 (MSF-294, épica MSF-147): contenido y textos comerciales de la tienda.
-- Verifica FR-031 (columnas), FR-032 (destino en lista cerrada), FR-033 (recorte y límites),
-- FR-035 (RPC: permisos, idempotencia, evento) y FR-036 (función pública, `anon`).
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
  ('11111111-1111-1111-1111-111111111111', 'e1000000-0000-0000-0000-000000000001', 'contenido-uno-a.ejemplo.com'),
  ('11111111-1111-1111-1111-111111111111', 'e1000000-0000-0000-0000-000000000002', 'contenido-uno-b.ejemplo.com'),
  ('22222222-2222-2222-2222-222222222222', 'e2000000-0000-0000-0000-000000000001', 'contenido-dos-a.ejemplo.com');

-- ============================================================================
-- Estructura y privilegios (FR-031, FR-036)
-- ============================================================================

select is(
  (select relrowsecurity from pg_class where oid = 'dominio.tienda_contenido'::regclass),
  true,
  'dominio.tienda_contenido tiene RLS activado'
);
select is(has_table_privilege('anon', 'dominio.tienda_contenido', 'select'), false, 'anon no lee dominio.tienda_contenido');
select is(has_table_privilege('authenticated', 'dominio.tienda_contenido', 'insert'), false, 'authenticated no inserta directo');
select is(has_table_privilege('authenticated', 'dominio.tienda_contenido', 'update'), false, 'authenticated no actualiza directo');
select is(
  (select count(*)::int from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'publico' and c.relkind in ('r', 'p')),
  0,
  'el esquema publico sigue sin tablas'
);
select is(
  has_function_privilege('anon', 'publico.contenido_por_dominio(text)', 'execute'),
  true,
  'anon ejecuta publico.contenido_por_dominio'
);
select is(
  has_function_privilege('anon', 'public.guardar_tienda_contenido(uuid,text,text,text,text,text,text,text,text)', 'execute'),
  false,
  'anon no ejecuta public.guardar_tienda_contenido'
);
select is(
  has_function_privilege('authenticated', 'public.guardar_tienda_contenido(uuid,text,text,text,text,text,text,text,text)', 'execute'),
  true,
  'authenticated ejecuta public.guardar_tienda_contenido'
);

-- ============================================================================
-- Sin fila: la tienda no muestra textos opcionales (FR-034, FR-036)
-- ============================================================================

select is(
  (select count(*)::int from publico.contenido_por_dominio('contenido-uno-a.ejemplo.com')),
  1,
  'una tienda sin contenido devuelve una fila'
);
select is(
  (select titulo || '|' || subtitulo || '|' || bienvenida || '|' || pie || '|' || boton_destino
     from publico.contenido_por_dominio('contenido-uno-a.ejemplo.com')),
  '||||catalogo',
  'sin fila todos los textos vienen vacíos y el destino es catalogo'
);
select is(
  (select count(*)::int from publico.contenido_por_dominio('no-existe.ejemplo.com')),
  0,
  'un dominio desconocido no devuelve filas'
);

-- ============================================================================
-- Guardar: administrador de la organización Uno (FR-035)
-- ============================================================================

select set_config(
  'request.jwt.claims',
  json_build_object('sub', 'd1000000-0000-0000-0000-000000000001', 'role', 'authenticated')::text,
  true
);
set local role authenticated;

select lives_ok(
  $$select public.guardar_tienda_contenido(
      'e1000000-0000-0000-0000-000000000001',
      '  Todo para tu consola  ', 'Envíos a todo el país', 'Ver catálogo', 'catalogo',
      'Envío gratis desde $50.000', '© Uno A', 'Los precios incluyen IVA', 'Consultanos')$$,
  'el administrador guarda el contenido de su empresa'
);
select is(
  (select titulo from dominio.tienda_contenido where empresa_id = 'e1000000-0000-0000-0000-000000000001'),
  'Todo para tu consola',
  'el título se guarda recortado'
);
select is(
  (select count(*)::int from dominio.tienda_contenido),
  1,
  'el administrador ve el contenido de su organización'
);

-- Texto con HTML: se guarda tal cual (texto plano); el front lo escapa (Vitest T027).
select lives_ok(
  $$select public.guardar_tienda_contenido(
      'e1000000-0000-0000-0000-000000000002',
      '<script>alert(1)</script>', '', '', 'catalogo', '', '', '', '')$$,
  'un texto con HTML se acepta como texto plano'
);
select is(
  (select titulo from dominio.tienda_contenido where empresa_id = 'e1000000-0000-0000-0000-000000000002'),
  '<script>alert(1)</script>',
  'el texto con HTML queda literal en la base'
);

-- Evento (FR-035/FR-037).
select is(
  (select count(*)::int from public.registro_actividad
    where tipo = 'tienda.contenido_actualizado' and empresa_id = 'e1000000-0000-0000-0000-000000000001'),
  1,
  'guardar registra tienda.contenido_actualizado'
);
select is(
  (select actor_id::text from public.registro_actividad
    where tipo = 'tienda.contenido_actualizado' and empresa_id = 'e1000000-0000-0000-0000-000000000001'),
  'd1000000-0000-0000-0000-000000000001',
  'el evento guarda el actor de la sesión'
);

-- Idempotencia: repetir el mismo guardado no duplica el evento ni cambia el estado.
select lives_ok(
  $$select public.guardar_tienda_contenido(
      'e1000000-0000-0000-0000-000000000001',
      'Todo para tu consola', 'Envíos a todo el país', 'Ver catálogo', 'catalogo',
      'Envío gratis desde $50.000', '© Uno A', 'Los precios incluyen IVA', 'Consultanos')$$,
  'guardar dos veces lo mismo no falla'
);
select is(
  (select count(*)::int from public.registro_actividad
    where tipo = 'tienda.contenido_actualizado' and empresa_id = 'e1000000-0000-0000-0000-000000000001'),
  1,
  'guardar lo mismo no duplica el evento (idempotente)'
);
select is(
  (select count(*)::int from dominio.tienda_contenido where empresa_id = 'e1000000-0000-0000-0000-000000000001'),
  1,
  'guardar dos veces deja una sola fila'
);

-- Un cambio real vuelve a registrar el evento.
select lives_ok(
  $$select public.guardar_tienda_contenido(
      'e1000000-0000-0000-0000-000000000001',
      'Todo para tu consola', 'Nuevo subtítulo', 'Ver catálogo', 'catalogo',
      'Envío gratis desde $50.000', '© Uno A', 'Los precios incluyen IVA', 'Consultanos')$$,
  'un cambio real se guarda'
);
select is(
  (select count(*)::int from public.registro_actividad
    where tipo = 'tienda.contenido_actualizado' and empresa_id = 'e1000000-0000-0000-0000-000000000001'),
  2,
  'un cambio real registra otro evento'
);

-- Límites y destino (FR-032, FR-033): error por campo y no se guarda nada.
select throws_ok(
  format($$select public.guardar_tienda_contenido('e1000000-0000-0000-0000-000000000001', %L, '', '', 'catalogo', '', '', '', '')$$, repeat('a', 121)),
  '22023', 'El título no puede superar los 120 caracteres',
  'un título de 121 caracteres se rechaza'
);
select throws_ok(
  format($$select public.guardar_tienda_contenido('e1000000-0000-0000-0000-000000000001', '', '', '', 'catalogo', '', %L, '', '')$$, repeat('a', 301)),
  '22023', 'El texto del pie no puede superar los 300 caracteres',
  'un pie de 301 caracteres se rechaza'
);
select throws_ok(
  $$select public.guardar_tienda_contenido('e1000000-0000-0000-0000-000000000001', '', '', '', 'https://malo.example', '', '', '', '')$$,
  '22023', 'El destino del botón no es válido',
  'un destino fuera de la lista cerrada se rechaza'
);
select is(
  (select subtitulo from dominio.tienda_contenido where empresa_id = 'e1000000-0000-0000-0000-000000000001'),
  'Nuevo subtítulo',
  'un guardado inválido no cambia lo ya guardado'
);

-- Una empresa de otra organización no se puede tocar (aislamiento).
select throws_ok(
  $$select public.guardar_tienda_contenido('e2000000-0000-0000-0000-000000000001', 'Intruso', '', '', 'catalogo', '', '', '', '')$$,
  '42501', 'La empresa no existe o no pertenece a tu organización',
  'no se puede guardar el contenido de una empresa de otra organización'
);
reset role;

-- Los límites también rigen en la base, fuera de la RPC (FR-033).
select throws_ok(
  format($$insert into dominio.tienda_contenido (empresa_id, organizacion_id, titulo)
             values ('e2000000-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', %L)$$, repeat('a', 121)),
  '23514', null,
  'la tabla rechaza un título de más de 120 caracteres'
);
select throws_ok(
  $$insert into dominio.tienda_contenido (empresa_id, organizacion_id, boton_destino)
      values ('e2000000-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', 'otro')$$,
  '23514', null,
  'la tabla rechaza un destino fuera de la lista cerrada'
);

-- ============================================================================
-- Permisos: operador sin edición en Empresas (FR-035)
-- ============================================================================

select set_config(
  'request.jwt.claims',
  json_build_object('sub', 'd1000000-0000-0000-0000-000000000002', 'role', 'authenticated')::text,
  true
);
set local role authenticated;

select throws_ok(
  $$select public.guardar_tienda_contenido('e1000000-0000-0000-0000-000000000001', 'No', '', '', 'catalogo', '', '', '', '')$$,
  '42501', 'Tu rol no puede editar el contenido de la tienda',
  'un rol sin edición en Empresas no puede guardar'
);
reset role;

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
  (select count(*)::int from dominio.tienda_contenido),
  0,
  'la organización Dos no ve el contenido de la organización Uno'
);
reset role;

-- ============================================================================
-- Función pública: lo guardado por una empresa no cambia a la otra (US3.4, FR-036)
-- ============================================================================

select is(
  (select subtitulo from publico.contenido_por_dominio('contenido-uno-a.ejemplo.com')),
  'Nuevo subtítulo',
  'la función pública devuelve lo guardado'
);
select is(
  (select titulo from publico.contenido_por_dominio('Contenido-Uno-B.Ejemplo.Com:443.')),
  '<script>alert(1)</script>',
  'la función pública normaliza el host y devuelve el texto literal'
);
select is(
  (select subtitulo from publico.contenido_por_dominio('contenido-dos-a.ejemplo.com')),
  '',
  'editar una empresa no cambia a la otra'
);

update dominio.empresas set activa = false where id = 'e1000000-0000-0000-0000-000000000001';
select is(
  (select count(*)::int from publico.contenido_por_dominio('contenido-uno-a.ejemplo.com')),
  (select count(*)::int from publico.contenido_por_dominio('no-existe.ejemplo.com')),
  'empresa desactivada y dominio desconocido dan la misma respuesta'
);

-- `anon`: solo por la función pública.
select set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);
set local role anon;

select lives_ok(
  $$select * from publico.contenido_por_dominio('contenido-uno-b.ejemplo.com')$$,
  'anon lee el contenido por la función pública'
);
select throws_ok(
  $$select * from dominio.tienda_contenido$$,
  '42501', null,
  'anon no lee dominio.tienda_contenido'
);
select throws_ok(
  $$select public.guardar_tienda_contenido('e1000000-0000-0000-0000-000000000002', 'x', '', '', 'catalogo', '', '', '', '')$$,
  '42501', null,
  'anon no puede guardar contenido'
);
reset role;

select * from finish();

rollback;
