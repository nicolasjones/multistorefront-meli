-- MSF-405 · F-STK-17 (épica MSF-368, SC-302, FR-307, FR-308, FR-309): avisos de reposición de faltantes.
-- Cubre `avisar_faltantes` (marca, un correo por cliente, no repite, omite sin stock / sin correo / sin
-- permiso, errores), la cola de la Edge Function (pendientes, toma con reserva de 2 minutos, cierre,
-- reintento, agotado → vuelve a «Sin avisar»), RLS de dominio.faltantes_avisos y los privilegios (RPC de
-- service_role no ejecutables por authenticated/anon). El fixture corre como postgres; las verificaciones,
-- como «authenticated», «anon» o «service_role», igual que PostgREST.
begin;

select no_plan();

insert into organizaciones (id, nombre) values
  ('11111111-1111-1111-1111-111111111111', 'Organización Uno'),
  ('22222222-2222-2222-2222-222222222222', 'Organización Dos');

insert into auth.users (id, email) values
  ('f1000000-0000-0000-0000-000000000002', 'operador@example.com'),
  ('f1000000-0000-0000-0000-000000000003', 'consulta@example.com'),
  ('f2000000-0000-0000-0000-000000000001', 'admin-dos@example.com'),
  ('f3000000-0000-0000-0000-000000000001', 'sin-organizacion@example.com');

insert into usuarios_organizacion (user_id, organizacion_id, rol_id, estado) values
  ('f1000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'operador', 'activo'),
  ('f1000000-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111', 'consulta', 'activo'),
  ('f2000000-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', 'administrador', 'activo');

insert into dominio.empresas (id, organizacion_id, nombre) values
  ('a1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'San Javucho'),
  ('a2000000-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', 'Empresa Dos');

insert into usuarios_empresas (user_id, empresa_id, organizacion_id, rol_id) values
  ('f1000000-0000-0000-0000-000000000002', 'a1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'operador'),
  ('f1000000-0000-0000-0000-000000000003', 'a1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'consulta');

-- Uno tiene correo; Sin Correo no.
insert into clientes (id, organizacion_id, numero, nombre, tipo, correo, archivado_en) values
  ('c5000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 10, 'Cliente Uno', 'minorista', 'uno@example.com', null),
  ('c5000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 11, 'Cliente Sin Correo', 'minorista', null, null);

insert into dominio.categorias (id, organizacion_id, nombre) values
  ('c1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'Consolas');

-- P3 «A pedido» con 6 en stock; P4 «A pedido» con 3 (se reservan los 3: queda sin stock disponible).
insert into dominio.productos (id, organizacion_id, nombre, sku, moneda, precio_lista, categoria_id, disponibilidad_manual, activo) values
  ('b1000000-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111', 'Consola bajo pedido', 'CON-1', 'ARS', 2000, 'c1000000-0000-0000-0000-000000000001', 'a_pedido', true),
  ('b1000000-0000-0000-0000-000000000004', '11111111-1111-1111-1111-111111111111', 'Monitor bajo pedido', 'MON-1', 'ARS', 3000, 'c1000000-0000-0000-0000-000000000001', 'a_pedido', true);

create temp table datos as
  select (select id from dominio.depositos where organizacion_id = '11111111-1111-1111-1111-111111111111' and por_defecto) as principal;
grant select on datos to public;

insert into dominio.depositos_empresas (deposito_id, empresa_id, organizacion_id)
select principal, 'a1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111' from datos
on conflict do nothing;

insert into dominio.existencias (producto_id, organizacion_id, cantidad, reservado) values
  ('b1000000-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111', 6, 0),
  ('b1000000-0000-0000-0000-000000000004', '11111111-1111-1111-1111-111111111111', 3, 0)
on conflict (producto_id) do update set cantidad = excluded.cantidad, reservado = excluded.reservado;
insert into dominio.existencias_deposito (producto_id, deposito_id, organizacion_id, cantidad, reservado) values
  ('b1000000-0000-0000-0000-000000000003', (select principal from datos), '11111111-1111-1111-1111-111111111111', 6, 0),
  ('b1000000-0000-0000-0000-000000000004', (select principal from datos), '11111111-1111-1111-1111-111111111111', 3, 0)
on conflict (producto_id, deposito_id) do update set cantidad = excluded.cantidad, reservado = excluded.reservado;

create function pg_temp.como(p_user uuid) returns void language plpgsql as $$
begin
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
  set local role authenticated;
end $$;

create temp table comps (clave text primary key, id uuid);
grant select, insert, update on comps to public;
create temp table lin (clave text primary key, id uuid);
grant select, insert, update on lin to public;

create function pg_temp.armar(p_clave text, p_cliente uuid, p_producto uuid, p_cantidad integer) returns void language plpgsql as $$
declare v_c dominio.comprobantes_venta;
begin
  v_c := public.crear_comprobante('factura', 'a1000000-0000-0000-0000-000000000001', p_cliente, 'mostrador', '2026-10-24');
  insert into comps (clave, id) values (p_clave, v_c.id);
  perform public.guardar_lineas_comprobante(v_c.id, jsonb_build_array(jsonb_build_object(
    'producto_id', p_producto, 'cantidad', p_cantidad, 'deposito_id', (select principal from datos))), v_c.updated_at);
  perform public.confirmar_comprobante(v_c.id);
  insert into lin (clave, id)
    select p_clave, l.linea_id from public.faltantes_listado l where l.comprobante_id = v_c.id;
end $$;

create function pg_temp.lineas(variadic p_claves text[]) returns uuid[] language sql as $$
  select array_agg(l.id order by l.clave) from lin l where l.clave = any (p_claves) $$;

-- Lectura directa de la tabla con los privilegios del dueño: service_role solo ejecuta las RPC.
create function pg_temp.q(p_sql text) returns text language plpgsql security definer as $$
declare v text;
begin
  execute p_sql into v;
  return v;
end $$;

select pg_temp.como('f1000000-0000-0000-0000-000000000002');

-- F1 y F2: Cliente Uno, Consola (avisables, mismo cliente). F3: sin correo. F4: Monitor ×3 (sin stock).
select pg_temp.armar('F1', 'c5000000-0000-0000-0000-000000000001', 'b1000000-0000-0000-0000-000000000003', 1);
select pg_temp.armar('F2', 'c5000000-0000-0000-0000-000000000001', 'b1000000-0000-0000-0000-000000000003', 1);
select pg_temp.armar('F3', 'c5000000-0000-0000-0000-000000000002', 'b1000000-0000-0000-0000-000000000003', 1);
select pg_temp.armar('F4', 'c5000000-0000-0000-0000-000000000001', 'b1000000-0000-0000-0000-000000000004', 3);

select is((select count(*)::int from lin), 4, 'las cuatro líneas son faltantes abiertos');
select is(
  (select estado_stock from public.faltantes_listado where producto = 'Monitor bajo pedido'),
  'sin_stock', 'el Monitor quedó sin stock disponible (3 reservadas de 3)'
);

-- ============================================================================
-- Esquema y privilegios (Principio VII, FR-309)
-- ============================================================================

reset role;
select ok(
  exists (select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
           where n.nspname = 'dominio' and c.relname = 'faltantes_avisos' and c.relrowsecurity),
  'faltantes_avisos vive en «dominio» y tiene RLS activada'
);
select ok(
  not exists (select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
               where n.nspname = 'public' and c.relname = 'faltantes_avisos'),
  'no existe una copia en «public»'
);
select is(has_table_privilege('anon', 'dominio.faltantes_avisos', 'select'), false, 'anon no lee faltantes_avisos');
select is(has_table_privilege('authenticated', 'dominio.faltantes_avisos', 'insert'), false, 'authenticated no inserta avisos');
select is(has_table_privilege('authenticated', 'dominio.faltantes_avisos', 'update'), false, 'authenticated no modifica avisos');
select is(has_table_privilege('authenticated', 'dominio.faltantes_avisos', 'delete'), false, 'authenticated no borra avisos');
select is(has_function_privilege('anon', 'public.avisar_faltantes(uuid[])', 'execute'), false, 'anon no ejecuta avisar_faltantes');
select is(has_function_privilege('authenticated', 'public.avisar_faltantes(uuid[])', 'execute'), true, 'authenticated ejecuta avisar_faltantes');
select is_empty(
  $$select p.oid::regprocedure from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname in ('faltantes_avisos_pendientes', 'tomar_aviso_faltante', 'cerrar_aviso_faltante')
      and (has_function_privilege('anon', p.oid, 'EXECUTE') or has_function_privilege('authenticated', p.oid, 'EXECUTE'))$$,
  'anon y authenticated no ejecutan las RPC de la función de envío'
);
select is_empty(
  $$select p.oid::regprocedure from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname in ('faltantes_avisos_pendientes', 'tomar_aviso_faltante', 'cerrar_aviso_faltante')
      and not has_function_privilege('service_role', p.oid, 'EXECUTE')$$,
  'service_role ejecuta las tres RPC de la función de envío'
);

select pg_temp.como('f1000000-0000-0000-0000-000000000002');
select throws_ok(
  $$insert into dominio.faltantes_avisos (linea_id, organizacion_id, empresa_id, cliente_id)
    select id, '11111111-1111-1111-1111-111111111111', 'a1000000-0000-0000-0000-000000000001', 'c5000000-0000-0000-0000-000000000001'
    from lin limit 1$$,
  '42501', null, 'authenticated no puede escribir faltantes_avisos directamente'
);
select throws_ok(
  $$update dominio.faltantes_avisos set intentos = 0$$,
  '42501', null, 'authenticated no puede modificar los avisos'
);
select throws_ok(
  $$delete from dominio.faltantes_avisos$$,
  '42501', null, 'authenticated no puede borrar los avisos'
);

-- Las RPC de la función de envío son solo de `service_role`: ni `authenticated` ni `anon` las ejecutan.
select throws_ok(
  $$select * from public.faltantes_avisos_pendientes(5, 50)$$,
  '42501', null, 'authenticated no ejecuta la RPC de pendientes'
);
select throws_ok(
  $$select * from public.tomar_aviso_faltante('c5000000-0000-0000-0000-000000000001', 5)$$,
  '42501', null, 'authenticated no ejecuta la RPC de toma'
);
select throws_ok(
  $$select public.cerrar_aviso_faltante('c5000000-0000-0000-0000-000000000001', true, null, 5)$$,
  '42501', null, 'authenticated no ejecuta la RPC de cierre'
);

reset role;
set local role anon;
select throws_ok(
  $$select count(*) from dominio.faltantes_avisos$$,
  '42501', null, 'anon no lee faltantes_avisos'
);
select throws_ok(
  $$select * from public.faltantes_avisos_pendientes(5, 50)$$,
  '42501', null, 'anon no ejecuta la RPC de pendientes'
);
select throws_ok(
  $$select * from public.tomar_aviso_faltante('c5000000-0000-0000-0000-000000000001', 5)$$,
  '42501', null, 'anon no ejecuta la RPC de toma'
);
select throws_ok(
  $$select public.cerrar_aviso_faltante('c5000000-0000-0000-0000-000000000001', true, null, 5)$$,
  '42501', null, 'anon no ejecuta la RPC de cierre'
);
reset role;
select pg_temp.como('f1000000-0000-0000-0000-000000000002');

-- ============================================================================
-- avisar_faltantes (FR-307)
-- ============================================================================

select throws_ok($$select public.avisar_faltantes('{}'::uuid[])$$, '22023', null, 'una lista vacía se rechaza (22023)');
select throws_ok(
  $$select public.avisar_faltantes(array(select gen_random_uuid() from generate_series(1, 201)))$$,
  '22023', null, 'más de 200 líneas se rechaza (22023)'
);

select is(
  (select public.avisar_faltantes(pg_temp.lineas('F1', 'F2', 'F3', 'F4'))::jsonb),
  '{"encolados": 1, "lineas_avisadas": 2, "omitidos_sin_stock": 1, "omitidos_sin_correo": 1, "omitidos_ya_avisados": 0, "omitidos_sin_permiso": 0}'::jsonb,
  'avisa las dos líneas de Cliente Uno (UN correo) y omite la de sin stock y la de sin correo'
);
select is(
  (select count(*)::int from dominio.faltantes_avisos where estado = 'pendiente'),
  2, 'quedan dos avisos en cola (uno por línea)'
);
select is(
  (select string_agg(aviso, ',' order by aviso) from public.faltantes_listado where cliente = 'Cliente Uno'),
  'avisado,avisado,sin_avisar', 'el listado marca «Avisado» las dos líneas encoladas; el Monitor sigue «Sin avisar»'
);
select is(
  (select public.avisar_faltantes(pg_temp.lineas('F1', 'F2', 'F3', 'F4'))::jsonb),
  '{"encolados": 0, "lineas_avisadas": 0, "omitidos_sin_stock": 1, "omitidos_sin_correo": 1, "omitidos_ya_avisados": 2, "omitidos_sin_permiso": 0}'::jsonb,
  'repetir no vuelve a avisar: es idempotente por línea'
);
select is((select count(*)::int from dominio.faltantes_avisos), 2, 'sigue habiendo una sola fila por línea');

select pg_temp.como('f1000000-0000-0000-0000-000000000003');
select is(
  (select public.avisar_faltantes(pg_temp.lineas('F3'))::jsonb),
  '{"encolados": 0, "lineas_avisadas": 0, "omitidos_sin_stock": 0, "omitidos_sin_correo": 0, "omitidos_ya_avisados": 0, "omitidos_sin_permiso": 1}'::jsonb,
  'un rol sin edición en Ventas ve la línea pero no puede avisarla (omitida sin permiso)'
);

select pg_temp.como('f3000000-0000-0000-0000-000000000001');
select throws_ok($$select public.avisar_faltantes(array[gen_random_uuid()])$$, '42501', null, 'sin organización activa no puede avisar (42501)');

select pg_temp.como('f2000000-0000-0000-0000-000000000001');
select is(
  (select public.avisar_faltantes(pg_temp.lineas('F1', 'F2'))::jsonb),
  '{"encolados": 0, "lineas_avisadas": 0, "omitidos_sin_stock": 0, "omitidos_sin_correo": 0, "omitidos_ya_avisados": 0, "omitidos_sin_permiso": 0}'::jsonb,
  'otra organización no alcanza las líneas ajenas: no avisa nada'
);
select is((select count(*)::int from dominio.faltantes_avisos), 0, 'otra organización no ve los avisos de la organización Uno (RLS)');

select pg_temp.como('f1000000-0000-0000-0000-000000000002');
select is((select count(*)::int from dominio.faltantes_avisos), 2, 'la organización Uno ve sus dos avisos (RLS por organización y tienda)');

-- ============================================================================
-- Cola de la función de envío: toma, cierre, reintento, agotado (FR-308)
-- ============================================================================

reset role;
set local role service_role;

select is(
  (select count(*)::int from unnest(public.faltantes_avisos_pendientes(5, 50)) x where x = 'c5000000-0000-0000-0000-000000000001'),
  1, 'el barrido lista a Cliente Uno una vez (un correo por cliente, no por línea)'
);
select is(
  (select jsonb_array_length(lineas)::text || '|' || correo from public.tomar_aviso_faltante('c5000000-0000-0000-0000-000000000001', 5)),
  '2|uno@example.com', 'la toma devuelve el correo del cliente y sus dos líneas en un solo envío'
);
select is(
  pg_temp.q($$select string_agg(intentos::text, ',') from dominio.faltantes_avisos where estado = 'pendiente'$$),
  '1,1', 'la toma cuenta un intento en cada línea'
);
select is(
  (select count(*)::int from public.tomar_aviso_faltante('c5000000-0000-0000-0000-000000000001', 5)),
  0, 'una segunda toma dentro de los 2 minutos no devuelve nada (reserva): no se manda dos veces'
);
select is(
  (select cardinality(public.faltantes_avisos_pendientes(5, 50))), 0,
  'mientras dura la reserva el barrido no vuelve a listarlo'
);

select public.cerrar_aviso_faltante('c5000000-0000-0000-0000-000000000001', false, 'smtp caído', 5);
select is(
  pg_temp.q($$select string_agg(estado || ':' || ultimo_error, ',') from dominio.faltantes_avisos$$),
  'pendiente:smtp caído,pendiente:smtp caído', 'un envío fallido bajo el tope queda pendiente con el error útil'
);

-- Vence la reserva: el reintento retoma las mismas líneas y suma otro intento.
reset role;
update dominio.faltantes_avisos set updated_at = now() - interval '3 minutes';
set local role service_role;
select is(
  (select cardinality(public.faltantes_avisos_pendientes(5, 50))), 1,
  'vencida la reserva el barrido vuelve a listar al cliente'
);
select is(
  (select jsonb_array_length(lineas) from public.tomar_aviso_faltante('c5000000-0000-0000-0000-000000000001', 5)),
  2, 'el reintento retoma las dos líneas'
);
select is(
  pg_temp.q($$select string_agg(intentos::text, ',') from dominio.faltantes_avisos$$), '2,2', 'el reintento suma el segundo intento'
);
select public.cerrar_aviso_faltante('c5000000-0000-0000-0000-000000000001', true, null, 5);
select is(
  pg_temp.q($$select string_agg(estado, ',') from dominio.faltantes_avisos$$), 'enviado,enviado', 'el envío exitoso cierra las dos líneas como enviadas'
);
select is(
  pg_temp.q($$select count(*) from dominio.faltantes_avisos where enviado_en is not null and ultimo_error is null$$), '2',
  'queda la fecha de envío y se limpia el error'
);
select is(
  (select count(*)::int from public.tomar_aviso_faltante('c5000000-0000-0000-0000-000000000001', 5)), 0,
  'lo ya enviado no se vuelve a tomar'
);
select is((select cardinality(public.faltantes_avisos_pendientes(5, 50))), 0, 'no queda nada pendiente');

-- Agotado: otra línea llega al tope de intentos, vuelve a «Sin avisar» con el error y puede avisarse de nuevo.
select pg_temp.como('f1000000-0000-0000-0000-000000000002');
select pg_temp.armar('F5', 'c5000000-0000-0000-0000-000000000001', 'b1000000-0000-0000-0000-000000000003', 1);
select is((select (public.avisar_faltantes(pg_temp.lineas('F5'))->>'lineas_avisadas')::int), 1, 'la línea nueva entra en cola');

reset role;
update dominio.faltantes_avisos set intentos = 4, updated_at = now() - interval '3 minutes' where linea_id = (select id from lin where clave = 'F5');
set local role service_role;
select is(
  (select jsonb_array_length(lineas) from public.tomar_aviso_faltante('c5000000-0000-0000-0000-000000000001', 5)),
  1, 'el último intento todavía se toma (5 de 5)'
);
select public.cerrar_aviso_faltante('c5000000-0000-0000-0000-000000000001', false, 'fallo final', 5);
select is(
  pg_temp.q($$select row(estado, intentos, ultimo_error)::text from dominio.faltantes_avisos where linea_id = (select id from lin where clave = 'F5')$$),
  '(agotado,5,"fallo final")', 'agotado el tope queda «agotado» con el error registrado'
);
select is((select cardinality(public.faltantes_avisos_pendientes(5, 50))), 0, 'una línea agotada ya no se reintenta sola');

select pg_temp.como('f1000000-0000-0000-0000-000000000002');
select is(
  (select aviso from public.faltantes_listado where comprobante_id = (select id from comps where clave = 'F5')),
  'sin_avisar', 'agotado el tope la línea vuelve a «Sin avisar»'
);
select is(
  (select (public.avisar_faltantes(pg_temp.lineas('F5'))->>'lineas_avisadas')::int), 1,
  'una línea agotada puede avisarse otra vez (reinicia la cola)'
);
select is(
  (select row(estado, intentos, ultimo_error)::text from dominio.faltantes_avisos where linea_id = (select id from lin where clave = 'F5')),
  '(pendiente,0,)', 'reencolada: pendiente, sin intentos y sin error'
);

reset role;
select * from finish();
rollback;
