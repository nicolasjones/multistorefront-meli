-- MSF-293 (F-VTA-37, FR-004): reclamo de la outbox acotado por capacidad.
-- Fija que el flow del historial solo toma órdenes `importar-historial-*` y que
-- el resto de la outbox queda intacta para su propio flow. También cubre el
-- alcance técnico (solo `kestra_orquestacion`), los parámetros inválidos y la
-- recuperación de un reclamo vencido.
begin;

select plan(9);

insert into organizaciones (id, nombre) values
  ('e1111111-1111-1111-1111-111111111111', 'Organización reclamo por capacidad');

insert into auth.users (id, email) values
  ('e1000000-0000-0000-0000-000000000001', 'admin-reclamo@example.com');

insert into usuarios_organizacion (user_id, organizacion_id, rol_id) values
  ('e1000000-0000-0000-0000-000000000001', 'e1111111-1111-1111-1111-111111111111', 'administrador');

insert into sistemas_externos (id, descripcion) values
  ('sistema-reclamo-capacidad-test', 'Sistema de fixture para historial_reclamo_despachos.test.sql, sin valor de negocio');

insert into conexiones (id, organizacion_id, sistema_externo, credencial_vault_id) values
  ('e1111111-1111-1111-1111-111111111112', 'e1111111-1111-1111-1111-111111111111', 'sistema-reclamo-capacidad-test', gen_random_uuid());

insert into capacidades_ejecucion (organizacion_id, conexion_id, clave, tiempo_max_seg) values
  ('e1111111-1111-1111-1111-111111111111', 'e1111111-1111-1111-1111-111111111112', 'importar-historial-comprobantes', 600),
  ('e1111111-1111-1111-1111-111111111111', 'e1111111-1111-1111-1111-111111111112', 'reporte-programado', 600);

select ok(
  has_function_privilege(
    'kestra_orquestacion',
    'private.reclamar_despachos_capacidad(text, integer, integer)',
    'execute'
  ),
  'solo el rol técnico de Kestra puede reclamar por capacidad'
);
select ok(
  not has_function_privilege(
    'authenticated',
    'private.reclamar_despachos_capacidad(text, integer, integer)',
    'execute'
  ),
  'un usuario autenticado no puede reclamar la outbox'
);

select set_config(
  'request.jwt.claims',
  json_build_object('sub', 'e1000000-0000-0000-0000-000000000001', 'role', 'authenticated')::text,
  true
);
set local role authenticated;

select isnt(
  public.iniciar_ejecucion_worker('e1111111-1111-1111-1111-111111111112', 'importar-historial-comprobantes', 'manual', 'e1000000-0000-0000-0000-000000000001'),
  null,
  'se inicia la ejecución del historial'
);
select isnt(
  public.iniciar_ejecucion_worker('e1111111-1111-1111-1111-111111111112', 'reporte-programado', 'manual', 'e1000000-0000-0000-0000-000000000001'),
  null,
  'se inicia una ejecución de otra capacidad'
);
reset role;

select throws_ok(
  $$select * from private.reclamar_despachos_capacidad('', 10, 60)$$,
  'P0001', 'PREFIJO_INVALIDO: el prefijo de capacidad debe tener entre 1 y 100 caracteres',
  'un prefijo vacío no reclama nada'
);
select throws_ok(
  $$select * from private.reclamar_despachos_capacidad('importar-historial-', 0, 60)$$,
  'P0001', 'LIMITE_INVALIDO: el límite debe estar entre 1 y 100',
  'un límite inválido no reclama nada'
);
select throws_ok(
  $$select * from private.reclamar_despachos_capacidad('importar-historial-', 10, 0)$$,
  'P0001', 'DURACION_INVALIDA: la duración debe estar entre 1 y 3600 segundos',
  'una duración inválida no reclama nada'
);

select results_eq(
  $$select clave_capacidad from private.reclamar_despachos_capacidad('importar-historial-', 10, 60)$$,
  $$values ('importar-historial-comprobantes'::text)$$,
  'solo reclama la orden de la capacidad con el prefijo pedido'
);
select is(
  (select state from (select d.estado as state from public.despachos_ejecucion d
    join public.ejecuciones_worker e on e.id = d.ejecucion_id
    join public.capacidades_ejecucion c on c.id = e.capacidad_id
    where c.clave = 'reporte-programado') q),
  'pendiente',
  'la orden de otra capacidad queda pendiente para su propio flow'
);
select is(
  (select count(*)::int from private.reclamar_despachos_capacidad('importar-historial-', 10, 60)),
  0,
  'una orden ya reclamada no se vuelve a reclamar'
);

update public.despachos_ejecucion
set vence_en = clock_timestamp() - interval '1 minute'
where estado = 'reclamada';

select is(
  (select count(*)::int from private.reclamar_despachos_capacidad('importar-historial-', 10, 60)),
  1,
  'un reclamo vencido se recupera y se vuelve a reclamar'
);

select * from finish();
rollback;
