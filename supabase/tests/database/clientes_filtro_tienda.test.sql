-- F-CLI-11 (MSF-180 fidelidad, spec 20261018-070000-clientes-empresas):
-- filtro por tienda/empresa (`{{tFilt}}` del prototipo) en `buscar_clientes`,
-- `exportar_clientes` y `ranking_clientes`. El prototipo filtra la pantalla
-- completa (listado y ranking) por la tienda elegida.
-- Cubre: filtro por tienda, combinación con los otros filtros, clientes sin
-- tienda excluidos al filtrar, aislamiento entre organizaciones (una tienda de
-- otra organización no trae filas) y `null` = sin filtro (compatibilidad).
-- El fixture corre como postgres (RLS no aplica) y las verificaciones como
-- «authenticated» vía request.jwt.claims, igual que PostgREST.
begin;

select plan(16);

insert into organizaciones (id, nombre) values
  ('11111111-1111-1111-1111-111111111111', 'Organización Uno'),
  ('22222222-2222-2222-2222-222222222222', 'Organización Dos');

insert into auth.users (id, email) values
  ('f1000000-0000-0000-0000-000000000001', 'admin-uno@example.com'),
  ('f2000000-0000-0000-0000-000000000001', 'admin-dos@example.com');

insert into usuarios_organizacion (user_id, organizacion_id, rol_id) values
  ('f1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'administrador'),
  ('f2000000-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', 'administrador');

insert into dominio.empresas (id, organizacion_id, nombre) values
  ('b1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'San Javucho'),
  ('b1000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'Mundo JC'),
  ('b2000000-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', 'Ajena');

insert into clientes (organizacion_id, numero, nombre, tipo) values
  ('11111111-1111-1111-1111-111111111111', 101, 'Alfa', 'mayorista'),
  ('11111111-1111-1111-1111-111111111111', 102, 'Beta', 'minorista'),
  ('11111111-1111-1111-1111-111111111111', 103, 'Gamma', 'mayorista'),
  ('11111111-1111-1111-1111-111111111111', 104, 'Sin tienda', 'minorista'),
  ('22222222-2222-2222-2222-222222222222', 201, 'Ajeno', 'minorista');

-- Alfa solo en San Javucho; Beta solo en Mundo JC; Gamma en ambas; Sin tienda
-- en ninguna. El cliente de la Dos está en la tienda de su propia organización.
insert into public.clientes_empresas (cliente_id, empresa_id, organizacion_id)
select c.id, e.id, c.organizacion_id
  from (values
    ('11111111-1111-1111-1111-111111111111', 'Alfa', 'San Javucho'),
    ('11111111-1111-1111-1111-111111111111', 'Beta', 'Mundo JC'),
    ('11111111-1111-1111-1111-111111111111', 'Gamma', 'San Javucho'),
    ('11111111-1111-1111-1111-111111111111', 'Gamma', 'Mundo JC'),
    ('22222222-2222-2222-2222-222222222222', 'Ajeno', 'Ajena')
  ) as v(org, cliente, empresa)
  join clientes c on c.organizacion_id = v.org::uuid and c.nombre = v.cliente
  join dominio.empresas e on e.organizacion_id = v.org::uuid and e.nombre = v.empresa;

-- Facturas de octubre con importes distintos: el ranking ordena por facturado.
insert into dominio.comprobantes_venta
  (organizacion_id, cliente_id, tipo, numero, fecha, estado, total_sin_iva, total_con_iva)
select v.org::uuid, c.id, 'factura', v.numero, v.fecha::date, 'emitida', v.sin_iva, v.sin_iva * 1.21
  from (values
    ('11111111-1111-1111-1111-111111111111', 'Alfa', '0001-00000001', '2026-10-05', 1000),
    ('11111111-1111-1111-1111-111111111111', 'Beta', '0001-00000002', '2026-10-06', 2000),
    ('11111111-1111-1111-1111-111111111111', 'Gamma', '0001-00000003', '2026-10-07', 3000),
    ('11111111-1111-1111-1111-111111111111', 'Sin tienda', '0001-00000004', '2026-10-08', 4000),
    ('22222222-2222-2222-2222-222222222222', 'Ajeno', '0001-00000001', '2026-10-09', 9000)
  ) as v(org, cliente, numero, fecha, sin_iva)
  join clientes c on c.organizacion_id = v.org::uuid and c.nombre = v.cliente;

create function pg_temp.como(p_user uuid) returns void language plpgsql as $$
begin
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
  set local role authenticated;
end $$;

select pg_temp.como('f1000000-0000-0000-0000-000000000001');

-- ============================================================================
-- Listado por tienda (F-CLI-11)
-- ============================================================================

select is(
  (select count(*)::int from buscar_clientes() where nombre = 'Sin tienda'),
  1,
  'sin filtro por tienda, el listado incluye a los clientes sin tienda'
);

select results_eq(
  $$select nombre from buscar_clientes(p_empresa_id => 'b1000000-0000-0000-0000-000000000001')$$,
  $$values ('Alfa'::text), ('Gamma'::text)$$,
  'San Javucho trae solo los clientes habilitados en esa tienda'
);

select results_eq(
  $$select nombre from buscar_clientes(p_empresa_id => 'b1000000-0000-0000-0000-000000000002')$$,
  $$values ('Beta'::text), ('Gamma'::text)$$,
  'Mundo JC trae los suyos y comparte a Gamma (habilitado en dos tiendas)'
);

select is(
  (select count(*)::int from buscar_clientes(p_empresa_id => 'b1000000-0000-0000-0000-000000000001') where nombre = 'Sin tienda'),
  0,
  'al filtrar por tienda, un cliente sin tiendas queda excluido'
);

select results_eq(
  $$select nombre from buscar_clientes(p_tipo => 'mayorista', p_empresa_id => 'b1000000-0000-0000-0000-000000000002')$$,
  $$values ('Gamma'::text)$$,
  'el filtro por tienda se combina con el de tipo'
);

select results_eq(
  $$select nombre from buscar_clientes(p_texto => 'alf', p_empresa_id => 'b1000000-0000-0000-0000-000000000001')$$,
  $$values ('Alfa'::text)$$,
  'el filtro por tienda se combina con la búsqueda de texto'
);

select is(
  (select count(*)::int from buscar_clientes(p_empresa_id => 'b2000000-0000-0000-0000-000000000001')),
  0,
  'una tienda de otra organización no trae filas (RLS del llamador)'
);

-- ============================================================================
-- Exportación por tienda (F-CLI-11)
-- ============================================================================

select results_eq(
  $$select nombre from exportar_clientes(p_empresa_id => 'b1000000-0000-0000-0000-000000000001')$$,
  $$values ('Alfa'::text), ('Gamma'::text)$$,
  'la exportación respeta el filtro por tienda (mismo conjunto que el listado)'
);

select is(
  (select count(*)::int from exportar_clientes() where nombre = 'Sin tienda'),
  1,
  'sin filtro por tienda, la exportación incluye a los clientes sin tienda'
);

-- ============================================================================
-- Ranking por tienda (F-CLI-11)
-- ============================================================================

select results_eq(
  $$select nombre from ranking_clientes('2026-10-01', '2026-10-31', p_empresa_id => 'b1000000-0000-0000-0000-000000000001')$$,
  $$values ('Gamma'::text), ('Alfa'::text)$$,
  'el ranking por San Javucho trae a sus clientes ordenados por facturado'
);

select results_eq(
  $$select nombre from ranking_clientes('2026-10-01', '2026-10-31', p_empresa_id => 'b1000000-0000-0000-0000-000000000002')$$,
  $$values ('Gamma'::text), ('Beta'::text)$$,
  'el ranking por Mundo JC trae a los suyos'
);

select is(
  (select count(*)::int from ranking_clientes('2026-10-01', '2026-10-31', p_empresa_id => 'b2000000-0000-0000-0000-000000000001')),
  0,
  'una tienda de otra organización no trae filas al ranking'
);

select is(
  (select count(*)::int from ranking_clientes('2026-10-01', '2026-10-31') where nombre = 'Sin tienda'),
  1,
  'sin filtro por tienda, el ranking incluye a los clientes sin tienda'
);

-- ============================================================================
-- Compatibilidad y permisos de las firmas nuevas
-- ============================================================================

select ok(
  has_function_privilege('authenticated', 'public.buscar_clientes(text, text, boolean, integer, integer, uuid, boolean)', 'execute'),
  'authenticated tiene EXECUTE sobre buscar_clientes con el parámetro de tienda y de cuenta web'
);
select ok(
  has_function_privilege('authenticated', 'public.exportar_clientes(text, text, boolean, uuid, integer, uuid)', 'execute'),
  'authenticated tiene EXECUTE sobre exportar_clientes con el parámetro de tienda'
);
select ok(
  has_function_privilege('authenticated', 'public.ranking_clientes(date, date, text, boolean, boolean, integer, integer, uuid)', 'execute'),
  'authenticated tiene EXECUTE sobre ranking_clientes con el parámetro de tienda'
);

select * from finish();
rollback;
