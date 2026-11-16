-- F-PRE-14 (MSF-442, spec 20270327-100000-listas-de-precios-por-cliente, Fase 1): bandera `listas_precios` (D13, RF-PRE-14-6,
-- CA-PRE-14-7). Apagada por defecto en cada entorno: «Guardar lista» responde 55000, archivar y restaurar siguen permitidos y el
-- precio de una línea es el de siempre (el motor no conoce las listas en esta fase). Encendida, guardar funciona.
begin;

select plan(14);

insert into organizaciones (id, nombre) values ('11111111-1111-1111-1111-111111111111', 'Organización Uno');
insert into auth.users (id, email) values ('d1000000-0000-0000-0000-000000000001', 'admin-uno@example.com');
insert into usuarios_organizacion (user_id, organizacion_id, rol_id, estado) values
  ('d1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'administrador', 'activo');

create function pg_temp.como(p_user uuid) returns void language plpgsql as $$
begin
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
  set local role authenticated;
end $$;

-- Una lista ya existente (cargada como postgres) para probar archivar y restaurar con la bandera apagada.
insert into dominio.listas_precios (id, organizacion_id, nombre, ajuste_pct) values
  ('a1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'Existente', -10);

select is((select count(*)::int from public.banderas_plataforma where clave = 'listas_precios'), 1, 'la bandera existe');
select is((select activa from public.banderas_plataforma where clave = 'listas_precios'), false, 'nace apagada');
select is(private.bandera_activa('listas_precios'), false, 'bandera_activa la ve apagada');

select pg_temp.como('d1000000-0000-0000-0000-000000000001');

select throws_ok($$select public.guardar_lista_precios(null, 'Nueva', null, -5, null)$$, '55000', null, 'apagada: crear responde 55000');
select throws_ok(
  $$select public.guardar_lista_precios('a1000000-0000-0000-0000-000000000001', 'Existente', null, -15, null)$$,
  '55000', null, 'apagada: editar responde 55000');
select is((select count(*)::int from public.listas_precios_resumen), 1, 'apagada: no se escribió nada');
select is((select ajuste_pct from public.listas_precios_resumen), -10.00::numeric, 'apagada: el porcentaje no cambió');

select lives_ok(
  format($$select public.archivar_lista_precios('a1000000-0000-0000-0000-000000000001', %L)$$, (select updated_at from public.listas_precios_resumen)),
  'apagada: archivar sigue permitido');
select lives_ok(
  format($$select public.restaurar_lista_precios('a1000000-0000-0000-0000-000000000001', %L)$$, (select updated_at from public.listas_precios_resumen)),
  'apagada: restaurar sigue permitido');

reset role;
update public.banderas_plataforma set activa = true where clave = 'listas_precios';
select is(private.bandera_activa('listas_precios'), true, 'encendida se ve encendida');
select pg_temp.como('d1000000-0000-0000-0000-000000000001');
select lives_ok($$select public.guardar_lista_precios(null, 'Nueva', null, -5, null)$$, 'encendida: crear funciona');
select is((select count(*)::int from public.listas_precios_resumen), 2, 'encendida: la lista quedó creada');

-- Sin efecto en precios: con listas creadas y la bandera encendida, el precio de una línea es el de siempre.
reset role;
insert into dominio.empresas (id, organizacion_id, nombre, activa) values
  ('e1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'Tienda A', true);
insert into dominio.productos (id, organizacion_id, nombre, sku, precio_lista, moneda, activo) values
  ('b1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'Alfa', 'PR-1', 1000, 'ARS', true);
create temp table t_precio as
  select neto_unitario from private.precio_linea_venta_calculo('b1000000-0000-0000-0000-000000000001', 'e1000000-0000-0000-0000-000000000001', 'minorista', 1, 0);
select is((select neto_unitario from t_precio), 1000::numeric, 'el precio de la línea sigue siendo el central con listas creadas');
update public.banderas_plataforma set activa = false where clave = 'listas_precios';
select is(
  (select neto_unitario from private.precio_linea_venta_calculo('b1000000-0000-0000-0000-000000000001', 'e1000000-0000-0000-0000-000000000001', 'minorista', 1, 0)),
  (select neto_unitario from t_precio), 'y es idéntico con la bandera apagada');

select * from finish();
rollback;
