-- F-REP-05 (MSF-248, épica MSF-192, SC-011): aislamiento de `analitica.ventas_periodo_canal` entre
-- organizaciones y empresas, y sin acceso para quien no es el rol de Superset.
--
-- La vista la lee Superset y el guest token fuerza `organizacion_id` + `empresa_id`: acá se verifica que
-- cada fila trae esas dos columnas bien puestas (la frontera que filtra el token) y que ni `anon` ni
-- `authenticated` —con o sin la sección `reportes`— leen la vista. El conteo del estado vacío es el de
-- «Más vendidos» (`public.ventas_reportes_conteo`): se verifica que respeta la misma frontera y exige la
-- sección `reportes`. Fechas relativas al reloj de la base.
begin;

select plan(11);

insert into organizaciones (id, nombre) values
  ('11111111-1111-1111-1111-111111111111', 'Organización Uno'),
  ('22222222-2222-2222-2222-222222222222', 'Organización Dos');

insert into auth.users (id, email) values
  ('c1000000-0000-0000-0000-000000000001', 'admin-uno@example.com'),
  ('c1000000-0000-0000-0000-000000000002', 'consulta-uno@example.com'),
  ('c2000000-0000-0000-0000-000000000001', 'admin-dos@example.com'),
  ('c1000000-0000-0000-0000-000000000003', 'administracion-uno@example.com');

insert into usuarios_organizacion (user_id, organizacion_id, rol_id, estado) values
  ('c1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'administrador', 'activo'),
  ('c1000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'consulta', 'activo'),
  ('c1000000-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111', 'administracion', 'activo'),
  ('c2000000-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', 'administrador', 'activo');

insert into dominio.empresas (id, organizacion_id, nombre) values
  ('e1000000-0000-0000-0000-00000000000a', '11111111-1111-1111-1111-111111111111', 'Tienda A'),
  ('e1000000-0000-0000-0000-00000000000b', '11111111-1111-1111-1111-111111111111', 'Tienda B'),
  ('e2000000-0000-0000-0000-00000000000d', '22222222-2222-2222-2222-222222222222', 'Tienda D');

-- `administracion` solo tiene Tienda A: no ve las ventas de Tienda B.
insert into public.usuarios_empresas (user_id, empresa_id, organizacion_id, rol_id) values
  ('c1000000-0000-0000-0000-000000000003', 'e1000000-0000-0000-0000-00000000000a', '11111111-1111-1111-1111-111111111111', 'administracion');

insert into public.clientes (id, organizacion_id, nombre, tipo) values
  ('c5000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'Cliente Uno', 'minorista'),
  ('c6000000-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', 'Cliente Dos', 'minorista');

insert into dominio.comprobantes_venta
  (organizacion_id, empresa_id, cliente_id, tipo, numero, numero_entero, fecha, estado, total_sin_iva, total_con_iva)
values
  ('11111111-1111-1111-1111-111111111111', 'e1000000-0000-0000-0000-00000000000a', 'c5000000-0000-0000-0000-000000000001', 'factura', '00000001', 1, current_date - 1, 'confirmada', 1000, 1210),
  ('11111111-1111-1111-1111-111111111111', 'e1000000-0000-0000-0000-00000000000b', 'c5000000-0000-0000-0000-000000000001', 'factura', '00000001', 1, current_date - 1, 'confirmada', 2000, 2420),
  ('11111111-1111-1111-1111-111111111111', 'e1000000-0000-0000-0000-00000000000b', 'c5000000-0000-0000-0000-000000000001', 'factura', '00000002', 2, current_date - 2, 'confirmada',  500,  605),
  ('22222222-2222-2222-2222-222222222222', 'e2000000-0000-0000-0000-00000000000d', 'c6000000-0000-0000-0000-000000000001', 'factura', '00000001', 1, current_date - 1, 'confirmada', 6000, 7260);

insert into dominio.productos (id, organizacion_id, nombre, sku, precio_lista) values
  ('b1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'Producto Uno', 'P-1', 100),
  ('b2000000-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', 'Producto Dos', 'P-2', 100);

-- Se reemplazan los depósitos principales sembrados (un solo `por_defecto` por organización).
delete from dominio.depositos
 where por_defecto
   and organizacion_id in ('11111111-1111-1111-1111-111111111111', '22222222-2222-2222-2222-222222222222');

insert into dominio.depositos (id, organizacion_id, nombre, por_defecto) values
  ('d1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'Central', true),
  ('d2000000-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', 'Depósito Dos', true);

-- Una línea por comprobante (el conteo del estado vacío cuenta comprobantes con líneas).
insert into dominio.comprobantes_venta_lineas
  (organizacion_id, comprobante_id, orden, producto_id, descripcion, codigo, cantidad, precio_unitario, escala, deposito_id, subtotal_sin_iva, iva)
select v.organizacion_id, v.id, 1,
       case v.organizacion_id when '11111111-1111-1111-1111-111111111111'::uuid
            then 'b1000000-0000-0000-0000-000000000001'::uuid else 'b2000000-0000-0000-0000-000000000001'::uuid end,
       'Línea', 'COD', 1, v.total_sin_iva, 'x1',
       case v.organizacion_id when '11111111-1111-1111-1111-111111111111'::uuid
            then 'd1000000-0000-0000-0000-000000000001'::uuid else 'd2000000-0000-0000-0000-000000000001'::uuid end,
       v.total_sin_iva, v.total_con_iva - v.total_sin_iva
  from dominio.comprobantes_venta v
 where v.organizacion_id in ('11111111-1111-1111-1111-111111111111', '22222222-2222-2222-2222-222222222222');

create function pg_temp.como(p_user uuid) returns void language plpgsql as $$
begin
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
  set local role authenticated;
end $$;

-- ============================================================================
-- Vista: cada fila pertenece a una sola organización y empresa (lo que filtra el token)
-- ============================================================================

select is(
  (select count(*)::int from analitica.ventas_periodo_canal
    where organizacion_id = '11111111-1111-1111-1111-111111111111'
      and empresa_id = 'e2000000-0000-0000-0000-00000000000d'),
  0, 'ninguna fila de la organización Uno trae una empresa de la Dos'
);
select is(
  (select count(*)::int from analitica.ventas_periodo_canal
    where organizacion_id = '11111111-1111-1111-1111-111111111111'),
  3, 'acotada a la organización Uno (cláusula rls): sus 3 filas empresa × fecha, sin las de la Dos'
);
select is(
  (select sum(facturado) from analitica.ventas_periodo_canal
    where organizacion_id = '11111111-1111-1111-1111-111111111111'
      and empresa_id = 'e1000000-0000-0000-0000-00000000000a'),
  1210.00::numeric, 'acotada además a Tienda A (empresa accesible): solo su facturado, no el de Tienda B'
);
select is(
  (select count(*)::int from analitica.ventas_periodo_canal v
    where not exists (select 1 from dominio.empresas e
                       where e.id = v.empresa_id and e.organizacion_id = v.organizacion_id
                         and e.nombre = v.empresa_nombre)),
  0, 'organizacion_id, empresa_id y empresa_nombre son coherentes en toda fila'
);

-- ============================================================================
-- Sin acceso para quien no es Superset, con o sin la sección `reportes`
-- ============================================================================

select pg_temp.como('c1000000-0000-0000-0000-000000000001');
select throws_ok(
  $$select * from analitica.ventas_periodo_canal$$,
  '42501', null, 'administrador (con la sección reportes) no lee la vista directamente'
);
reset role;

select pg_temp.como('c1000000-0000-0000-0000-000000000003');
select throws_ok(
  $$select * from analitica.ventas_periodo_canal$$,
  '42501', null, 'administración no lee la vista directamente'
);
reset role;

select pg_temp.como('c1000000-0000-0000-0000-000000000002');
select throws_ok(
  $$select * from analitica.ventas_periodo_canal$$,
  '42501', null, 'consulta (sin la sección reportes) no lee la vista'
);
reset role;

select ok(
  not has_table_privilege('anon', 'analitica.ventas_periodo_canal', 'select'),
  'anon no lee la vista'
);

-- ============================================================================
-- Conteo del estado vacío: misma frontera, y sin `reportes` no hay acceso
-- ============================================================================

select pg_temp.como('c1000000-0000-0000-0000-000000000001');
select is(
  public.ventas_reportes_conteo(current_date - 10, current_date), 3,
  'administrador de Uno: cuenta los 3 comprobantes de su organización, ninguno de la Dos'
);
reset role;

select pg_temp.como('c1000000-0000-0000-0000-000000000003');
select is(
  public.ventas_reportes_conteo(current_date - 10, current_date), 1,
  'administración con solo Tienda A: cuenta únicamente la empresa accesible'
);
reset role;

select pg_temp.como('c1000000-0000-0000-0000-000000000002');
select throws_ok(
  $$select public.ventas_reportes_conteo(current_date - 10, current_date)$$,
  '42501', null, 'un rol sin la sección reportes (consulta) no accede al conteo'
);
reset role;

select * from finish();
rollback;
