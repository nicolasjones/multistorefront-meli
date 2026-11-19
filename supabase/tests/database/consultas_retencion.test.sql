-- MSF-944 · Seguimiento de MSF-176 (T063 y T072; decisión D-20): retención y supresión de las
-- consultas, los ítems de pedido y los presupuestos de la tienda.
--
-- Cubre la política completa:
--   * la purga por retención (FR-001 a FR-006): qué se borra (consultas que no están «en_curso», sus
--     ítems, sus avisos y las copias sueltas de la cola que ya vencieron) y qué no (una consulta en
--     curso, lo reciente, el comprobante de venta), la nota de los presupuestos, la idempotencia, el
--     plazo inválido, los privilegios, el 42501 y el aislamiento por organización;
--   * la supresión a pedido del titular (FR-010 a FR-015), por correo o por teléfono: consultas,
--     ítems, notas de presupuesto y copias de los avisos; el comprobante fiscal intacto; la
--     actividad con cantidades y sin datos personales; el 42501 y el aislamiento por organización;
--   * el aviso de la consulta atado a su consulta (la clave interna `ConsultaId` sale del correo).
--
-- Las fechas son relativas al reloj de la base (sin fechas absolutas).
begin;

select plan(72);

-- ============================================================================
-- Datos: dos organizaciones, dos tiendas, una titular con cuenta web
-- ============================================================================
insert into organizaciones (id, nombre) values
  ('11111111-1111-1111-1111-111111111111', 'Organización Uno'),
  ('22222222-2222-2222-2222-222222222222', 'Organización Dos');

insert into auth.users (id, email, phone) values
  ('a1000000-0000-0000-0000-000000000001', 'admin-uno@example.com', null),
  ('a1000000-0000-0000-0000-000000000002', 'titular@example.com', '+54 9 11 5555-1234'),
  ('a2000000-0000-0000-0000-000000000001', 'admin-dos@example.com', null),
  ('a2000000-0000-0000-0000-000000000002', 'titular-dos@example.com', null);

insert into usuarios_organizacion (user_id, organizacion_id, rol_id, estado) values
  ('a1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'administrador', 'activo'),
  ('a2000000-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', 'administrador', 'activo');

insert into dominio.empresas (id, organizacion_id, nombre, activa) values
  ('e1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'Tienda Uno', true),
  ('e2000000-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', 'Tienda Dos', true);

-- La titular de la organización uno: ficha con correo y teléfono, y cuenta web con el mismo correo.
insert into dominio.clientes (id, organizacion_id, numero, nombre, correo, telefono, tipo) values
  ('c1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 910, 'Titular Cuenta',
   'titular@example.com', '+54 9 11 5555-1234', 'mayorista'),
  ('c1000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 911, 'Otro Cliente',
   'otro@example.com', null, 'minorista'),
  ('c2000000-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', 920, 'Titular Otra Org',
   'titular@example.com', null, 'minorista');

insert into public.clientes_empresas (cliente_id, empresa_id, organizacion_id) values
  ('c1000000-0000-0000-0000-000000000001', 'e1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111'),
  ('c2000000-0000-0000-0000-000000000001', 'e2000000-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222');

insert into public.cuentas_cliente (id, organizacion_id, cliente_id, empresa_id, auth_user_id, estado) values
  ('ca000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'c1000000-0000-0000-0000-000000000001',
   'e1000000-0000-0000-0000-000000000001', 'a1000000-0000-0000-0000-000000000002', 'activa'),
  ('ca000000-0000-0000-0000-000000000002', '22222222-2222-2222-2222-222222222222', 'c2000000-0000-0000-0000-000000000001',
   'e2000000-0000-0000-0000-000000000001', 'a2000000-0000-0000-0000-000000000002', 'activa');

insert into dominio.productos (id, organizacion_id, nombre, precio_lista) values
  ('d1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'Alfa', 1000),
  ('d1000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'Beta', 2000);

-- El comprobante fiscal: la supresión y la purga no lo tocan.
insert into dominio.comprobantes_venta (id, organizacion_id, empresa_id, cliente_id, tipo, numero, numero_entero, fecha, estado, total_sin_iva, total_con_iva, canal) values
  ('f1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'e1000000-0000-0000-0000-000000000001',
   'c1000000-0000-0000-0000-000000000001', 'presupuesto', '00000091', 91, current_date, 'pendiente', 1000, 1210, 'tienda_online'),
  ('f1000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'e1000000-0000-0000-0000-000000000001',
   'c1000000-0000-0000-0000-000000000001', 'presupuesto', '00000092', 92, current_date, 'pendiente', 1000, 1210, 'tienda_online'),
  ('f2000000-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', 'e2000000-0000-0000-0000-000000000001',
   'c2000000-0000-0000-0000-000000000001', 'presupuesto', '00000092', 92, current_date, 'pendiente', 1000, 1210, 'tienda_online');

-- Dos presupuestos de la titular: uno viejo (vence el plazo) y uno reciente.
insert into dominio.presupuestos_tienda (organizacion_id, empresa_id, cuenta_cliente_id, cliente_id, comprobante_id, clave_envio, nota, creado_en) values
  ('11111111-1111-1111-1111-111111111111', 'e1000000-0000-0000-0000-000000000001', 'ca000000-0000-0000-0000-000000000001',
   'c1000000-0000-0000-0000-000000000001', 'f1000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000001',
   'Entregar por la tarde', now() - interval '200 days'),
  ('11111111-1111-1111-1111-111111111111', 'e1000000-0000-0000-0000-000000000001', 'ca000000-0000-0000-0000-000000000001',
   'c1000000-0000-0000-0000-000000000001', 'f1000000-0000-0000-0000-000000000002', 'a0000000-0000-0000-0000-000000000002',
   'Nota de hoy', now() - interval '10 days'),
  ('22222222-2222-2222-2222-222222222222', 'e2000000-0000-0000-0000-000000000001', 'ca000000-0000-0000-0000-000000000002',
   'c2000000-0000-0000-0000-000000000001', 'f2000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000003',
   'Nota de la otra organización', now() - interval '10 days');

-- Consultas: dos viejas que no están en curso, una vieja en curso, una reciente y una de otra organización.
insert into dominio.consultas (id, organizacion_id, empresa_id, origen, nombre, contacto, mensaje, estado, cliente_id, created_at, updated_at) values
  ('b1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'e1000000-0000-0000-0000-000000000001',
   'formulario', 'Vieja Resuelta', 'vieja@example.com', 'Hola', 'resuelta', null, now() - interval '200 days', now() - interval '200 days'),
  ('b1000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'e1000000-0000-0000-0000-000000000001',
   'formulario', 'Vieja Nueva', 'nueva@example.com', 'Hola', 'nueva', null, now() - interval '200 days', now() - interval '200 days'),
  ('b1000000-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111', 'e1000000-0000-0000-0000-000000000001',
   'formulario', 'Vieja En Curso', 'curso@example.com', 'Hola', 'en_curso', null, now() - interval '200 days', now() - interval '200 days'),
  ('b1000000-0000-0000-0000-000000000004', '11111111-1111-1111-1111-111111111111', 'e1000000-0000-0000-0000-000000000001',
   'formulario', 'Reciente', 'reciente@example.com', 'Hola', 'resuelta', null, now() - interval '10 days', now() - interval '10 days'),
  ('b2000000-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', 'e2000000-0000-0000-0000-000000000001',
   'formulario', 'Vieja De Otra Org', 'otra@example.com', 'Hola', 'resuelta', null, now() - interval '200 days', now() - interval '200 days'),
  -- De la titular (se suprimen): por correo, por pedido con cliente y por teléfono en otro formato.
  ('b1000000-0000-0000-0000-000000000005', '11111111-1111-1111-1111-111111111111', 'e1000000-0000-0000-0000-000000000001',
   'formulario', 'Titular Cuenta', 'titular@example.com', 'Quiero info', 'resuelta', null, now() - interval '10 days', now() - interval '10 days'),
  ('b1000000-0000-0000-0000-000000000006', '11111111-1111-1111-1111-111111111111', 'e1000000-0000-0000-0000-000000000001',
   'pedido', 'Titular Cuenta', '+54 9 11 5555-1234', null, 'nueva', 'c1000000-0000-0000-0000-000000000001', now() - interval '10 days', now() - interval '10 days'),
  ('b1000000-0000-0000-0000-000000000007', '11111111-1111-1111-1111-111111111111', 'e1000000-0000-0000-0000-000000000001',
   'whatsapp', 'Titular Cuenta', '11 5555-1234', 'Hola', 'nueva', null, now() - interval '10 days', now() - interval '10 days'),
  -- De otro contacto y de otra organización: no se tocan.
  ('b1000000-0000-0000-0000-000000000008', '11111111-1111-1111-1111-111111111111', 'e1000000-0000-0000-0000-000000000001',
   'formulario', 'Dueño de Otra', 'otro@example.com', 'Hola', 'nueva', null, now() - interval '10 days', now() - interval '10 days'),
  ('b2000000-0000-0000-0000-000000000002', '22222222-2222-2222-2222-222222222222', 'e2000000-0000-0000-0000-000000000001',
   'formulario', 'Titular Otra Org', 'titular@example.com', 'Hola', 'nueva', null, now() - interval '10 days', now() - interval '10 days');

insert into dominio.consulta_items (organizacion_id, empresa_id, consulta_id, orden, descripcion, cantidad) values
  ('11111111-1111-1111-1111-111111111111', 'e1000000-0000-0000-0000-000000000001', 'b1000000-0000-0000-0000-000000000001', 1, 'Alfa', 2),
  ('11111111-1111-1111-1111-111111111111', 'e1000000-0000-0000-0000-000000000001', 'b1000000-0000-0000-0000-000000000001', 2, 'Beta', 1),
  ('11111111-1111-1111-1111-111111111111', 'e1000000-0000-0000-0000-000000000001', 'b1000000-0000-0000-0000-000000000006', 1, 'Alfa', 5);

-- La cola de avisos: una copia atada a la consulta vieja, dos copias sueltas (una vencida y otra
-- reciente) y un aviso de otro tipo, que no es una copia de una consulta.
insert into public.avisos_pendientes (id, organizacion_id, user_id, tipo_aviso, grupo_id, datos, estado, creado_en, consulta_id) values
  ('c1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'a1000000-0000-0000-0000-000000000001',
   'consulta_nueva', gen_random_uuid(), '{"Nombre":"Vieja Resuelta","Contacto":"vieja@example.com","Mensaje":"Hola"}'::jsonb,
   'pendiente', now() - interval '200 days', 'b1000000-0000-0000-0000-000000000001'),
  ('c1000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'a1000000-0000-0000-0000-000000000001',
   'consulta_nueva', gen_random_uuid(), '{"Nombre":"Vieja Suelta","Contacto":"suelta@example.com","Mensaje":"Hola"}'::jsonb,
   'pendiente', now() - interval '200 days', null),
  ('c1000000-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111', 'a1000000-0000-0000-0000-000000000001',
   'consulta_nueva', gen_random_uuid(), '{"Nombre":"Suelta Reciente","Contacto":"reciente@example.com","Mensaje":"Hola"}'::jsonb,
   'pendiente', now() - interval '10 days', null),
  ('c1000000-0000-0000-0000-000000000004', '11111111-1111-1111-1111-111111111111', 'a1000000-0000-0000-0000-000000000001',
   'presupuesto_tienda_nuevo', gen_random_uuid(), '{"Nombre":"Otro Aviso","Contacto":"otro@example.com","Mensaje":"Hola"}'::jsonb,
   'pendiente', now() - interval '200 days', null),
  -- Avisos de la titular: uno pendiente (se borra) y uno ya enviado (pierde las claves personales).
  ('c1000000-0000-0000-0000-000000000005', '11111111-1111-1111-1111-111111111111', 'a1000000-0000-0000-0000-000000000001',
   'consulta_nueva', gen_random_uuid(), '{"Nombre":"Titular Cuenta","Contacto":"titular@example.com","Mensaje":"Quiero info"}'::jsonb,
   'pendiente', now() - interval '10 days', 'b1000000-0000-0000-0000-000000000005'),
  ('c1000000-0000-0000-0000-000000000006', '11111111-1111-1111-1111-111111111111', 'a1000000-0000-0000-0000-000000000001',
   'consulta_nueva', gen_random_uuid(), '{"Nombre":"Titular Cuenta","Contacto":"titular@example.com","Mensaje":"Quiero info"}'::jsonb,
   'enviado', now() - interval '10 days', 'b1000000-0000-0000-0000-000000000005'),
  -- Copia suelta de la titular (anterior a la columna `consulta_id`): también se limpia.
  ('c1000000-0000-0000-0000-000000000007', '11111111-1111-1111-1111-111111111111', 'a1000000-0000-0000-0000-000000000001',
   'consulta_nueva', gen_random_uuid(), '{"Nombre":"Titular Cuenta","Contacto":"titular@example.com","Mensaje":"Quiero info"}'::jsonb,
   'enviado', now() - interval '10 days', null);

-- El rol de Sistema no ve las funciones de pgTAP: sus resultados se guardan en una tabla temporal.
create temp table resultado (corrida int, borradas int);
grant all on resultado to workers_orquestacion;

-- ============================================================================
-- Privilegios y superficie (FR-006, FR-015, FR-022)
-- ============================================================================
select is(has_function_privilege('anon', 'private.purgar_consultas_tienda(integer)', 'execute'), false, 'anon no purga las consultas de la tienda');
select is(has_function_privilege('authenticated', 'private.purgar_consultas_tienda(integer)', 'execute'), false, 'authenticated no purga las consultas de la tienda');
select is(has_function_privilege('workers_orquestacion', 'private.purgar_consultas_tienda(integer)', 'execute'), true, 'el rol de orquestación purga las consultas de la tienda');
select is(has_function_privilege('anon', 'private.suprimir_titular_tienda(uuid, text)', 'execute'), false, 'anon no suprime datos de titulares');
select is(has_function_privilege('authenticated', 'private.suprimir_titular_tienda(uuid, text)', 'execute'), false, 'authenticated no suprime datos de titulares');
select is(has_function_privilege('workers_orquestacion', 'private.suprimir_titular_tienda(uuid, text)', 'execute'), true, 'el rol de orquestación suprime datos de titulares');
select is((select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'public' and p.proname in ('purgar_consultas_tienda', 'suprimir_titular_tienda')), 0,
  'las funciones nuevas no quedan en un esquema expuesto por la API (no hay RPC nueva)');

-- Un rol sin permiso recibe 42501 y no se toca nada.
set local role authenticated;
select throws_ok($$select private.purgar_consultas_tienda(180)$$, '42501', null, 'un usuario autenticado no purga');
select throws_ok($$select private.suprimir_titular_tienda('11111111-1111-1111-1111-111111111111', 'titular@example.com')$$, '42501', null, 'un usuario autenticado no suprime');
reset role;
select is((select count(*)::int from dominio.consultas), 10, 'el rechazo no borra ninguna consulta');
select is((select count(*)::int from dominio.consulta_items), 3, 'el rechazo no borra ningún ítem');
select is((select count(*)::int from public.avisos_pendientes
            where id in ('c1000000-0000-0000-0000-000000000001', 'c1000000-0000-0000-0000-000000000007')), 2,
  'el rechazo no borra ningún aviso');

-- ============================================================================
-- Purga por retención (FR-001 a FR-006)
-- ============================================================================
-- Un plazo fuera de 1 a 3650 días se rechaza (FR-001).
set local role workers_orquestacion;
select throws_ok($$select private.purgar_consultas_tienda(0)$$, '22023', null, 'un plazo de cero días se rechaza');
select throws_ok($$select private.purgar_consultas_tienda(3651)$$, '22023', null, 'un plazo de más de 3650 días se rechaza');
reset role;
select is((select count(*)::int from dominio.consultas), 10, 'un plazo inválido no borra nada');

-- La purga borra lo vencido y no está en curso, y respeta el aislamiento por organización.
set local role workers_orquestacion;
insert into resultado values (1, private.purgar_consultas_tienda(180));
reset role;
select is((select borradas from resultado where corrida = 1), 3, 'la purga borra las tres consultas vencidas (dos de la organización uno y una de la dos)');
select is((select count(*)::int from dominio.consultas where id in ('b1000000-0000-0000-0000-000000000001', 'b1000000-0000-0000-0000-000000000002')), 0, 'las consultas viejas que nadie atendía ya no están');
select is((select count(*)::int from dominio.consultas where id = 'b1000000-0000-0000-0000-000000000003'), 1, 'una consulta en curso no se borra sola (es un compromiso comercial vivo)');
select is((select count(*)::int from dominio.consultas where id = 'b1000000-0000-0000-0000-000000000004'), 1, 'una consulta reciente no se borra');
select is((select count(*)::int from dominio.consultas where id = 'b2000000-0000-0000-0000-000000000001'), 0, 'la consulta vencida de la otra organización también se purga (la purga es global por plazo)');
select is((select count(*)::int from dominio.consultas where id = 'b2000000-0000-0000-0000-000000000002'), 1, 'la consulta de la otra organización que no venció sigue');

-- Los ítems se van en cascada (FR-003).
select is((select count(*)::int from dominio.consulta_items where consulta_id = 'b1000000-0000-0000-0000-000000000001'), 0, 'los ítems de la consulta borrada se van en cascada');
select is((select count(*)::int from dominio.consulta_items), 1, 'solo queda el ítem de la consulta que sigue');

-- La copia de los avisos no sobrevive (FR-005): la atada se va con la consulta y la suelta vencida también.
select is((select count(*)::int from public.avisos_pendientes where consulta_id = 'b1000000-0000-0000-0000-000000000001'), 0, 'los avisos atados a la consulta borrada se van en cascada');
select is((select count(*)::int from public.avisos_pendientes where id = 'c1000000-0000-0000-0000-000000000001'), 0, 'la copia atada a la consulta borrada no queda en la cola');
select is((select count(*)::int from public.avisos_pendientes where id = 'c1000000-0000-0000-0000-000000000002'), 0, 'la copia suelta que ya venció se borra en la purga');
select is((select count(*)::int from public.avisos_pendientes where id = 'c1000000-0000-0000-0000-000000000003'), 1, 'la copia suelta que no venció sigue');
select is((select count(*)::int from public.avisos_pendientes where id = 'c1000000-0000-0000-0000-000000000004'), 1, 'un aviso que no es una copia de una consulta no se purga');

-- La nota del presupuesto viejo se vacía; el comprobante de venta no se toca (FR-004).
select is((select nota from dominio.presupuestos_tienda where clave_envio = 'a0000000-0000-0000-0000-000000000001'), null, 'la nota del presupuesto vencido se vacía');
select ok((select suprimido_en is not null from dominio.presupuestos_tienda where clave_envio = 'a0000000-0000-0000-0000-000000000001'), 'el presupuesto vaciado queda marcado');
select is((select nota from dominio.presupuestos_tienda where clave_envio = 'a0000000-0000-0000-0000-000000000002'), 'Nota de hoy', 'la nota del presupuesto que no venció sigue');
select is((select total_con_iva from dominio.comprobantes_venta where id = 'f1000000-0000-0000-0000-000000000001'), 1210::numeric, 'el comprobante de venta conserva su importe');
select is((select estado from dominio.comprobantes_venta where id = 'f1000000-0000-0000-0000-000000000001'), 'pendiente', 'el comprobante de venta conserva su estado');

-- El evento de actividad: uno por organización, con cantidades y sin datos personales (FR-006, FR-014).
select is((select count(*)::int from public.registro_actividad where tipo = 'sistema.depurada' and organizacion_id = '11111111-1111-1111-1111-111111111111'), 1, 'la organización uno queda con un evento de purga');
select is((select count(*)::int from public.registro_actividad where tipo = 'sistema.depurada' and organizacion_id = '22222222-2222-2222-2222-222222222222'), 1, 'la organización dos queda con un evento de purga');
select is((select actor_id from public.registro_actividad where tipo = 'sistema.depurada' and organizacion_id = '11111111-1111-1111-1111-111111111111'), null, 'el evento de purga no tiene actor');
select ok((select bool_and(detalle not like '%Vieja%' and detalle not like '%@example.com%' and detalle not like '%5555%') from public.registro_actividad where tipo = 'sistema.depurada'), 'el evento de purga no lleva datos personales');
select ok((select detalle like '%2 consultas%' from public.registro_actividad where tipo = 'sistema.depurada' and organizacion_id = '11111111-1111-1111-1111-111111111111'), 'el evento de purga informa cuántas consultas se borraron');

-- Idempotencia: una segunda pasada no borra nada ni suma eventos (FR-006).
set local role workers_orquestacion;
insert into resultado values (2, private.purgar_consultas_tienda(180));
reset role;
select is((select borradas from resultado where corrida = 2), 0, 'una segunda pasada no borra nada');
select is((select count(*)::int from public.registro_actividad where tipo = 'sistema.depurada'), 2, 'y no suma eventos de purga');

-- ============================================================================
-- El aviso de la consulta queda atado a su consulta (la clave interna no viaja al correo)
-- ============================================================================
select is((select count(*)::int from public.avisos_pendientes where id = 'c1000000-0000-0000-0000-000000000005'), 1, 'el aviso de la titular sigue en la cola');
select is((select consulta_id from public.avisos_pendientes where id = 'c1000000-0000-0000-0000-000000000005'), 'b1000000-0000-0000-0000-000000000005'::uuid, 'el aviso sabe de qué consulta es');
select is((select count(*)::int from public.avisos_pendientes where datos ? 'ConsultaId'), 0, 'la clave interna de la consulta no viaja en el correo');
select is((select count(*)::int from public.avisos_pendientes where consulta_id is null and tipo_aviso = 'consulta_nueva'), 2, 'solo las copias anteriores a la columna quedan sin atar');

-- ============================================================================
-- Supresión a pedido del titular (FR-010 a FR-015)
-- ============================================================================
set local role workers_orquestacion;
insert into resultado values (3, private.suprimir_titular_tienda('11111111-1111-1111-1111-111111111111', 'titular@example.com'));
reset role;
select is((select borradas from resultado where corrida = 3), 3, 'la supresión alcanza las tres consultas de la titular (por correo, por pedido y por teléfono)');

-- La consulta se anonimiza: la fila y su estado se conservan (FR-010).
select is((select nombre from dominio.consultas where id = 'b1000000-0000-0000-0000-000000000005'), 'Anonimizado', 'el nombre de la consulta queda anonimizado');
select is((select contacto from dominio.consultas where id = 'b1000000-0000-0000-0000-000000000005'), 'Anonimizado', 'el contacto de la consulta queda anonimizado');
select is((select mensaje from dominio.consultas where id = 'b1000000-0000-0000-0000-000000000005'), 'Mensaje eliminado por supresión', 'el mensaje queda en un texto neutro');
select ok((select suprimido_en is not null from dominio.consultas where id = 'b1000000-0000-0000-0000-000000000005'), 'la consulta suprimida queda marcada');
select is((select count(*)::int from dominio.consultas where id = 'b1000000-0000-0000-0000-000000000005'), 1, 'la consulta no se borra: se anonimiza');

-- Los ítems de la titular se borran (FR-011).
select is((select count(*)::int from dominio.consulta_items where consulta_id = 'b1000000-0000-0000-0000-000000000006'), 0, 'los ítems del pedido de la titular se borran');
select is((select count(*)::int from dominio.consulta_items), 0, 'no queda ninguna copia de lo que pidió la titular');

-- La nota de su presupuesto se vacía y el comprobante fiscal no se toca (FR-012).
select is((select nota from dominio.presupuestos_tienda where clave_envio = 'a0000000-0000-0000-0000-000000000002'), null, 'la nota del presupuesto de la titular se vacía');
select ok((select suprimido_en is not null from dominio.presupuestos_tienda where clave_envio = 'a0000000-0000-0000-0000-000000000002'), 'el presupuesto de la titular queda marcado');
select is((select total_con_iva from dominio.comprobantes_venta where id = 'f1000000-0000-0000-0000-000000000002'), 1210::numeric, 'el comprobante de venta de la titular conserva su importe');
select is((select count(*)::int from dominio.comprobantes_venta
            where id in ('f1000000-0000-0000-0000-000000000001', 'f1000000-0000-0000-0000-000000000002')), 2,
  'no se borra ningún comprobante de venta');

-- La cola de avisos se limpia (FR-013): el pendiente se borra y los enviados pierden los datos.
select is((select count(*)::int from public.avisos_pendientes where id = 'c1000000-0000-0000-0000-000000000005'), 0, 'el aviso pendiente de la titular se borra');
select is((select count(*)::int from public.avisos_pendientes where id = 'c1000000-0000-0000-0000-000000000006'), 1, 'el aviso ya enviado se conserva como registro');
select ok((select not (datos ? 'Nombre') and not (datos ? 'Contacto') and not (datos ? 'Mensaje') from public.avisos_pendientes where id = 'c1000000-0000-0000-0000-000000000006'), 'el aviso ya enviado pierde las claves con datos personales');
select ok((select not (datos ? 'Nombre') and not (datos ? 'Contacto') and not (datos ? 'Mensaje') from public.avisos_pendientes where id = 'c1000000-0000-0000-0000-000000000007'), 'la copia suelta de la titular también pierde los datos personales');

-- La actividad lleva cantidades y nunca datos del titular (FR-014).
select is((select count(*)::int from public.registro_actividad where tipo = 'tienda.titular_suprimido'), 1, 'la supresión deja un evento de actividad');
select ok((select detalle not like '%titular@example.com%' and detalle not like '%5555%' and detalle not like '%Titular Cuenta%' from public.registro_actividad where tipo = 'tienda.titular_suprimido'), 'el evento de la supresión no lleva datos personales');
select ok((select detalle like '%3 consulta%' from public.registro_actividad where tipo = 'tienda.titular_suprimido'), 'el evento de la supresión informa cuántas consultas se suprimieron');

-- La supresión es por organización y por contacto: no toca lo demás (FR-015).
select is((select count(*)::int from dominio.consultas where id = 'b1000000-0000-0000-0000-000000000008'), 1, 'la consulta de otro contacto sigue');
select is((select contacto from dominio.consultas where id = 'b1000000-0000-0000-0000-000000000008'), 'otro@example.com', 'y no fue anonimizada');
select is((select count(*)::int from dominio.consultas where id = 'b2000000-0000-0000-0000-000000000002'), 1, 'la consulta de la titular en otra organización sigue');
select is((select contacto from dominio.consultas where id = 'b2000000-0000-0000-0000-000000000002'), 'titular@example.com', 'y no fue anonimizada');
select is((select count(*)::int from public.avisos_pendientes where id = 'c1000000-0000-0000-0000-000000000003'), 1, 'la copia de otro contacto sigue en la cola');
select is((select nota from dominio.presupuestos_tienda where clave_envio = 'a0000000-0000-0000-0000-000000000003'), 'Nota de la otra organización', 'la nota del presupuesto de la otra organización no se vacía');
select ok((select suprimido_en is null from dominio.presupuestos_tienda where clave_envio = 'a0000000-0000-0000-0000-000000000003'), 'y ese presupuesto no queda marcado');

-- Una supresión repetida no cambia nada (idempotente).
set local role workers_orquestacion;
insert into resultado values (4, private.suprimir_titular_tienda('11111111-1111-1111-1111-111111111111', 'titular@example.com'));
reset role;
select is((select borradas from resultado where corrida = 4), 0, 'una segunda supresión del mismo titular no cambia nada');
select is((select count(*)::int from public.registro_actividad where tipo = 'tienda.titular_suprimido'), 1, 'y no suma eventos');

select * from finish();
rollback;
