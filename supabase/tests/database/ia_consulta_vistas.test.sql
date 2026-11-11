-- F-IA-01 (MSF-411) · FR-021/FR-022, SC-005: las vistas `public.ia_consulta_*` del asistente aíslan por organización,
-- respetan el nivel de la sección del rol (RLS de la sesión), `anon` no accede, son `security_invoker` y exponen
-- EXACTAMENTE las columnas del contrato (sin costos, márgenes ni datos del cliente).
begin;

select plan(23);

insert into organizaciones (id, nombre) values
  ('11111111-1111-1111-1111-111111111111', 'Organización Uno'),
  ('22222222-2222-2222-2222-222222222222', 'Organización Dos');

insert into auth.users (id, email) values
  ('d1000000-0000-0000-0000-000000000001', 'admin-uno@example.com'),
  ('d1000000-0000-0000-0000-000000000002', 'tecnico-uno@example.com'),
  ('d2000000-0000-0000-0000-000000000001', 'admin-dos@example.com');

insert into usuarios_organizacion (user_id, organizacion_id, rol_id) values
  ('d1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'administrador'),
  ('d1000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'tecnico'),
  ('d2000000-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', 'administrador');

insert into dominio.categorias (id, organizacion_id, nombre, padre_id) values
  ('c1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'Periféricos', null);
insert into dominio.categorias (id, organizacion_id, nombre, padre_id) values
  ('c1000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'Joysticks', 'c1000000-0000-0000-0000-000000000001');

insert into dominio.productos (id, organizacion_id, nombre, sku, moneda, precio_lista, categoria_id) values
  ('a1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'Joystick', 'JOY-1', 'USD', 100, 'c1000000-0000-0000-0000-000000000002'),
  ('a1000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'Cable', 'CAB-1', 'ARS', 10, 'c1000000-0000-0000-0000-000000000001'),
  ('a2000000-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', 'Teclado de otra org', 'TEC-1', 'ARS', 50, null);

-- Escala x5 con precio; x10 sin precio (null = escala sin precio). Un trigger puede haber creado ya las filas.
insert into dominio.producto_precios_escala (producto_id, organizacion_id, escala, precio) values
  ('a1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'x5', 90)
on conflict (producto_id, escala) do update set precio = excluded.precio;
insert into dominio.producto_precios_escala (producto_id, organizacion_id, escala, precio) values
  ('a1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'x10', null)
on conflict (producto_id, escala) do update set precio = excluded.precio;

create temp table datos as
  select (select id from dominio.depositos
           where organizacion_id = '11111111-1111-1111-1111-111111111111' and por_defecto) as principal;
grant select on datos to public;

insert into dominio.existencias (producto_id, organizacion_id, cantidad, reservado)
values ('a1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 10, 3)
on conflict (producto_id) do update set cantidad = excluded.cantidad, reservado = excluded.reservado, updated_at = now();

insert into dominio.existencias_deposito (producto_id, deposito_id, organizacion_id, cantidad, reservado)
select 'a1000000-0000-0000-0000-000000000001', principal, '11111111-1111-1111-1111-111111111111', 10, 3 from datos;

insert into public.clientes (id, organizacion_id, nombre, tipo) values
  ('c5000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'Cliente Uno', 'minorista'),
  ('c6000000-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', 'Cliente Dos', 'minorista');

-- Una factura confirmada, una en borrador y un presupuesto confirmado en la organización Uno; una confirmada en Dos.
insert into dominio.comprobantes_venta
  (organizacion_id, cliente_id, tipo, numero, fecha, estado, total_sin_iva, total_con_iva, confirmado_en)
values
  ('11111111-1111-1111-1111-111111111111', 'c5000000-0000-0000-0000-000000000001', 'factura', '0001-00000001', current_date, 'confirmada', 100, 121, now()),
  ('11111111-1111-1111-1111-111111111111', 'c5000000-0000-0000-0000-000000000001', 'factura', '0001-00000002', current_date, 'borrador', 50, 60.5, null),
  ('11111111-1111-1111-1111-111111111111', 'c5000000-0000-0000-0000-000000000001', 'presupuesto', '0001-00000003', current_date, 'confirmada', 70, 84.7, now()),
  ('22222222-2222-2222-2222-222222222222', 'c6000000-0000-0000-0000-000000000001', 'factura', '0001-00000001', current_date, 'confirmada', 999, 1208, now());

create function pg_temp.como(p_user uuid) returns void language plpgsql as $$
begin
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
  set local role authenticated;
end $$;

-- Contrato (1-6)
select is(
  (select bool_or(has_table_privilege('anon', 'public.' || v, 'SELECT'))
     from unnest(array['ia_consulta_catalogo', 'ia_consulta_stock', 'ia_consulta_precios', 'ia_consulta_ventas']) v),
  false, 'anon no lee ninguna de las cuatro vistas'
);
select is(
  (select count(*)::int from pg_class
    where relnamespace = 'public'::regnamespace
      and relname in ('ia_consulta_catalogo', 'ia_consulta_stock', 'ia_consulta_precios', 'ia_consulta_ventas')
      and reloptions::text = '{security_invoker=true}'),
  4, 'las cuatro vistas son security_invoker (rige la RLS de la sesión)'
);
select is(
  (select array_agg(attname::text order by attnum) from pg_attribute
    where attrelid = 'public.ia_consulta_catalogo'::regclass and attnum > 0 and not attisdropped),
  array['organizacion_id', 'producto_id', 'nombre', 'sku', 'categoria_id', 'categoria', 'activo', 'actualizado_en'],
  'columnas exactas del catálogo'
);
select is(
  (select array_agg(attname::text order by attnum) from pg_attribute
    where attrelid = 'public.ia_consulta_stock'::regclass and attnum > 0 and not attisdropped),
  array['organizacion_id', 'producto_id', 'nombre', 'sku', 'deposito_id', 'deposito', 'cantidad', 'reservado', 'disponible', 'actualizado_en'],
  'columnas exactas del stock'
);
select is(
  (select array_agg(attname::text order by attnum) from pg_attribute
    where attrelid = 'public.ia_consulta_precios'::regclass and attnum > 0 and not attisdropped),
  array['organizacion_id', 'producto_id', 'nombre', 'sku', 'moneda', 'precio_lista', 'precio_x5', 'precio_x10', 'precio_x50', 'actualizado_en'],
  'columnas exactas de los precios (sin costo ni IVA)'
);
select is(
  (select array_agg(attname::text order by attnum) from pg_attribute
    where attrelid = 'public.ia_consulta_ventas'::regclass and attnum > 0 and not attisdropped),
  array['organizacion_id', 'comprobante_id', 'numero', 'fecha', 'empresa_id', 'total_sin_iva', 'total_con_iva', 'estado', 'confirmado_en'],
  'columnas exactas de las ventas (sin cliente)'
);

-- Organización Uno, administrador (7-14)
select pg_temp.como('d1000000-0000-0000-0000-000000000001');
select is((select count(*)::int from public.ia_consulta_catalogo), 2, 'el administrador de Uno ve sus 2 productos');
select is(
  (select count(*)::int from public.ia_consulta_catalogo where nombre = 'Teclado de otra org'),
  0, 'no ve productos de otra organización'
);
select is(
  (select categoria from public.ia_consulta_catalogo where sku = 'JOY-1'),
  'Periféricos > Joysticks', 'la categoría hija se muestra con su ruta «Padre > Hija»'
);
select is(
  (select disponible from public.ia_consulta_stock where sku = 'JOY-1'),
  7, 'el disponible es cantidad − reservado'
);
select is((select count(*)::int from public.ia_consulta_stock), 1, 'el stock lista solo lo que tiene existencias por depósito');
select is(
  (select precio_x5 from public.ia_consulta_precios where sku = 'JOY-1'),
  90::numeric, 'la escala x5 trae su precio'
);
select is(
  (select precio_x10 is null from public.ia_consulta_precios where sku = 'JOY-1'),
  true, 'una escala sin precio es null'
);
select is(
  (select array_agg(numero order by numero) from public.ia_consulta_ventas),
  array['0001-00000001'], 'las ventas son solo facturas confirmadas (no borradores ni presupuestos)'
);
reset role;

-- Organización Uno, técnico: productos en lectura, ventas y categorías en ninguno (15-19)
select pg_temp.como('d1000000-0000-0000-0000-000000000002');
select is((select private.nivel_seccion('ventas')), 'ninguno', 'precondición: el técnico no tiene la sección Ventas');
select is((select count(*)::int from public.ia_consulta_ventas), 0, 'sin sección Ventas el asistente no devuelve ventas');
select is((select count(*)::int from public.ia_consulta_catalogo), 2, 'con Productos en lectura sí ve el catálogo');
select is((select private.nivel_seccion('categorias')), 'ninguno', 'precondición: el técnico no tiene la sección Categorías');
select is(
  (select categoria from public.ia_consulta_catalogo where sku = 'JOY-1'),
  'Periféricos > Joysticks', 'sin la sección Categorías igual ve la categoría del producto (se rige por Productos)'
);
reset role;

-- Organización Dos (20-21)
select pg_temp.como('d2000000-0000-0000-0000-000000000001');
select is((select count(*)::int from public.ia_consulta_catalogo), 1, 'Dos ve solo su producto');
select is(
  (select array_agg(numero) from public.ia_consulta_ventas), array['0001-00000001'],
  'Dos ve solo su factura (mismo número que la de Uno, otra organización)'
);
reset role;

-- anon (22-23)
select set_config('request.jwt.claims', null, true);
set local role anon;
select throws_ok($$select count(*) from public.ia_consulta_catalogo$$, '42501', null, 'anon recibe permiso denegado en el catálogo');
select throws_ok($$select count(*) from public.ia_consulta_ventas$$, '42501', null, 'anon recibe permiso denegado en las ventas');
reset role;

select * from finish();
rollback;
