-- MSF-946 / MSF-947 (épica MSF-515, Lote 3; seguimientos de MSF-945): `private.visitante_publico` es un HMAC con el
-- secreto de Vault (no un sha256 enumerable) y `private.registrar_envio_tienda` poda lo vencido de cualquier empresa.
begin;

select plan(9);

insert into organizaciones (id, nombre) values ('11111111-1111-1111-1111-111111111111', 'Organización Uno');
insert into dominio.empresas (id, organizacion_id, nombre, activa) values
  ('e1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'Tienda A', true),
  ('e1000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'Tienda B', true);

-- ============================================================================
-- MSF-946 · visitante_publico = HMAC(ip|host)
-- ============================================================================

select set_config('request.headers', '{"x-forwarded-for": "203.0.113.7"}', true);

select is(
  private.visitante_publico('tienda.example.com'),
  'hmac:' || encode(extensions.hmac('203.0.113.7|' || private.normalizar_host('tienda.example.com'),
                         (select decrypted_secret from vault.decrypted_secrets where name = 'visitante_hmac'), 'sha256'), 'hex'),
  'visitante_publico = HMAC-SHA256(ip|host) con el secreto de Vault (con el prefijo «hmac:»)');
select isnt(
  private.visitante_publico('tienda.example.com'),
  encode(sha256(convert_to('203.0.113.7|' || private.normalizar_host('tienda.example.com'), 'UTF8')), 'hex'),
  'ya no es el sha256 sin clave, que se enumera probando todas las IPv4');
select is(private.visitante_publico('tienda.example.com'), private.visitante_publico('TIENDA.example.com'),
  'el host se normaliza: el mismo visitante en el mismo host da el mismo valor');
select isnt(private.visitante_publico('tienda.example.com'), private.visitante_publico('otra.example.com'),
  'otro host da otro visitante');

select set_config('request.headers', '{}', true);
select is(
  private.visitante_publico('tienda.example.com'),
  'hmac:' || encode(extensions.hmac('sin-ip|' || private.normalizar_host('tienda.example.com'),
                         (select decrypted_secret from vault.decrypted_secrets where name = 'visitante_hmac'), 'sha256'), 'hex'),
  'sin x-forwarded-for todos caen en un único cupo «sin-ip» (falla cerrada)');
select is(
  has_function_privilege('anon', 'private.visitante_publico(text)', 'execute')
  or has_function_privilege('authenticated', 'private.visitante_publico(text)', 'execute'),
  false, 'ni anon ni authenticated ejecutan visitante_publico');

-- ============================================================================
-- MSF-947 · poda global acotada
-- ============================================================================

insert into dominio.tienda_envios (organizacion_id, empresa_id, visitante, clave_envio, origen, creado_en) values
  ('11111111-1111-1111-1111-111111111111', 'e1000000-0000-0000-0000-000000000002', 'viejo-1', gen_random_uuid(), 'formulario', now() - interval '30 hours'),
  ('11111111-1111-1111-1111-111111111111', 'e1000000-0000-0000-0000-000000000002', 'viejo-2', gen_random_uuid(), 'formulario', now() - interval '25 hours'),
  ('11111111-1111-1111-1111-111111111111', 'e1000000-0000-0000-0000-000000000002', 'reciente', gen_random_uuid(), 'formulario', now() - interval '2 hours');

select set_config('request.headers', '{"x-forwarded-for": "198.51.100.9"}', true);
select is(private.registrar_envio_tienda('e1000000-0000-0000-0000-000000000001', 'formulario', gen_random_uuid()) ->> 'estado', 'nuevo',
  'un envío de la empresa A se registra');
select is((select count(*)::int from dominio.tienda_envios where empresa_id = 'e1000000-0000-0000-0000-000000000002' and visitante like 'viejo-%'), 0,
  'registrar un envío en A poda lo vencido de la empresa B, que no tiene tráfico');
select is((select count(*)::int from dominio.tienda_envios where empresa_id = 'e1000000-0000-0000-0000-000000000002' and visitante = 'reciente'), 1,
  'lo que no venció (menos de 24 h) se conserva');

select * from finish();
rollback;
