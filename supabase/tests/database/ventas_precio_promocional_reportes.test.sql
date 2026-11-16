-- MSF-816 / F-4 (spec 20261113-120000-precio-promocional-en-pos-y-comprobantes, FR-021): los reportes, las
-- exportaciones, la API, el webhook y las vistas de consulta de la IA NO cambian de contrato con la promoción.
--
-- Qué cubre:
--   · la rentabilidad REALIZADA (analitica.rentabilidad_ventas_real) refleja lo cobrado: el precio promocional
--     (no el normal) es lo que suma como vendido, con el costo guardado en la línea;
--   · el margen «actual» por producto y canal (analitica.margen_producto_canal) sigue con el precio NORMAL
--     (Decisión tomada 8) y no baja por la promoción;
--   · la promoción NO se valida contra el costo (seguimiento S3): se puede programar por debajo del costo y el
--     margen realizado queda en negativo;
--   · la exportación total incorpora las columnas nuevas por catálogo (private.conjuntos_exportacion_total);
--   · el evento `venta.registrada` no cambia de forma: las mismas claves y los totales ya promocionales, sin
--     `precio_referencia` ni `promocion_id`;
--   · `api_leer_ventas` y la vista de la IA (`public.ia_consulta_ventas`) devuelven las mismas columnas y los
--     totales ya promocionales.
--
-- Instantes y fechas del fixture: la promoción va de «ayer» a «mañana» (el precio se cobra en el momento) y la
-- factura es del 2027-03-01.
begin;

select no_plan();

insert into organizaciones (id, nombre) values
  ('11111111-1111-1111-1111-111111111111', 'Organización Reportes');

insert into auth.users (id, email) values
  ('f1000000-0000-0000-0000-000000000001', 'administrador@example.com');

insert into usuarios_organizacion (user_id, organizacion_id, rol_id, estado) values
  ('f1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'administrador', 'activo');

insert into dominio.empresas (id, organizacion_id, nombre) values
  ('a1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'Tienda A');

insert into usuarios_empresas (user_id, empresa_id, organizacion_id, rol_id) values
  ('f1000000-0000-0000-0000-000000000001', 'a1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'administrador');

insert into clientes (id, organizacion_id, numero, nombre, tipo, archivado_en, descuento) values
  ('c5000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 11, 'Cliente minorista', 'minorista', null, null);

insert into dominio.categorias (id, organizacion_id, nombre) values
  ('c1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'Joysticks');

-- R1 lista 1.000 con costo 400 (margen de referencia) · R2 lista 1.000 con costo 400 (para la promoción bajo el costo).
insert into dominio.productos (id, organizacion_id, nombre, sku, moneda, precio_lista, categoria_id, disponibilidad_manual, activo) values
  ('b5000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'Producto 1', 'R-1', 'ARS', 1000, 'c1000000-0000-0000-0000-000000000001', null, true),
  ('b5000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'Producto 2', 'R-2', 'ARS', 1000, 'c1000000-0000-0000-0000-000000000001', null, true);

insert into dominio.producto_costos (producto_id, organizacion_id, costo) values
  ('b5000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 400),
  ('b5000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 400);

insert into dominio.producto_empresa (producto_id, empresa_id, organizacion_id) values
  ('b5000000-0000-0000-0000-000000000001', 'a1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111'),
  ('b5000000-0000-0000-0000-000000000002', 'a1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111');

create temp table datos as
  select (select id from dominio.depositos where organizacion_id = '11111111-1111-1111-1111-111111111111' and por_defecto) as principal;
grant select on datos to public;
insert into dominio.depositos_empresas (deposito_id, empresa_id, organizacion_id)
select principal, 'a1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111' from datos
on conflict do nothing;

insert into dominio.existencias (producto_id, organizacion_id, cantidad, reservado)
select p.id, p.organizacion_id, 50, 0 from dominio.productos p where p.sku in ('R-1', 'R-2')
on conflict (producto_id) do update set cantidad = excluded.cantidad, reservado = excluded.reservado;
insert into dominio.existencias_deposito (producto_id, deposito_id, organizacion_id, cantidad, reservado)
select p.id, (select principal from datos), p.organizacion_id, 50, 0 from dominio.productos p where p.sku in ('R-1', 'R-2')
on conflict (producto_id, deposito_id) do update set cantidad = excluded.cantidad, reservado = excluded.reservado;

-- Solo para leer en las aserciones (la app lee por `obtener_comprobante`).
grant select on dominio.comprobantes_venta_lineas to authenticated;

create function pg_temp.como(p_user uuid) returns void language plpgsql as $$
begin
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
  set local role authenticated;
end $$;

create function pg_temp.bandera(p_activa boolean) returns void language plpgsql as $$
begin
  reset role;
  update public.banderas_plataforma set activa = p_activa where clave = 'promociones_precio';
end $$;

create temp table comps (clave text primary key, id uuid);
grant select, insert, update on comps to public;

create function pg_temp.crear(p_clave text) returns void language plpgsql as $$
declare v_c dominio.comprobantes_venta;
begin
  v_c := public.crear_comprobante('factura', 'a1000000-0000-0000-0000-000000000001',
    'c5000000-0000-0000-0000-000000000002', 'mostrador', '2027-03-01');
  insert into comps (clave, id) values (p_clave, v_c.id);
end $$;

create function pg_temp.id_de(p_clave text) returns uuid language sql as $$ select id from comps where clave = p_clave $$;
create function pg_temp.upd(p_clave text) returns timestamptz language sql security definer as $$
  select updated_at from dominio.comprobantes_venta where id = (select id from comps where clave = p_clave) $$;

create function pg_temp.guardar(p_clave text, p_lineas jsonb) returns void language plpgsql as $$
begin
  perform public.guardar_lineas_comprobante((select id from comps where clave = p_clave), p_lineas, pg_temp.upd(p_clave));
end $$;

-- La factura con una línea de 2 unidades del producto R1.
select pg_temp.bandera(true);
insert into dominio.promociones_precio (id, organizacion_id, empresa_id, producto_id, precio_promocional, desde, hasta) values
  ('e5000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'a1000000-0000-0000-0000-000000000001',
   'b5000000-0000-0000-0000-000000000001', 700, now() - interval '1 day', now() + interval '1 day');

select pg_temp.como('f1000000-0000-0000-0000-000000000001');
select pg_temp.crear('promo');
select pg_temp.guardar('promo', jsonb_build_array(
  jsonb_build_object('producto_id', 'b5000000-0000-0000-0000-000000000001', 'cantidad', 2)));
select public.confirmar_comprobante(pg_temp.id_de('promo'));
reset role;

-- ============================================================================
-- La rentabilidad realizada refleja lo cobrado (el precio promocional)
-- ============================================================================

select is((select l.precio_unitario from dominio.comprobantes_venta_lineas l
            where l.comprobante_id = pg_temp.id_de('promo')), 700.00,
  'la línea quedó con el precio promocional cobrado');
select is((select l.precio_referencia from dominio.comprobantes_venta_lineas l
            where l.comprobante_id = pg_temp.id_de('promo')), 1000.00,
  'la línea guarda el precio normal como referencia');
select is((select c.total_sin_iva from dominio.comprobantes_venta c where c.id = pg_temp.id_de('promo')), 1400.00,
  'el total sin IVA es el del precio promocional');
select is((select c.total_con_iva from dominio.comprobantes_venta c where c.id = pg_temp.id_de('promo')), 1694.00,
  'el total con IVA es el del precio promocional');

select is((select r.unidades from analitica.rentabilidad_ventas_real r
            where r.organizacion_id = '11111111-1111-1111-1111-111111111111'
              and r.producto_id = 'b5000000-0000-0000-0000-000000000001'), 2,
  'rentabilidad realizada: las unidades vendidas');
select is((select r.vendido from analitica.rentabilidad_ventas_real r
            where r.organizacion_id = '11111111-1111-1111-1111-111111111111'
              and r.producto_id = 'b5000000-0000-0000-0000-000000000001'), 1400.00,
  'rentabilidad realizada: lo vendido es el precio promocional cobrado');
select is((select r.costo from analitica.rentabilidad_ventas_real r
            where r.organizacion_id = '11111111-1111-1111-1111-111111111111'
              and r.producto_id = 'b5000000-0000-0000-0000-000000000001'), 800.00,
  'rentabilidad realizada: el costo guardado de la línea');
select is((select r.margen from analitica.rentabilidad_ventas_real r
            where r.organizacion_id = '11111111-1111-1111-1111-111111111111'
              and r.producto_id = 'b5000000-0000-0000-0000-000000000001'), 600.00,
  'rentabilidad realizada: el margen es lo cobrado menos el costo guardado');

-- ============================================================================
-- El margen «actual» por producto y canal sigue con el precio normal (Decisión tomada 8)
-- ============================================================================

select is((select m.precio_neto from analitica.margen_producto_canal m
            where m.organizacion_id = '11111111-1111-1111-1111-111111111111'
              and m.producto_id = 'b5000000-0000-0000-0000-000000000001'
              and m.empresa_id = 'a1000000-0000-0000-0000-000000000001'), 1000.00,
  'margen actual: el precio normal, no el promocional');
select is((select m.margen from analitica.margen_producto_canal m
            where m.organizacion_id = '11111111-1111-1111-1111-111111111111'
              and m.producto_id = 'b5000000-0000-0000-0000-000000000001'
              and m.empresa_id = 'a1000000-0000-0000-0000-000000000001'), 600.00,
  'margen actual: el margen es el del precio normal');

-- ============================================================================
-- La promoción no se valida contra el costo (seguimiento S3)
-- ============================================================================

select pg_temp.como('f1000000-0000-0000-0000-000000000001');
select lives_ok($$
  select public.guardar_promocion_precio(
    null,
    'a1000000-0000-0000-0000-000000000001',
    'b5000000-0000-0000-0000-000000000002',
    300,
    now() + interval '1 hour',
    now() + interval '2 days')
$$, 'se puede programar una promoción por debajo del costo (no se valida contra el costo)');
reset role;
select is((select p.precio_promocional from dominio.promociones_precio p
            where p.producto_id = 'b5000000-0000-0000-0000-000000000002'), 300.00,
  'la promoción bajo el costo quedó guardada');

-- ============================================================================
-- La exportación total incorpora las columnas nuevas por catálogo
-- ============================================================================

select ok((select 'precio_referencia' = any(c.columnas) from private.conjuntos_exportacion_total() c
            where c.esquema = 'dominio' and c.tabla = 'comprobantes_venta_lineas'),
  'la exportación total incluye la columna precio_referencia');
select ok((select 'promocion_id' = any(c.columnas) from private.conjuntos_exportacion_total() c
            where c.esquema = 'dominio' and c.tabla = 'comprobantes_venta_lineas'),
  'la exportación total incluye la columna promocion_id');

-- ============================================================================
-- El evento `venta.registrada` no cambia de forma
-- ============================================================================

select is((select count(*)::int from public.cola_eventos e
            where e.organizacion_id = '11111111-1111-1111-1111-111111111111' and e.tipo = 'venta.registrada'
              and e.clave_idempotencia = (select id::text from comps where clave = 'promo')), 1,
  'la factura confirmada encoló un evento venta.registrada');
select is((select e.carga->>'total_con_iva' from public.cola_eventos e
            where e.organizacion_id = '11111111-1111-1111-1111-111111111111' and e.tipo = 'venta.registrada'
              and e.clave_idempotencia = (select id::text from comps where clave = 'promo')), '1694.00',
  'el evento lleva el total ya promocional');
select is((select array_agg(k order by k) from (select jsonb_object_keys(e.carga) k from public.cola_eventos e
              where e.organizacion_id = '11111111-1111-1111-1111-111111111111' and e.tipo = 'venta.registrada'
                and e.clave_idempotencia = (select id::text from comps where clave = 'promo')) s)::text,
  '{comprobante_id,confirmado_en,numero,organizacion_id,ocurrido_en,tipo,total_con_iva,total_sin_iva}',
  'el evento mantiene las mismas claves (sin precio_referencia ni promocion_id)');

-- ============================================================================
-- La API pública de ventas no cambia de forma
-- ============================================================================

select is((select f.filas->0->>'total_con_iva' from private.api_leer_ventas(
              '11111111-1111-1111-1111-111111111111', null, 50, null) f), '1694.00',
  'la API de ventas devuelve el total ya promocional');
select is((select array_agg(k order by k) from (select jsonb_object_keys(f.filas->0) k
              from private.api_leer_ventas('11111111-1111-1111-1111-111111111111', null, 50, null) f) s)::text,
  '{confirmado_en,empresa_id,estado,fecha,id,numero,total_con_iva,total_sin_iva}',
  'la API de ventas mantiene las mismas claves (sin precio_referencia ni promocion_id)');

-- ============================================================================
-- La vista de consulta de la IA no cambia de forma
-- ============================================================================

select is((select string_agg(a.attname, ',' order by a.attnum) from pg_attribute a
            where a.attrelid = 'public.ia_consulta_ventas'::regclass and a.attnum > 0 and not a.attisdropped),
  'organizacion_id,comprobante_id,numero,fecha,empresa_id,total_sin_iva,total_con_iva,estado,confirmado_en',
  'la vista de la IA mantiene las mismas columnas');
select is((select v.total_con_iva from public.ia_consulta_ventas v
            where v.organizacion_id = '11111111-1111-1111-1111-111111111111'
              and v.comprobante_id = pg_temp.id_de('promo')), 1694.00,
  'la vista de la IA devuelve el total ya promocional');

select * from finish();
rollback;
