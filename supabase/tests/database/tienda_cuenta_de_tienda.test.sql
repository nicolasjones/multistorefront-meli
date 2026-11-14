-- MSF-176 · Tienda compra y cuentas, T002 (amenazas 2.1-2.3 y 3.1): `private.cuenta_de_tienda(host)`, el único punto de
-- identidad de las RPC de cuenta. Dos organizaciones, dos tiendas de la misma organización, varios clientes: solo una cuenta
-- ACTIVA de un cliente habilitado, no archivado y no consumidor final, en la tienda de ESE host, devuelve algo; suspendida, no
-- habilitada, otra tienda, usuario de panel sin cuenta, anónimo, archivado, consumidor final, host desconocido, empresa
-- desactivada y otra organización devuelven vacío. Sin execute para ningún rol de API.
begin;

select plan(21);

insert into organizaciones (id, nombre) values
  ('11111111-1111-1111-1111-111111111111', 'Organización Uno'),
  ('22222222-2222-2222-2222-222222222222', 'Organización Dos');

insert into auth.users (id, email) values
  ('f1000000-0000-0000-0000-000000000001', 'mayorista@example.com'),
  ('f1000000-0000-0000-0000-000000000002', 'minorista@example.com'),
  ('f1000000-0000-0000-0000-000000000003', 'suspendida@example.com'),
  ('f1000000-0000-0000-0000-000000000004', 'nohabilitada@example.com'),
  ('f1000000-0000-0000-0000-000000000005', 'archivado@example.com'),
  ('f1000000-0000-0000-0000-000000000006', 'consumidor@example.com'),
  ('f1000000-0000-0000-0000-000000000007', 'panel-uno@example.com'),
  ('f1000000-0000-0000-0000-000000000008', 'panel-dos@example.com'),
  ('f1000000-0000-0000-0000-000000000009', 'cliente-dos@example.com');
insert into usuarios_organizacion (user_id, organizacion_id, rol_id, estado) values
  ('f1000000-0000-0000-0000-000000000007', '11111111-1111-1111-1111-111111111111', 'administrador', 'activo'),
  ('f1000000-0000-0000-0000-000000000008', '22222222-2222-2222-2222-222222222222', 'administrador', 'activo');

insert into dominio.empresas (id, organizacion_id, nombre, activa) values
  ('e1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'Tienda A', true),
  ('e1000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'Tienda B', true),
  ('e2000000-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', 'Tienda X', true);
insert into dominio.tiendas (organizacion_id, empresa_id, dominio) values
  ('11111111-1111-1111-1111-111111111111', 'e1000000-0000-0000-0000-000000000001', 'cdt-a.ejemplo.com'),
  ('11111111-1111-1111-1111-111111111111', 'e1000000-0000-0000-0000-000000000002', 'cdt-b.ejemplo.com'),
  ('22222222-2222-2222-2222-222222222222', 'e2000000-0000-0000-0000-000000000001', 'cdt-x.ejemplo.com');

insert into clientes (id, organizacion_id, numero, nombre, correo, tipo) values
  ('c1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 901, 'Mayorista', 'my@example.com', 'mayorista'),
  ('c1000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 902, 'Minorista', 'mn@example.com', 'minorista'),
  ('c1000000-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111', 903, 'Suspendida', 'su@example.com', 'mayorista'),
  ('c1000000-0000-0000-0000-000000000004', '11111111-1111-1111-1111-111111111111', 904, 'No habilitada', 'nh@example.com', 'mayorista'),
  ('c1000000-0000-0000-0000-000000000005', '11111111-1111-1111-1111-111111111111', 905, 'Archivado', 'ar@example.com', 'minorista'),
  ('c2000000-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', 901, 'Cliente Dos', 'c2@example.com', 'minorista');
-- El consumidor final de la organización Uno (la base puede traerlo sembrado: se reutiliza o se crea).
insert into clientes (id, organizacion_id, numero, nombre, tipo, es_consumidor_final)
select 'c1000000-0000-0000-0000-000000000006', '11111111-1111-1111-1111-111111111111', 906, 'Consumidor final propio', 'minorista', true
 where not exists (select 1 from clientes where organizacion_id = '11111111-1111-1111-1111-111111111111' and es_consumidor_final);

insert into clientes_empresas (cliente_id, empresa_id, organizacion_id) values
  ('c1000000-0000-0000-0000-000000000001', 'e1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111'),
  ('c1000000-0000-0000-0000-000000000001', 'e1000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111'),
  ('c1000000-0000-0000-0000-000000000002', 'e1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111'),
  ('c1000000-0000-0000-0000-000000000003', 'e1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111'),
  ('c1000000-0000-0000-0000-000000000004', 'e1000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111'),
  ('c1000000-0000-0000-0000-000000000005', 'e1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111'),
  ('c2000000-0000-0000-0000-000000000001', 'e2000000-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222');
insert into clientes_empresas (cliente_id, empresa_id, organizacion_id)
select c.id, 'e1000000-0000-0000-0000-000000000001', c.organizacion_id
  from clientes c
 where c.organizacion_id = '11111111-1111-1111-1111-111111111111' and c.es_consumidor_final
on conflict do nothing;

insert into cuentas_cliente (id, organizacion_id, cliente_id, empresa_id, auth_user_id, estado) values
  ('ca000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'c1000000-0000-0000-0000-000000000001', 'e1000000-0000-0000-0000-000000000001', 'f1000000-0000-0000-0000-000000000001', 'activa'),
  ('ca000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'c1000000-0000-0000-0000-000000000001', 'e1000000-0000-0000-0000-000000000002', 'f1000000-0000-0000-0000-000000000001', 'activa'),
  ('ca000000-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111', 'c1000000-0000-0000-0000-000000000002', 'e1000000-0000-0000-0000-000000000001', 'f1000000-0000-0000-0000-000000000002', 'activa'),
  ('ca000000-0000-0000-0000-000000000004', '11111111-1111-1111-1111-111111111111', 'c1000000-0000-0000-0000-000000000003', 'e1000000-0000-0000-0000-000000000001', 'f1000000-0000-0000-0000-000000000003', 'suspendida'),
  ('ca000000-0000-0000-0000-000000000005', '11111111-1111-1111-1111-111111111111', 'c1000000-0000-0000-0000-000000000004', 'e1000000-0000-0000-0000-000000000001', 'f1000000-0000-0000-0000-000000000004', 'activa'),
  ('ca000000-0000-0000-0000-000000000006', '11111111-1111-1111-1111-111111111111', 'c1000000-0000-0000-0000-000000000005', 'e1000000-0000-0000-0000-000000000001', 'f1000000-0000-0000-0000-000000000005', 'activa'),
  ('ca000000-0000-0000-0000-000000000008', '22222222-2222-2222-2222-222222222222', 'c2000000-0000-0000-0000-000000000001', 'e2000000-0000-0000-0000-000000000001', 'f1000000-0000-0000-0000-000000000009', 'activa');
-- La cuenta del consumidor final (el cliente existe, pero nunca da acceso).
insert into cuentas_cliente (id, organizacion_id, cliente_id, empresa_id, auth_user_id, estado)
select 'ca000000-0000-0000-0000-000000000007', c.organizacion_id, c.id, 'e1000000-0000-0000-0000-000000000001', 'f1000000-0000-0000-0000-000000000006', 'activa'
  from clientes c
 where c.organizacion_id = '11111111-1111-1111-1111-111111111111' and c.es_consumidor_final;
-- Un cliente archivado con la sesión todavía viva.
update clientes set archivado_en = now() where id = 'c1000000-0000-0000-0000-000000000005';

-- Llama a la función como lo haría una RPC security definer: con la sesión (claims) de esa persona, o sin sesión (null).
create function pg_temp.cuenta(p_user uuid, p_host text) returns jsonb language plpgsql as $$
declare v jsonb;
begin
  perform set_config('request.jwt.claims', case when p_user is null then '{}' else json_build_object('sub', p_user, 'role', 'authenticated')::text end, true);
  select to_jsonb(c) into v from private.cuenta_de_tienda(p_host) c;
  return v;
end $$;

-- ============================================================================
-- La cuenta activa devuelve sus cinco campos
-- ============================================================================
select is(
  pg_temp.cuenta('f1000000-0000-0000-0000-000000000001', 'cdt-a.ejemplo.com'),
  jsonb_build_object(
    'cuenta_cliente_id', 'ca000000-0000-0000-0000-000000000001',
    'cliente_id', 'c1000000-0000-0000-0000-000000000001',
    'organizacion_id', '11111111-1111-1111-1111-111111111111',
    'empresa_id', 'e1000000-0000-0000-0000-000000000001',
    'tipo', 'mayorista'),
  'cuenta activa y habilitada: los cinco campos');
select is(
  pg_temp.cuenta('f1000000-0000-0000-0000-000000000001', 'CDT-A.ejemplo.com:443') ->> 'empresa_id',
  'e1000000-0000-0000-0000-000000000001', 'el host se normaliza igual que en el resto de la tienda');
select is(
  pg_temp.cuenta('f1000000-0000-0000-0000-000000000001', 'cdt-b.ejemplo.com') ->> 'cuenta_cliente_id',
  'ca000000-0000-0000-0000-000000000002', 'la misma persona tiene otra cuenta en la otra tienda de la organización');
select is(
  pg_temp.cuenta('f1000000-0000-0000-0000-000000000002', 'cdt-a.ejemplo.com') ->> 'tipo',
  'minorista', 'el tipo sale de la ficha del cliente');

-- ============================================================================
-- Todo lo demás: vacío
-- ============================================================================
select is(pg_temp.cuenta('f1000000-0000-0000-0000-000000000003', 'cdt-a.ejemplo.com'), null, 'cuenta suspendida: vacío');
select is(pg_temp.cuenta('f1000000-0000-0000-0000-000000000004', 'cdt-a.ejemplo.com'), null, 'cliente no habilitado en la tienda: vacío');
select is(pg_temp.cuenta('f1000000-0000-0000-0000-000000000002', 'cdt-b.ejemplo.com'), null, 'cuenta de otra tienda de la misma organización: vacío');
select is(pg_temp.cuenta('f1000000-0000-0000-0000-000000000007', 'cdt-a.ejemplo.com'), null, 'usuario de panel de la organización, sin cuenta web: vacío');
select is(pg_temp.cuenta('f1000000-0000-0000-0000-000000000008', 'cdt-a.ejemplo.com'), null, 'usuario de panel de otra organización: vacío');
select is(pg_temp.cuenta(null, 'cdt-a.ejemplo.com'), null, 'anónimo (sin sesión): vacío');
select is(pg_temp.cuenta('f1000000-0000-0000-0000-000000000005', 'cdt-a.ejemplo.com'), null, 'cliente archivado con la sesión viva: vacío');
select is(pg_temp.cuenta('f1000000-0000-0000-0000-000000000006', 'cdt-a.ejemplo.com'), null, 'cliente consumidor final: vacío');
select is(pg_temp.cuenta('f1000000-0000-0000-0000-000000000001', 'desconocido.ejemplo.com'), null, 'host desconocido: vacío');
select is(pg_temp.cuenta('f1000000-0000-0000-0000-000000000001', null), null, 'host nulo: vacío');
select is(pg_temp.cuenta('f1000000-0000-0000-0000-000000000001', 'cdt-x.ejemplo.com'), null, 'tienda de otra organización con la cuenta de esta: vacío');
select is(pg_temp.cuenta('f1000000-0000-0000-0000-000000000009', 'cdt-a.ejemplo.com'), null, 'cuenta de otra organización en una tienda de esta: vacío');
select is(pg_temp.cuenta('f1000000-0000-0000-0000-000000000009', 'cdt-x.ejemplo.com') ->> 'organizacion_id',
  '22222222-2222-2222-2222-222222222222', 'la cuenta de la otra organización sí funciona en su propia tienda');

-- ============================================================================
-- Rige en la próxima llamada: suspensión, baja de «Habilitado en» y empresa desactivada
-- ============================================================================
update cuentas_cliente set estado = 'suspendida' where id = 'ca000000-0000-0000-0000-000000000001';
select is(pg_temp.cuenta('f1000000-0000-0000-0000-000000000001', 'cdt-a.ejemplo.com'), null, 'al suspender la cuenta, la siguiente llamada ya no devuelve nada');
update cuentas_cliente set estado = 'activa' where id = 'ca000000-0000-0000-0000-000000000001';
delete from clientes_empresas where cliente_id = 'c1000000-0000-0000-0000-000000000001' and empresa_id = 'e1000000-0000-0000-0000-000000000001';
select is(pg_temp.cuenta('f1000000-0000-0000-0000-000000000001', 'cdt-a.ejemplo.com'), null, 'al dar de baja «Habilitado en», la siguiente llamada ya no devuelve nada');
update dominio.empresas set activa = false where id = 'e1000000-0000-0000-0000-000000000002';
select is(pg_temp.cuenta('f1000000-0000-0000-0000-000000000001', 'cdt-b.ejemplo.com'), null, 'empresa desactivada (tienda pausada): vacío');

-- ============================================================================
-- Sin execute para ningún rol de API
-- ============================================================================
select ok(
  not has_function_privilege('anon', 'private.cuenta_de_tienda(text)', 'execute')
  and not has_function_privilege('authenticated', 'private.cuenta_de_tienda(text)', 'execute'),
  'ni anon ni authenticated ejecutan private.cuenta_de_tienda');

select * from finish();
rollback;
