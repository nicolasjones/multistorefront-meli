-- F-PRV-04 (MSF-383, épica MSF-219): registrar un ingreso de mercadería por proveedor.
-- Cubre stock atómico por línea, costo con permiso de Rentabilidad, idempotencia,
-- aislamiento entre organizaciones, rechazos sin rastro y `anon` sin acceso.
begin;

select plan(37);

insert into organizaciones (id, nombre) values
  ('11111111-1111-1111-1111-111111111111', 'Organización Uno'),
  ('22222222-2222-2222-2222-222222222222', 'Organización Dos');

insert into auth.users (id, email) values
  ('d1000000-0000-0000-0000-000000000001', 'administrador@example.com'),
  ('d1000000-0000-0000-0000-000000000002', 'operador@example.com'),
  ('d1000000-0000-0000-0000-000000000003', 'consulta@example.com'),
  ('d2000000-0000-0000-0000-000000000001', 'admin-dos@example.com');

insert into usuarios_organizacion (user_id, organizacion_id, rol_id) values
  ('d1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'administrador'),
  ('d1000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'operador'),
  ('d1000000-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111', 'consulta'),
  ('d2000000-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', 'administrador');

insert into dominio.empresas (id, organizacion_id, nombre, activa) values
  ('e1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'Tienda Uno', true),
  ('e1000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'Tienda Inactiva', false),
  ('e2000000-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', 'Tienda Dos', true);

insert into public.usuarios_empresas (user_id, empresa_id, organizacion_id, rol_id) values
  ('d1000000-0000-0000-0000-000000000002', 'e1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'operador'),
  ('d1000000-0000-0000-0000-000000000003', 'e1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'consulta');

insert into dominio.proveedores (id, organizacion_id, razon_social, cuit, activo) values
  ('f1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'Proveedor Uno', '20123456786', true),
  ('f1000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'Proveedor Inactivo', '30701234568', false),
  ('f2000000-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', 'Proveedor Dos', '33555555550', true);

insert into dominio.productos (id, organizacion_id, nombre, sku, precio_lista) values
  ('a1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'Producto Uno', 'P-1', 50),
  ('a1000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'Producto Dos', 'P-2', 40),
  ('a1000000-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111', 'Producto Inactivo', 'P-3', 30),
  ('a2000000-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', 'Producto Dos Org', 'P-2O', 20);

update dominio.productos set activo = false where id = 'a1000000-0000-0000-0000-000000000003';

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

-- ============================================================================
-- Operador: ingreso de dos líneas, sin permiso de costo
-- ============================================================================

select pg_temp.como('d1000000-0000-0000-0000-000000000002');

select lives_ok(
  $$select public.registrar_ingreso_mercaderia(
      'e1000000-0000-0000-0000-000000000001',
      'f1000000-0000-0000-0000-000000000001',
      current_date,
      '  R-0001  ',
      jsonb_build_array(
        jsonb_build_object('producto_id', 'a1000000-0000-0000-0000-000000000001', 'cantidad', 5, 'costo_unitario_usd', 10.50),
        jsonb_build_object('producto_id', 'a1000000-0000-0000-0000-000000000002', 'cantidad', 3, 'costo_unitario_usd', 4)
      ),
      false,
      '99999999-9999-4999-8999-999999999999'
    )$$,
  'operador: registra un ingreso de dos líneas'
);
select is(
  (select cantidad from dominio.existencias where producto_id = 'a1000000-0000-0000-0000-000000000001'),
  5, 'el stock del primer producto sube a 5'
);
select is(
  (select cantidad from dominio.existencias where producto_id = 'a1000000-0000-0000-0000-000000000002'),
  3, 'el stock del segundo producto sube a 3'
);
select is(
  (select count(*)::int from dominio.ingresos_mercaderia_lineas),
  2, 'quedan dos líneas'
);
select is(
  (select count(*)::int from dominio.movimientos_stock where tipo = 'entrada'),
  2, 'quedan dos movimientos de entrada'
);
select is(
  (select distinct nota from dominio.movimientos_stock),
  'Ingreso de mercadería · comprobante R-0001', 'la nota del movimiento lleva el comprobante recortado'
);
select is(
  (select estado from dominio.ingresos_mercaderia),
  'registrado', 'el ingreso queda registrado'
);
select is(
  (select actor_nombre from dominio.ingresos_mercaderia),
  'operador@example.com', 'el actor sale de la sesión'
);
select is(
  (select count(*)::int from dominio.producto_costos),
  0, 'sin la opción, el costo no se toca'
);
select is(
  (select count(*)::int from public.registro_actividad where tipo = 'ingreso.registrado'),
  1, 'se registra ingreso.registrado'
);

-- Idempotencia: la misma clave no vuelve a mover stock.
select lives_ok(
  $$select public.registrar_ingreso_mercaderia(
      'e1000000-0000-0000-0000-000000000001',
      'f1000000-0000-0000-0000-000000000001',
      current_date,
      'R-0001',
      jsonb_build_array(
        jsonb_build_object('producto_id', 'a1000000-0000-0000-0000-000000000001', 'cantidad', 5, 'costo_unitario_usd', 10.50)
      ),
      false,
      '99999999-9999-4999-8999-999999999999'
    )$$,
  'reintentar con la misma clave no falla'
);
select is(
  (select count(*)::int from dominio.ingresos_mercaderia),
  1, 'el reintento no crea otro ingreso'
);
select is(
  (select cantidad from dominio.existencias where producto_id = 'a1000000-0000-0000-0000-000000000001'),
  5, 'el reintento no vuelve a mover el stock'
);
select is(
  (select id from public.registrar_ingreso_mercaderia(
      'e1000000-0000-0000-0000-000000000001',
      'f1000000-0000-0000-0000-000000000001',
      current_date,
      'R-0001',
      jsonb_build_array(jsonb_build_object('producto_id', 'a1000000-0000-0000-0000-000000000001', 'cantidad', 5, 'costo_unitario_usd', 10.50)),
      false,
      '99999999-9999-4999-8999-999999999999'
    )),
  (select id from dominio.ingresos_mercaderia limit 1),
  'el reintento devuelve el mismo ingreso'
);

-- ============================================================================
-- Administrador: actualiza el costo (tiene Stock y Rentabilidad en edición)
-- ============================================================================

select pg_temp.como('d1000000-0000-0000-0000-000000000001');

select lives_ok(
  $$select public.registrar_ingreso_mercaderia(
      'e1000000-0000-0000-0000-000000000001',
      'f1000000-0000-0000-0000-000000000001',
      current_date,
      null,
      jsonb_build_array(
        jsonb_build_object('producto_id', 'a1000000-0000-0000-0000-000000000001', 'cantidad', 2, 'costo_unitario_usd', 12.75),
        jsonb_build_object('producto_id', 'a1000000-0000-0000-0000-000000000002', 'cantidad', 1, 'costo_unitario_usd', 8.40)
      ),
      true,
      '88888888-8888-4888-8888-888888888888'
    )$$,
  'administrador: registra y actualiza el costo'
);
select is(
  (select costo from dominio.producto_costos where producto_id = 'a1000000-0000-0000-0000-000000000001'),
  12.75::numeric, 'el costo del primer producto queda en 12,75'
);
select is(
  (select costo from dominio.producto_costos where producto_id = 'a1000000-0000-0000-0000-000000000002'),
  8.40::numeric, 'el costo del segundo producto queda en 8,40'
);

-- ============================================================================
-- Rechazos: ninguno deja rastro
-- ============================================================================

select pg_temp.como('d1000000-0000-0000-0000-000000000002');

select throws_ok(
  $$select public.registrar_ingreso_mercaderia(
      'e1000000-0000-0000-0000-000000000001', 'f1000000-0000-0000-0000-000000000001', current_date, null,
      jsonb_build_array(jsonb_build_object('producto_id', 'a1000000-0000-0000-0000-000000000001', 'cantidad', 1, 'costo_unitario_usd', 1)),
      true, null
    )$$,
  '42501', null, 'operador: no puede actualizar el costo'
);
select is(
  (select count(*)::int from dominio.ingresos_mercaderia),
  2, 'el rechazo por costo no deja ingreso'
);

select throws_ok(
  $$select public.registrar_ingreso_mercaderia(
      'e1000000-0000-0000-0000-000000000001', 'f1000000-0000-0000-0000-000000000001', current_date + 1, null,
      jsonb_build_array(jsonb_build_object('producto_id', 'a1000000-0000-0000-0000-000000000001', 'cantidad', 1, 'costo_unitario_usd', 1)),
      false, null
    )$$,
  '22023', null, 'rechaza una fecha futura'
);
select throws_ok(
  $$select public.registrar_ingreso_mercaderia(
      'e1000000-0000-0000-0000-000000000001', 'f1000000-0000-0000-0000-000000000001', current_date, null,
      jsonb_build_array(
        jsonb_build_object('producto_id', 'a1000000-0000-0000-0000-000000000001', 'cantidad', 1, 'costo_unitario_usd', 1),
        jsonb_build_object('producto_id', 'a1000000-0000-0000-0000-000000000001', 'cantidad', 2, 'costo_unitario_usd', 2)
      ),
      false, null
    )$$,
  '22023', null, 'rechaza el mismo producto repetido'
);
select throws_ok(
  $$select public.registrar_ingreso_mercaderia(
      'e1000000-0000-0000-0000-000000000001', 'f1000000-0000-0000-0000-000000000001', current_date, null,
      jsonb_build_array(jsonb_build_object('producto_id', 'a1000000-0000-0000-0000-000000000001', 'cantidad', 0, 'costo_unitario_usd', 1)),
      false, null
    )$$,
  '22023', null, 'rechaza cantidad 0'
);
select throws_ok(
  $$select public.registrar_ingreso_mercaderia(
      'e1000000-0000-0000-0000-000000000001', 'f1000000-0000-0000-0000-000000000001', current_date, null,
      jsonb_build_array(jsonb_build_object('producto_id', 'a1000000-0000-0000-0000-000000000001', 'cantidad', 1, 'costo_unitario_usd', 1.234)),
      false, null
    )$$,
  '22023', null, 'rechaza costo con tres decimales'
);
select throws_ok(
  $$select public.registrar_ingreso_mercaderia(
      'e1000000-0000-0000-0000-000000000001', 'f1000000-0000-0000-0000-000000000001', current_date, null,
      jsonb_build_array(jsonb_build_object('producto_id', 'a1000000-0000-0000-0000-000000000003', 'cantidad', 1, 'costo_unitario_usd', 1)),
      false, null
    )$$,
  '22023', null, 'rechaza un producto inactivo'
);
select throws_ok(
  $$select public.registrar_ingreso_mercaderia(
      'e1000000-0000-0000-0000-000000000001', 'f1000000-0000-0000-0000-000000000002', current_date, null,
      jsonb_build_array(jsonb_build_object('producto_id', 'a1000000-0000-0000-0000-000000000001', 'cantidad', 1, 'costo_unitario_usd', 1)),
      false, null
    )$$,
  '22023', null, 'rechaza un proveedor inactivo'
);
select throws_ok(
  $$select public.registrar_ingreso_mercaderia(
      'e1000000-0000-0000-0000-000000000001', 'f2000000-0000-0000-0000-000000000001', current_date, null,
      jsonb_build_array(jsonb_build_object('producto_id', 'a1000000-0000-0000-0000-000000000001', 'cantidad', 1, 'costo_unitario_usd', 1)),
      false, null
    )$$,
  '22023', null, 'rechaza un proveedor de otra organización'
);
select throws_ok(
  $$select public.registrar_ingreso_mercaderia(
      'e2000000-0000-0000-0000-000000000001', 'f1000000-0000-0000-0000-000000000001', current_date, null,
      jsonb_build_array(jsonb_build_object('producto_id', 'a1000000-0000-0000-0000-000000000001', 'cantidad', 1, 'costo_unitario_usd', 1)),
      false, null
    )$$,
  '22023', null, 'rechaza una empresa de otra organización'
);
select throws_ok(
  $$select public.registrar_ingreso_mercaderia(
      'e1000000-0000-0000-0000-000000000001', 'f1000000-0000-0000-0000-000000000001', current_date, null,
      jsonb_build_array(jsonb_build_object('producto_id', 'a2000000-0000-0000-0000-000000000001', 'cantidad', 1, 'costo_unitario_usd', 1)),
      false, null
    )$$,
  '22023', null, 'rechaza un producto de otra organización'
);

-- Atomicidad: la segunda línea inválida revierte la primera.
select is(
  (select count(*)::int from dominio.ingresos_mercaderia),
  2, 'antes del intento atómico hay dos ingresos'
);
select throws_ok(
  $$select public.registrar_ingreso_mercaderia(
      'e1000000-0000-0000-0000-000000000001', 'f1000000-0000-0000-0000-000000000001', current_date, null,
      jsonb_build_array(
        jsonb_build_object('producto_id', 'a1000000-0000-0000-0000-000000000001', 'cantidad', 1, 'costo_unitario_usd', 1),
        jsonb_build_object('producto_id', 'a1000000-0000-0000-0000-000000000001', 'cantidad', 0, 'costo_unitario_usd', 1)
      ),
      false, null
    )$$,
  '22023', null, 'la línea inválida revierte todo'
);
select is(
  (select count(*)::int from dominio.ingresos_mercaderia),
  2, 'la atomicidad no deja cabecera'
);
select is(
  (select cantidad from dominio.existencias where producto_id = 'a1000000-0000-0000-0000-000000000001'),
  7, 'la atomicidad no deja stock de la primera línea'
);

-- ============================================================================
-- Permisos y aislamiento
-- ============================================================================

reset role;
select pg_temp.como('d1000000-0000-0000-0000-000000000003');
select throws_ok(
  $$select public.registrar_ingreso_mercaderia(
      'e1000000-0000-0000-0000-000000000001', 'f1000000-0000-0000-0000-000000000001', current_date, null,
      jsonb_build_array(jsonb_build_object('producto_id', 'a1000000-0000-0000-0000-000000000001', 'cantidad', 1, 'costo_unitario_usd', 1)),
      false, null
    )$$,
  '42501', null, 'consulta: no puede registrar'
);

reset role;
select pg_temp.como('d1000000-0000-0000-0000-000000000002');
select throws_ok(
  $$insert into dominio.ingresos_mercaderia (empresa_id, proveedor_id, fecha)
     values ('e1000000-0000-0000-0000-000000000001', 'f1000000-0000-0000-0000-000000000001', current_date)$$,
  '42501', null, 'authenticated no puede escribir la cabecera directo'
);
select throws_ok(
  $$insert into dominio.ingresos_mercaderia_lineas (ingreso_id, organizacion_id, producto_id, cantidad, costo_unitario_usd, movimiento_id)
     select id, organizacion_id, 'a1000000-0000-0000-0000-000000000001', 1, 1, gen_random_uuid() from dominio.ingresos_mercaderia limit 1$$,
  '42501', null, 'authenticated no puede escribir las líneas directo'
);

reset role;
select pg_temp.como_anon();
select throws_ok(
  $$select count(*) from dominio.ingresos_mercaderia$$,
  '42501', null, 'anon no lee la cabecera'
);
select throws_ok(
  $$select public.registrar_ingreso_mercaderia(
      'e1000000-0000-0000-0000-000000000001', 'f1000000-0000-0000-0000-000000000001', current_date, null,
      jsonb_build_array(jsonb_build_object('producto_id', 'a1000000-0000-0000-0000-000000000001', 'cantidad', 1, 'costo_unitario_usd', 1)),
      false, null
    )$$,
  '42501', null, 'anon no ejecuta la RPC'
);

reset role;

select * from finish();
rollback;
