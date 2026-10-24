-- F-SVC-05 (MSF-324, épica MSF-182): permisos de Service técnico y rol Técnico.
-- Cubre FR-040/FR-041/FR-042 y SC-006: niveles y acciones del Técnico en
-- nivel_seccion/puede_accion, regresión de los roles existentes contra la matriz
-- vigente (20261013130002), backfill y trigger de organización nueva, matriz de
-- service_tecnico intacta, Depósito sin acceso y matriz fija del Técnico en el
-- servidor. `rls_en_toda_tabla` (recorre public + dominio) no cambia: esta
-- historia no crea tablas, solo datos de roles. Corre como postgres para armar
-- el fixture y como "authenticated" (request.jwt.claims) para verificar.
begin;

select plan(27);

insert into organizaciones (id, nombre) values
  ('11111111-1111-1111-1111-111111111111', 'Organización Uno');

insert into auth.users (id, email) values
  ('b1000000-0000-0000-0000-000000000001', 'administrador@example.com'),
  ('b1000000-0000-0000-0000-000000000002', 'operador@example.com'),
  ('b1000000-0000-0000-0000-000000000005', 'deposito@example.com'),
  ('b1000000-0000-0000-0000-000000000008', 'tecnico@example.com');

insert into usuarios_organizacion (user_id, organizacion_id, rol_id) values
  ('b1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'administrador'),
  ('b1000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'operador'),
  ('b1000000-0000-0000-0000-000000000005', '11111111-1111-1111-1111-111111111111', 'deposito'),
  ('b1000000-0000-0000-0000-000000000008', '11111111-1111-1111-1111-111111111111', 'tecnico');

create function pg_temp.como(p_user uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
  set local role authenticated;
end $$;

-- ============================================================================
-- Rol y siembra (organización nueva = trigger vigente)
-- ============================================================================

select is(
  (select count(*)::int from roles_organizacion where id = 'tecnico'),
  1, 'existe el rol tecnico en roles_organizacion (FR-040)'
);
select is(
  (select count(*)::int from permisos_rol where organizacion_id = '11111111-1111-1111-1111-111111111111' and rol_id = 'tecnico'),
  16, 'el trigger de organización nueva siembra 16 secciones para el Técnico'
);
select is(
  (select count(*)::int from permisos_rol_accion where organizacion_id = '11111111-1111-1111-1111-111111111111' and rol_id = 'tecnico'),
  16 * 3 + 1, 'el trigger de organización nueva siembra 16 secciones × 3 acciones + editar_precio en ventas para el Técnico'
);

-- ============================================================================
-- Regresión: ningún rol existente cambia de nivel ni de acciones (FR-040)
-- ============================================================================

select is(
  (select count(*)::int
     from (values
       ('inicio',            'E','E','L','L','L','L','L'),
       ('productos',         'E','E','L','L','L','L','L'),
       ('categorias',        'E','E','L','N','N','N','L'),
       ('stock',             'E','E','L','L','E','L','L'),
       ('cotizacion_dolar',  'E','L','L','L','N','E','L'),
       ('empresas',          'E','N','N','N','N','N','N'),
       ('mercado_libre',     'E','N','N','N','N','N','N'),
       ('rentabilidad',      'E','N','N','N','N','L','N'),
       ('usuarios_permisos', 'E','N','N','N','N','N','N'),
       ('actividad',         'E','L','N','N','N','L','N'),
       ('consultas',         'E','E','L','N','N','L','L'),
       ('ventas',            'E','E','L','E','L','E','L'),
       ('clientes',          'E','E','L','E','N','E','L'),
       ('proveedores',       'E','N','N','N','N','E','N'),
       ('reportes',          'E','N','N','N','N','E','N'),
       ('service_tecnico',   'E','E','L','L','N','L','L')
     ) as v(seccion, administrador, operador, consulta, mostrador, deposito, administracion, miembro)
     cross join lateral (values
       ('administrador', v.administrador), ('operador', v.operador), ('consulta', v.consulta),
       ('mostrador', v.mostrador), ('deposito', v.deposito), ('administracion', v.administracion),
       ('miembro', v.miembro)
     ) as r(rol, c)
     left join permisos_rol p
       on p.organizacion_id = '11111111-1111-1111-1111-111111111111' and p.rol_id = r.rol and p.seccion = v.seccion
    where p.nivel is distinct from case r.c when 'E' then 'edicion' when 'L' then 'lectura' else 'ninguno' end),
  0, 'los siete roles existentes conservan exactamente su matriz vigente (regresión)'
);
select is(
  (select count(*)::int from private.matriz_inicial() where rol_id <> 'tecnico'),
  16 * 7, 'matriz_inicial() sigue devolviendo 16 secciones para cada rol existente'
);
select is(
  (select count(*)::int from private.matriz_acciones_iniciales() where rol_id <> 'tecnico' and permitido),
  16 * (1 + 3 + 2) + 2, 'las acciones de los roles existentes no cambian (eliminar: 1 rol; exportar: 3; ver costos: 2; editar_precio solo en ventas: 2 roles)'
);
select is(
  (select count(*)::int from private.matriz_acciones_iniciales() where rol_id = 'tecnico' and permitido),
  0, 'el Técnico no tiene eliminar, exportar ni ver_costos en ninguna sección (FR-041)'
);

-- ============================================================================
-- Matriz de service_tecnico intacta para los seis roles + Técnico en edición
-- ============================================================================

select is(
  (select string_agg(rol_id || '=' || nivel, ',' order by rol_id)
     from private.matriz_inicial() where seccion = 'service_tecnico' and rol_id <> 'miembro'),
  'administracion=lectura,administrador=edicion,consulta=lectura,deposito=ninguno,mostrador=lectura,operador=edicion,tecnico=edicion',
  'service_tecnico conserva los valores de los seis roles y el Técnico edita (FR-041)'
);

-- ============================================================================
-- Contrato como usuario Técnico (SC-006)
-- ============================================================================

reset role;
select pg_temp.como('b1000000-0000-0000-0000-000000000008');
select is(private.nivel_seccion('service_tecnico'), 'edicion', 'técnico: edita Service técnico');
select is(private.nivel_seccion('inicio'), 'lectura', 'técnico: lee Inicio');
select is(private.nivel_seccion('clientes'), 'lectura', 'técnico: lee Clientes (ve al cliente de la reparación)');
select is(private.nivel_seccion('productos'), 'lectura', 'técnico: lee Productos');
select is(private.nivel_seccion('stock'), 'lectura', 'técnico: lee Stock');
select is(private.nivel_seccion('ventas'), 'ninguno', 'técnico: sin acceso a Ventas');
select is(private.nivel_seccion('proveedores'), 'ninguno', 'técnico: sin acceso a Proveedores');
select is(private.nivel_seccion('usuarios_permisos'), 'ninguno', 'técnico: sin acceso a Usuarios y permisos');
select is(private.nivel_seccion('rentabilidad'), 'ninguno', 'técnico: sin acceso a Rentabilidad');
select is(private.puede_accion('service_tecnico', 'eliminar'), false, 'técnico: no elimina en Service técnico');
select is(private.puede_accion('service_tecnico', 'exportar'), false, 'técnico: no exporta en Service técnico');
select is(private.puede_accion('service_tecnico', 'ver_costos'), false, 'técnico: no ve costos en Service técnico');
select is(
  (select nivel from public.permisos_actuales() where seccion = 'service_tecnico'),
  'edicion', 'permisos_actuales() del Técnico informa edicion en service_tecnico (menú y rutas)'
);

-- ============================================================================
-- Depósito sin acceso a Service técnico (regresión)
-- ============================================================================

reset role;
select pg_temp.como('b1000000-0000-0000-0000-000000000005');
select is(private.nivel_seccion('service_tecnico'), 'ninguno', 'depósito: sigue sin acceso a Service técnico');

-- ============================================================================
-- Matriz fija del Técnico: el servidor rechaza editarla (FR-041/FR-042)
-- ============================================================================

reset role;
select pg_temp.como('b1000000-0000-0000-0000-000000000001');
select throws_ok(
  $$select public.guardar_matriz_permisos('[{"rol_id":"tecnico","seccion":"ventas","nivel":"edicion"}]'::jsonb, '[]'::jsonb)$$,
  '22023', 'El rol Técnico tiene una matriz fija y no se edita desde la matriz',
  'el Administrador no puede cambiar un nivel del Técnico'
);
select throws_ok(
  $$select public.guardar_matriz_permisos('[]'::jsonb, '[{"rol_id":"tecnico","seccion":"service_tecnico","accion":"exportar","permitido":true}]'::jsonb)$$,
  '22023', 'El rol Técnico tiene una matriz fija y no se edita desde la matriz',
  'el Administrador no puede cambiar una acción del Técnico'
);
select lives_ok(
  $$select public.guardar_matriz_permisos('[{"rol_id":"operador","seccion":"stock","nivel":"lectura"}]'::jsonb, '[]'::jsonb)$$,
  'la edición de los demás roles sigue funcionando'
);

-- ============================================================================
-- Backfill idempotente: completa lo que falta sin pisar ediciones
-- ============================================================================

reset role;
delete from permisos_rol_accion where rol_id = 'tecnico';
delete from permisos_rol where rol_id = 'tecnico';
select private.sembrar_permisos('11111111-1111-1111-1111-111111111111');
select is(
  (select count(*)::int from permisos_rol where organizacion_id = '11111111-1111-1111-1111-111111111111' and rol_id = 'tecnico'),
  16, 'el backfill repone las 16 secciones del Técnico en una organización existente'
);
select is(
  (select nivel from permisos_rol where organizacion_id = '11111111-1111-1111-1111-111111111111' and rol_id = 'operador' and seccion = 'stock'),
  'lectura', 'el backfill no pisa la edición hecha a otro rol (on conflict do nothing)'
);

select * from finish();
rollback;
