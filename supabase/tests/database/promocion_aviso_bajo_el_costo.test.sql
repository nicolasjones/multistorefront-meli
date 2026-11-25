-- MSF-958 (seguimiento de MSF-934): `public.guardar_promocion_precio` avisa, sin bloquear, cuando el precio promocional
-- está por debajo del costo del producto, y solo a quien tiene la sección `rentabilidad` (lectura o edición).
-- Cubre: precio menor al costo (aviso + guarda igual), igual y mayor (sin aviso), edición y repetición idempotente,
-- el operador (edita `productos`, no ve `rentabilidad`: respuesta idéntica a la de siempre, sin filtrar el costo), un
-- rol con `rentabilidad` en lectura, producto sin costo, costo en USD convertido con la cotización, convivencia con el
-- aviso de «no menor al normal» (MSF-936), la bandera apagada, el aislamiento entre organizaciones y los permisos.
begin;

select no_plan();

insert into organizaciones (id, nombre) values
  ('11111111-1111-1111-1111-111111111111', 'Organización Uno'),
  ('22222222-2222-2222-2222-222222222222', 'Organización Dos');
insert into auth.users (id, email) values
  ('f9000000-0000-0000-0000-000000000001', 'admin-s958@example.com'),
  ('f9000000-0000-0000-0000-000000000002', 'operador-s958@example.com'),
  ('f9000000-0000-0000-0000-000000000003', 'administracion-s958@example.com'),
  ('f9000000-0000-0000-0000-000000000004', 'admin-dos-s958@example.com');
insert into usuarios_organizacion (user_id, organizacion_id, rol_id, estado) values
  ('f9000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'administrador', 'activo'),
  ('f9000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'operador', 'activo'),
  ('f9000000-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111', 'administracion', 'activo'),
  ('f9000000-0000-0000-0000-000000000004', '22222222-2222-2222-2222-222222222222', 'administrador', 'activo');

insert into dominio.empresas (id, organizacion_id, nombre, activa) values
  ('e9000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'Tienda A', true),
  ('e9000000-0000-0000-0000-000000000003', '22222222-2222-2222-2222-222222222222', 'Tienda Dos', true);
insert into dominio.tiendas (organizacion_id, empresa_id, dominio) values
  ('11111111-1111-1111-1111-111111111111', 'e9000000-0000-0000-0000-000000000001', 's958-a.ejemplo.com'),
  ('22222222-2222-2222-2222-222222222222', 'e9000000-0000-0000-0000-000000000003', 's958-dos.ejemplo.com');
insert into dominio.precios_empresa (empresa_id, organizacion_id, base, ajuste_pct, mostrar_con_iva) values
  ('e9000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'central', 0, false);
insert into usuarios_empresas (user_id, empresa_id, organizacion_id, rol_id) values
  ('f9000000-0000-0000-0000-000000000002', 'e9000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'operador'),
  ('f9000000-0000-0000-0000-000000000003', 'e9000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'administracion');

-- Alfa lista 1000 costo 600 · Beta lista 1000 sin costo · Gamma lista 1000 costo USD 2 (cotización 1000 → 2000 ARS)
-- · Ajeno (org 2) lista 1000 costo 900.
insert into dominio.productos (id, organizacion_id, nombre, sku, precio_lista, moneda, activo) values
  ('a9000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'Alfa', 'S958-1', 1000, 'ARS', true),
  ('a9000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'Beta', 'S958-2', 1000, 'ARS', true),
  ('a9000000-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111', 'Gamma', 'S958-3', 5000, 'ARS', true),
  ('b9000000-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', 'Ajeno', 'S958-9', 1000, 'ARS', true);
update dominio.productos set moneda = 'USD' where id = 'a9000000-0000-0000-0000-000000000003';
update dominio.productos set alicuota_iva_id = (select id from dominio.alicuotas_iva
  where organizacion_id = '11111111-1111-1111-1111-111111111111' and nombre = '21 %')
 where organizacion_id = '11111111-1111-1111-1111-111111111111';
insert into dominio.producto_empresa (producto_id, empresa_id, organizacion_id)
select p.id, 'e9000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111'
  from dominio.productos p where p.organizacion_id = '11111111-1111-1111-1111-111111111111';
insert into dominio.producto_empresa (producto_id, empresa_id, organizacion_id) values
  ('b9000000-0000-0000-0000-000000000001', 'e9000000-0000-0000-0000-000000000003', '22222222-2222-2222-2222-222222222222');
insert into dominio.producto_costos (producto_id, organizacion_id, costo) values
  ('a9000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 600),
  ('a9000000-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111', 2),
  ('b9000000-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', 900);

insert into dominio.cotizacion_inicial (organizacion_id, valor) values ('11111111-1111-1111-1111-111111111111', 1000);
update public.banderas_plataforma set activa = true where clave = 'promociones_precio';

create function pg_temp.como(p_user uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
  set local role authenticated;
end $$;

-- Precondición: la matriz de roles que sostiene el diseño (operador edita productos y no ve rentabilidad).
select is((select nivel from public.permisos_rol where organizacion_id = '11111111-1111-1111-1111-111111111111' and rol_id = 'operador' and seccion = 'rentabilidad'), 'ninguno',
  'precondición: el operador no tiene la sección rentabilidad');
select is((select nivel from public.permisos_rol where organizacion_id = '11111111-1111-1111-1111-111111111111' and rol_id = 'administracion' and seccion = 'rentabilidad'), 'lectura',
  'precondición: administración tiene rentabilidad en lectura');

create temp table r (clave text primary key, j jsonb);
grant all on r to authenticated;

-- ============================================================================
-- Administrador (rentabilidad en edición)
-- ============================================================================
select pg_temp.como('f9000000-0000-0000-0000-000000000001');
insert into r values
  ('bajo', public.guardar_promocion_precio(null, 'e9000000-0000-0000-0000-000000000001', 'a9000000-0000-0000-0000-000000000001', 500, now(), now() + interval '2 days')),
  ('sin_costo', public.guardar_promocion_precio(null, 'e9000000-0000-0000-0000-000000000001', 'a9000000-0000-0000-0000-000000000002', 1, now(), now() + interval '2 days')),
  ('usd_bajo', public.guardar_promocion_precio(null, 'e9000000-0000-0000-0000-000000000001', 'a9000000-0000-0000-0000-000000000003', 1500, now(), now() + interval '2 days'));
reset role;
select is((select j ->> 'aviso_costo_codigo' from r where clave = 'bajo'), 'promocion_bajo_el_costo',
  'administrador: 500 < costo 600 devuelve aviso_costo_codigo');
select ok((select length(j ->> 'aviso_costo') > 20 from r where clave = 'bajo'), '... y el texto del aviso');
select is((select count(*)::int from dominio.promociones_precio
            where id = (select (j ->> 'id')::uuid from r where clave = 'bajo') and precio_promocional = 500 and anulada_at is null), 1,
  '... y NO bloquea: la promoción quedó guardada');
select is((select j ? 'aviso_codigo' from r where clave = 'bajo'), false,
  '... y no mezcla el aviso de «no menor al normal» (500 < 1000)');
select is((select j ? 'aviso_costo_codigo' from r where clave = 'sin_costo'), false,
  'producto sin costo cargado: sin aviso (precio 1)');
-- Cotización: el costo USD 2 se convierte a pesos con la cotización de la organización.
select is((select private.a_pesos(2, 'USD', '11111111-1111-1111-1111-111111111111', 'e9000000-0000-0000-0000-000000000001')), 2000::numeric,
  'precondición: el costo USD 2 de Gamma son 2000 pesos con la cotización 1000');
select is((select j ->> 'aviso_costo_codigo' from r where clave = 'usd_bajo'), 'promocion_bajo_el_costo',
  'costo en USD: 1500 < 2000 pesos (costo convertido con la cotización) avisa');

-- Borde: igual al costo no avisa; mayor al costo no avisa; edición a menor avisa; repetir conserva el aviso.
select pg_temp.como('f9000000-0000-0000-0000-000000000001');
insert into r values
  ('editada_igual', public.guardar_promocion_precio((select (j ->> 'id')::uuid from r where clave = 'bajo'),
     'e9000000-0000-0000-0000-000000000001', 'a9000000-0000-0000-0000-000000000001', 600, now(), now() + interval '2 days',
     (select (j ->> 'updated_at')::timestamptz from r where clave = 'bajo')));
insert into r values
  ('editada_mayor', public.guardar_promocion_precio((select (j ->> 'id')::uuid from r where clave = 'editada_igual'),
     'e9000000-0000-0000-0000-000000000001', 'a9000000-0000-0000-0000-000000000001', 800, now(), now() + interval '2 days',
     (select (j ->> 'updated_at')::timestamptz from r where clave = 'editada_igual')));
insert into r values
  ('editada_menor', public.guardar_promocion_precio((select (j ->> 'id')::uuid from r where clave = 'editada_mayor'),
     'e9000000-0000-0000-0000-000000000001', 'a9000000-0000-0000-0000-000000000001', 599.99, now(), now() + interval '2 days',
     (select (j ->> 'updated_at')::timestamptz from r where clave = 'editada_mayor')));
insert into r values
  ('repetida', public.guardar_promocion_precio((select (j ->> 'id')::uuid from r where clave = 'editada_menor'),
     'e9000000-0000-0000-0000-000000000001', 'a9000000-0000-0000-0000-000000000001', 599.99,
     (select (j ->> 'desde')::timestamptz from r where clave = 'editada_menor'), (select (j ->> 'hasta')::timestamptz from r where clave = 'editada_menor'),
     (select (j ->> 'updated_at')::timestamptz from r where clave = 'editada_menor')));
reset role;
select is((select j ? 'aviso_costo_codigo' from r where clave = 'editada_igual'), false, 'precio igual al costo (600): sin aviso (no es menor)');
select is((select j ? 'aviso_costo_codigo' from r where clave = 'editada_mayor'), false, 'precio mayor al costo (800): sin aviso');
select is((select count(*)::int from jsonb_object_keys((select j from r where clave = 'editada_mayor'))),
  (select count(*)::int from information_schema.columns where table_schema = 'dominio' and table_name = 'promociones_precio'),
  'sin avisos el resultado es exactamente la fila (contrato anterior intacto)');
select is((select j ->> 'aviso_costo_codigo' from r where clave = 'editada_menor'), 'promocion_bajo_el_costo', 'editar a 599,99 (< 600) avisa');
select is((select j ->> 'aviso_costo_codigo' from r where clave = 'repetida'), 'promocion_bajo_el_costo',
  'repetir la edición ya guardada (idempotente) conserva el aviso');

-- Convivencia con el aviso de MSF-936: precio mayor al normal (Alfa lista 1000) y ... costo mayor al precio no es posible a la vez
-- con costo 600; se usa Gamma (lista 5000 USD, costo USD 2): un precio de 1 es bajo el costo y bajo el normal.
-- Beta con costo cargado por postgres: precio 3000 (mayor al normal 1000) y costo 4000 ⇒ ambos avisos.
insert into dominio.producto_costos (producto_id, organizacion_id, costo) values
  ('a9000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 4000);
select pg_temp.como('f9000000-0000-0000-0000-000000000001');
insert into r values
  ('ambos', public.guardar_promocion_precio((select (j ->> 'id')::uuid from r where clave = 'sin_costo'),
     'e9000000-0000-0000-0000-000000000001', 'a9000000-0000-0000-0000-000000000002', 3000, now(), now() + interval '2 days',
     (select (j ->> 'updated_at')::timestamptz from r where clave = 'sin_costo')));
reset role;
select is((select jsonb_build_array(j ->> 'aviso_codigo', j ->> 'aviso_costo_codigo') from r where clave = 'ambos'),
  '["promocion_no_menor_al_normal", "promocion_bajo_el_costo"]'::jsonb,
  'los dos avisos conviven: no menor al normal (MSF-936) y bajo el costo (MSF-958)');

-- ============================================================================
-- Operador: edita promociones pero NO ve el costo ⇒ ningún aviso de costo (no se le revela el costo)
-- ============================================================================
select pg_temp.como('f9000000-0000-0000-0000-000000000002');
insert into r values
  ('operador_bajo', public.guardar_promocion_precio(null, 'e9000000-0000-0000-0000-000000000001', 'a9000000-0000-0000-0000-000000000003', 1, now() + interval '3 days', now() + interval '4 days'));
reset role;
select is((select j ? 'aviso_costo_codigo' or j ? 'aviso_costo' from r where clave = 'operador_bajo'), false,
  'operador: un precio bajo el costo se guarda SIN aviso de costo (no ve rentabilidad)');
select is((select count(*)::int from dominio.promociones_precio
            where id = (select (j ->> 'id')::uuid from r where clave = 'operador_bajo') and precio_promocional = 1), 1,
  '... y la promoción queda guardada igual');
select is((select count(*)::int from jsonb_object_keys((select j from r where clave = 'operador_bajo'))),
  (select count(*)::int from information_schema.columns where table_schema = 'dominio' and table_name = 'promociones_precio'),
  '... con la respuesta idéntica a la de antes (mismas claves que la fila)');

-- ============================================================================
-- Rol con rentabilidad en lectura (administración) y con productos en edición? Si no edita productos, no llega al aviso.
-- ============================================================================
select is((select nivel from public.permisos_rol where organizacion_id = '11111111-1111-1111-1111-111111111111' and rol_id = 'administracion' and seccion = 'productos') = 'edicion', false,
  'administración no edita productos: no puede cargar promociones');
select pg_temp.como('f9000000-0000-0000-0000-000000000003');
select throws_ok(
  $$select public.guardar_promocion_precio(null, 'e9000000-0000-0000-0000-000000000001', 'a9000000-0000-0000-0000-000000000001', 1, now() + interval '5 days', now() + interval '6 days')$$,
  '42501', null, 'administración (rentabilidad en lectura, productos sin edición) no carga promociones: 42501');
reset role;

-- Lectura de rentabilidad: se le habilita productos en edición a un rol de prueba y se comprueba que el aviso sale con «lectura».
update public.permisos_rol set nivel = 'edicion' where organizacion_id = '11111111-1111-1111-1111-111111111111' and rol_id = 'administracion' and seccion = 'productos';
select pg_temp.como('f9000000-0000-0000-0000-000000000003');
insert into r values
  ('lectura_bajo', public.guardar_promocion_precio(null, 'e9000000-0000-0000-0000-000000000001', 'a9000000-0000-0000-0000-000000000001', 100, now() + interval '5 days', now() + interval '6 days'));
reset role;
select is((select j ->> 'aviso_costo_codigo' from r where clave = 'lectura_bajo'), 'promocion_bajo_el_costo',
  'rentabilidad en lectura (con productos en edición): recibe el aviso de costo');

-- ============================================================================
-- Aislamiento entre organizaciones y bandera apagada
-- ============================================================================
select pg_temp.como('f9000000-0000-0000-0000-000000000004');
insert into r values
  ('otra_org', public.guardar_promocion_precio(null, 'e9000000-0000-0000-0000-000000000003', 'b9000000-0000-0000-0000-000000000001', 800, now(), now() + interval '2 days'));
select throws_ok(
  $$select public.guardar_promocion_precio(null, 'e9000000-0000-0000-0000-000000000001', 'a9000000-0000-0000-0000-000000000001', 1, now(), now() + interval '2 days')$$,
  'PT404', null, 'una tienda de otra organización no existe (PT404): el aviso no filtra el costo ajeno');
reset role;
select is((select j ->> 'aviso_costo_codigo' from r where clave = 'otra_org'), 'promocion_bajo_el_costo',
  'organización 2: avisa con SU costo (900), no con el de la organización 1');

update public.banderas_plataforma set activa = false where clave = 'promociones_precio';
select pg_temp.como('f9000000-0000-0000-0000-000000000001');
select throws_ok(
  $$select public.guardar_promocion_precio(null, 'e9000000-0000-0000-0000-000000000001', 'a9000000-0000-0000-0000-000000000001', 1, now() + interval '9 days', now() + interval '10 days')$$,
  '55000', null, 'bandera apagada: guardar sigue rechazando con 55000');
reset role;

-- ============================================================================
-- Permisos de la función auxiliar
-- ============================================================================
select pg_temp.como('f9000000-0000-0000-0000-000000000001');
select throws_ok(
  $$select private.promocion_con_aviso('{}'::jsonb, 'e9000000-0000-0000-0000-000000000001', 'a9000000-0000-0000-0000-000000000001', 1)$$,
  '42501', null, 'authenticated no ejecuta private.promocion_con_aviso');
reset role;
select is(has_function_privilege('anon', 'private.promocion_con_aviso(jsonb, uuid, uuid, numeric)', 'execute'), false, 'anon no ejecuta promocion_con_aviso');
select is(has_function_privilege('authenticated', 'private.promocion_con_aviso(jsonb, uuid, uuid, numeric)', 'execute'), false, 'authenticated no ejecuta promocion_con_aviso');
select is((select prosecdef and proconfig = array['search_path=""'] from pg_proc where oid = 'private.promocion_con_aviso(jsonb, uuid, uuid, numeric)'::regprocedure), true,
  'promocion_con_aviso: security definer con search_path vacío');

select * from finish();
rollback;
