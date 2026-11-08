-- F-PRE-09 (MSF-427, épica MSF-352) · SC-009: simulador «Así quedan los precios» con el precio propio.
-- Cubre FR-021 (columna `precio_propio`, firma de entrada intacta), FR-023 (la simulación no escribe) y FR-024 (la
-- fila con precio propio no se mueve con el ajuste), el aislamiento entre dos organizaciones, los permisos por rol y
-- `anon`. Además compara la vista previa con el precio real (`precios_empresa_neto`) para que el simulador diga
-- lo mismo que la tienda. Corre como postgres para armar el fixture y como "authenticated" para verificar.
begin;

select plan(35);

insert into organizaciones (id, nombre) values
  ('11111111-1111-1111-1111-111111111111', 'Organización Uno'),
  ('22222222-2222-2222-2222-222222222222', 'Organización Dos');

insert into auth.users (id, email) values
  ('d1000000-0000-0000-0000-000000000001', 'administrador@example.com'),
  ('d1000000-0000-0000-0000-000000000002', 'consulta@example.com'),
  ('d2000000-0000-0000-0000-000000000001', 'admin-dos@example.com');

insert into usuarios_organizacion (user_id, organizacion_id, rol_id) values
  ('d1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'administrador'),
  ('d1000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'consulta'),
  ('d2000000-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', 'administrador');

-- Org 1: Mundo JC (central −5 %, sin IVA) · San Javucho (sin ajuste, con IVA). Org 2: Empresa Dos.
insert into dominio.empresas (id, organizacion_id, nombre) values
  ('e1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'Mundo JC'),
  ('e1000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'San Javucho'),
  ('e2000000-0000-0000-0000-000000000003', '22222222-2222-2222-2222-222222222222', 'Empresa Dos');
insert into dominio.precios_empresa (empresa_id, organizacion_id, base, ajuste_pct, mostrar_con_iva) values
  ('e1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'central_ajuste', -5, false),
  ('e1000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'central', 0, true);

-- Las categorías nacen con IVA 21 % (F-PRE-12): los productos heredan esa alícuota.
insert into dominio.categorias (id, organizacion_id, nombre) values
  ('c1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'Joysticks'),
  ('c2000000-0000-0000-0000-000000000003', '22222222-2222-2222-2222-222222222222', 'Ajena');

-- P1 «Joystick» ARS 29.186 · P2 «Auricular» USD 10 (con cotización 1.500 ⇒ central 15.000) · P3 de la org 2.
insert into dominio.productos (id, organizacion_id, nombre, sku, moneda, precio_lista, categoria_id) values
  ('a1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'Joystick', 'JOY-1', 'ARS', 29186, 'c1000000-0000-0000-0000-000000000001'),
  ('a1000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'Auricular', 'AUR-1', 'USD', 10, 'c1000000-0000-0000-0000-000000000001'),
  ('a2000000-0000-0000-0000-000000000003', '22222222-2222-2222-2222-222222222222', 'Teclado', 'TEC-1', 'ARS', 500, 'c2000000-0000-0000-0000-000000000003');
insert into dominio.cotizacion_inicial (organizacion_id, valor) values
  ('11111111-1111-1111-1111-111111111111', 1500);

create function pg_temp.como(p_user uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
  set local role authenticated;
end $$;

-- ============================================================================
-- Firma y privilegios (FR-021)
-- ============================================================================

select has_function('public', 'previsualizar_precios_empresa', array['uuid', 'text', 'numeric', 'integer'],
  'la firma de entrada de previsualizar_precios_empresa sigue intacta (uuid, text, numeric, integer)');
select ok(
  pg_get_function_result('public.previsualizar_precios_empresa(uuid,text,numeric,integer)'::regprocedure) like '%precio_propio boolean%',
  'la salida suma la columna precio_propio boolean'
);
select is(has_function_privilege('anon', 'public.previsualizar_precios_empresa(uuid, text, numeric, integer)', 'EXECUTE'), false, 'anon no ejecuta previsualizar_precios_empresa');
select is(has_function_privilege('authenticated', 'public.previsualizar_precios_empresa(uuid, text, numeric, integer)', 'EXECUTE'), true, 'authenticated ejecuta previsualizar_precios_empresa');

-- ============================================================================
-- Sin precios propios: nada está marcado y coincide con el precio real
-- ============================================================================

select pg_temp.como('d1000000-0000-0000-0000-000000000001');

select is(
  (select count(*)::int from public.previsualizar_precios_empresa('e1000000-0000-0000-0000-000000000001', 'central_ajuste', -5)),
  2,
  'la muestra trae los dos productos de la organización (y ninguno de la otra)'
);
select is(
  (select count(*)::int from public.previsualizar_precios_empresa('e1000000-0000-0000-0000-000000000001', 'central_ajuste', -5) where precio_propio),
  0,
  'sin precios propios ninguna fila viene marcada'
);
select is(
  (select p.neto_ars from public.previsualizar_precios_empresa('e1000000-0000-0000-0000-000000000001', 'central_ajuste', -5) p where p.producto_id = 'a1000000-0000-0000-0000-000000000001'),
  (select v.neto_ars from public.precios_empresa_neto v where v.producto_id = 'a1000000-0000-0000-0000-000000000001' and v.empresa_id = 'e1000000-0000-0000-0000-000000000001'),
  'con la regla guardada, el simulador dice lo mismo que el precio real (ARS)'
);
select is(
  (select p.neto_ars from public.previsualizar_precios_empresa('e1000000-0000-0000-0000-000000000001', 'central_ajuste', -5) p where p.producto_id = 'a1000000-0000-0000-0000-000000000002'),
  (select v.neto_ars from public.precios_empresa_neto v where v.producto_id = 'a1000000-0000-0000-0000-000000000002' and v.empresa_id = 'e1000000-0000-0000-0000-000000000001'),
  'con la regla guardada, el simulador dice lo mismo que el precio real (USD con cotización)'
);

-- ============================================================================
-- Con precio propio: marca, valor fijo y sin mover con el ajuste (FR-024)
-- ============================================================================

select public.fijar_precio_propio('a1000000-0000-0000-0000-000000000001', 'e1000000-0000-0000-0000-000000000001', 'ARS', 25000);

select is(
  (select p.precio_propio from public.previsualizar_precios_empresa('e1000000-0000-0000-0000-000000000001', 'central_ajuste', -5) p where p.producto_id = 'a1000000-0000-0000-0000-000000000001'),
  true,
  'el producto con precio propio viene marcado'
);
select is(
  (select p.precio_propio from public.previsualizar_precios_empresa('e1000000-0000-0000-0000-000000000001', 'central_ajuste', -5) p where p.producto_id = 'a1000000-0000-0000-0000-000000000002'),
  false,
  'el producto sin precio propio sigue sin marca'
);
select is(
  (select p.neto_ars from public.previsualizar_precios_empresa('e1000000-0000-0000-0000-000000000001', 'central_ajuste', -5) p where p.producto_id = 'a1000000-0000-0000-0000-000000000001'),
  25000::numeric,
  'la fila con precio propio muestra ese valor (reemplaza al calculado)'
);
select is(
  (select p.neto_ars from public.previsualizar_precios_empresa('e1000000-0000-0000-0000-000000000001', 'central_ajuste', 20) p where p.producto_id = 'a1000000-0000-0000-0000-000000000001'),
  25000::numeric,
  'mover el ajuste a +20 % NO cambia el valor de la fila con precio propio'
);
select is(
  (select p.neto_ars from public.previsualizar_precios_empresa('e1000000-0000-0000-0000-000000000001', 'central_ajuste', 20) p where p.producto_id = 'a1000000-0000-0000-0000-000000000002'),
  18000::numeric,
  'y la fila sin precio propio sí se mueve (15.000 × 1,20)'
);
select is(
  (select p.neto_ars from public.previsualizar_precios_empresa('e1000000-0000-0000-0000-000000000001', 'central', 0) p where p.producto_id = 'a1000000-0000-0000-0000-000000000001'),
  25000::numeric,
  'con la base «Igual al central» el precio propio tampoco se mueve'
);
select ok(
  (select p.final_ars from public.previsualizar_precios_empresa('e1000000-0000-0000-0000-000000000001', 'central_ajuste', -5) p where p.producto_id = 'a1000000-0000-0000-0000-000000000001') > 25000,
  'el precio final suma el IVA encima del precio propio'
);
select ok(
  (select p.final_ars from public.previsualizar_precios_empresa('e1000000-0000-0000-0000-000000000001', 'central_ajuste', 20) p where p.producto_id = 'a1000000-0000-0000-0000-000000000001')
    = (select p.final_ars from public.previsualizar_precios_empresa('e1000000-0000-0000-0000-000000000001', 'central_ajuste', -5) p where p.producto_id = 'a1000000-0000-0000-0000-000000000001'),
  'el precio final de la fila con precio propio tampoco se mueve con el ajuste'
);

-- Precio propio en USD: se convierte con la cotización.
select public.fijar_precio_propio('a1000000-0000-0000-0000-000000000002', 'e1000000-0000-0000-0000-000000000001', 'USD', 11);
select is(
  (select p.neto_ars from public.previsualizar_precios_empresa('e1000000-0000-0000-0000-000000000001', 'central_ajuste', 20) p where p.producto_id = 'a1000000-0000-0000-0000-000000000002'),
  16500::numeric,
  'un precio propio en USD se muestra en pesos con la cotización (11 × 1.500), distinto del calculado con la regla (18.000)'
);
select is(
  (select p.precio_propio from public.previsualizar_precios_empresa('e1000000-0000-0000-0000-000000000001', 'central_ajuste', 20) p where p.producto_id = 'a1000000-0000-0000-0000-000000000002'),
  true,
  'y también viene marcado'
);

-- ============================================================================
-- El precio propio de una empresa no se mezcla con otra
-- ============================================================================

select is(
  (select count(*)::int from public.previsualizar_precios_empresa('e1000000-0000-0000-0000-000000000002', 'central', 0) where precio_propio),
  0,
  'San Javucho no hereda los precios propios de Mundo JC'
);

-- ============================================================================
-- No escribe (FR-023)
-- ============================================================================

select is(
  (select ajuste_pct from dominio.precios_empresa where empresa_id = 'e1000000-0000-0000-0000-000000000001'),
  -5::numeric,
  'simular +20 % no cambia la regla guardada de la empresa'
);
select is(
  (select count(*)::int from dominio.precios_propios_empresa),
  2,
  'la simulación no crea ni borra precios propios'
);

-- ============================================================================
-- Permisos y aislamiento
-- ============================================================================

select throws_ok(
  $$select * from public.previsualizar_precios_empresa('e2000000-0000-0000-0000-000000000003', 'central', 0)$$,
  'P0002', null, 'una empresa de otra organización no existe para este administrador'
);
select throws_ok(
  $$select * from public.previsualizar_precios_empresa('e1000000-0000-0000-0000-000000000001', 'otra', 0)$$,
  '23514', null, 'una base inválida se rechaza'
);
select throws_ok(
  $$select * from public.previsualizar_precios_empresa('e1000000-0000-0000-0000-000000000001', 'central_ajuste', -100)$$,
  '23514', null, 'un ajuste de −100 % o menos se rechaza'
);
reset role;

select pg_temp.como('d1000000-0000-0000-0000-000000000002');
select throws_ok(
  $$select * from public.previsualizar_precios_empresa('e1000000-0000-0000-0000-000000000001', 'central', 0)$$,
  '42501', null, 'un rol sin acceso a Empresas no puede abrir el simulador (CA-PRE-09-2)'
);
reset role;

select pg_temp.como('d2000000-0000-0000-0000-000000000001');
select is(
  (select array_agg(nombre order by nombre) from public.previsualizar_precios_empresa('e2000000-0000-0000-0000-000000000003', 'central', 0)),
  array['Teclado'],
  'la otra organización ve solo sus productos y ninguno de la Uno'
);
select is(
  (select count(*)::int from public.previsualizar_precios_empresa('e2000000-0000-0000-0000-000000000003', 'central', 0) where precio_propio),
  0,
  'y no ve ninguna marca de precio propio ajena'
);
reset role;

-- ============================================================================
-- Todos los caminos de lectura respetan el precio propio (MSF-423, revisión retroactiva):
-- tienda pública (x1 y escalas) y líneas de comprobante (private.precio_para). Mundo JC: Joystick propio $ 25.000 y
-- Auricular propio USD 11 (× 1.500 = 16.500); los dos se venden en la empresa; la regla es «central −5 %», sin IVA.
-- ============================================================================
insert into dominio.producto_empresa (producto_id, empresa_id, organizacion_id) values
  ('a1000000-0000-0000-0000-000000000001', 'e1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111'),
  ('a1000000-0000-0000-0000-000000000002', 'e1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111')
on conflict do nothing;

-- La tienda no depende de la sesión: sin claims (anónimo) y con la sesión de OTRA organización el precio es el mismo.
select set_config('request.jwt.claims', '{}', true);
select is(
  private.precio_final_publico('a1000000-0000-0000-0000-000000000001', 'e1000000-0000-0000-0000-000000000001'),
  25000::numeric,
  'la tienda pública muestra el precio propio en pesos, no «central − 5 %»'
);
select is(
  private.precio_final_publico('a1000000-0000-0000-0000-000000000002', 'e1000000-0000-0000-0000-000000000001'),
  16500::numeric,
  'la tienda pública convierte un precio propio en USD con la cotización de la empresa'
);
select is(
  private.precio_final_publico_escala('a1000000-0000-0000-0000-000000000001', 'e1000000-0000-0000-0000-000000000001', 'x5'),
  25000::numeric,
  'una escala sin precio propio cargado cae en el precio base, que es el precio propio'
);
select set_config('request.jwt.claims', json_build_object('sub', 'd2000000-0000-0000-0000-000000000001', 'role', 'authenticated')::text, true);
select is(
  private.precio_final_publico('a1000000-0000-0000-0000-000000000001', 'e1000000-0000-0000-0000-000000000001'),
  25000::numeric,
  'con la sesión de otra organización (cliente u operador ajeno) la tienda muestra el mismo precio propio'
);
select is(
  private.precio_final_publico_escala('a1000000-0000-0000-0000-000000000002', 'e1000000-0000-0000-0000-000000000001', 'x1'),
  16500::numeric,
  'y también en la escala x1 con un precio propio en USD'
);
select pg_temp.como('d1000000-0000-0000-0000-000000000001');
select is(
  (select neto from private.precio_para('a1000000-0000-0000-0000-000000000001', 'e1000000-0000-0000-0000-000000000001', 'x1')),
  25000::numeric,
  'las líneas de presupuestos y comprobantes usan el precio propio'
);
select is(
  (select neto from private.precio_para('a1000000-0000-0000-0000-000000000002', 'e1000000-0000-0000-0000-000000000001', 'x10')),
  16500::numeric,
  'también en una escala sin precio cargado (USD ⇒ pesos con la cotización de la empresa)'
);
reset role;
select is(
  private.precio_final_publico('a1000000-0000-0000-0000-000000000001', 'e1000000-0000-0000-0000-000000000002'),
  null,
  'sin producto asignado a la empresa no hay precio público (el precio propio es por empresa)'
);

select * from finish();
rollback;
