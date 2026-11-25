-- Lote 66 (MSF-654, MSF-655): las RPC de Service técnico migradas en la octava ola (modelos de equipo, estados de reparación,
-- historial, adjuntos, comprobante y vínculos de garantía) contestan `PT404` (HTTP 404) cuando el dato no existe, es de otra
-- organización o de una tienda inaccesible y `PT412` (HTTP 412) ante un conflicto de edición, con el mismo mensaje de negocio de
-- siempre. Cada afirmación comprueba código y mensaje.
begin;

select plan(24);

insert into organizaciones (id, nombre) values
  ('11111111-1111-1111-1111-111111111111', 'Organización Uno'),
  ('22222222-2222-2222-2222-222222222222', 'Organización Dos');

insert into auth.users (id, email) values
  ('e1000000-0000-0000-0000-000000000001', 'administrador@example.com'),
  ('e1000000-0000-0000-0000-000000000002', 'operador@example.com'),
  ('e1000000-0000-0000-0000-000000000005', 'deposito@example.com'),
  ('e2000000-0000-0000-0000-000000000001', 'admin-dos@example.com');

insert into usuarios_organizacion (user_id, organizacion_id, rol_id, estado) values
  ('e1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'administrador', 'activo'),
  ('e1000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'operador', 'activo'),
  ('e1000000-0000-0000-0000-000000000005', '11111111-1111-1111-1111-111111111111', 'deposito', 'activo'),
  ('e2000000-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', 'administrador', 'activo');

insert into dominio.empresas (id, organizacion_id, nombre) values
  ('a1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'San Javucho'),
  ('a1000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'Mundo JC'),
  ('a2000000-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', 'Empresa Dos');

-- El operador solo accede a San Javucho.
insert into usuarios_empresas (user_id, empresa_id, organizacion_id, rol_id) values
  ('e1000000-0000-0000-0000-000000000002', 'a1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'operador'),
  ('e1000000-0000-0000-0000-000000000005', 'a1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'deposito');

insert into dominio.clientes (id, organizacion_id, numero, nombre, tipo) values
  ('c5000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 10, 'Distribuidora Norte', 'mayorista'),
  ('c6000000-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', 10, 'Cliente de la Dos', 'minorista');

create function pg_temp.como(p_user uuid) returns void language plpgsql as $$
begin
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
  set local role authenticated;
end $$;

create temp table datos as
  select
    (select id from dominio.modelos_equipo where organizacion_id = '11111111-1111-1111-1111-111111111111' and equipo = 'Nintendo Switch' and modelo = 'Estándar') as modelo_uno,
    (select id from dominio.estados_reparacion where organizacion_id = '11111111-1111-1111-1111-111111111111' order by orden limit 1) as estado_uno;
grant select on datos to public;
create temp table reps (clave text primary key, id uuid);
grant select, insert on reps to public;

select pg_temp.como('e1000000-0000-0000-0000-000000000001');
insert into reps (clave, id) select 'propia', (public.crear_reparacion('a1000000-0000-0000-0000-000000000001', 'c5000000-0000-0000-0000-000000000001', (select modelo_uno from datos))->>'id')::uuid;
insert into reps (clave, id) select 'otra_tienda', (public.crear_reparacion('a1000000-0000-0000-0000-000000000002', 'c5000000-0000-0000-0000-000000000001', (select modelo_uno from datos))->>'id')::uuid;


-- «No existe» y conflicto de edición con la administradora de la organización 1
select pg_temp.como('e1000000-0000-0000-0000-000000000001');
select throws_ok($$select public.actualizar_modelo_equipo('ffffffff-0000-0000-0000-000000000000', now(), 'X', 'X', 1)$$, 'PT404', 'El modelo no existe', 'actualizar_modelo_equipo: un modelo inexistente responde 404');
select throws_ok(format($$select public.actualizar_modelo_equipo(%L, '2000-01-01T00:00:00Z', 'X', 'X', 1)$$, (select modelo_uno from datos)), 'PT412', 'El modelo fue modificado por otra persona', 'actualizar_modelo_equipo: una versión vieja es un conflicto (412)');
select throws_ok($$select public.cambiar_estado_modelo_equipo('ffffffff-0000-0000-0000-000000000000', true)$$, 'PT404', 'El modelo no existe', 'cambiar_estado_modelo_equipo: un modelo inexistente responde 404');
select throws_ok($$select public.actualizar_estado_reparacion('ffffffff-0000-0000-0000-000000000000', now(), 'Otro', '', false)$$, 'PT404', 'El estado no existe', 'actualizar_estado_reparacion: un estado inexistente responde 404');
select throws_ok(format($$select public.actualizar_estado_reparacion(%L, '2000-01-01T00:00:00Z', 'Otro', '', false)$$, (select estado_uno from datos)), 'PT412', 'El estado fue modificado por otra persona', 'actualizar_estado_reparacion: una versión vieja es un conflicto (412)');
select throws_ok($$select public.cambiar_estado_estado_reparacion('ffffffff-0000-0000-0000-000000000000', true)$$, 'PT404', 'El estado no existe', 'cambiar_estado_estado_reparacion: un estado inexistente responde 404');
select throws_ok($$select public.mover_estado_reparacion('ffffffff-0000-0000-0000-000000000000', 'subir')$$, 'PT404', 'El estado no existe', 'mover_estado_reparacion: un estado inexistente responde 404');
select throws_ok($$select * from public.historial_reparacion('ffffffff-0000-0000-0000-000000000000')$$, 'PT404', 'La reparación no existe', 'historial_reparacion: una reparación inexistente responde 404');
select throws_ok($$select public.listar_adjuntos_reparacion('ffffffff-0000-0000-0000-000000000000')$$, 'PT404', 'La reparación no existe', 'listar_adjuntos_reparacion: una reparación inexistente responde 404');
select throws_ok($$select public.comprobante_de_reparacion('ffffffff-0000-0000-0000-000000000000')$$, 'PT404', 'La reparación no existe', 'comprobante_de_reparacion: una reparación inexistente responde 404');
select throws_ok($$select public.obtener_vinculos_garantia('ffffffff-0000-0000-0000-000000000000')$$, 'PT404', 'La reparación no existe', 'obtener_vinculos_garantia: una reparación inexistente responde 404');

-- El operador solo accede a San Javucho: una reparación de Mundo JC es inexistente para él
select pg_temp.como('e1000000-0000-0000-0000-000000000002');
select throws_ok(format($$select * from public.historial_reparacion(%L)$$, (select id from reps where clave = 'otra_tienda')), 'PT404', 'La reparación no existe', 'historial_reparacion: una tienda inaccesible responde 404');
select throws_ok(format($$select public.listar_adjuntos_reparacion(%L)$$, (select id from reps where clave = 'otra_tienda')), 'PT404', 'La reparación no existe', 'listar_adjuntos_reparacion: una tienda inaccesible responde 404');
select throws_ok(format($$select public.comprobante_de_reparacion(%L)$$, (select id from reps where clave = 'otra_tienda')), 'PT404', 'La reparación no existe', 'comprobante_de_reparacion: una tienda inaccesible responde 404');
select throws_ok(format($$select public.obtener_vinculos_garantia(%L)$$, (select id from reps where clave = 'otra_tienda')), 'PT404', 'La reparación no existe', 'obtener_vinculos_garantia: una tienda inaccesible responde 404');

-- Un dato de otra organización no existe para quien pregunta
select pg_temp.como('e2000000-0000-0000-0000-000000000001');
select throws_ok(format($$select public.actualizar_modelo_equipo(%L, now(), 'X', 'X', 1)$$, (select modelo_uno from datos)), 'PT404', 'El modelo no existe', 'actualizar_modelo_equipo: un modelo de otra organización recibe 404');
select throws_ok(format($$select public.cambiar_estado_modelo_equipo(%L, true)$$, (select modelo_uno from datos)), 'PT404', 'El modelo no existe', 'cambiar_estado_modelo_equipo: un modelo de otra organización recibe 404');
select throws_ok(format($$select public.actualizar_estado_reparacion(%L, now(), 'Otro', '', false)$$, (select estado_uno from datos)), 'PT404', 'El estado no existe', 'actualizar_estado_reparacion: un estado de otra organización recibe 404');
select throws_ok(format($$select public.cambiar_estado_estado_reparacion(%L, true)$$, (select estado_uno from datos)), 'PT404', 'El estado no existe', 'cambiar_estado_estado_reparacion: un estado de otra organización recibe 404');
select throws_ok(format($$select public.mover_estado_reparacion(%L, 'subir')$$, (select estado_uno from datos)), 'PT404', 'El estado no existe', 'mover_estado_reparacion: un estado de otra organización recibe 404');
select throws_ok(format($$select * from public.historial_reparacion(%L)$$, (select id from reps where clave = 'propia')), 'PT404', 'La reparación no existe', 'historial_reparacion: una reparación de otra organización recibe 404');
select throws_ok(format($$select public.listar_adjuntos_reparacion(%L)$$, (select id from reps where clave = 'propia')), 'PT404', 'La reparación no existe', 'listar_adjuntos_reparacion: una reparación de otra organización recibe 404');
select throws_ok(format($$select public.comprobante_de_reparacion(%L)$$, (select id from reps where clave = 'propia')), 'PT404', 'La reparación no existe', 'comprobante_de_reparacion: una reparación de otra organización recibe 404');
select throws_ok(format($$select public.obtener_vinculos_garantia(%L)$$, (select id from reps where clave = 'propia')), 'PT404', 'La reparación no existe', 'obtener_vinculos_garantia: una reparación de otra organización recibe 404');

select * from finish();
rollback;
