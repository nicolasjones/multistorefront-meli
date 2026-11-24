-- MSF-985 (seguimiento de MSF-618, épica MSF-585): los eventos de contexto no ocupan la lista.
--
-- Decisión que verifica: el evento `usuario.empresa_activa_cambiada` SE SIGUE REGISTRANDO (es
-- trazabilidad de un cambio de contexto: la empresa activa decide el rol con el que la persona
-- opera en las secciones por empresa), pero no aparece en el listado ni en el CSV salvo que se
-- pida ese tipo explícitamente (filtro «Tipo»). Con varias personas alternando entre tiendas,
-- esas filas llenaban el historial de cambios que no son de negocio (MSF-618).
--
-- Corre como postgres para armar el fixture y como "authenticated" (request.jwt.claims, igual
-- que PostgREST) para verificar.
begin;

select plan(13);

-- ============================================================================
-- Fixture
-- ============================================================================

insert into organizaciones (id, nombre) values
  ('11111111-1111-1111-1111-111111111111', 'Organización Uno');

insert into auth.users (id, email) values
  ('c1000000-0000-0000-0000-000000000001', 'admin-cambio@example.com');

insert into usuarios_organizacion (user_id, organizacion_id, rol_id, estado) values
  ('c1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'administrador', 'activo');

insert into dominio.empresas (id, organizacion_id, nombre) values
  ('e1000000-0000-0000-0000-000000000101', '11111111-1111-1111-1111-111111111111', 'San Javucho'),
  ('e1000000-0000-0000-0000-000000000102', '11111111-1111-1111-1111-111111111111', 'Mundo JC');

-- Un evento de negocio, para comparar con el de contexto.
insert into registro_actividad (organizacion_id, empresa_id, actor_id, actor_nombre, tipo, detalle)
values ('11111111-1111-1111-1111-111111111111', 'e1000000-0000-0000-0000-000000000101',
  'c1000000-0000-0000-0000-000000000001', 'Admin Cambio', 'producto.creado', 'Creó el producto Cañería');

create function pg_temp.como(p_user uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
  set local role authenticated;
end $$;

-- ============================================================================
-- El evento se sigue registrando: la trazabilidad no se pierde
-- ============================================================================

select pg_temp.como('c1000000-0000-0000-0000-000000000001');
select lives_ok(
  $$select public.cambiar_empresa_activa('e1000000-0000-0000-0000-000000000101')$$,
  'cambiar de empresa activa funciona'
);
reset role;

select is(
  (select count(*)::int from registro_actividad where tipo = 'usuario.empresa_activa_cambiada'),
  1, 'el cambio de empresa activa se sigue registrando en el historial'
);
select is(
  (select empresa_id::text from registro_actividad where tipo = 'usuario.empresa_activa_cambiada'),
  'e1000000-0000-0000-0000-000000000101', 'el evento de contexto lleva la empresa elegida'
);

-- ============================================================================
-- La lista: el evento de contexto no la ocupa, salvo que se pida por tipo
-- ============================================================================

select pg_temp.como('c1000000-0000-0000-0000-000000000001');

select is(
  (select count(*)::int from public.listar_actividad()),
  1, 'la lista muestra solo el evento de negocio'
);
select is(
  (select count(*)::int from public.listar_actividad() where tipo = 'usuario.empresa_activa_cambiada'),
  0, 'la fila de cambio de empresa activa no ocupa la lista'
);
select is(
  (select total from public.listar_actividad() limit 1),
  1::bigint, 'el total de la lista tampoco cuenta la fila de contexto'
);
select is(
  (select count(*)::int from public.listar_actividad(p_tipo => 'usuario.empresa_activa_cambiada')),
  1, 'la fila de contexto se ve si se pide ese tipo'
);
select is(
  (select count(*)::int from public.listar_actividad(p_actor => 'c1000000-0000-0000-0000-000000000001', p_tipo => 'usuario.empresa_activa_cambiada')),
  1, 'la fila de contexto se sigue viendo con los demás filtros'
);
select is(
  (select count(*)::int from jsonb_array_elements(public.opciones_actividad() -> 'tipos') t where t = to_jsonb('usuario.empresa_activa_cambiada'::text)),
  1, 'el tipo de contexto sigue en las opciones del filtro «Tipo»'
);

-- ============================================================================
-- El CSV sale con las mismas filas que la pantalla (FR-013)
-- ============================================================================

select set_config('t.todo', public.exportar_actividad(p_con_total => true)::text, true);
select is((current_setting('t.todo')::jsonb ->> 'total')::int, 1, 'el CSV no incluye la fila de contexto en el total');
select is(jsonb_array_length(current_setting('t.todo')::jsonb -> 'filas'), 1, 'el CSV no incluye la fila de contexto');

select set_config('t.todo', public.exportar_actividad(p_tipo => 'usuario.empresa_activa_cambiada', p_con_total => true)::text, true);
select is((current_setting('t.todo')::jsonb ->> 'total')::int, 1, 'el CSV incluye la fila de contexto si se pide ese tipo');
select is(jsonb_array_length(current_setting('t.todo')::jsonb -> 'filas'), 1, 'el CSV trae la fila de contexto pedida');

reset role;

select * from finish();
rollback;
