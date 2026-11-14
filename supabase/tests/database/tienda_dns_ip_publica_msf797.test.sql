-- MSF-797 (épica MSF-515, Lote 1), parte (a): `public.tienda_dns_plataforma.ip_publica` debe ser una IPv4 pública.
-- Verifica private.ip_publica_valida (rangos rechazados, bordes, notación estricta, TEST-NET-2/3 admitidos por el seed),
-- el CHECK sobre la tabla (rechaza y admite; la fila existente cumple), y que las dos RPC que leen la IP no la usan si
-- no es pública (preparar_verificacion_tienda falla sin gastar el límite; obtener_dominio_tienda no muestra el A).
begin;

select plan(32);

-- ============================================================================
-- Fixture (como postgres)
-- ============================================================================

insert into organizaciones (id, nombre) values ('11111111-1111-1111-1111-111111111111', 'Organización Uno');
insert into auth.users (id, email) values ('d1000000-0000-0000-0000-000000000001', 'admin-uno@example.com');
insert into usuarios_organizacion (user_id, organizacion_id, rol_id) values
  ('d1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'administrador');
insert into dominio.empresas (id, organizacion_id, nombre) values
  ('e1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'Uno A');
insert into dominio.tiendas (organizacion_id, empresa_id, dominio) values
  ('11111111-1111-1111-1111-111111111111', 'e1000000-0000-0000-0000-000000000001', 'ipp-a.ejemplo.com');

-- ============================================================================
-- Privilegios y definición
-- ============================================================================

select is(has_function_privilege('anon', 'private.ip_publica_valida(text)', 'execute'), false, 'anon no ejecuta ip_publica_valida');
select is(
  (select p.prosecdef is false and p.proconfig = array['search_path=""'] from pg_proc p where p.oid = 'private.ip_publica_valida(text)'::regprocedure),
  true, 'ip_publica_valida es invoker con search_path vacío');

-- ============================================================================
-- private.ip_publica_valida: públicas
-- ============================================================================

select is(private.ip_publica_valida('212.90.120.53'), true, 'la IP de dev (pública) es válida');
select is(private.ip_publica_valida('8.8.8.8'), true, 'una pública cualquiera es válida');
select is(private.ip_publica_valida('203.0.113.24'), true, 'TEST-NET-3 (el valor sembrado) se admite');
select is(private.ip_publica_valida('198.51.100.1'), true, 'TEST-NET-2 (usado por los tests) se admite');
select is(private.ip_publica_valida('1.0.0.1'), true, 'borde inferior de lo público');
select is(private.ip_publica_valida('223.255.255.254'), true, 'borde superior de lo público (antes del multicast)');
select is(private.ip_publica_valida('172.32.0.1'), true, 'justo fuera de 172.16/12');
select is(private.ip_publica_valida('100.128.0.1'), true, 'justo fuera de 100.64/10');
select is(private.ip_publica_valida('198.20.0.1'), true, 'justo fuera de 198.18/15');

-- ============================================================================
-- private.ip_publica_valida: rechazadas (un caso por rango y por borde)
-- ============================================================================

select is(
  (select array_agg(private.ip_publica_valida(ip) order by ip)
     from unnest(array['0.0.0.0', '0.255.255.255', '10.0.0.1', '10.255.255.255', '100.64.0.1', '100.127.255.255',
                       '127.0.0.1', '127.255.255.254', '169.254.169.254', '172.16.0.1', '172.31.255.255',
                       '192.0.0.1', '192.0.2.10', '192.168.0.1', '192.168.255.255', '198.18.0.1', '198.19.255.255',
                       '224.0.0.1', '239.255.255.255', '240.0.0.1', '255.255.255.255']) as ip),
  array_fill(false, array[21]),
  'loopback, privadas, CGNAT, link-local, TEST-NET-1, benchmarking, multicast y reservadas: todas inválidas');
select is(private.ip_publica_valida('100.63.255.255'), true, '100.63.255.255 está fuera de CGNAT');
select is(private.ip_publica_valida('192.0.1.1'), true, '192.0.1.1 está fuera de 192.0.0/24 y 192.0.2/24');

select is(
  (select array_agg(private.ip_publica_valida(ip) order by ip)
     from unnest(array['256.1.1.1', '1.2.3.999', '1.2.3', '1.2.3.4.5', '01.2.3.4', '1.2.3.04', '1.2.3.4 ', ' 1.2.3.4',
                       'a.b.c.d', '', '1.2.3.-4', '1.2.3.4/32', '8.8.8.8
9.9.9.9']) as ip),
  array_fill(false, array[13]),
  'octetos > 255, cantidad errónea, ceros a la izquierda, espacios, saltos de línea y basura: inválidos');
select is(private.ip_publica_valida(null), false, 'null no es válida (la columna es not null igual)');

-- ============================================================================
-- CHECK sobre la tabla
-- ============================================================================

select is(
  (select c.convalidated from pg_constraint c
    where c.conrelid = 'public.tienda_dns_plataforma'::regclass and c.conname = 'tienda_dns_plataforma_ip_publica'),
  true, 'el CHECK existe y está validado (la fila existente lo cumple)');
select is(private.ip_publica_valida((select ip_publica from public.tienda_dns_plataforma)), true, 'la fila única de configuración tiene una IP válida');

select throws_ok($$update public.tienda_dns_plataforma set ip_publica = '127.0.0.1'$$, '23514', null, 'el CHECK rechaza loopback');
select throws_ok($$update public.tienda_dns_plataforma set ip_publica = '10.0.0.5'$$, '23514', null, 'el CHECK rechaza una red privada 10/8');
select throws_ok($$update public.tienda_dns_plataforma set ip_publica = '192.168.1.10'$$, '23514', null, 'el CHECK rechaza 192.168/16');
select throws_ok($$update public.tienda_dns_plataforma set ip_publica = '172.20.0.1'$$, '23514', null, 'el CHECK rechaza 172.16/12');
select throws_ok($$update public.tienda_dns_plataforma set ip_publica = '300.1.1.1'$$, '23514', null, 'el CHECK rechaza octetos > 255');
select throws_ok($$update public.tienda_dns_plataforma set ip_publica = '224.0.0.1'$$, '23514', null, 'el CHECK rechaza multicast');
select lives_ok($$update public.tienda_dns_plataforma set ip_publica = '212.90.120.53'$$, 'el CHECK admite la IP pública de dev');
select lives_ok($$update public.tienda_dns_plataforma set ip_publica = '203.0.113.24'$$, 'el CHECK admite el valor de documentación sembrado');

-- ============================================================================
-- RPC que leen la IP
-- ============================================================================

select set_config('request.jwt.claims', json_build_object('sub', 'd1000000-0000-0000-0000-000000000001', 'role', 'authenticated')::text, true);
set local role authenticated;

select is(
  (select r ->> 'valor' from jsonb_array_elements(public.obtener_dominio_tienda('e1000000-0000-0000-0000-000000000001') -> 'registros') r where r ->> 'tipo' = 'A'),
  '203.0.113.24', 'obtener_dominio_tienda muestra el A con una IP pública');
select is(
  (public.preparar_verificacion_tienda('e1000000-0000-0000-0000-000000000001') ->> 'ip_publica'),
  '203.0.113.24', 'preparar_verificacion_tienda devuelve la IP pública');
reset role;

-- Una fila pendiente de validar (constraint caída a propósito, solo dentro de esta prueba) con una IP interna.
alter table public.tienda_dns_plataforma drop constraint tienda_dns_plataforma_ip_publica;
update public.tienda_dns_plataforma set ip_publica = '10.0.0.5';
update dominio.tiendas set verificacion_solicitada_at = null where empresa_id = 'e1000000-0000-0000-0000-000000000001';

select set_config('request.jwt.claims', json_build_object('sub', 'd1000000-0000-0000-0000-000000000001', 'role', 'authenticated')::text, true);
set local role authenticated;

select throws_ok(
  $$select public.preparar_verificacion_tienda('e1000000-0000-0000-0000-000000000001')$$,
  '22023', 'plataforma_no_configurada', 'preparar_verificacion_tienda rechaza una IP no pública');
select is(
  (select count(*)::int from jsonb_array_elements(public.obtener_dominio_tienda('e1000000-0000-0000-0000-000000000001') -> 'registros') r where r ->> 'tipo' = 'A'),
  0, 'obtener_dominio_tienda no muestra un registro A con una IP no pública');
select is(
  (select count(*)::int from jsonb_array_elements(public.obtener_dominio_tienda('e1000000-0000-0000-0000-000000000001') -> 'registros') r where r ->> 'tipo' = 'TXT'),
  1, 'los demás registros (TXT) se siguen mostrando');
reset role;

select is(
  (select verificacion_solicitada_at is null from dominio.tiendas where empresa_id = 'e1000000-0000-0000-0000-000000000001'),
  true, 'la IP no pública no gasta el límite de 10 s de la verificación');

select * from finish();
rollback;
