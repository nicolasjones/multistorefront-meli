-- F-CLI-16 (MSF-400, épica MSF-171, FR-010…FR-012; SC-003): `public.clientes_inactivos`: umbral (compras hace
-- 20/100/400 días), sin compras y archivados fuera, una sola compra antigua, la nota de crédito no cuenta como compra,
-- orden y desempate, tipo / Consumidor final / tienda, paginación, validaciones, niveles de la sección Clientes,
-- otra organización y `anon` sin ejecución. Las fechas son relativas al «hoy» de Buenos Aires (sin reloj fijo).
begin;

select plan(32);

insert into organizaciones (id, nombre) values
  ('11111111-1111-1111-1111-111111111111', 'Organización Uno'),
  ('22222222-2222-2222-2222-222222222222', 'Organización Dos');

insert into auth.users (id, email) values
  ('d1000000-0000-0000-0000-000000000001', 'admin-uno@example.com'),
  ('d2000000-0000-0000-0000-000000000001', 'admin-dos@example.com'),
  ('d3000000-0000-0000-0000-000000000001', 'sin-membresia@example.com'),
  ('d4000000-0000-0000-0000-000000000001', 'consulta-uno@example.com'),
  ('d5000000-0000-0000-0000-000000000001', 'deposito-uno@example.com');

insert into usuarios_organizacion (user_id, organizacion_id, rol_id) values
  ('d1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'administrador'),
  ('d4000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'consulta'),
  ('d5000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'deposito'),
  ('d2000000-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', 'administrador');

-- Cada organización ya trae su Consumidor final (Nº 1, minorista).
insert into clientes (organizacion_id, numero, nombre, tipo) values
  ('11111111-1111-1111-1111-111111111111', 101, 'Reciente', 'minorista'),   -- compró hace 20 días: activo
  ('11111111-1111-1111-1111-111111111111', 102, 'Hace100', 'mayorista'),    -- última hace 100 días
  ('11111111-1111-1111-1111-111111111111', 103, 'Hace400', 'minorista'),    -- única compra hace 400 días
  ('11111111-1111-1111-1111-111111111111', 104, 'SinCompras', 'minorista'), -- nunca compró
  ('11111111-1111-1111-1111-111111111111', 105, 'Archivado', 'minorista'),  -- inactivo pero archivado
  ('11111111-1111-1111-1111-111111111111', 106, 'SoloNota', 'minorista'),   -- solo una nota de crédito: sin compra
  ('11111111-1111-1111-1111-111111111111', 107, 'NotaReciente', 'mayorista'), -- factura vieja + nota reciente
  ('11111111-1111-1111-1111-111111111111', 108, 'Anulada', 'minorista'),    -- solo factura anulada
  ('11111111-1111-1111-1111-111111111111', 109, 'Empate', 'minorista'),     -- empata con Hace100
  ('22222222-2222-2222-2222-222222222222', 201, 'Ajeno', 'minorista');

update clientes set archivado_en = now() where nombre = 'Archivado';

insert into dominio.comprobantes_venta
  (organizacion_id, cliente_id, tipo, numero, fecha, estado, total_sin_iva, total_con_iva)
select v.org::uuid, c.id, v.tipo, v.numero,
       ((now() at time zone 'America/Argentina/Buenos_Aires')::date - v.dias), v.estado, v.sin_iva, v.sin_iva * 1.21
  from (values
    ('11111111-1111-1111-1111-111111111111', 'Reciente', 'factura', '0001-00000001', 20, 'emitida', 1000),
    ('11111111-1111-1111-1111-111111111111', 'Hace100', 'factura', '0001-00000002', 100, 'cobrada', 2000),
    ('11111111-1111-1111-1111-111111111111', 'Hace100', 'factura', '0001-00000003', 150, 'cobrada', 3000),
    ('11111111-1111-1111-1111-111111111111', 'Hace400', 'factura', '0001-00000004', 400, 'deuda', 500),
    ('11111111-1111-1111-1111-111111111111', 'Archivado', 'factura', '0001-00000005', 200, 'emitida', 700),
    ('11111111-1111-1111-1111-111111111111', 'SoloNota', 'nota_credito', '0001-00000006', 200, 'emitida', 300),
    ('11111111-1111-1111-1111-111111111111', 'NotaReciente', 'factura', '0001-00000007', 120, 'emitida', 1000),
    ('11111111-1111-1111-1111-111111111111', 'NotaReciente', 'nota_credito', '0001-00000008', 5, 'emitida', 400),
    ('11111111-1111-1111-1111-111111111111', 'Anulada', 'factura', '0001-00000009', 300, 'anulada', 900),
    ('11111111-1111-1111-1111-111111111111', 'Empate', 'factura', '0001-00000010', 100, 'emitida', 100),
    ('11111111-1111-1111-1111-111111111111', 'Consumidor final', 'factura', '0001-00000011', 500, 'cobrada', 6000),
    ('11111111-1111-1111-1111-111111111111', 'Reciente', 'presupuesto', '0001-00000012', 400, 'emitida', 9999),
    ('22222222-2222-2222-2222-222222222222', 'Ajeno', 'factura', '0001-00000001', 300, 'emitida', 77777)
  ) as v(org, nombre, tipo, numero, dias, estado, sin_iva)
  join clientes c on c.organizacion_id = v.org::uuid and c.nombre = v.nombre
 where v.tipo <> 'nota_credito';

-- Una nota de crédito siempre cuelga de una factura y trae su tipo (comprobantes_venta_nc_ck).
insert into dominio.comprobantes_venta
  (organizacion_id, cliente_id, tipo, numero, fecha, estado, total_sin_iva, total_con_iva, comprobante_origen_id, nc_tipo)
select f.organizacion_id, c.id, 'nota_credito', v.numero,
       ((now() at time zone 'America/Argentina/Buenos_Aires')::date - v.dias), 'emitida', v.sin_iva, v.sin_iva * 1.21,
       f.id, 'devolucion_importe'
  from (values
    ('SoloNota', '0001-00000006', 200, 300, '0001-00000011'),
    ('NotaReciente', '0001-00000008', 5, 400, '0001-00000007')
  ) as v(nombre, numero, dias, sin_iva, factura)
  join clientes c on c.organizacion_id = '11111111-1111-1111-1111-111111111111' and c.nombre = v.nombre
  join dominio.comprobantes_venta f on f.organizacion_id = c.organizacion_id and f.numero = v.factura and f.tipo = 'factura';

create function pg_temp.como(p_user uuid) returns void language plpgsql as $$
begin
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
  set local role authenticated;
end $$;

select pg_temp.como('d1000000-0000-0000-0000-000000000001');

-- ============================================================================
-- Umbral, exclusiones, orden y desempate (FR-010, FR-011)
-- ============================================================================

select results_eq(
  $$select nombre from clientes_inactivos(90)$$,
  $$values ('Hace400'), ('NotaReciente'), ('Empate'), ('Hace100')$$,
  'umbral 90: lista a 400, 120 (la nota reciente no cuenta como compra) y 100 días, de la más antigua a la más reciente; desempate por nombre'
);
select is((select count(*)::int from clientes_inactivos(90) where nombre = 'Reciente'), 0, 'compró hace 20 días: no es inactivo');
select is((select count(*)::int from clientes_inactivos(10) where nombre = 'Reciente'), 1, 'con umbral 10 el de 20 días sí aparece');
select is((select count(*)::int from clientes_inactivos(90) where nombre = 'SinCompras'), 0, 'un cliente sin compras nunca aparece');
select is((select count(*)::int from clientes_inactivos(90) where nombre = 'Archivado'), 0, 'un cliente archivado no aparece');
select is((select count(*)::int from clientes_inactivos(90) where nombre = 'SoloNota'), 0, 'solo una nota de crédito: no hay compra, no aparece');
select is((select count(*)::int from clientes_inactivos(90) where nombre = 'Anulada'), 0, 'solo factura anulada: no cuenta, no aparece');
select is((select count(*)::int from clientes_inactivos(90) where nombre = 'Consumidor final'), 0, 'Consumidor final excluido por defecto');
select is((select count(*)::int from clientes_inactivos(90, null, true) where nombre = 'Consumidor final'), 1, 'Consumidor final incluido a pedido');
select is((select count(*)::int from clientes_inactivos(120) where nombre = 'NotaReciente'), 0, 'el límite es estricto: última compra hace exactamente N días no es inactivo');
select is((select count(*)::int from clientes_inactivos(119) where nombre = 'NotaReciente'), 1, 'hace 120 días con umbral 119: inactivo');

select results_eq(
  $$select ultima_compra = (now() at time zone 'America/Argentina/Buenos_Aires')::date - 100,
          dias_sin_comprar, comprobantes, facturado
      from clientes_inactivos(90) where nombre = 'Hace100'$$,
  $$values (true, 100, 2::bigint, 5000::numeric)$$,
  'Hace100: última compra, días, 2 facturas y neto histórico'
);
select results_eq(
  $$select dias_sin_comprar, comprobantes, facturado from clientes_inactivos(90) where nombre = 'NotaReciente'$$,
  $$values (120, 1::bigint, 600::numeric)$$,
  'la nota de crédito resta del histórico (1000 − 400), no suma comprobante ni mueve la última compra'
);
select results_eq(
  $$select dias_sin_comprar, comprobantes, facturado from clientes_inactivos(90) where nombre = 'Hace400'$$,
  $$values (400, 1::bigint, 500::numeric)$$,
  'una sola compra antigua: aparece'
);
select results_eq(
  $$select numero from clientes_inactivos(90, null, true)$$,
  $$values (1), (103), (107), (109), (102)$$,
  'orden por última compra, nombre y número (incluye Consumidor final, 500 días)'
);

-- ============================================================================
-- Filtros de tipo y tienda, paginación (FR-010)
-- ============================================================================

select results_eq(
  $$select nombre from clientes_inactivos(90, 'mayorista')$$,
  $$values ('NotaReciente'), ('Hace100')$$,
  'filtro por tipo mayorista'
);

insert into dominio.empresas (id, organizacion_id, nombre) values
  ('e1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'Tienda A');
insert into public.clientes_empresas (organizacion_id, cliente_id, empresa_id)
select '11111111-1111-1111-1111-111111111111', c.id, 'e1000000-0000-0000-0000-000000000001'
  from clientes c where c.organizacion_id = '11111111-1111-1111-1111-111111111111' and c.nombre = 'Hace100';

select results_eq(
  $$select nombre from clientes_inactivos(90, null, false, 1, 25, 'e1000000-0000-0000-0000-000000000001')$$,
  $$values ('Hace100')$$,
  'filtro por tienda: solo los clientes habilitados en ella'
);

select results_eq(
  $$select nombre, total_filas from clientes_inactivos(90, null, false, 2, 3)$$,
  $$values ('Hace100', 4::bigint)$$,
  'paginación: segunda página de 3 con total de 4'
);
select is((select count(*)::int from clientes_inactivos(90, null, false, 9, 3)), 0, 'página más allá del final: sin filas');

-- ============================================================================
-- Validaciones (FR-010)
-- ============================================================================

select throws_ok($$select * from clientes_inactivos(0)$$, '22023', null, 'días 0 inválido');
select throws_ok($$select * from clientes_inactivos(3651)$$, '22023', null, 'días 3651 inválido');
select throws_ok($$select * from clientes_inactivos(null)$$, '22023', null, 'días nulo inválido');
select lives_ok($$select * from clientes_inactivos(3650)$$, 'días 3650 es válido');
select throws_ok($$select * from clientes_inactivos(90, 'otro')$$, '22023', null, 'tipo inválido');
select throws_ok($$select * from clientes_inactivos(90, null, false, 0)$$, '22023', null, 'página 0 inválida');
select throws_ok($$select * from clientes_inactivos(90, null, false, 1, 1001)$$, '22023', null, 'tamaño sobre el tope de 1.000 inválido');

-- ============================================================================
-- Niveles de la sección Clientes, organización y anon (FR-012, SC-003)
-- ============================================================================

select pg_temp.como('d4000000-0000-0000-0000-000000000001');
select is((select count(*)::int from clientes_inactivos(90)), 4, 'consulta (lectura en Clientes) ve la lista');

select pg_temp.como('d5000000-0000-0000-0000-000000000001');
select throws_ok($$select * from clientes_inactivos(90)$$, '42501', null, 'depósito (Clientes en «ninguno»): sin permiso, también llamando directo');

select pg_temp.como('d3000000-0000-0000-0000-000000000001');
select throws_ok($$select * from clientes_inactivos(90)$$, '42501', null, 'sin membresía: sin permiso');

select pg_temp.como('d2000000-0000-0000-0000-000000000001');
select results_eq(
  $$select nombre from clientes_inactivos(90)$$,
  $$values ('Ajeno')$$,
  'otra organización solo ve sus propias filas'
);

reset role;
set local role anon;
select throws_ok($$select * from clientes_inactivos(90)$$, '42501', null, '«anon» no puede ejecutar clientes_inactivos');

reset role;
select ok(
  not has_function_privilege('anon', 'public.clientes_inactivos(integer, text, boolean, integer, integer, uuid)', 'execute')
  and has_function_privilege('authenticated', 'public.clientes_inactivos(integer, text, boolean, integer, integer, uuid)', 'execute'),
  'anon sin EXECUTE y authenticated con EXECUTE sobre clientes_inactivos'
);

select * from finish();
rollback;
