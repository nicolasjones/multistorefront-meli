-- F-PRE-08 (MSF-423, épica MSF-352) · SC-005 y SC-006: precio propio de un producto en una empresa.
-- Cubre FR-012…FR-017 y FR-020 con dos organizaciones: esquema, RLS, FK compuestas, sin escritura directa, fijar /
-- actualizar / quitar idempotentes, producto o empresa ajenos rechazados, validación de moneda e importe, actividad sin
-- importes, neto con y sin precio propio, IVA encima, USD según el alcance de la cotización (sistema y empresa),
-- sin cotización → null, todos los caminos de lectura (SC-006), permisos por rol y `anon`.
-- Las fechas salen del reloj de la base; no hay fechas fijas.
begin;

select plan(75);

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

-- Org 1: Mundo JC (central −5 %, sin IVA) · San Javucho (sin ajuste, muestra con IVA). Org 2: Empresa Dos.
insert into dominio.empresas (id, organizacion_id, nombre) values
  ('e1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'Mundo JC'),
  ('e1000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'San Javucho'),
  ('e2000000-0000-0000-0000-000000000003', '22222222-2222-2222-2222-222222222222', 'Empresa Dos');
insert into dominio.precios_empresa (empresa_id, organizacion_id, base, ajuste_pct, mostrar_con_iva) values
  ('e1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'central_ajuste', -5, false),
  ('e1000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'central', 0, true);

-- Las categorías nacen con IVA 21 % (F-PRE-12): los productos heredan esa alícuota.
insert into dominio.categorias (id, organizacion_id, nombre) values
  ('c1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'Joysticks'),
  ('c2000000-0000-0000-0000-000000000003', '22222222-2222-2222-2222-222222222222', 'Ajena');

-- P1 ARS 29.186 · P2 USD 10 · P3 de la org 2.
insert into dominio.productos (id, organizacion_id, nombre, sku, moneda, precio_lista, categoria_id) values
  ('a1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'Joystick', 'JOY-1', 'ARS', 29186, 'c1000000-0000-0000-0000-000000000001'),
  ('a1000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'Auricular', 'AUR-1', 'USD', 10, 'c1000000-0000-0000-0000-000000000001'),
  ('a2000000-0000-0000-0000-000000000003', '22222222-2222-2222-2222-222222222222', 'Teclado', 'TEC-1', 'ARS', 500, 'c2000000-0000-0000-0000-000000000003');
insert into dominio.cotizacion_inicial (organizacion_id, valor) values
  ('11111111-1111-1111-1111-111111111111', 1500);

create function pg_temp.como(p_user uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
  set local role authenticated;
end $$;

-- ============================================================================
-- Esquema, RLS, FK compuestas y privilegios (FR-012)
-- ============================================================================

select has_table('dominio', 'precios_propios_empresa', 'la tabla vive en dominio (Principio VII)');
select hasnt_table('public', 'precios_propios_empresa', 'y no en public');
select is(
  (select c.relrowsecurity from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'dominio' and c.relname = 'precios_propios_empresa'),
  true, 'RLS activa'
);
select col_is_pk('dominio', 'precios_propios_empresa', array['producto_id', 'empresa_id'], 'PK (producto_id, empresa_id)');
select throws_ok(
  $$insert into dominio.precios_propios_empresa (producto_id, empresa_id, organizacion_id, moneda, importe)
    values ('a1000000-0000-0000-0000-000000000001', 'e2000000-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111', 'ARS', 1)$$,
  '23503', null, 'FK compuesta: una empresa de otra organización no puede tener precio propio'
);
select throws_ok(
  $$insert into dominio.precios_propios_empresa (producto_id, empresa_id, organizacion_id, moneda, importe)
    values ('a2000000-0000-0000-0000-000000000003', 'e1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'ARS', 1)$$,
  '23503', null, 'FK compuesta: un producto de otra organización no puede tener precio propio'
);
select throws_ok(
  $$insert into dominio.precios_propios_empresa (producto_id, empresa_id, organizacion_id, moneda, importe)
    values ('a1000000-0000-0000-0000-000000000001', 'e1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'EUR', 1)$$,
  '23514', null, 'la moneda solo admite ARS o USD'
);
select throws_ok(
  $$insert into dominio.precios_propios_empresa (producto_id, empresa_id, organizacion_id, moneda, importe)
    values ('a1000000-0000-0000-0000-000000000001', 'e1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'ARS', 0)$$,
  '23514', null, 'el importe debe ser mayor que cero'
);
select is(has_table_privilege('anon', 'dominio.precios_propios_empresa', 'SELECT'), false, 'anon no lee la tabla');
select is(has_table_privilege('anon', 'dominio.precios_propios_empresa', 'INSERT'), false, 'anon no escribe la tabla');
select is(has_table_privilege('authenticated', 'dominio.precios_propios_empresa', 'INSERT'), false, 'authenticated no inserta directo');
select is(has_table_privilege('authenticated', 'dominio.precios_propios_empresa', 'UPDATE'), false, 'authenticated no actualiza directo');
select is(has_table_privilege('authenticated', 'dominio.precios_propios_empresa', 'DELETE'), false, 'authenticated no borra directo (sin DELETE)');
select is(has_function_privilege('anon', 'public.fijar_precio_propio(uuid, uuid, text, numeric)', 'EXECUTE'), false, 'anon no ejecuta fijar_precio_propio');
select is(has_function_privilege('anon', 'public.quitar_precio_propio(uuid, uuid)', 'EXECUTE'), false, 'anon no ejecuta quitar_precio_propio');
select is(has_function_privilege('anon', 'public.leer_precios_propios(uuid)', 'EXECUTE'), false, 'anon no ejecuta leer_precios_propios');
select is(has_function_privilege('anon', 'private.precio_propio_empresa(uuid, uuid, numeric)', 'EXECUTE'), false, 'anon no ejecuta private.precio_propio_empresa');
select is(has_function_privilege('authenticated', 'public.fijar_precio_propio(uuid, uuid, text, numeric)', 'EXECUTE'), true, 'authenticated ejecuta fijar_precio_propio');

-- ============================================================================
-- Sin precio propio, el resultado es el de hoy (FR-014)
-- ============================================================================

select pg_temp.como('d1000000-0000-0000-0000-000000000001');

-- 29.186 − 5 % = 27.726,70 → al $ 10 más cercano = 27.730.
select is(
  (select neto_ars from public.precios_empresa_neto where producto_id = 'a1000000-0000-0000-0000-000000000001' and empresa_id = 'e1000000-0000-0000-0000-000000000001'),
  27730::numeric, 'sin precio propio: neto = central con ajuste'
);
select is(
  (select precio_propio from public.precios_empresa_neto where producto_id = 'a1000000-0000-0000-0000-000000000001' and empresa_id = 'e1000000-0000-0000-0000-000000000001'),
  false, 'sin precio propio: precio_propio = false'
);
select is(private.precio_neto_empresa('a1000000-0000-0000-0000-000000000001', 'e1000000-0000-0000-0000-000000000001'), 27730::numeric, 'private.precio_neto_empresa sin precio propio');

-- ============================================================================
-- Fijar (FR-013)
-- ============================================================================

select is(
  (select public.fijar_precio_propio('a1000000-0000-0000-0000-000000000001', 'e1000000-0000-0000-0000-000000000001', 'ARS', 27000) ->> 'importe')::numeric,
  27000::numeric, 'administrador fija $ 27.000 para Mundo JC'
);
select is(
  (select neto_ars from public.precios_empresa_neto where producto_id = 'a1000000-0000-0000-0000-000000000001' and empresa_id = 'e1000000-0000-0000-0000-000000000001'),
  27000::numeric, 'el neto de Mundo JC es el precio propio (ignora el ajuste)'
);
select is(
  (select precio_propio from public.precios_empresa_neto where producto_id = 'a1000000-0000-0000-0000-000000000001' and empresa_id = 'e1000000-0000-0000-0000-000000000001'),
  true, 'la vista marca precio_propio'
);
select is(
  (select neto_ars from public.precios_empresa_neto where producto_id = 'a1000000-0000-0000-0000-000000000001' and empresa_id = 'e1000000-0000-0000-0000-000000000002'),
  29186::numeric, 'San Javucho no cambia'
);
select is(private.precio_neto_empresa('a1000000-0000-0000-0000-000000000001', 'e1000000-0000-0000-0000-000000000001'), 27000::numeric, 'private.precio_neto_empresa devuelve el precio propio');
select is(
  private.precio_visible_desde_central(29186, 'a1000000-0000-0000-0000-000000000001', 'e1000000-0000-0000-0000-000000000001'),
  27000::numeric, 'precio_visible_desde_central respeta el precio propio (SC-006)'
);

-- Cambiar la regla de la empresa no mueve el precio propio.
reset role;
update dominio.precios_empresa set ajuste_pct = -20
 where empresa_id = 'e1000000-0000-0000-0000-000000000001';
select pg_temp.como('d1000000-0000-0000-0000-000000000001');
select is(
  (select neto_ars from public.precios_empresa_neto where producto_id = 'a1000000-0000-0000-0000-000000000001' and empresa_id = 'e1000000-0000-0000-0000-000000000001'),
  27000::numeric, 'cambiar el ajuste de la empresa no mueve el precio propio'
);

-- Actualizar e idempotencia.
select lives_ok(
  $$select public.fijar_precio_propio('a1000000-0000-0000-0000-000000000001', 'e1000000-0000-0000-0000-000000000001', 'ARS', 27000)$$,
  'fijar lo mismo es idempotente'
);
select lives_ok(
  $$select public.fijar_precio_propio('a1000000-0000-0000-0000-000000000001', 'e1000000-0000-0000-0000-000000000001', 'ARS', 26500.5)$$,
  'actualizar el importe'
);
select is(
  (select count(*)::int from public.leer_precios_propios('a1000000-0000-0000-0000-000000000001')),
  1, 'sigue habiendo un solo precio propio por producto y empresa'
);
select is(
  (select importe from public.leer_precios_propios('a1000000-0000-0000-0000-000000000001') where empresa_id = 'e1000000-0000-0000-0000-000000000001'),
  26500.5::numeric, 'leer_precios_propios devuelve el importe actualizado'
);

-- IVA encima (San Javucho muestra con IVA, 21 %): 1.000 neto → 1.210.
select lives_ok(
  $$select public.fijar_precio_propio('a1000000-0000-0000-0000-000000000001', 'e1000000-0000-0000-0000-000000000002', 'ARS', 1000)$$,
  'precio propio en San Javucho'
);
select is(
  (select neto_ars from public.precios_empresa_final where producto_id = 'a1000000-0000-0000-0000-000000000001' and empresa_id = 'e1000000-0000-0000-0000-000000000002'),
  1000::numeric, 'el neto final es el propio'
);
select is(
  (select visible_ars from public.precios_empresa_final where producto_id = 'a1000000-0000-0000-0000-000000000001' and empresa_id = 'e1000000-0000-0000-0000-000000000002'),
  1210::numeric, 'el IVA de la empresa se aplica encima del precio propio'
);

-- ============================================================================
-- Validación (FR-016)
-- ============================================================================

select throws_ok($$select public.fijar_precio_propio('a1000000-0000-0000-0000-000000000001', 'e1000000-0000-0000-0000-000000000001', 'ARS', null)$$, '22023', null, 'importe vacío');
select throws_ok($$select public.fijar_precio_propio('a1000000-0000-0000-0000-000000000001', 'e1000000-0000-0000-0000-000000000001', 'ARS', 0)$$, '23514', null, 'importe cero');
select throws_ok($$select public.fijar_precio_propio('a1000000-0000-0000-0000-000000000001', 'e1000000-0000-0000-0000-000000000001', 'ARS', -5)$$, '23514', null, 'importe negativo');
select throws_ok($$select public.fijar_precio_propio('a1000000-0000-0000-0000-000000000001', 'e1000000-0000-0000-0000-000000000001', 'ARS', 10.123)$$, '23514', null, 'más de 2 decimales');
select throws_ok($$select public.fijar_precio_propio('a1000000-0000-0000-0000-000000000001', 'e1000000-0000-0000-0000-000000000001', 'ARS', 1e12)$$, '22003', null, 'importe demasiado grande');
select throws_ok($$select public.fijar_precio_propio('a1000000-0000-0000-0000-000000000001', 'e1000000-0000-0000-0000-000000000001', 'EUR', 10)$$, '22023', null, 'moneda inválida');
select throws_ok($$select public.fijar_precio_propio('a1000000-0000-0000-0000-000000000001', 'e1000000-0000-0000-0000-000000000001', null, 10)$$, '22023', null, 'moneda vacía');
select is(
  (select importe from public.leer_precios_propios('a1000000-0000-0000-0000-000000000001') where empresa_id = 'e1000000-0000-0000-0000-000000000001'),
  26500.5::numeric, 'un importe inválido no pisa el precio propio guardado'
);

-- Producto o empresa ajenos.
select throws_ok($$select public.fijar_precio_propio('a2000000-0000-0000-0000-000000000003', 'e1000000-0000-0000-0000-000000000001', 'ARS', 10)$$, 'P0002', null, 'producto ajeno rechazado');
select throws_ok($$select public.fijar_precio_propio('a1000000-0000-0000-0000-000000000001', 'e2000000-0000-0000-0000-000000000003', 'ARS', 10)$$, 'P0002', null, 'empresa ajena rechazada');
select throws_ok($$select public.quitar_precio_propio('a2000000-0000-0000-0000-000000000003', 'e1000000-0000-0000-0000-000000000001')$$, 'P0002', null, 'quitar sobre producto ajeno rechazado');

-- ============================================================================
-- USD según el alcance de la cotización (FR-015)
-- ============================================================================

-- P2 (lista USD 10) con precio propio de US$ 20 en Mundo JC; alcance «sistema», dólar 1.500 → 30.000.
select lives_ok(
  $$select public.fijar_precio_propio('a1000000-0000-0000-0000-000000000002', 'e1000000-0000-0000-0000-000000000001', 'USD', 20)$$,
  'precio propio en USD'
);
select is(
  (select neto_ars from public.precios_empresa_neto where producto_id = 'a1000000-0000-0000-0000-000000000002' and empresa_id = 'e1000000-0000-0000-0000-000000000001'),
  30000::numeric, 'alcance sistema: US$ 20 × 1.500 = $ 30.000'
);

-- Alcance «empresa»: Mundo JC carga su propio valor (1.600) → 32.000; el precio sin propio de San Javucho usa 1.500.
reset role;
insert into dominio.cotizacion_configuracion (organizacion_id, alcance)
values ('11111111-1111-1111-1111-111111111111', 'empresa')
on conflict (organizacion_id) do update set alcance = 'empresa';
insert into dominio.cotizacion_aplicada (organizacion_id, empresa_id, valor) values
  ('11111111-1111-1111-1111-111111111111', null, 1500),
  ('11111111-1111-1111-1111-111111111111', 'e1000000-0000-0000-0000-000000000001', 1600),
  ('11111111-1111-1111-1111-111111111111', 'e1000000-0000-0000-0000-000000000002', 1500);
select pg_temp.como('d1000000-0000-0000-0000-000000000001');
select is(
  (select neto_ars from public.precios_empresa_neto where producto_id = 'a1000000-0000-0000-0000-000000000002' and empresa_id = 'e1000000-0000-0000-0000-000000000001'),
  32000::numeric, 'alcance empresa: US$ 20 × 1.600 (la cotización de Mundo JC) = $ 32.000'
);
select is(
  (select neto_ars from public.precios_empresa_neto where producto_id = 'a1000000-0000-0000-0000-000000000002' and empresa_id = 'e1000000-0000-0000-0000-000000000002'),
  15000::numeric, 'otra empresa, sin precio propio, sigue con su central (USD 10 × 1.500)'
);

-- Sin cotización no se inventa un precio (ni se cae a la regla).
reset role;
delete from dominio.cotizacion_aplicada where organizacion_id = '11111111-1111-1111-1111-111111111111';
delete from dominio.cotizacion_inicial where organizacion_id = '11111111-1111-1111-1111-111111111111';
select pg_temp.como('d1000000-0000-0000-0000-000000000001');
select is(
  (select neto_ars from public.precios_empresa_neto where producto_id = 'a1000000-0000-0000-0000-000000000002' and empresa_id = 'e1000000-0000-0000-0000-000000000001'),
  null::numeric, 'precio propio en USD sin cotización: neto null'
);
select is(
  (select precio_propio from public.precios_empresa_neto where producto_id = 'a1000000-0000-0000-0000-000000000002' and empresa_id = 'e1000000-0000-0000-0000-000000000001'),
  true, 'y sigue marcado como precio propio'
);
reset role;
insert into dominio.cotizacion_inicial (organizacion_id, valor) values ('11111111-1111-1111-1111-111111111111', 1500);
insert into dominio.cotizacion_aplicada (organizacion_id, empresa_id, valor) values
  ('11111111-1111-1111-1111-111111111111', null, 1500);
update dominio.cotizacion_configuracion set alcance = 'sistema' where organizacion_id = '11111111-1111-1111-1111-111111111111';

-- ============================================================================
-- Vista previa de la cotización: ningún camino ignora el precio propio (SC-006)
-- ============================================================================

select pg_temp.como('d1000000-0000-0000-0000-000000000001');
select lives_ok($$select public.cargar_cotizacion(1800)$$, 'cargar un dólar nuevo (1.800)');
-- Mundo JC: precio propio US$ 20 → hoy 30.000 · nuevo 36.000. San Javucho: sin propio → central USD 10 (regla central, con IVA 21 %).
select is(
  (select (e -> 'hoy')::numeric
     from jsonb_array_elements((public.previsualizar_cotizacion() -> 'muestra') -> 0 -> 'por_empresa') e
    where e ->> 'empresa_id' = 'e1000000-0000-0000-0000-000000000001'),
  30000::numeric, 'vista previa: «hoy» de Mundo JC es el precio propio con el dólar vigente'
);
select is(
  (select (e -> 'nuevo')::numeric
     from jsonb_array_elements((public.previsualizar_cotizacion() -> 'muestra') -> 0 -> 'por_empresa') e
    where e ->> 'empresa_id' = 'e1000000-0000-0000-0000-000000000001'),
  36000::numeric, 'vista previa: «nuevo» de Mundo JC es el precio propio con el dólar pendiente'
);
select is(
  (select (e -> 'nuevo')::numeric
     from jsonb_array_elements((public.previsualizar_cotizacion() -> 'muestra') -> 0 -> 'por_empresa') e
    where e ->> 'empresa_id' = 'e1000000-0000-0000-0000-000000000002'),
  21780::numeric, 'vista previa: sin precio propio, «nuevo» sigue la regla (USD 10 × 1.800 = 18.000 + 21 %)'
);
select lives_ok($$select public.descartar_cotizacion()$$, 'descartar la cotización pendiente');

-- ============================================================================
-- Quitar (FR-017)
-- ============================================================================

select lives_ok($$select public.quitar_precio_propio('a1000000-0000-0000-0000-000000000001', 'e1000000-0000-0000-0000-000000000001')$$, 'quitar el precio propio');
select is(
  (select neto_ars from public.precios_empresa_neto where producto_id = 'a1000000-0000-0000-0000-000000000001' and empresa_id = 'e1000000-0000-0000-0000-000000000001'),
  23350::numeric, 'sin precio propio, vuelve a la regla de la empresa (29.186 −20 % = 23.348,8 → 23.350)'
);
select lives_ok($$select public.quitar_precio_propio('a1000000-0000-0000-0000-000000000001', 'e1000000-0000-0000-0000-000000000001')$$, 'quitar de nuevo es idempotente');

reset role;
select is(
  (select count(*)::int from registro_actividad where tipo = 'producto.precio_propio_fijado'),
  4, 'cada fijar real dejó actividad (repetir lo mismo no suma)'
);
select is(
  (select count(*)::int from registro_actividad where tipo = 'producto.precio_propio_quitado'),
  1, 'quitar dejó una sola actividad (el segundo quitar no suma)'
);
select is(
  (select count(*)::int from registro_actividad
    where tipo like 'producto.precio_propio_%' and (detalle ~ '[0-9]{3}' or detalle like '%$%')),
  0, 'la actividad no lleva importes'
);

-- ============================================================================
-- Permisos por rol y aislamiento
-- ============================================================================

-- Operador (productos = edición, sin la sección empresas): fija y su cálculo privado ve el precio propio.
select pg_temp.como('d1000000-0000-0000-0000-000000000002');
select lives_ok(
  $$select public.fijar_precio_propio('a1000000-0000-0000-0000-000000000001', 'e1000000-0000-0000-0000-000000000001', 'ARS', 27000)$$,
  'operador: edita productos y fija el precio propio'
);
select is(
  (select neto_ars from private.precio_propio_empresa('a1000000-0000-0000-0000-000000000001', 'e1000000-0000-0000-0000-000000000001')),
  27000::numeric, 'operador: el cálculo ve el precio propio aunque no lea la sección empresas'
);
reset role;

select pg_temp.como('d1000000-0000-0000-0000-000000000003');
select throws_ok(
  $$select public.fijar_precio_propio('a1000000-0000-0000-0000-000000000001', 'e1000000-0000-0000-0000-000000000001', 'ARS', 1)$$,
  '42501', null, 'consulta: no fija'
);
select throws_ok(
  $$select public.quitar_precio_propio('a1000000-0000-0000-0000-000000000001', 'e1000000-0000-0000-0000-000000000001')$$,
  '42501', null, 'consulta: no quita'
);
select is(
  (select count(*)::int from public.leer_precios_propios('a1000000-0000-0000-0000-000000000001')),
  2, 'consulta: ve los precios propios (Mundo JC y San Javucho) sin poder editarlos'
);
reset role;

-- Organización 2: no ve ni toca los de la 1.
select pg_temp.como('d2000000-0000-0000-0000-000000000001');
select is(
  (select count(*)::int from public.leer_precios_propios('a1000000-0000-0000-0000-000000000001')),
  0, 'otra organización no ve los precios propios ajenos'
);
select is((select count(*)::int from dominio.precios_propios_empresa), 0, 'otra organización no lee la tabla de la primera');
select throws_ok(
  $$select public.fijar_precio_propio('a1000000-0000-0000-0000-000000000001', 'e1000000-0000-0000-0000-000000000001', 'ARS', 1)$$,
  'P0002', null, 'otra organización no fija sobre un producto ajeno'
);
select lives_ok(
  $$select public.fijar_precio_propio('a2000000-0000-0000-0000-000000000003', 'e2000000-0000-0000-0000-000000000003', 'ARS', 450)$$,
  'la organización 2 fija el suyo'
);
reset role;
select is(
  (select count(*)::int from dominio.precios_propios_empresa where organizacion_id = '11111111-1111-1111-1111-111111111111'),
  3, 'el precio propio de la organización 2 no tocó los de la 1'
);

-- ============================================================================
-- FR-020: sin cola ni columna de Mercado Libre
-- ============================================================================

select is(
  (select count(*)::int from information_schema.columns
    where table_schema = 'dominio' and table_name = 'precios_propios_empresa' and column_name ~* '(meli|mercado|ml_)'),
  0, 'la tabla no tiene columnas de Mercado Libre'
);
select is(
  (select count(*)::int from pg_trigger t join pg_class c on c.oid = t.tgrelid join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'dominio' and c.relname = 'precios_propios_empresa' and not t.tgisinternal),
  0, 'la tabla no dispara colas ni triggers de salida'
);

select * from finish();
rollback;
