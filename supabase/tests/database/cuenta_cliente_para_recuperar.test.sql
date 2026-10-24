-- F-CLI-06 (MSF-428, épica MSF-237): public.cuenta_cliente_para_recuperar. Cubre FR-023: solo una cuenta ACTIVA y
-- habilitada en la tienda del host devuelve fila; suspendida, sin cuenta en esa tienda, no habilitada, cliente
-- archivado, host desconocido y empresa desactivada devuelven cero filas; y solo `service_role` puede ejecutarla.
begin;

select plan(10);

insert into organizaciones (id, nombre) values ('11111111-1111-1111-1111-111111111111', 'Organización Uno');

insert into auth.users (id, email) values
  ('f3000000-0000-0000-0000-000000000001', 'activa@example.com'),
  ('f3000000-0000-0000-0000-000000000002', 'suspendida@example.com'),
  ('f3000000-0000-0000-0000-000000000003', 'archivado@example.com'),
  ('f3000000-0000-0000-0000-000000000004', 'apagada@example.com');

insert into dominio.empresas (id, organizacion_id, nombre, activa) values
  ('a3000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'San Javucho', true),
  ('a3000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'Mundo JC', true),
  ('a3000000-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111', 'Apagada', false);

insert into dominio.tiendas (organizacion_id, empresa_id, dominio) values
  ('11111111-1111-1111-1111-111111111111', 'a3000000-0000-0000-0000-000000000001', 'sanjavucho.ejemplo.com'),
  ('11111111-1111-1111-1111-111111111111', 'a3000000-0000-0000-0000-000000000002', 'mundojc.ejemplo.com'),
  ('11111111-1111-1111-1111-111111111111', 'a3000000-0000-0000-0000-000000000003', 'apagada.ejemplo.com');

insert into clientes (id, organizacion_id, numero, nombre, correo, tipo, archivado_en) values
  ('c6000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 20, 'Activo', 'a@example.com', 'minorista', null),
  ('c6000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 21, 'Suspendido', 's@example.com', 'minorista', null),
  ('c6000000-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111', 22, 'Archivado', 'ar@example.com', 'minorista', now()),
  ('c6000000-0000-0000-0000-000000000004', '11111111-1111-1111-1111-111111111111', 23, 'En tienda apagada', 'ap@example.com', 'minorista', null);

-- El cliente 1 está habilitado en las dos tiendas pero solo tiene cuenta en San Javucho.
insert into clientes_empresas (cliente_id, empresa_id, organizacion_id) values
  ('c6000000-0000-0000-0000-000000000001', 'a3000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111'),
  ('c6000000-0000-0000-0000-000000000001', 'a3000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111'),
  ('c6000000-0000-0000-0000-000000000002', 'a3000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111'),
  ('c6000000-0000-0000-0000-000000000003', 'a3000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111'),
  ('c6000000-0000-0000-0000-000000000004', 'a3000000-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111');

insert into cuentas_cliente (organizacion_id, cliente_id, empresa_id, auth_user_id, estado) values
  ('11111111-1111-1111-1111-111111111111', 'c6000000-0000-0000-0000-000000000001', 'a3000000-0000-0000-0000-000000000001', 'f3000000-0000-0000-0000-000000000001', 'activa'),
  ('11111111-1111-1111-1111-111111111111', 'c6000000-0000-0000-0000-000000000002', 'a3000000-0000-0000-0000-000000000001', 'f3000000-0000-0000-0000-000000000002', 'suspendida'),
  ('11111111-1111-1111-1111-111111111111', 'c6000000-0000-0000-0000-000000000003', 'a3000000-0000-0000-0000-000000000001', 'f3000000-0000-0000-0000-000000000003', 'activa'),
  ('11111111-1111-1111-1111-111111111111', 'c6000000-0000-0000-0000-000000000004', 'a3000000-0000-0000-0000-000000000003', 'f3000000-0000-0000-0000-000000000004', 'activa');

set local role service_role;

select results_eq(
  $$ select correo, dominio from public.cuenta_cliente_para_recuperar('sanjavucho.ejemplo.com', 'activa@example.com') $$,
  $$ values ('activa@example.com'::text, 'sanjavucho.ejemplo.com'::text) $$,
  'cuenta activa y habilitada: devuelve el correo de Auth y el dominio de la tienda'
);

select is(
  (select count(*)::int from public.cuenta_cliente_para_recuperar(' SanJavucho.Ejemplo.com. ', '  ACTIVA@Example.com ')),
  1,
  'host y correo se normalizan (mayúsculas, espacios y punto final)'
);

select is_empty(
  $$ select 1 from public.cuenta_cliente_para_recuperar('mundojc.ejemplo.com', 'activa@example.com') $$,
  'habilitado pero sin cuenta en esa tienda: cero filas'
);

select is_empty(
  $$ select 1 from public.cuenta_cliente_para_recuperar('sanjavucho.ejemplo.com', 'suspendida@example.com') $$,
  'cuenta suspendida: cero filas'
);

select is_empty(
  $$ select 1 from public.cuenta_cliente_para_recuperar('sanjavucho.ejemplo.com', 'archivado@example.com') $$,
  'cliente archivado: cero filas'
);

select is_empty(
  $$ select 1 from public.cuenta_cliente_para_recuperar('apagada.ejemplo.com', 'apagada@example.com') $$,
  'empresa desactivada: cero filas'
);

select is_empty(
  $$ select 1 from public.cuenta_cliente_para_recuperar('desconocida.ejemplo.com', 'activa@example.com') $$,
  'host desconocido: cero filas'
);

select is_empty(
  $$ select 1 from public.cuenta_cliente_para_recuperar('sanjavucho.ejemplo.com', 'nadie@example.com') $$,
  'correo sin cuenta: cero filas'
);

reset role;
select is(
  (select bool_or(has_function_privilege(r, 'public.cuenta_cliente_para_recuperar(text, text)', 'execute'))
     from unnest(array['anon', 'authenticated']) r),
  false,
  'anon y authenticated no pueden ejecutarla'
);

select is(
  has_function_privilege('service_role', 'public.cuenta_cliente_para_recuperar(text, text)', 'execute'),
  true,
  'service_role sí puede ejecutarla'
);

select * from finish();
rollback;
