-- Lote 42 (MSF-737): comprobantes y RMA exigen el nivel de Ventas EN CADA empresa, no solo empresa asignada.
-- Persona con Ventas (operador) en la tienda A y un rol sin Ventas en la B (override de la matriz): lee A, no B,
-- por /rest/v1/. El comprobante heredado sin empresa sigue la regla de la organización. Sin ejecución para anon.
begin;

select plan(20);

insert into organizaciones (id, nombre) values ('11111111-1111-1111-1111-111111111111', 'Organización Uno');
insert into auth.users (id, email) values
  ('f1000000-0000-0000-0000-000000000001', 'admin@example.com'),
  ('f1000000-0000-0000-0000-000000000002', 'mixto@example.com'),
  ('f1000000-0000-0000-0000-000000000003', 'soporte@example.com');
insert into superadmins (user_id) values ('f1000000-0000-0000-0000-000000000003');
insert into usuarios_organizacion (user_id, organizacion_id, rol_id, estado) values
  ('f1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'administrador', 'activo'),
  ('f1000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'operador', 'activo');
insert into dominio.empresas (id, organizacion_id, nombre) values
  ('a1000000-0000-0000-0000-00000000000a', '11111111-1111-1111-1111-111111111111', 'Tienda A'),
  ('a1000000-0000-0000-0000-00000000000b', '11111111-1111-1111-1111-111111111111', 'Tienda B');
-- Operador en A (Ventas edición) y Depósito en B con Ventas en ninguno.
insert into usuarios_empresas (user_id, empresa_id, organizacion_id, rol_id) values
  ('f1000000-0000-0000-0000-000000000002', 'a1000000-0000-0000-0000-00000000000a', '11111111-1111-1111-1111-111111111111', 'operador'),
  ('f1000000-0000-0000-0000-000000000002', 'a1000000-0000-0000-0000-00000000000b', '11111111-1111-1111-1111-111111111111', 'deposito');
update public.permisos_rol set nivel = 'ninguno'
 where organizacion_id = '11111111-1111-1111-1111-111111111111' and rol_id = 'deposito' and seccion = 'ventas';

insert into dominio.clientes (id, organizacion_id, numero, nombre, tipo) values
  ('c5000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 10, 'Cliente', 'minorista');
insert into dominio.productos (id, organizacion_id, nombre, sku, moneda, precio_lista) values
  ('b1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'Joystick', 'JOY-1', 'ARS', 1000);
insert into dominio.comprobantes_venta (id, organizacion_id, cliente_id, empresa_id, tipo, numero, fecha, estado, total_sin_iva, total_con_iva) values
  ('e1000000-0000-0000-0000-00000000000a', '11111111-1111-1111-1111-111111111111', 'c5000000-0000-0000-0000-000000000001', 'a1000000-0000-0000-0000-00000000000a', 'factura', 'A-1', current_date - 1, 'confirmado', 100, 100),
  ('e1000000-0000-0000-0000-00000000000b', '11111111-1111-1111-1111-111111111111', 'c5000000-0000-0000-0000-000000000001', 'a1000000-0000-0000-0000-00000000000b', 'factura', 'B-1', current_date - 1, 'confirmado', 100, 100),
  ('e1000000-0000-0000-0000-00000000000c', '11111111-1111-1111-1111-111111111111', 'c5000000-0000-0000-0000-000000000001', null, 'factura', 'S-1', current_date - 1, 'confirmado', 100, 100);
insert into dominio.comprobantes_venta_lineas (id, organizacion_id, comprobante_id, orden, producto_id, descripcion, cantidad, precio_unitario, escala, deposito_id, subtotal_sin_iva, iva)
select x.id, '11111111-1111-1111-1111-111111111111', x.comprobante_id, 1,
       'b1000000-0000-0000-0000-000000000001', 'Joystick', 1, 100, 'x1',
       (select d.id from dominio.depositos d where d.organizacion_id = '11111111-1111-1111-1111-111111111111' and d.por_defecto),
       100, 0
from (values
  ('1a000000-0000-0000-0000-00000000000a'::uuid, 'e1000000-0000-0000-0000-00000000000a'::uuid),
  ('1a000000-0000-0000-0000-00000000000b'::uuid, 'e1000000-0000-0000-0000-00000000000b'::uuid)
) x(id, comprobante_id);
insert into dominio.rma (id, organizacion_id, empresa_id, comprobante_id, numero, forma_rma, motivo) values
  ('f9000000-0000-0000-0000-00000000000a', '11111111-1111-1111-1111-111111111111', 'a1000000-0000-0000-0000-00000000000a', 'e1000000-0000-0000-0000-00000000000a', 'RMA-0001', 'cambio_directo', 'Falla'),
  ('f9000000-0000-0000-0000-00000000000b', '11111111-1111-1111-1111-111111111111', 'a1000000-0000-0000-0000-00000000000b', 'e1000000-0000-0000-0000-00000000000b', 'RMA-0002', 'cambio_directo', 'Falla');
insert into dominio.rma_items (organizacion_id, rma_id, comprobante_linea_id, producto_id, cantidad) values
  ('11111111-1111-1111-1111-111111111111', 'f9000000-0000-0000-0000-00000000000a', '1a000000-0000-0000-0000-00000000000a', 'b1000000-0000-0000-0000-000000000001', 1),
  ('11111111-1111-1111-1111-111111111111', 'f9000000-0000-0000-0000-00000000000b', '1a000000-0000-0000-0000-00000000000b', 'b1000000-0000-0000-0000-000000000001', 1);

create function pg_temp.como(p_user uuid) returns void language plpgsql as $$
begin
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
  set local role authenticated;
end $$;

-- Persona con Ventas en A y sin Ventas en B (ambas empresas son accesibles).
select pg_temp.como('f1000000-0000-0000-0000-000000000002');
select is((select count(*)::int from dominio.comprobantes_venta where empresa_id = 'a1000000-0000-0000-0000-00000000000a'), 1, 've el comprobante de A');
select is((select count(*)::int from dominio.comprobantes_venta where empresa_id = 'a1000000-0000-0000-0000-00000000000b'), 0, 'no ve el comprobante de B (sin Ventas en B)');
select is((select count(*)::int from dominio.comprobantes_venta where empresa_id is null), 1, 'el comprobante heredado sin empresa sigue la regla de la organización');
select is((select count(*)::int from dominio.comprobantes_venta_lineas), 1, 've solo las líneas de A (el heredado no tiene líneas)');
select is((select count(*)::int from dominio.rma where empresa_id = 'a1000000-0000-0000-0000-00000000000a'), 1, 've el RMA de A');
select is((select count(*)::int from dominio.rma where empresa_id = 'a1000000-0000-0000-0000-00000000000b'), 0, 'no ve el RMA de B');
select is((select count(*)::int from dominio.rma_items), 1, 've solo los ítems de RMA de A');

-- Administrador: todas las tiendas.
select pg_temp.como('f1000000-0000-0000-0000-000000000001');
select is((select count(*)::int from dominio.comprobantes_venta), 3, 'administrador: ve los tres comprobantes');
select is((select count(*)::int from dominio.rma), 2, 'administrador: ve los RMA de ambas tiendas');

-- Superadmin: sin contexto de organización no ve nada; con contexto vigente ve todas las tiendas de esa organización.
select pg_temp.como('f1000000-0000-0000-0000-000000000003');
select is((select count(*)::int from dominio.comprobantes_venta), 0, 'superadmin sin contexto: no ve comprobantes');
select is((select count(*)::int from dominio.rma), 0, 'superadmin sin contexto: no ve RMA');
reset role;
insert into superadmin_organizacion_activa (user_id, organizacion_id)
values ('f1000000-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111');
select pg_temp.como('f1000000-0000-0000-0000-000000000003');
select is((select count(*)::int from dominio.comprobantes_venta), 3, 'superadmin con contexto: ve los tres comprobantes');
select is((select count(*)::int from dominio.comprobantes_venta_lineas), 2, 'superadmin con contexto: ve las líneas de ambas tiendas');
select is((select count(*)::int from dominio.rma), 2, 'superadmin con contexto: ve los RMA de ambas tiendas');
select is((select count(*)::int from dominio.rma_items), 2, 'superadmin con contexto: ve los ítems de RMA de ambas tiendas');

-- Conjunto de empresas con Ventas que evalúan las políticas (una vez por consulta, no por fila).
select pg_temp.como('f1000000-0000-0000-0000-000000000002');
select is((select array_agg(x order by x) from private.empresas_con_ventas_lectura() x), array['a1000000-0000-0000-0000-00000000000a'::uuid], 'el conjunto trae solo la empresa con Ventas');

-- Superficie de la función nueva.
reset role;
select ok(not has_function_privilege('anon', 'private.puede_leer_ventas_empresa(uuid)', 'execute'), 'anon no ejecuta puede_leer_ventas_empresa');
select ok(has_function_privilege('authenticated', 'private.puede_leer_ventas_empresa(uuid)', 'execute'), 'authenticated la ejecuta (las políticas la evalúan con su rol)');
select ok(not has_function_privilege('anon', 'private.empresas_con_ventas_lectura()', 'execute'), 'anon no ejecuta empresas_con_ventas_lectura');
select is((select count(*)::int from pg_policies where schemaname = 'dominio' and tablename in ('comprobantes_venta','comprobantes_venta_lineas','rma','rma_items')
  and policyname like '%\_select' and qual like '%empresas_con_ventas_lectura%' and qual not like '%puede_leer_ventas_empresa%'), 4,
  'las cuatro políticas usan el conjunto de empresas con Ventas (subconsulta no correlacionada, una vez por consulta)');

select * from finish();
rollback;
