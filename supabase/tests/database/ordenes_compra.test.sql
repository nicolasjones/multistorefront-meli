-- F-PRV-09 (MSF-454, épica MSF-450): órdenes de compra a proveedor.
-- Cubre esquema y privilegios, aislamiento entre organizaciones, permisos por rol
-- (lectura no escribe, edición sí), el alta sobre el listado de reposición, los tres
-- estados con sus transiciones, el listado y el detalle, y `anon` sin acceso.
begin;

select plan(53);

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
  ('f1000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'Proveedor Inactivo', '30701234568', false),
  ('f2000000-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', 'Proveedor Dos', '33555555550', true);

insert into dominio.productos (id, organizacion_id, nombre, sku, precio_lista, proveedor_id) values
  ('a1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'Producto Alerta', 'P-1', 50, 'f1000000-0000-0000-0000-000000000001'),
  ('a1000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'Producto Stock Bajo', 'P-2', 40, 'f1000000-0000-0000-0000-000000000001'),
  ('a1000000-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111', 'Producto Otro Proveedor', 'P-3', 30, 'f2000000-0000-0000-0000-000000000001'),
  ('a1000000-0000-0000-0000-000000000004', '11111111-1111-1111-1111-111111111111', 'Producto Con Stock', 'P-4', 20, 'f1000000-0000-0000-0000-000000000001'),
  ('a2000000-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', 'Producto Org Dos', 'P-2O', 20, 'f2000000-0000-0000-0000-000000000001');

-- El listado de reposición: «en alerta» es disponible <= mínimo.
update dominio.existencias set minimo = 10 where producto_id = 'a1000000-0000-0000-0000-000000000001';
update dominio.existencias set minimo = 5, cantidad = 3 where producto_id = 'a1000000-0000-0000-0000-000000000002';
update dominio.existencias set minimo = 4 where producto_id = 'a1000000-0000-0000-0000-000000000003';
update dominio.existencias set minimo = 0, cantidad = 20 where producto_id = 'a1000000-0000-0000-0000-000000000004';
update dominio.existencias set minimo = 2 where producto_id = 'a2000000-0000-0000-0000-000000000001';

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
-- Esquema y privilegios
-- ============================================================================

select isnt(to_regclass('dominio.ordenes_compra'), null, 'la cabecera vive en dominio');
select isnt(to_regclass('dominio.ordenes_compra_items'), null, 'las líneas viven en dominio');

select is((select relrowsecurity from pg_class where oid = 'dominio.ordenes_compra'::regclass), true, 'la cabecera tiene RLS');
select is((select relrowsecurity from pg_class where oid = 'dominio.ordenes_compra_items'::regclass), true, 'las líneas tienen RLS');

select is(has_table_privilege('authenticated', 'dominio.ordenes_compra', 'select'), true, 'authenticated puede leer la cabecera');
select is(has_table_privilege('authenticated', 'dominio.ordenes_compra', 'insert'), false, 'authenticated no inserta la cabecera directo');
select is(has_table_privilege('authenticated', 'dominio.ordenes_compra', 'update'), false, 'authenticated no actualiza la cabecera directo');
select is(has_table_privilege('authenticated', 'dominio.ordenes_compra', 'delete'), false, 'authenticated no borra la cabecera');
select is(has_table_privilege('authenticated', 'dominio.ordenes_compra_items', 'insert'), false, 'authenticated no inserta las líneas directo');
select is(has_table_privilege('anon', 'dominio.ordenes_compra', 'select'), false, 'anon no lee la cabecera');
select is(has_table_privilege('anon', 'dominio.ordenes_compra_items', 'select'), false, 'anon no lee las líneas');

-- ============================================================================
-- Productos en reposición del proveedor
-- ============================================================================

select pg_temp.como('d1000000-0000-0000-0000-000000000001');

select is(
  (select count(*)::int from public.productos_en_reposicion_de_proveedor('f1000000-0000-0000-0000-000000000001')),
  2, 'el proveedor tiene dos productos en alerta de reposición'
);
select is(
  (select cantidad_sugerida from public.productos_en_reposicion_de_proveedor('f1000000-0000-0000-0000-000000000001')
    where producto_id = 'a1000000-0000-0000-0000-000000000001'),
  10, 'la cantidad sugerida es el mínimo menos lo disponible'
);
select is(
  (select cantidad_sugerida from public.productos_en_reposicion_de_proveedor('f1000000-0000-0000-0000-000000000001')
    where producto_id = 'a1000000-0000-0000-0000-000000000002'),
  2, 'con stock ya parcial la sugerencia es la diferencia'
);
select is(
  (select count(*)::int from public.productos_en_reposicion_de_proveedor('f1000000-0000-0000-0000-000000000002')),
  0, 'un proveedor inactivo no trae productos'
);

-- ============================================================================
-- Alta de la orden (operador con edición en Stock)
-- ============================================================================

select pg_temp.como('d1000000-0000-0000-0000-000000000002');

select lives_ok(
  $$select public.crear_orden_compra(
      'e1000000-0000-0000-0000-000000000001',
      'f1000000-0000-0000-0000-000000000001',
      current_date,
      '  Reponer antes del Friday  ',
      jsonb_build_array(
        jsonb_build_object('producto_id', 'a1000000-0000-0000-0000-000000000001', 'cantidad', 10),
        jsonb_build_object('producto_id', 'a1000000-0000-0000-0000-000000000002', 'cantidad', 2)
      )
    )$$,
  'operador: crea una orden con dos productos'
);
select is((select count(*)::int from dominio.ordenes_compra), 1, 'queda una orden');
select is((select count(*)::int from dominio.ordenes_compra_items), 2, 'quedan dos líneas');
select is((select estado from dominio.ordenes_compra), 'emitida', 'la orden nace emitida');
select is((select trim(observaciones) from dominio.ordenes_compra), 'Reponer antes del Friday', 'las observaciones se recortan');
select is((select empresa_id from dominio.ordenes_compra), 'e1000000-0000-0000-0000-000000000001', 'la orden es de la empresa elegida');
select is((select proveedor_id from dominio.ordenes_compra), 'f1000000-0000-0000-0000-000000000001', 'la orden es del proveedor elegido');

-- Rechazos: nada queda a medias.
select throws_ok(
  $$select public.crear_orden_compra(
      'e1000000-0000-0000-0000-000000000001',
      'f1000000-0000-0000-0000-000000000001',
      current_date + 1,
      null,
      jsonb_build_array(jsonb_build_object('producto_id', 'a1000000-0000-0000-0000-000000000001', 'cantidad', 1))
    )$$,
  '22023', 'una fecha futura se rechaza'
);
select throws_ok(
  $$select public.crear_orden_compra(
      'e1000000-0000-0000-0000-000000000001',
      'f1000000-0000-0000-0000-000000000002',
      current_date,
      null,
      jsonb_build_array(jsonb_build_object('producto_id', 'a1000000-0000-0000-0000-000000000001', 'cantidad', 1))
    )$$,
  '22023', 'un proveedor inactivo se rechaza'
);
select throws_ok(
  $$select public.crear_orden_compra(
      'e1000000-0000-0000-0000-000000000001',
      'f1000000-0000-0000-0000-000000000001',
      current_date,
      null,
      jsonb_build_array(jsonb_build_object('producto_id', 'a1000000-0000-0000-0000-000000000003', 'cantidad', 1))
    )$$,
  '22023', 'un producto de otro proveedor se rechaza'
);
select throws_ok(
  $$select public.crear_orden_compra(
      'e1000000-0000-0000-0000-000000000001',
      'f1000000-0000-0000-0000-000000000001',
      current_date,
      null,
      jsonb_build_array(jsonb_build_object('producto_id', 'a1000000-0000-0000-0000-000000000004', 'cantidad', 1))
    )$$,
  '22023', 'un producto que no está en alerta de reposición se rechaza'
);
select throws_ok(
  $$select public.crear_orden_compra(
      'e1000000-0000-0000-0000-000000000001',
      'f1000000-0000-0000-0000-000000000001',
      current_date,
      null,
      jsonb_build_array(jsonb_build_object('producto_id', 'a1000000-0000-0000-0000-000000000001', 'cantidad', 0))
    )$$,
  '22023', 'una cantidad cero se rechaza'
);
select throws_ok(
  $$select public.crear_orden_compra(
      'e1000000-0000-0000-0000-000000000001',
      'f1000000-0000-0000-0000-000000000001',
      current_date,
      null,
      '[]'::jsonb
    )$$,
  '22023', 'una orden sin productos se rechaza'
);
select throws_ok(
  $$select public.crear_orden_compra(
      'e1000000-0000-0000-0000-000000000001',
      'f1000000-0000-0000-0000-000000000001',
      current_date,
      null,
      jsonb_build_array(
        jsonb_build_object('producto_id', 'a1000000-0000-0000-0000-000000000001', 'cantidad', 1),
        jsonb_build_object('producto_id', 'a1000000-0000-0000-0000-000000000001', 'cantidad', 2)
      )
    )$$,
  '22023', 'repetir un producto se rechaza'
);
select is((select count(*)::int from dominio.ordenes_compra), 1, 'los rechazos no dejan órdenes a medias');

-- ============================================================================
-- Permisos por rol
-- ============================================================================

select pg_temp.como('d1000000-0000-0000-0000-000000000003');

select throws_ok(
  $$select public.crear_orden_compra(
      'e1000000-0000-0000-0000-000000000001',
      'f1000000-0000-0000-0000-000000000001',
      current_date,
      null,
      jsonb_build_array(jsonb_build_object('producto_id', 'a1000000-0000-0000-0000-000000000001', 'cantidad', 1))
    )$$,
  '42501', 'consulta (solo lectura) no puede crear órdenes'
);
select is(
  (select count(*)::int from public.listar_ordenes_compra()),
  1, 'consulta sí puede listar las órdenes'
);

-- ============================================================================
-- Estados: recepción y anulación
-- ============================================================================

select pg_temp.como('d1000000-0000-0000-0000-000000000002');

select lives_ok(
  $$select public.cambiar_estado_orden_compra(
      (select id from dominio.ordenes_compra limit 1),
      'recibida',
      current_date,
      null
    )$$,
  'operador: marca la orden como recibida'
);
select is((select estado from dominio.ordenes_compra), 'recibida', 'la orden queda recibida');
select is((select fecha_recepcion from dominio.ordenes_compra), current_date, 'la orden guarda la fecha de recepción');
select throws_ok(
  $$select public.cambiar_estado_orden_compra(
      (select id from dominio.ordenes_compra limit 1),
      'anulada',
      null,
      'Ya no hace falta'
    )$$,
  '22023', 'una orden recibida no se anula'
);

select lives_ok(
  $$select public.crear_orden_compra(
      'e1000000-0000-0000-0000-000000000001',
      'f1000000-0000-0000-0000-000000000001',
      current_date,
      null,
      jsonb_build_array(jsonb_build_object('producto_id', 'a1000000-0000-0000-0000-000000000001', 'cantidad', 5))
    )$$,
  'operador: crea una segunda orden para anularla'
);
select throws_ok(
  $$select public.cambiar_estado_orden_compra(
      (select id from dominio.ordenes_compra where estado = 'emitida' limit 1),
      'anulada',
      null,
      'ab'
    )$$,
  '22023', 'anular sin motivo válido se rechaza'
);
select lives_ok(
  $$select public.cambiar_estado_orden_compra(
      (select id from dominio.ordenes_compra where estado = 'emitida' limit 1),
      'anulada',
      null,
      'El proveedor no puede cumplir'
    )$$,
  'operador: anula la orden con motivo'
);
select is(
  (select motivo_anulacion from dominio.ordenes_compra where estado = 'anulada'),
  'El proveedor no puede cumplir', 'la orden guarda el motivo de la anulación'
);
select lives_ok(
  $$select public.cambiar_estado_orden_compra(
      (select id from dominio.ordenes_compra where estado = 'anulada' limit 1),
      'anulada',
      null,
      'Otro motivo'
    )$$,
  'repetir la anulación no falla'
);

-- ============================================================================
-- Listado y detalle (RLS del llamador)
-- ============================================================================

select is(
  (select count(*)::int from public.listar_ordenes_compra()),
  2, 'el listado trae las dos órdenes de la organización'
);
select is(
  (select count(*)::int from public.listar_ordenes_compra('anulada')),
  1, 'el filtro por estado funciona'
);
select is(
  (select unidades from public.listar_ordenes_compra('recibida')),
  12, 'el listado suma las unidades pedidas'
);
select is(
  (select proveedor from public.listar_ordenes_compra('recibida')),
  'Proveedor Uno', 'el listado trae el nombre del proveedor'
);
select is(
  (select jsonb_array_length(detalle_orden_compra((select orden_id from public.listar_ordenes_compra('recibida')))->'lineas')),
  2, 'el detalle trae las dos líneas de la orden'
);
-- El id de esa orden, para probar el aislamiento desde otra organización.
select id as orden_recibida from dominio.ordenes_compra where estado = 'recibida' \gset

-- Otra organización: no ve ni puede tocar las órdenes.
select pg_temp.como('d2000000-0000-0000-0000-000000000001');

select is((select count(*)::int from public.listar_ordenes_compra()), 0, 'otra organización no ve las órdenes');
select is(
  (select count(*)::int from public.listar_ordenes_compra('anulada')),
  0, 'otra organización no ve las órdenes anuladas'
);
select is(
  public.detalle_orden_compra(:'orden_recibida'),
  null, 'otra organización no abre el detalle'
);
select throws_ok(
  $$select public.cambiar_estado_orden_compra(
      :'orden_recibida',
      'anulada',
      null,
      'Motivo de prueba'
    )$$,
  '22023', 'otra organización no cambia el estado'
);

-- `anon` no tiene nada.
select pg_temp.como_anon();

select throws_ok(
  $$select public.listar_ordenes_compra()$$,
  '42501', 'anon no lista órdenes'
);
select throws_ok(
  $$select public.detalle_orden_compra(:'orden_recibida')$$,
  '42501', 'anon no abre el detalle'
);
select throws_ok(
  $$select public.crear_orden_compra(
      'e1000000-0000-0000-0000-000000000001',
      'f1000000-0000-0000-0000-000000000001',
      current_date,
      null,
      jsonb_build_array(jsonb_build_object('producto_id', 'a1000000-0000-0000-0000-000000000001', 'cantidad', 1))
    )$$,
  '42501', 'anon no crea órdenes'
);

select * from finish();
rollback;
