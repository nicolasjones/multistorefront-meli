-- Lote 93 (MSF-973, MSF-974, MSF-976): listas de precios — asignación masiva, lista por tipo de cliente y lista en la exportación de clientes.
-- Cubre: masiva por selección y por filtro (asignados, sin cambios, omitidos), idempotencia, un solo evento por llamada, permisos (42501),
-- bandera apagada (55000 salvo quitar), PT404, lista archivada (22023), tope (54000); lista por tipo (precedencia con la propia, bandera,
-- Consumidor final, lista archivada, archivar con clientes heredados, vista, RLS); `listas_de_clientes_para_exportar` (propia, por tipo, permiso).
begin;

select plan(73);

insert into organizaciones (id, nombre) values
  ('11111111-1111-1111-1111-111111111111', 'Organización Uno'),
  ('22222222-2222-2222-2222-222222222222', 'Organización Dos');
insert into auth.users (id, email) values
  ('d1000000-0000-0000-0000-000000000001', 'admin-uno@example.com'),
  ('d1000000-0000-0000-0000-000000000002', 'operador-uno@example.com'),
  ('d1000000-0000-0000-0000-000000000003', 'deposito-uno@example.com'),
  ('d2000000-0000-0000-0000-000000000001', 'admin-dos@example.com');
insert into usuarios_organizacion (user_id, organizacion_id, rol_id, estado) values
  ('d1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'administrador', 'activo'),
  ('d1000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'operador', 'activo'),
  ('d1000000-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111', 'deposito', 'activo'),
  ('d2000000-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', 'administrador', 'activo');
update public.banderas_plataforma set activa = true where clave = 'listas_precios';

insert into dominio.listas_precios (id, organizacion_id, nombre, ajuste_pct) values
  ('a1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'Revendedores', -20),
  ('a1000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'Gremio', -10),
  ('a1000000-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111', 'Vieja', -5),
  ('a1000000-0000-0000-0000-000000000004', '11111111-1111-1111-1111-111111111111', 'Solo tipo', -5),
  ('a2000000-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', 'Ajena', -30);
update dominio.listas_precios set archivada_en = now() where id = 'a1000000-0000-0000-0000-000000000003';

insert into dominio.clientes (id, organizacion_id, numero, nombre, tipo) values
  ('c1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 101, 'Minorista A', 'minorista'),
  ('c1000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 102, 'Minorista B', 'minorista'),
  ('c1000000-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111', 103, 'Archivado', 'minorista'),
  ('c1000000-0000-0000-0000-000000000004', '11111111-1111-1111-1111-111111111111', 104, 'Mayorista A', 'mayorista'),
  ('c1000000-0000-0000-0000-000000000005', '11111111-1111-1111-1111-111111111111', 105, 'Mayorista B', 'mayorista'),
  ('c2000000-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', 201, 'Cliente ajeno', 'minorista');
update dominio.clientes set archivado_en = now() where id = 'c1000000-0000-0000-0000-000000000003';

create function pg_temp.como(p_user uuid) returns void language plpgsql as $$
begin
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
  set local role authenticated;
end $$;
create function pg_temp.final_uno() returns uuid language sql as $$
  select id from dominio.clientes where organizacion_id = '11111111-1111-1111-1111-111111111111' and es_consumidor_final
$$;
create function pg_temp.lista_de(p_cliente uuid) returns text language sql security definer as $$
  select lista_precio_id::text from dominio.clientes where id = p_cliente
$$;
-- Lista que rige para el motor (propia o de su tipo): la función privada del motor.
create function pg_temp.rige(p_cliente uuid) returns text language sql security definer as $$
  select coalesce((select lista_id::text from private.lista_precios_cliente(p_cliente, '11111111-1111-1111-1111-111111111111')), 'ninguna')
$$;
create function pg_temp.eventos(p_tipo text) returns int language sql security definer as $$
  select count(*)::int from public.registro_actividad where tipo = p_tipo
$$;
create function pg_temp.bandera(p_activa boolean) returns void language sql security definer as $$
  update public.banderas_plataforma set activa = p_activa where clave = 'listas_precios'
$$;
create function pg_temp.borrar_masivo() returns void language sql security definer as $$
  delete from dominio.clientes where numero = 1001 and nombre = 'Masivo 1'
$$;
create function pg_temp.eliminar_cliente(p_id uuid) returns int language sql security definer as $$
  with d as (delete from dominio.clientes where id = p_id returning 1) select count(*)::int from d
$$;
grant execute on all functions in schema pg_temp to authenticated;

-- ============================================================================
-- MSF-973 · Asignación masiva
-- ============================================================================
select pg_temp.como('d1000000-0000-0000-0000-000000000001');

select results_eq(
  format($f$select asignados, sin_cambios, omitidos from public.asignar_lista_precios_masiva(
    'a1000000-0000-0000-0000-000000000001', array[
      'c1000000-0000-0000-0000-000000000001', 'c1000000-0000-0000-0000-000000000001', 'c1000000-0000-0000-0000-000000000002',
      'c1000000-0000-0000-0000-000000000003', %L, 'c2000000-0000-0000-0000-000000000001', 'ffffffff-ffff-ffff-ffff-ffffffffffff']::uuid[])$f$,
    pg_temp.final_uno()),
  $$values (2, 0, 4)$$,
  'selección: 2 asignados; omite el archivado, el Consumidor final, el de otra organización y el inexistente (el repetido cuenta una vez)');
select is(pg_temp.lista_de('c1000000-0000-0000-0000-000000000001'), 'a1000000-0000-0000-0000-000000000001', 'el cliente A quedó con la lista');
select is(pg_temp.lista_de('c1000000-0000-0000-0000-000000000003'), null, 'el archivado no la recibió');
select is(pg_temp.lista_de('c2000000-0000-0000-0000-000000000001'), null, 'el cliente de otra organización no la recibió');
select is(pg_temp.eventos('cliente.lista_precio_asignada_masiva'), 1, 'un solo evento de Actividad por llamada');
select is(
  (select detalle from public.registro_actividad where tipo = 'cliente.lista_precio_asignada_masiva'),
  'Asignó la lista de precios «Revendedores» a 2 clientes', 'el evento dice la lista y la cantidad');

select results_eq(
  $$select asignados, sin_cambios, omitidos from public.asignar_lista_precios_masiva(
    'a1000000-0000-0000-0000-000000000001', array['c1000000-0000-0000-0000-000000000001', 'c1000000-0000-0000-0000-000000000002']::uuid[])$$,
  $$values (0, 2, 0)$$, 'repetir es idempotente: 0 asignados, 2 sin cambios');
select is(pg_temp.eventos('cliente.lista_precio_asignada_masiva'), 1, 'y no repite el evento');

-- Por filtro: solo mayoristas activos
select results_eq(
  $$select asignados, sin_cambios, omitidos from public.asignar_lista_precios_masiva(
    'a1000000-0000-0000-0000-000000000002', null, null, 'mayorista')$$,
  $$values (2, 0, 0)$$, 'filtro por tipo mayorista: 2 asignados');
select is(pg_temp.lista_de('c1000000-0000-0000-0000-000000000004'), 'a1000000-0000-0000-0000-000000000002', 'el mayorista quedó con Gremio');
select is(pg_temp.lista_de('c1000000-0000-0000-0000-000000000002'), 'a1000000-0000-0000-0000-000000000001', 'el minorista conserva la suya');
select results_eq(
  $$select asignados, sin_cambios, omitidos from public.asignar_lista_precios_masiva('a1000000-0000-0000-0000-000000000002', null, 'Mayorista B')$$,
  $$values (0, 1, 0)$$, 'filtro por texto: encuentra uno y no cambia nada');
select results_eq(
  $$select asignados, sin_cambios, omitidos from public.asignar_lista_precios_masiva('a1000000-0000-0000-0000-000000000001', null, 'Mayorista B')$$,
  $$values (1, 0, 0)$$, 'filtro por texto: cambia la lista de uno solo');

-- Quitar
select results_eq(
  $$select asignados, sin_cambios, omitidos from public.asignar_lista_precios_masiva(null, array['c1000000-0000-0000-0000-000000000001', 'c1000000-0000-0000-0000-000000000005']::uuid[])$$,
  $$values (2, 0, 0)$$, 'quitar la lista a dos clientes');
select is(pg_temp.lista_de('c1000000-0000-0000-0000-000000000001'), null, 'quedó sin lista');
select is(
  (select count(*)::int from public.registro_actividad where tipo = 'cliente.lista_precio_asignada_masiva' and detalle = 'Quitó la lista de precios a 2 clientes'),
  1, 'el evento de quitar');

-- Errores
select throws_ok($$select * from public.asignar_lista_precios_masiva('a2000000-0000-0000-0000-000000000001', array['c1000000-0000-0000-0000-000000000001']::uuid[])$$,
  'PT404', 'La lista de precios no existe', 'lista de otra organización');
select throws_ok($$select * from public.asignar_lista_precios_masiva('a1000000-0000-0000-0000-000000000003', array['c1000000-0000-0000-0000-000000000001']::uuid[])$$,
  '22023', 'La lista de precios está archivada', 'lista archivada');
select throws_ok($$select * from public.asignar_lista_precios_masiva('a1000000-0000-0000-0000-000000000001', null, null, 'otro')$$,
  '22023', 'El tipo de cliente tiene que ser minorista o mayorista', 'tipo inválido');
select throws_ok(
  $$select * from public.asignar_lista_precios_masiva('a1000000-0000-0000-0000-000000000001', (select array_agg(gen_random_uuid()) from generate_series(1, 5001)))$$,
  '54000', 'Se pueden asignar hasta 5000 clientes por vez: afiná la selección', 'más de 5000 en la selección');
select lives_ok(
  $$select * from public.asignar_lista_precios_masiva('a1000000-0000-0000-0000-000000000001', (select array_agg(gen_random_uuid()) from generate_series(1, 5000)))$$,
  'exactamente 5000 pasa (frontera del tope)');

-- Bandera apagada: asignar 55000, quitar sigue
select pg_temp.bandera(false);
select throws_ok($$select * from public.asignar_lista_precios_masiva('a1000000-0000-0000-0000-000000000001', array['c1000000-0000-0000-0000-000000000001']::uuid[])$$,
  '55000', 'Las listas de precios están desactivadas en este entorno', 'bandera apagada: asignar responde 55000');
select lives_ok($$select * from public.asignar_lista_precios_masiva(null, array['c1000000-0000-0000-0000-000000000002']::uuid[])$$, 'bandera apagada: quitar sigue permitido');
select pg_temp.bandera(true);

-- Permisos
select pg_temp.como('d1000000-0000-0000-0000-000000000002');
select throws_ok($$select * from public.asignar_lista_precios_masiva('a1000000-0000-0000-0000-000000000001', array['c1000000-0000-0000-0000-000000000001']::uuid[])$$,
  '42501', 'Solo un administrador puede asignar una lista de precios', 'un Operador no asigna en masa');

-- ============================================================================
-- MSF-976 · Lista por tipo de cliente
-- ============================================================================
select pg_temp.como('d1000000-0000-0000-0000-000000000001');

select is(pg_temp.rige('c1000000-0000-0000-0000-000000000001'), 'ninguna', 'sin lista propia ni de tipo: no rige ninguna');
select lives_ok($$select public.asignar_lista_precios_tipo_cliente('minorista', 'a1000000-0000-0000-0000-000000000002')$$, 'asigna Gremio al tipo minorista');
select is(pg_temp.rige('c1000000-0000-0000-0000-000000000001'), 'a1000000-0000-0000-0000-000000000002', 'un minorista sin lista propia hereda la del tipo');
select is(pg_temp.rige('c1000000-0000-0000-0000-000000000004'), 'a1000000-0000-0000-0000-000000000002', 'el mayorista con lista propia (Gremio) la conserva: el tipo minorista no lo toca');
select is(pg_temp.rige('c1000000-0000-0000-0000-000000000005'), 'ninguna', 'el otro mayorista no tiene lista ni la hereda del tipo minorista');
select lives_ok($$select * from public.asignar_lista_precios_masiva('a1000000-0000-0000-0000-000000000001', array['c1000000-0000-0000-0000-000000000002']::uuid[])$$, 'B recibe una lista propia');
select is(pg_temp.rige('c1000000-0000-0000-0000-000000000002'), 'a1000000-0000-0000-0000-000000000001', 'la lista propia gana a la del tipo');
select is(pg_temp.rige(pg_temp.final_uno()), 'ninguna', 'el Consumidor final nunca tiene lista, ni por tipo');
select is((select count(*)::int from public.listas_precios_tipo_cliente_resumen where tipo = 'minorista' and lista_nombre = 'Gremio'), 1, 'la vista resume la asignación');
select is(pg_temp.eventos('lista_precios.tipo_asignada'), 1, 'asignar por tipo deja un evento');
select lives_ok($$select public.asignar_lista_precios_tipo_cliente('minorista', 'a1000000-0000-0000-0000-000000000002')$$, 'repetir la misma asignación no falla');
select is(pg_temp.eventos('lista_precios.tipo_asignada'), 1, 'y no repite el evento');

-- Archivar una lista que un tipo usa: se cuentan los clientes que la heredan
select throws_ok(
  format($f$select public.archivar_lista_precios('a1000000-0000-0000-0000-000000000002', %L)$f$,
         (select updated_at from dominio.listas_precios where id = 'a1000000-0000-0000-0000-000000000002')),
  '23503', 'No se puede archivar: 3 clientes usan esta lista. Reasignalos o quitales la lista primero.',
  'archivar Gremio: 1 la tiene propia (mayorista A) y 2 la heredan del tipo minorista (A y el archivado; B tiene propia)');

-- Bandera apagada: el motor ignora la lista del tipo
select pg_temp.bandera(false);
select is(pg_temp.rige('c1000000-0000-0000-0000-000000000001'), 'ninguna', 'con la bandera apagada la lista del tipo no rige');
select throws_ok($$select public.asignar_lista_precios_tipo_cliente('mayorista', 'a1000000-0000-0000-0000-000000000001')$$, '55000', 'Las listas de precios están desactivadas en este entorno', 'bandera apagada: asignar por tipo responde 55000');
select pg_temp.bandera(true);

select throws_ok($$select public.asignar_lista_precios_tipo_cliente('otro', 'a1000000-0000-0000-0000-000000000001')$$, '22023', 'El tipo de cliente tiene que ser minorista o mayorista', 'tipo inválido');
select throws_ok($$select public.asignar_lista_precios_tipo_cliente('mayorista', 'a1000000-0000-0000-0000-000000000003')$$, '22023', 'La lista de precios está archivada', 'lista archivada');
select throws_ok($$select public.asignar_lista_precios_tipo_cliente('mayorista', 'a2000000-0000-0000-0000-000000000001')$$, 'PT404', 'La lista de precios no existe', 'lista de otra organización');

-- Exportación: propia o por tipo
select is(
  (select string_agg(cliente_id::text || '=' || lista_nombre || '/' || origen, ',' order by cliente_id)
     from public.listas_de_clientes_para_exportar(array[
       'c1000000-0000-0000-0000-000000000001', 'c1000000-0000-0000-0000-000000000002', 'c1000000-0000-0000-0000-000000000004',
       'c2000000-0000-0000-0000-000000000001']::uuid[])),
  'c1000000-0000-0000-0000-000000000001=Gremio/tipo,c1000000-0000-0000-0000-000000000002=Revendedores/cliente,c1000000-0000-0000-0000-000000000004=Gremio/cliente'::text,
  'la exportación trae la lista propia, la del tipo y nada de otra organización');
select throws_ok(
  $$select * from public.listas_de_clientes_para_exportar((select array_agg(gen_random_uuid()) from generate_series(1, 1001)))$$,
  '54000', 'Se pueden consultar hasta 1000 clientes por vez', 'más de 1000 ids');
select lives_ok(
  $$select * from public.listas_de_clientes_para_exportar((select array_agg(gen_random_uuid()) from generate_series(1, 1000)))$$,
  'exactamente 1000 pasa (frontera del tope)');

-- Quitar la del tipo
select lives_ok($$select public.asignar_lista_precios_tipo_cliente('minorista', null)$$, 'quita la lista del tipo');
select is(pg_temp.rige('c1000000-0000-0000-0000-000000000001'), 'ninguna', 'sin lista del tipo, vuelve a no regir ninguna');
select is((select count(*)::int from public.listas_precios_tipo_cliente_resumen), 0, 'la vista queda vacía');

-- Permisos y aislamiento
-- ============================================================================
-- Selección y filtros excluyentes, tope por filtro y archivar una lista de un tipo sin clientes
-- ============================================================================
select pg_temp.como('d1000000-0000-0000-0000-000000000001');
select throws_ok(
  format($f$select * from public.asignar_lista_precios_masiva('a1000000-0000-0000-0000-000000000001', array['c1000000-0000-0000-0000-000000000001']::uuid[], %s)$f$, v.resto),
  '22023', 'Elegí clientes marcados o filtros, no las dos cosas', 'selección con filtro ' || v.etiqueta || ': se rechaza')
from (values
  ('texto', $$'norte'$$),
  ('tipo', $$null, 'mayorista'$$),
  ('tienda', $$null, null, 'e1000000-0000-0000-0000-000000000001'::uuid$$),
  ('cuenta web', $$null, null, null, true$$)
) as v(etiqueta, resto);
select lives_ok(
  $$select * from public.asignar_lista_precios_masiva('a1000000-0000-0000-0000-000000000001', array['c1000000-0000-0000-0000-000000000001']::uuid[], '  ', null, null, false)$$,
  'filtros vacíos (texto en blanco, falso) no cuentan como filtros');

reset role;
insert into dominio.clientes (organizacion_id, numero, nombre, tipo)
select '11111111-1111-1111-1111-111111111111', 1000 + g, 'Masivo ' || g, 'minorista' from generate_series(1, 5001) g;
select pg_temp.como('d1000000-0000-0000-0000-000000000001');
select throws_ok(
  $$select * from public.asignar_lista_precios_masiva('a1000000-0000-0000-0000-000000000001', null, 'Masivo')$$,
  '54000', 'Son más de 5000 clientes: afiná el filtro', 'por filtro, 5001 clientes superan el tope');
select pg_temp.borrar_masivo();
select results_eq(
  $$select asignados, sin_cambios, omitidos from public.asignar_lista_precios_masiva('a1000000-0000-0000-0000-000000000001', null, 'Masivo')$$,
  $$values (5000, 0, 0)$$, 'por filtro, exactamente 5000 pasa (frontera del tope)');
select is((select count(*)::int from public.registro_actividad
            where tipo = 'cliente.lista_precio_asignada_masiva' and detalle = 'Asignó la lista de precios «Revendedores» a 5000 clientes'),
          1, 'y deja un solo evento de Actividad');

-- Una lista asignada a un tipo sin clientes de ese tipo se puede archivar: el motor la ignora y restaurarla la reactiva.
select lives_ok($$select * from public.asignar_lista_precios_masiva('a1000000-0000-0000-0000-000000000001', array['c1000000-0000-0000-0000-000000000005']::uuid[])$$,
  'el último mayorista sin lista recibe una propia (no queda ninguno que herede)');
select lives_ok($$select public.asignar_lista_precios_tipo_cliente('mayorista', 'a1000000-0000-0000-0000-000000000004')$$, 'asigna «Solo tipo» al tipo mayorista');
reset role;
insert into dominio.clientes (id, organizacion_id, numero, nombre, tipo) values ('c1000000-0000-0000-0000-000000000009', '11111111-1111-1111-1111-111111111111', 9999, 'Mayorista nuevo', 'mayorista');
select is(pg_temp.rige('c1000000-0000-0000-0000-000000000009'), 'a1000000-0000-0000-0000-000000000004', 'un mayorista nuevo sin lista propia la hereda');
select is(pg_temp.eliminar_cliente('c1000000-0000-0000-0000-000000000009'), 1, 'se retira el mayorista nuevo (el tipo queda sin clientes que hereden)');
select pg_temp.como('d1000000-0000-0000-0000-000000000001');
select lives_ok(
  $$select public.archivar_lista_precios('a1000000-0000-0000-0000-000000000004', (select updated_at from dominio.listas_precios where id = 'a1000000-0000-0000-0000-000000000004'))$$,
  'archivar una lista de un tipo sin clientes que la hereden está permitido');
select is((select (archivada_en is not null)::text from public.listas_precios_tipo_cliente_resumen where tipo = 'mayorista'), 'true',
  'la asignación del tipo se ve como archivada');
reset role;
insert into dominio.clientes (id, organizacion_id, numero, nombre, tipo) values ('c1000000-0000-0000-0000-00000000000a', '11111111-1111-1111-1111-111111111111', 9998, 'Mayorista nuevo 2', 'mayorista');
select is(pg_temp.rige('c1000000-0000-0000-0000-00000000000a'), 'ninguna', 'archivada, el motor la ignora');
select pg_temp.como('d1000000-0000-0000-0000-000000000001');
select lives_ok(
  $$select public.restaurar_lista_precios('a1000000-0000-0000-0000-000000000004', (select updated_at from dominio.listas_precios where id = 'a1000000-0000-0000-0000-000000000004'))$$,
  'restaurar la lista');
select is(pg_temp.rige('c1000000-0000-0000-0000-00000000000a'), 'a1000000-0000-0000-0000-000000000004', 'restaurada, la asignación del tipo vuelve a regir');

select pg_temp.como('d1000000-0000-0000-0000-000000000002');
select throws_ok($$select public.asignar_lista_precios_tipo_cliente('minorista', 'a1000000-0000-0000-0000-000000000001')$$, '42501', 'Solo un administrador puede asignar una lista de precios', 'un Operador no asigna por tipo');
select pg_temp.como('d1000000-0000-0000-0000-000000000003');
select throws_ok($$select * from public.listas_de_clientes_para_exportar(array['c1000000-0000-0000-0000-000000000001']::uuid[])$$,
  '42501', 'No tenés permiso para exportar clientes', 'sin la acción exportar de Clientes no hay lista de clientes');

select pg_temp.como('d1000000-0000-0000-0000-000000000001');
select lives_ok($$select public.asignar_lista_precios_tipo_cliente('mayorista', 'a1000000-0000-0000-0000-000000000001')$$, 'deja una asignación para probar RLS');
select pg_temp.como('d2000000-0000-0000-0000-000000000001');
select is((select count(*)::int from dominio.listas_precios_tipo_cliente), 0, 'otra organización no ve la asignación por RLS');
select is((select count(*)::int from public.listas_precios_tipo_cliente_resumen), 0, 'ni por la vista');

reset role;
select set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);
set local role anon;
select throws_ok($$select * from public.asignar_lista_precios_masiva(null, array[]::uuid[])$$, '42501', null, 'anon no ejecuta la asignación masiva');
select throws_ok($$select public.asignar_lista_precios_tipo_cliente('minorista', null)$$, '42501', null, 'anon no ejecuta la asignación por tipo');
select throws_ok($$select * from public.listas_de_clientes_para_exportar(array[]::uuid[])$$, '42501', null, 'anon no ejecuta la lista para exportar');

select * from finish();
rollback;
