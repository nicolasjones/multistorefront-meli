-- F-VTA-06 (MSF-295, épica MSF-159): líneas del comprobante. Cubre SC-003: escala por cantidad con cliente
-- minorista y mayorista (precios fijos), IVA por categoría y por override del producto, precio manual con y
-- sin permiso (`editar_precio`), producto o depósito ajeno rechazado, aislamiento entre organizaciones,
-- `anon` sin acceso, disponible = existencias − reservado y totales recalculados.
-- Matriz de `ventas`: administrador y operador `edicion` (con `editar_precio`); consulta `lectura`.
-- El operador NO tiene la sección `empresas`: prueba que `precio_para` ya acepta a ventas.
begin;

select no_plan();

insert into organizaciones (id, nombre) values
  ('11111111-1111-1111-1111-111111111111', 'Organización Uno'),
  ('22222222-2222-2222-2222-222222222222', 'Organización Dos');

insert into auth.users (id, email) values
  ('f1000000-0000-0000-0000-000000000001', 'administrador@example.com'),
  ('f1000000-0000-0000-0000-000000000002', 'operador@example.com'),
  ('f1000000-0000-0000-0000-000000000003', 'consulta@example.com'),
  ('f1000000-0000-0000-0000-000000000004', 'mixto@example.com'),
  ('f2000000-0000-0000-0000-000000000001', 'admin-dos@example.com');

insert into usuarios_organizacion (user_id, organizacion_id, rol_id, estado) values
  ('f1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'administrador', 'activo'),
  ('f1000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'operador', 'activo'),
  ('f1000000-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111', 'consulta', 'activo'),
  ('f1000000-0000-0000-0000-000000000004', '11111111-1111-1111-1111-111111111111', 'operador', 'activo'),
  ('f2000000-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', 'administrador', 'activo');

insert into dominio.empresas (id, organizacion_id, nombre) values
  ('a1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'San Javucho'),
  ('a1000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'Segunda tienda'),
  ('a2000000-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', 'Empresa Dos');

insert into usuarios_empresas (user_id, empresa_id, organizacion_id, rol_id) values
  ('f1000000-0000-0000-0000-000000000002', 'a1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'operador'),
  ('f1000000-0000-0000-0000-000000000003', 'a1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'consulta'),
  ('f1000000-0000-0000-0000-000000000004', 'a1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'mostrador'),
  ('f1000000-0000-0000-0000-000000000004', 'a1000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'operador');

insert into clientes (id, organizacion_id, numero, nombre, tipo, archivado_en) values
  ('c5000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 10, 'Distribuidora Norte', 'mayorista', null),
  ('c5000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 11, 'Cliente minorista', 'minorista', null);

-- Las categorías nacen en 21 % (F-PRE-12). P1 ARS 1.000 con x5 = 900, x10 = 800, x50 = 700 (sin IVA, precios fijos);
-- P2 ARS 500 con IVA propio 10,5 % (override); P3 «A pedido»; P4 de la org 2; P5 inactivo.
insert into dominio.categorias (id, organizacion_id, nombre) values
  ('c1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'Joysticks'),
  ('c2000000-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', 'Ajena');

insert into dominio.productos (id, organizacion_id, nombre, sku, moneda, precio_lista, categoria_id, disponibilidad_manual, activo) values
  ('b1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'Joystick', 'JOY-1', 'ARS', 1000, 'c1000000-0000-0000-0000-000000000001', null, true),
  ('b1000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'Cable', 'CAB-1', 'ARS', 500, 'c1000000-0000-0000-0000-000000000001', null, true),
  ('b1000000-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111', 'Consola bajo pedido', 'CON-1', 'ARS', 2000, 'c1000000-0000-0000-0000-000000000001', 'a_pedido', true),
  ('b2000000-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', 'Teclado ajeno', 'TEC-1', 'ARS', 500, 'c2000000-0000-0000-0000-000000000001', null, true),
  ('b1000000-0000-0000-0000-000000000005', '11111111-1111-1111-1111-111111111111', 'Producto inactivo', 'INA-1', 'ARS', 100, 'c1000000-0000-0000-0000-000000000001', null, false);

insert into dominio.producto_precios_escala (producto_id, organizacion_id, escala, precio) values
  ('b1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'x5', 900),
  ('b1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'x10', 800),
  ('b1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'x50', 700);

update dominio.productos
   set alicuota_iva_id = (select a.id from dominio.alicuotas_iva a
                           where a.organizacion_id = '11111111-1111-1111-1111-111111111111' and a.porcentaje = 10.5 and not a.exento)
 where id = 'b1000000-0000-0000-0000-000000000002';

-- Depósitos: el principal lo siembra la organización; se suma «Local».
insert into dominio.depositos (id, organizacion_id, nombre) values
  ('d1000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'Local');

create temp table datos as
  select
    (select id from dominio.depositos where organizacion_id = '11111111-1111-1111-1111-111111111111' and por_defecto) as principal,
    (select id from dominio.depositos where organizacion_id = '22222222-2222-2222-2222-222222222222' and por_defecto) as ajeno;
grant select on datos to public;

-- «Venden desde acá»: el principal y Local venden para San Javucho; «Otro» solo para la segunda tienda.
insert into dominio.depositos (id, organizacion_id, nombre) values
  ('d1000000-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111', 'Otro');
insert into dominio.depositos_empresas (deposito_id, empresa_id, organizacion_id)
select d, 'a1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111'
  from (select principal as d from datos union all select 'd1000000-0000-0000-0000-000000000002'::uuid) x
on conflict do nothing;
insert into dominio.depositos_empresas (deposito_id, empresa_id, organizacion_id) values
  ('d1000000-0000-0000-0000-000000000003', 'a1000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111')
on conflict do nothing;

-- Existencias: Joystick 10 en el principal con 3 reservadas; 4 en Local.
insert into dominio.existencias (producto_id, organizacion_id, cantidad, reservado) values
  ('b1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 14, 3);
insert into dominio.existencias_deposito (producto_id, deposito_id, organizacion_id, cantidad, reservado) values
  ('b1000000-0000-0000-0000-000000000001', (select principal from datos), '11111111-1111-1111-1111-111111111111', 10, 3),
  ('b1000000-0000-0000-0000-000000000001', 'd1000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 4, 0);

create function pg_temp.como(p_user uuid) returns void language plpgsql as $$
begin
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
  set local role authenticated;
end $$;

create temp table comps (clave text primary key, id uuid, actualizado timestamptz);
grant select, insert, update on comps to public;

-- Guarda una sola línea del Joystick con la cantidad dada y devuelve «escala:precio» (releyendo el token vigente).
create function pg_temp.escala_de(p_clave text, p_cantidad int) returns text language plpgsql as $$
declare v_escala text;
begin
  perform public.guardar_lineas_comprobante(
    (select id from comps where clave = p_clave),
    jsonb_build_array(jsonb_build_object('producto_id', 'b1000000-0000-0000-0000-000000000001', 'cantidad', p_cantidad)),
    (select c.updated_at from dominio.comprobantes_venta c where c.id = (select id from comps where clave = p_clave))
  );
  select l.escala || ':' || l.precio_unitario::text into v_escala
    from dominio.comprobantes_venta_lineas l where l.comprobante_id = (select id from comps where clave = p_clave);
  return v_escala;
end $$;

-- Un comprobante por cliente (los crea el operador, que NO tiene la sección empresas).
select pg_temp.como('f1000000-0000-0000-0000-000000000002');
insert into comps (clave, id, actualizado)
select 'mayorista', c.id, c.updated_at from public.crear_comprobante('factura', 'a1000000-0000-0000-0000-000000000001',
  'c5000000-0000-0000-0000-000000000001', 'mostrador', '2026-10-24') c;
insert into comps (clave, id, actualizado)
select 'minorista', c.id, c.updated_at from public.crear_comprobante('factura', 'a1000000-0000-0000-0000-000000000001',
  'c5000000-0000-0000-0000-000000000002', 'mostrador', '2026-10-24') c;

-- ============================================================================
-- Esquema, RLS y privilegios
-- ============================================================================

select is(
  (select n.nspname::text from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where c.oid = 'dominio.comprobantes_venta_lineas'::regclass),
  'dominio', 'las líneas viven en dominio, no en public'
);
select is((select relrowsecurity from pg_class where oid = 'dominio.comprobantes_venta_lineas'::regclass),
  true, 'RLS activa en comprobantes_venta_lineas');
select is(
  has_table_privilege('authenticated', 'dominio.comprobantes_venta_lineas', 'insert')
    or has_table_privilege('authenticated', 'dominio.comprobantes_venta_lineas', 'update')
    or has_table_privilege('authenticated', 'dominio.comprobantes_venta_lineas', 'delete')
    or has_table_privilege('anon', 'dominio.comprobantes_venta_lineas', 'select'),
  false, 'nadie escribe las líneas directo y anon no las lee'
);
select is(
  (select count(*) from unnest(array[
    'public.guardar_lineas_comprobante(uuid,jsonb,timestamptz)',
    'public.disponible_para_venta(uuid,uuid)'
  ]) as f where has_function_privilege('anon', f::regprocedure, 'execute'))::int,
  0, 'anon no ejecuta las RPC de líneas'
);
select is(
  (select count(*) from unnest(array[
    'public.guardar_lineas_comprobante(uuid,jsonb,timestamptz)',
    'public.disponible_para_venta(uuid,uuid)'
  ]) as f where has_function_privilege('authenticated', f::regprocedure, 'execute'))::int,
  2, 'authenticated ejecuta las RPC de líneas'
);
select is(has_function_privilege('authenticated', 'private.escala_para_linea(text,integer)', 'execute'),
  false, 'authenticated no ejecuta la regla de escala');
select is(
  (select array_agg(rol_id order by rol_id) from public.permisos_rol_accion
    where organizacion_id = '11111111-1111-1111-1111-111111111111' and seccion = 'ventas' and accion = 'editar_precio' and permitido),
  array['administrador', 'operador']::text[], 'editar_precio sembrado solo para Administrador y Operador'
);
select is(
  (select count(*)::int from public.permisos_rol_accion where seccion <> 'ventas' and accion = 'editar_precio'),
  0, 'editar_precio existe solo en ventas'
);

-- ============================================================================
-- Escala por cantidad y tipo de cliente (FR-014): precios fijos
-- ============================================================================

select lives_ok(
  format($$select public.guardar_lineas_comprobante(%L, %L::jsonb, %L)$$,
    (select id from comps where clave = 'mayorista'),
    '[{"producto_id":"b1000000-0000-0000-0000-000000000001","cantidad":12}]',
    (select actualizado from comps where clave = 'mayorista')),
  'el operador (sin sección empresas) guarda una línea: precio_para acepta a ventas'
);
select is(
  (select escala from dominio.comprobantes_venta_lineas where comprobante_id = (select id from comps where clave = 'mayorista')),
  'x10', 'mayorista, 12 unidades: escala x10'
);
select is(
  (select precio_unitario from dominio.comprobantes_venta_lineas where comprobante_id = (select id from comps where clave = 'mayorista')),
  800.00, 'mayorista x10: precio 800 sin IVA'
);
select is(
  (select deposito_id from dominio.comprobantes_venta_lineas where comprobante_id = (select id from comps where clave = 'mayorista')),
  (select principal from datos), 'sin depósito elegido: el principal de la organización (FR-013)'
);
select is(
  (select row(subtotal_sin_iva, iva)::text from dominio.comprobantes_venta_lineas where comprobante_id = (select id from comps where clave = 'mayorista')),
  '(9600.00,2016.00)', 'subtotal 12 × 800 = 9.600 e IVA 21 % = 2.016'
);
select is(
  (select row(total_sin_iva, total_con_iva)::text from dominio.comprobantes_venta where id = (select id from comps where clave = 'mayorista')),
  '(9600.00,11616.00)', 'el comprobante recalcula subtotal sin IVA y total'
);

select is(pg_temp.escala_de('mayorista', 4), 'x1:1000.00', 'mayorista, 4 unidades: x1 a la lista');
select is(pg_temp.escala_de('mayorista', 5), 'x5:900.00', 'mayorista, 5 unidades: x5');
select is(pg_temp.escala_de('mayorista', 49), 'x10:800.00', 'mayorista, 49 unidades: x10');
select is(pg_temp.escala_de('mayorista', 50), 'x50:700.00', 'mayorista, 50 unidades: x50');
select is(pg_temp.escala_de('minorista', 50), 'x1:1000.00', 'minorista, 50 unidades: siempre la lista (x1)');
select is(pg_temp.escala_de('minorista', 1), 'x1:1000.00', 'minorista, 1 unidad: x1');

-- ============================================================================
-- IVA por categoría y por override (FR-015) y totales con varias líneas
-- ============================================================================

update comps set actualizado = (select updated_at from dominio.comprobantes_venta where id = comps.id);

select lives_ok(
  format($$select public.guardar_lineas_comprobante(%L, %L::jsonb, %L)$$,
    (select id from comps where clave = 'minorista'),
    '[{"producto_id":"b1000000-0000-0000-0000-000000000001","cantidad":2},{"producto_id":"b1000000-0000-0000-0000-000000000002","cantidad":4,"deposito_id":"d1000000-0000-0000-0000-000000000002"}]',
    (select actualizado from comps where clave = 'minorista')),
  'guarda dos líneas: IVA por categoría y por override, en dos depósitos'
);
select is(
  (select array_agg(alicuota_porcentaje order by orden) from dominio.comprobantes_venta_lineas
    where comprobante_id = (select id from comps where clave = 'minorista')),
  array[21.00, 10.50]::numeric[], 'Joystick hereda 21 % de la categoría; Cable usa su override de 10,5 %'
);
select is(
  (select array_agg(iva order by orden) from dominio.comprobantes_venta_lineas
    where comprobante_id = (select id from comps where clave = 'minorista')),
  array[420.00, 210.00]::numeric[], 'IVA por línea: 2 × 1.000 × 21 % = 420 y 4 × 500 × 10,5 % = 210'
);
select is(
  (select row(total_sin_iva, total_con_iva)::text from dominio.comprobantes_venta where id = (select id from comps where clave = 'minorista')),
  '(4000.00,4630.00)', 'totales: 4.000 sin IVA, 630 de IVA, 4.630 en total'
);
select is(
  (select jsonb_array_length(public.obtener_comprobante((select id from comps where clave = 'minorista')) -> 'lineas')),
  2, 'obtener_comprobante devuelve las dos líneas'
);
select is(
  (select public.obtener_comprobante((select id from comps where clave = 'minorista')) -> 'lineas' -> 0 ->> 'deposito'),
  (select nombre from dominio.depositos where id = (select principal from datos)), 'la línea trae el nombre del depósito'
);

-- Reemplazo: una lista vacía deja el comprobante en cero.
update comps set actualizado = (select updated_at from dominio.comprobantes_venta where id = comps.id);
select lives_ok(
  format($$select public.guardar_lineas_comprobante(%L, '[]'::jsonb, %L)$$,
    (select id from comps where clave = 'minorista'), (select actualizado from comps where clave = 'minorista')),
  'una lista vacía reemplaza las líneas'
);
select is(
  (select count(*)::int from dominio.comprobantes_venta_lineas where comprobante_id = (select id from comps where clave = 'minorista')),
  0, 'no quedan líneas'
);
select is(
  (select row(total_sin_iva, total_con_iva)::text from dominio.comprobantes_venta where id = (select id from comps where clave = 'minorista')),
  '(0.00,0.00)', 'y los totales vuelven a cero'
);

-- ============================================================================
-- Precio manual (FR-016): con y sin permiso
-- ============================================================================

update comps set actualizado = (select updated_at from dominio.comprobantes_venta where id = comps.id);
select is(
  (select public.obtener_comprobante((select id from comps where clave = 'minorista')) ->> 'puede_editar_precio'),
  'true', 'el Operador (con editar_precio) ve puede_editar_precio = true'
);
select lives_ok(
  format($$select public.guardar_lineas_comprobante(%L, %L::jsonb, %L)$$,
    (select id from comps where clave = 'minorista'),
    '[{"producto_id":"b1000000-0000-0000-0000-000000000001","cantidad":3,"precio_manual":950}]',
    (select actualizado from comps where clave = 'minorista')),
  'el operador (con editar_precio) fija un precio manual'
);
select is(
  (select row(precio_manual, precio_unitario, subtotal_sin_iva)::text from dominio.comprobantes_venta_lineas
    where comprobante_id = (select id from comps where clave = 'minorista')),
  '(t,950.00,2850.00)', 'la línea queda marcada como precio manual y respeta el importe'
);

-- Se le quita la acción al Operador (dato de la matriz, como lo haría un Administrador).
reset role;
update public.permisos_rol_accion set permitido = false
 where organizacion_id = '11111111-1111-1111-1111-111111111111' and rol_id = 'operador' and seccion = 'ventas' and accion = 'editar_precio';

select pg_temp.como('f1000000-0000-0000-0000-000000000002');
update comps set actualizado = (select updated_at from dominio.comprobantes_venta where id = comps.id);

select is(
  (select public.obtener_comprobante((select id from comps where clave = 'minorista')) ->> 'puede_editar_precio'),
  'false', 'sin editar_precio, obtener_comprobante informa puede_editar_precio = false'
);
select throws_ok(
  format($$select public.guardar_lineas_comprobante(%L, %L::jsonb, %L)$$,
    (select id from comps where clave = 'minorista'),
    '[{"producto_id":"b1000000-0000-0000-0000-000000000001","cantidad":3,"precio_manual":100}]',
    (select actualizado from comps where clave = 'minorista')),
  '42501', 'Tu rol no puede editar precios', 'sin editar_precio un precio manual nuevo se rechaza en la base'
);
select lives_ok(
  format($$select public.guardar_lineas_comprobante(%L, %L::jsonb, %L)$$,
    (select id from comps where clave = 'minorista'),
    '[{"producto_id":"b1000000-0000-0000-0000-000000000001","cantidad":5,"precio_manual":950}]',
    (select actualizado from comps where clave = 'minorista')),
  'sin permiso se puede re-guardar el MISMO precio manual ya guardado (cambiando la cantidad)'
);
update comps set actualizado = (select updated_at from dominio.comprobantes_venta where id = comps.id);
select lives_ok(
  format($$select public.guardar_lineas_comprobante(%L, %L::jsonb, %L)$$,
    (select id from comps where clave = 'minorista'),
    '[{"producto_id":"b1000000-0000-0000-0000-000000000001","cantidad":2}]',
    (select actualizado from comps where clave = 'minorista')),
  'sin permiso se puede volver al precio de la lista (sin precio_manual)'
);
select is(
  (select row(precio_manual, precio_unitario)::text from dominio.comprobantes_venta_lineas
    where comprobante_id = (select id from comps where clave = 'minorista')),
  '(f,1000.00)', 'al quitar el precio manual vuelve el precio calculado'
);

-- ============================================================================
-- Validaciones (FR-011)
-- ============================================================================

update comps set actualizado = (select updated_at from dominio.comprobantes_venta where id = comps.id);

select throws_ok(
  format($$select public.guardar_lineas_comprobante(%L, %L::jsonb, %L)$$,
    (select id from comps where clave = 'minorista'),
    '[{"producto_id":"b2000000-0000-0000-0000-000000000001","cantidad":1}]', (select actualizado from comps where clave = 'minorista')),
  '22023', null, 'un producto de otra organización se rechaza'
);
select throws_ok(
  format($$select public.guardar_lineas_comprobante(%L, %L::jsonb, %L)$$,
    (select id from comps where clave = 'minorista'),
    '[{"producto_id":"b1000000-0000-0000-0000-000000000005","cantidad":1}]', (select actualizado from comps where clave = 'minorista')),
  '22023', null, 'un producto inactivo se rechaza'
);
select throws_ok(
  format($$select public.guardar_lineas_comprobante(%L, %L::jsonb, %L)$$,
    (select id from comps where clave = 'minorista'),
    '[{"producto_id":"b1000000-0000-0000-0000-000000000001","cantidad":0}]', (select actualizado from comps where clave = 'minorista')),
  '22023', null, 'cantidad cero se rechaza'
);
select throws_ok(
  format($$select public.guardar_lineas_comprobante(%L, %L::jsonb, %L)$$,
    (select id from comps where clave = 'minorista'),
    '[{"producto_id":"b1000000-0000-0000-0000-000000000001","cantidad":-2}]', (select actualizado from comps where clave = 'minorista')),
  '22023', null, 'cantidad negativa se rechaza'
);
select throws_ok(
  format($$select public.guardar_lineas_comprobante(%L, %L::jsonb, %L)$$,
    (select id from comps where clave = 'minorista'),
    '[{"producto_id":"b1000000-0000-0000-0000-000000000001","cantidad":1.5}]', (select actualizado from comps where clave = 'minorista')),
  '22023', null, 'cantidad con decimales se rechaza'
);
select throws_ok(
  format($$select public.guardar_lineas_comprobante(%L, %L::jsonb, %L)$$,
    (select id from comps where clave = 'minorista'),
    jsonb_build_array(jsonb_build_object('producto_id', 'b1000000-0000-0000-0000-000000000001', 'cantidad', 1, 'deposito_id', (select ajeno from datos)))::text,
    (select actualizado from comps where clave = 'minorista')),
  '22023', null, 'un depósito de otra organización se rechaza'
);
select throws_ok(
  format($$select public.guardar_lineas_comprobante(%L, %L::jsonb, %L)$$,
    (select id from comps where clave = 'minorista'),
    '[{"producto_id":"b1000000-0000-0000-0000-000000000001","cantidad":1,"deposito_id":"d9999999-0000-0000-0000-000000000009"}]',
    (select actualizado from comps where clave = 'minorista')),
  '22023', null, 'un depósito inexistente se rechaza'
);
select throws_ok(
  format($$select public.guardar_lineas_comprobante(%L, %L::jsonb, %L)$$,
    (select id from comps where clave = 'minorista'), '{"no":"es lista"}', (select actualizado from comps where clave = 'minorista')),
  '22023', null, 'lineas debe ser una lista'
);
select is(
  (select count(*)::int from dominio.comprobantes_venta_lineas where comprobante_id = (select id from comps where clave = 'minorista')),
  1, 'un rechazo no toca las líneas guardadas (transacción)'
);
select throws_ok(
  format($$select public.guardar_lineas_comprobante(%L, '[]'::jsonb, %L)$$,
    (select id from comps where clave = 'minorista'), now() - interval '1 day'),
  '40001', null, 'una versión vieja del comprobante da conflicto de edición'
);

-- Producto «A pedido»: la línea lo copia.
select lives_ok(
  format($$select public.guardar_lineas_comprobante(%L, %L::jsonb, %L)$$,
    (select id from comps where clave = 'minorista'),
    '[{"producto_id":"b1000000-0000-0000-0000-000000000003","cantidad":1}]', (select actualizado from comps where clave = 'minorista')),
  'se puede agregar un producto «A pedido»'
);
select is(
  (select a_pedido from dominio.comprobantes_venta_lineas where comprobante_id = (select id from comps where clave = 'minorista')),
  true, 'la línea guarda la marca «A pedido»'
);
select is(
  (select public.obtener_comprobante((select id from comps where clave = 'minorista')) -> 'lineas' -> 0 ->> 'stock'),
  '0', 'la línea sin existencias informa stock 0'
);

-- ============================================================================
-- Disponible para la venta (FR-017)
-- ============================================================================

select is(public.disponible_para_venta('b1000000-0000-0000-0000-000000000001', (select principal from datos)),
  7, 'disponible del principal = 10 existencias − 3 reservadas');
select is(public.disponible_para_venta('b1000000-0000-0000-0000-000000000001', 'd1000000-0000-0000-0000-000000000002'),
  4, 'disponible de Local = 4');
select is(public.disponible_para_venta('b1000000-0000-0000-0000-000000000002', (select principal from datos)),
  0, 'un producto sin existencias en el depósito: 0');
select is(public.disponible_para_venta('b2000000-0000-0000-0000-000000000001', (select principal from datos)),
  null, 'producto de otra organización: null');
select is(public.disponible_para_venta('b1000000-0000-0000-0000-000000000001', (select ajeno from datos)),
  null, 'depósito de otra organización: null');

-- ============================================================================
-- Permisos y aislamiento
-- ============================================================================

select pg_temp.como('f1000000-0000-0000-0000-000000000003');
select throws_ok(
  format($$select public.guardar_lineas_comprobante(%L, '[]'::jsonb, %L)$$,
    (select id from comps where clave = 'minorista'),
    (select updated_at from dominio.comprobantes_venta where id = (select id from comps where clave = 'minorista'))),
  '42501', null, 'consulta (lectura) no guarda líneas'
);
select is(
  (select count(*)::int from dominio.comprobantes_venta_lineas), 2,
  'consulta ve las líneas de la organización por RLS de lectura'
);
select is(public.disponible_para_venta('b1000000-0000-0000-0000-000000000001', (select principal from datos)),
  7, 'consulta (lectura) ve el disponible');

select pg_temp.como('f2000000-0000-0000-0000-000000000001');
select is((select count(*)::int from dominio.comprobantes_venta_lineas), 0, 'la organización dos no ve líneas de la uno');
select throws_ok(
  format($$select public.guardar_lineas_comprobante(%L, '[]'::jsonb, %L)$$,
    (select id from comps where clave = 'minorista'), now()),
  'P0002', null, 'la organización dos no puede editar un comprobante de la uno'
);

reset role;
set local role anon;
select throws_ok(
  $$select public.guardar_lineas_comprobante('00000000-0000-0000-0000-000000000000', '[]'::jsonb, now())$$,
  '42501', null, 'anon no ejecuta guardar_lineas_comprobante'
);
select throws_ok(
  $$select public.disponible_para_venta('b1000000-0000-0000-0000-000000000001', 'd1000000-0000-0000-0000-000000000002')$$,
  '42501', null, 'anon no ejecuta disponible_para_venta'
);
select throws_ok($$select count(*) from dominio.comprobantes_venta_lineas$$, '42501', null, 'anon no lee las líneas');
reset role;

-- Documento cerrado: no se editan líneas.
update dominio.comprobantes_venta set estado = 'confirmada'
 where id = (select id from comps where clave = 'mayorista');
select pg_temp.como('f1000000-0000-0000-0000-000000000002');
select throws_ok(
  format($$select public.guardar_lineas_comprobante(%L, '[]'::jsonb, %L)$$,
    (select id from comps where clave = 'mayorista'),
    (select updated_at from dominio.comprobantes_venta where id = (select id from comps where clave = 'mayorista'))),
  '55000', null, 'una factura confirmada no admite cambios de líneas'
);

-- ============================================================================
-- editar_precio por empresa y depósito por tienda (devolución del Revisor)
-- ============================================================================
-- «mixto» es Mostrador (edición de ventas, sin editar_precio) en San Javucho y Operador (con editar_precio)
-- en la segunda tienda: el permiso rige por la tienda del comprobante, no por la suma de sus roles.
select pg_temp.como('f1000000-0000-0000-0000-000000000004');
insert into comps (clave, id, actualizado)
select 'mixto', c.id, c.updated_at from public.crear_comprobante('factura', 'a1000000-0000-0000-0000-000000000001',
  'c5000000-0000-0000-0000-000000000002', 'mostrador', '2026-10-24') c;
select throws_ok(
  format($$select public.guardar_lineas_comprobante(%L, %L::jsonb, %L)$$,
    (select id from comps where clave = 'mixto'),
    '[{"producto_id":"b1000000-0000-0000-0000-000000000001","cantidad":1,"precio_manual":50}]',
    (select actualizado from comps where clave = 'mixto')),
  '42501', null, 'Mostrador en la tienda A no fija precio manual aunque sea Operador en la B'
);
select is(
  (select (public.obtener_comprobante((select id from comps where clave = 'mixto')) ->> 'puede_editar_precio')::boolean),
  false, 'puede_editar_precio es false en la tienda donde su rol no lo tiene'
);
select throws_ok(
  format($$select public.guardar_lineas_comprobante(%L, %L::jsonb, %L)$$,
    (select id from comps where clave = 'mixto'),
    '[{"producto_id":"b1000000-0000-0000-0000-000000000001","cantidad":1,"deposito_id":"d1000000-0000-0000-0000-000000000003"}]',
    (select actualizado from comps where clave = 'mixto')),
  '22023', null, 'un depósito que la tienda no usa («Venden desde acá») se rechaza'
);
select lives_ok(
  format($$select public.guardar_lineas_comprobante(%L, %L::jsonb, %L)$$,
    (select id from comps where clave = 'mixto'),
    '[{"producto_id":"b1000000-0000-0000-0000-000000000001","cantidad":1}]',
    (select actualizado from comps where clave = 'mixto')),
  'sin elegir depósito usa el principal de la tienda'
);
select pg_temp.como('f1000000-0000-0000-0000-000000000002');

select * from finish();
rollback;
