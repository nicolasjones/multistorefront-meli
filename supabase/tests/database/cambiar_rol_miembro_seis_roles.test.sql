-- F-USR-01 (MSF-211): cambiar_rol_miembro acepta los 6 roles de negocio y la guarda del último
-- administrador cubre cualquier rol destino (devolución del PR #34).
begin;

select plan(8);

insert into organizaciones (id, nombre) values ('11111111-1111-1111-1111-111111111111', 'Organización Uno');

insert into auth.users (id, email) values
  ('e1000000-0000-0000-0000-000000000001', 'admin@example.com'),
  ('e1000000-0000-0000-0000-000000000002', 'persona@example.com');

insert into usuarios_organizacion (user_id, organizacion_id, rol_id) values
  ('e1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'administrador'),
  ('e1000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'miembro');

select set_config('request.jwt.claims', json_build_object('sub', 'e1000000-0000-0000-0000-000000000001', 'role', 'authenticated')::text, true);
set local role authenticated;

select lives_ok($$select cambiar_rol_miembro('e1000000-0000-0000-0000-000000000002', 'operador')$$, 'miembro → operador');
select lives_ok($$select cambiar_rol_miembro('e1000000-0000-0000-0000-000000000002', 'consulta')$$, 'operador → consulta');
select lives_ok($$select cambiar_rol_miembro('e1000000-0000-0000-0000-000000000002', 'mostrador')$$, 'consulta → mostrador');
select lives_ok($$select cambiar_rol_miembro('e1000000-0000-0000-0000-000000000002', 'deposito')$$, 'mostrador → deposito');
select lives_ok($$select cambiar_rol_miembro('e1000000-0000-0000-0000-000000000002', 'administracion')$$, 'deposito → administracion');
select is((select rol_id from usuarios_organizacion where user_id = 'e1000000-0000-0000-0000-000000000002'), 'administracion', 'el rol queda persistido');
select throws_ok($$select cambiar_rol_miembro('e1000000-0000-0000-0000-000000000002', 'propietario')$$, '22023', null, 'un rol inexistente se rechaza');

reset role;
select is((select count(*) from eventos_membresia where accion = 'rol_cambiado' and rol_nuevo = 'administracion')::int, 1, 'el cambio queda auditado');

select * from finish();
rollback;
