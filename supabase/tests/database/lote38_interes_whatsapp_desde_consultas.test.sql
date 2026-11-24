-- Lote 38: «Interés por WhatsApp» y «Productos más consultados» leen las consultas de origen WhatsApp (dominio.consultas).
-- Cubre: la vista agrega por empresa y producto solo consultas whatsapp con producto (no formulario ni pedido), no lee la
-- tabla intereses_whatsapp, aislamiento entre organizaciones y empresas, rol sin la sección consultas, anon, y el conteo
-- de reportes (rol con y sin la sección reportes).
begin;

select plan(13);

insert into organizaciones (id, nombre) values
  ('11111111-1111-1111-1111-111111111111', 'Organización Uno'),
  ('22222222-2222-2222-2222-222222222222', 'Organización Dos');
insert into auth.users (id, email) values
  ('d1000000-0000-0000-0000-000000000011', 'admin-uno@example.com'),
  ('d1000000-0000-0000-0000-000000000014', 'deposito-uno@example.com'),
  ('d2000000-0000-0000-0000-000000000011', 'admin-dos@example.com');
insert into usuarios_organizacion (user_id, organizacion_id, rol_id) values
  ('d1000000-0000-0000-0000-000000000011', '11111111-1111-1111-1111-111111111111', 'administrador'),
  ('d1000000-0000-0000-0000-000000000014', '11111111-1111-1111-1111-111111111111', 'deposito'),
  ('d2000000-0000-0000-0000-000000000011', '22222222-2222-2222-2222-222222222222', 'administrador');
insert into dominio.empresas (id, organizacion_id, nombre) values
  ('e1000000-0000-0000-0000-00000000000a', '11111111-1111-1111-1111-111111111111', 'Tienda A'),
  ('e2000000-0000-0000-0000-00000000000d', '22222222-2222-2222-2222-222222222222', 'Tienda D');
insert into dominio.productos (id, organizacion_id, nombre, sku, precio_lista) values
  ('a1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'Alfa', 'PC-1', 100),
  ('b2000000-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', 'Dos', 'PD-1', 100);
insert into usuarios_empresas (user_id, empresa_id, organizacion_id, rol_id) values
  ('d1000000-0000-0000-0000-000000000014', 'e1000000-0000-0000-0000-00000000000a', '11111111-1111-1111-1111-111111111111', 'deposito');
insert into usuario_empresa_activa (user_id, empresa_id) values
  ('d1000000-0000-0000-0000-000000000014', 'e1000000-0000-0000-0000-00000000000a');

-- Org Uno / Tienda A / Alfa: 2 consultas WhatsApp (cuentan), 1 formulario y 1 pedido con el mismo producto (no cuentan),
-- 1 WhatsApp sin producto (no cuenta). Org Dos: 3 WhatsApp. La tabla vieja recibe 9 filas que NO deben contarse.
insert into dominio.consultas (organizacion_id, empresa_id, origen, nombre, contacto, mensaje, producto_id) values
  ('11111111-1111-1111-1111-111111111111', 'e1000000-0000-0000-0000-00000000000a', 'whatsapp', 'Visitante de WhatsApp', 'visitante@sin-datos.invalid', null, 'a1000000-0000-0000-0000-000000000001'),
  ('11111111-1111-1111-1111-111111111111', 'e1000000-0000-0000-0000-00000000000a', 'whatsapp', 'Visitante de WhatsApp', 'visitante@sin-datos.invalid', null, 'a1000000-0000-0000-0000-000000000001'),
  ('11111111-1111-1111-1111-111111111111', 'e1000000-0000-0000-0000-00000000000a', 'formulario', 'Ana', 'ana@example.com', 'Hola', 'a1000000-0000-0000-0000-000000000001'),
  ('11111111-1111-1111-1111-111111111111', 'e1000000-0000-0000-0000-00000000000a', 'pedido', 'Bruno', 'bruno@example.com', null, 'a1000000-0000-0000-0000-000000000001'),
  ('11111111-1111-1111-1111-111111111111', 'e1000000-0000-0000-0000-00000000000a', 'whatsapp', 'Visitante de WhatsApp', 'visitante@sin-datos.invalid', null, null),
  ('22222222-2222-2222-2222-222222222222', 'e2000000-0000-0000-0000-00000000000d', 'whatsapp', 'Visitante de WhatsApp', 'visitante@sin-datos.invalid', null, 'b2000000-0000-0000-0000-000000000001'),
  ('22222222-2222-2222-2222-222222222222', 'e2000000-0000-0000-0000-00000000000d', 'whatsapp', 'Visitante de WhatsApp', 'visitante@sin-datos.invalid', null, 'b2000000-0000-0000-0000-000000000001'),
  ('22222222-2222-2222-2222-222222222222', 'e2000000-0000-0000-0000-00000000000d', 'whatsapp', 'Visitante de WhatsApp', 'visitante@sin-datos.invalid', null, 'b2000000-0000-0000-0000-000000000001');
insert into dominio.intereses_whatsapp (organizacion_id, empresa_id, producto_id)
select '11111111-1111-1111-1111-111111111111', 'e1000000-0000-0000-0000-00000000000a', 'a1000000-0000-0000-0000-000000000001'
  from generate_series(1, 9);

create function pg_temp.como(p_user uuid) returns void language plpgsql as $$
begin
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
  set local role authenticated;
end $$;

select pg_temp.como('d1000000-0000-0000-0000-000000000011');
select is(
  (select total from public.interes_whatsapp_por_producto
    where empresa_id = 'e1000000-0000-0000-0000-00000000000a' and producto_id = 'a1000000-0000-0000-0000-000000000001'),
  2::bigint, 'la vista cuenta solo consultas WhatsApp con producto (no formulario, pedido, sin producto ni la tabla vieja)');
select is(
  (select count(*)::int from public.interes_whatsapp_por_producto), 1, 'una fila por empresa y producto para la Uno');
select is(
  (select count(*)::int from public.interes_whatsapp_por_producto where organizacion_id = '22222222-2222-2222-2222-222222222222'),
  0, 'la Uno no ve nada de la Dos');

select pg_temp.como('d2000000-0000-0000-0000-000000000011');
select is(
  (select total from public.interes_whatsapp_por_producto), 3::bigint, 'la Dos ve solo lo suyo: 3');
select is(
  (select count(*)::int from public.interes_whatsapp_por_producto where organizacion_id = '11111111-1111-1111-1111-111111111111'),
  0, 'la Dos no ve nada de la Uno');

-- Rol sin la sección consultas: no ve nada.
select pg_temp.como('d1000000-0000-0000-0000-000000000014');
select is((select count(*)::int from public.interes_whatsapp_por_producto), 0, 'un rol sin la sección consultas no ve el interés');

-- Conteo de reportes: administrador (tiene reportes) cuenta las de su organización; el rol sin reportes recibe 42501.
select pg_temp.como('d1000000-0000-0000-0000-000000000011');
select is(
  public.consultas_reportes_conteo(current_date - 1, current_date + 1), 2,
  'el conteo de reportes cuenta consultas WhatsApp con producto de la organización');
select is(
  public.consultas_reportes_conteo(current_date - 1, current_date + 1, 'e2000000-0000-0000-0000-00000000000d'), 0,
  'pedir la empresa de otra organización no amplía el alcance');
select pg_temp.como('d1000000-0000-0000-0000-000000000014');
select throws_ok(
  $$select public.consultas_reportes_conteo(current_date - 1, current_date + 1)$$,
  '42501', 'Tu rol no puede ver los reportes de ventas', 'un rol sin la sección reportes no cuenta');

-- anon.
reset role;
select is(has_table_privilege('anon', 'public.interes_whatsapp_por_producto', 'select'), false, 'anon sin SELECT en la vista');
select is(has_function_privilege('anon', 'public.consultas_reportes_conteo(date,date,uuid)', 'execute'), false, 'anon no ejecuta el conteo');
select is(has_table_privilege('authenticated', 'analitica.consultas_producto_mas_consultado', 'select'), false, 'authenticated no lee la vista de Superset');
select is(
  (select sum(consultas)::int from analitica.consultas_producto_mas_consultado where organizacion_id = '11111111-1111-1111-1111-111111111111'),
  2, 'la vista de Superset cuenta las mismas 2 consultas');

select * from finish();
rollback;
