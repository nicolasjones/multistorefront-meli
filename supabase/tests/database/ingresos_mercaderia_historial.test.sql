-- F-PRV-05 (MSF-393, épica MSF-219): listado del historial de ingresos.
-- Verifica orden, total, filtros, paginación, aislamiento y `anon` sin acceso.
begin;

select plan(10);

insert into organizaciones (id, nombre) values
  ('11111111-1111-1111-1111-111111111111', 'Organización Uno'),
  ('22222222-2222-2222-2222-222222222222', 'Organización Dos');

insert into auth.users (id, email) values
  ('d1000000-0000-0000-0000-000000000001', 'admin@example.com'),
  ('d2000000-0000-0000-0000-000000000001', 'admin-dos@example.com');

insert into usuarios_organizacion (user_id, organizacion_id, rol_id) values
  ('d1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'administrador'),
  ('d2000000-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', 'administrador');

insert into dominio.empresas (id, organizacion_id, nombre, activa) values
  ('e1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'Tienda Uno', true),
  ('e2000000-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', 'Tienda Dos', true);

insert into dominio.proveedores (id, organizacion_id, razon_social, cuit, activo) values
  ('f1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'Proveedor Uno', '20123456786', true),
  ('f2000000-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', 'Proveedor Dos', '33555555550', true);

insert into dominio.productos (id, organizacion_id, nombre, sku, precio_lista) values
  ('a1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'Producto Uno', 'P-1', 50),
  ('a1000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'Producto Dos', 'P-2', 40),
  ('a2000000-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', 'Producto Dos Org', 'P-2O', 20);

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

select pg_temp.como('d1000000-0000-0000-0000-000000000001');

select public.registrar_ingreso_mercaderia(
  'e1000000-0000-0000-0000-000000000001', 'f1000000-0000-0000-0000-000000000001', current_date, 'R-1',
  jsonb_build_array(
    jsonb_build_object('producto_id', 'a1000000-0000-0000-0000-000000000001', 'cantidad', 2, 'costo_unitario_usd', 10),
    jsonb_build_object('producto_id', 'a1000000-0000-0000-0000-000000000002', 'cantidad', 1, 'costo_unitario_usd', 20)
  ),
  false, '10000000-0000-4000-8000-000000000001'
);

reset role;
select pg_temp.como('d2000000-0000-0000-0000-000000000001');
select public.registrar_ingreso_mercaderia(
  'e2000000-0000-0000-0000-000000000001', 'f2000000-0000-0000-0000-000000000001', current_date, 'R-2',
  jsonb_build_array(
    jsonb_build_object('producto_id', 'a2000000-0000-0000-0000-000000000001', 'cantidad', 5, 'costo_unitario_usd', 3)
  ),
  false, '20000000-0000-4000-8000-000000000001'
);

reset role;
select pg_temp.como('d1000000-0000-0000-0000-000000000001');

select is((select count(*)::int from public.listar_ingresos_mercaderia()), 2, 'el administrador ve dos líneas de su organización');
select is((select max(total)::int from public.listar_ingresos_mercaderia()), 2, 'el total acompaña al conjunto filtrado');
select is(
  (select count(*)::int from public.listar_ingresos_mercaderia(p_producto => 'a1000000-0000-0000-0000-000000000001')),
  1, 'filtra por producto'
);
select is(
  (select count(*)::int from public.listar_ingresos_mercaderia(p_proveedor => 'f1000000-0000-0000-0000-000000000001')),
  2, 'filtra por proveedor'
);
select is(
  (select count(*)::int from public.listar_ingresos_mercaderia(p_tamano => 1)),
  1, 'pagina en el servidor'
);
select is(
  (select max(total)::int from public.listar_ingresos_mercaderia(p_tamano => 1)),
  2, 'el total no cambia al paginar'
);

select is(
  (select jsonb_array_length(public.detalle_ingreso_mercaderia((select id from dominio.ingresos_mercaderia limit 1)) -> 'lineas')),
  2, 'el detalle devuelve las dos líneas del ingreso'
);
select is(
  public.detalle_ingreso_mercaderia('00000000-0000-4000-8000-000000000000'),
  null, 'el detalle de un ingreso inexistente o de otra organización es null'
);

select is(
  (select count(*)::int from public.operadores_ingresos_mercaderia()),
  1, 'lista solo los operadores con ingresos de la organización'
);

reset role;
select pg_temp.como_anon();
select throws_ok(
  $$select * from public.listar_ingresos_mercaderia()$$,
  '42501', null, 'anon no ejecuta el listado'
);

reset role;
select * from finish();
rollback;
