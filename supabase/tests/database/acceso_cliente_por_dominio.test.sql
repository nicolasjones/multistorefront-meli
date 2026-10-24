-- F-CLI-05 (MSF-422, épica MSF-237): publico.acceso_cliente_por_dominio. Cubre FR-011: los cuatro estados
-- (activa, suspendida, sin_cuenta, no_habilitado), el tipo solo si está activa, «no habilitado» por encima del
-- estado guardado, y host desconocido / empresa desactivada => null (la misma respuesta).
begin;

select plan(11);

insert into organizaciones (id, nombre) values ('11111111-1111-1111-1111-111111111111', 'Organización Uno');

insert into auth.users (id, email) values
  ('f2000000-0000-0000-0000-000000000001', 'activa@example.com'),
  ('f2000000-0000-0000-0000-000000000002', 'suspendida@example.com'),
  ('f2000000-0000-0000-0000-000000000003', 'sinCuentaTienda@example.com'),
  ('f2000000-0000-0000-0000-000000000004', 'ajeno@example.com');

insert into dominio.empresas (id, organizacion_id, nombre, activa) values
  ('a1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'San Javucho', true),
  ('a1000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'Mundo JC', true),
  ('a1000000-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111', 'Apagada', false);

insert into dominio.tiendas (organizacion_id, empresa_id, dominio) values
  ('11111111-1111-1111-1111-111111111111', 'a1000000-0000-0000-0000-000000000001', 'sanjavucho.ejemplo.com'),
  ('11111111-1111-1111-1111-111111111111', 'a1000000-0000-0000-0000-000000000002', 'mundojc.ejemplo.com'),
  ('11111111-1111-1111-1111-111111111111', 'a1000000-0000-0000-0000-000000000003', 'apagada.ejemplo.com');

insert into clientes (id, organizacion_id, numero, nombre, correo, tipo) values
  ('c5000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 10, 'Mayorista activo', 'a@example.com', 'mayorista'),
  ('c5000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 11, 'Suspendido', 's@example.com', 'minorista'),
  ('c5000000-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111', 12, 'Solo habilitado', 'h@example.com', 'minorista');

-- Habilitados: C1 en San Javucho y Mundo JC; C2 en San Javucho; C3 en San Javucho (con cuenta solo allí) y Apagada.
insert into clientes_empresas (cliente_id, empresa_id, organizacion_id) values
  ('c5000000-0000-0000-0000-000000000001', 'a1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111'),
  ('c5000000-0000-0000-0000-000000000001', 'a1000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111'),
  ('c5000000-0000-0000-0000-000000000002', 'a1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111'),
  ('c5000000-0000-0000-0000-000000000003', 'a1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111'),
  ('c5000000-0000-0000-0000-000000000003', 'a1000000-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111');

insert into cuentas_cliente (organizacion_id, cliente_id, empresa_id, auth_user_id, estado) values
  ('11111111-1111-1111-1111-111111111111', 'c5000000-0000-0000-0000-000000000001', 'a1000000-0000-0000-0000-000000000001', 'f2000000-0000-0000-0000-000000000001', 'activa'),
  ('11111111-1111-1111-1111-111111111111', 'c5000000-0000-0000-0000-000000000002', 'a1000000-0000-0000-0000-000000000001', 'f2000000-0000-0000-0000-000000000002', 'suspendida'),
  ('11111111-1111-1111-1111-111111111111', 'c5000000-0000-0000-0000-000000000003', 'a1000000-0000-0000-0000-000000000001', 'f2000000-0000-0000-0000-000000000003', 'activa');

create function pg_temp.como(p_user uuid) returns void language plpgsql as $$
begin
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
  set local role authenticated;
end $$;

-- Activa: estado y tipo del cliente.
select pg_temp.como('f2000000-0000-0000-0000-000000000001');
select is(
  publico.acceso_cliente_por_dominio('sanjavucho.ejemplo.com'),
  '{"estado": "activa", "tipo": "mayorista"}'::jsonb,
  'cuenta activa y habilitada: estado activa y el tipo del cliente'
);

-- El host se normaliza (mayúsculas y punto final).
select is(
  publico.acceso_cliente_por_dominio('SanJavucho.Ejemplo.com.') ->> 'estado',
  'activa',
  'el host se normaliza igual que en el resto de la tienda'
);

-- Sin cuenta en la otra tienda donde está habilitado.
select is(
  publico.acceso_cliente_por_dominio('mundojc.ejemplo.com'),
  '{"estado": "sin_cuenta", "tipo": null}'::jsonb,
  'habilitado pero sin cuenta en esa tienda: sin_cuenta y sin tipo'
);

-- Suspendida: sin tipo.
select pg_temp.como('f2000000-0000-0000-0000-000000000002');
select is(
  publico.acceso_cliente_por_dominio('sanjavucho.ejemplo.com'),
  '{"estado": "suspendida", "tipo": null}'::jsonb,
  'cuenta suspendida: estado suspendida y el tipo no se revela'
);

-- No habilitado prevalece sobre la cuenta guardada.
reset role;
delete from clientes_empresas
 where cliente_id = 'c5000000-0000-0000-0000-000000000001' and empresa_id = 'a1000000-0000-0000-0000-000000000001';
select pg_temp.como('f2000000-0000-0000-0000-000000000001');
select is(
  publico.acceso_cliente_por_dominio('sanjavucho.ejemplo.com'),
  '{"estado": "no_habilitado", "tipo": null}'::jsonb,
  'cuenta activa pero cliente deshabilitado en la tienda: no_habilitado prevalece'
);

-- Al rehabilitar se conserva la cuenta.
reset role;
insert into clientes_empresas (cliente_id, empresa_id, organizacion_id) values
  ('c5000000-0000-0000-0000-000000000001', 'a1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111');
select pg_temp.como('f2000000-0000-0000-0000-000000000001');
select is(
  publico.acceso_cliente_por_dominio('sanjavucho.ejemplo.com') ->> 'estado',
  'activa',
  'al rehabilitar la tienda la cuenta vuelve a su estado guardado'
);

-- Un usuario sin ninguna cuenta de cliente.
select pg_temp.como('f2000000-0000-0000-0000-000000000004');
select is(
  publico.acceso_cliente_por_dominio('sanjavucho.ejemplo.com'),
  '{"estado": "sin_cuenta", "tipo": null}'::jsonb,
  'un usuario sin cuenta de cliente recibe sin_cuenta'
);

-- Empresa desactivada y host desconocido responden lo mismo: null.
select pg_temp.como('f2000000-0000-0000-0000-000000000003');
select is(
  publico.acceso_cliente_por_dominio('apagada.ejemplo.com'),
  null::jsonb,
  'empresa desactivada: null'
);
select is(
  publico.acceso_cliente_por_dominio('no-existe.ejemplo.com'),
  null::jsonb,
  'host desconocido: null (idéntico a la empresa desactivada)'
);

-- Cliente archivado: no da acceso.
reset role;
update clientes set archivado_en = now() where id = 'c5000000-0000-0000-0000-000000000003';
select pg_temp.como('f2000000-0000-0000-0000-000000000003');
select is(
  publico.acceso_cliente_por_dominio('sanjavucho.ejemplo.com') ->> 'estado',
  'sin_cuenta',
  'un cliente archivado deja de dar acceso'
);

-- anon no la ejecuta.
reset role;
select is(
  has_function_privilege('anon', 'publico.acceso_cliente_por_dominio(text)', 'execute'),
  false,
  'anon no ejecuta acceso_cliente_por_dominio'
);

select * from finish();

rollback;
