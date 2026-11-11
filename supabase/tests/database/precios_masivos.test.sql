-- F-PRE-10 (MSF-436, épica MSF-363): actualización masiva de costos y precios.
-- Cubre FR-002, FR-004…FR-009 / SC-001: vista previa que no escribe, porcentaje sube/baja con
-- alcance todos/categoría, redondeo a 2 decimales, −100 % rechazado, planilla con errores por fila,
-- atomicidad con falla provocada, idempotencia por clave, conflicto 40001 por updated_at, 42501 sin
-- permiso, costo solo con `rentabilidad`, lote y evento sin importes de costo, aislamiento entre
-- organizaciones y `anon` sin ejecución.
begin;

select plan(64);

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

insert into dominio.empresas (id, organizacion_id, nombre) values
  ('e1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'Tienda Uno'),
  ('e1000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'Tienda Dos'),
  ('e2000000-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', 'Tienda Ajena');

insert into dominio.categorias (id, organizacion_id, nombre, padre_id) values
  ('c1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'Accesorios', null);
insert into dominio.categorias (id, organizacion_id, nombre, padre_id) values
  ('c1000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'Cables', 'c1000000-0000-0000-0000-000000000001');

-- Todos en pesos: el neto de cada empresa es la lista (sin regla).
-- A (cat. raíz) · B (subcategoría) · C (sin categoría ni costo) · D inactivo · E de otra organización.
insert into dominio.productos (id, organizacion_id, nombre, sku, moneda, precio_lista) values
  ('a1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'Producto A', 'MA-1', 'ARS', 100),
  ('a1000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'Producto B', 'MA-2', 'ARS', 50),
  ('a1000000-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111', 'Producto C', 'MA-3', 'ARS', 10.05),
  ('a1000000-0000-0000-0000-000000000004', '11111111-1111-1111-1111-111111111111', 'Producto D', 'MA-4', 'ARS', 5),
  ('a2000000-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', 'Producto E', 'MB-1', 'ARS', 20);
update dominio.productos set activo = false where id = 'a1000000-0000-0000-0000-000000000004';
update dominio.productos set categoria_id = 'c1000000-0000-0000-0000-000000000001' where id = 'a1000000-0000-0000-0000-000000000001';
update dominio.productos set categoria_id = 'c1000000-0000-0000-0000-000000000002' where id = 'a1000000-0000-0000-0000-000000000002';

insert into dominio.producto_costos (producto_id, organizacion_id, costo) values
  ('a1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 60),
  ('a1000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 20),
  ('a2000000-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', 5);

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

-- Versiones (updated_at) que devolvió la vista previa, como las reenvía el cliente al confirmar.
create function pg_temp.versiones(p_vista jsonb) returns jsonb language sql as $$
  select coalesce(jsonb_object_agg(f->>'producto_id', f->'actualizado'), '{}'::jsonb)
    from jsonb_array_elements(p_vista->'filas') f
   where f->>'producto_id' is not null
$$;

-- Vista previa + confirmación en un paso (lo que hace la pantalla).
create function pg_temp.aplicar(p_modo text, p_parametros jsonb, p_clave uuid) returns jsonb language sql as $$
  select public.aplicar_actualizacion_precios(
    p_modo,
    p_parametros || jsonb_build_object('versiones', pg_temp.versiones(public.previsualizar_actualizacion_precios(p_modo, p_parametros))),
    p_clave
  )
$$;

-- ============================================================================
-- Administrador: vista previa por porcentaje (no escribe)
-- ============================================================================

select pg_temp.como('d1000000-0000-0000-0000-000000000001');

select is(
  (public.previsualizar_actualizacion_precios('porcentaje',
    '{"cambia":"precio_lista","alcance":"todos","porcentaje":10}'::jsonb)->>'afectados')::int,
  3, 'porcentaje sobre todos: afecta a los 3 productos activos (el inactivo queda afuera)'
);
select is(
  (select f->>'lista_despues' from jsonb_array_elements(public.previsualizar_actualizacion_precios('porcentaje',
    '{"cambia":"precio_lista","alcance":"todos","porcentaje":10}'::jsonb)->'filas') f where f->>'sku' = 'MA-3')::numeric,
  11.06, 'redondeo a 2 decimales: 10,05 × 1,10 = 11,055 → 11,06'
);
select is(
  (select f->>'lista_despues' from jsonb_array_elements(public.previsualizar_actualizacion_precios('porcentaje',
    '{"cambia":"precio_lista","alcance":"todos","porcentaje":-10}'::jsonb)->'filas') f where f->>'sku' = 'MA-1')::numeric,
  90.00, 'el porcentaje también baja: −10 % sobre 100 = 90'
);
select is(
  (select precio_lista from dominio.productos where id = 'a1000000-0000-0000-0000-000000000001'),
  100.00::numeric, 'la vista previa no cambia ninguna fila'
);
select is(
  (public.previsualizar_actualizacion_precios('porcentaje',
    jsonb_build_object('cambia', 'precio_lista', 'alcance', 'c1000000-0000-0000-0000-000000000001', 'porcentaje', 5))->>'afectados')::int,
  2, 'alcance categoría: incluye sus subcategorías (A y B)'
);
select is(
  (public.previsualizar_actualizacion_precios('porcentaje',
    jsonb_build_object('cambia', 'precio_lista', 'alcance', 'c1000000-0000-0000-0000-000000000002', 'porcentaje', 5))->>'afectados')::int,
  1, 'alcance subcategoría: solo B'
);
select is(
  (select f->>'costo_despues' from jsonb_array_elements(public.previsualizar_actualizacion_precios('porcentaje',
    '{"cambia":"ambos","alcance":"todos","porcentaje":-10}'::jsonb)->'filas') f where f->>'sku' = 'MA-1')::numeric,
  54.00, 'con Rentabilidad la vista previa muestra el costo antes → después'
);
select throws_ok(
  $$select public.previsualizar_actualizacion_precios('porcentaje', '{"cambia":"precio_lista","alcance":"todos","porcentaje":-100}'::jsonb)$$,
  '22023', null, 'un porcentaje de −100 % se rechaza'
);
select is(
  (public.previsualizar_actualizacion_precios('porcentaje',
    '{"cambia":"precio_lista","alcance":"todos","porcentaje":-99.99}'::jsonb)->>'con_error')::int,
  1, 'el producto cuyo precio quedaría en cero se informa como error por fila (C: 10,05 × 0,0001 = 0,00)'
);

-- ============================================================================
-- Planilla: errores por fila
-- ============================================================================

select is(
  (public.previsualizar_actualizacion_precios('planilla', $j${"filas":[
    {"fila":2,"sku":"MA-1","precio_lista":120},
    {"fila":3,"sku":"NO-EXISTE","precio_lista":5},
    {"fila":4,"sku":"MA-2","precio_lista":-1},
    {"fila":5,"sku":"MA-3","costo":-2},
    {"fila":6,"sku":"MB-1","precio_lista":9}
  ]}$j$::jsonb)->>'con_error')::int,
  4, 'planilla: SKU inexistente, lista ≤ 0, costo < 0 y SKU de otra organización son errores por fila'
);
select is(
  (select f->>'error' from jsonb_array_elements(public.previsualizar_actualizacion_precios('planilla',
    '{"filas":[{"fila":7,"sku":"NO-EXISTE","precio_lista":5}]}'::jsonb)->'filas') f),
  'No existe un producto con ese SKU', 'el error de la fila 7 se informa con su número y motivo'
);
select is(
  (public.previsualizar_actualizacion_precios('planilla', $j${"filas":[
    {"fila":2,"sku":"MA-1","precio_lista":120},
    {"fila":3,"sku":" ma-1 ","precio_lista":130}
  ]}$j$::jsonb)->>'con_error')::int,
  2, 'SKU repetido en la planilla: las dos filas quedan con error'
);
select throws_ok(
  $$select public.aplicar_actualizacion_precios('planilla',
    '{"filas":[{"fila":2,"sku":"MA-1","precio_lista":120},{"fila":3,"sku":"NO-EXISTE","precio_lista":5}],"versiones":{}}'::jsonb,
    '10000000-0000-4000-8000-000000000001')$$,
  '22023', null, 'una fila con error bloquea la confirmación'
);
select is(
  (select precio_lista from dominio.productos where id = 'a1000000-0000-0000-0000-000000000001'),
  100.00::numeric, 'con una fila inválida no se aplica ni la fila válida (todo o nada)'
);

-- ============================================================================
-- Aplicar: porcentaje, solo lista y costo, empresas consistentes
-- ============================================================================

select lives_ok(
  $$select pg_temp.aplicar('porcentaje', '{"cambia":"precio_lista","alcance":"todos","porcentaje":10}'::jsonb,
      '20000000-0000-4000-8000-000000000001')$$,
  'administrador: aplica +10 % sobre el precio de lista'
);
select is(
  (select array_agg(precio_lista order by sku) from dominio.productos where organizacion_id = '11111111-1111-1111-1111-111111111111'),
  array[110.00, 55.00, 11.06, 5.00]::numeric[], 'lista nueva en A, B y C; el inactivo D queda igual'
);
select is(
  (select array_agg(costo order by producto_id) from dominio.producto_costos where organizacion_id = '11111111-1111-1111-1111-111111111111'),
  array[60.00, 20.00]::numeric[], 'cambiando solo la lista, el costo no se toca'
);
select is(
  (select array_agg(moneda) from dominio.productos where organizacion_id = '11111111-1111-1111-1111-111111111111' and activo),
  array['ARS', 'ARS', 'ARS'], 'la moneda queda intacta'
);
select is(
  (select count(*)::int from dominio.precios_empresa), 0, 'los precios por empresa (reglas) no se tocan'
);
select is(
  (select array_agg(neto_ars order by empresa_id) from public.precios_empresa_neto where producto_id = 'a1000000-0000-0000-0000-000000000001'),
  array[110.00, 110.00]::numeric[], 'dos empresas leen de inmediato el precio nuevo'
);
select is(
  (select count(*)::int from dominio.actualizaciones_precio), 1, 'el lote queda registrado'
);
select is(
  (select cantidad from dominio.actualizaciones_precio), 3, 'el lote cuenta los 3 productos cambiados'
);
select is(
  (select actor_nombre from dominio.actualizaciones_precio), 'administrador@example.com', 'el lote guarda el autor'
);
select is(
  (select count(*)::int from public.registro_actividad where tipo = 'precios.actualizacion_masiva'),
  1, 'el lote genera un evento de actividad'
);
select is(
  (select detalle from public.registro_actividad where tipo = 'precios.actualizacion_masiva'),
  'Actualización masiva de precios por porcentaje (10 %): 3 producto(s)', 'el evento no lleva importes de costo'
);
select is(
  (select count(*)::int from public.registro_actividad where tipo = 'producto.precio_actualizado'),
  3, 'cada producto con cambio real deja su evento de precio y el inactivo no deja ninguno'
);

-- Idempotencia: la misma clave no vuelve a aplicar.
select is(
  (pg_temp.aplicar('porcentaje', '{"cambia":"precio_lista","alcance":"todos","porcentaje":10}'::jsonb,
     '20000000-0000-4000-8000-000000000001')->>'repetido')::boolean,
  true, 'repetir la clave devuelve el lote ya aplicado'
);
select is(
  (select precio_lista from dominio.productos where id = 'a1000000-0000-0000-0000-000000000001'),
  110.00::numeric, 'el reintento no aplica el +10 % por segunda vez'
);
select is(
  (select count(*)::int from dominio.actualizaciones_precio), 1, 'el reintento no duplica el lote'
);

-- Sin cambio real: ni lote ni evento.
select throws_ok(
  $$select pg_temp.aplicar('porcentaje', '{"cambia":"precio_lista","alcance":"todos","porcentaje":0}'::jsonb,
      '20000000-0000-4000-8000-000000000002')$$,
  '22023', 'No hay cambios para aplicar', 'un lote sin cambio real se rechaza'
);

-- ============================================================================
-- Aplicar: costo con Rentabilidad
-- ============================================================================

select lives_ok(
  $$select pg_temp.aplicar('porcentaje', '{"cambia":"costo","alcance":"todos","porcentaje":-10}'::jsonb,
      '20000000-0000-4000-8000-000000000003')$$,
  'administrador: baja los costos 10 %'
);
select is(
  (select array_agg(costo order by producto_id) from dominio.producto_costos where organizacion_id = '11111111-1111-1111-1111-111111111111'),
  array[54.00, 18.00]::numeric[], 'el costo se actualiza solo donde existe'
);
select is(
  (select precio_lista from dominio.productos where id = 'a1000000-0000-0000-0000-000000000001'),
  110.00::numeric, 'al cambiar solo el costo, la lista no se toca'
);
select is(
  (select count(*)::int from public.registro_actividad where tipo = 'precios.actualizacion_masiva' and detalle ~ '\d+[,.]\d{2}\b'),
  0, 'ningún evento del lote lleva importes'
);

-- Planilla: lista y costo por SKU.
select lives_ok(
  $$select pg_temp.aplicar('planilla', '{"filas":[
      {"fila":2,"sku":"MA-1","precio_lista":200,"costo":120},
      {"fila":3,"sku":"MA-3","costo":7.5}]}'::jsonb,
      '20000000-0000-4000-8000-000000000004')$$,
  'administrador: aplica una planilla con lista y costo'
);
select is(
  (select precio_lista from dominio.productos where id = 'a1000000-0000-0000-0000-000000000001'),
  200.00::numeric, 'planilla: lista nueva de A'
);
select is(
  (select costo from dominio.producto_costos where producto_id = 'a1000000-0000-0000-0000-000000000003'),
  7.50::numeric, 'planilla: crea el costo de un producto que no tenía'
);
select is(
  (select parametros from dominio.actualizaciones_precio where clave = '20000000-0000-4000-8000-000000000004'),
  '{"filas": 2}'::jsonb, 'el lote de planilla guarda solo la cantidad de filas (sin costos)'
);

-- ============================================================================
-- Conflicto y atomicidad con falla provocada
-- ============================================================================

create temp table vista_conflicto as
  select public.previsualizar_actualizacion_precios('porcentaje',
    '{"cambia":"precio_lista","alcance":"todos","porcentaje":50}'::jsonb) as vista;
grant select on vista_conflicto to authenticated;

reset role;
update dominio.productos set precio_lista = 51 where id = 'a1000000-0000-0000-0000-000000000002';
select pg_temp.como('d1000000-0000-0000-0000-000000000001');

select throws_ok(
  $$select public.aplicar_actualizacion_precios('porcentaje',
      '{"cambia":"precio_lista","alcance":"todos","porcentaje":50}'::jsonb
      || jsonb_build_object('versiones', pg_temp.versiones((select vista from vista_conflicto))),
      '20000000-0000-4000-8000-000000000005')$$,
  '40001', null, 'un producto cambió desde la vista previa: conflicto 40001'
);
select is(
  (select precio_lista from dominio.productos where id = 'a1000000-0000-0000-0000-000000000001'),
  200.00::numeric, 'la falla a mitad de camino deshace también el producto ya recorrido (atomicidad)'
);
select is(
  (select count(*)::int from dominio.actualizaciones_precio where clave = '20000000-0000-4000-8000-000000000005'),
  0, 'el lote en conflicto no queda registrado'
);

-- ============================================================================
-- Operador: sin Rentabilidad no ve ni cambia costos
-- ============================================================================

select pg_temp.como('d1000000-0000-0000-0000-000000000002');

select is(
  (public.previsualizar_actualizacion_precios('porcentaje',
    '{"cambia":"precio_lista","alcance":"todos","porcentaje":10}'::jsonb)->'filas'->0) ? 'costo_antes',
  false, 'sin Rentabilidad la vista previa omite el costo'
);
select throws_ok(
  $$select public.previsualizar_actualizacion_precios('porcentaje', '{"cambia":"ambos","alcance":"todos","porcentaje":10}'::jsonb)$$,
  '42501', null, 'sin Rentabilidad no se puede previsualizar un cambio que toca costos (ni «ambos»): lo mismo que aplicar'
);
select throws_ok(
  $$select public.previsualizar_actualizacion_precios('porcentaje', '{"cambia":"costo","alcance":"todos","porcentaje":10}'::jsonb)$$,
  '42501', null, 'sin Rentabilidad no se puede previsualizar un cambio de costo'
);
select throws_ok(
  $$select pg_temp.aplicar('porcentaje', '{"cambia":"ambos","alcance":"todos","porcentaje":10}'::jsonb,
      '30000000-0000-4000-8000-000000000001')$$,
  '42501', null, 'sin Rentabilidad la aplicación rechaza tocar costos'
);
select throws_ok(
  $$select pg_temp.aplicar('planilla', '{"filas":[{"fila":2,"sku":"MA-1","costo":1}]}'::jsonb,
      '30000000-0000-4000-8000-000000000002')$$,
  '42501', null, 'sin Rentabilidad la planilla con costo se rechaza'
);
select lives_ok(
  $$select pg_temp.aplicar('planilla', '{"filas":[{"fila":2,"sku":"MA-1","precio_lista":210}]}'::jsonb,
      '30000000-0000-4000-8000-000000000003')$$,
  'el operador sí puede cambiar precios de lista'
);

-- ============================================================================
-- Revisión de MSF-363: con Rentabilidad en LECTURA la vista previa exige lo mismo que aplicar
-- ============================================================================

reset role;
update public.permisos_rol set nivel = 'lectura'
 where organizacion_id = '11111111-1111-1111-1111-111111111111' and rol_id = 'operador' and seccion = 'rentabilidad';
select pg_temp.como('d1000000-0000-0000-0000-000000000002');

select is(
  (public.previsualizar_actualizacion_precios('porcentaje',
    '{"cambia":"precio_lista","alcance":"todos","porcentaje":10}'::jsonb)->'filas'->0) ? 'costo_antes',
  true, 'con Rentabilidad en lectura la vista previa de un cambio de precio sí muestra el costo'
);
select throws_ok(
  $$select public.previsualizar_actualizacion_precios('porcentaje', '{"cambia":"ambos","alcance":"todos","porcentaje":10}'::jsonb)$$,
  '42501', null, 'con Rentabilidad en lectura no se previsualiza «ambos»: antes respondía y aplicar daba 42501'
);
select throws_ok(
  $$select public.previsualizar_actualizacion_precios('planilla', '{"filas":[{"fila":2,"sku":"MA-1","costo":1}]}'::jsonb)$$,
  '42501', null, 'ni una planilla con costo'
);
select throws_ok(
  $$select pg_temp.aplicar('porcentaje', '{"cambia":"ambos","alcance":"todos","porcentaje":10}'::jsonb,
      '30000000-0000-4000-8000-000000000009')$$,
  '42501', null, 'y aplicar sigue rechazándolo: vista previa y aplicar coinciden'
);

-- Tope de la planilla: 5.001 filas se rechazan (54000) antes de calcular nada.
select throws_ok(
  $$select public.previsualizar_actualizacion_precios('planilla', jsonb_build_object('filas',
      (select jsonb_agg(jsonb_build_object('fila', n + 1, 'sku', 'TOPE-' || n, 'precio_lista', 1)) from generate_series(1, 5001) n)))$$,
  '54000', null, 'una planilla de 5.001 filas se rechaza: el tope es de 5.000'
);

reset role;
update public.permisos_rol set nivel = 'ninguno'
 where organizacion_id = '11111111-1111-1111-1111-111111111111' and rol_id = 'operador' and seccion = 'rentabilidad';

-- ============================================================================
-- Consulta: solo lectura
-- ============================================================================

select pg_temp.como('d1000000-0000-0000-0000-000000000003');

select throws_ok(
  $$select public.previsualizar_actualizacion_precios('porcentaje', '{"cambia":"precio_lista","alcance":"todos","porcentaje":10}'::jsonb)$$,
  '42501', null, 'consulta: no puede previsualizar'
);
select throws_ok(
  $$select public.aplicar_actualizacion_precios('porcentaje', '{"cambia":"precio_lista","alcance":"todos","porcentaje":10,"versiones":{}}'::jsonb,
      '30000000-0000-4000-8000-000000000004')$$,
  '42501', null, 'consulta: no puede aplicar'
);
select is(
  (select count(*)::int from dominio.actualizaciones_precio), 4, 'consulta: sí lee el historial de lotes'
);
select throws_ok(
  $$insert into dominio.actualizaciones_precio (organizacion_id, modo, cantidad, clave)
    values ('11111111-1111-1111-1111-111111111111', 'planilla', 1, gen_random_uuid())$$,
  '42501', null, 'nadie escribe el registro de lotes de forma directa'
);

-- ============================================================================
-- Aislamiento entre organizaciones
-- ============================================================================

select pg_temp.como('d2000000-0000-0000-0000-000000000001');

select is(
  (select count(*)::int from dominio.actualizaciones_precio), 0, 'otra organización no ve los lotes'
);
select is(
  (public.previsualizar_actualizacion_precios('porcentaje',
    '{"cambia":"precio_lista","alcance":"todos","porcentaje":10}'::jsonb)->>'afectados')::int,
  1, 'otra organización solo previsualiza sus propios productos'
);
select is(
  (public.previsualizar_actualizacion_precios('planilla', '{"filas":[{"fila":2,"sku":"MA-1","precio_lista":1}]}'::jsonb)->>'con_error')::int,
  1, 'otra organización no encuentra los SKU ajenos'
);

-- ============================================================================
-- anon
-- ============================================================================

reset role;

select is(
  has_function_privilege('anon', 'public.previsualizar_actualizacion_precios(text, jsonb)', 'execute'),
  false, 'anon no ejecuta previsualizar_actualizacion_precios'
);
select is(
  has_function_privilege('anon', 'public.aplicar_actualizacion_precios(text, jsonb, uuid)', 'execute'),
  false, 'anon no ejecuta aplicar_actualizacion_precios'
);
select is(
  has_table_privilege('anon', 'dominio.actualizaciones_precio', 'select'),
  false, 'anon no lee actualizaciones_precio'
);
select is(
  has_function_privilege('authenticated', 'private.calcular_actualizacion_precios(uuid, boolean, text, jsonb)', 'execute'),
  false, 'el núcleo de cálculo no es ejecutable desde la app'
);
select is(
  (select relrowsecurity from pg_class where oid = 'dominio.actualizaciones_precio'::regclass),
  true, 'actualizaciones_precio tiene RLS'
);

select * from finish();
rollback;
