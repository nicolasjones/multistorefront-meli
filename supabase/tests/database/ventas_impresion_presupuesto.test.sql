-- F-VTA-20 (MSF-245, épica MSF-213, spec 20261024-100000-ventas-impresion): presupuesto en PDF y envío por correo.
-- Cubre FR-021, FR-023, FR-027, FR-029 y SC-004: presupuesto imprimible en sus estados, regeneración si cambió,
-- `edicion` para enviar, cliente sin correo, idempotencia, cierre del envío, aislamiento y `anon`.
-- El fixture corre como postgres (RLS no aplica); las verificaciones, con el rol que corresponda.
begin;

select no_plan();

insert into organizaciones (id, nombre) values
  ('11111111-1111-1111-1111-111111111111', 'Organización Uno'),
  ('22222222-2222-2222-2222-222222222222', 'Organización Dos');

insert into auth.users (id, email) values
  ('f1000000-0000-0000-0000-000000000001', 'administrador@example.com'),
  ('f1000000-0000-0000-0000-000000000002', 'operador@example.com'),
  ('f1000000-0000-0000-0000-000000000003', 'consulta@example.com'),
  ('f1000000-0000-0000-0000-000000000004', 'deposito@example.com'),
  ('f2000000-0000-0000-0000-000000000001', 'admin-dos@example.com');

insert into usuarios_organizacion (user_id, organizacion_id, rol_id, estado) values
  ('f1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'administrador', 'activo'),
  ('f1000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'operador', 'activo'),
  ('f1000000-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111', 'consulta', 'activo'),
  ('f1000000-0000-0000-0000-000000000004', '11111111-1111-1111-1111-111111111111', 'miembro', 'activo'),
  ('f2000000-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', 'administrador', 'activo');

insert into dominio.empresas (id, organizacion_id, nombre) values
  ('a1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'San Javucho'),
  ('a1000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'Mundo JC'),
  ('a2000000-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', 'Empresa Dos');

-- Operador, consulta y depósito trabajan solo en San Javucho; nadie salvo el administrador entra a Mundo JC.
insert into usuarios_empresas (user_id, empresa_id, organizacion_id, rol_id) values
  ('f1000000-0000-0000-0000-000000000002', 'a1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'operador'),
  ('f1000000-0000-0000-0000-000000000003', 'a1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'consulta'),
  ('f1000000-0000-0000-0000-000000000004', 'a1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'deposito');

insert into public.permisos_rol (organizacion_id, rol_id, seccion, nivel) values
  ('11111111-1111-1111-1111-111111111111', 'deposito', 'ventas', 'ninguno')
on conflict (organizacion_id, rol_id, seccion) do update set nivel = 'ninguno';

-- La fila del catálogo `comprobantes-pdf` la deja la migración de las RPC. Solo la organización Uno tiene conexión.
insert into conexiones (id, organizacion_id, sistema_externo, credencial_vault_id) values
  ('c1000000-0000-0000-0000-0000000000c1', '11111111-1111-1111-1111-111111111111', 'comprobantes-pdf', gen_random_uuid());

-- Clientes: 1 con correo, 2 sin correo (Consumidor final), 3 con correo mal formado, 4 de la organización Dos.
insert into clientes (id, organizacion_id, numero, nombre, tipo, archivado_en, correo) values
  ('c5000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 10, 'Cliente Uno', 'minorista', null, 'cliente.uno@example.com'),
  ('c5000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 11, 'Consumidor final', 'minorista', null, null),
  ('c5000000-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111', 12, 'Cliente Tres', 'minorista', null, 'no es un correo'),
  ('c5000000-0000-0000-0000-000000000004', '22222222-2222-2222-2222-222222222222', 10, 'Cliente Dos', 'minorista', null, 'dos@example.com');

-- P1 pendiente, P2 aceptado, P3 pendiente vencido (derivado), P4 convertido (no imprimible), P5 pendiente sin correo,
-- P6 pendiente con correo inválido, P7 pendiente en Mundo JC, P8 de la organización Dos, F1 factura confirmada.
insert into dominio.comprobantes_venta
  (id, organizacion_id, cliente_id, tipo, numero, fecha, estado, total_sin_iva, total_con_iva, empresa_id, canal, operador_id, valido_hasta) values
  ('b0000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'c5000000-0000-0000-0000-000000000001', 'presupuesto', 'P-0001', '2026-10-24', 'pendiente', 100, 121, 'a1000000-0000-0000-0000-000000000001', 'mostrador', 'f1000000-0000-0000-0000-000000000002', '2099-01-01'),
  ('b0000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'c5000000-0000-0000-0000-000000000001', 'presupuesto', 'P-0002', '2026-10-24', 'aceptado', 100, 121, 'a1000000-0000-0000-0000-000000000001', 'mostrador', 'f1000000-0000-0000-0000-000000000002', '2099-01-01'),
  ('b0000000-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111', 'c5000000-0000-0000-0000-000000000001', 'presupuesto', 'P-0003', '2026-01-01', 'pendiente', 100, 121, 'a1000000-0000-0000-0000-000000000001', 'mostrador', 'f1000000-0000-0000-0000-000000000002', '2026-01-02'),
  ('b0000000-0000-0000-0000-000000000004', '11111111-1111-1111-1111-111111111111', 'c5000000-0000-0000-0000-000000000001', 'presupuesto', 'P-0004', '2026-10-24', 'convertido', 100, 121, 'a1000000-0000-0000-0000-000000000001', 'mostrador', 'f1000000-0000-0000-0000-000000000002', '2099-01-01'),
  ('b0000000-0000-0000-0000-000000000005', '11111111-1111-1111-1111-111111111111', 'c5000000-0000-0000-0000-000000000002', 'presupuesto', 'P-0005', '2026-10-24', 'pendiente', 100, 121, 'a1000000-0000-0000-0000-000000000001', 'mostrador', 'f1000000-0000-0000-0000-000000000002', '2099-01-01'),
  ('b0000000-0000-0000-0000-000000000006', '11111111-1111-1111-1111-111111111111', 'c5000000-0000-0000-0000-000000000003', 'presupuesto', 'P-0006', '2026-10-24', 'pendiente', 100, 121, 'a1000000-0000-0000-0000-000000000001', 'mostrador', 'f1000000-0000-0000-0000-000000000002', '2099-01-01'),
  ('b0000000-0000-0000-0000-000000000007', '11111111-1111-1111-1111-111111111111', 'c5000000-0000-0000-0000-000000000001', 'presupuesto', 'P-0007', '2026-10-24', 'pendiente', 100, 121, 'a1000000-0000-0000-0000-000000000002', 'mostrador', 'f1000000-0000-0000-0000-000000000001', '2099-01-01'),
  ('b0000000-0000-0000-0000-000000000008', '22222222-2222-2222-2222-222222222222', 'c5000000-0000-0000-0000-000000000004', 'presupuesto', 'P-0001', '2026-10-24', 'pendiente', 10, 12.1, 'a2000000-0000-0000-0000-000000000001', 'mostrador', 'f2000000-0000-0000-0000-000000000001', '2099-01-01'),
  ('b0000000-0000-0000-0000-000000000009', '11111111-1111-1111-1111-111111111111', 'c5000000-0000-0000-0000-000000000001', 'factura', '00000001', '2026-10-24', 'confirmada', 100, 121, 'a1000000-0000-0000-0000-000000000001', 'mostrador', 'f1000000-0000-0000-0000-000000000002', null);

create function pg_temp.como(p_user uuid) returns void language plpgsql as $$
begin
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
  set local role authenticated;
end $$;

-- ============================================================================
-- Estructura y privilegios (FR-023)
-- ============================================================================

select is(
  (select count(*)::int from pg_tables where schemaname = 'dominio' and tablename = 'comprobante_envios_correo'),
  1, 'comprobante_envios_correo vive en el esquema dominio (Principio VII)'
);
select is(
  (select count(*)::int from pg_tables where schemaname = 'public' and tablename = 'comprobante_envios_correo'),
  0, 'la tabla no se creó en public'
);
select is(
  (select relrowsecurity from pg_class where oid = 'dominio.comprobante_envios_correo'::regclass),
  true, 'comprobante_envios_correo tiene RLS activado'
);
select is(
  has_table_privilege('authenticated', 'dominio.comprobante_envios_correo', 'insert')
  or has_table_privilege('authenticated', 'dominio.comprobante_envios_correo', 'update')
  or has_table_privilege('authenticated', 'dominio.comprobante_envios_correo', 'delete')
  or has_table_privilege('anon', 'dominio.comprobante_envios_correo', 'select')
  or has_table_privilege('anon', 'dominio.comprobante_envios_correo', 'insert'),
  false, 'sin escritura directa para authenticated y sin acceso para anon'
);
select is(
  has_function_privilege('anon', 'public.enviar_presupuesto_correo(uuid)', 'execute')
  or has_function_privilege('anon', 'public.listar_envios_correo_presupuesto(uuid)', 'execute'),
  false, 'anon no ejecuta las RPC de envío'
);
select is(
  has_function_privilege('authenticated', 'public.enviar_presupuesto_correo(uuid)', 'execute')
  and has_function_privilege('authenticated', 'public.listar_envios_correo_presupuesto(uuid)', 'execute'),
  true, 'authenticated ejecuta las RPC de envío'
);
select is(
  has_function_privilege('authenticated', 'private.cerrar_envio_correo(uuid, text)', 'execute')
  or has_function_privilege('authenticated', 'private.datos_envio_correo(uuid)', 'execute')
  or has_function_privilege('authenticated', 'private.aplicar_cierre_envio_correo(uuid, text)', 'execute')
  or has_function_privilege('anon', 'private.cerrar_envio_correo(uuid, text)', 'execute')
  or has_function_privilege('anon', 'private.datos_envio_correo(uuid)', 'execute'),
  false, 'las funciones del flow no son ejecutables por authenticated ni anon'
);
select is(
  (select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname in ('enviar_presupuesto_correo', 'listar_envios_correo_presupuesto')
      and p.prosecdef and p.proconfig @> array['search_path=""']),
  2, 'las dos RPC son security definer con search_path vacío'
);

-- ============================================================================
-- Imprimir un presupuesto (FR-021)
-- ============================================================================

select pg_temp.como('f1000000-0000-0000-0000-000000000003');

select lives_ok(
  $$ select public.solicitar_documento_comprobante('b0000000-0000-0000-0000-000000000001', 'presupuesto') $$,
  'ventas en lectura imprime un presupuesto pendiente (FR-021)'
);
select lives_ok(
  $$ select public.solicitar_documento_comprobante('b0000000-0000-0000-0000-000000000002', 'presupuesto') $$,
  'un presupuesto aceptado es imprimible'
);
select lives_ok(
  $$ select public.solicitar_documento_comprobante('b0000000-0000-0000-0000-000000000003', 'presupuesto') $$,
  'un presupuesto vencido (pendiente con «válido hasta» pasado) es imprimible'
);
select throws_ok(
  $$ select public.solicitar_documento_comprobante('b0000000-0000-0000-0000-000000000004', 'presupuesto') $$,
  '22023', null, 'un presupuesto convertido no se imprime'
);
select throws_ok(
  $$ select public.solicitar_documento_comprobante('b0000000-0000-0000-0000-000000000009', 'presupuesto') $$,
  '22023', null, 'una factura no se pide como presupuesto'
);
select throws_ok(
  $$ select public.solicitar_documento_comprobante('b0000000-0000-0000-0000-000000000001', 'factura') $$,
  '22023', null, 'un presupuesto no se pide como factura'
);
select throws_ok(
  $$ select public.solicitar_documento_comprobante('b0000000-0000-0000-0000-000000000007', 'presupuesto') $$,
  '42501', null, 'el presupuesto de una tienda sin ventas se rechaza (aislamiento entre empresas)'
);
select throws_ok(
  $$ select public.solicitar_documento_comprobante('b0000000-0000-0000-0000-000000000008', 'presupuesto') $$,
  'P0002', null, 'el presupuesto de otra organización no existe para esta sesión'
);

select is(
  (select (public.solicitar_documento_comprobante('b0000000-0000-0000-0000-000000000001', 'presupuesto')).id),
  (select id from dominio.comprobante_documentos where comprobante_id = 'b0000000-0000-0000-0000-000000000001' and tipo_documento = 'presupuesto'),
  'pedir el mismo presupuesto dos veces devuelve el mismo pedido pendiente (idempotente)'
);

-- Regeneración (FR-021): un PDF generado vale mientras el presupuesto no cambie.
reset role;
update dominio.comprobante_documentos
set estado = 'generado',
    ruta = organizacion_id::text || '/' || empresa_id::text || '/' || comprobante_id::text || '/' || id::text || '.pdf',
    generado_en = clock_timestamp()
where comprobante_id = 'b0000000-0000-0000-0000-000000000002' and tipo_documento = 'presupuesto';
update dominio.comprobantes_venta set updated_at = '2000-01-01' where id = 'b0000000-0000-0000-0000-000000000002';
insert into storage.objects (bucket_id, name, owner)
select 'comprobantes-documentos', ruta, null from dominio.comprobante_documentos
where comprobante_id = 'b0000000-0000-0000-0000-000000000002' and tipo_documento = 'presupuesto';

select pg_temp.como('f1000000-0000-0000-0000-000000000003');
select is(
  (select (public.solicitar_documento_comprobante('b0000000-0000-0000-0000-000000000002', 'presupuesto')).estado),
  'generado', 'un presupuesto sin cambios reutiliza su PDF generado'
);

reset role;
update dominio.comprobantes_venta set updated_at = clock_timestamp() + interval '1 minute' where id = 'b0000000-0000-0000-0000-000000000002';
select pg_temp.como('f1000000-0000-0000-0000-000000000003');
select is(
  (select (public.solicitar_documento_comprobante('b0000000-0000-0000-0000-000000000002', 'presupuesto')).estado),
  'pendiente', 'un presupuesto modificado después del PDF genera uno nuevo'
);
reset role;
select is(
  (select count(*)::int from dominio.comprobante_documentos
    where comprobante_id = 'b0000000-0000-0000-0000-000000000002' and tipo_documento = 'presupuesto' and estado = 'generado'),
  1, 'el PDF viejo se conserva como historial'
);

-- ============================================================================
-- Enviar por correo: permiso, cliente sin correo (FR-027)
-- ============================================================================

select pg_temp.como('f1000000-0000-0000-0000-000000000003');
select throws_ok(
  $$ select public.enviar_presupuesto_correo('b0000000-0000-0000-0000-000000000001') $$,
  '42501', null, 'ventas en lectura imprime pero no envía por correo (FR-027, FR-028)'
);

select pg_temp.como('f1000000-0000-0000-0000-000000000004');
select throws_ok(
  $$ select public.enviar_presupuesto_correo('b0000000-0000-0000-0000-000000000001') $$,
  '42501', null, 'ventas en ninguno no envía'
);

reset role;
set local role anon;
select throws_ok(
  $$ select public.enviar_presupuesto_correo('b0000000-0000-0000-0000-000000000001') $$,
  '42501', null, 'anon no puede enviar presupuestos'
);
select throws_ok(
  $$ select public.listar_envios_correo_presupuesto('b0000000-0000-0000-0000-000000000001') $$,
  '42501', null, 'anon no puede listar envíos'
);
reset role;

select pg_temp.como('f1000000-0000-0000-0000-000000000002');
select throws_ok(
  $$ select public.enviar_presupuesto_correo('b0000000-0000-0000-0000-000000000005') $$,
  '22023', null, 'un cliente sin correo (Consumidor final) se rechaza con un mensaje claro'
);
select throws_ok(
  $$ select public.enviar_presupuesto_correo('b0000000-0000-0000-0000-000000000006') $$,
  '22023', null, 'un correo mal formado se rechaza'
);
select throws_ok(
  $$ select public.enviar_presupuesto_correo('b0000000-0000-0000-0000-000000000004') $$,
  '22023', null, 'un presupuesto convertido no se envía'
);
select throws_ok(
  $$ select public.enviar_presupuesto_correo('b0000000-0000-0000-0000-000000000009') $$,
  '22023', null, 'una factura no se envía como presupuesto'
);
select throws_ok(
  $$ select public.enviar_presupuesto_correo('b0000000-0000-0000-0000-000000000007') $$,
  '42501', null, 'el operador no envía el presupuesto de una tienda donde no tiene ventas (aislamiento)'
);
select throws_ok(
  $$ select public.enviar_presupuesto_correo('b0000000-0000-0000-0000-000000000008') $$,
  'P0002', null, 'el presupuesto de otra organización no existe para esta sesión'
);
reset role;
select is(
  (select count(*)::int from dominio.comprobante_envios_correo), 0,
  'los rechazos no crean ningún envío'
);

-- ============================================================================
-- Envío, idempotencia y despacho (FR-023, FR-027)
-- ============================================================================

select pg_temp.como('f1000000-0000-0000-0000-000000000002');
select is(
  (select row(estado, destinatario, comprobante_id, empresa_id, organizacion_id, solicitado_por)::text
     from public.enviar_presupuesto_correo('b0000000-0000-0000-0000-000000000001')),
  '(pendiente,cliente.uno@example.com,b0000000-0000-0000-0000-000000000001,a1000000-0000-0000-0000-000000000001,11111111-1111-1111-1111-111111111111,f1000000-0000-0000-0000-000000000002)',
  'el envío queda pendiente hacia el correo del cliente; organización y actor salen de la sesión'
);
select is(
  (select (public.enviar_presupuesto_correo('b0000000-0000-0000-0000-000000000001')).id),
  (select id from dominio.comprobante_envios_correo where comprobante_id = 'b0000000-0000-0000-0000-000000000001'),
  'pedir el envío dos veces devuelve el mismo envío pendiente (idempotente)'
);
reset role;
select is(
  (select count(*)::int from dominio.comprobante_envios_correo where comprobante_id = 'b0000000-0000-0000-0000-000000000001'),
  1, 'no puede haber dos envíos pendientes del mismo presupuesto (FR-023)'
);
select throws_ok(
  $$ insert into dominio.comprobante_envios_correo (organizacion_id, empresa_id, comprobante_id, documento_id, destinatario)
     select organizacion_id, empresa_id, comprobante_id, documento_id, destinatario from dominio.comprobante_envios_correo
     where comprobante_id = 'b0000000-0000-0000-0000-000000000001' $$,
  '23505', null, 'el índice único impide un segundo pendiente aun escribiendo directo'
);
select is(
  (select count(*)::int from public.despachos_ejecucion d
    join public.ejecuciones_worker e on e.id = d.ejecucion_id
    join public.capacidades_ejecucion c on c.id = e.capacidad_id
   where c.clave like 'enviar-presupuesto-correo-%' and d.estado = 'pendiente'),
  1, 'el envío deja su orden en la outbox con el prefijo que reclama el flow'
);
select is(
  (select documento_id from dominio.comprobante_envios_correo where comprobante_id = 'b0000000-0000-0000-0000-000000000001'),
  (select id from dominio.comprobante_documentos where comprobante_id = 'b0000000-0000-0000-0000-000000000001' and tipo_documento = 'presupuesto'),
  'el envío pide (o reutiliza) el PDF del presupuesto para adjuntarlo'
);

-- Datos para el flow: PDF todavía pendiente.
select is(
  (select private.datos_envio_correo(id)->>'estado_documento' from dominio.comprobante_envios_correo
    where comprobante_id = 'b0000000-0000-0000-0000-000000000001'),
  'pendiente', 'mientras el PDF no está, el flow ve el documento pendiente'
);
select is(
  (select private.datos_envio_correo(id)->>'destinatario' from dominio.comprobante_envios_correo
    where comprobante_id = 'b0000000-0000-0000-0000-000000000001'),
  'cliente.uno@example.com', 'el flow recibe el destinatario'
);

-- Cierre exitoso (FR-029).
select lives_ok(
  $$ select private.cerrar_envio_correo(id, null) from dominio.comprobante_envios_correo
      where comprobante_id = 'b0000000-0000-0000-0000-000000000001' $$,
  'el flow cierra el envío como enviado'
);
select is(
  (select row(estado, error is null, enviado_en is not null)::text from dominio.comprobante_envios_correo
    where comprobante_id = 'b0000000-0000-0000-0000-000000000001'),
  '(enviado,t,t)', 'el envío queda enviado con fecha'
);
select is(
  (select count(*)::int from public.registro_actividad
    where tipo = 'presupuesto.enviado_por_correo' and empresa_id = 'a1000000-0000-0000-0000-000000000001'
      and actor_id = 'f1000000-0000-0000-0000-000000000002'
      and detalle = 'Envió por correo el presupuesto P-0001 a cliente.uno@example.com'),
  1, 'el envío registra presupuesto.enviado_por_correo con quién lo pidió (FR-029)'
);
select lives_ok(
  $$ select private.cerrar_envio_correo(id, 'otro') from dominio.comprobante_envios_correo
      where comprobante_id = 'b0000000-0000-0000-0000-000000000001' $$,
  'un segundo cierre no falla'
);
select is(
  (select estado from dominio.comprobante_envios_correo where comprobante_id = 'b0000000-0000-0000-0000-000000000001'),
  'enviado', 'un segundo cierre no cambia un envío ya cerrado (idempotente)'
);
select is(
  (select count(*)::int from public.registro_actividad where tipo like 'presupuesto.%'),
  1, 'el segundo cierre no duplica el evento'
);

-- Tras un envío cerrado se puede enviar de nuevo (otro envío).
select pg_temp.como('f1000000-0000-0000-0000-000000000002');
select is(
  (select estado from public.enviar_presupuesto_correo('b0000000-0000-0000-0000-000000000001')),
  'pendiente', 'un presupuesto ya enviado puede enviarse otra vez'
);
reset role;

-- Cierre con error: se sanitiza y deja presupuesto.envio_fallido (FR-029).
select lives_ok(
  $$ select private.cerrar_envio_correo(id, 'SMTP rechazó: password=hunter2 en smtp.interno') from dominio.comprobante_envios_correo
      where comprobante_id = 'b0000000-0000-0000-0000-000000000001' and estado = 'pendiente' $$,
  'el flow cierra un envío como fallido'
);
select is(
  (select error from dominio.comprobante_envios_correo
    where comprobante_id = 'b0000000-0000-0000-0000-000000000001' and estado = 'fallido'),
  'No se pudo enviar el correo', 'un motivo con forma de secreto no se guarda'
);
select is(
  (select count(*)::int from public.registro_actividad where tipo = 'presupuesto.envio_fallido' and empresa_id = 'a1000000-0000-0000-0000-000000000001'),
  1, 'el fallo registra presupuesto.envio_fallido (FR-029)'
);

-- ============================================================================
-- Listado y aislamiento (FR-023, FR-026)
-- ============================================================================

select pg_temp.como('f1000000-0000-0000-0000-000000000003');
select is(
  (select count(*)::int from public.listar_envios_correo_presupuesto('b0000000-0000-0000-0000-000000000001')),
  2, 'lectura ve los envíos del presupuesto (para la marca «enviado por correo»)'
);
select is(
  (select count(*)::int from dominio.comprobante_envios_correo), 2,
  'lectura lee la tabla acotada por RLS'
);
select throws_ok(
  $$ select public.listar_envios_correo_presupuesto('b0000000-0000-0000-0000-000000000007') $$,
  '42501', null, 'el presupuesto de una tienda sin ventas se rechaza al listar'
);

select pg_temp.como('f1000000-0000-0000-0000-000000000004');
select is(
  (select count(*)::int from dominio.comprobante_envios_correo), 0,
  'ventas en ninguno no lee envíos (RLS)'
);

select pg_temp.como('f2000000-0000-0000-0000-000000000001');
select is(
  (select count(*)::int from dominio.comprobante_envios_correo), 0,
  'la otra organización no ve envíos ajenos (RLS por organización)'
);
select throws_ok(
  $$ select public.listar_envios_correo_presupuesto('b0000000-0000-0000-0000-000000000001') $$,
  'P0002', null, 'la otra organización no lista envíos ajenos'
);
select throws_ok(
  $$ select public.enviar_presupuesto_correo('b0000000-0000-0000-0000-000000000008') $$,
  'P0001', null, 'una organización sin conexión comprobantes-pdf recibe un error claro'
);

select pg_temp.como('f1000000-0000-0000-0000-000000000001');
select throws_ok(
  $$ update dominio.comprobante_envios_correo set estado = 'enviado' $$,
  '42501', null, 'ni el administrador escribe envíos directo (sin privilegio)'
);

select * from finish();
rollback;
