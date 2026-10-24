-- F-CLI-05 (MSF-422, épica MSF-237): cuenta web del cliente. Cubre FR-001, FR-005, FR-006, FR-008 y SC-002:
-- tabla con RLS y única (cliente, tienda), disparador de misma organización, permisos de las RPC (sin edición
-- o sin alcance sobre la tienda => 42501 y sin cambios), idempotencia de vincular/cambiar estado, privilegios de
-- `anon`, y una sesión de cuenta web que no lee ni escribe nada del panel.
-- El fixture corre como postgres (RLS no aplica) y las verificaciones como `authenticated` / `service_role`
-- vía request.jwt.claims, igual que PostgREST.
begin;

select plan(40);

insert into organizaciones (id, nombre) values
  ('11111111-1111-1111-1111-111111111111', 'Organización Uno'),
  ('22222222-2222-2222-2222-222222222222', 'Organización Dos');

insert into auth.users (id, email) values
  ('f1000000-0000-0000-0000-000000000001', 'admin-uno@example.com'),
  ('f1000000-0000-0000-0000-000000000002', 'operador-uno@example.com'),
  ('f1000000-0000-0000-0000-000000000003', 'consulta-uno@example.com'),
  ('f1000000-0000-0000-0000-0000000000a1', 'cliente-uno@example.com'),
  ('f1000000-0000-0000-0000-0000000000a2', 'cliente-dos@example.com');

insert into usuarios_organizacion (user_id, organizacion_id, rol_id, estado) values
  ('f1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'administrador', 'activo'),
  ('f1000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'operador', 'activo'),
  ('f1000000-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111', 'consulta', 'activo');

insert into dominio.empresas (id, organizacion_id, nombre) values
  ('a1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'San Javucho'),
  ('a1000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'Mundo JC'),
  ('a2000000-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', 'Empresa Dos');

-- El operador solo tiene alcance sobre Mundo JC.
insert into usuarios_empresas (user_id, empresa_id, organizacion_id, rol_id) values
  ('f1000000-0000-0000-0000-000000000002', 'a1000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'operador');

insert into dominio.tiendas (organizacion_id, empresa_id, dominio) values
  ('11111111-1111-1111-1111-111111111111', 'a1000000-0000-0000-0000-000000000001', 'sanjavucho.ejemplo.com'),
  ('11111111-1111-1111-1111-111111111111', 'a1000000-0000-0000-0000-000000000002', 'mundojc.ejemplo.com');

insert into clientes (id, organizacion_id, numero, nombre, correo, tipo) values
  ('c5000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 10, 'Distribuidora Norte', 'norte@example.com', 'mayorista'),
  ('c5000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 11, 'Cliente sin correo', null, 'minorista'),
  ('c5000000-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111', 12, 'Cliente sin tiendas', 'sin@example.com', 'minorista'),
  ('c5000000-0000-0000-0000-000000000004', '11111111-1111-1111-1111-111111111111', 13, 'Otro cliente', 'otro@example.com', 'minorista'),
  ('c6000000-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', 10, 'Cliente de la Dos', 'dos@example.com', 'minorista');

insert into clientes_empresas (cliente_id, empresa_id, organizacion_id) values
  ('c5000000-0000-0000-0000-000000000001', 'a1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111'),
  ('c5000000-0000-0000-0000-000000000001', 'a1000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111'),
  ('c5000000-0000-0000-0000-000000000002', 'a1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111'),
  ('c5000000-0000-0000-0000-000000000004', 'a1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111');

create function pg_temp.como(p_user uuid) returns void language plpgsql as $$
begin
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
  set local role authenticated;
end $$;

create function pg_temp.como_servicio() returns void language plpgsql as $$
begin
  reset role;
  perform set_config('request.jwt.claims', json_build_object('role', 'service_role')::text, true);
  set local role service_role;
end $$;

-- ============================================================================
-- FR-001: tabla, RLS, única y disparador de misma organización
-- ============================================================================

select ok(
  (select relrowsecurity from pg_class where oid = 'public.cuentas_cliente'::regclass),
  'cuentas_cliente tiene RLS activada'
);

select is(
  (select count(*)::int from pg_constraint
    where conrelid = 'public.cuentas_cliente'::regclass and contype = 'u'
      and pg_get_constraintdef(oid) = 'UNIQUE (cliente_id, empresa_id)'),
  1,
  'la cuenta es única por (cliente_id, empresa_id)'
);

select throws_ok(
  $$insert into public.cuentas_cliente (organizacion_id, cliente_id, empresa_id, auth_user_id)
    values ('11111111-1111-1111-1111-111111111111', 'c5000000-0000-0000-0000-000000000001',
            'a2000000-0000-0000-0000-000000000001', 'f1000000-0000-0000-0000-0000000000a1')$$,
  '23514', null,
  'el disparador rechaza una tienda de otra organización'
);

select throws_ok(
  $$insert into public.cuentas_cliente (organizacion_id, cliente_id, empresa_id, auth_user_id)
    values ('11111111-1111-1111-1111-111111111111', 'c6000000-0000-0000-0000-000000000001',
            'a1000000-0000-0000-0000-000000000001', 'f1000000-0000-0000-0000-0000000000a1')$$,
  '23514', null,
  'el disparador rechaza un cliente de otra organización'
);

-- anon no ejecuta ninguna función de cuenta web; vincular solo la ejecuta service_role.
select is(
  (select bool_or(has_function_privilege('anon', f, 'execute'))
     from unnest(array[
       'public.preparar_cuenta_cliente(uuid, uuid)',
       'public.vincular_cuenta_cliente(uuid, uuid, uuid, uuid)',
       'public.cambiar_estado_cuenta_cliente(uuid, uuid, text)',
       'public.cuentas_web_de_cliente(uuid)',
       'public.registrar_restablecimiento_cuenta_cliente(uuid, uuid)',
       'publico.acceso_cliente_por_dominio(text)'
     ]) as f),
  false,
  'anon no ejecuta ninguna función de cuenta web'
);

select is(
  has_function_privilege('authenticated', 'public.vincular_cuenta_cliente(uuid, uuid, uuid, uuid)', 'execute'),
  false,
  'vincular_cuenta_cliente no la ejecuta authenticated'
);

select is(
  has_function_privilege('service_role', 'public.vincular_cuenta_cliente(uuid, uuid, uuid, uuid)', 'execute'),
  true,
  'vincular_cuenta_cliente la ejecuta service_role'
);

select is(
  has_table_privilege('anon', 'public.cuentas_cliente', 'select'),
  false,
  'anon no tiene privilegios sobre cuentas_cliente'
);

-- ============================================================================
-- FR-005: permisos (administrador con edición; sin edición / sin alcance => 42501)
-- ============================================================================

select pg_temp.como('f1000000-0000-0000-0000-000000000001');

select is(
  (select correo || '|' || dominio from public.preparar_cuenta_cliente(
    'c5000000-0000-0000-0000-000000000001', 'a1000000-0000-0000-0000-000000000001')),
  'norte@example.com|sanjavucho.ejemplo.com',
  'preparar devuelve el correo del cliente y el dominio de la tienda'
);

select throws_ok(
  $$select * from public.preparar_cuenta_cliente('c5000000-0000-0000-0000-000000000002', 'a1000000-0000-0000-0000-000000000001')$$,
  '22023', null,
  'preparar rechaza un cliente sin correo'
);

select throws_ok(
  $$select * from public.preparar_cuenta_cliente('c5000000-0000-0000-0000-000000000003', 'a1000000-0000-0000-0000-000000000001')$$,
  '22023', null,
  'preparar rechaza un cliente no habilitado en la tienda'
);

select throws_ok(
  $$select * from public.preparar_cuenta_cliente('c6000000-0000-0000-0000-000000000001', 'a1000000-0000-0000-0000-000000000001')$$,
  'P0002', null,
  'preparar rechaza un cliente de otra organización'
);

select pg_temp.como('f1000000-0000-0000-0000-000000000003');

select throws_ok(
  $$select * from public.preparar_cuenta_cliente('c5000000-0000-0000-0000-000000000001', 'a1000000-0000-0000-0000-000000000001')$$,
  '42501', null,
  'sin edición de Clientes (consulta): preparar => 42501'
);

select throws_ok(
  $$select public.cambiar_estado_cuenta_cliente('c5000000-0000-0000-0000-000000000001', 'a1000000-0000-0000-0000-000000000001', 'suspendida')$$,
  '42501', null,
  'sin edición de Clientes (consulta): cambiar estado => 42501'
);

select pg_temp.como('f1000000-0000-0000-0000-000000000002');

select throws_ok(
  $$select * from public.preparar_cuenta_cliente('c5000000-0000-0000-0000-000000000001', 'a1000000-0000-0000-0000-000000000001')$$,
  '42501', null,
  'sin alcance sobre la tienda (operador solo de Mundo JC): preparar San Javucho => 42501'
);

select throws_ok(
  $$select public.cambiar_estado_cuenta_cliente('c5000000-0000-0000-0000-000000000001', 'a1000000-0000-0000-0000-000000000001', 'suspendida')$$,
  '42501', null,
  'sin alcance sobre la tienda: cambiar estado => 42501'
);

select is(
  (select correo from public.preparar_cuenta_cliente('c5000000-0000-0000-0000-000000000001', 'a1000000-0000-0000-0000-000000000002')),
  'norte@example.com',
  'con alcance sobre la tienda (Mundo JC) el operador prepara la cuenta'
);

-- ============================================================================
-- vincular (service_role): alta idempotente, sin mezclar panel ni clientes
-- ============================================================================

select pg_temp.como_servicio();

select isnt(
  public.vincular_cuenta_cliente(
    'c5000000-0000-0000-0000-000000000001', 'a1000000-0000-0000-0000-000000000001',
    'f1000000-0000-0000-0000-0000000000a1', 'f1000000-0000-0000-0000-000000000001'),
  null,
  'vincular crea la cuenta y devuelve su id'
);

select is(
  public.vincular_cuenta_cliente(
    'c5000000-0000-0000-0000-000000000001', 'a1000000-0000-0000-0000-000000000001',
    'f1000000-0000-0000-0000-0000000000a1', 'f1000000-0000-0000-0000-000000000001'),
  public.vincular_cuenta_cliente(
    'c5000000-0000-0000-0000-000000000001', 'a1000000-0000-0000-0000-000000000001',
    'f1000000-0000-0000-0000-0000000000a1', 'f1000000-0000-0000-0000-000000000001'),
  'vincular es idempotente: devuelve la misma cuenta'
);

select throws_ok(
  $$select public.vincular_cuenta_cliente('c5000000-0000-0000-0000-000000000004', 'a1000000-0000-0000-0000-000000000001',
      'f1000000-0000-0000-0000-000000000003')$$,
  '22023', null,
  'vincular rechaza un usuario del panel (D5)'
);

select throws_ok(
  $$select public.vincular_cuenta_cliente('c5000000-0000-0000-0000-000000000004', 'a1000000-0000-0000-0000-000000000001',
      'f1000000-0000-0000-0000-0000000000a1')$$,
  '22023', null,
  'vincular rechaza un usuario que ya pertenece a otro cliente (D1)'
);

select throws_ok(
  $$select public.vincular_cuenta_cliente('c5000000-0000-0000-0000-000000000003', 'a1000000-0000-0000-0000-000000000001',
      'f1000000-0000-0000-0000-0000000000a2')$$,
  '22023', null,
  'vincular rechaza un cliente no habilitado en la tienda'
);

reset role;

select is(
  (select count(*)::int from public.cuentas_cliente where cliente_id = 'c5000000-0000-0000-0000-000000000001'),
  1,
  'tras rechazos y reintentos quedó una sola fila'
);

-- ============================================================================
-- FR-008: suspender / reactivar, idempotente, con efecto inmediato en el acceso
-- ============================================================================

select pg_temp.como('f1000000-0000-0000-0000-0000000000a1');

select is(
  publico.acceso_cliente_por_dominio('sanjavucho.ejemplo.com') ->> 'estado',
  'activa',
  'antes de suspender, el acceso a la tienda es activa'
);

select pg_temp.como('f1000000-0000-0000-0000-000000000001');

select lives_ok(
  $$select public.cambiar_estado_cuenta_cliente('c5000000-0000-0000-0000-000000000001', 'a1000000-0000-0000-0000-000000000001', 'suspendida')$$,
  'el administrador suspende la cuenta'
);

select lives_ok(
  $$select public.cambiar_estado_cuenta_cliente('c5000000-0000-0000-0000-000000000001', 'a1000000-0000-0000-0000-000000000001', 'suspendida')$$,
  'suspender de nuevo es idempotente'
);

select pg_temp.como('f1000000-0000-0000-0000-0000000000a1');

select is(
  publico.acceso_cliente_por_dominio('sanjavucho.ejemplo.com') ->> 'estado',
  'suspendida',
  'el acceso refleja la suspensión en la misma transacción (al instante)'
);

select pg_temp.como('f1000000-0000-0000-0000-000000000001');

select lives_ok(
  $$select public.cambiar_estado_cuenta_cliente('c5000000-0000-0000-0000-000000000001', 'a1000000-0000-0000-0000-000000000001', 'activa')$$,
  'el administrador reactiva la cuenta'
);

select throws_ok(
  $$select public.cambiar_estado_cuenta_cliente('c5000000-0000-0000-0000-000000000001', 'a1000000-0000-0000-0000-000000000002', 'suspendida')$$,
  'P0002', null,
  'cambiar estado sin cuenta en esa tienda => P0002'
);

-- ============================================================================
-- Lectura para la ficha
-- ============================================================================

reset role;
update auth.users set last_sign_in_at = '2026-10-20 12:00:00+00' where id = 'f1000000-0000-0000-0000-0000000000a1';
select pg_temp.como('f1000000-0000-0000-0000-000000000001');

select is(
  (select estado || '|' || correo || '|' || (ultimo_ingreso is not null)::text
     from public.cuentas_web_de_cliente('c5000000-0000-0000-0000-000000000001')
    where empresa_id = 'a1000000-0000-0000-0000-000000000001'),
  'activa|norte@example.com|true',
  'cuentas_web_de_cliente devuelve estado, correo de acceso y último ingreso'
);

-- ============================================================================
-- FR-006 / SC-002: una sesión de cuenta web no lee ni escribe nada del panel
-- ============================================================================

select pg_temp.como('f1000000-0000-0000-0000-0000000000a1');

select is(
  (select coalesce(sum(((xpath('/row/c/text()', query_to_xml(
            format('select count(*) as c from %I.%I', n.nspname, c.relname), false, true, '')))[1])::text::int), 0)::int
     from pg_class c
     join pg_namespace n on n.oid = c.relnamespace
    where n.nspname in ('public', 'dominio')
      and c.relkind in ('r', 'p')
      and not c.relispartition
      and has_table_privilege(c.oid, 'select')
      and exists (select 1 from pg_attribute a where a.attrelid = c.oid and a.attname = 'organizacion_id' and not a.attisdropped)),
  0,
  'la cuenta web no recibe ninguna fila de las tablas por organización de public/dominio'
);

select throws_ok(
  $$insert into public.clientes (organizacion_id, nombre) values ('11111111-1111-1111-1111-111111111111', 'intruso')$$,
  '42501', null,
  'la cuenta web no escribe en clientes'
);

select throws_ok(
  $$select public.cambiar_estado_cuenta_cliente('c5000000-0000-0000-0000-000000000001', 'a1000000-0000-0000-0000-000000000001', 'activa')$$,
  '42501', null,
  'la cuenta web no puede gestionar cuentas'
);

select is(
  (select count(*)::int from public.usuarios_organizacion where user_id = 'f1000000-0000-0000-0000-0000000000a1'),
  0,
  'la cuenta web no tiene membresía en usuarios_organizacion'
);

-- Lectura directa de la tabla: respeta el alcance de tiendas del operador (devolución MSF-422)
select pg_temp.como('f1000000-0000-0000-0000-000000000002');

select is(
  (select count(*)::int from public.cuentas_cliente where empresa_id = 'a1000000-0000-0000-0000-000000000001'),
  0,
  'select directo: el operador solo de Mundo JC no ve las cuentas de San Javucho'
);

select pg_temp.como('f1000000-0000-0000-0000-000000000001');

select cmp_ok(
  (select count(*)::int from public.cuentas_cliente where empresa_id = 'a1000000-0000-0000-0000-000000000001'),
  '>=', 1,
  'select directo: el operador con alcance sobre San Javucho sí ve sus cuentas'
);

-- Filtro «Con cuenta web» (devolución MSF-422): el export respeta el alcance de tiendas del operador
select pg_temp.como('f1000000-0000-0000-0000-000000000002');

select is(
  (select count(*)::int from public.exportar_clientes(p_con_cuenta_web => true)
    where nombre = 'Distribuidora Norte'),
  0,
  'exportar con cuenta web: el operador solo de Mundo JC no cuenta la cuenta de San Javucho'
);

select is(
  (select count(*)::int from public.buscar_clientes(p_con_cuenta_web => true)
    where nombre = 'Distribuidora Norte'),
  0,
  'buscar con cuenta web: el operador solo de Mundo JC no cuenta la cuenta de San Javucho'
);

select pg_temp.como('f1000000-0000-0000-0000-000000000001');

select is(
  (select count(*)::int from public.exportar_clientes(p_con_cuenta_web => true)
    where nombre = 'Distribuidora Norte'),
  1,
  'exportar con cuenta web: el administrador sí exporta al cliente con cuenta activa'
);

-- «No habilitado» prevalece: sin la fila de clientes_empresas la cuenta guardada no cuenta
reset role;
delete from public.clientes_empresas
 where cliente_id = 'c5000000-0000-0000-0000-000000000001' and empresa_id = 'a1000000-0000-0000-0000-000000000001';
select pg_temp.como('f1000000-0000-0000-0000-000000000001');

select is(
  (select count(*)::int from public.buscar_clientes(p_con_cuenta_web => true)
    where nombre = 'Distribuidora Norte'),
  0,
  'buscar con cuenta web: una cuenta en una tienda donde ya no está habilitado no cuenta'
);

select * from finish();

rollback;
