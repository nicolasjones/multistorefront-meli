-- F-REP-07 (MSF-265, spec 20261114-100000-analitica-avanzada-y-resumen-por-correo): vistas de los tableros
-- avanzados, aislamiento entre organizaciones y empresas, privilegios y alta de los tableros en el catálogo.
--   RF-REP-07-4/5: `analitica.ventas_empresa_categoria` y `analitica.margen_real_categoria` (cruces con categoría).
--   RF-REP-07-6:   los tableros «Analítica · …» se asignan a todas las organizaciones (actuales y nuevas) con su sección.
-- El fixture corre como postgres (RLS no aplica); las verificaciones de acceso, con el rol que corresponda.
begin;

select plan(23);

insert into organizaciones (id, nombre) values
  ('11111111-1111-1111-1111-111111111111', 'Organización Uno'),
  ('22222222-2222-2222-2222-222222222222', 'Organización Dos');

insert into auth.users (id, email) values
  ('c1000000-0000-0000-0000-000000000001', 'admin-uno@example.com'),
  ('c1000000-0000-0000-0000-000000000002', 'consulta-uno@example.com'),
  ('c2000000-0000-0000-0000-000000000001', 'admin-dos@example.com');

insert into usuarios_organizacion (user_id, organizacion_id, rol_id, estado) values
  ('c1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'administrador', 'activo'),
  ('c1000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'consulta', 'activo'),
  ('c2000000-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', 'administrador', 'activo');

insert into dominio.empresas (id, organizacion_id, nombre) values
  ('e1000000-0000-0000-0000-00000000000a', '11111111-1111-1111-1111-111111111111', 'Tienda A'),
  ('e1000000-0000-0000-0000-00000000000b', '11111111-1111-1111-1111-111111111111', 'Tienda B'),
  ('e2000000-0000-0000-0000-00000000000d', '22222222-2222-2222-2222-222222222222', 'Tienda D');

insert into public.clientes (id, organizacion_id, nombre, tipo) values
  ('c5000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'Cliente Uno', 'minorista'),
  ('c6000000-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', 'Cliente Dos', 'minorista');

insert into dominio.categorias (id, organizacion_id, nombre) values
  ('ca100000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'Calzado'),
  ('ca200000-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', 'Otra categoría');

insert into dominio.productos (id, organizacion_id, nombre, sku, precio_lista, categoria_id) values
  ('b1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'Zapato', 'P-1', 100, 'ca100000-0000-0000-0000-000000000001'),
  ('b1000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'Suelto', 'P-2', 100, null),
  ('b2000000-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', 'Producto Dos', 'P-9', 100, 'ca200000-0000-0000-0000-000000000001');

delete from dominio.depositos
 where por_defecto
   and organizacion_id in ('11111111-1111-1111-1111-111111111111', '22222222-2222-2222-2222-222222222222');
insert into dominio.depositos (id, organizacion_id, nombre, por_defecto) values
  ('d1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'Central', true),
  ('d2000000-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', 'Depósito Dos', true);

insert into dominio.comprobantes_venta
  (id, organizacion_id, empresa_id, cliente_id, tipo, numero, numero_entero, fecha, estado, total_sin_iva, total_con_iva)
values
  ('a1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'e1000000-0000-0000-0000-00000000000a', 'c5000000-0000-0000-0000-000000000001', 'factura', '00000001', 1, current_date - 1, 'confirmada', 1000, 1210),
  ('a1000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'e1000000-0000-0000-0000-00000000000b', 'c5000000-0000-0000-0000-000000000001', 'factura', '00000001', 1, current_date - 1, 'confirmada', 2000, 2420),
  ('a2000000-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', 'e2000000-0000-0000-0000-00000000000d', 'c6000000-0000-0000-0000-000000000001', 'factura', '00000001', 1, current_date - 1, 'confirmada', 6000, 7260);

-- Tienda A vende Zapato (con categoría, costo 400); Tienda B vende «Suelto» (sin categoría, costo 1200); Dos vende lo suyo.
insert into dominio.comprobantes_venta_lineas
  (organizacion_id, comprobante_id, orden, producto_id, descripcion, codigo, cantidad, precio_unitario, escala, deposito_id, subtotal_sin_iva, iva, costo_unitario)
values
  ('11111111-1111-1111-1111-111111111111', 'a1000000-0000-0000-0000-000000000001', 1, 'b1000000-0000-0000-0000-000000000001', 'Zapato', 'COD', 1, 1000, 'x1', 'd1000000-0000-0000-0000-000000000001', 1000, 210, 400),
  ('11111111-1111-1111-1111-111111111111', 'a1000000-0000-0000-0000-000000000002', 1, 'b1000000-0000-0000-0000-000000000002', 'Suelto', 'COD', 2, 1000, 'x1', 'd1000000-0000-0000-0000-000000000001', 2000, 420, 1200),
  ('22222222-2222-2222-2222-222222222222', 'a2000000-0000-0000-0000-000000000001', 1, 'b2000000-0000-0000-0000-000000000001', 'Producto Dos', 'COD', 1, 6000, 'x1', 'd2000000-0000-0000-0000-000000000001', 6000, 1260, 1000);

-- ============================================================================
-- RF-REP-07-4 · ventas × tienda × categoría
-- ============================================================================

select is(
  (select count(*)::int from analitica.ventas_empresa_categoria
    where organizacion_id = '11111111-1111-1111-1111-111111111111'),
  2, 'ventas_empresa_categoria: la organización Uno tiene sus 2 filas (tienda × categoría × producto × fecha)'
);
select is(
  (select count(*)::int from analitica.ventas_empresa_categoria
    where organizacion_id = '11111111-1111-1111-1111-111111111111'
      and empresa_id = 'e2000000-0000-0000-0000-00000000000d'),
  0, 'ventas_empresa_categoria: ninguna fila de Uno trae una empresa de la Dos (frontera del guest token)'
);
select is(
  (select facturado from analitica.ventas_empresa_categoria
    where empresa_id = 'e1000000-0000-0000-0000-00000000000a' and categoria = 'Calzado'),
  1210.00::numeric, 'ventas_empresa_categoria: facturado con IVA de Tienda A en Calzado'
);
select is(
  (select unidades from analitica.ventas_empresa_categoria
    where empresa_id = 'e1000000-0000-0000-0000-00000000000b'),
  2::bigint, 'ventas_empresa_categoria: unidades de Tienda B'
);
select is(
  (select categoria from analitica.ventas_empresa_categoria
    where empresa_id = 'e1000000-0000-0000-0000-00000000000b'),
  'Sin categoría', 'ventas_empresa_categoria: el producto sin categoría cuenta como «Sin categoría»'
);
select is(
  (select count(*)::int from analitica.ventas_empresa_categoria v
    where not exists (select 1 from dominio.empresas e
                       where e.id = v.empresa_id and e.organizacion_id = v.organizacion_id and e.nombre = v.empresa_nombre)),
  0, 'ventas_empresa_categoria: organizacion_id, empresa_id y empresa_nombre son coherentes en toda fila'
);

-- La nota de crédito resta (mismo helper que «Más vendidos»); un borrador no cuenta.
insert into dominio.comprobantes_venta
  (id, organizacion_id, empresa_id, cliente_id, tipo, numero, numero_entero, fecha, estado, total_sin_iva, total_con_iva)
values
  ('a1000000-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111', 'e1000000-0000-0000-0000-00000000000a', 'c5000000-0000-0000-0000-000000000001', 'factura', '00000002', 2, current_date - 1, 'borrador', 500, 605);
insert into dominio.comprobantes_venta_lineas
  (organizacion_id, comprobante_id, orden, producto_id, descripcion, codigo, cantidad, precio_unitario, escala, deposito_id, subtotal_sin_iva, iva, costo_unitario)
values
  ('11111111-1111-1111-1111-111111111111', 'a1000000-0000-0000-0000-000000000003', 1, 'b1000000-0000-0000-0000-000000000001', 'Zapato', 'COD', 1, 500, 'x1', 'd1000000-0000-0000-0000-000000000001', 500, 105, 400);
select is(
  (select facturado from analitica.ventas_empresa_categoria
    where empresa_id = 'e1000000-0000-0000-0000-00000000000a' and categoria = 'Calzado'),
  1210.00::numeric, 'ventas_empresa_categoria: un borrador no entra en el facturado'
);

-- ============================================================================
-- RF-REP-07-5 · margen real × tienda × categoría × producto
-- ============================================================================

select is(
  (select margen from analitica.margen_real_categoria
    where empresa_id = 'e1000000-0000-0000-0000-00000000000a' and categoria = 'Calzado'),
  (select margen from analitica.rentabilidad_ventas_real where empresa_id = 'e1000000-0000-0000-0000-00000000000a'),
  'margen_real_categoria: el margen es el de rentabilidad_ventas_real (un único cálculo)'
);
select is(
  (select vendido - costo from analitica.margen_real_categoria
    where empresa_id = 'e1000000-0000-0000-0000-00000000000a'),
  600.00::numeric, 'margen_real_categoria: vendido (sin IVA) menos el costo guardado de la línea'
);
select is(
  (select count(*)::int from analitica.margen_real_categoria
    where organizacion_id = '11111111-1111-1111-1111-111111111111'
      and empresa_id = 'e2000000-0000-0000-0000-00000000000d'),
  0, 'margen_real_categoria: ninguna fila de Uno trae una empresa de la Dos'
);
select is(
  (select count(*)::int from analitica.margen_real_categoria
    where organizacion_id = '11111111-1111-1111-1111-111111111111'),
  2, 'margen_real_categoria: las 2 filas de Uno (la categoría no multiplica filas)'
);
select is(
  (select estado from analitica.margen_real_categoria where empresa_id = 'e1000000-0000-0000-0000-00000000000b'),
  'negativo', 'margen_real_categoria: la venta bajo el costo queda en estado negativo'
);

-- ============================================================================
-- Privilegios: solo el rol de Superset lee las vistas
-- ============================================================================

select is(
  (select count(*)::int from unnest(array['analitica.ventas_empresa_categoria', 'analitica.margen_real_categoria']) v
    where has_table_privilege('anon', v, 'select') or has_table_privilege('authenticated', v, 'select')),
  0, 'anon y authenticated no leen ninguna de las dos vistas'
);
select is(
  (select count(*)::int from unnest(array['analitica.ventas_empresa_categoria', 'analitica.margen_real_categoria']) v
    where has_table_privilege('superset_analitica', v, 'select')),
  2, 'el rol de solo lectura de Superset lee las dos vistas'
);
select is(
  (select count(*)::int from unnest(array['analitica.ventas_empresa_categoria', 'analitica.margen_real_categoria']) v
    where has_table_privilege('superset_analitica', v, 'insert')
       or has_table_privilege('superset_analitica', v, 'update')
       or has_table_privilege('superset_analitica', v, 'delete')),
  0, 'el rol de Superset no escribe en las vistas'
);

-- ============================================================================
-- RF-REP-07-6 · alta de los tableros en el catálogo y asignación a las organizaciones
-- ============================================================================

-- Al registrar un tablero «Analítica · …» (lo hace el importador de dashboards) queda asignado a las dos organizaciones.
insert into reportes (id, superset_dashboard_uuid, nombre, creado_por, seccion) values
  ('f0000000-0000-0000-0000-000000000001', 'dash-prueba-analitica', 'Analítica · Prueba', 'c1000000-0000-0000-0000-000000000001', 'reportes'),
  ('f0000000-0000-0000-0000-000000000002', 'dash-otro', 'Ventas · Otro tablero', 'c1000000-0000-0000-0000-000000000001', 'reportes');
select is(
  (select count(*)::int from reportes_organizaciones where reporte_id = 'f0000000-0000-0000-0000-000000000001'
     and organizacion_id in ('11111111-1111-1111-1111-111111111111', '22222222-2222-2222-2222-222222222222')),
  2, 'un tablero «Analítica · …» nuevo queda asignado a las dos organizaciones'
);
select is(
  (select count(*)::int from reportes_organizaciones where reporte_id = 'f0000000-0000-0000-0000-000000000002'),
  0, 'un reporte que no es de la galería no se asigna solo'
);

-- Los roles por defecto que llegan después de la asignación se propagan a las organizaciones asignadas.
insert into reportes_roles_default (reporte_id, rol_id) values ('f0000000-0000-0000-0000-000000000001', 'administracion');
select is(
  (select count(*)::int from reportes_organizaciones_roles where reporte_id = 'f0000000-0000-0000-0000-000000000001' and rol_id = 'administracion'
     and organizacion_id in ('11111111-1111-1111-1111-111111111111', '22222222-2222-2222-2222-222222222222')),
  2, 'el rol por defecto agregado después se propaga a las dos organizaciones'
);

-- Una organización nueva recibe los tableros ya registrados.
insert into organizaciones (id, nombre) values ('33333333-3333-3333-3333-333333333333', 'Organización Tres');
select is(
  (select count(*)::int from reportes_organizaciones
    where organizacion_id = '33333333-3333-3333-3333-333333333333' and reporte_id = 'f0000000-0000-0000-0000-000000000001'),
  1, 'una organización nueva recibe el tablero «Analítica · …»'
);
select is(
  (select count(*)::int from reportes_organizaciones_roles
    where organizacion_id = '33333333-3333-3333-3333-333333333333' and reporte_id = 'f0000000-0000-0000-0000-000000000001'),
  1, 'y hereda sus roles por defecto'
);

-- El administrador accede (sección reportes); un rol sin la sección no.
create function pg_temp.como(p_user uuid) returns void language plpgsql as $$
begin
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
  set local role authenticated;
end $$;

select pg_temp.como('c1000000-0000-0000-0000-000000000001');
select is(
  public.resolver_organizacion_reporte('f0000000-0000-0000-0000-000000000001'),
  '11111111-1111-1111-1111-111111111111'::uuid, 'el administrador de Uno resuelve la organización Uno para el tablero'
);
reset role;

select pg_temp.como('c1000000-0000-0000-0000-000000000002');
select is(
  public.resolver_organizacion_reporte('f0000000-0000-0000-0000-000000000001'),
  null::uuid, 'un rol sin la sección del tablero (consulta) no obtiene organización: sin token'
);
reset role;

select pg_temp.como('c2000000-0000-0000-0000-000000000001');
select is(
  public.resolver_organizacion_reporte('f0000000-0000-0000-0000-000000000001'),
  '22222222-2222-2222-2222-222222222222'::uuid, 'el administrador de Dos resuelve SU organización, nunca la de Uno'
);
reset role;

select * from finish();
rollback;
