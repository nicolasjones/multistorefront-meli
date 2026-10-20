-- F-SVC-01 (MSF-254, épica MSF-182): modelos de equipo y estados de reparación configurables.
-- Cubre SC-001: aislamiento entre dos organizaciones, escritura con `edicion`, lectura con `lectura`,
-- `ninguno` y `anon` sin acceso, sembrado idempotente (organización nueva y relleno), unicidad sin
-- distinguir mayúsculas ni tildes, reorden atómico, bloqueo optimista, sin `delete`, columnas
-- protegidas (`cierra`, `organizacion_id`) y eventos de actividad sin duplicar ante un no-op.
-- Matriz vigente de `service_tecnico`: administrador y operador `edicion`; consulta, mostrador y
-- administración `lectura`; depósito `ninguno`.
begin;

select no_plan();

insert into organizaciones (id, nombre) values
  ('11111111-1111-1111-1111-111111111111', 'Organización Uno'),
  ('22222222-2222-2222-2222-222222222222', 'Organización Dos');

insert into auth.users (id, email) values
  ('e1000000-0000-0000-0000-000000000001', 'administrador@example.com'),
  ('e1000000-0000-0000-0000-000000000002', 'operador@example.com'),
  ('e1000000-0000-0000-0000-000000000003', 'consulta@example.com'),
  ('e1000000-0000-0000-0000-000000000004', 'mostrador@example.com'),
  ('e1000000-0000-0000-0000-000000000005', 'deposito@example.com'),
  ('e1000000-0000-0000-0000-000000000006', 'administracion@example.com'),
  ('e2000000-0000-0000-0000-000000000001', 'admin-dos@example.com');

insert into usuarios_organizacion (user_id, organizacion_id, rol_id) values
  ('e1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'administrador'),
  ('e1000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'operador'),
  ('e1000000-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111', 'consulta'),
  ('e1000000-0000-0000-0000-000000000004', '11111111-1111-1111-1111-111111111111', 'mostrador'),
  ('e1000000-0000-0000-0000-000000000005', '11111111-1111-1111-1111-111111111111', 'deposito'),
  ('e1000000-0000-0000-0000-000000000006', '11111111-1111-1111-1111-111111111111', 'administracion'),
  ('e2000000-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', 'administrador');

create function pg_temp.como(p_user uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
  set local role authenticated;
end $$;

-- Ids de la organización Dos, para probar que la Uno no los alcanza.
create temp table ajenos as
  select (select id from dominio.modelos_equipo where organizacion_id = '22222222-2222-2222-2222-222222222222' limit 1) as modelo_id,
         (select id from dominio.estados_reparacion where organizacion_id = '22222222-2222-2222-2222-222222222222' limit 1) as estado_id;
grant select on ajenos to public;

-- ============================================================================
-- Sembrado (FR-003): organización nueva por disparador, idempotente y relleno
-- ============================================================================

select is(
  (select count(*) from dominio.modelos_equipo where organizacion_id = '11111111-1111-1111-1111-111111111111')::int,
  7, 'una organización nueva recibe los siete modelos'
);
select is(
  (select count(*) from dominio.estados_reparacion where organizacion_id = '11111111-1111-1111-1111-111111111111')::int,
  7, 'una organización nueva recibe los siete estados'
);
select is(
  (select count(*) from dominio.modelos_equipo where organizacion_id = '22222222-2222-2222-2222-222222222222')::int,
  7, 'cada organización tiene su propio juego de modelos'
);
select is(
  (select array_agg(nombre order by orden) from dominio.estados_reparacion
    where organizacion_id = '11111111-1111-1111-1111-111111111111' and cierra),
  array['Entregado', 'Sin reparación'],
  '«Entregado» y «Sin reparación» cierran la reparación'
);
select is(
  (select array_agg(nombre order by orden) from dominio.estados_reparacion
    where organizacion_id = '11111111-1111-1111-1111-111111111111' and avisa_cliente),
  array['Recibido', 'Esperando repuesto', 'Listo para entregar', 'Sin reparación'],
  'avisan al cliente: Recibido, Esperando repuesto, Listo para entregar y Sin reparación'
);
select is(
  (select array_agg(nombre order by orden) from dominio.estados_reparacion
    where organizacion_id = '11111111-1111-1111-1111-111111111111'),
  array['Recibido', 'En diagnóstico', 'Esperando repuesto', 'En reparación', 'Listo para entregar', 'Entregado', 'Sin reparación'],
  'los estados nacen en el orden del prototipo'
);

update dominio.modelos_equipo set mano_obra_base = 1
 where organizacion_id = '11111111-1111-1111-1111-111111111111' and equipo = 'Joystick' and modelo = 'Pro Controller';
update dominio.estados_reparacion set descripcion = 'Texto propio'
 where organizacion_id = '11111111-1111-1111-1111-111111111111' and nombre = 'Recibido';

select lives_ok(
  $$select private.sembrar_service('11111111-1111-1111-1111-111111111111')$$,
  'volver a sembrar no falla'
);
select is(
  (select count(*) from dominio.modelos_equipo where organizacion_id = '11111111-1111-1111-1111-111111111111')::int,
  7, 'el sembrado repetido no duplica modelos'
);
select is(
  (select count(*) from dominio.estados_reparacion where organizacion_id = '11111111-1111-1111-1111-111111111111')::int,
  7, 'el sembrado repetido no duplica estados'
);
select is(
  (select mano_obra_base from dominio.modelos_equipo
    where organizacion_id = '11111111-1111-1111-1111-111111111111' and modelo = 'Pro Controller'),
  1.00::numeric, 'el sembrado repetido no pisa lo que la organización editó (modelo)'
);
select is(
  (select descripcion from dominio.estados_reparacion
    where organizacion_id = '11111111-1111-1111-1111-111111111111' and nombre = 'Recibido'),
  'Texto propio', 'el sembrado repetido no pisa lo que la organización editó (estado)'
);

-- Relleno: una organización que perdió sus filas las recupera.
delete from dominio.modelos_equipo where organizacion_id = '11111111-1111-1111-1111-111111111111' and equipo = 'Nintendo Switch';
select private.sembrar_service('11111111-1111-1111-1111-111111111111');
select is(
  (select count(*) from dominio.modelos_equipo where organizacion_id = '11111111-1111-1111-1111-111111111111')::int,
  7, 'el relleno recupera los modelos que faltaban'
);

-- ============================================================================
-- Esquema, RLS y privilegios
-- ============================================================================

select is(
  (select bool_and(c.relrowsecurity) from pg_class c
    where c.oid in ('dominio.modelos_equipo'::regclass, 'dominio.estados_reparacion'::regclass)),
  true, 'RLS activa en las dos tablas (viven en dominio)'
);
select is(
  (select count(*) from unnest(array[
    'public.crear_modelo_equipo(text,text,numeric)',
    'public.actualizar_modelo_equipo(uuid,timestamptz,text,text,numeric)',
    'public.cambiar_estado_modelo_equipo(uuid,boolean)',
    'public.crear_estado_reparacion(text,text,boolean)',
    'public.actualizar_estado_reparacion(uuid,timestamptz,text,text,boolean)',
    'public.mover_estado_reparacion(uuid,text)',
    'public.cambiar_estado_estado_reparacion(uuid,boolean)'
  ]) as f where has_function_privilege('anon', f::regprocedure, 'execute'))::int,
  0, 'anon no ejecuta ninguna RPC de Service técnico'
);
select is(
  (select count(*) from unnest(array[
    'public.crear_modelo_equipo(text,text,numeric)',
    'public.actualizar_modelo_equipo(uuid,timestamptz,text,text,numeric)',
    'public.cambiar_estado_modelo_equipo(uuid,boolean)',
    'public.crear_estado_reparacion(text,text,boolean)',
    'public.actualizar_estado_reparacion(uuid,timestamptz,text,text,boolean)',
    'public.mover_estado_reparacion(uuid,text)',
    'public.cambiar_estado_estado_reparacion(uuid,boolean)'
  ]) as f where has_function_privilege('authenticated', f::regprocedure, 'execute'))::int,
  7, 'authenticated ejecuta las siete RPC'
);

-- ============================================================================
-- Administrador: modelos
-- ============================================================================

select pg_temp.como('e1000000-0000-0000-0000-000000000001');

select lives_ok(
  $$select public.crear_modelo_equipo('  Nintendo Switch ', ' 2 Pro ', 30000)$$,
  'administrador: crea un modelo'
);
select is(
  (select organizacion_id from dominio.modelos_equipo where modelo = '2 Pro'),
  '11111111-1111-1111-1111-111111111111'::uuid, 'la organización sale de la sesión'
);
select is(
  (select equipo || '|' || modelo from dominio.modelos_equipo where modelo = '2 Pro'),
  'Nintendo Switch|2 Pro', 'equipo y modelo se guardan recortados'
);
select throws_ok(
  $$select public.crear_modelo_equipo('NINTENDO SWITCH', '2 pro', 1)$$,
  '23505', null, 'rechaza equipo + modelo repetidos sin distinguir mayúsculas'
);
select lives_ok(
  $$select public.crear_modelo_equipo('Cónsola Retro', 'Modelo Ñandú', 5000)$$,
  'crea un modelo con tildes'
);
select throws_ok(
  $$select public.crear_modelo_equipo('Consola Retro', 'modelo nandu', 5000)$$,
  '23505', null, 'rechaza equipo + modelo repetidos sin distinguir tildes'
);
select throws_ok(
  $$select public.crear_modelo_equipo('Otro', 'Modelo', -1)$$,
  '22023', null, 'rechaza una mano de obra negativa'
);
select throws_ok(
  $$select public.crear_modelo_equipo('   ', 'Modelo', 1)$$,
  '22023', null, 'rechaza un equipo en blanco'
);
select throws_ok(
  $$select public.crear_modelo_equipo('Otro', '  ', 1)$$,
  '22023', null, 'rechaza un modelo en blanco'
);
select throws_ok(
  $$insert into dominio.modelos_equipo (organizacion_id, equipo, modelo)
    values ('22222222-2222-2222-2222-222222222222', 'Ajeno', 'Ajeno')$$,
  '42501', null, 'el llamador no puede fijar organizacion_id'
);
select throws_ok(
  $$delete from dominio.modelos_equipo where modelo = '2 Pro'$$,
  '42501', null, 'no se puede borrar un modelo'
);

select lives_ok(
  $$select public.actualizar_modelo_equipo(
      (select id from dominio.modelos_equipo where modelo = '2 Pro'),
      (select updated_at from dominio.modelos_equipo where modelo = '2 Pro'),
      'Nintendo Switch', '2 Pro', 31000)$$,
  'administrador: edita un modelo con el updated_at que leyó'
);
select is(
  (select mano_obra_base from dominio.modelos_equipo where modelo = '2 Pro'),
  31000.00::numeric, 'la edición queda guardada'
);
select throws_ok(
  $$select public.actualizar_modelo_equipo(
      (select id from dominio.modelos_equipo where modelo = '2 Pro'),
      '2000-01-01'::timestamptz, 'Nintendo Switch', '2 Pro', 1)$$,
  '40001', null, 'bloqueo optimista: un updated_at viejo se rechaza'
);
select is(
  (select mano_obra_base from dominio.modelos_equipo where modelo = '2 Pro'),
  31000.00::numeric, 'el conflicto no pisa la edición vigente'
);
select throws_ok(
  $$select public.actualizar_modelo_equipo(
      (select modelo_id from ajenos), now(), 'X', 'X', 1)$$,
  'P0002', null, 'no alcanza un modelo de otra organización'
);

select lives_ok(
  $$select public.cambiar_estado_modelo_equipo((select id from dominio.modelos_equipo where modelo = '2 Pro'), false)$$,
  'administrador: desactiva un modelo'
);
select is(
  (select activo from dominio.modelos_equipo where modelo = '2 Pro'),
  false, 'queda inactivo y conserva sus datos'
);
select lives_ok(
  $$select public.cambiar_estado_modelo_equipo((select id from dominio.modelos_equipo where modelo = '2 Pro'), false)$$,
  'desactivar de nuevo es idempotente'
);
select throws_ok(
  $$select public.crear_modelo_equipo('Nintendo Switch', '2 Pro', 1)$$,
  '23505', null, 'el modelo desactivado sigue ocupando su equipo + modelo'
);

select is(
  (select count(*) from public.registro_actividad where tipo = 'modelo.creado')::int,
  2, 'actividad: un evento por cada modelo creado'
);
select is(
  (select count(*) from public.registro_actividad where tipo = 'modelo.editado')::int,
  1, 'actividad: un evento por la edición (el conflicto no registra nada)'
);
select is(
  (select count(*) from public.registro_actividad where tipo = 'modelo.desactivado')::int,
  1, 'actividad: la desactivación repetida no duplica el evento'
);

-- ============================================================================
-- Administrador: estados
-- ============================================================================

select lives_ok(
  $$select public.crear_estado_reparacion('  Presupuesto aprobado ', 'El cliente aceptó el presupuesto', true)$$,
  'administrador: crea un estado'
);
select is(
  (select orden from dominio.estados_reparacion where nombre = 'Presupuesto aprobado'),
  8, 'el estado nuevo queda al final del orden'
);
select is(
  (select avisa_cliente from dominio.estados_reparacion where nombre = 'Presupuesto aprobado'),
  true, 'avisa_cliente se guarda'
);
select is(
  (select cierra from dominio.estados_reparacion where nombre = 'Presupuesto aprobado'),
  false, 'un estado creado desde la pantalla no cierra la reparación'
);
select throws_ok(
  $$select public.crear_estado_reparacion('PRESUPUESTO APROBADO')$$,
  '23505', null, 'rechaza un nombre repetido sin distinguir mayúsculas'
);
select throws_ok(
  $$select public.crear_estado_reparacion('   ')$$,
  '22023', null, 'rechaza un nombre en blanco'
);
select throws_ok(
  $$update dominio.estados_reparacion set cierra = true where nombre = 'Recibido'$$,
  '42501', null, 'cierra no se puede cambiar desde la API'
);
select throws_ok(
  $$delete from dominio.estados_reparacion where nombre = 'Presupuesto aprobado'$$,
  '42501', null, 'no se puede borrar un estado'
);

-- Reorden atómico: el nuevo (8) sube y «Sin reparación» (7) baja, sin repetir ni saltear orden.
select lives_ok(
  $$select public.mover_estado_reparacion((select id from dominio.estados_reparacion where nombre = 'Presupuesto aprobado'), 'subir')$$,
  'administrador: sube un estado'
);
select is(
  (select orden from dominio.estados_reparacion where nombre = 'Presupuesto aprobado'),
  7, 'el estado subido toma el lugar del vecino'
);
select is(
  (select orden from dominio.estados_reparacion where nombre = 'Sin reparación'),
  8, 'el vecino ocupa el lugar del estado subido (intercambio)'
);
select is(
  (select count(distinct orden) from dominio.estados_reparacion),
  (select count(*) from dominio.estados_reparacion),
  'el orden no se repite tras el intercambio'
);
select lives_ok(
  $$select public.mover_estado_reparacion((select id from dominio.estados_reparacion where nombre = 'Recibido'), 'subir')$$,
  'subir el primero no falla'
);
select is(
  (select orden from dominio.estados_reparacion where nombre = 'Recibido'),
  1, 'subir el primero no lo mueve'
);
select lives_ok(
  $$select public.mover_estado_reparacion((select id from dominio.estados_reparacion where nombre = 'Sin reparación'), 'bajar')$$,
  'bajar el último no falla'
);
select is(
  (select orden from dominio.estados_reparacion where nombre = 'Sin reparación'),
  8, 'bajar el último no lo mueve'
);
select throws_ok(
  $$select public.mover_estado_reparacion((select id from dominio.estados_reparacion where nombre = 'Recibido'), 'lado')$$,
  '22023', null, 'rechaza una dirección inválida'
);
select throws_ok(
  $$select public.mover_estado_reparacion((select estado_id from ajenos), 'subir')$$,
  'P0002', null, 'no mueve un estado de otra organización'
);
select is(
  (select count(*) from public.registro_actividad where tipo = 'estado.reordenado')::int,
  2, 'actividad: el intercambio registra un evento por cada estado movido y los no-op ninguno'
);

select lives_ok(
  $$select public.actualizar_estado_reparacion(
      (select id from dominio.estados_reparacion where nombre = 'Presupuesto aprobado'),
      (select updated_at from dominio.estados_reparacion where nombre = 'Presupuesto aprobado'),
      'Presupuesto aceptado', 'El cliente dijo que sí', false)$$,
  'administrador: edita un estado'
);
select is(
  (select avisa_cliente from dominio.estados_reparacion where nombre = 'Presupuesto aceptado'),
  false, 'la edición queda guardada'
);
select throws_ok(
  $$select public.actualizar_estado_reparacion(
      (select id from dominio.estados_reparacion where nombre = 'Presupuesto aceptado'),
      '2000-01-01'::timestamptz, 'Otro', '', false)$$,
  '40001', null, 'bloqueo optimista: un updated_at viejo se rechaza'
);
select lives_ok(
  $$select public.cambiar_estado_estado_reparacion((select id from dominio.estados_reparacion where nombre = 'Presupuesto aceptado'), false)$$,
  'administrador: desactiva un estado'
);
select lives_ok(
  $$select public.cambiar_estado_estado_reparacion((select id from dominio.estados_reparacion where nombre = 'Presupuesto aceptado'), false)$$,
  'desactivar de nuevo es idempotente'
);
select is(
  (select count(*) from public.registro_actividad where tipo = 'estado.desactivado')::int,
  1, 'actividad: la desactivación repetida no duplica el evento'
);
select is(
  (select count(*) from public.registro_actividad where tipo in ('estado.creado', 'estado.editado'))::int,
  2, 'actividad: un evento por el alta y otro por la edición'
);

-- ============================================================================
-- Aislamiento entre organizaciones
-- ============================================================================

select is(
  (select count(*) from dominio.modelos_equipo where organizacion_id = '22222222-2222-2222-2222-222222222222')::int,
  0, 'la organización Uno no ve los modelos de la Dos'
);
select is(
  (select count(*) from dominio.estados_reparacion where organizacion_id = '22222222-2222-2222-2222-222222222222')::int,
  0, 'la organización Uno no ve los estados de la Dos'
);

reset role;

select pg_temp.como('e2000000-0000-0000-0000-000000000001');

select lives_ok(
  $$select public.crear_modelo_equipo('Nintendo Switch', '2 Pro', 1)$$,
  'la misma pareja equipo + modelo es válida en otra organización'
);
select is(
  (select count(*) from dominio.modelos_equipo where modelo = '2 Pro' and organizacion_id = '11111111-1111-1111-1111-111111111111')::int,
  0, 'la organización Dos no ve los modelos de la Uno'
);

reset role;

-- ============================================================================
-- Niveles: edicion (operador), lectura (consulta, mostrador, administracion), ninguno (deposito)
-- ============================================================================

select pg_temp.como('e1000000-0000-0000-0000-000000000002');
select lives_ok(
  $$select public.crear_modelo_equipo('Operador', 'Puede', 1)$$,
  'operador (edicion): crea un modelo'
);
select lives_ok(
  $$select public.crear_estado_reparacion('Estado del operador')$$,
  'operador (edicion): crea un estado'
);
reset role;

select pg_temp.como('e1000000-0000-0000-0000-000000000003');
select cmp_ok(
  (select count(*) from dominio.modelos_equipo)::int, '>', 0,
  'consulta (lectura): ve los modelos'
);
select cmp_ok(
  (select count(*) from dominio.estados_reparacion)::int, '>', 0,
  'consulta (lectura): ve los estados'
);
select throws_ok(
  $$select public.crear_modelo_equipo('Consulta', 'No puede', 1)$$,
  '42501', null, 'consulta (lectura): no crea modelos'
);
select throws_ok(
  $$select public.crear_estado_reparacion('Estado de consulta')$$,
  '42501', null, 'consulta (lectura): no crea estados'
);
select throws_ok(
  $$select public.mover_estado_reparacion((select id from dominio.estados_reparacion limit 1), 'bajar')$$,
  '42501', null, 'consulta (lectura): no reordena estados'
);
select throws_ok(
  $$select public.cambiar_estado_modelo_equipo((select id from dominio.modelos_equipo limit 1), false)$$,
  '42501', null, 'consulta (lectura): no desactiva modelos'
);
reset role;

select pg_temp.como('e1000000-0000-0000-0000-000000000004');
select cmp_ok(
  (select count(*) from dominio.modelos_equipo)::int, '>', 0,
  'mostrador (lectura): ve los modelos'
);
select throws_ok(
  $$select public.crear_modelo_equipo('Mostrador', 'No puede', 1)$$,
  '42501', null, 'mostrador (lectura): no crea modelos'
);
reset role;

select pg_temp.como('e1000000-0000-0000-0000-000000000006');
select cmp_ok(
  (select count(*) from dominio.estados_reparacion)::int, '>', 0,
  'administración (lectura): ve los estados'
);
select throws_ok(
  $$select public.crear_estado_reparacion('Administracion')$$,
  '42501', null, 'administración (lectura): no crea estados'
);
reset role;

select pg_temp.como('e1000000-0000-0000-0000-000000000005');
select is(
  (select count(*) from dominio.modelos_equipo)::int,
  0, 'depósito (ninguno): no ve los modelos'
);
select is(
  (select count(*) from dominio.estados_reparacion)::int,
  0, 'depósito (ninguno): no ve los estados'
);
select throws_ok(
  $$select public.crear_modelo_equipo('Deposito', 'No puede', 1)$$,
  '42501', null, 'depósito (ninguno): no crea modelos'
);
reset role;

-- ============================================================================
-- anon: sin acceso a las tablas
-- ============================================================================

set local role anon;
select throws_ok(
  $$select count(*) from dominio.modelos_equipo$$,
  '42501', null, 'anon no lee los modelos'
);
select throws_ok(
  $$select count(*) from dominio.estados_reparacion$$,
  '42501', null, 'anon no lee los estados'
);
reset role;

select * from finish();
rollback;
