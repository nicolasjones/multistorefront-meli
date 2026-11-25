-- MSF-527 (número correlativo de proveedor) y MSF-526 (exportación del listado).
-- Cubre: numeración por organización sin repetidos, que el llamador no pueda fijarlo ni cambiarlo,
-- unicidad, el número en `listar_proveedores`, y `exportar_proveedores`: permiso, aislamiento por
-- organización, filtros (texto, estado, tienda), keyset, cursor ajeno, actividad y `anon` sin ejecución.
-- CUIT válidos: 20123456786, 30701234568, 33555555550, 30700000040.
begin;

select plan(25);

insert into organizaciones (id, nombre) values
  ('11111111-1111-1111-1111-111111111111', 'Organización Uno'),
  ('22222222-2222-2222-2222-222222222222', 'Organización Dos');

insert into auth.users (id, email) values
  ('d1000000-0000-0000-0000-000000000021', 'admin-uno@example.com'),
  ('d1000000-0000-0000-0000-000000000022', 'consulta-uno@example.com'),
  ('d2000000-0000-0000-0000-000000000021', 'admin-dos@example.com');

insert into usuarios_organizacion (user_id, organizacion_id, rol_id) values
  ('d1000000-0000-0000-0000-000000000021', '11111111-1111-1111-1111-111111111111', 'administrador'),
  ('d1000000-0000-0000-0000-000000000022', '11111111-1111-1111-1111-111111111111', 'consulta'),
  ('d2000000-0000-0000-0000-000000000021', '22222222-2222-2222-2222-222222222222', 'administrador');

insert into dominio.empresas (id, organizacion_id, nombre) values
  ('a1000000-0000-0000-0000-0000000000a1', '11111111-1111-1111-1111-111111111111', 'San Javucho'),
  ('a1000000-0000-0000-0000-0000000000a2', '11111111-1111-1111-1111-111111111111', 'Mundo JC'),
  ('a2000000-0000-0000-0000-0000000000a1', '22222222-2222-2222-2222-222222222222', 'Empresa Dos');

-- Altas sin número (como importación o migración de datos): lo asigna el disparador.
insert into dominio.proveedores (id, organizacion_id, razon_social, cuit, correo, activo) values
  ('b1000000-0000-0000-0000-0000000000b1', '11111111-1111-1111-1111-111111111111', 'Beta SA', '20123456786', 'beta@example.com', true),
  ('b1000000-0000-0000-0000-0000000000b2', '11111111-1111-1111-1111-111111111111', 'Álamos SRL', '30701234568', null, true),
  ('b1000000-0000-0000-0000-0000000000b3', '11111111-1111-1111-1111-111111111111', 'Zeta Inactiva', '33555555550', null, false),
  ('b2000000-0000-0000-0000-0000000000b1', '22222222-2222-2222-2222-222222222222', 'Proveedor De La Dos', '20123456786', null, true);

insert into dominio.proveedores_empresas (proveedor_id, empresa_id, organizacion_id) values
  ('b1000000-0000-0000-0000-0000000000b1', 'a1000000-0000-0000-0000-0000000000a1', '11111111-1111-1111-1111-111111111111'),
  ('b1000000-0000-0000-0000-0000000000b1', 'a1000000-0000-0000-0000-0000000000a2', '11111111-1111-1111-1111-111111111111');

create function pg_temp.como(p_user uuid) returns void language plpgsql as $$
begin
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
  set local role authenticated;
end $$;

-- ============================================================================
-- Número correlativo
-- ============================================================================

select results_eq(
  $$select numero from dominio.proveedores where organizacion_id = '11111111-1111-1111-1111-111111111111' order by numero$$,
  $$values (1), (2), (3)$$,
  'la organización Uno recibe 1, 2, 3 sin repetidos'
);
select is(
  (select numero from dominio.proveedores where id = 'b2000000-0000-0000-0000-0000000000b1'), 1,
  'la numeración de cada organización arranca en 1 (no se mezcla con otra)'
);
select is(
  (select count(*)::int from pg_indexes where schemaname = 'dominio' and indexname = 'proveedores_org_numero_uq'), 1,
  'existe el índice único (organizacion_id, numero)'
);
select throws_ok(
  $$insert into dominio.proveedores (organizacion_id, numero, razon_social, cuit)
    values ('11111111-1111-1111-1111-111111111111', 1, 'Duplicado', '30700000040')$$,
  '23505', null, 'un número repetido en la misma organización se rechaza'
);

select pg_temp.como('d1000000-0000-0000-0000-000000000021');

select is(
  (select numero from public.listar_proveedores(null, 'todos') where razon_social = 'Álamos SRL'), 2,
  'listar_proveedores devuelve el número'
);
select throws_ok(
  $$update dominio.proveedores set numero = 99 where id = 'b1000000-0000-0000-0000-0000000000b1'$$,
  '42501', null, 'el llamador no puede cambiar el número (sin grant de columna)'
);
select throws_ok(
  $$insert into dominio.proveedores (razon_social, cuit, numero) values ('Con número', '30700000040', 50)$$,
  '42501', null, 'el llamador no puede fijar el número al crear'
);
select is(
  (public.crear_proveedor('Nuevo Proveedor', '30700000040', null, null, null, null, null)).numero, 4,
  'el alta por la RPC toma el siguiente número de la organización'
);

-- ============================================================================
-- exportar_proveedores
-- ============================================================================

select is((select count(*)::int from public.exportar_proveedores()), 3, 'por defecto exporta los activos de la organización (sin la inactiva ni los de otra)');
select results_eq(
  $$select razon_social from public.exportar_proveedores()$$,
  $$values ('Álamos SRL'::text), ('Beta SA'), ('Nuevo Proveedor')$$,
  'ordenado por razón social'
);
select is(
  (select total from public.exportar_proveedores() limit 1), 3::bigint, 'cada fila trae el total de la exportación'
);
select is((select count(*)::int from public.exportar_proveedores(null, 'todos')), 4, 'estado «todos» suma la inactiva');
select results_eq(
  $$select razon_social from public.exportar_proveedores(null, 'inactivos')$$,
  $$values ('Zeta Inactiva'::text)$$, 'estado «inactivos»'
);
select results_eq(
  $$select razon_social from public.exportar_proveedores('alamos')$$,
  $$values ('Álamos SRL'::text)$$, 'la búsqueda ignora tildes y mayúsculas, igual que el listado'
);
select is(
  (select compra_para from public.exportar_proveedores() where razon_social = 'Beta SA'), 'Mundo JC, San Javucho',
  'compra_para lista las tiendas ordenadas por nombre'
);
select is(
  (select count(*)::int from public.exportar_proveedores(null, 'activos', 'a1000000-0000-0000-0000-0000000000a1')), 3,
  'con una tienda: los suyos y los que no tienen «Compra para»'
);
select is(
  (select count(*)::int from public.exportar_proveedores(null, 'activos', 'a2000000-0000-0000-0000-0000000000a1')), 0,
  'una tienda de otra organización no habilita filas'
);
select results_eq(
  $$select razon_social from public.exportar_proveedores(null, 'activos', null,
      (select id from dominio.proveedores where razon_social = 'Álamos SRL'), 1)$$,
  $$values ('Beta SA'::text)$$, 'el cursor keyset sigue después del indicado y respeta el límite'
);
select throws_ok(
  $$select * from public.exportar_proveedores(null, 'activos', null, 'b2000000-0000-0000-0000-0000000000b1')$$,
  '40001', null, 'un cursor de otra organización se rechaza (no trunca en silencio)'
);
select throws_ok($$select * from public.exportar_proveedores(null, 'otro')$$, '22023', null, 'un estado desconocido se rechaza');

reset role;
select ok(
  exists (select 1 from registro_actividad where tipo = 'proveedores.exportados' and detalle = 'Exportó 3 proveedores a Excel'),
  'el primer lote sin filtros deja un evento con el total'
);
select ok(
  exists (select 1 from registro_actividad where tipo = 'proveedores.exportados' and detalle like 'Continuó la exportación de proveedores (1 fila)'),
  'un lote con cursor deja su propia constancia'
);

-- Sin permiso (consulta: lee pero no exporta).
select pg_temp.como('d1000000-0000-0000-0000-000000000022');
select throws_ok($$select * from public.exportar_proveedores()$$, '42501', null, 'sin la acción «exportar» se rechaza');

-- Otra organización: solo ve lo suyo.
select pg_temp.como('d2000000-0000-0000-0000-000000000021');
select results_eq(
  $$select razon_social from public.exportar_proveedores()$$,
  $$values ('Proveedor De La Dos'::text)$$, 'cada organización exporta solo sus proveedores'
);

reset role;
select ok(
  not has_function_privilege('anon', 'public.exportar_proveedores(text,text,uuid,uuid,integer)', 'execute')
  and has_function_privilege('authenticated', 'public.exportar_proveedores(text,text,uuid,uuid,integer)', 'execute'),
  '«anon» no ejecuta exportar_proveedores; «authenticated» sí'
);

select * from finish();
rollback;
