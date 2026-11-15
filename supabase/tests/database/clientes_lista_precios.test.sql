-- F-CLI-21 (MSF-453, spec 20270327-100000-listas-de-precios-por-cliente, Fase 2): asignar una lista de precios a un cliente.
-- Cubre RF-CLI-21-1 y RF-CLI-21-2, CA-CLI-21-1, 7, 8 y 11, el conteo de clientes por lista y archivar con clientes asignados
-- (RF-PRE-14-3), la bandera (55000 salvo quitar), la fusión de clientes y que ningún precio cambia por tener una lista asignada.
begin;

select plan(56);

insert into organizaciones (id, nombre) values
  ('11111111-1111-1111-1111-111111111111', 'Organización Uno'),
  ('22222222-2222-2222-2222-222222222222', 'Organización Dos');
insert into auth.users (id, email) values
  ('d1000000-0000-0000-0000-000000000001', 'admin-uno@example.com'),
  ('d1000000-0000-0000-0000-000000000002', 'operador-uno@example.com'),
  ('d2000000-0000-0000-0000-000000000001', 'admin-dos@example.com');
insert into usuarios_organizacion (user_id, organizacion_id, rol_id, estado) values
  ('d1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'administrador', 'activo'),
  ('d1000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'operador', 'activo'),
  ('d2000000-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', 'administrador', 'activo');
update public.banderas_plataforma set activa = true where clave = 'listas_precios';

insert into dominio.listas_precios (id, organizacion_id, nombre, ajuste_pct) values
  ('a1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'Revendedores', -20),
  ('a1000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'Gremio', -10),
  ('a1000000-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111', 'Vieja', -5),
  ('a2000000-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', 'Ajena', -30);
update dominio.listas_precios set archivada_en = now() where id = 'a1000000-0000-0000-0000-000000000003';

insert into clientes (id, organizacion_id, numero, nombre) values
  ('c1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 101, 'Cliente A'),
  ('c1000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 102, 'Cliente B'),
  ('c1000000-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111', 103, 'Cliente archivado'),
  ('c1000000-0000-0000-0000-000000000004', '11111111-1111-1111-1111-111111111111', 104, 'Cliente absorbido'),
  ('c2000000-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', 201, 'Cliente ajeno');
update clientes set archivado_en = now() where id = 'c1000000-0000-0000-0000-000000000003';

create function pg_temp.como(p_user uuid) returns void language plpgsql as $$
begin
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
  set local role authenticated;
end $$;

create function pg_temp.final_uno() returns uuid language sql as $$
  select id from public.clientes where organizacion_id = '11111111-1111-1111-1111-111111111111' and es_consumidor_final
$$;

-- ============================================================================
-- Estructura y grants (RF-CLI-21-1)
-- ============================================================================

select has_column('public', 'clientes', 'lista_precio_id', 'clientes tiene lista_precio_id');
select col_is_null('public', 'clientes', 'lista_precio_id', 'es nulable (sin lista)');
select is(
  (select count(*)::int from pg_constraint where conname = 'clientes_lista_precio_fk' and contype = 'f'
     and conrelid = 'public.clientes'::regclass and confrelid = 'dominio.listas_precios'::regclass and array_length(conkey, 1) = 2),
  1, 'FK compuesta (lista, organización) a dominio.listas_precios');
select is(has_column_privilege('authenticated', 'public.clientes', 'lista_precio_id', 'update'), false, 'authenticated no actualiza la columna');
select is(has_column_privilege('authenticated', 'public.clientes', 'lista_precio_id', 'insert'), false, 'authenticated no inserta la columna');
select is(has_column_privilege('authenticated', 'public.clientes', 'lista_precio_id', 'select'), true, 'authenticated la lee');
select is(has_column_privilege('anon', 'public.clientes', 'lista_precio_id', 'select'), false, 'anon no la lee');
select is(has_function_privilege('anon', 'public.asignar_lista_precios_cliente(uuid, uuid)', 'execute'), false, 'anon no ejecuta la RPC');
select is(has_function_privilege('authenticated', 'public.asignar_lista_precios_cliente(uuid, uuid)', 'execute'), true, 'authenticated ejecuta la RPC');
select is(
  (select count(*)::int from pg_proc p where p.oid = 'public.asignar_lista_precios_cliente(uuid, uuid)'::regprocedure
      and p.prosecdef and p.proconfig @> array['search_path=""']),
  1, 'la RPC es security definer con search_path vacío');
select is(has_function_privilege('authenticated', 'private.validar_lista_precio_cliente()', 'execute'), false, 'el disparador no se ejecuta desde la API');

-- ============================================================================
-- Asignar, reasignar y quitar (RF-CLI-21-2, CA-CLI-21-1 y 8)
-- ============================================================================

select pg_temp.como('d1000000-0000-0000-0000-000000000001');

select lives_ok(
  $$select public.asignar_lista_precios_cliente('c1000000-0000-0000-0000-000000000001', 'a1000000-0000-0000-0000-000000000001')$$,
  'el administrador asigna una lista');
reset role;
select is((select lista_precio_id from clientes where id = 'c1000000-0000-0000-0000-000000000001'), 'a1000000-0000-0000-0000-000000000001'::uuid, 'el cliente queda con la lista');
select is(
  (select count(*)::int from public.registro_actividad
    where tipo = 'cliente.lista_precio_asignada' and valor_anterior is null and valor_nuevo ->> 'lista' = 'Revendedores' and detalle like '%Cliente A%'),
  1, 'la Actividad registra la asignación con lista nueva y sin anterior');

select pg_temp.como('d1000000-0000-0000-0000-000000000001');
select lives_ok(
  $$select public.asignar_lista_precios_cliente('c1000000-0000-0000-0000-000000000001', 'a1000000-0000-0000-0000-000000000001')$$,
  'asignar la misma lista es idempotente');
reset role;
select is((select count(*)::int from public.registro_actividad where tipo = 'cliente.lista_precio_asignada'), 1, 'y no repite el evento');

select pg_temp.como('d1000000-0000-0000-0000-000000000001');
select lives_ok(
  $$select public.asignar_lista_precios_cliente('c1000000-0000-0000-0000-000000000001', 'a1000000-0000-0000-0000-000000000002')$$,
  'reasignar a otra lista funciona');
reset role;
select is(
  (select count(*)::int from public.registro_actividad
    where tipo = 'cliente.lista_precio_asignada' and valor_anterior ->> 'lista' = 'Revendedores' and valor_nuevo ->> 'lista' = 'Gremio'),
  1, 'la Actividad guarda la lista anterior y la nueva');
select is(
  (select count(*)::int from public.registro_actividad where tipo = 'cliente.lista_precio_asignada' and detalle ~* '(@|dni|cuit|tel)'),
  0, 'sin datos de contacto en la Actividad');

select pg_temp.como('d1000000-0000-0000-0000-000000000001');
select lives_ok(
  $$select public.asignar_lista_precios_cliente('c1000000-0000-0000-0000-000000000002', 'a1000000-0000-0000-0000-000000000002')$$,
  'un segundo cliente comparte la lista');
select is((select clientes_asignados from public.listas_precios_resumen where nombre = 'Gremio'), 2::bigint, 'la vista cuenta 2 clientes en Gremio');
select is((select clientes_asignados from public.listas_precios_resumen where nombre = 'Revendedores'), 0::bigint, 'y 0 en Revendedores');

-- ============================================================================
-- Archivar con clientes asignados (RF-PRE-14-3, CA-PRE-14-4)
-- ============================================================================

select throws_ok(
  format($$select public.archivar_lista_precios('a1000000-0000-0000-0000-000000000002', %L)$$,
         (select updated_at from public.listas_precios_resumen where nombre = 'Gremio')),
  '23503', null, 'no se archiva una lista con clientes asignados');
select is(
  (select archivada_en from public.listas_precios_resumen where nombre = 'Gremio'), null, 'y sigue activa');

select lives_ok(
  $$select public.asignar_lista_precios_cliente('c1000000-0000-0000-0000-000000000001', null)$$,
  'quitar la lista funciona');
select lives_ok(
  $$select public.asignar_lista_precios_cliente('c1000000-0000-0000-0000-000000000001', null)$$,
  'quitar lo que no hay es idempotente');
select lives_ok(
  $$select public.asignar_lista_precios_cliente('c1000000-0000-0000-0000-000000000002', null)$$,
  'se quita también al segundo');
reset role;
select is((select lista_precio_id from clientes where id = 'c1000000-0000-0000-0000-000000000001'), null, 'el cliente vuelve a no tener lista');
select is(
  (select count(*)::int from public.registro_actividad where tipo = 'cliente.lista_precio_asignada' and valor_nuevo is null and detalle like 'Quitó%'),
  2, 'la Actividad registra cada quita (una por cliente)');

select pg_temp.como('d1000000-0000-0000-0000-000000000001');
select lives_ok(
  format($$select public.archivar_lista_precios('a1000000-0000-0000-0000-000000000002', %L)$$,
         (select updated_at from public.listas_precios_resumen where nombre = 'Gremio')),
  'sin clientes asignados ya se archiva');

-- ============================================================================
-- Rechazos (CA-CLI-21-7)
-- ============================================================================

select throws_ok(
  $$select public.asignar_lista_precios_cliente('c1000000-0000-0000-0000-000000000001', 'a1000000-0000-0000-0000-000000000002')$$,
  '22023', null, 'no se asigna una lista archivada');
select throws_ok(
  $$select public.asignar_lista_precios_cliente('c1000000-0000-0000-0000-000000000001', 'a1000000-0000-0000-0000-000000000003')$$,
  '22023', null, 'ni otra lista archivada');
select throws_ok(
  format($$select public.asignar_lista_precios_cliente(%L, 'a1000000-0000-0000-0000-000000000001')$$, pg_temp.final_uno()),
  '22023', null, 'el Consumidor final no admite lista');
select throws_ok(
  $$select public.asignar_lista_precios_cliente('c1000000-0000-0000-0000-000000000003', 'a1000000-0000-0000-0000-000000000001')$$,
  '22023', null, 'un cliente archivado no se asigna');
select throws_ok(
  $$select public.asignar_lista_precios_cliente('c1000000-0000-0000-0000-000000000001', 'a2000000-0000-0000-0000-000000000001')$$,
  'P0002', null, 'una lista de otra organización da P0002');
select throws_ok(
  $$select public.asignar_lista_precios_cliente('c2000000-0000-0000-0000-000000000001', 'a1000000-0000-0000-0000-000000000001')$$,
  'P0002', null, 'un cliente de otra organización da P0002');
select throws_ok(
  $$select public.asignar_lista_precios_cliente('c1000000-0000-0000-0000-000000000001', '99999999-9999-9999-9999-999999999999')$$,
  'P0002', null, 'una lista inexistente da P0002');

-- ============================================================================
-- Permisos (CA-CLI-21-11) y aislamiento
-- ============================================================================

select pg_temp.como('d1000000-0000-0000-0000-000000000002');
select throws_ok(
  $$select public.asignar_lista_precios_cliente('c1000000-0000-0000-0000-000000000001', 'a1000000-0000-0000-0000-000000000001')$$,
  '42501', null, 'un operador no asigna');
select throws_ok(
  $$update clientes set lista_precio_id = 'a1000000-0000-0000-0000-000000000001' where id = 'c1000000-0000-0000-0000-000000000001'$$,
  '42501', null, 'la escritura directa de la columna está negada');

select pg_temp.como('d2000000-0000-0000-0000-000000000001');
select throws_ok(
  $$select public.asignar_lista_precios_cliente('c1000000-0000-0000-0000-000000000001', 'a2000000-0000-0000-0000-000000000001')$$,
  'P0002', null, 'otra organización no asigna sobre clientes ajenos');

reset role;
set local role anon;
select throws_ok(
  $$select public.asignar_lista_precios_cliente('c1000000-0000-0000-0000-000000000001', null)$$,
  '42501', null, 'anon no ejecuta la RPC');
reset role;

-- ============================================================================
-- Disparador defensivo y FK (otras vías de escritura)
-- ============================================================================

select throws_ok(
  $$update clientes set lista_precio_id = 'a1000000-0000-0000-0000-000000000001' where es_consumidor_final and organizacion_id = '11111111-1111-1111-1111-111111111111'$$,
  '22023', null, 'el disparador rechaza el Consumidor final aun fuera de la RPC');
select throws_ok(
  $$update clientes set lista_precio_id = 'a1000000-0000-0000-0000-000000000003' where id = 'c1000000-0000-0000-0000-000000000001'$$,
  '22023', null, 'el disparador rechaza una lista archivada');
select throws_ok(
  $$update clientes set lista_precio_id = 'a2000000-0000-0000-0000-000000000001' where id = 'c1000000-0000-0000-0000-000000000001'$$,
  '23503', null, 'la FK compuesta rechaza una lista de otra organización');

-- ============================================================================
-- Bandera apagada (D13): asignar responde 55000, quitar sigue permitido
-- ============================================================================

select pg_temp.como('d1000000-0000-0000-0000-000000000001');
select lives_ok(
  $$select public.asignar_lista_precios_cliente('c1000000-0000-0000-0000-000000000001', 'a1000000-0000-0000-0000-000000000001')$$,
  'encendida: se asigna');
reset role;
update public.banderas_plataforma set activa = false where clave = 'listas_precios';
select pg_temp.como('d1000000-0000-0000-0000-000000000001');
select throws_ok(
  $$select public.asignar_lista_precios_cliente('c1000000-0000-0000-0000-000000000002', 'a1000000-0000-0000-0000-000000000001')$$,
  '55000', null, 'apagada: asignar responde 55000');
select lives_ok(
  $$select public.asignar_lista_precios_cliente('c1000000-0000-0000-0000-000000000001', null)$$,
  'apagada: quitar sigue permitido');
reset role;
update public.banderas_plataforma set activa = true where clave = 'listas_precios';

-- ============================================================================
-- Fusión de clientes (T012): el conservado mantiene su lista, el absorbido la pierde
-- ============================================================================

update clientes set lista_precio_id = 'a1000000-0000-0000-0000-000000000001' where id in ('c1000000-0000-0000-0000-000000000001', 'c1000000-0000-0000-0000-000000000004');
select pg_temp.como('d1000000-0000-0000-0000-000000000001');
select is(
  (select lista_nombre from public.vista_previa_fusion_clientes('c1000000-0000-0000-0000-000000000001', 'c1000000-0000-0000-0000-000000000004') where cliente_id = 'c1000000-0000-0000-0000-000000000004'),
  'Revendedores', 'la vista previa de la fusión informa la lista de cada cliente');
select lives_ok(
  $$select public.fusionar_clientes('c1000000-0000-0000-0000-000000000001', 'c1000000-0000-0000-0000-000000000004')$$,
  'la fusión funciona');
reset role;
select is((select lista_precio_id from clientes where id = 'c1000000-0000-0000-0000-000000000001'), 'a1000000-0000-0000-0000-000000000001'::uuid, 'el cliente conservado mantiene su lista');
select is((select lista_precio_id from clientes where id = 'c1000000-0000-0000-0000-000000000004'), null, 'el absorbido pierde la suya');
select isnt((select archivado_en from clientes where id = 'c1000000-0000-0000-0000-000000000004'), null, 'y queda archivado');

-- ============================================================================
-- Archivar un cliente conserva su lista (se restaura con ella) y cuenta para la lista
-- ============================================================================

update clientes set archivado_en = now() where id = 'c1000000-0000-0000-0000-000000000001';
select is((select lista_precio_id from clientes where id = 'c1000000-0000-0000-0000-000000000001'), 'a1000000-0000-0000-0000-000000000001'::uuid, 'archivar al cliente no le quita la lista');
select is(private.cantidad_clientes_lista('a1000000-0000-0000-0000-000000000001'), 1::bigint, 'el conteo incluye a los archivados');

-- ============================================================================
-- Sin efecto en precios (CA-CLI-21-6 en esta fase)
-- ============================================================================

insert into dominio.empresas (id, organizacion_id, nombre, activa) values
  ('e1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'Tienda A', true);
insert into dominio.productos (id, organizacion_id, nombre, sku, precio_lista, moneda, activo) values
  ('b1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'Alfa', 'PR-1', 1000, 'ARS', true);
update clientes set archivado_en = null where id = 'c1000000-0000-0000-0000-000000000001';
create temp table t_precio as
  select * from private.precio_linea_venta_calculo('b1000000-0000-0000-0000-000000000001', 'e1000000-0000-0000-0000-000000000001', 'minorista', 1, 0);
update clientes set lista_precio_id = null where id = 'c1000000-0000-0000-0000-000000000001';
select results_eq(
  $$select * from private.precio_linea_venta_calculo('b1000000-0000-0000-0000-000000000001', 'e1000000-0000-0000-0000-000000000001', 'minorista', 1, 0)$$,
  $$select * from t_precio$$,
  'el precio de la línea es idéntico con o sin lista asignada');
select is(
  (select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'private' and p.proname in ('precio_para', 'precio_para_calculo', 'precio_linea_venta', 'precio_linea_venta_calculo')
      and p.prosrc ilike '%lista_precio%'),
  0, 'ninguna función del motor de precio lee lista_precio_id');

select * from finish();
rollback;
