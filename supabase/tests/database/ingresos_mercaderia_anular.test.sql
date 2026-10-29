-- F-PRV-06 (MSF-404, épica MSF-219): anular un ingreso de mercadería.
-- Verifica reversión atómica del stock, motivo, doble anulación, stock insuficiente,
-- permisos y aislamiento.
begin;

select plan(23);

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
  ('e2000000-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', 'Tienda Dos', true);

insert into public.usuarios_empresas (user_id, empresa_id, organizacion_id, rol_id) values
  ('d1000000-0000-0000-0000-000000000002', 'e1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'operador'),
  ('d1000000-0000-0000-0000-000000000003', 'e1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'consulta');

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

-- ============================================================================
-- Anulación completa
-- ============================================================================

select pg_temp.como('d1000000-0000-0000-0000-000000000001');

select public.registrar_ingreso_mercaderia(
  'e1000000-0000-0000-0000-000000000001', 'f1000000-0000-0000-0000-000000000001', current_date, 'R-1',
  jsonb_build_array(
    jsonb_build_object('producto_id', 'a1000000-0000-0000-0000-000000000001', 'cantidad', 5, 'costo_unitario_usd', 10),
    jsonb_build_object('producto_id', 'a1000000-0000-0000-0000-000000000002', 'cantidad', 3, 'costo_unitario_usd', 4)
  ),
  false, '10000000-0000-4000-8000-000000000001'
);

select is((select cantidad from dominio.existencias where producto_id = 'a1000000-0000-0000-0000-000000000001'), 5, 'stock inicial del primer producto');
select is((select cantidad from dominio.existencias where producto_id = 'a1000000-0000-0000-0000-000000000002'), 3, 'stock inicial del segundo producto');

reset role;
select pg_temp.como('d1000000-0000-0000-0000-000000000002');

select lives_ok(
  $$select public.anular_ingreso_mercaderia(
      (select id from dominio.ingresos_mercaderia limit 1),
      '  Carga equivocada  '
    )$$,
  'operador: anula el ingreso con motivo'
);
select is((select estado from dominio.ingresos_mercaderia limit 1), 'anulado', 'la cabecera queda anulada');
select is((select motivo_anulacion from dominio.ingresos_mercaderia limit 1), 'Carga equivocada', 'el motivo se guarda recortado');
select is((select anulado_por from dominio.ingresos_mercaderia limit 1), 'd1000000-0000-0000-0000-000000000002', 'queda el actor de la anulación');
select is((select count(*)::int from dominio.ingresos_mercaderia_lineas where movimiento_anulacion_id is not null), 2, 'las dos líneas quedan vinculadas a su salida');
select is((select count(*)::int from dominio.movimientos_stock where tipo = 'salida'), 2, 'quedan dos movimientos de salida');
select is(
  (select count(*)::int from dominio.movimientos_stock m
    join dominio.motivos_movimiento mo on mo.id = m.motivo_id
   where m.tipo = 'salida' and lower(btrim(mo.nombre)) = 'anulación de ingreso de mercadería'),
  2, 'las salidas usan el motivo de anulación'
);
select is((select cantidad from dominio.existencias where producto_id = 'a1000000-0000-0000-0000-000000000001'), 0, 'el stock del primer producto vuelve a 0');
select is((select cantidad from dominio.existencias where producto_id = 'a1000000-0000-0000-0000-000000000002'), 0, 'el stock del segundo producto vuelve a 0');
select is((select count(*)::int from public.registro_actividad where tipo = 'ingreso.anulado'), 1, 'se registra ingreso.anulado');

select throws_ok(
  $$select public.anular_ingreso_mercaderia((select id from dominio.ingresos_mercaderia limit 1), 'Otra vez')$$,
  '22023', null, 'no se puede anular dos veces'
);
select is((select count(*)::int from dominio.movimientos_stock where tipo = 'salida'), 2, 'la segunda anulación no crea salidas');

-- ============================================================================
-- Motivo inválido y stock insuficiente
-- ============================================================================

select public.registrar_ingreso_mercaderia(
  'e1000000-0000-0000-0000-000000000001', 'f1000000-0000-0000-0000-000000000001', current_date, 'R-2',
  jsonb_build_array(jsonb_build_object('producto_id', 'a1000000-0000-0000-0000-000000000001', 'cantidad', 5, 'costo_unitario_usd', 10)),
  false, '10000000-0000-4000-8000-000000000002'
);
select throws_ok(
  $$select public.anular_ingreso_mercaderia(
      (select id from dominio.ingresos_mercaderia where estado = 'registrado' limit 1),
      'no'
    )$$,
  '22023', null, 'un motivo de menos de 3 caracteres se rechaza'
);
select is(
  (select count(*)::int from dominio.ingresos_mercaderia where estado = 'registrado'),
  1, 'el ingreso sigue registrado tras el motivo inválido'
);

-- Se venden 3 de las 5 unidades: anular exige 5 y debe fallar sin tocar nada.
select public.registrar_movimiento_stock(
  'a1000000-0000-0000-0000-000000000001', 'salida', 3,
  (select id from dominio.motivos_movimiento where lower(btrim(nombre)) = 'venta en local' limit 1),
  null, current_date
);
select throws_ok(
  $$select public.anular_ingreso_mercaderia(
      (select id from dominio.ingresos_mercaderia where estado = 'registrado' limit 1),
      'Corrección'
    )$$,
  '23514', null, 'sin stock suficiente la anulación se rechaza'
);
select is(
  (select estado from dominio.ingresos_mercaderia where comprobante = 'R-2'),
  'registrado', 'la cabecera sigue registrada'
);
select is(
  (select count(*)::int from dominio.ingresos_mercaderia_lineas where movimiento_anulacion_id is not null),
  2, 'no quedan vínculos nuevos de anulación'
);
select is(
  (select cantidad from dominio.existencias where producto_id = 'a1000000-0000-0000-0000-000000000001'),
  2, 'el stock no cambia tras el rechazo'
);

-- ============================================================================
-- Permisos y aislamiento
-- ============================================================================

reset role;
select pg_temp.como('d1000000-0000-0000-0000-000000000003');
select throws_ok(
  $$select public.anular_ingreso_mercaderia(
      (select id from dominio.ingresos_mercaderia where estado = 'registrado' limit 1), 'Corrección'
    )$$,
  '42501', null, 'consulta: no puede anular'
);

reset role;
select pg_temp.como('d2000000-0000-0000-0000-000000000001');
select throws_ok(
  $$select public.anular_ingreso_mercaderia(
      (select id from dominio.ingresos_mercaderia where estado = 'registrado' limit 1), 'Corrección'
    )$$,
  '22023', null, 'otra organización no puede anular (no lo ve)'
);

reset role;
select pg_temp.como_anon();
select throws_ok(
  $$select public.anular_ingreso_mercaderia('10000000-0000-4000-8000-000000000002', 'Corrección')$$,
  '42501', null, 'anon no ejecuta la RPC'
);

reset role;

select * from finish();
rollback;
