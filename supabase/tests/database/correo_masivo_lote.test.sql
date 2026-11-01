-- F-CLI-12 (MSF-370, épica MSF-155, spec 20261028-100000-correo-masivo-a-clientes): envío por lotes y baja.
-- Cubre FR-016 y SC-003 (cupo diario y retoma al día siguiente), FR-018 (reclamo con vencimiento y cierre idempotente,
-- sin doble envío), FR-020 (re-verificación: archivado, sin aceptación o sin correo → omitido), FR-019/FR-022/SC-004
-- (baja: apaga la aceptación, omite los pendientes de una campaña en curso, actividad sin datos personales, idempotente)
-- y los permisos de las funciones.
-- Corre como postgres (sesión de servicio): sin reloj real, los «días» se simulan moviendo `enviado_en` un día atrás.
begin;

select plan(31);

insert into organizaciones (id, nombre) values
  ('11111111-1111-1111-1111-111111111111', 'Organización Uno'),
  ('22222222-2222-2222-2222-222222222222', 'Organización Dos');

insert into clientes (id, organizacion_id, numero, nombre, tipo, correo, acepta_correo_masivo, archivado_en) values
  ('c1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 101, 'Uno', 'minorista', 'uno@example.com', true, null),
  ('c1000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 102, 'Dos', 'minorista', 'dos@example.com', true, null),
  ('c1000000-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111', 103, 'Tres', 'minorista', 'tres@example.com', true, null),
  ('c1000000-0000-0000-0000-000000000004', '11111111-1111-1111-1111-111111111111', 104, 'Cuatro', 'minorista', 'cuatro@example.com', true, null),
  ('c1000000-0000-0000-0000-000000000005', '11111111-1111-1111-1111-111111111111', 105, 'Cinco', 'minorista', 'cinco@example.com', true, null),
  ('c2000000-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', 201, 'Ajeno', 'minorista', 'ajeno@example.com', true, null);

insert into dominio.campanas_correo (id, organizacion_id, clave, asunto, mensaje, creada_en) values
  ('ca000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'aaaaaaaa-0000-0000-0000-000000000001', 'Campaña uno', 'Cuerpo secreto de la campaña', now() - interval '2 hours'),
  ('ca000000-0000-0000-0000-000000000002', '22222222-2222-2222-2222-222222222222', 'aaaaaaaa-0000-0000-0000-000000000002', 'Campaña ajena', 'Mensaje ajeno', now() - interval '1 hour');

insert into dominio.campana_correo_destinatarios (organizacion_id, campana_id, cliente_id, correo, creado_en)
select '11111111-1111-1111-1111-111111111111', 'ca000000-0000-0000-0000-000000000001', c.id, c.correo, now() - interval '2 hours' + ((c.numero - 100) || ' seconds')::interval
  from clientes c where c.organizacion_id = '11111111-1111-1111-1111-111111111111' and c.numero between 101 and 105;
insert into dominio.campana_correo_destinatarios (organizacion_id, campana_id, cliente_id, correo)
values ('22222222-2222-2222-2222-222222222222', 'ca000000-0000-0000-0000-000000000002', 'c2000000-0000-0000-0000-000000000001', 'ajeno@example.com');

-- ============================================================================
-- FR-016 / SC-003: cupo diario por organización (lote 10, cupo 3 por organización)
-- ============================================================================

create temp table lote1 as select * from private.reclamar_lote_correo_masivo(10, 3, 900);

select is((select count(*)::int from lote1 where campana_id = 'ca000000-0000-0000-0000-000000000001'), 3, 'SC-003: el primer día sale solo el cupo de la organización');
select is((select count(*)::int from lote1 where campana_id = 'ca000000-0000-0000-0000-000000000002'), 1, 'el cupo es por organización: la otra organización también envía el suyo');
select ok(
  (select bool_and(token ~ '^[0-9a-f]{64}$' and asunto <> '' and mensaje <> '') from lote1),
  'cada fila trae asunto, mensaje y un token de 64 caracteres hexadecimales'
);
select is((select count(distinct token)::int from lote1), 4, 'cada destinatario recibe un token distinto');

select is(
  (select count(*)::int from private.reclamar_lote_correo_masivo(10, 3, 900)),
  0,
  'FR-018: con los reclamos vigentes no se entrega dos veces el mismo destinatario y el cupo no se supera'
);

-- Se cierran los tres como enviados.
select private.cerrar_envio_correo_masivo(destinatario_id, 'enviado', null) from lote1 where campana_id = 'ca000000-0000-0000-0000-000000000001';

select is(
  (select count(*)::int from dominio.campana_correo_destinatarios where estado = 'enviado' and enviado_en is not null),
  3,
  'los cerrados quedan enviados con su fecha'
);
select is(
  (select count(*)::int from private.reclamar_lote_correo_masivo(10, 3, 900)),
  0,
  'SC-003: agotado el cupo del día la campaña queda en curso y no sale nada más'
);
select is(
  (select count(*)::int from dominio.campana_correo_destinatarios where estado = 'pendiente' and organizacion_id = '11111111-1111-1111-1111-111111111111'),
  2,
  'los destinatarios que no entraron siguen pendientes (no se pierden)'
);

-- «Al día siguiente»: lo enviado ayer ya no cuenta.
update dominio.campana_correo_destinatarios set enviado_en = now() - interval '1 day' where estado = 'enviado';

create temp table lote2 as select * from private.reclamar_lote_correo_masivo(10, 3, 900);
select is((select count(*)::int from lote2), 2, 'SC-003: al día siguiente sale el resto de la campaña');
select is(
  (select count(*)::int from lote2 where correo in (select correo from lote1 where campana_id = 'ca000000-0000-0000-0000-000000000001')),
  0,
  'SC-003: sin repetidos respecto del primer día'
);
select private.cerrar_envio_correo_masivo(destinatario_id, 'enviado', null) from lote2;
select is(
  (select count(*)::int from dominio.campana_correo_destinatarios where organizacion_id = '11111111-1111-1111-1111-111111111111' and estado = 'enviado'),
  5,
  'SC-003: al terminar los cinco destinatarios se enviaron exactamente una vez'
);

-- ============================================================================
-- FR-018: reclamo con vencimiento y cierre idempotente
-- ============================================================================

insert into dominio.campanas_correo (id, organizacion_id, clave, asunto, mensaje)
values ('ca000000-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111', 'aaaaaaaa-0000-0000-0000-000000000003', 'Segunda', 'Segundo cuerpo');
insert into dominio.campana_correo_destinatarios (organizacion_id, campana_id, cliente_id, correo)
values ('11111111-1111-1111-1111-111111111111', 'ca000000-0000-0000-0000-000000000003', 'c1000000-0000-0000-0000-000000000001', 'uno@example.com');
update dominio.campana_correo_destinatarios set enviado_en = now() - interval '1 day' where estado = 'enviado';

create temp table lote3 as select * from private.reclamar_lote_correo_masivo(10, 100, 900);
select is((select count(*)::int from lote3 where campana_id = 'ca000000-0000-0000-0000-000000000003'), 1, 'se reclama el destinatario pendiente de la segunda campaña');

-- El reclamo vence (Kestra se cortó antes de cerrar): el siguiente lote lo vuelve a tomar, con otro enlace.
update dominio.campana_correo_destinatarios set reclamado_hasta = now() - interval '1 second' where id = (select destinatario_id from lote3 where campana_id = 'ca000000-0000-0000-0000-000000000003');
create temp table lote4 as select * from private.reclamar_lote_correo_masivo(10, 100, 900);
select is((select count(*)::int from lote4 where campana_id = 'ca000000-0000-0000-0000-000000000003'), 1, 'vencido el reclamo, otro lote retoma al destinatario');
select is(
  (select array_length(token_hashes, 1) from dominio.campana_correo_destinatarios where id = (select destinatario_id from lote4 where campana_id = 'ca000000-0000-0000-0000-000000000003')),
  2,
  'se conservan los hashes de los dos enlaces (el del primer correo, si salió, sigue valiendo)'
);

select private.cerrar_envio_correo_masivo((select destinatario_id from lote4 where campana_id = 'ca000000-0000-0000-0000-000000000003'), 'enviado', null);
create temp table cerrado_en as select enviado_en from dominio.campana_correo_destinatarios where id = (select destinatario_id from lote4 where campana_id = 'ca000000-0000-0000-0000-000000000003');
select private.cerrar_envio_correo_masivo((select destinatario_id from lote4 where campana_id = 'ca000000-0000-0000-0000-000000000003'), 'fallido', 'otro intento');
select is(
  (select estado from dominio.campana_correo_destinatarios where id = (select destinatario_id from lote4 where campana_id = 'ca000000-0000-0000-0000-000000000003')),
  'enviado',
  'FR-018: cerrar dos veces es idempotente: un enviado no pasa a fallido'
);
select is(
  (select enviado_en from dominio.campana_correo_destinatarios where id = (select destinatario_id from lote4 where campana_id = 'ca000000-0000-0000-0000-000000000003')),
  (select enviado_en from cerrado_en),
  'la marca de enviado no se reescribe'
);

-- ============================================================================
-- FR-017: un fallo queda con motivo corto
-- ============================================================================

insert into dominio.campanas_correo (id, organizacion_id, clave, asunto, mensaje)
values ('ca000000-0000-0000-0000-000000000004', '11111111-1111-1111-1111-111111111111', 'aaaaaaaa-0000-0000-0000-000000000004', 'Tercera', 'Tercer cuerpo');
insert into dominio.campana_correo_destinatarios (organizacion_id, campana_id, cliente_id, correo)
values ('11111111-1111-1111-1111-111111111111', 'ca000000-0000-0000-0000-000000000004', 'c1000000-0000-0000-0000-000000000002', 'dos@example.com');
update dominio.campana_correo_destinatarios set enviado_en = now() - interval '1 day' where estado = 'enviado';
create temp table lote5 as select * from private.reclamar_lote_correo_masivo(10, 100, 900);
select private.cerrar_envio_correo_masivo((select destinatario_id from lote5 where campana_id = 'ca000000-0000-0000-0000-000000000004'), 'fallido', repeat('x', 500));
select is(
  (select length(error) from dominio.campana_correo_destinatarios where campana_id = 'ca000000-0000-0000-0000-000000000004'),
  200,
  'el motivo del fallo se acota a 200 caracteres'
);

-- ============================================================================
-- FR-020: re-verificación → omitido
-- ============================================================================

insert into clientes (id, organizacion_id, numero, nombre, tipo, correo, acepta_correo_masivo, archivado_en) values
  ('c1000000-0000-0000-0000-000000000011', '11111111-1111-1111-1111-111111111111', 11, 'Se archivó', 'minorista', 'archivado@example.com', true, null),
  ('c1000000-0000-0000-0000-000000000012', '11111111-1111-1111-1111-111111111111', 12, 'Dejó de aceptar', 'minorista', 'dejo@example.com', true, null),
  ('c1000000-0000-0000-0000-000000000013', '11111111-1111-1111-1111-111111111111', 13, 'Perdió el correo', 'minorista', 'perdio@example.com', true, null),
  ('c1000000-0000-0000-0000-000000000014', '11111111-1111-1111-1111-111111111111', 14, 'Cambió de correo', 'minorista', 'viejo@example.com', true, null);
insert into dominio.campanas_correo (id, organizacion_id, clave, asunto, mensaje)
values ('ca000000-0000-0000-0000-000000000005', '11111111-1111-1111-1111-111111111111', 'aaaaaaaa-0000-0000-0000-000000000005', 'Cuarta', 'Cuarto cuerpo');
insert into dominio.campana_correo_destinatarios (organizacion_id, campana_id, cliente_id, correo)
select '11111111-1111-1111-1111-111111111111', 'ca000000-0000-0000-0000-000000000005', c.id, c.correo
  from clientes c where c.numero between 11 and 14 and c.organizacion_id = '11111111-1111-1111-1111-111111111111';
update clientes set archivado_en = now() where id = 'c1000000-0000-0000-0000-000000000011';
update clientes set acepta_correo_masivo = false where id = 'c1000000-0000-0000-0000-000000000012';
update clientes set correo = null where id = 'c1000000-0000-0000-0000-000000000013';
update clientes set correo = 'nuevo@example.com' where id = 'c1000000-0000-0000-0000-000000000014';
update dominio.campana_correo_destinatarios set enviado_en = now() - interval '1 day' where estado = 'enviado';

create temp table lote6 as select * from private.reclamar_lote_correo_masivo(10, 100, 900);
select is(
  (select array_agg(c.nombre order by c.nombre) from dominio.campana_correo_destinatarios d join clientes c on c.id = d.cliente_id
    where d.campana_id = 'ca000000-0000-0000-0000-000000000005' and d.estado = 'omitido'),
  array['Dejó de aceptar', 'Perdió el correo', 'Se archivó'],
  'FR-020: archivado, sin aceptación y sin correo quedan omitidos'
);
select is(
  (select array_agg(correo) from lote6 where campana_id = 'ca000000-0000-0000-0000-000000000005'),
  array['nuevo@example.com'],
  'FR-020: solo sale el cliente que sigue elegible, con su correo vigente'
);
select is(
  (select correo from dominio.campana_correo_destinatarios where campana_id = 'ca000000-0000-0000-0000-000000000005' and cliente_id = 'c1000000-0000-0000-0000-000000000014'),
  'nuevo@example.com',
  'el correo usado queda registrado en el destinatario'
);

-- ============================================================================
-- FR-019 / FR-022 / SC-004: baja
-- ============================================================================

-- Una campaña en curso con un pendiente del cliente Cinco, y su token (hash) de un correo anterior.
insert into dominio.campanas_correo (id, organizacion_id, clave, asunto, mensaje)
values ('ca000000-0000-0000-0000-000000000006', '11111111-1111-1111-1111-111111111111', 'aaaaaaaa-0000-0000-0000-000000000006', 'Quinta', 'Quinto cuerpo');
insert into dominio.campana_correo_destinatarios (organizacion_id, campana_id, cliente_id, correo, token_hashes)
values ('11111111-1111-1111-1111-111111111111', 'ca000000-0000-0000-0000-000000000006', 'c1000000-0000-0000-0000-000000000005', 'cinco@example.com',
        array[encode(sha256(convert_to('token-de-ejemplo', 'utf8')), 'hex')]);

select is(
  public.dar_de_baja_correo_masivo(encode(sha256(convert_to('token-de-ejemplo', 'utf8')), 'hex')),
  true,
  'la baja con un token válido responde true'
);
select is(
  (select acepta_correo_masivo from clientes where id = 'c1000000-0000-0000-0000-000000000005'),
  false,
  'FR-019: la baja pone acepta_correo_masivo en false'
);
select is(
  (select estado from dominio.campana_correo_destinatarios where campana_id = 'ca000000-0000-0000-0000-000000000006'),
  'omitido',
  'SC-004: el pendiente de una campaña en curso queda omitido'
);
select is(
  public.dar_de_baja_correo_masivo(encode(sha256(convert_to('token-de-ejemplo', 'utf8')), 'hex')),
  true,
  'FR-019: repetir la baja es idempotente'
);
select is(
  (select count(*)::int from public.registro_actividad where tipo = 'campana_correo.baja'),
  1,
  'FR-022: la baja registra actividad una sola vez'
);
select ok(
  not exists (select 1 from public.registro_actividad where tipo = 'campana_correo.baja' and (detalle like '%@%' or detalle like '%Cinco%')),
  'FR-022: la actividad de baja no lleva correos ni nombres'
);
select is(public.dar_de_baja_correo_masivo(encode(sha256(convert_to('no-existe', 'utf8')), 'hex')), false, 'un token desconocido devuelve false (la Edge Function responde igual)');
select is(public.dar_de_baja_correo_masivo('no-es-un-hash'), false, 'un valor que no es un hash devuelve false');

-- ============================================================================
-- FR-014: las pruebas salen primero y no cuentan contra el cupo
-- ============================================================================

insert into dominio.correo_masivo_pruebas (organizacion_id, correo, asunto, mensaje)
values ('11111111-1111-1111-1111-111111111111', 'autor@example.com', 'Prueba', 'Cuerpo de prueba');
create temp table lote7 as select * from private.reclamar_lote_correo_masivo(10, 0, 900);
select is(
  (select count(*)::int from lote7 where campana_id is null and token is null and correo = 'autor@example.com'),
  1,
  'FR-014: la prueba se reclama aun con cupo cero (no cuenta contra el límite diario) y sin enlace real'
);

-- ============================================================================
-- Permisos
-- ============================================================================

select ok(
  not has_function_privilege('anon', 'private.reclamar_lote_correo_masivo(integer, integer, integer)', 'execute')
  and not has_function_privilege('authenticated', 'private.reclamar_lote_correo_masivo(integer, integer, integer)', 'execute')
  and not has_function_privilege('authenticated', 'private.cerrar_envio_correo_masivo(uuid, text, text)', 'execute')
  and not has_function_privilege('anon', 'public.dar_de_baja_correo_masivo(text)', 'execute')
  and not has_function_privilege('authenticated', 'public.dar_de_baja_correo_masivo(text)', 'execute')
  and has_function_privilege('service_role', 'public.dar_de_baja_correo_masivo(text)', 'execute'),
  'anon y authenticated no ejecutan el flow ni la baja; la baja la ejecuta service_role'
);
select ok(
  not exists (select 1 from pg_catalog.pg_roles where rolname = 'kestra_orquestacion')
  or (has_function_privilege('kestra_orquestacion', 'private.reclamar_lote_correo_masivo(integer, integer, integer)', 'execute')
      and has_function_privilege('kestra_orquestacion', 'private.cerrar_envio_correo_masivo(uuid, text, text)', 'execute')),
  'kestra_orquestacion ejecuta el reclamo y el cierre'
);

select * from finish();
rollback;
