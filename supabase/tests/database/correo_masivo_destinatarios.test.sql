-- F-CLI-11 (MSF-357, épica MSF-155, spec 20261028-100000-correo-masivo-a-clientes): destinatarios del correo masivo.
-- Cubre FR-001 (columna y valor por defecto), FR-004 (elegibles y resumen de excluidos), FR-006 (edición exigida,
-- aislamiento por organización, `anon` sin ejecución) y SC-001 (el conteo del resumen coincide con la lista).
-- El fixture corre como postgres (RLS no aplica) y las verificaciones como «authenticated» vía request.jwt.claims.
begin;

select plan(21);

-- ============================================================================
-- FR-001: la columna
-- ============================================================================

select col_type_is('public', 'clientes', 'acepta_correo_masivo', 'boolean', 'acepta_correo_masivo es boolean');
select col_not_null('public', 'clientes', 'acepta_correo_masivo', 'acepta_correo_masivo es not null');
select col_default_is('public', 'clientes', 'acepta_correo_masivo', 'false', 'acepta_correo_masivo nace en false');

insert into organizaciones (id, nombre) values
  ('11111111-1111-1111-1111-111111111111', 'Organización Uno'),
  ('22222222-2222-2222-2222-222222222222', 'Organización Dos');

insert into auth.users (id, email) values
  ('d1000000-0000-0000-0000-000000000001', 'admin-uno@example.com'),
  ('d1000000-0000-0000-0000-000000000002', 'consulta-uno@example.com'),
  ('d2000000-0000-0000-0000-000000000001', 'admin-dos@example.com');

insert into usuarios_organizacion (user_id, organizacion_id, rol_id) values
  ('d1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'administrador'),
  ('d1000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'consulta'),
  ('d2000000-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', 'administrador');

insert into dominio.empresas (id, organizacion_id, nombre) values
  ('b1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'San Javucho'),
  ('b1000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'Mundo JC');

-- Sin indicar la columna: el cliente existente nace sin aceptación (FR-001).
insert into clientes (organizacion_id, numero, nombre, tipo, correo) values
  ('11111111-1111-1111-1111-111111111111', 101, 'Sin marcar', 'minorista', 'sin-marcar@example.com');

select is(
  (select acepta_correo_masivo from clientes where nombre = 'Sin marcar'),
  false,
  'un cliente cargado sin indicar la aceptación queda en false'
);

insert into clientes (organizacion_id, numero, nombre, tipo, correo, acepta_correo_masivo, archivado_en) values
  ('11111111-1111-1111-1111-111111111111', 102, 'Alfa', 'mayorista', 'alfa@example.com', true, null),
  ('11111111-1111-1111-1111-111111111111', 103, 'Beta', 'minorista', 'beta@example.com', true, null),
  ('11111111-1111-1111-1111-111111111111', 104, 'Gamma', 'mayorista', 'gamma@example.com', true, null),
  ('11111111-1111-1111-1111-111111111111', 105, 'Archivado', 'minorista', 'archivado@example.com', true, now()),
  ('11111111-1111-1111-1111-111111111111', 106, 'Sin correo', 'minorista', null, true, null),
  ('11111111-1111-1111-1111-111111111111', 107, 'No acepta', 'minorista', 'noacepta@example.com', false, null),
  ('11111111-1111-1111-1111-111111111111', 108, 'Varios correos', 'minorista', 'a@x.com,b@x.com', true, null),
  ('22222222-2222-2222-2222-222222222222', 201, 'Ajeno', 'minorista', 'ajeno@example.com', true, null);

insert into public.clientes_empresas (cliente_id, empresa_id, organizacion_id)
select c.id, e.id, c.organizacion_id
  from (values ('Alfa', 'San Javucho'), ('Beta', 'Mundo JC'), ('Gamma', 'San Javucho'), ('Gamma', 'Mundo JC')) as v(cliente, empresa)
  join clientes c on c.organizacion_id = '11111111-1111-1111-1111-111111111111' and c.nombre = v.cliente
  join dominio.empresas e on e.organizacion_id = c.organizacion_id and e.nombre = v.empresa;

-- Alfa tiene cuenta web activa en San Javucho.
insert into public.cuentas_cliente (organizacion_id, cliente_id, empresa_id, auth_user_id, estado)
select c.organizacion_id, c.id, e.id, 'd1000000-0000-0000-0000-000000000001', 'activa'
  from clientes c
  join dominio.empresas e on e.organizacion_id = c.organizacion_id and e.nombre = 'San Javucho'
 where c.nombre = 'Alfa';

create function pg_temp.como(p_user uuid) returns void language plpgsql as $$
begin
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
  set local role authenticated;
end $$;

select pg_temp.como('d1000000-0000-0000-0000-000000000001');

-- ============================================================================
-- FR-004: elegibles
-- ============================================================================

select results_eq(
  $$select f->>'nombre' from jsonb_array_elements(public.listar_destinatarios_correo_masivo()->'filas') f order by 1$$,
  $$values ('Alfa'::text), ('Beta'::text), ('Gamma'::text)$$,
  'solo son elegibles los activos, con aceptación y con un correo válido'
);

select is(
  (select count(*)::int from jsonb_array_elements(public.listar_destinatarios_correo_masivo()->'filas') f
    where f->>'nombre' in ('Archivado', 'Sin correo', 'No acepta', 'Sin marcar', 'Varios correos', 'Ajeno')),
  0,
  'archivados, sin correo, sin aceptación, con varios correos en un campo y de otra organización quedan afuera'
);

select is(
  public.resumen_destinatarios_correo_masivo(),
  '{"elegibles": 3, "sin_correo": 2, "no_aceptan": 2}'::jsonb,
  'el resumen informa elegibles y cuántos quedan afuera por «sin correo» (incluye el correo inválido) y por «no aceptan»; el archivado y el Consumidor final no cuentan'
);

-- ============================================================================
-- Filtros del listado
-- ============================================================================

select results_eq(
  $$select f->>'nombre' from jsonb_array_elements(public.listar_destinatarios_correo_masivo(p_tipo => 'mayorista')->'filas') f order by 1$$,
  $$values ('Alfa'::text), ('Gamma'::text)$$,
  'filtra por tipo'
);

select results_eq(
  $$select f->>'nombre' from jsonb_array_elements(public.listar_destinatarios_correo_masivo(p_empresa => 'b1000000-0000-0000-0000-000000000002')->'filas') f order by 1$$,
  $$values ('Beta'::text), ('Gamma'::text)$$,
  'filtra por empresa (tienda)'
);

select results_eq(
  $$select f->>'nombre' from jsonb_array_elements(public.listar_destinatarios_correo_masivo(p_con_cuenta_web => true)->'filas') f$$,
  $$values ('Alfa'::text)$$,
  'filtra por «con cuenta web» (cuenta activa y cliente habilitado)'
);

select results_eq(
  $$select f->>'nombre' from jsonb_array_elements(public.listar_destinatarios_correo_masivo(p_texto => 'bet')->'filas') f$$,
  $$values ('Beta'::text)$$,
  'filtra por texto'
);

select is(
  jsonb_array_length(public.listar_destinatarios_correo_masivo(p_texto => '%')->'filas'),
  0,
  'el texto se busca literal: % no es comodín'
);

select results_eq(
  $$select f->>'nombre' from jsonb_array_elements(public.listar_destinatarios_correo_masivo(
      p_clientes => array(select id from clientes where nombre in ('Alfa', 'No acepta', 'Archivado')))->'filas') f$$,
  $$values ('Alfa'::text)$$,
  'con clientes marcados se restringe a ellos y los no elegibles se excluyen igual'
);

select is(
  (public.listar_destinatarios_correo_masivo(p_tamano => 2, p_pagina => 2))->'total',
  '3'::jsonb,
  'la paginación informa el total de elegibles'
);

select is(
  jsonb_array_length(public.listar_destinatarios_correo_masivo(p_tamano => 2, p_pagina => 2)->'filas'),
  1,
  'la segunda página de tamaño 2 trae el elegible restante'
);

-- SC-001: el conteo del resumen coincide con la lista, con y sin filtros.
select is(
  (public.resumen_destinatarios_correo_masivo(p_tipo => 'mayorista')->>'elegibles')::int,
  (public.listar_destinatarios_correo_masivo(p_tipo => 'mayorista')->>'total')::int,
  'SC-001: con filtro, elegibles del resumen = total de la lista'
);
select is(
  (public.resumen_destinatarios_correo_masivo()->>'elegibles')::int,
  (public.listar_destinatarios_correo_masivo()->>'total')::int,
  'SC-001: sin filtro, elegibles del resumen = total de la lista'
);

-- ============================================================================
-- FR-006: edición exigida y aislamiento
-- ============================================================================

select pg_temp.como('d1000000-0000-0000-0000-000000000002');
select throws_ok(
  $$select public.listar_destinatarios_correo_masivo()$$,
  '42501', null,
  'con acceso de solo lectura la base rechaza armar la lista'
);
select throws_ok(
  $$select public.resumen_destinatarios_correo_masivo()$$,
  '42501', null,
  'con acceso de solo lectura la base rechaza el resumen'
);

select pg_temp.como('d2000000-0000-0000-0000-000000000001');
select results_eq(
  $$select f->>'nombre' from jsonb_array_elements(public.listar_destinatarios_correo_masivo()->'filas') f$$,
  $$values ('Ajeno'::text)$$,
  'otra organización solo ve a sus propios clientes'
);

reset role;
select ok(
  not has_function_privilege('anon', 'public.listar_destinatarios_correo_masivo(text, text, uuid, boolean, uuid[], integer, integer)', 'execute')
  and not has_function_privilege('anon', 'public.resumen_destinatarios_correo_masivo(text, text, uuid, boolean, uuid[])', 'execute'),
  'anon no ejecuta las funciones de destinatarios'
);

select * from finish();
rollback;
