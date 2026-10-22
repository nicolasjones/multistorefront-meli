-- F-PRE-12 (MSF-200, épica MSF-114): IVA por categoría y precio final.
-- Cubre FR-015…FR-019 / SC-005: aislamiento en `alicuotas_iva`, herencia producto/categoría,
-- 29.186 → 35.315 al 21 %, Exento, interruptor distinto por empresa, margen invariable,
-- evento de actividad y `anon` sin ejecución. `rls_en_toda_tabla` cubre además que la tabla
-- nueva tenga RLS.
begin;

select plan(60);

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

-- E1 Mundo JC · E2 San Javucho (org 1) · E3 (org 2).
insert into dominio.empresas (id, organizacion_id, nombre) values
  ('e1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'Mundo JC'),
  ('e1000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'San Javucho'),
  ('e2000000-0000-0000-0000-000000000003', '22222222-2222-2222-2222-222222222222', 'Empresa Dos');

-- C1 Joysticks (queda en 21 % por defecto) · C2 Libros · C3 de la org 2.
insert into dominio.categorias (id, organizacion_id, nombre) values
  ('c1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'Joysticks'),
  ('c1000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'Libros'),
  ('c2000000-0000-0000-0000-000000000003', '22222222-2222-2222-2222-222222222222', 'Ajena');

-- P1 Joystick (C1) · P2 Cable (C1, con IVA propio más adelante) · P3 Manual (C2) · P4 org 2.
-- Todos en ARS con neto 29.186 (P4: 1.000). P1 con costo 20.000.
insert into dominio.productos (id, organizacion_id, nombre, sku, moneda, precio_lista, categoria_id) values
  ('a1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'Joystick', 'JOY-1', 'ARS', 29186, 'c1000000-0000-0000-0000-000000000001'),
  ('a1000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'Cable', 'CAB-1', 'ARS', 29186, 'c1000000-0000-0000-0000-000000000001'),
  ('a1000000-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111', 'Manual', 'MAN-1', 'ARS', 29186, 'c1000000-0000-0000-0000-000000000002'),
  ('a2000000-0000-0000-0000-000000000004', '22222222-2222-2222-2222-222222222222', 'Teclado', 'TEC-1', 'ARS', 1000, 'c2000000-0000-0000-0000-000000000003');
insert into dominio.producto_costos (producto_id, organizacion_id, costo) values
  ('a1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 20000);

create function pg_temp.como(p_user uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
  set local role authenticated;
end $$;

-- ============================================================================
-- Estructura y sembrado (FR-015)
-- ============================================================================

select is(
  (select relrowsecurity from pg_class where oid = 'dominio.alicuotas_iva'::regclass),
  true, 'alicuotas_iva tiene RLS'
);
select is(
  (select n.nspname::text from pg_class c join pg_namespace n on n.oid = c.relnamespace where c.oid = 'dominio.alicuotas_iva'::regclass),
  'dominio', 'alicuotas_iva vive en el esquema dominio'
);
select is(
  (select array_agg(nombre order by nombre) from dominio.alicuotas_iva where organizacion_id = '11111111-1111-1111-1111-111111111111'),
  array['10,5 %', '21 %', 'Exento'], 'organización existente o nueva: 21 %, 10,5 % y Exento'
);
select is(
  (select count(*)::int from dominio.alicuotas_iva where organizacion_id = '22222222-2222-2222-2222-222222222222'),
  3, 'la otra organización también se siembra (disparador)'
);
select is(
  (select exento from dominio.alicuotas_iva where organizacion_id = '11111111-1111-1111-1111-111111111111' and nombre = 'Exento'),
  true, 'Exento está marcada como exenta'
);
select is(
  (select a.nombre from dominio.categorias c join dominio.alicuotas_iva a on a.id = c.alicuota_iva_id
    where c.id = 'c1000000-0000-0000-0000-000000000001'),
  '21 %', 'una categoría nueva nace en 21 %'
);

-- ============================================================================
-- Administrador (org 1)
-- ============================================================================

select pg_temp.como('d1000000-0000-0000-0000-000000000001');

select is((select count(*)::int from dominio.alicuotas_iva), 3, 'administrador: ve las 3 alícuotas de su organización');
select is(
  (select count(*)::int from dominio.alicuotas_iva where organizacion_id = '22222222-2222-2222-2222-222222222222'),
  0, 'aislamiento: no ve las alícuotas de la otra organización'
);
select throws_ok(
  $$insert into dominio.alicuotas_iva (organizacion_id, nombre, porcentaje) values ('11111111-1111-1111-1111-111111111111', '27 %', 27)$$,
  '42501', null, 'sin escritura desde la app: no inserta alícuotas'
);
select throws_ok(
  $$update dominio.alicuotas_iva set porcentaje = 1 where nombre = '21 %'$$,
  '42501', null, 'sin escritura desde la app: no edita alícuotas'
);
select throws_ok(
  $$delete from dominio.alicuotas_iva where nombre = '21 %'$$,
  '42501', null, 'sin escritura desde la app: no borra alícuotas'
);

-- Herencia (FR-017): P1 sin IVA propio usa el de su categoría (21 %).
select is(
  (select nombre from private.alicuota_producto('a1000000-0000-0000-0000-000000000001')),
  '21 %', 'P1 sin IVA propio hereda 21 % de Joysticks'
);

-- 29.186 → 35.315 al 21 % (US3-3); sin regla de empresa el neto es el central.
select is(
  (select neto_ars from public.precios_empresa_final
    where producto_id = 'a1000000-0000-0000-0000-000000000001' and empresa_id = 'e1000000-0000-0000-0000-000000000001'),
  29186.00, 'neto 29.186'
);
select is(
  (select final_ars from public.precios_empresa_final
    where producto_id = 'a1000000-0000-0000-0000-000000000001' and empresa_id = 'e1000000-0000-0000-0000-000000000001'),
  35315.00, 'final: 29.186 al 21 % = 35.315'
);
select is(
  (select mostrar_con_iva from public.precios_empresa_final
    where producto_id = 'a1000000-0000-0000-0000-000000000001' and empresa_id = 'e1000000-0000-0000-0000-000000000001'),
  false, 'el interruptor arranca en «Sin IVA»'
);
select is(
  (select visible_ars from public.precios_empresa_final
    where producto_id = 'a1000000-0000-0000-0000-000000000001' and empresa_id = 'e1000000-0000-0000-0000-000000000001'),
  29186.00, 'Sin IVA: el cliente ve el neto'
);

-- Margen sobre el neto (antes del interruptor).
select is(
  (select margen from public.productos_precio_costo where producto_id = 'a1000000-0000-0000-0000-000000000001'),
  round((29186 - 20000) / 29186.0, 4), 'margen sobre el neto'
);

-- Interruptor distinto por empresa (US3-5): Mundo JC con IVA incluido, San Javucho sin IVA.
select lives_ok(
  $$select public.guardar_regla_precio_empresa('e1000000-0000-0000-0000-000000000001', 'central', 0, null, true)$$,
  'administrador: Mundo JC pasa a «Con IVA incluido»'
);
select is(
  (select visible_ars from public.precios_empresa_final
    where producto_id = 'a1000000-0000-0000-0000-000000000001' and empresa_id = 'e1000000-0000-0000-0000-000000000001'),
  35315.00, 'Con IVA incluido: el cliente ve 35.315'
);
select is(
  (select visible_ars from public.precios_empresa_final
    where producto_id = 'a1000000-0000-0000-0000-000000000001' and empresa_id = 'e1000000-0000-0000-0000-000000000002'),
  29186.00, 'San Javucho sigue en «Sin IVA»: mismo producto, otro precio visible'
);
select is(
  (select margen from public.productos_precio_costo where producto_id = 'a1000000-0000-0000-0000-000000000001'),
  round((29186 - 20000) / 29186.0, 4), 'el margen no cambia con el interruptor'
);

-- El interruptor entra en la idempotencia y en el bloqueo optimista; null = sin cambio.
select lives_ok(
  $$select public.guardar_regla_precio_empresa('e1000000-0000-0000-0000-000000000001', 'central', 0,
      (select updated_at from dominio.precios_empresa where empresa_id = 'e1000000-0000-0000-0000-000000000001'))$$,
  'guardar la regla sin tocar el interruptor (null) lo conserva'
);
select is(
  (select mostrar_con_iva from dominio.precios_empresa where empresa_id = 'e1000000-0000-0000-0000-000000000001'),
  true, 'p_mostrar_con_iva nulo = sin cambio'
);
select throws_ok(
  $$select public.guardar_regla_precio_empresa('e1000000-0000-0000-0000-000000000001', 'central', 0, null, false)$$,
  '40001', null, 'cambiar el interruptor sin updated_at vigente: conflicto de edición'
);

-- IVA propio manda sobre el de la categoría (US3-2): 29.186 × 1,105 = 32.250,53 → 32.251.
select lives_ok(
  $$select public.asignar_alicuota_producto('a1000000-0000-0000-0000-000000000002',
      (select id from dominio.alicuotas_iva where organizacion_id = '11111111-1111-1111-1111-111111111111' and nombre = '10,5 %'))$$,
  'administrador: Cable con IVA propio 10,5 %'
);
select is(
  (select nombre from private.alicuota_producto('a1000000-0000-0000-0000-000000000002')),
  '10,5 %', 'el IVA del producto manda sobre el de la categoría'
);
select is(
  (select final_ars from public.precios_empresa_final
    where producto_id = 'a1000000-0000-0000-0000-000000000002' and empresa_id = 'e1000000-0000-0000-0000-000000000001'),
  32251.00, 'final al 10,5 %: 29.186 → 32.251 (peso entero)'
);

-- Exento (US3-4): final = neto.
select lives_ok(
  $$select public.guardar_alicuota_categoria('c1000000-0000-0000-0000-000000000002',
      (select id from dominio.alicuotas_iva where organizacion_id = '11111111-1111-1111-1111-111111111111' and nombre = 'Exento'))$$,
  'administrador: la categoría Libros pasa a Exento'
);
select is(
  (select final_ars from public.precios_empresa_final
    where producto_id = 'a1000000-0000-0000-0000-000000000003' and empresa_id = 'e1000000-0000-0000-0000-000000000001'),
  29186.00, 'Exento: neto y final coinciden'
);
select is(
  (select alicuota_exenta from public.precios_empresa_final
    where producto_id = 'a1000000-0000-0000-0000-000000000003' and empresa_id = 'e1000000-0000-0000-0000-000000000001'),
  true, 'la vista marca la alícuota exenta'
);

-- La vista previa (ajuste sin guardar) calcula el final con la misma fórmula.
select is(
  (select final_ars from public.previsualizar_precios_empresa('e1000000-0000-0000-0000-000000000001', 'central', 0, 20)
    where producto_id = 'a1000000-0000-0000-0000-000000000002'),
  32251.00, 'vista previa: final de Cable al 10,5 %'
);
select is(
  (select final_ars from public.previsualizar_precios_empresa('e1000000-0000-0000-0000-000000000001', 'central', 0, 20)
    where producto_id = 'a1000000-0000-0000-0000-000000000003'),
  29186.00, 'vista previa: Exento, final = neto'
);

-- Cambiar la alícuota de la categoría la hereda el producto sin IVA propio; el propio no cambia.
select set_config('prueba.cat_ts',
  (select updated_at::text from dominio.categorias where id = 'c1000000-0000-0000-0000-000000000002'), true);
select lives_ok(
  $$select public.guardar_alicuota_categoria('c1000000-0000-0000-0000-000000000001',
      (select id from dominio.alicuotas_iva where organizacion_id = '11111111-1111-1111-1111-111111111111' and nombre = 'Exento'))$$,
  'administrador: Joysticks pasa a Exento'
);
select is(
  (select nombre from private.alicuota_producto('a1000000-0000-0000-0000-000000000001')),
  'Exento', 'P1 sin IVA propio hereda el cambio de la categoría'
);
select is(
  (select nombre from private.alicuota_producto('a1000000-0000-0000-0000-000000000002')),
  '10,5 %', 'Cable conserva su IVA propio'
);
select lives_ok(
  $$select public.guardar_alicuota_categoria('c1000000-0000-0000-0000-000000000002',
      (select id from dominio.alicuotas_iva where organizacion_id = '11111111-1111-1111-1111-111111111111' and nombre = 'Exento'))$$,
  'repetir la misma alícuota es idempotente'
);
select is(
  (select updated_at::text from dominio.categorias where id = 'c1000000-0000-0000-0000-000000000002'),
  current_setting('prueba.cat_ts'), 'idempotente: la categoría no se toca'
);

-- Quitar el IVA propio vuelve a heredar; repetirlo no genera otro evento.
select lives_ok(
  $$select public.asignar_alicuota_producto('a1000000-0000-0000-0000-000000000002', null)$$,
  'administrador: Cable vuelve a heredar de la categoría'
);
select is(
  (select nombre from private.alicuota_producto('a1000000-0000-0000-0000-000000000002')),
  'Exento', 'sin IVA propio, Cable hereda de Joysticks'
);
select lives_ok(
  $$select public.asignar_alicuota_producto('a1000000-0000-0000-0000-000000000002', null)$$,
  'quitar un IVA que no hay es idempotente'
);

-- Errores: ajeno, inexistente.
select throws_ok(
  $$select public.asignar_alicuota_producto('a2000000-0000-0000-0000-000000000004', null)$$,
  'P0002', null, 'no asigna IVA a un producto de otra organización'
);
select throws_ok(
  $$select public.guardar_alicuota_categoria('c2000000-0000-0000-0000-000000000003',
      (select id from dominio.alicuotas_iva where organizacion_id = '11111111-1111-1111-1111-111111111111' and nombre = '21 %'))$$,
  'P0002', null, 'no asigna IVA a una categoría de otra organización'
);
select throws_ok(
  $$select public.guardar_alicuota_categoria('c1000000-0000-0000-0000-000000000001',
      (select id from dominio.alicuotas_iva where organizacion_id = '22222222-2222-2222-2222-222222222222' and nombre = '21 %'))$$,
  'P0002', null, 'no usa una alícuota de otra organización'
);
reset role;

-- ============================================================================
-- Evento de actividad (FR-017, FR-018): solo ante cambios reales
-- ============================================================================

select is(
  (select count(*)::int from registro_actividad
    where tipo = 'producto.precio_actualizado' and detalle like 'Cambió el IVA de Cable:%'),
  2, 'Cable: dos cambios reales de IVA (propio y vuelta a heredar), dos eventos; repetir no suma'
);
select ok(
  (select bool_or(strpos(detalle, 'Cambió el IVA de Cable: el de la categoría → 10,5 %') > 0)
     from registro_actividad where tipo = 'producto.precio_actualizado'),
  'el evento registra el antes y el después'
);
select is(
  (select count(*)::int from registro_actividad
    where tipo = 'empresa.regla_precio_actualizada' and detalle like '%pasaron a Con IVA incluido'),
  1, 'el interruptor deja su propio evento'
);

-- ============================================================================
-- Sin permiso: consulta (lectura) y operador (sin sección empresas)
-- ============================================================================

select pg_temp.como('d1000000-0000-0000-0000-000000000003');
select is((select count(*)::int from dominio.alicuotas_iva), 3, 'consulta: ve las alícuotas');
select throws_ok(
  $$select public.guardar_alicuota_categoria('c1000000-0000-0000-0000-000000000001',
      (select id from dominio.alicuotas_iva where nombre = '21 %'))$$,
  '42501', null, 'consulta: no cambia el IVA de la categoría'
);
select throws_ok(
  $$select public.asignar_alicuota_producto('a1000000-0000-0000-0000-000000000001', null)$$,
  '42501', null, 'consulta: no cambia el IVA del producto'
);
reset role;

select pg_temp.como('d1000000-0000-0000-0000-000000000002');
select is(
  (select count(*)::int from public.precios_empresa_final),
  0, 'operador (sin sección empresas): la vista no devuelve filas (sin precio engañoso)'
);
select throws_ok(
  $$select public.guardar_regla_precio_empresa('e1000000-0000-0000-0000-000000000002', 'central', 0, null, true)$$,
  '42501', null, 'operador: no cambia el interruptor'
);
reset role;

-- Alícuota inactiva: no se puede asignar.
update dominio.alicuotas_iva set activa = false
 where organizacion_id = '11111111-1111-1111-1111-111111111111' and nombre = '10,5 %';
select pg_temp.como('d1000000-0000-0000-0000-000000000001');
select throws_ok(
  $$select public.asignar_alicuota_producto('a1000000-0000-0000-0000-000000000001',
      (select id from dominio.alicuotas_iva where nombre = '10,5 %'))$$,
  '23514', null, 'no asigna una alícuota inactiva'
);
reset role;

-- ============================================================================
-- Aislamiento de la otra organización
-- ============================================================================

select pg_temp.como('d2000000-0000-0000-0000-000000000001');
select is(
  (select count(*)::int from dominio.alicuotas_iva where organizacion_id = '11111111-1111-1111-1111-111111111111'),
  0, 'org 2 no ve las alícuotas de la org 1'
);
select is(
  (select count(*)::int from public.precios_empresa_final where organizacion_id <> '22222222-2222-2222-2222-222222222222'),
  0, 'org 2: la vista solo devuelve su organización'
);
reset role;

-- ============================================================================
-- anon sin privilegios
-- ============================================================================

select is(has_function_privilege('anon', 'public.guardar_alicuota_categoria(uuid, uuid)', 'EXECUTE'), false, 'anon no ejecuta guardar_alicuota_categoria');
select is(has_function_privilege('anon', 'public.asignar_alicuota_producto(uuid, uuid)', 'EXECUTE'), false, 'anon no ejecuta asignar_alicuota_producto');
select is(has_function_privilege('anon', 'private.alicuota_producto(uuid)', 'EXECUTE'), false, 'anon no ejecuta private.alicuota_producto');
select is(has_function_privilege('anon', 'private.aplicar_iva(numeric, numeric, boolean)', 'EXECUTE'), false, 'anon no ejecuta private.aplicar_iva');
select is(has_table_privilege('anon', 'dominio.alicuotas_iva', 'SELECT'), false, 'anon no lee alicuotas_iva');
select is(has_table_privilege('anon', 'public.precios_empresa_final', 'SELECT'), false, 'anon no lee la vista de precio final');

select * from finish();
rollback;
