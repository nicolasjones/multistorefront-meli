-- MSF-287 · F-REP-08 (épica MSF-265, spec 20261101-100000-analitica-avanzada-y-resumen-por-correo,
-- FR-012, FR-014): secciones del resumen semanal. Cada sección sale de su fuente y solo si la
-- fuente existe y tiene datos de la organización; el correo no muestra secciones que el
-- destinatario no puede ver en el panel.
--
-- SC-003: sin ventas ni stock en alerta, el resumen sale sin esas secciones.
begin;

select plan(10);

-- ============================================================================
-- Fixture
-- ============================================================================

insert into organizaciones (id, nombre) values
  ('11111111-1111-1111-1111-111111111111', 'Organización Uno'),
  ('22222222-2222-2222-2222-222222222222', 'Organización Dos');

insert into auth.users (id, email) values
  ('c1000000-0000-0000-0000-000000000001', 'admin-uno@example.com'),
  ('c1000000-0000-0000-0000-000000000002', 'administracion-uno@example.com'),
  ('c1000000-0000-0000-0000-000000000003', 'tecnico-uno@example.com'),
  ('c2000000-0000-0000-0000-000000000001', 'admin-dos@example.com');

insert into usuarios_organizacion (user_id, organizacion_id, rol_id, estado) values
  ('c1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'administrador', 'activo'),
  ('c1000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'administracion', 'activo'),
  ('c1000000-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111', 'tecnico', 'activo'),
  ('c2000000-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', 'administrador', 'activo');

-- El rol `administracion` de la organización uno NO tiene acceso a `ventas` (la matriz inicial
-- se la da; acá se la saca): es el caso negativo de FR-014 con TODO lo demás igual. El rol
-- `administrador` de la misma organización sí lo tiene: el control que muestra que la sección
-- existe y que el permiso es lo que la saca.
insert into public.permisos_rol (organizacion_id, rol_id, seccion, nivel)
values ('11111111-1111-1111-1111-111111111111', 'administracion', 'ventas', 'ninguno')
on conflict (organizacion_id, rol_id, seccion) do update set nivel = 'ninguno';

insert into public.clientes (id, organizacion_id, nombre, tipo) values
  ('cc100000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'Distribuidora Ñandú', 'mayorista'),
  ('cc200000-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', 'Cliente de la Dos', 'minorista');

insert into dominio.empresas (id, organizacion_id, nombre) values
  ('e1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'Mundo JC'),
  ('e2000000-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', 'Empresa Dos');

-- Org 1: un producto con costo (rentabilidad) y otro sin stock (alerta de stock).
-- Org 2: un producto con costo y stock disponible (sin ventas ni alertas).
-- `moneda = 'ARS'` para que el neto y el costo no dependan de la cotización del dólar.
insert into dominio.productos (id, organizacion_id, nombre, sku, moneda, precio_lista) values
  ('b1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'Teclado', 'TEC-1', 'ARS', 1000),
  ('b1000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'Mouse', 'MOU-1', 'ARS', 500),
  ('b2000000-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', 'Teclado Dos', 'TEC-2', 'ARS', 500);

insert into dominio.producto_costos (producto_id, organizacion_id, costo) values
  ('b1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 600),
  ('b2000000-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', 300);

insert into dominio.existencias (producto_id, organizacion_id, cantidad, minimo) values
  ('b1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 10, 5),
  ('b1000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 0, 5),
  ('b2000000-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', 10, 5)
on conflict (producto_id) do update
  set cantidad = excluded.cantidad, minimo = excluded.minimo;

-- Una factura confirmada de la organización uno, de ayer (dentro del período de 7 días).
insert into dominio.comprobantes_venta
  (organizacion_id, empresa_id, cliente_id, tipo, numero, numero_entero, fecha, estado, total_sin_iva, total_con_iva)
values
  ('11111111-1111-1111-1111-111111111111', 'e1000000-0000-0000-0000-000000000001', 'cc100000-0000-0000-0000-000000000001',
   'factura', '00000001', 1, current_date - 1, 'confirmada', 2000, 2420);

insert into dominio.comprobantes_venta_lineas
  (organizacion_id, comprobante_id, orden, producto_id, descripcion, codigo, cantidad, precio_unitario, escala, deposito_id, subtotal_sin_iva, iva)
values
  ('11111111-1111-1111-1111-111111111111',
   (select id from dominio.comprobantes_venta where organizacion_id = '11111111-1111-1111-1111-111111111111' and numero = '00000001'),
   1, 'b1000000-0000-0000-0000-000000000001', 'Teclado', 'TEC-1', 2, 1000, 'x1',
   (select id from dominio.depositos where organizacion_id = '11111111-1111-1111-1111-111111111111' and por_defecto),
   2000, 420);

-- Semana de prueba relativa al reloj.
create temp table semanas on commit drop as
select to_char(now() - interval '1 week', 'IYYY-"W"IW') as w1;

-- ============================================================================
-- Secciones del resumen (FR-012)
-- ============================================================================

select is(
  (select string_agg(s.seccion ->> 'clave', ',' order by s.seccion ->> 'clave')
     from jsonb_array_elements(
       private.armar_resumen_semanal('11111111-1111-1111-1111-111111111111', 'c1000000-0000-0000-0000-000000000001', (select w1 from semanas))
       -> 'secciones') s(seccion)),
  'rentabilidad,stock,ventas',
  'con ventas y stock en alerta el resumen trae las tres secciones'
);

select is(
  (select d.dato ->> 'valor'
     from jsonb_array_elements(
       private.armar_resumen_semanal('11111111-1111-1111-1111-111111111111', 'c1000000-0000-0000-0000-000000000001', (select w1 from semanas))
       -> 'secciones') s(seccion),
     lateral jsonb_array_elements(s.seccion -> 'datos') d(dato)
    where s.seccion ->> 'clave' = 'ventas' and d.dato ->> 'clave' = 'unidades'),
  '2',
  'la sección de ventas trae las unidades del período'
);

select is(
  (select d.dato ->> 'valor'
     from jsonb_array_elements(
       private.armar_resumen_semanal('11111111-1111-1111-1111-111111111111', 'c1000000-0000-0000-0000-000000000001', (select w1 from semanas))
       -> 'secciones') s(seccion),
     lateral jsonb_array_elements(s.seccion -> 'datos') d(dato)
    where s.seccion ->> 'clave' = 'stock' and d.dato ->> 'clave' = 'sin_stock'),
  '1',
  'la sección de stock trae los productos sin stock'
);

-- SC-003: la organización dos no tiene ventas ni stock en alerta.
select is(
  (select string_agg(s.seccion ->> 'clave', ',' order by s.seccion ->> 'clave')
     from jsonb_array_elements(
       private.armar_resumen_semanal('22222222-2222-2222-2222-222222222222', 'c2000000-0000-0000-0000-000000000001', (select w1 from semanas))
       -> 'secciones') s(seccion)),
  'rentabilidad',
  'sin ventas ni stock en alerta el resumen sale sin esas secciones'
);

select is(
  (select count(*)::int from private.reclamar_resumen_semanal(50, (select w1 from semanas))
    where organizacion_id in ('11111111-1111-1111-1111-111111111111', '22222222-2222-2222-2222-222222222222')),
  3,
  'la corrida reclama a los tres destinatarios que tienen resumen'
);

-- ============================================================================
-- Cada sección solo si el destinatario tiene acceso a ella (FR-014)
-- ============================================================================

-- Con la vista de ventas presente: la sección existe y el permiso es lo que la saca. Si la
-- condición de acceso se perdiera, este resumen traería `ventas` y la aserción fallaría.
select is(
  (select string_agg(s.seccion ->> 'clave', ',' order by s.seccion ->> 'clave')
     from jsonb_array_elements(
       private.armar_resumen_semanal('11111111-1111-1111-1111-111111111111', 'c1000000-0000-0000-0000-000000000002', (select w1 from semanas))
       -> 'secciones') s(seccion)),
  'rentabilidad,stock',
  'el resumen no trae la sección de ventas a quien no tiene acceso a ventas'
);

-- El rol `tecnico` es el único de la matriz sin `ventas` (y sin `rentabilidad`): su resumen
-- lleva solo la sección que puede ver. Si la condición de acceso se perdiera, traería `ventas`.
select is(
  (select string_agg(s.seccion ->> 'clave', ',' order by s.seccion ->> 'clave')
     from jsonb_array_elements(
       private.armar_resumen_semanal('11111111-1111-1111-1111-111111111111', 'c1000000-0000-0000-0000-000000000003', (select w1 from semanas))
       -> 'secciones') s(seccion)),
  'stock',
  'el resumen no trae ventas ni rentabilidad a quien la matriz no le da (tecnico)'
);

-- ============================================================================
-- Sin la fuente, la sección se omite sin error (FR-012)
-- ============================================================================

do $$
begin
  if to_regclass('analitica.ventas_producto_mas_vendido') is not null then
    execute 'alter view analitica.ventas_producto_mas_vendido rename to ventas_producto_mas_vendido_temporal';
  end if;
end
$$;

select is(
  (select string_agg(s.seccion ->> 'clave', ',' order by s.seccion ->> 'clave')
     from jsonb_array_elements(
       private.armar_resumen_semanal('11111111-1111-1111-1111-111111111111', 'c1000000-0000-0000-0000-000000000001', (select w1 from semanas))
       -> 'secciones') s(seccion)),
  'rentabilidad,stock',
  'sin la vista de ventas la sección se omite sin error'
);

select is(
  (select count(*)::int
     from jsonb_array_elements(
       private.armar_resumen_semanal('11111111-1111-1111-1111-111111111111', 'c1000000-0000-0000-0000-000000000001', (select w1 from semanas))
       -> 'secciones') s(seccion)
    where btrim(coalesce(s.seccion ->> 'titulo', '')) = ''),
  0,
  'cada sección trae su título'
);

select is(
  (select private.armar_resumen_semanal('33333333-3333-3333-3333-333333333333', 'c1000000-0000-0000-0000-000000000001', (select w1 from semanas)) is null),
  true,
  'una organización que no existe no arma resumen'
);

select * from finish();
rollback;
