-- F-PRV-08 (MSF-449, épica MSF-445): varios contactos por proveedor.
-- Cubre CA-PRV-08-1 (marcar otro principal desmarca al anterior y copia a la ficha), un solo
-- principal garantizado por el índice único parcial, la serialización de dos altas principales,
-- RLS por organización y nivel, sin DELETE directo, `anon` sin acceso y eventos de Actividad
-- sin correo ni teléfono.
begin;

select plan(26);

insert into organizaciones (id, nombre) values
  ('11111111-1111-1111-1111-111111111111', 'Organización Uno'),
  ('22222222-2222-2222-2222-222222222222', 'Organización Dos');

insert into auth.users (id, email) values
  ('d1000000-0000-0000-0000-000000000001', 'administrador@example.com'),
  ('d1000000-0000-0000-0000-000000000002', 'operador@example.com'),
  ('d1000000-0000-0000-0000-000000000003', 'administracion@example.com'),
  ('d2000000-0000-0000-0000-000000000001', 'admin-dos@example.com');

insert into usuarios_organizacion (user_id, organizacion_id, rol_id) values
  ('d1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'administrador'),
  ('d1000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'operador'),
  ('d1000000-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111', 'administracion'),
  ('d2000000-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', 'administrador');

insert into dominio.proveedores (id, organizacion_id, razon_social, cuit, persona_contacto, correo, telefono) values
  ('f1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'Proveedor Uno', '20123456786', 'Vieja Persona', 'viejo@example.com', '111'),
  ('f1000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'Proveedor Dos', '30701234568', null, null, null),
  ('f2000000-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', 'Proveedor Otra Org', '20123456786', null, null, null);

create function pg_temp.como(p_user uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
  set local role authenticated;
end $$;

create function pg_temp.como_anon() returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);
  set local role anon;
end $$;

create function pg_temp.volver() returns void language plpgsql as $$
begin
  reset role;
end $$;

-- ============================================================================
-- Administrador: alta, lista y principal (CA-PRV-08-1)
-- ============================================================================

select pg_temp.como('d1000000-0000-0000-0000-000000000001');

create temp table ids (clave text primary key, id uuid);
grant all on ids to authenticated;

insert into ids values ('ana', public.agregar_contacto_proveedor(
  'f1000000-0000-0000-0000-000000000001', '  Ana Pérez ', 'Ventas', 'ana@example.com', '1155550001', false));
insert into ids values ('beto', public.agregar_contacto_proveedor(
  'f1000000-0000-0000-0000-000000000001', 'Beto Gómez', 'Cobranzas', 'beto@example.com', '1155550002', false));

select is(
  (select count(*)::int from public.listar_contactos_proveedor('f1000000-0000-0000-0000-000000000001')),
  2, 'lista los dos contactos agregados'
);
select is(
  (select nombre from public.listar_contactos_proveedor('f1000000-0000-0000-0000-000000000001') where rol = 'Ventas'),
  'Ana Pérez', 'el nombre se guarda recortado'
);
select is(
  (select count(*)::int from public.listar_contactos_proveedor('f1000000-0000-0000-0000-000000000001') where principal),
  0, 'sin pedirlo, ninguno es principal'
);

select lives_ok(
  format('select public.marcar_contacto_principal(%L)', (select id from ids where clave = 'ana')),
  'marca a Ana como principal'
);
select is(
  (select persona_contacto || '|' || correo || '|' || telefono from dominio.proveedores where id = 'f1000000-0000-0000-0000-000000000001'),
  'Ana Pérez|ana@example.com|1155550001', 'la ficha toma nombre, correo y teléfono del principal'
);

-- CA-PRV-08-1: marcar otro principal deja al anterior sin marca.
select lives_ok(
  format('select public.marcar_contacto_principal(%L)', (select id from ids where clave = 'beto')),
  'marca a Beto como principal'
);
select is(
  (select array_agg(nombre order by nombre) from public.listar_contactos_proveedor('f1000000-0000-0000-0000-000000000001') where principal),
  array['Beto Gómez'], 'CA-PRV-08-1: solo Beto es principal; Ana dejó de serlo'
);
select is(
  (select persona_contacto || '|' || correo from dominio.proveedores where id = 'f1000000-0000-0000-0000-000000000001'),
  'Beto Gómez|beto@example.com', 'CA-PRV-08-1: la ficha pasa a los datos de Beto'
);

-- Dos altas "simultáneas" como principal (se serializan por el bloqueo del proveedor): gana la última.
select public.agregar_contacto_proveedor('f1000000-0000-0000-0000-000000000002', 'Carla', null, 'carla@example.com', null, true);
select public.agregar_contacto_proveedor('f1000000-0000-0000-0000-000000000002', 'Dani', null, 'dani@example.com', null, true);
select is(
  (select array_agg(nombre) from public.listar_contactos_proveedor('f1000000-0000-0000-0000-000000000002') where principal),
  array['Dani'], 'dos altas principales: queda una sola, la última'
);

-- Validaciones
select throws_ok(
  $$select public.agregar_contacto_proveedor('f1000000-0000-0000-0000-000000000001', '   ')$$,
  '22023', 'El nombre del contacto es obligatorio', 'el nombre es obligatorio'
);
select throws_ok(
  $$select public.agregar_contacto_proveedor('f1000000-0000-0000-0000-000000000001', 'X', null, 'a@b.com c@d.com')$$,
  '22023', 'El correo no tiene un formato válido', 'rechaza un correo con formato inválido'
);
select throws_ok(
  $$select public.agregar_contacto_proveedor('f2000000-0000-0000-0000-000000000001', 'Intruso')$$,
  'P0002', 'El proveedor no existe', 'no agrega contactos a un proveedor de otra organización'
);

-- Sin DELETE ni escritura directa
select throws_ok(
  $$delete from dominio.proveedores_contactos$$,
  '42501', null, 'sin DELETE directo'
);
select throws_ok(
  $$insert into dominio.proveedores_contactos (proveedor_id, nombre) values ('f1000000-0000-0000-0000-000000000001', 'Directo')$$,
  '42501', null, 'sin INSERT directo (solo por RPC)'
);
select throws_ok(
  $$update dominio.proveedores_contactos set principal = true$$,
  '42501', null, 'sin UPDATE directo (solo por RPC)'
);

-- Actividad (FR-024): razón social y nombre, sin correo ni teléfono.
select pg_temp.volver();
select is(
  (select count(*)::int from public.registro_actividad where tipo = 'proveedor.contacto_agregado'),
  4, 'registra un evento por contacto agregado'
);
select ok(
  exists (select 1 from public.registro_actividad
           where tipo = 'proveedor.contacto_principal_cambiado'
             and detalle like '%Beto Gómez%' and detalle like '%Proveedor Uno%'),
  'registra el cambio de principal con contacto y razón social'
);
select is(
  (select count(*)::int from public.registro_actividad
    where tipo like 'proveedor.contacto%' and (detalle ~* '@' or detalle ~ '1155550')),
  0, 'el detalle no lleva correo ni teléfono'
);

-- El índice único parcial es la red de seguridad (FR-021): un segundo principal directo falla.
select throws_ok(
  $$insert into dominio.proveedores_contactos (organizacion_id, proveedor_id, nombre, principal)
    values ('11111111-1111-1111-1111-111111111111', 'f1000000-0000-0000-0000-000000000001', 'Segundo', true)$$,
  '23505', null, 'FR-021: un segundo principal viola el índice único parcial'
);

-- ============================================================================
-- Niveles y organización
-- ============================================================================

-- Operador: sin acceso a la sección `proveedores`.
select pg_temp.como('d1000000-0000-0000-0000-000000000002');
select throws_ok(
  $$select * from public.listar_contactos_proveedor('f1000000-0000-0000-0000-000000000001')$$,
  '42501', null, 'Operador no lista contactos'
);
select throws_ok(
  $$select public.agregar_contacto_proveedor('f1000000-0000-0000-0000-000000000001', 'No')$$,
  '42501', null, 'Operador no agrega contactos'
);

-- Otra organización: no ve ni marca contactos ajenos.
select pg_temp.como('d2000000-0000-0000-0000-000000000001');
select is(
  (select count(*)::int from public.listar_contactos_proveedor('f1000000-0000-0000-0000-000000000001')),
  0, 'otra organización no ve los contactos'
);
select throws_ok(
  format('select public.marcar_contacto_principal(%L)', (select id from ids where clave = 'ana')),
  'P0002', 'El contacto no existe', 'otra organización no marca contactos ajenos'
);

-- anon: sin ejecución ni acceso
select pg_temp.volver();
select ok(
  not has_function_privilege('anon', 'public.listar_contactos_proveedor(uuid)', 'execute')
  and not has_function_privilege('anon', 'public.agregar_contacto_proveedor(uuid, text, text, text, text, boolean)', 'execute')
  and not has_function_privilege('anon', 'public.marcar_contacto_principal(uuid)', 'execute')
  and not has_table_privilege('anon', 'dominio.proveedores_contactos', 'select'),
  'anon no ejecuta las RPC ni lee la tabla'
);
select ok(
  (select relrowsecurity from pg_class where oid = 'dominio.proveedores_contactos'::regclass),
  'la tabla tiene RLS activada'
);

select * from finish();
rollback;
