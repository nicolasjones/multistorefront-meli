-- F-STK-07 (MSF-380, épica MSF-368): carga inicial y masiva de stock por planilla.
-- Cubre FR-006, FR-008, FR-009, FR-011, FR-012 y SC-001/SC-002/SC-003: cada regla de
-- `validar_carga_stock`; «aplicar» confirma solo las filas válidas (un ajuste por diferencia en el
-- depósito elegido, motivo «Carga inicial de stock», nota = motivo de la planilla); una falla a mitad
-- de la carga revierte todo; la misma clave no duplica; un producto no admite una segunda carga
-- inicial (restricción única); `lectura` → 42501; `anon` sin ejecución; otra organización aislada.
-- Las dos cargas realmente simultáneas no se pueden simular con un solo backend: se razonan con el
-- bloqueo por organización + la restricción única, que sí se verifica aquí (23505).
begin;

select no_plan();

insert into organizaciones (id, nombre) values
  ('11111111-1111-1111-1111-111111111111', 'Organización Uno'),
  ('22222222-2222-2222-2222-222222222222', 'Organización Dos');

insert into auth.users (id, email) values
  ('d1000000-0000-0000-0000-000000000002', 'operador@example.com'),
  ('d1000000-0000-0000-0000-000000000003', 'consulta@example.com'),
  ('d1000000-0000-0000-0000-000000000004', 'operador2@example.com');

insert into usuarios_organizacion (user_id, organizacion_id, rol_id) values
  ('d1000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'operador'),
  ('d1000000-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111', 'consulta'),
  ('d1000000-0000-0000-0000-000000000004', '22222222-2222-2222-2222-222222222222', 'operador');

insert into dominio.productos (id, organizacion_id, nombre, sku, precio_lista) values
  ('a1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'Producto 1', 'P-1', 10),
  ('a1000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'Producto 2', 'P-2', 10),
  ('a1000000-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111', 'Producto 3', 'P-3', 10),
  ('a1000000-0000-0000-0000-000000000004', '11111111-1111-1111-1111-111111111111', 'Producto 4', 'P-4', 10),
  ('a1000000-0000-0000-0000-000000000005', '11111111-1111-1111-1111-111111111111', 'Producto 5', 'P-5', 10),
  ('a1000000-0000-0000-0000-000000000006', '11111111-1111-1111-1111-111111111111', 'Producto 6', 'P-6', 10),
  ('a1000000-0000-0000-0000-000000000007', '11111111-1111-1111-1111-111111111111', 'Producto 7', 'P-7', 10),
  ('a1000000-0000-0000-0000-000000000008', '11111111-1111-1111-1111-111111111111', 'Producto 8', 'P-8', 10),
  ('a2000000-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', 'Producto ajeno', 'Z-1', 10);

create temp table ids on commit drop as
select m.organizacion_id, m.nombre, m.id from dominio.motivos_movimiento m;
grant select on ids to authenticated;

create temp table dep on commit drop as
select d.organizacion_id, d.id from dominio.depositos d where d.por_defecto;
grant select on dep to authenticated;

create function pg_temp.como(p_user uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
  set local role authenticated;
end $$;

create function pg_temp.dep1() returns uuid language sql as $$
  select id from dep where organizacion_id = '11111111-1111-1111-1111-111111111111';
$$;

-- Planilla de prueba: una fila por cada regla.
create function pg_temp.planilla() returns jsonb language sql as $$
  select jsonb_build_array(
    jsonb_build_object('fila', 2, 'sku', 'P-1', 'cantidad', '8', 'motivo', 'Conteo de góndola'),
    jsonb_build_object('fila', 3, 'sku', '  p-2 ', 'cantidad', '4', 'motivo', null),
    jsonb_build_object('fila', 4, 'sku', 'P-3', 'cantidad', '7', 'motivo', null),
    jsonb_build_object('fila', 5, 'sku', 'NO-EXISTE', 'cantidad', '1', 'motivo', null),
    jsonb_build_object('fila', 6, 'sku', '', 'cantidad', '1', 'motivo', null),
    jsonb_build_object('fila', 7, 'sku', 'P-6', 'cantidad', '1', 'motivo', null),
    jsonb_build_object('fila', 8, 'sku', 'P-6', 'cantidad', '2', 'motivo', null),
    jsonb_build_object('fila', 9, 'sku', 'P-7', 'cantidad', 'abc', 'motivo', null),
    jsonb_build_object('fila', 10, 'sku', 'P-7x', 'cantidad', '-1', 'motivo', null),
    jsonb_build_object('fila', 11, 'sku', 'P-4', 'cantidad', '2', 'motivo', null),
    jsonb_build_object('fila', 12, 'sku', 'P-5', 'cantidad', '3', 'motivo', repeat('x', 501)),
    jsonb_build_object('fila', 13, 'sku', 'Z-1', 'cantidad', '1', 'motivo', null)
  );
$$;

-- ============================================================================
-- FR-012, SC-003: permisos
-- ============================================================================

select is(has_function_privilege('anon', 'public.validar_carga_stock(uuid,jsonb)', 'EXECUTE'), false, 'anon no ejecuta validar_carga_stock');
select is(has_function_privilege('anon', 'public.aplicar_carga_inicial_stock(uuid,jsonb,uuid)', 'EXECUTE'), false, 'anon no ejecuta aplicar_carga_inicial_stock');
select is(has_function_privilege('authenticated', 'public.validar_carga_stock(uuid,jsonb)', 'EXECUTE'), true, 'authenticated ejecuta validar_carga_stock');
select is(has_function_privilege('authenticated', 'public.aplicar_carga_inicial_stock(uuid,jsonb,uuid)', 'EXECUTE'), true, 'authenticated ejecuta aplicar_carga_inicial_stock');
select is(has_function_privilege('authenticated', 'private.validar_filas_carga_stock(uuid,uuid,jsonb)', 'EXECUTE'), false, 'el validador interno no es ejecutable por authenticated');
select is(has_table_privilege('anon', 'dominio.cargas_iniciales_stock', 'SELECT'), false, 'anon no lee cargas_iniciales_stock');
select is(has_table_privilege('authenticated', 'dominio.cargas_iniciales_stock', 'SELECT'), true, 'authenticated lee cargas_iniciales_stock (con RLS)');
select is(has_table_privilege('authenticated', 'dominio.cargas_iniciales_stock', 'INSERT'), false, 'authenticated no inserta directo en cargas_iniciales_stock');
select is(has_table_privilege('authenticated', 'dominio.cargas_iniciales_stock', 'UPDATE'), false, 'authenticated no actualiza cargas_iniciales_stock');
select is(has_table_privilege('authenticated', 'dominio.cargas_iniciales_stock', 'DELETE'), false, 'authenticated no borra cargas_iniciales_stock');
select is(
  (select relrowsecurity from pg_class where oid = 'dominio.cargas_iniciales_stock'::regclass),
  true, 'cargas_iniciales_stock tiene RLS activa'
);
select is(
  (select count(*)::int from ids
    where nombre = 'Carga inicial de stock'
      and organizacion_id in ('11111111-1111-1111-1111-111111111111', '22222222-2222-2222-2222-222222222222')), 2,
  'cada organización nace con el motivo de sistema «Carga inicial de stock»'
);

select pg_temp.como('d1000000-0000-0000-0000-000000000003');
select throws_ok(
  $$select * from public.validar_carga_stock(pg_temp.dep1(), pg_temp.planilla())$$,
  '42501', 'Tu rol no puede cargar stock por planilla', 'lectura no valida la planilla'
);
select throws_ok(
  $$select public.aplicar_carga_inicial_stock(pg_temp.dep1(), pg_temp.planilla())$$,
  '42501', 'Tu rol no puede cargar stock por planilla', 'lectura no aplica la carga (SC-003)'
);
reset role;

-- ============================================================================
-- Stock de partida (operador)
-- ============================================================================

select pg_temp.como('d1000000-0000-0000-0000-000000000002');
select public.registrar_movimiento_stock('a1000000-0000-0000-0000-000000000001', 'entrada', 5,
  (select id from ids where nombre = 'Compra a proveedor' and organizacion_id = '11111111-1111-1111-1111-111111111111'));
select public.registrar_movimiento_stock('a1000000-0000-0000-0000-000000000003', 'entrada', 7,
  (select id from ids where nombre = 'Compra a proveedor' and organizacion_id = '11111111-1111-1111-1111-111111111111'));
select public.registrar_movimiento_stock('a1000000-0000-0000-0000-000000000004', 'entrada', 5,
  (select id from ids where nombre = 'Compra a proveedor' and organizacion_id = '11111111-1111-1111-1111-111111111111'));
select public.registrar_movimiento_stock('a1000000-0000-0000-0000-000000000005', 'entrada', 1,
  (select id from ids where nombre = 'Compra a proveedor' and organizacion_id = '11111111-1111-1111-1111-111111111111'));
reset role;

-- P-4 con 3 unidades reservadas («A pedido»): no puede quedar por debajo de ellas.
update dominio.existencias_deposito set reservado = 3 where producto_id = 'a1000000-0000-0000-0000-000000000004';
update dominio.existencias set reservado = 3 where producto_id = 'a1000000-0000-0000-0000-000000000004';

create temp table base_mov on commit drop as select count(*)::int as n from dominio.movimientos_stock;
grant select on base_mov to authenticated;

-- ============================================================================
-- FR-006: validación por fila
-- ============================================================================

select pg_temp.como('d1000000-0000-0000-0000-000000000002');

create temp table vista on commit drop as
select * from public.validar_carga_stock(pg_temp.dep1(), pg_temp.planilla());
grant select on vista to authenticated;

select is((select count(*)::int from vista), 12, 'la vista previa devuelve una fila por cada fila de la planilla');
select results_eq(
  $$select estado, mensaje, producto, stock_actual, en_planilla, quedara, diferencia from vista where fila = 2$$,
  $$values ('ajuste'::text, 'Ajuste'::text, 'Producto 1'::text, 5, 8, 8, 3)$$,
  'P-1: ajuste con stock actual, planilla, quedará y diferencia con signo'
);
select results_eq(
  $$select estado, sku, diferencia from vista where fila = 3$$,
  $$values ('ajuste'::text, 'p-2'::text, 4)$$,
  'el SKU se recorta y no distingue mayúsculas'
);
select results_eq(
  $$select estado, mensaje, diferencia from vista where fila = 4$$,
  $$values ('sin_cambios'::text, 'Sin cambios'::text, 0)$$,
  'cantidad igual a la actual: «Sin cambios», no es error'
);
select is((select mensaje from vista where fila = 5), 'SKU no existe', 'SKU inexistente');
select is((select mensaje from vista where fila = 6), 'SKU vacío', 'SKU vacío');
select is((select mensaje from vista where fila = 7), 'SKU repetido en la planilla', 'SKU repetido (primera aparición)');
select is((select mensaje from vista where fila = 8), 'SKU repetido en la planilla', 'SKU repetido (segunda aparición)');
select is((select mensaje from vista where fila = 9), 'Cantidad inválida', 'cantidad no numérica');
select is((select mensaje from vista where fila = 10), 'SKU no existe', 'SKU inexistente con cantidad negativa se informa por el SKU');
select is((select mensaje from vista where fila = 11), 'Por debajo de lo reservado', 'no puede quedar por debajo de lo reservado');
select is((select mensaje from vista where fila = 12), 'Motivo demasiado largo (máximo 500)', 'motivo de más de 500 caracteres');
select is((select mensaje from vista where fila = 13), 'SKU no existe', 'el SKU de otra organización no existe');
select is((select estado from vista where fila = 5), 'error', 'las filas inválidas llevan estado error');

-- Un producto inactivo se distingue de un SKU inexistente.
reset role;
update dominio.productos set activo = false where id = 'a1000000-0000-0000-0000-000000000008';
select pg_temp.como('d1000000-0000-0000-0000-000000000002');
select is(
  (select mensaje from public.validar_carga_stock(pg_temp.dep1(),
     '[{"fila":2,"sku":"P-8","cantidad":"1","motivo":null}]'::jsonb)),
  'Producto inactivo', 'un producto inactivo se informa como «Producto inactivo»'
);
reset role;
update dominio.productos set activo = true where id = 'a1000000-0000-0000-0000-000000000008';
select pg_temp.como('d1000000-0000-0000-0000-000000000002');

select throws_ok(
  $$select * from public.validar_carga_stock('00000000-0000-0000-0000-000000000000', '[]'::jsonb)$$,
  '22023', 'Elegí un depósito activo para la carga', 'un depósito inexistente responde 22023'
);
select throws_ok(
  $$select * from public.validar_carga_stock(pg_temp.dep1(), '{"a":1}'::jsonb)$$,
  '22023', 'La planilla debe ser una lista de filas', 'p_filas mal formado responde 22023'
);
select throws_ok(
  $$select * from public.validar_carga_stock(pg_temp.dep1(),
      (select jsonb_agg(jsonb_build_object('sku', 'S' || i, 'cantidad', '1')) from generate_series(1, 2001) i))$$,
  '22023', 'La planilla admite hasta 2000 filas', 'más de 2000 filas responde 22023'
);
select is(
  (select count(*)::int from dominio.movimientos_stock), (select n from base_mov),
  'validar no escribe nada'
);
reset role;

-- ============================================================================
-- FR-008: una falla a mitad de la carga revierte todo (nada parcial)
-- ============================================================================

create function public.tmp_falla_carga() returns trigger language plpgsql as $$
begin
  if new.producto_id = 'a1000000-0000-0000-0000-000000000008' then
    raise exception 'falla simulada' using errcode = 'P0001';
  end if;
  return new;
end $$;
create trigger tmp_falla_carga before insert on dominio.movimientos_stock
  for each row execute function public.tmp_falla_carga();

select pg_temp.como('d1000000-0000-0000-0000-000000000002');
select throws_ok(
  $$select public.aplicar_carga_inicial_stock(pg_temp.dep1(),
      '[{"fila":1,"sku":"P-3","cantidad":"9"},{"fila":2,"sku":"P-8","cantidad":"5"}]'::jsonb,
      'c1000000-0000-0000-0000-0000000000ff')$$,
  'P0001', 'falla simulada', 'una falla inesperada aborta la carga'
);
select is(
  (select cantidad from dominio.existencias where producto_id = 'a1000000-0000-0000-0000-000000000003'),
  7, 'la falla revirtió el ajuste de la fila anterior (stock intacto)'
);
select is((select count(*)::int from dominio.cargas_iniciales_stock), 0, 'la falla no dejó cargas registradas');
select is((select count(*)::int from dominio.movimientos_stock), (select n from base_mov), 'la falla no dejó movimientos');
reset role;

drop trigger tmp_falla_carga on dominio.movimientos_stock;
drop function public.tmp_falla_carga();

-- ============================================================================
-- FR-008, FR-011, SC-001: aplica solo las filas válidas
-- ============================================================================

select pg_temp.como('d1000000-0000-0000-0000-000000000002');

create temp table resultado on commit drop as
select public.aplicar_carga_inicial_stock(pg_temp.dep1(), pg_temp.planilla(), 'c1000000-0000-0000-0000-000000000001') as r;
grant select on resultado to authenticated;

select is((select (r ->> 'aplicadas')::int from resultado), 2, 'se aplicaron solo las 2 filas con diferencia válida');
select is((select (r ->> 'omitidas')::int from resultado), 9, 'las 9 filas inválidas se informan como omitidas');
select is((select (r ->> 'repetido')::boolean from resultado), false, 'la primera vez no es un reintento');
select is(
  (select count(*)::int from resultado, jsonb_array_elements(r -> 'detalle') d where d ->> 'estado' = 'sin_cambios'),
  1, 'el detalle informa la fila «Sin cambios»'
);
reset role;

select is((select cantidad from dominio.existencias where producto_id = 'a1000000-0000-0000-0000-000000000001'), 8, 'P-1 quedó en lo cargado');
select is((select cantidad from dominio.existencias where producto_id = 'a1000000-0000-0000-0000-000000000002'), 4, 'P-2 (sin stock previo) quedó en lo cargado');
select is((select cantidad from dominio.existencias where producto_id = 'a1000000-0000-0000-0000-000000000003'), 7, 'P-3 sin cambios no se movió');
select is((select cantidad from dominio.existencias where producto_id = 'a1000000-0000-0000-0000-000000000004'), 5, 'P-4 (por debajo de lo reservado) no se tocó');
select is((select cantidad from dominio.existencias where producto_id = 'a1000000-0000-0000-0000-000000000005'), 1, 'P-5 (motivo largo) no se tocó');
select is((select cantidad from dominio.existencias where producto_id = 'a1000000-0000-0000-0000-000000000006'), 0, 'P-6 (repetido) no se tocó');
select is(
  (select count(*)::int from dominio.movimientos_stock) - (select n from base_mov), 2,
  'se crearon exactamente 2 movimientos'
);
select results_eq(
  $$select m.tipo, m.diferencia, mo.nombre, m.nota, m.deposito_id = pg_temp.dep1()
      from dominio.movimientos_stock m join dominio.motivos_movimiento mo on mo.id = m.motivo_id
     where m.producto_id = 'a1000000-0000-0000-0000-000000000001' and mo.nombre = 'Carga inicial de stock'$$,
  $$values ('ajuste'::text, 3, 'Carga inicial de stock'::text, 'Conteo de góndola'::text, true)$$,
  'el movimiento es un ajuste con el motivo de sistema, la nota de la planilla y el depósito elegido'
);
select is((select count(*)::int from dominio.cargas_iniciales_stock), 2, 'quedaron 2 cargas iniciales registradas');
select is(
  (select count(*)::int from dominio.cargas_iniciales_stock c
     join dominio.movimientos_stock m on m.id = c.movimiento_id
    where m.organizacion_id <> c.organizacion_id),
  0, 'cada carga inicial apunta a un movimiento de su propia organización'
);
select is(
  (select count(*)::int from dominio.cargas_iniciales_stock where producto_id = 'a1000000-0000-0000-0000-000000000003'),
  0, '«Sin cambios» no consume la carga inicial del producto'
);
select ok(
  exists (select 1 from registro_actividad
           where tipo = 'stock.carga_inicial' and detalle like '%2 ajustes, 9 filas omitidas%'),
  'queda el evento stock.carga_inicial con ajustes y omitidas (FR-011)'
);
select ok(
  (select actor_id from registro_actividad where tipo = 'stock.carga_inicial' limit 1) = 'd1000000-0000-0000-0000-000000000002',
  'el evento guarda al actor de la sesión'
);

-- ============================================================================
-- FR-009, SC-002: misma clave no duplica
-- ============================================================================

select pg_temp.como('d1000000-0000-0000-0000-000000000002');
select is(
  (public.aplicar_carga_inicial_stock(pg_temp.dep1(), pg_temp.planilla(), 'c1000000-0000-0000-0000-000000000001') ->> 'repetido')::boolean,
  true, 'el reintento con la misma clave se reconoce'
);
select is(
  (public.aplicar_carga_inicial_stock(pg_temp.dep1(), pg_temp.planilla(), 'c1000000-0000-0000-0000-000000000001') ->> 'aplicadas')::int,
  2, 'el reintento devuelve lo que ya se aplicó'
);
reset role;
select is((select count(*)::int from dominio.movimientos_stock) - (select n from base_mov), 2, 'el reintento no creó otros movimientos');
select is((select cantidad from dominio.existencias where producto_id = 'a1000000-0000-0000-0000-000000000001'), 8, 'el reintento no movió el stock');
select is(
  (select count(*)::int from registro_actividad where tipo = 'stock.carga_inicial'), 1,
  'el reintento no duplicó el evento'
);

-- ============================================================================
-- FR-009, SC-002: un producto no admite una segunda carga inicial
-- ============================================================================

select pg_temp.como('d1000000-0000-0000-0000-000000000002');
select is(
  (select mensaje from public.validar_carga_stock(pg_temp.dep1(), '[{"fila":1,"sku":"P-1","cantidad":"9"}]'::jsonb)),
  'Ya tuvo carga inicial', 'la vista previa marca «Ya tuvo carga inicial»'
);
select results_eq(
  $$select (r ->> 'aplicadas')::int, (r ->> 'omitidas')::int
      from (select public.aplicar_carga_inicial_stock(pg_temp.dep1(),
              '[{"fila":1,"sku":"P-1","cantidad":"9"}]'::jsonb, 'c1000000-0000-0000-0000-000000000002') as r) x$$,
  $$values (0, 1)$$,
  'una segunda carga del mismo producto con otra clave se omite'
);
reset role;
select is((select cantidad from dominio.existencias where producto_id = 'a1000000-0000-0000-0000-000000000001'), 8, 'la segunda carga no cambió el stock');
select throws_ok(
  $$insert into dominio.cargas_iniciales_stock
      (organizacion_id, producto_id, deposito_id, movimiento_id, cantidad, clave_idempotencia)
    select c.organizacion_id, c.producto_id, c.deposito_id, c.movimiento_id, 1, gen_random_uuid()
      from dominio.cargas_iniciales_stock c limit 1$$,
  '23505', null, 'la restricción única impide dos cargas iniciales del mismo producto (red de seguridad de la concurrencia)'
);

-- «Sin cambios» no consumió la carga: P-3 sí puede cargarse después.
select pg_temp.como('d1000000-0000-0000-0000-000000000002');
select is(
  (public.aplicar_carga_inicial_stock(pg_temp.dep1(),
     '[{"fila":1,"sku":"P-3","cantidad":"9"}]'::jsonb, 'c1000000-0000-0000-0000-000000000003') ->> 'aplicadas')::int,
  1, 'un producto que estuvo «Sin cambios» todavía puede tener su carga inicial'
);
reset role;
select is((select cantidad from dominio.existencias where producto_id = 'a1000000-0000-0000-0000-000000000003'), 9, 'P-3 quedó en 9');

-- ============================================================================
-- Inmutabilidad y otra organización (SC-003)
-- ============================================================================

select throws_ok(
  $$update dominio.cargas_iniciales_stock set cantidad = 99$$,
  '42501', 'Las cargas iniciales de stock no se pueden modificar', 'las cargas no se editan'
);
select throws_ok(
  $$delete from dominio.cargas_iniciales_stock$$,
  '42501', 'Las cargas iniciales de stock no se pueden modificar', 'las cargas no se borran'
);

select pg_temp.como('d1000000-0000-0000-0000-000000000003');
select is((select count(*)::int from dominio.cargas_iniciales_stock), 3, 'lectura ve las cargas de su organización');
reset role;

select pg_temp.como('d1000000-0000-0000-0000-000000000004');
select is((select count(*)::int from dominio.cargas_iniciales_stock), 0, 'otra organización no ve cargas ajenas');
select throws_ok(
  $$select public.aplicar_carga_inicial_stock(pg_temp.dep1(), '[{"fila":1,"sku":"P-1","cantidad":"1"}]'::jsonb)$$,
  '22023', 'Elegí un depósito activo para la carga', 'otra organización no puede usar un depósito ajeno'
);
select is(
  (select mensaje from public.validar_carga_stock(
     (select id from dep where organizacion_id = '22222222-2222-2222-2222-222222222222'),
     '[{"fila":1,"sku":"P-1","cantidad":"1"}]'::jsonb)),
  'SKU no existe', 'otra organización no ve los productos de la uno'
);
reset role;
select is((select cantidad from dominio.existencias where producto_id = 'a1000000-0000-0000-0000-000000000001'), 8, 'la organización dos no afectó el stock de la uno');

select * from finish();

rollback;
