-- MSF-597 / MSF-606: `tecnico` como rol por empresa. Un Técnico asignado a una tienda opera Service técnico
-- ahí (crear_reparacion / cambiar_estado_reparacion), no en otra tienda ni en otras secciones.
begin;

select plan(13);

insert into organizaciones (id, nombre) values ('11111111-1111-1111-1111-111111111111', 'Organización Uno');

insert into auth.users (id, email) values
  ('f1000000-0000-0000-0000-000000000001', 'admin@example.com'),
  ('f1000000-0000-0000-0000-000000000002', 'tecnico@example.com');

insert into usuarios_organizacion (user_id, organizacion_id, rol_id, estado) values
  ('f1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'administrador', 'activo'),
  ('f1000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'tecnico', 'activo');

insert into dominio.empresas (id, organizacion_id, nombre) values
  ('a1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'San Javucho'),
  ('a1000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'Mundo JC');

insert into clientes (id, organizacion_id, numero, nombre, tipo) values
  ('c5000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 10, 'Cliente', 'minorista');

create function pg_temp.como(p_user uuid) returns void language plpgsql as $$
begin
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
  set local role authenticated;
end $$;

create temp table datos as
  select
    (select id from dominio.modelos_equipo where organizacion_id = '11111111-1111-1111-1111-111111111111' and equipo = 'Nintendo Switch' and modelo = 'Estándar') as modelo,
    (select id from dominio.estados_reparacion where organizacion_id = '11111111-1111-1111-1111-111111111111' and activo and not cierra and nombre <> 'Recibido' order by orden limit 1) as otro;
grant select on datos to public;
create temp table reps (id uuid);
grant select, insert on reps to public;

-- La base lo admite como rol por empresa y por RPC.
select is(
  (select pg_get_constraintdef(oid) like '%tecnico%' from pg_constraint where conname = 'usuarios_empresas_rol_por_empresa'),
  true, 'el CHECK por empresa admite tecnico'
);
select pg_temp.como('f1000000-0000-0000-0000-000000000001');
select is(
  public.asignar_empresas_usuario('f1000000-0000-0000-0000-000000000002',
    '[{"empresa_id": "a1000000-0000-0000-0000-000000000001", "rol_id": "tecnico"}]'::jsonb),
  1, 'el Administrador asigna al Técnico a una empresa'
);
select throws_ok(
  $$select public.asignar_empresas_usuario('f1000000-0000-0000-0000-000000000002',
    '[{"empresa_id": "a1000000-0000-0000-0000-000000000001", "rol_id": "administrador"}]'::jsonb)$$,
  '22023', 'Rol inválido para una empresa', 'administrador sigue sin ser rol por empresa'
);
select is(
  (select rol_id from public.usuarios_empresas where user_id = 'f1000000-0000-0000-0000-000000000002'),
  'tecnico', 'la asignación queda con rol tecnico'
);
select is(
  (select rol_id from public.registrar_invitacion('nuevo-tecnico@example.com', 'tecnico')),
  'tecnico', 'se puede invitar con rol tecnico'
);
select throws_ok(
  $$select public.registrar_invitacion('otro@example.com', 'miembro')$$,
  '22023', 'Rol inválido', 'miembro sigue sin ser invitable'
);

-- El Técnico opera en su tienda...
select pg_temp.como('f1000000-0000-0000-0000-000000000002');
select is((select count(*)::int from private.empresas_accesibles()), 1, 'el Técnico accede solo a su tienda asignada');
insert into reps (id)
select (public.crear_reparacion(
  'a1000000-0000-0000-0000-000000000001', 'c5000000-0000-0000-0000-000000000001', (select modelo from datos)
)->>'id')::uuid;
select is((select count(*)::int from reps), 1, 'crea una reparación en su tienda');
select lives_ok(
  $$select public.cambiar_estado_reparacion((select id from reps), (select otro from datos))$$,
  'cambia el estado de una reparación de su tienda'
);

-- ...y no en otra.
select throws_ok(
  $$select public.crear_reparacion('a1000000-0000-0000-0000-000000000002', 'c5000000-0000-0000-0000-000000000001', (select modelo from datos))$$,
  '42501', 'No tenés acceso a esa tienda', 'no crea reparaciones en una tienda no asignada'
);

-- Sin acceso a otras secciones.
select is(private.nivel_seccion('service_tecnico'), 'edicion', 'service_tecnico en edición');
select is(
  (select count(*)::int from unnest(array['ventas', 'consultas', 'reportes', 'usuarios_permisos', 'empresas', 'proveedores', 'rentabilidad']) s
    where private.nivel_seccion(s) <> 'ninguno'),
  0, 'ventas, consultas, reportes y administración siguen en ninguno'
);
select is(
  (select count(*)::int from unnest(array['productos', 'stock', 'clientes', 'inicio']) s where private.nivel_seccion(s) = 'edicion'),
  0, 'productos, stock, clientes e inicio quedan como máximo en lectura'
);

select * from finish();
rollback;
