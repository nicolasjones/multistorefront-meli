-- F-CLI-13 (MSF-376, épica MSF-155, spec 20261028-100000-correo-masivo-a-clientes): historial de campañas.
-- FR-032 (estado derivado), FR-033 (baja atribuida a la campaña del enlace), FR-034 (solo lectura), SC-005
-- (enviados+fallidos+omitidos+pendientes = destinatarios; aislamiento entre organizaciones y empresas; `anon` sin ejecución).
-- El fixture corre como postgres (RLS no aplica) y las verificaciones como «authenticated» vía request.jwt.claims.
begin;

select plan(23);

insert into organizaciones (id, nombre) values
  ('11111111-1111-1111-1111-111111111111', 'Organización Uno'),
  ('22222222-2222-2222-2222-222222222222', 'Organización Dos');

insert into auth.users (id, email) values
  ('d1000000-0000-0000-0000-000000000001', 'admin-uno@example.com'),
  ('d1000000-0000-0000-0000-000000000002', 'consulta-uno@example.com'),
  ('d1000000-0000-0000-0000-000000000003', 'deposito-uno@example.com'),
  ('d2000000-0000-0000-0000-000000000001', 'admin-dos@example.com');

insert into usuarios_organizacion (user_id, organizacion_id, rol_id) values
  ('d1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'administrador'),
  ('d1000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'consulta'),
  ('d1000000-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111', 'deposito'),
  ('d2000000-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', 'administrador');

insert into public.perfiles_usuario (user_id, nombre, apellido) values
  ('d1000000-0000-0000-0000-000000000001', 'Ana', 'Admin');

insert into dominio.empresas (id, organizacion_id, nombre) values
  ('e1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'Tienda A'),
  ('e1000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'Tienda B');

insert into clientes (id, organizacion_id, numero, nombre, tipo, correo, acepta_correo_masivo) values
  ('c1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 101, 'Alfa', 'minorista', 'alfa@example.com', true),
  ('c1000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 102, 'Beta', 'minorista', 'beta@example.com', true),
  ('c1000000-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111', 103, 'Gama', 'minorista', 'gama@example.com', true),
  ('c1000000-0000-0000-0000-000000000004', '11111111-1111-1111-1111-111111111111', 104, 'Delta', 'minorista', 'delta@example.com', true),
  ('c2000000-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', 201, 'Ajeno', 'minorista', 'ajeno@example.com', true);

-- Fechas relativas al reloj de la base (sin depender de la fecha real).
-- C1 (la más vieja, tienda A): 4 destinatarios, todos resueltos → completada.
-- C2 (la más nueva, sin tienda): 2 destinatarios, uno pendiente → en curso.
insert into dominio.campanas_correo (id, organizacion_id, empresa_id, clave, asunto, mensaje, creada_por, creada_en) values
  ('ca000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'e1000000-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000001', 'Ofertas', 'Mensaje uno', 'd1000000-0000-0000-0000-000000000001', now() - interval '2 days'),
  ('ca000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', null, 'aaaaaaaa-0000-0000-0000-000000000002', 'Novedades', 'Mensaje dos', null, now() - interval '1 day'),
  ('ca000000-0000-0000-0000-000000000003', '22222222-2222-2222-2222-222222222222', null, 'aaaaaaaa-0000-0000-0000-000000000003', 'Ajena', 'Mensaje ajeno', null, now());

insert into dominio.campana_correo_destinatarios (organizacion_id, campana_id, cliente_id, correo, estado, error, token_hashes) values
  ('11111111-1111-1111-1111-111111111111', 'ca000000-0000-0000-0000-000000000001', 'c1000000-0000-0000-0000-000000000001', 'alfa@example.com', 'enviado', null, array[encode(sha256(convert_to('token-alfa', 'utf8')), 'hex')]),
  ('11111111-1111-1111-1111-111111111111', 'ca000000-0000-0000-0000-000000000001', 'c1000000-0000-0000-0000-000000000002', 'beta@example.com', 'enviado', null, '{}'),
  ('11111111-1111-1111-1111-111111111111', 'ca000000-0000-0000-0000-000000000001', 'c1000000-0000-0000-0000-000000000003', 'gama@example.com', 'fallido', 'No se pudo entregar', '{}'),
  ('11111111-1111-1111-1111-111111111111', 'ca000000-0000-0000-0000-000000000001', 'c1000000-0000-0000-0000-000000000004', 'delta@example.com', 'omitido', null, '{}'),
  ('11111111-1111-1111-1111-111111111111', 'ca000000-0000-0000-0000-000000000002', 'c1000000-0000-0000-0000-000000000001', 'alfa@example.com', 'enviado', null, array[encode(sha256(convert_to('token-alfa-2', 'utf8')), 'hex')]),
  ('11111111-1111-1111-1111-111111111111', 'ca000000-0000-0000-0000-000000000002', 'c1000000-0000-0000-0000-000000000002', 'beta@example.com', 'pendiente', null, '{}'),
  ('22222222-2222-2222-2222-222222222222', 'ca000000-0000-0000-0000-000000000003', 'c2000000-0000-0000-0000-000000000001', 'ajeno@example.com', 'enviado', null, '{}');

create function pg_temp.como(p_user uuid) returns void language plpgsql as $$
begin
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
  set local role authenticated;
end $$;

-- ============================================================================
-- FR-030 / FR-032 / SC-005: lista, orden, estado derivado y totales
-- ============================================================================

select pg_temp.como('d1000000-0000-0000-0000-000000000001');

select is((public.listar_campanas_correo(null, 1, 25) ->> 'total')::int, 2, 'el historial cuenta solo las campañas de la organización');

select is(
  (select array_agg(f ->> 'asunto' order by ord) from jsonb_array_elements(public.listar_campanas_correo(null, 1, 25) -> 'filas') with ordinality as t(f, ord)),
  array['Novedades', 'Ofertas'],
  'la más reciente primero'
);

select is(
  (select f ->> 'estado' from jsonb_array_elements(public.listar_campanas_correo(null, 1, 25) -> 'filas') f where f ->> 'asunto' = 'Novedades'),
  'en_curso',
  'FR-032: con un destinatario pendiente la campaña está en curso'
);

select is(
  (select f ->> 'estado' from jsonb_array_elements(public.listar_campanas_correo(null, 1, 25) -> 'filas') f where f ->> 'asunto' = 'Ofertas'),
  'completada',
  'FR-032: sin pendientes la campaña está completada'
);

select is(
  (select f ->> 'autor' from jsonb_array_elements(public.listar_campanas_correo(null, 1, 25) -> 'filas') f where f ->> 'asunto' = 'Ofertas'),
  'Ana Admin',
  'el autor se muestra con su nombre'
);

select is(
  (select f ->> 'autor' from jsonb_array_elements(public.listar_campanas_correo(null, 1, 25) -> 'filas') f where f ->> 'asunto' = 'Novedades'),
  'Usuario sin nombre',
  'un autor sin perfil no muestra su identificador'
);

select ok(
  (select bool_and(
            (f ->> 'enviados')::int + (f ->> 'fallidos')::int + (f ->> 'omitidos')::int + (f ->> 'pendientes')::int = (f ->> 'destinatarios')::int)
     from jsonb_array_elements(public.listar_campanas_correo(null, 1, 25) -> 'filas') f),
  'SC-005: enviados+fallidos+omitidos+pendientes = destinatarios en cada campaña'
);

select is(
  (select (f ->> 'destinatarios')::int || '/' || (f ->> 'enviados')::int || '/' || (f ->> 'fallidos')::int || '/' || (f ->> 'omitidos')::int
     from jsonb_array_elements(public.listar_campanas_correo(null, 1, 25) -> 'filas') f where f ->> 'asunto' = 'Ofertas'),
  '4/2/1/1',
  'SC-005: los totales de «Ofertas» son los de sus destinatarios'
);

select is(
  (public.listar_campanas_correo(null, 2, 1) -> 'filas' -> 0 ->> 'asunto'),
  'Ofertas',
  'la paginación pasa a la campaña siguiente'
);

-- ============================================================================
-- FR-033: la baja se atribuye a la campaña cuyo enlace se usó
-- ============================================================================

reset role;
select is(public.dar_de_baja_correo_masivo(encode(sha256(convert_to('token-alfa', 'utf8')), 'hex')), true, 'la baja con el enlace de la primera campaña funciona');
select is(public.dar_de_baja_correo_masivo(encode(sha256(convert_to('token-alfa', 'utf8')), 'hex')), true, 'repetirla es idempotente');

select pg_temp.como('d1000000-0000-0000-0000-000000000001');

select is(
  (select f ->> 'bajas' from jsonb_array_elements(public.listar_campanas_correo(null, 1, 25) -> 'filas') f where f ->> 'asunto' = 'Ofertas'),
  '1',
  'FR-033: la baja cuenta en la campaña del enlace (una sola vez)'
);
select is(
  (select f ->> 'bajas' from jsonb_array_elements(public.listar_campanas_correo(null, 1, 25) -> 'filas') f where f ->> 'asunto' = 'Novedades'),
  '0',
  'FR-033: no cuenta en la otra campaña del mismo cliente'
);

-- ============================================================================
-- FR-031: detalle
-- ============================================================================

select is(
  (public.detalle_campana_correo('ca000000-0000-0000-0000-000000000001', 1, 50) -> 'campana' ->> 'mensaje'),
  'Mensaje uno',
  'FR-031: el detalle trae el mensaje enviado'
);
select is(
  (select d ->> 'error' from jsonb_array_elements(public.detalle_campana_correo('ca000000-0000-0000-0000-000000000001', 1, 50) -> 'destinatarios') d where d ->> 'nombre' = 'Gama'),
  'No se pudo entregar',
  'FR-031: cada destinatario trae su estado y error corto'
);
select is(
  (select (d ->> 'baja')::boolean from jsonb_array_elements(public.detalle_campana_correo('ca000000-0000-0000-0000-000000000001', 1, 50) -> 'destinatarios') d where d ->> 'nombre' = 'Alfa'),
  true,
  'FR-033: el detalle marca quién se dio de baja'
);

-- ============================================================================
-- Aislamiento entre organizaciones y empresas (SC-005)
-- ============================================================================

select is(
  (select count(*)::int from jsonb_array_elements(public.listar_campanas_correo('e1000000-0000-0000-0000-000000000001', 1, 25) -> 'filas')),
  1,
  'con una tienda activa solo se ven las campañas armadas con esa tienda'
);
select is(
  (public.listar_campanas_correo('e1000000-0000-0000-0000-000000000002', 1, 25) ->> 'total')::int,
  0,
  'otra tienda sin campañas: sin filas ni total'
);
select throws_ok(
  $$select public.detalle_campana_correo('ca000000-0000-0000-0000-000000000003', 1, 50)$$,
  'P0002', null,
  'el detalle de una campaña de otra organización no existe'
);

select pg_temp.como('d2000000-0000-0000-0000-000000000001');
select is((public.listar_campanas_correo(null, 1, 25) ->> 'total')::int, 1, 'otra organización ve solo la suya');

-- ============================================================================
-- FR-034: solo lectura y permisos
-- ============================================================================

select pg_temp.como('d1000000-0000-0000-0000-000000000002');
select is((public.listar_campanas_correo(null, 1, 25) ->> 'total')::int, 2, 'FR-034: acceso de lectura a clientes alcanza para ver el historial');

select pg_temp.como('d1000000-0000-0000-0000-000000000003');
select throws_ok($$select public.listar_campanas_correo(null, 1, 25)$$, '42501', null, 'sin acceso a clientes el historial se rechaza');

reset role;
select ok(
  not has_function_privilege('anon', 'public.listar_campanas_correo(uuid, integer, integer)', 'execute')
  and not has_function_privilege('anon', 'public.detalle_campana_correo(uuid, integer, integer)', 'execute')
  and has_function_privilege('authenticated', 'public.listar_campanas_correo(uuid, integer, integer)', 'execute')
  and not has_table_privilege('authenticated', 'dominio.campanas_correo', 'insert')
  and not has_table_privilege('authenticated', 'dominio.campanas_correo', 'update')
  and not has_table_privilege('authenticated', 'dominio.campanas_correo', 'delete')
  and not has_table_privilege('authenticated', 'dominio.campana_correo_destinatarios', 'update')
  and not has_column_privilege('authenticated', 'dominio.campana_correo_destinatarios', 'baja_en', 'update'),
  'FR-034: anon no ejecuta; authenticated lee pero no escribe (ni editar, ni borrar, ni reenviar)'
);

select * from finish();
rollback;
