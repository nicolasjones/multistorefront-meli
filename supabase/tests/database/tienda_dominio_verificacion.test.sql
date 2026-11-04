-- F-TDA-05 (MSF-198, épica MSF-133): dominio, verificación DNS y certificado.
-- Cubre SC-001 (aislamiento entre dos organizaciones), SC-002 (`anon` solo ejecuta
-- `publico.redireccion_por_dominio`; `registrar_verificacion_dns` solo `service_role`; `publico` sin
-- tablas) y SC-004 (dominio duplicado/inválido con error por campo; el vigente no se corta hasta
-- verificar el nuevo). Verifica FR-002, FR-003, FR-004, FR-008, FR-013 y FR-014.
begin;

select plan(73);

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

insert into dominio.empresas (id, organizacion_id, nombre) values
  ('e1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'Uno A'),
  ('e1000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'Uno B'),
  ('e2000000-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', 'Dos A');

insert into dominio.tiendas (organizacion_id, empresa_id, dominio) values
  ('11111111-1111-1111-1111-111111111111', 'e1000000-0000-0000-0000-000000000001', 'uno-a.ejemplo.com'),
  ('22222222-2222-2222-2222-222222222222', 'e2000000-0000-0000-0000-000000000001', 'dos-a.ejemplo.com');

-- ============================================================================
-- Estructura y privilegios (FR-008, SC-002)
-- ============================================================================

select is((select relrowsecurity from pg_class where oid = 'dominio.tienda_registros_dns'::regclass), true, 'tienda_registros_dns tiene RLS');
select is((select relrowsecurity from pg_class where oid = 'public.tienda_dns_plataforma'::regclass), true, 'tienda_dns_plataforma tiene RLS');
select is(has_table_privilege('anon', 'dominio.tienda_registros_dns', 'select'), false, 'anon no lee tienda_registros_dns');
select is(has_table_privilege('anon', 'public.tienda_dns_plataforma', 'select'), false, 'anon no lee tienda_dns_plataforma');
select is(has_function_privilege('anon', 'publico.redireccion_por_dominio(text)', 'execute'), true, 'anon ejecuta publico.redireccion_por_dominio');
select is(has_function_privilege('anon', 'public.configurar_dominio_tienda(uuid, text, text)', 'execute'), false, 'anon no ejecuta configurar_dominio_tienda');
select is(has_function_privilege('anon', 'public.obtener_dominio_tienda(uuid)', 'execute'), false, 'anon no ejecuta obtener_dominio_tienda');
select is(has_function_privilege('anon', 'public.preparar_verificacion_tienda(uuid)', 'execute'), false, 'anon no ejecuta preparar_verificacion_tienda');
select is(has_function_privilege('anon', 'public.registrar_verificacion_dns(uuid, jsonb, text)', 'execute'), false, 'anon no ejecuta registrar_verificacion_dns');
select is(has_function_privilege('authenticated', 'public.registrar_verificacion_dns(uuid, jsonb, text)', 'execute'), false, 'authenticated no ejecuta registrar_verificacion_dns');
select is(has_function_privilege('service_role', 'public.registrar_verificacion_dns(uuid, jsonb, text)', 'execute'), true, 'service_role ejecuta registrar_verificacion_dns');
select is(has_function_privilege('authenticated', 'public.configurar_dominio_tienda(uuid, text, text)', 'execute'), true, 'authenticated ejecuta configurar_dominio_tienda');
select is(
  (select count(*)::int from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'publico' and c.relkind in ('r', 'p')),
  0,
  'el esquema publico sigue sin tablas'
);
select is((select count(*)::int from public.tienda_dns_plataforma), 1, 'tienda_dns_plataforma tiene la fila única de configuración');
select is(
  (select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname in ('configurar_dominio_tienda', 'obtener_dominio_tienda', 'preparar_verificacion_tienda', 'registrar_verificacion_dns')
      and has_function_privilege('anon', p.oid, 'execute')),
  0,
  'ninguna RPC nueva de public es ejecutable por anon'
);

-- ============================================================================
-- Alta, normalización y validación (FR-002, FR-015, SC-004) — administrador de Uno
-- ============================================================================

select set_config('request.jwt.claims', json_build_object('sub', 'd1000000-0000-0000-0000-000000000001', 'role', 'authenticated')::text, true);
set local role authenticated;

select is(
  (select public.configurar_dominio_tienda('e1000000-0000-0000-0000-000000000002', 'Uno-B.Ejemplo.COM.:443', null) ->> 'dominio_vigente'),
  'uno-b.ejemplo.com',
  'la primera carga crea la tienda y normaliza (minúsculas, sin puerto ni punto final)'
);
select is((select count(*)::int from dominio.tiendas where empresa_id = 'e1000000-0000-0000-0000-000000000002'), 1, 'la tienda de la empresa sin dominio quedó creada');
select throws_ok(
  $$select public.configurar_dominio_tienda('e1000000-0000-0000-0000-000000000001', 'dos-a.ejemplo.com', null)$$,
  '23505', 'dominio_en_uso', 'un dominio principal de otra tienda se rechaza (dominio_en_uso)'
);
select throws_ok(
  $$select public.configurar_dominio_tienda('e1000000-0000-0000-0000-000000000001', 'no es un dominio', null)$$,
  '22023', 'dominio_invalido', 'un dominio con formato inválido se rechaza (dominio_invalido)'
);
select throws_ok(
  $$select public.configurar_dominio_tienda('e1000000-0000-0000-0000-000000000001', 'nuevo-uno-a.ejemplo.com', 'sin-punto')$$,
  '22023', 'redireccion_invalida', 'una redirección con formato inválido se rechaza (redireccion_invalida)'
);
select throws_ok(
  $$select public.configurar_dominio_tienda('e1000000-0000-0000-0000-000000000001', 'nuevo-uno-a.ejemplo.com', 'NUEVO-uno-a.ejemplo.com')$$,
  '22023', 'redireccion_invalida', 'la redirección debe ser distinta del principal'
);
select throws_ok(
  $$select public.configurar_dominio_tienda('e1000000-0000-0000-0000-000000000001', 'nuevo-uno-a.ejemplo.com', 'dos-a.ejemplo.com')$$,
  '23505', 'redireccion_en_uso', 'una redirección que es dominio de otra tienda se rechaza (redireccion_en_uso)'
);
select is(
  (select dominio_pendiente from dominio.tiendas where empresa_id = 'e1000000-0000-0000-0000-000000000001'),
  null,
  'si falla, no se guarda nada'
);

-- Dominio nuevo: queda pendiente y la tienda sigue respondiendo en el vigente (FR-003, SC-004).
select is(
  (select public.configurar_dominio_tienda('e1000000-0000-0000-0000-000000000001', 'nuevo-uno-a.ejemplo.com', 'www.nuevo-uno-a.ejemplo.com') ->> 'dominio_pendiente'),
  'nuevo-uno-a.ejemplo.com',
  'un dominio principal nuevo queda como pendiente'
);
select is(
  (select count(*)::int from publico.tienda_por_dominio('uno-a.ejemplo.com')),
  1,
  'la tienda sigue respondiendo en el dominio vigente'
);
select is(
  (select count(*)::int from publico.tienda_por_dominio('nuevo-uno-a.ejemplo.com')),
  0,
  'el pendiente todavía no resuelve la tienda'
);

-- ============================================================================
-- Tabla de registros calculada en el servidor (FR-004, FR-005)
-- ============================================================================

select is(
  (select jsonb_agg(r ->> 'tipo') from jsonb_array_elements(public.obtener_dominio_tienda('e1000000-0000-0000-0000-000000000001') -> 'registros') r),
  '["A", "CNAME", "TXT"]'::jsonb,
  'la tabla trae A, CNAME y TXT'
);
select is(
  (select r ->> 'valor' from jsonb_array_elements(public.obtener_dominio_tienda('e1000000-0000-0000-0000-000000000001') -> 'registros') r where r ->> 'tipo' = 'A'),
  (select ip_publica from public.tienda_dns_plataforma),
  'el valor del A sale de tienda_dns_plataforma'
);
select is(
  (select r ->> 'valor' from jsonb_array_elements(public.obtener_dominio_tienda('e1000000-0000-0000-0000-000000000001') -> 'registros') r where r ->> 'tipo' = 'TXT'),
  (select p.prefijo_txt || '=' || t.token_verificacion from public.tienda_dns_plataforma p, dominio.tiendas t where t.empresa_id = 'e1000000-0000-0000-0000-000000000001'),
  'el TXT es <prefijo>=<token> con el token de la tienda'
);
select is(
  (select r ->> 'nombre' from jsonb_array_elements(public.obtener_dominio_tienda('e1000000-0000-0000-0000-000000000001') -> 'registros') r where r ->> 'tipo' = 'CNAME'),
  'www',
  'el CNAME muestra la etiqueta relativa al dominio principal'
);
select is(
  (select count(*)::int from jsonb_array_elements(public.obtener_dominio_tienda('e1000000-0000-0000-0000-000000000001') -> 'registros') r where r ->> 'estado' = 'pendiente'),
  3,
  'sin comprobar, los tres registros están Pendiente'
);
select is(
  (select jsonb_array_length(public.obtener_dominio_tienda('e1000000-0000-0000-0000-000000000002') -> 'registros')),
  2,
  'sin redirección, la tabla solo trae A y TXT'
);

-- ============================================================================
-- Permisos por nivel de sección y aislamiento (FR-002, SC-001)
-- ============================================================================

select throws_ok(
  $$select public.configurar_dominio_tienda('e2000000-0000-0000-0000-000000000001', 'otro-dos.ejemplo.com', null)$$,
  'P0002', null, 'no se configura el dominio de una empresa de otra organización'
);
select throws_ok(
  $$select public.obtener_dominio_tienda('e2000000-0000-0000-0000-000000000001')$$,
  'P0002', null, 'no se lee el dominio de una empresa de otra organización'
);
select is((select count(*)::int from dominio.tiendas where empresa_id = 'e2000000-0000-0000-0000-000000000001'), 0, 'la tienda de la otra organización no es visible');

-- Preparar la verificación (FR-009, FR-010).
select is(
  (select public.preparar_verificacion_tienda('e1000000-0000-0000-0000-000000000001') ->> 'dominio'),
  'nuevo-uno-a.ejemplo.com',
  'preparar devuelve el hostname guardado (el pendiente) y no uno del request'
);
select throws_ok(
  $$select public.preparar_verificacion_tienda('e1000000-0000-0000-0000-000000000001')$$,
  '55000', 'demasiado_pronto', 'una segunda verificación dentro de 10 s se rechaza'
);
select throws_ok(
  $$select public.registrar_verificacion_dns('e1000000-0000-0000-0000-000000000001', '[]'::jsonb, 'pendiente')$$,
  '42501', null, 'authenticated no puede registrar resultados de verificación'
);

reset role;

select set_config('request.jwt.claims', json_build_object('sub', 'd1000000-0000-0000-0000-000000000002', 'role', 'authenticated')::text, true);
set local role authenticated;

select throws_ok(
  $$select public.configurar_dominio_tienda('e1000000-0000-0000-0000-000000000001', 'otro.ejemplo.com', null)$$,
  '42501', 'sin_permiso', 'sin edición en Empresas no se configura el dominio'
);
select throws_ok(
  $$select public.obtener_dominio_tienda('e1000000-0000-0000-0000-000000000001')$$,
  '42501', 'sin_permiso', 'sin edición en Empresas no se lee el estado de verificación'
);
select throws_ok(
  $$select public.preparar_verificacion_tienda('e1000000-0000-0000-0000-000000000001')$$,
  '42501', 'sin_permiso', 'sin edición en Empresas no se prepara una verificación'
);

reset role;

-- ============================================================================
-- Registro de la verificación (solo service_role) y promoción del pendiente (FR-003, FR-011, FR-012)
-- ============================================================================

set local role service_role;

select throws_ok(
  $$select public.registrar_verificacion_dns('e1000000-0000-0000-0000-000000000002', '[]'::jsonb, 'pendiente')$$,
  '55000', 'verificacion_obsoleta', 'un resultado sin verificación pedida se rechaza'
);
select throws_ok(
  $$select public.registrar_verificacion_dns('e1000000-0000-0000-0000-000000000001', '[{"tipo":"MX","nombre":"@","estado":"correcto"}]'::jsonb, 'pendiente')$$,
  '22023', null, 'un tipo de registro inválido se rechaza'
);
select lives_ok(
  $$select public.registrar_verificacion_dns('e1000000-0000-0000-0000-000000000001', '[
    {"tipo":"A","nombre":"@","estado":"correcto"},
    {"tipo":"TXT","nombre":"_verif","estado":"correcto"},
    {"tipo":"CNAME","nombre":"www","estado":"correcto"}]'::jsonb, 'pendiente')$$,
  'service_role registra los tres registros correctos con el certificado pendiente'
);

reset role;

select is(
  (select dominio from dominio.tiendas where empresa_id = 'e1000000-0000-0000-0000-000000000001'),
  'uno-a.ejemplo.com',
  'verificado pero sin certificado activo, el pendiente NO reemplaza al vigente (FR-003)'
);
select ok(
  (select dominio_verificado_at is not null and ultima_verificacion_at is not null from dominio.tiendas where empresa_id = 'e1000000-0000-0000-0000-000000000001'),
  'con los tres registros correctos el dominio queda verificado (FR-011)'
);

set local role service_role;
select lives_ok(
  $$select public.registrar_verificacion_dns('e1000000-0000-0000-0000-000000000001', '[
    {"tipo":"A","nombre":"@","estado":"correcto"},
    {"tipo":"TXT","nombre":"_verif","estado":"correcto"},
    {"tipo":"CNAME","nombre":"www","estado":"correcto"}]'::jsonb, 'activo')$$,
  'service_role registra la verificación con el certificado activo'
);
reset role;

select is(
  (select dominio || '|' || coalesce(dominio_pendiente, 'nulo') from dominio.tiendas where empresa_id = 'e1000000-0000-0000-0000-000000000001'),
  'nuevo-uno-a.ejemplo.com|nulo',
  'verificado con certificado activo, el pendiente pasa a ser el principal'
);
select is((select count(*)::int from publico.tienda_por_dominio('nuevo-uno-a.ejemplo.com')), 1, 'la tienda resuelve por el dominio nuevo');
select is((select count(*)::int from publico.tienda_por_dominio('uno-a.ejemplo.com')), 0, 'el dominio anterior deja de resolver');

-- Con un registro incorrecto el dominio no se verifica y el certificado no cuenta (FR-012).
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', 'd1000000-0000-0000-0000-000000000001', 'role', 'authenticated')::text, true);
select lives_ok($$select public.preparar_verificacion_tienda('e1000000-0000-0000-0000-000000000002')$$, 'se prepara la verificación de la otra tienda');
reset role;
set local role service_role;
select lives_ok(
  $$select public.registrar_verificacion_dns('e1000000-0000-0000-0000-000000000002', '[
    {"tipo":"A","nombre":"@","estado":"incorrecto","valor_encontrado":"198.51.100.7"},
    {"tipo":"TXT","nombre":"_verif","estado":"correcto"}]'::jsonb, 'activo')$$,
  'service_role registra un A incorrecto'
);
reset role;
select is(
  (select coalesce(dominio_verificado_at::text, 'nulo') || '|' || certificado_estado from dominio.tiendas where empresa_id = 'e1000000-0000-0000-0000-000000000002'),
  'nulo|pendiente',
  'con un registro incorrecto el dominio sigue sin verificar y el certificado se fuerza a pendiente'
);
select is(
  (select valor_encontrado from dominio.tienda_registros_dns where empresa_id = 'e1000000-0000-0000-0000-000000000002' and tipo = 'A'),
  '198.51.100.7',
  'se guarda el valor encontrado como ayuda'
);

-- ============================================================================
-- Auditoría (FR-014): sin valores de registros
-- ============================================================================

select ok(
  (select count(*) from public.registro_actividad where tipo = 'tienda.dominio_verificado' and empresa_id = 'e1000000-0000-0000-0000-000000000001') >= 1,
  'queda la fila tienda.dominio_verificado'
);
select is(
  (select actor_id::text from public.registro_actividad where tipo = 'tienda.dominio_verificado' and empresa_id = 'e1000000-0000-0000-0000-000000000001' order by creado_en desc limit 1),
  'd1000000-0000-0000-0000-000000000001',
  'el actor es quien pidió la verificación'
);
select ok(
  (select count(*) from public.registro_actividad where tipo = 'tienda.dominio_configurado' and detalle like '%pendiente de verificación%') >= 1,
  'guardar el dominio pendiente también deja tienda.dominio_configurado'
);
select is(
  (select count(*)::int from public.registro_actividad
    where tipo in ('tienda.dominio_verificado', 'tienda.dominio_configurado')
      and (detalle like '%203.0.113%' or detalle like '%gc-verify%' or detalle like '%ejemplo.com%')),
  0,
  'el detalle de auditoría no incluye dominios ni valores de registros'
);

-- ============================================================================
-- Redirección pública (FR-013, SC-002)
-- ============================================================================

select set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);
set local role anon;

select is(
  (select dominio_principal from publico.redireccion_por_dominio('WWW.Nuevo-Uno-A.ejemplo.com:443')),
  'nuevo-uno-a.ejemplo.com',
  'el «Redirigir también» responde con el dominio principal'
);
select is((select count(*)::int from publico.redireccion_por_dominio('nuevo-uno-a.ejemplo.com')), 0, 'el dominio principal no redirige');
select is((select count(*)::int from publico.redireccion_por_dominio('desconocido.ejemplo.com')), 0, 'un host desconocido no devuelve nada');
select throws_ok($$select * from dominio.tienda_registros_dns$$, '42501', null, 'anon no lee los registros DNS');
select throws_ok($$select * from public.tienda_dns_plataforma$$, '42501', null, 'anon no lee la configuración DNS de la plataforma');

reset role;

update dominio.empresas set activa = false where id = 'e1000000-0000-0000-0000-000000000001';
set local role anon;
select is(
  (select count(*)::int from publico.redireccion_por_dominio('www.nuevo-uno-a.ejemplo.com')),
  0,
  'con la empresa desactivada responde lo mismo que un host desconocido'
);
reset role;
update dominio.empresas set activa = true where id = 'e1000000-0000-0000-0000-000000000001';

-- ============================================================================
-- Aislamiento entre organizaciones (SC-001) — administrador de Dos
-- ============================================================================

select set_config('request.jwt.claims', json_build_object('sub', 'd2000000-0000-0000-0000-000000000001', 'role', 'authenticated')::text, true);
set local role authenticated;

select is((select count(*)::int from dominio.tienda_registros_dns), 0, 'Dos no ve los registros DNS de Uno');
select is((select count(*)::int from dominio.tiendas where dominio = 'nuevo-uno-a.ejemplo.com'), 0, 'Dos no ve el dominio de Uno');
select throws_ok(
  $$select public.configurar_dominio_tienda('e2000000-0000-0000-0000-000000000001', 'www.nuevo-uno-a.ejemplo.com', null)$$,
  '23505', 'dominio_en_uso', 'el «Redirigir también» de otra organización cuenta para la unicidad'
);
select throws_ok(
  $$select public.configurar_dominio_tienda('e1000000-0000-0000-0000-000000000001', 'x.ejemplo.com', null)$$,
  'P0002', null, 'Dos no configura el dominio de una empresa de Uno'
);
select throws_ok(
  $$insert into dominio.tienda_registros_dns (empresa_id, organizacion_id, tipo, nombre) values ('e2000000-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', 'A', '@')$$,
  '42501', null, 'authenticated no escribe registros DNS por tabla'
);
select throws_ok(
  $$update public.tienda_dns_plataforma set ip_publica = '198.51.100.1'$$,
  '42501', null, 'authenticated no escribe la configuración DNS de la plataforma'
);
select is((select count(*)::int from public.tienda_dns_plataforma), 1, 'authenticated lee la configuración DNS de la plataforma');

reset role;

-- Quitar «Redirigir también» borra su comprobación del CNAME.
select set_config('request.jwt.claims', json_build_object('sub', 'd1000000-0000-0000-0000-000000000001', 'role', 'authenticated')::text, true);
set local role authenticated;
select is(
  (select public.configurar_dominio_tienda('e1000000-0000-0000-0000-000000000001', 'nuevo-uno-a.ejemplo.com', null) ->> 'redireccion'),
  null,
  'se quita la redirección'
);
reset role;
select is(
  (select count(*)::int from dominio.tienda_registros_dns where empresa_id = 'e1000000-0000-0000-0000-000000000001' and tipo = 'CNAME'),
  0,
  'sin redirección no queda comprobación del CNAME'
);

select * from finish();
rollback;
