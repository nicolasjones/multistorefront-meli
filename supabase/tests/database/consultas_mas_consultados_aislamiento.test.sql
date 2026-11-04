-- F-REP-04 (MSF-236, épica MSF-192, SC-008): aislamiento de `analitica.consultas_producto_mas_consultado`
-- y de `public.consultas_reportes_conteo` entre organizaciones y empresas, y sin acceso sin la sección
-- `reportes`.
--
-- La vista la lee Superset y el guest token fuerza `organizacion_id` + `empresa_id`: acá se verifica que
-- cada fila trae esas dos columnas bien puestas y que el conteo de la app respeta la misma frontera.
-- Fechas relativas al reloj de la base.
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

-- `administracion` solo tiene Tienda A: no ve las consultas de Tienda B.
insert into public.usuarios_empresas (user_id, empresa_id, organizacion_id, rol_id) values
  ('c1000000-0000-0000-0000-000000000003', 'e1000000-0000-0000-0000-00000000000a', '11111111-1111-1111-1111-111111111111', 'administracion');

insert into dominio.productos (id, organizacion_id, nombre, sku, moneda, precio_lista) values
  ('a1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'Alfa', 'PC-1', 'ARS', 100),
  ('b2000000-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', 'Alfa de la Dos', 'PD-1', 'ARS', 100);

insert into dominio.intereses_whatsapp (organizacion_id, empresa_id, producto_id, created_at) values
  ('11111111-1111-1111-1111-111111111111', 'e1000000-0000-0000-0000-00000000000a', 'a1000000-0000-0000-0000-000000000001', now() - interval '1 day'),
  ('11111111-1111-1111-1111-111111111111', 'e1000000-0000-0000-0000-00000000000b', 'a1000000-0000-0000-0000-000000000001', now() - interval '1 day'),
  ('11111111-1111-1111-1111-111111111111', 'e1000000-0000-0000-0000-00000000000b', 'a1000000-0000-0000-0000-000000000001', now() - interval '2 days'),
  ('22222222-2222-2222-2222-222222222222', 'e2000000-0000-0000-0000-00000000000d', 'b2000000-0000-0000-0000-000000000001', now() - interval '1 day');

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
  (select count(*)::int from analitica.consultas_producto_mas_consultado
    where organizacion_id = '11111111-1111-1111-1111-111111111111'
      and empresa_id in ('e2000000-0000-0000-0000-00000000000d')),
  0, 'ninguna fila de la organización Uno trae una empresa de la Dos'
);
select is(
  (select count(*)::int from analitica.consultas_producto_mas_consultado
    where organizacion_id = '11111111-1111-1111-1111-111111111111'),
  3, 'acotada a la organización Uno (cláusula rls): sus 3 filas empresa × producto × fecha, sin las de la Dos'
);
select is(
  (select sum(consultas)::int from analitica.consultas_producto_mas_consultado
    where organizacion_id = '11111111-1111-1111-1111-111111111111'
      and empresa_id = 'e1000000-0000-0000-0000-00000000000a'),
  1, 'acotada además a Tienda A (empresa accesible): solo sus consultas, no las de Tienda B'
);
select is(
  (select count(*)::int from analitica.consultas_producto_mas_consultado v
    where not exists (select 1 from dominio.empresas e
                       where e.id = v.empresa_id and e.organizacion_id = v.organizacion_id
                         and e.nombre = v.empresa_nombre)),
  0, 'organizacion_id, empresa_id y empresa_nombre son coherentes en toda fila'
);

-- ============================================================================
-- RPC de conteo: frontera de organización y de empresa; sin `reportes` no hay acceso
-- ============================================================================

select pg_temp.como('c1000000-0000-0000-0000-000000000001');
select is(
  public.consultas_reportes_conteo(current_date - 10, current_date), 3,
  'administrador de Uno: cuenta las 3 de su organización, ninguna de la Dos'
);
reset role;

select pg_temp.como('c2000000-0000-0000-0000-000000000001');
select is(
  public.consultas_reportes_conteo(current_date - 10, current_date), 1,
  'administrador de Dos: cuenta solo la suya'
);
select is(
  public.consultas_reportes_conteo(current_date - 10, current_date, 'e1000000-0000-0000-0000-00000000000a'), 0,
  'una empresa de otra organización nunca amplía el alcance: cuenta 0'
);
reset role;

select pg_temp.como('c1000000-0000-0000-0000-000000000003');
select is(
  public.consultas_reportes_conteo(current_date - 10, current_date), 1,
  'administración con solo Tienda A: cuenta únicamente las de esa empresa accesible'
);
select is(
  public.consultas_reportes_conteo(current_date - 10, current_date, 'e1000000-0000-0000-0000-00000000000b'), 0,
  'pedir una empresa no accesible no la revela: cuenta 0'
);
reset role;

select pg_temp.como('c1000000-0000-0000-0000-000000000002');
select throws_ok(
  $$select public.consultas_reportes_conteo(current_date - 10, current_date)$$,
  '42501', null, 'un rol sin la sección reportes (consulta) no accede al conteo'
);
reset role;

select throws_ok(
  $$select public.consultas_reportes_conteo(current_date - 10, current_date)$$,
  '42501', null, 'sin sesión (sin organización) no hay conteo'
);

select * from finish();
rollback;
