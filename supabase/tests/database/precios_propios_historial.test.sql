-- MSF-352 (revisión de F-PRE-08): historial append-only de precios propios (`dominio.precios_propios_historial`).
-- Cubre: una fila por cambio real con valor anterior y nuevo, actor y fecha; idempotencia (sin fila); inalterabilidad
-- (update, delete y truncate fallan aun para el dueño; la baja de la organización sí lo borra); aislamiento por
-- organización; lectura con la sección productos; sin escritura directa ni acceso de `anon`; la actividad sigue sin importes.
begin;

select no_plan();

insert into organizaciones (id, nombre) values
  ('11111111-1111-1111-1111-111111111111', 'Organización Uno'),
  ('22222222-2222-2222-2222-222222222222', 'Organización Dos');
insert into auth.users (id, email) values
  ('d1000000-0000-0000-0000-000000000001', 'administrador@example.com'),
  ('d1000000-0000-0000-0000-000000000002', 'consulta@example.com'),
  ('d2000000-0000-0000-0000-000000000001', 'admin-dos@example.com');
insert into usuarios_organizacion (user_id, organizacion_id, rol_id) values
  ('d1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'administrador'),
  ('d1000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'consulta'),
  ('d2000000-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', 'administrador');
insert into dominio.empresas (id, organizacion_id, nombre) values
  ('e1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'Mundo JC'),
  ('e2000000-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', 'Empresa Tres');
insert into dominio.productos (id, organizacion_id, nombre, sku, moneda, precio_lista) values
  ('a1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'Joystick', 'JOY-1', 'ARS', 100),
  ('a2000000-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', 'Teclado', 'TEC-1', 'ARS', 100);

create function pg_temp.como(p_user uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
  set local role authenticated;
end $$;

select has_table('dominio', 'precios_propios_historial', 'existe la tabla de historial');
select is((select relrowsecurity from pg_class where oid = 'dominio.precios_propios_historial'::regclass), true, 'con RLS');
select is(has_table_privilege('anon', 'dominio.precios_propios_historial', 'select'), false, 'anon no lee');
select is(has_table_privilege('authenticated', 'dominio.precios_propios_historial', 'select'), true, 'authenticated lee (filtrado por RLS)');
select is(has_table_privilege('authenticated', 'dominio.precios_propios_historial', 'insert'), false, 'authenticated no inserta');
select is(has_table_privilege('authenticated', 'dominio.precios_propios_historial', 'update'), false, 'authenticated no actualiza');
select is(has_table_privilege('authenticated', 'dominio.precios_propios_historial', 'delete'), false, 'authenticated no borra');

-- ============================================================================
-- Cada cambio real deja una fila con valor anterior y nuevo
-- ============================================================================
select pg_temp.como('d1000000-0000-0000-0000-000000000001');
select lives_ok($$select public.fijar_precio_propio('a1000000-0000-0000-0000-000000000001', 'e1000000-0000-0000-0000-000000000001', 'ARS', 5000)$$, 'fijar $ 5.000');
select is((select count(*)::int from dominio.precios_propios_historial), 1, 'una fila');
select is((select accion from dominio.precios_propios_historial), 'fijado', 'acción fijado');
select ok((select moneda_anterior is null and importe_anterior is null from dominio.precios_propios_historial), 'sin valor anterior en el alta');
select is((select moneda_nueva || ' ' || importe_nuevo from dominio.precios_propios_historial), 'ARS 5000.00', 'valor nuevo ARS 5.000');
select is((select actor_id from dominio.precios_propios_historial), 'd1000000-0000-0000-0000-000000000001'::uuid, 'quién');
select is((select actor_nombre from dominio.precios_propios_historial), 'administrador@example.com', 'nombre del actor en el momento');
select ok((select creado_en > now() - interval '1 minute' from dominio.precios_propios_historial), 'cuándo');

select lives_ok($$select public.fijar_precio_propio('a1000000-0000-0000-0000-000000000001', 'e1000000-0000-0000-0000-000000000001', 'ARS', 5000)$$, 'fijar lo mismo');
select is((select count(*)::int from dominio.precios_propios_historial), 1, 'fijar lo mismo no agrega fila (idempotente)');

select lives_ok($$select public.fijar_precio_propio('a1000000-0000-0000-0000-000000000001', 'e1000000-0000-0000-0000-000000000001', 'ARS', 4000)$$, 'bajar a $ 4.000');
select is((select moneda_anterior || ' ' || importe_anterior || ' -> ' || moneda_nueva || ' ' || importe_nuevo
             from dominio.precios_propios_historial order by creado_en desc, id limit 1),
  'ARS 5000.00 -> ARS 4000.00', 'quién bajó el precio de $ 5.000 a $ 4.000 queda registrado');

select lives_ok($$select public.fijar_precio_propio('a1000000-0000-0000-0000-000000000001', 'e1000000-0000-0000-0000-000000000001', 'USD', 3)$$, 'pasar a USD 3');
select is((select moneda_anterior || ' ' || importe_anterior || ' -> ' || moneda_nueva || ' ' || importe_nuevo
             from dominio.precios_propios_historial order by creado_en desc, id limit 1),
  'ARS 4000.00 -> USD 3.00', 'cambio de moneda');

select lives_ok($$select public.quitar_precio_propio('a1000000-0000-0000-0000-000000000001', 'e1000000-0000-0000-0000-000000000001')$$, 'quitar');
select is((select accion || ' ' || moneda_anterior || ' ' || importe_anterior from dominio.precios_propios_historial order by creado_en desc, id limit 1),
  'quitado USD 3.00', 'la baja deja el valor anterior');
select ok((select moneda_nueva is null and importe_nuevo is null from dominio.precios_propios_historial order by creado_en desc, id limit 1), 'y sin valor nuevo');
select lives_ok($$select public.quitar_precio_propio('a1000000-0000-0000-0000-000000000001', 'e1000000-0000-0000-0000-000000000001')$$, 'quitar lo que no existe');
select is((select count(*)::int from dominio.precios_propios_historial), 4, 'quitar sin precio propio no agrega fila: 4 filas en total');

-- La actividad sigue sin importes.
reset role;
select is((select count(*)::int from public.registro_actividad
            where tipo like 'producto.precio_propio_%' and (detalle like '%5000%' or detalle like '%4000%' or detalle like '%5.000%')), 0,
  'la actividad no lleva importes');

-- ============================================================================
-- Lectura y aislamiento
-- ============================================================================
select pg_temp.como('d1000000-0000-0000-0000-000000000002');
select is((select count(*)::int from dominio.precios_propios_historial), 4, 'un rol de solo lectura en productos ve el historial');
select throws_ok($$insert into dominio.precios_propios_historial (organizacion_id, producto_id, empresa_id, accion, moneda_nueva, importe_nuevo)
  values ('11111111-1111-1111-1111-111111111111', 'a1000000-0000-0000-0000-000000000001', 'e1000000-0000-0000-0000-000000000001', 'fijado', 'ARS', 1)$$,
  '42501', null, 'sin escritura directa');
select pg_temp.como('d2000000-0000-0000-0000-000000000001');
select is((select count(*)::int from dominio.precios_propios_historial), 0, 'otra organización no ve el historial ajeno');
select lives_ok($$select public.fijar_precio_propio('a2000000-0000-0000-0000-000000000001', 'e2000000-0000-0000-0000-000000000001', 'ARS', 900)$$, 'la otra organización fija el suyo');
select is((select count(*)::int from dominio.precios_propios_historial), 1, 've solo el suyo');
reset role;
set local role anon;
select throws_ok($$select count(*) from dominio.precios_propios_historial$$, '42501', null, 'anon no lee');
reset role;

-- ============================================================================
-- Inalterable aun para el dueño de la tabla
-- ============================================================================
select throws_ok($$update dominio.precios_propios_historial set importe_nuevo = 1$$, '42501', null, 'no se actualiza');
select throws_ok($$delete from dominio.precios_propios_historial$$, '42501', null, 'no se borra');
select throws_ok($$truncate dominio.precios_propios_historial$$, '42501', null, 'no se vacía');
select is((select count(*)::int from dominio.precios_propios_historial), 5, 'sigue entero');

-- Aun con session_replication_role = replica (cargas lógicas, herramientas de réplica) los triggers siguen disparando.
set local session_replication_role = replica;
select throws_ok($$update dominio.precios_propios_historial set importe_nuevo = 1$$, '42501', null, 'replica: no se actualiza');
select throws_ok($$delete from dominio.precios_propios_historial$$, '42501', null, 'replica: no se borra');
select throws_ok($$truncate dominio.precios_propios_historial$$, '42501', null, 'replica: no se vacía');
set local session_replication_role = origin;
select is((select count(*)::int from dominio.precios_propios_historial), 5, 'replica: sigue entero');

-- La baja de la organización sí lo elimina en cascada.
select lives_ok($$delete from organizaciones where id = '22222222-2222-2222-2222-222222222222'$$, 'se elimina la organización Dos');
select is((select count(*)::int from dominio.precios_propios_historial), 4, 'y solo se llevó su historial');

-- Borrar un producto elimina en cascada su precio propio: el historial deja la baja ('quitado'), no una última fila 'fijado' vigente.
insert into dominio.productos (id, organizacion_id, nombre, sku, moneda, precio_lista) values
  ('a1000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'Teclado', 'TEC-1', 'ARS', 100);
select pg_temp.como('d1000000-0000-0000-0000-000000000001');
select lives_ok($$select public.fijar_precio_propio('a1000000-0000-0000-0000-000000000002', 'e1000000-0000-0000-0000-000000000001', 'USD', 7)$$, 'se fija un precio propio al Teclado');
reset role;
select lives_ok($$delete from dominio.productos where id = 'a1000000-0000-0000-0000-000000000002'$$, 'se borra el producto');
select is((select accion || ' ' || moneda_anterior || ' ' || importe_anterior from dominio.precios_propios_historial
            where producto_id = 'a1000000-0000-0000-0000-000000000002' order by creado_en desc, id limit 1),
  'quitado USD 7.00', 'la baja en cascada queda como quitado con el último valor');
select is((select count(*)::int from dominio.precios_propios_historial where producto_id = 'a1000000-0000-0000-0000-000000000002'), 2,
  'el historial del producto borrado sobrevive (fijado y quitado)');

-- El precio propio fijado sin RPC concurrente: el bloqueo por (producto, empresa) no cambia el resultado secuencial.
select pg_temp.como('d1000000-0000-0000-0000-000000000001');
select lives_ok($$select public.fijar_precio_propio('a1000000-0000-0000-0000-000000000001', 'e1000000-0000-0000-0000-000000000001', 'ARS', 100)$$, 'fijar de nuevo');
select lives_ok($$select public.fijar_precio_propio('a1000000-0000-0000-0000-000000000001', 'e1000000-0000-0000-0000-000000000001', 'ARS', 90)$$, 'y bajar');
select is((select moneda_anterior || ' ' || importe_anterior || ' -> ' || moneda_nueva || ' ' || importe_nuevo
             from dominio.precios_propios_historial order by creado_en desc, id limit 1),
  'ARS 100.00 -> ARS 90.00', 'cada fila lleva el valor previo real');
reset role;

select * from finish();
rollback;
