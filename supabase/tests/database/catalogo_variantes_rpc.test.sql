-- F-CAT-15 (MSF-408, épica MSF-229), guardado y lectura. Cubre FR-008, FR-009, FR-012:
-- guardar_variantes_producto es idempotente, respeta el bloqueo optimista (40001), registra el evento solo con
-- cambio real y sin costo, valida permisos (productos / stock) y la regla de la primera variante con stock,
-- y la vista no expone precio (el precio se resuelve por producto_id con Precios, sin cambios).
begin;

select * from no_plan();

insert into organizaciones (id, nombre) values
  ('11111111-1111-1111-1111-111111111111', 'Organización Uno'),
  ('22222222-2222-2222-2222-222222222222', 'Organización Dos');

insert into auth.users (id, email) values
  ('d1000000-0000-0000-0000-000000000001', 'administrador@example.com'),
  ('d1000000-0000-0000-0000-000000000003', 'consulta@example.com'),
  ('d2000000-0000-0000-0000-000000000001', 'admin-dos@example.com');

insert into usuarios_organizacion (user_id, organizacion_id, rol_id, estado) values
  ('d1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'administrador', 'activo'),
  ('d1000000-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111', 'consulta', 'activo'),
  ('d2000000-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', 'administrador', 'activo');

insert into dominio.productos (id, organizacion_id, nombre, sku, precio_lista) values
  ('a1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'Remera', '5134a', 20),
  ('a1000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'Gorra', 'GOR-1', 10),
  ('a1000000-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111', 'Campera', 'CAM-1', 90),
  ('b2000000-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', 'Producto Dos', 'DOS-1', 5);

create temp table ids on commit drop as
select m.organizacion_id, m.nombre, m.id from dominio.motivos_movimiento m;
grant select on ids to authenticated;

create function pg_temp.como(p_user uuid) returns void language plpgsql as $$
begin
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
  set local role authenticated;
end $$;

create function pg_temp.actualizado(p_producto uuid) returns timestamptz language sql as $$
  select updated_at from dominio.productos where id = p_producto $$;
grant execute on function pg_temp.actualizado(uuid) to authenticated;

-- Privilegios
select is(has_function_privilege('anon', 'public.guardar_variantes_producto(uuid, timestamptz, jsonb)', 'EXECUTE'), false, 'anon no ejecuta guardar_variantes_producto');
select is(has_function_privilege('authenticated', 'public.guardar_variantes_producto(uuid, timestamptz, jsonb)', 'EXECUTE'), true, 'authenticated ejecuta guardar_variantes_producto');
select is(has_table_privilege('anon', 'public.v_producto_variantes', 'SELECT'), false, 'anon no lee v_producto_variantes');

select pg_temp.como('d1000000-0000-0000-0000-000000000001');

-- Guardar dos variantes con stock inicial (4 y 3)
select is(
  jsonb_array_length(public.guardar_variantes_producto('a1000000-0000-0000-0000-000000000001', pg_temp.actualizado('a1000000-0000-0000-0000-000000000001'),
    '[{"nombre":"Negro","codigo":"5134a-N","codigo_barras":"7790000000011","activa":true,"stock":4},
      {"nombre":"Blanco","codigo":"5134a-B","activa":true,"stock":3}]'::jsonb) -> 'variantes'),
  2, 'guarda dos variantes');
select is((select array_agg(codigo order by orden) from public.v_producto_variantes where producto_id = 'a1000000-0000-0000-0000-000000000001'),
  array['5134a-N', '5134a-B'], 'la vista lee las variantes en orden');
select is((select sum(stock)::int from public.v_producto_variantes where producto_id = 'a1000000-0000-0000-0000-000000000001'), 7, 'el stock inicial suma 7');
select is(private.disponibilidad_producto('a1000000-0000-0000-0000-000000000001'), 'stock', 'el producto queda con stock');
select is((select count(*)::int from dominio.movimientos_stock where tipo = 'ajuste' and variante_id is not null), 2,
  'cada stock inicial deja un ajuste en el libro con su variante');

reset role;
select is((select count(*)::int from registro_actividad where tipo = 'producto.variantes_editadas'), 1, 'el cambio real deja producto.variantes_editadas');
select is((select count(*)::int from registro_actividad where tipo = 'producto.variantes_editadas' and detalle ~* '(precio|costo|usd|ars|\$|20)'), 0,
  'el evento no lleva precios ni costo');

-- Idempotencia: mismo envío (con los ids) no cambia nada ni suma evento ni movimientos
select pg_temp.como('d1000000-0000-0000-0000-000000000001');
select public.guardar_variantes_producto('a1000000-0000-0000-0000-000000000001', pg_temp.actualizado('a1000000-0000-0000-0000-000000000001'),
  (select jsonb_agg(jsonb_build_object('id', id, 'nombre', nombre, 'codigo', codigo, 'codigo_barras', codigo_barras, 'activa', activa, 'stock', stock) order by orden)
     from public.v_producto_variantes where producto_id = 'a1000000-0000-0000-0000-000000000001'));
reset role;
select is((select count(*)::int from registro_actividad where tipo = 'producto.variantes_editadas'), 1, 'repetir lo mismo no suma evento');
select is((select count(*)::int from dominio.movimientos_stock where variante_id is not null), 2, 'repetir lo mismo no suma movimientos');
select is((select count(*)::int from dominio.producto_variantes where producto_id = 'a1000000-0000-0000-0000-000000000001'), 2, 'ni duplica variantes');

-- Reintento: las mismas filas SIN id (como un alta que se repite) actualizan las existentes, no duplican
select pg_temp.como('d1000000-0000-0000-0000-000000000001');
select public.guardar_variantes_producto('a1000000-0000-0000-0000-000000000001', pg_temp.actualizado('a1000000-0000-0000-0000-000000000001'),
  '[{"nombre":"Negro","codigo":"5134a-N","codigo_barras":"7790000000011","activa":true,"stock":4},
    {"nombre":"Blanco","codigo":"5134a-B","activa":true,"stock":3}]'::jsonb);
reset role;
select is((select count(*)::int from dominio.producto_variantes where producto_id = 'a1000000-0000-0000-0000-000000000001'), 2,
  'repetir las filas sin id no duplica variantes');
select is((select count(*)::int from registro_actividad where tipo = 'producto.variantes_editadas'), 1, 'ni suma eventos');

-- Stock contado (ajuste) y desactivar
select pg_temp.como('d1000000-0000-0000-0000-000000000001');
select public.guardar_variantes_producto('a1000000-0000-0000-0000-000000000001', pg_temp.actualizado('a1000000-0000-0000-0000-000000000001'),
  (select jsonb_agg(jsonb_build_object('id', id, 'nombre', nombre, 'codigo', codigo, 'codigo_barras', codigo_barras,
                                       'activa', case when codigo = '5134a-B' then false else activa end,
                                       'stock', case when codigo = '5134a-N' then 6 else stock end) order by orden)
     from public.v_producto_variantes where producto_id = 'a1000000-0000-0000-0000-000000000001'));
select is((select stock from public.v_producto_variantes where codigo = '5134a-N'), 6, 'el stock contado ajusta la variante');
select is(private.disponibilidad_producto('a1000000-0000-0000-0000-000000000001'), 'stock', 'desactivar Blanco: sigue Negro');
reset role;
select is((select count(*)::int from registro_actividad where tipo = 'producto.variantes_editadas'), 2, 'activar/desactivar suma un evento');

-- Bloqueo optimista (40001)
select pg_temp.como('d1000000-0000-0000-0000-000000000001');
select throws_ok(
  $$select public.guardar_variantes_producto('a1000000-0000-0000-0000-000000000002', now() - interval '1 day', '[]'::jsonb)$$,
  '40001', null, 'un producto cambiado por otra persona devuelve 40001');

-- Errores de validación
select throws_ok(
  $$select public.guardar_variantes_producto('a1000000-0000-0000-0000-000000000002', pg_temp.actualizado('a1000000-0000-0000-0000-000000000002'),
      '[{"nombre":"Rojo","codigo":"5134a-N","activa":true}]'::jsonb)$$,
  '23505', 'El código "5134a-N" ya lo usa otra variante', 'repetir el código de otra variante se rechaza nombrando el valor');
select throws_ok(
  $$select public.guardar_variantes_producto('a1000000-0000-0000-0000-000000000002', pg_temp.actualizado('a1000000-0000-0000-0000-000000000002'),
      '[{"nombre":"Rojo","codigo":"CAM-1","activa":true}]'::jsonb)$$,
  '23505', 'El código "CAM-1" ya lo usa un producto', 'repetir el SKU de un producto se rechaza');
select throws_ok(
  $$select public.guardar_variantes_producto('a1000000-0000-0000-0000-000000000002', pg_temp.actualizado('a1000000-0000-0000-0000-000000000002'),
      '[{"nombre":"Rojo","codigo":"GOR-R","codigo_barras":"7790000000011","activa":true}]'::jsonb)$$,
  '23505', 'El código de barras "7790000000011" ya lo usa otra variante', 'repetir el código de barras se rechaza');
select throws_ok(
  $$select public.guardar_variantes_producto('a1000000-0000-0000-0000-000000000002', pg_temp.actualizado('a1000000-0000-0000-0000-000000000002'),
      '[{"nombre":"Rojo","codigo":"GOR-R","codigo_barras":"123","activa":true}]'::jsonb)$$,
  '22023', 'El código de barras "123" debe tener 13 dígitos (EAN-13)', 'el código de barras debe ser EAN-13');
select throws_ok(
  $$select public.guardar_variantes_producto('a1000000-0000-0000-0000-000000000002', pg_temp.actualizado('a1000000-0000-0000-0000-000000000002'),
      '[{"nombre":"  ","codigo":"GOR-R","activa":true}]'::jsonb)$$,
  '22023', null, 'el nombre vacío se rechaza');
select throws_ok(
  $$select public.guardar_variantes_producto('a1000000-0000-0000-0000-000000000001', pg_temp.actualizado('a1000000-0000-0000-0000-000000000001'), '[]'::jsonb)$$,
  '22023', 'Enviá todas las variantes del producto: las que no uses se desactivan, no se borran', 'las variantes existentes no se borran');
select throws_ok(
  $$select public.guardar_variantes_producto('b2000000-0000-0000-0000-000000000001', now(), '[]'::jsonb)$$,
  'P0002', null, 'un producto de otra organización no existe');

-- Control de stock (revisión independiente de MSF-229)
-- Un rol que edita Productos pero NO Stock: ningún valor de stock se acepta, ni el que coincide con el actual (si no, probando valores se
-- adivinaría el stock exacto); sin `stock` en el envío, el guardado funciona.
reset role;
insert into auth.users (id, email) values ('d1000000-0000-0000-0000-000000000004', 'operador@example.com');
insert into usuarios_organizacion (user_id, organizacion_id, rol_id, estado)
values ('d1000000-0000-0000-0000-000000000004', '11111111-1111-1111-1111-111111111111', 'operador', 'activo');
update public.permisos_rol set nivel = 'edicion'
 where organizacion_id = '11111111-1111-1111-1111-111111111111' and rol_id = 'operador' and seccion = 'productos';
update public.permisos_rol set nivel = 'lectura'
 where organizacion_id = '11111111-1111-1111-1111-111111111111' and rol_id = 'operador' and seccion = 'stock';
select pg_temp.como('d1000000-0000-0000-0000-000000000004');
select throws_ok(
  $$select public.guardar_variantes_producto('a1000000-0000-0000-0000-000000000001', pg_temp.actualizado('a1000000-0000-0000-0000-000000000001'),
      (select jsonb_agg(jsonb_build_object('id', id, 'nombre', nombre, 'codigo', codigo, 'codigo_barras', codigo_barras, 'activa', activa, 'stock', stock) order by orden)
         from public.v_producto_variantes where producto_id = 'a1000000-0000-0000-0000-000000000001'))$$,
  '42501', 'Tu rol no puede ajustar el stock', 'sin edición en Stock se rechaza el stock aunque coincida con el actual (sin oráculo)');
select lives_ok(
  $$select public.guardar_variantes_producto('a1000000-0000-0000-0000-000000000001', pg_temp.actualizado('a1000000-0000-0000-0000-000000000001'),
      (select jsonb_agg(jsonb_build_object('id', id, 'nombre', nombre, 'codigo', codigo, 'codigo_barras', codigo_barras, 'activa', activa) order by orden)
         from public.v_producto_variantes where producto_id = 'a1000000-0000-0000-0000-000000000001'))$$,
  'sin stock en el envío, quien edita Productos guarda las variantes');

-- Compare-and-set (`stock_leido`): si el stock ya no es el que la persona vio, se rechaza y no se pisa.
select pg_temp.como('d1000000-0000-0000-0000-000000000001');
select throws_ok(
  $$select public.guardar_variantes_producto('a1000000-0000-0000-0000-000000000001', pg_temp.actualizado('a1000000-0000-0000-0000-000000000001'),
      (select jsonb_agg(jsonb_build_object('id', id, 'nombre', nombre, 'codigo', codigo, 'codigo_barras', codigo_barras, 'activa', activa,
                        'stock', case when codigo = '5134a-N' then 9 else stock end,
                        'stock_leido', case when codigo = '5134a-N' then 5 else stock end) order by orden)
         from public.v_producto_variantes where producto_id = 'a1000000-0000-0000-0000-000000000001'))$$,
  '40001', null, 'si el stock cambió desde que se leyó (vio 5, hay 6), el conteo se rechaza');
select is((select stock from public.v_producto_variantes where codigo = '5134a-N'), 6, 'y el stock que movió otra persona no se pisa');
select lives_ok(
  $$select public.guardar_variantes_producto('a1000000-0000-0000-0000-000000000001', pg_temp.actualizado('a1000000-0000-0000-0000-000000000001'),
      (select jsonb_agg(jsonb_build_object('id', id, 'nombre', nombre, 'codigo', codigo, 'codigo_barras', codigo_barras, 'activa', activa,
                        'stock', case when codigo = '5134a-N' then 9 else stock end,
                        'stock_leido', case when codigo = '5134a-N' then 6 else stock end) order by orden)
         from public.v_producto_variantes where producto_id = 'a1000000-0000-0000-0000-000000000001'))$$,
  'con el stock leído vigente (6) el conteo se aplica');
select is((select stock from public.v_producto_variantes where codigo = '5134a-N'), 9, 'y el stock queda en el valor contado');
select throws_ok(
  $$select public.guardar_variantes_producto('a1000000-0000-0000-0000-000000000001', pg_temp.actualizado('a1000000-0000-0000-0000-000000000001'),
      (select jsonb_agg(jsonb_build_object('id', id, 'nombre', nombre, 'codigo', codigo, 'codigo_barras', codigo_barras, 'activa', activa,
                        'stock', case when codigo = '5134a-N' then 2147483648 else stock end) order by orden)
         from public.v_producto_variantes where producto_id = 'a1000000-0000-0000-0000-000000000001'))$$,
  '22023', null, 'un stock mayor a 2147483647 se rechaza con un error de validación (no un desborde crudo)');
select throws_ok(
  $$select public.guardar_variantes_producto('a1000000-0000-0000-0000-000000000001', pg_temp.actualizado('a1000000-0000-0000-0000-000000000001'),
      (select jsonb_agg(jsonb_build_object('id', id, 'nombre', nombre, 'codigo', codigo, 'codigo_barras', codigo_barras, 'activa', activa) order by orden)
         || '[{"nombre":"Repetida","codigo":"X-1","activa":true},{"nombre":"Repetida 2","codigo":"x-1","activa":true}]'::jsonb
         from public.v_producto_variantes where producto_id = 'a1000000-0000-0000-0000-000000000001'))$$,
  '23505', null, 'un código repetido dentro del mismo envío se rechaza');
select throws_ok(
  $$select public.guardar_variantes_producto('a1000000-0000-0000-0000-000000000002', pg_temp.actualizado('a1000000-0000-0000-0000-000000000002'),
      jsonb_build_array(jsonb_build_object('id', (select id from dominio.producto_variantes limit 1), 'nombre', 'X', 'codigo', 'GOR-X')))$$,
  '22023', 'Alguna variante no pertenece a este producto', 'una variante de otro producto en el envío se rechaza');

-- Primera variante sobre un producto con stock (FR-008)
reset role;
update dominio.existencias set cantidad = 5 where producto_id = 'a1000000-0000-0000-0000-000000000003';
select pg_temp.como('d1000000-0000-0000-0000-000000000001');
select throws_ok(
  $$select public.guardar_variantes_producto('a1000000-0000-0000-0000-000000000003', pg_temp.actualizado('a1000000-0000-0000-0000-000000000003'),
      '[{"nombre":"Azul","codigo":"CAM-1-A","activa":true}]'::jsonb)$$,
  '22023', 'Este producto tiene 5 unidades en stock: dejá el stock del producto en 0 y cargalo en las variantes',
  'la primera variante sobre un producto con stock se rechaza');
select is((select count(*)::int from dominio.producto_variantes where producto_id = 'a1000000-0000-0000-0000-000000000003'), 0, 'y no deja variantes a medias');

-- Permisos
select pg_temp.como('d1000000-0000-0000-0000-000000000003');
select throws_ok(
  $$select public.guardar_variantes_producto('a1000000-0000-0000-0000-000000000002', pg_temp.actualizado('a1000000-0000-0000-0000-000000000002'), '[]'::jsonb)$$,
  '42501', null, 'consulta no guarda variantes');
select is((select count(*)::int from public.v_producto_variantes), 2, 'consulta lee las variantes');

-- Aislamiento
select pg_temp.como('d2000000-0000-0000-0000-000000000001');
select is((select count(*)::int from public.v_producto_variantes), 0, 'otra organización no ve variantes ajenas');
select throws_ok(
  $$select public.guardar_variantes_producto('a1000000-0000-0000-0000-000000000001', now(), '[]'::jsonb)$$,
  'P0002', null, 'otra organización no guarda variantes de un producto ajeno');

-- FR-009: sin precio propio; Precios se resuelve por producto_id
reset role;
select is(
  (select count(*)::int from information_schema.columns
    where table_schema = 'public' and table_name = 'v_producto_variantes' and column_name ~ '(precio|costo)'),
  0, 'la vista no expone precio ni costo');
select is(
  (select count(*)::int from information_schema.columns
    where table_schema = 'public' and table_name = 'v_producto_variantes' and column_name = 'producto_id'),
  1, 'la vista expone producto_id para que Precios resuelva por producto');
select is(
  (select pg_get_function_identity_arguments('private.precio_para(uuid, uuid, text)'::regprocedure)),
  'p_producto uuid, p_empresa uuid, p_escala text', 'precio_para sigue resolviéndose por producto, sin cambios');

select * from finish();
rollback;
