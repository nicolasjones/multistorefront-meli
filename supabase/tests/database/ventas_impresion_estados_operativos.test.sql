-- Imprimir factura y remito de una factura ya cobrada o en curso: `solicitar_documento_comprobante` aceptaba solo
-- `confirmada` y rechazaba con 22023 a la que el cobro dejó en `cobrado` o `deuda`. Cubre cada estado vivo, y que el
-- borrador y la anulada sigan sin imprimirse.
-- Mismo fixture mínimo que ventas_impresion_documentos.test.sql: un operador de San Javucho con ventas en edición.
begin;

select no_plan();

insert into organizaciones (id, nombre) values
  ('11111111-1111-1111-1111-111111111111', 'Organización Uno');

insert into auth.users (id, email) values
  ('f1000000-0000-0000-0000-000000000002', 'operador@example.com');

insert into usuarios_organizacion (user_id, organizacion_id, rol_id, estado) values
  ('f1000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'operador', 'activo');

insert into dominio.empresas (id, organizacion_id, nombre, razon_social, cuit, direccion) values
  ('a1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'San Javucho', 'San Javucho SRL', '30712345671', 'Calle 1 123');

insert into usuarios_empresas (user_id, empresa_id, organizacion_id, rol_id) values
  ('f1000000-0000-0000-0000-000000000002', 'a1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'operador');

insert into dominio.clientes (id, organizacion_id, numero, nombre, tipo, archivado_en, condicion_iva) values
  ('c5000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 10, 'Cliente Uno', 'minorista', null, 'Responsable Inscripto');

insert into conexiones (id, organizacion_id, sistema_externo, credencial_vault_id) values
  ('c1000000-0000-0000-0000-0000000000c1', '11111111-1111-1111-1111-111111111111', 'comprobantes-pdf', gen_random_uuid());

-- Una factura por estado, con numeración propia.
insert into dominio.comprobantes_venta
  (id, organizacion_id, cliente_id, tipo, numero, fecha, estado, total_sin_iva, total_con_iva, empresa_id, canal, operador_id)
select ('b0000000-0000-0000-0000-00000000000' || n)::uuid, '11111111-1111-1111-1111-111111111111',
       'c5000000-0000-0000-0000-000000000001', 'factura', lpad(n::text, 8, '0'), '2026-10-24', estado, 100, 121,
       'a1000000-0000-0000-0000-000000000001', 'mostrador', 'f1000000-0000-0000-0000-000000000002'
  from (values (1, 'confirmada'), (2, 'cobrado'), (3, 'deuda'), (4, 'aceptado'), (5, 'en_proceso'), (6, 'armando'),
               (7, 'incompleto'), (8, 'borrador'), (9, 'anulada')) as v(n, estado);

reset role;
select set_config('request.jwt.claims', json_build_object('sub', 'f1000000-0000-0000-0000-000000000002', 'role', 'authenticated')::text, true);
set local role authenticated;

select lives_ok(
  $$ select public.solicitar_documento_comprobante('b0000000-0000-0000-0000-000000000001', 'factura') $$,
  'la factura confirmada se puede imprimir'
);
select lives_ok(
  $$ select public.solicitar_documento_comprobante('b0000000-0000-0000-0000-000000000002', 'factura') $$,
  'la factura cobrado se puede imprimir'
);
select lives_ok(
  $$ select public.solicitar_documento_comprobante('b0000000-0000-0000-0000-000000000003', 'factura') $$,
  'la factura deuda se puede imprimir'
);
select lives_ok(
  $$ select public.solicitar_documento_comprobante('b0000000-0000-0000-0000-000000000004', 'factura') $$,
  'la factura aceptado se puede imprimir'
);
select lives_ok(
  $$ select public.solicitar_documento_comprobante('b0000000-0000-0000-0000-000000000005', 'factura') $$,
  'la factura en_proceso se puede imprimir'
);
select lives_ok(
  $$ select public.solicitar_documento_comprobante('b0000000-0000-0000-0000-000000000006', 'factura') $$,
  'la factura armando se puede imprimir'
);
select lives_ok(
  $$ select public.solicitar_documento_comprobante('b0000000-0000-0000-0000-000000000007', 'factura') $$,
  'la factura incompleto se puede imprimir'
);
select lives_ok(
  $$ select public.solicitar_documento_comprobante('b0000000-0000-0000-0000-000000000002', 'remito') $$,
  'el remito de una factura cobrada también se pide'
);
select throws_ok(
  $$ select public.solicitar_documento_comprobante('b0000000-0000-0000-0000-000000000008', 'factura') $$,
  '22023', null, 'un borrador sigue sin imprimirse'
);
select throws_ok(
  $$ select public.solicitar_documento_comprobante('b0000000-0000-0000-0000-000000000009', 'factura') $$,
  '22023', null, 'una factura anulada sigue sin imprimirse'
);

select * from finish();
rollback;
