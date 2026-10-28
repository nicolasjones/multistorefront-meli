-- F-CON-02 (MSF-226, épica MSF-130, SC-001): interés por WhatsApp registrado.
-- Cubre FR-001…FR-004: alta por la RPC pública (empresa solo por dominio), fila sin datos personales,
-- el mismo error genérico para dominio desconocido y empresa desactivada (resuelto antes de validar el
-- producto), producto inválido o de otra organización, escritura directa rechazada, aislamiento entre dos
-- organizaciones y entre empresas sin acceso, permisos por nivel de la sección `consultas`, agregación
-- de la vista y `anon` solo con la RPC (sin acceso a la tabla ni a la vista).
-- El fixture corre como postgres (RLS no aplica); las llamadas públicas, como `anon`; las lecturas,
-- como `authenticated`.
begin;

select plan(38);

-- ============================================================================
-- Fixture
-- ============================================================================

insert into organizaciones (id, nombre) values
  ('11111111-1111-1111-1111-111111111111', 'Organización Uno'),
  ('22222222-2222-2222-2222-222222222222', 'Organización Dos');

insert into auth.users (id, email) values
  ('d1000000-0000-0000-0000-000000000011', 'admin-uno@example.com'),
  ('d1000000-0000-0000-0000-000000000013', 'consulta-uno@example.com'),
  ('d1000000-0000-0000-0000-000000000014', 'deposito-uno@example.com'),
  ('d2000000-0000-0000-0000-000000000011', 'admin-dos@example.com');

insert into usuarios_organizacion (user_id, organizacion_id, rol_id) values
  ('d1000000-0000-0000-0000-000000000011', '11111111-1111-1111-1111-111111111111', 'administrador'),
  ('d1000000-0000-0000-0000-000000000013', '11111111-1111-1111-1111-111111111111', 'consulta'),
  ('d1000000-0000-0000-0000-000000000014', '11111111-1111-1111-1111-111111111111', 'deposito'),
  ('d2000000-0000-0000-0000-000000000011', '22222222-2222-2222-2222-222222222222', 'administrador');

-- Org 1: tienda A, tienda B y una apagada. Org 2: tienda D.
insert into dominio.empresas (id, organizacion_id, nombre, activa) values
  ('e1000000-0000-0000-0000-00000000000a', '11111111-1111-1111-1111-111111111111', 'Tienda A', true),
  ('e1000000-0000-0000-0000-00000000000b', '11111111-1111-1111-1111-111111111111', 'Tienda B', true),
  ('e1000000-0000-0000-0000-00000000000c', '11111111-1111-1111-1111-111111111111', 'Tienda apagada', false),
  ('e2000000-0000-0000-0000-00000000000d', '22222222-2222-2222-2222-222222222222', 'Tienda D', true);

insert into dominio.tiendas (organizacion_id, empresa_id, dominio) values
  ('11111111-1111-1111-1111-111111111111', 'e1000000-0000-0000-0000-00000000000a', 'tienda-a.ejemplo.com'),
  ('11111111-1111-1111-1111-111111111111', 'e1000000-0000-0000-0000-00000000000b', 'tienda-b.ejemplo.com'),
  ('11111111-1111-1111-1111-111111111111', 'e1000000-0000-0000-0000-00000000000c', 'tienda-apagada.ejemplo.com'),
  ('22222222-2222-2222-2222-222222222222', 'e2000000-0000-0000-0000-00000000000d', 'tienda-d.ejemplo.com');

insert into dominio.productos (id, organizacion_id, nombre, sku, precio_lista, moneda, activo) values
  ('a1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'Alfa', 'PC-1', 100, 'ARS', true),
  ('a1000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'Beta', 'PC-2', 100, 'ARS', true),
  ('b2000000-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', 'Dos', 'PD-1', 100, 'ARS', true);

-- La sección `consultas` es por empresa: los miembros no administradores trabajan en su empresa asignada y activa.
insert into usuarios_empresas (user_id, empresa_id, organizacion_id, rol_id) values
  ('d1000000-0000-0000-0000-000000000013', 'e1000000-0000-0000-0000-00000000000a', '11111111-1111-1111-1111-111111111111', 'consulta'),
  ('d1000000-0000-0000-0000-000000000014', 'e1000000-0000-0000-0000-00000000000a', '11111111-1111-1111-1111-111111111111', 'deposito');
insert into usuario_empresa_activa (user_id, empresa_id) values
  ('d1000000-0000-0000-0000-000000000013', 'e1000000-0000-0000-0000-00000000000a'),
  ('d1000000-0000-0000-0000-000000000014', 'e1000000-0000-0000-0000-00000000000a');

create function pg_temp.como(p_user uuid) returns void language plpgsql as $$
begin
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
  set local role authenticated;
end $$;

-- ============================================================================
-- Estructura y privilegios (FR-001, FR-002)
-- ============================================================================

select is(has_function_privilege('anon', 'publico.registrar_interes_whatsapp(text, uuid)', 'execute'), true,
  'anon ejecuta la RPC pública');
select is(has_function_privilege('authenticated', 'publico.registrar_interes_whatsapp(text, uuid)', 'execute'), true,
  'authenticated ejecuta la RPC pública');
select is(
  (select count(*)::int from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'publico' and c.relkind in ('r', 'p')),
  0, 'publico sigue sin tablas'
);
select is(
  (select c.relrowsecurity from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'dominio' and c.relname = 'intereses_whatsapp'),
  true, 'dominio.intereses_whatsapp tiene RLS'
);
select set_eq(
  $$select column_name::text from information_schema.columns
     where table_schema = 'dominio' and table_name = 'intereses_whatsapp'$$,
  array['id', 'organizacion_id', 'empresa_id', 'producto_id', 'created_at'],
  'la tabla solo guarda organización, empresa, producto y fecha'
);
select is_empty(
  $$select column_name from information_schema.columns
     where table_schema = 'dominio' and table_name = 'intereses_whatsapp'
       and column_name ~* '(nombre|telefono|contacto|correo|email|ip|mensaje|host|agente)'$$,
  'ninguna columna personal (nombre, teléfono, correo, IP ni mensaje)'
);
select set_eq(
  $$select column_name::text from information_schema.columns
     where table_schema = 'public' and table_name = 'interes_whatsapp_por_producto'$$,
  array['organizacion_id', 'empresa_id', 'empresa_nombre', 'producto_id', 'producto_nombre', 'sku', 'total', 'ultimo_interes_at'],
  'la vista expone el contrato de FR-004'
);
select is(
  (select coalesce((select reloptions @> array['security_invoker=true'] from pg_class c
     join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relname = 'interes_whatsapp_por_producto'), false)),
  true, 'la vista es security_invoker'
);
select is(has_table_privilege('anon', 'dominio.intereses_whatsapp', 'select'), false, 'anon sin SELECT en la tabla');
select is(has_table_privilege('anon', 'public.interes_whatsapp_por_producto', 'select'), false, 'anon sin SELECT en la vista');

-- ============================================================================
-- Alta como anon: empresa solo por dominio (FR-002)
-- ============================================================================

set local role anon;

select lives_ok(
  $$select publico.registrar_interes_whatsapp('  Tienda-A.Ejemplo.com.:443 ', 'a1000000-0000-0000-0000-000000000001')$$,
  'alta con host con mayúsculas, puerto y punto final');
select lives_ok(
  $$select publico.registrar_interes_whatsapp('tienda-a.ejemplo.com', 'a1000000-0000-0000-0000-000000000001')$$,
  'segundo interés por el mismo producto');
select lives_ok(
  $$select publico.registrar_interes_whatsapp('tienda-a.ejemplo.com', 'a1000000-0000-0000-0000-000000000002')$$,
  'interés por otro producto');
select lives_ok(
  $$select publico.registrar_interes_whatsapp('tienda-b.ejemplo.com', 'a1000000-0000-0000-0000-000000000001')$$,
  'el mismo producto en otra tienda de la organización');
select lives_ok(
  $$select publico.registrar_interes_whatsapp('tienda-d.ejemplo.com', 'b2000000-0000-0000-0000-000000000001')$$,
  'interés en la tienda de la otra organización');

-- ============================================================================
-- Errores (FR-003): mismo error genérico, resuelto antes de validar el producto
-- ============================================================================

select throws_ok(
  $$select publico.registrar_interes_whatsapp('no-existe.ejemplo.com', 'a1000000-0000-0000-0000-000000000001')$$,
  'P0002', 'tienda no disponible', 'dominio desconocido → error genérico');
select throws_ok(
  $$select publico.registrar_interes_whatsapp('tienda-apagada.ejemplo.com', 'a1000000-0000-0000-0000-000000000001')$$,
  'P0002', 'tienda no disponible', 'empresa desactivada → el mismo error genérico');
select throws_ok(
  $$select publico.registrar_interes_whatsapp('no-existe.ejemplo.com', null)$$,
  'P0002', 'tienda no disponible', 'dominio desconocido con producto nulo: el dominio se resuelve primero');
select throws_ok(
  $$select publico.registrar_interes_whatsapp(null, 'a1000000-0000-0000-0000-000000000001')$$,
  'P0002', 'tienda no disponible', 'host nulo → error genérico');
select throws_ok(
  $$select publico.registrar_interes_whatsapp('tienda-a.ejemplo.com', '00000000-0000-0000-0000-00000000dead')$$,
  '22023', 'producto inválido', 'producto inexistente → datos inválidos');
select throws_ok(
  $$select publico.registrar_interes_whatsapp('tienda-a.ejemplo.com', 'b2000000-0000-0000-0000-000000000001')$$,
  '22023', 'producto inválido', 'producto de otra organización → datos inválidos');
select throws_ok(
  $$select publico.registrar_interes_whatsapp('tienda-a.ejemplo.com', null)$$,
  '22023', 'producto inválido', 'producto nulo → datos inválidos');

-- anon no toca la tabla ni la vista.
select throws_ok($$select * from dominio.intereses_whatsapp$$, '42501', null, 'anon no lee la tabla');
select throws_ok($$select * from public.interes_whatsapp_por_producto$$, '42501', null, 'anon no lee la vista');

-- ============================================================================
-- Lo guardado (como postgres)
-- ============================================================================

reset role;

select is((select count(*)::int from dominio.intereses_whatsapp), 5, 'los errores no guardaron nada: solo las 5 altas');
select is(
  (select count(*)::int from dominio.intereses_whatsapp
    where empresa_id = 'e1000000-0000-0000-0000-00000000000a' and organizacion_id = '11111111-1111-1111-1111-111111111111'
      and producto_id = 'a1000000-0000-0000-0000-000000000001'),
  2, 'la empresa y la organización salen del dominio (host normalizado)');

-- ============================================================================
-- Lectura: administrador de la Uno
-- ============================================================================

select pg_temp.como('d1000000-0000-0000-0000-000000000011');

select is(
  (select count(*)::int from public.interes_whatsapp_por_producto
    where organizacion_id = '11111111-1111-1111-1111-111111111111'),
  3, 'el administrador ve una fila por empresa y producto (A·Alfa, A·Beta, B·Alfa)');
select is(
  (select total from public.interes_whatsapp_por_producto
    where empresa_id = 'e1000000-0000-0000-0000-00000000000a' and producto_id = 'a1000000-0000-0000-0000-000000000001'),
  2::bigint, 'agrupa por empresa y producto: Alfa en A suma 2');
select ok(
  (select ultimo_interes_at is not null and producto_nombre = 'Alfa' and empresa_nombre = 'Tienda A' and sku = 'PC-1'
     from public.interes_whatsapp_por_producto
    where empresa_id = 'e1000000-0000-0000-0000-00000000000a' and producto_id = 'a1000000-0000-0000-0000-000000000001'),
  'la vista trae nombres, SKU y último interés');
select is(
  (select count(*)::int from public.interes_whatsapp_por_producto where organizacion_id = '22222222-2222-2222-2222-222222222222'),
  0, 'aislamiento entre organizaciones: la Uno no ve nada de la Dos');

-- Sin escritura directa (ni siquiera el administrador).
select throws_ok(
  $$insert into dominio.intereses_whatsapp (organizacion_id, empresa_id, producto_id)
    values ('11111111-1111-1111-1111-111111111111', 'e1000000-0000-0000-0000-00000000000a', 'a1000000-0000-0000-0000-000000000001')$$,
  '42501', null, 'insert directo rechazado');
select throws_ok(
  $$update dominio.intereses_whatsapp set created_at = now()$$,
  '42501', null, 'update directo rechazado');
select throws_ok(
  $$delete from dominio.intereses_whatsapp$$,
  '42501', null, 'delete directo rechazado');

-- ============================================================================
-- Permisos por nivel y empresa accesible
-- ============================================================================

select pg_temp.como('d1000000-0000-0000-0000-000000000013');

select is(
  (select count(*)::int from public.interes_whatsapp_por_producto),
  2, 'consultas = lectura: ve su empresa (A·Alfa y A·Beta)');
select is(
  (select count(*)::int from public.interes_whatsapp_por_producto where empresa_id = 'e1000000-0000-0000-0000-00000000000b'),
  0, 'no ve una empresa a la que no tiene acceso (B)');

select pg_temp.como('d1000000-0000-0000-0000-000000000014');

select is(
  (select count(*)::int from public.interes_whatsapp_por_producto),
  0, 'consultas = ninguno: no ve ningún conteo (lo impide la base)');

-- ============================================================================
-- Aislamiento: administrador de la Dos
-- ============================================================================

select pg_temp.como('d2000000-0000-0000-0000-000000000011');

select is(
  (select count(*)::int from public.interes_whatsapp_por_producto),
  1, 'la Dos ve solo lo suyo (D·Dos)');
select is(
  (select count(*)::int from dominio.intereses_whatsapp where organizacion_id = '11111111-1111-1111-1111-111111111111'),
  0, 'la Dos no lee filas de la tabla de la Uno');

reset role;

select * from finish();

rollback;
