-- MSF-597 (BUG-315): el rol Técnico se asigna a tiendas por fila en usuarios_empresas (CHECK y
-- validación de asignar_empresas_usuario) y con eso opera Service técnico: crear_reparacion y
-- cambiar_estado_reparacion dejan de devolver 42501 «No tenés acceso a esa tienda».
begin;

select no_plan();

insert into organizaciones (id, nombre) values
  ('11111111-1111-1111-1111-111111111111', 'Organización Uno');

insert into auth.users (id, email) values
  ('e1000000-0000-0000-0000-000000000001', 'administrador@example.com'),
  ('e1000000-0000-0000-0000-000000000007', 'tecnico@example.com');

insert into usuarios_organizacion (user_id, organizacion_id, rol_id, estado) values
  ('e1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'administrador', 'activo'),
  ('e1000000-0000-0000-0000-000000000007', '11111111-1111-1111-1111-111111111111', 'tecnico', 'activo');

insert into dominio.empresas (id, organizacion_id, nombre) values
  ('a1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'San Javucho'),
  ('a1000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'Mundo JC');

insert into clientes (id, organizacion_id, numero, nombre, tipo) values
  ('c5000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 10, 'Distribuidora Norte', 'mayorista');

create function pg_temp.como(p_user uuid) returns void language plpgsql as $$
begin
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
  set local role authenticated;
end $$;

-- Antes de asignarle una tienda, el Técnico no accede a ninguna (comportamiento del bug).
select pg_temp.como('e1000000-0000-0000-0000-000000000007');
select throws_ok(
  $$select public.crear_reparacion('a1000000-0000-0000-0000-000000000001'::uuid,
      'c5000000-0000-0000-0000-000000000001'::uuid,
      (select id from dominio.modelos_equipo where organizacion_id = '11111111-1111-1111-1111-111111111111' limit 1))$$,
  '42501', 'No tenés acceso a esa tienda',
  'sin tienda asignada, el Técnico no opera (sigue siendo un 42501 válido)'
);

-- El Administrador le asigna la tienda con rol técnico vía asignar_empresas_usuario.
select pg_temp.como('e1000000-0000-0000-0000-000000000001');
select is(
  public.asignar_empresas_usuario('e1000000-0000-0000-0000-000000000007',
    '[{"empresa_id": "a1000000-0000-0000-0000-000000000001", "rol_id": "tecnico"}]'::jsonb),
  1, 'asignar_empresas_usuario acepta el rol técnico por tienda'
);
select is(
  (select rol_id from public.listar_empresas_usuarios()
    where user_id = 'e1000000-0000-0000-0000-000000000007'),
  'tecnico', 'la lista de Usuarios muestra el rol técnico en la tienda'
);
select throws_ok(
  $$select public.asignar_empresas_usuario('e1000000-0000-0000-0000-000000000007',
    '[{"empresa_id": "a1000000-0000-0000-0000-000000000001", "rol_id": "inexistente"}]'::jsonb)$$,
  '22023', 'Rol inválido para una empresa', 'un rol desconocido sigue rechazado'
);

-- El CHECK admite tecnico y sigue rechazando administrador.
reset role;
select lives_ok(
  $$insert into public.usuarios_empresas (user_id, empresa_id, organizacion_id, rol_id)
    values ('e1000000-0000-0000-0000-000000000007', 'a1000000-0000-0000-0000-000000000002',
            '11111111-1111-1111-1111-111111111111', 'tecnico')$$,
  'el CHECK usuarios_empresas_rol_por_empresa admite tecnico'
);
select throws_ok(
  $$update public.usuarios_empresas set rol_id = 'administrador'
    where user_id = 'e1000000-0000-0000-0000-000000000007'$$,
  '23514', null, 'el CHECK sigue rechazando administrador'
);
delete from public.usuarios_empresas
 where user_id = 'e1000000-0000-0000-0000-000000000007' and empresa_id = 'a1000000-0000-0000-0000-000000000002';

-- Con la tienda asignada, las RPC de Service ya no devuelven 42501.
select pg_temp.como('e1000000-0000-0000-0000-000000000007');
select is(
  (select count(*)::int from private.empresas_accesibles() a(id)
    where a.id = 'a1000000-0000-0000-0000-000000000001'),
  1, 'la tienda asignada es accesible para el Técnico'
);
select is(
  (select count(*)::int from private.empresas_accesibles() a(id)
    where a.id = 'a1000000-0000-0000-0000-000000000002'),
  0, 'una tienda no asignada sigue fuera de su alcance'
);
select lives_ok(
  $$select public.crear_reparacion('a1000000-0000-0000-0000-000000000001'::uuid,
      'c5000000-0000-0000-0000-000000000001'::uuid,
      (select id from dominio.modelos_equipo where organizacion_id = '11111111-1111-1111-1111-111111111111' and activo limit 1),
      'tel 1234', null, '', 'No enciende')$$,
  'crear_reparacion en la tienda asignada ya no devuelve 42501'
);
select throws_ok(
  $$select public.crear_reparacion('a1000000-0000-0000-0000-000000000002'::uuid,
      'c5000000-0000-0000-0000-000000000001'::uuid,
      (select id from dominio.modelos_equipo where organizacion_id = '11111111-1111-1111-1111-111111111111' and activo limit 1))$$,
  '42501', 'No tenés acceso a esa tienda',
  'crear_reparacion en una tienda no asignada sigue rechazada'
);

select * from finish();
rollback;
