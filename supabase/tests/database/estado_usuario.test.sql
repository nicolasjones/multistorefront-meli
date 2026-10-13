-- MSF-150 · F-ACC-01: estado de la membresía (FR-004, FR-011) y bloqueo por
-- intentos de ingreso (FR-003).
begin;

select plan(35);

insert into public.organizaciones (id, nombre) values
  ('a1111111-1111-1111-1111-111111111111', 'Organizacion Estado');

insert into auth.users (id, email) values
  ('a1000000-0000-0000-0000-000000000001', 'activo-estado@example.com'),
  ('a1000000-0000-0000-0000-000000000002', 'suspendido-estado@example.com');

insert into public.usuarios_organizacion (user_id, organizacion_id, rol_id, estado) values
  ('a1000000-0000-0000-0000-000000000001', 'a1111111-1111-1111-1111-111111111111', 'administrador', 'activo'),
  ('a1000000-0000-0000-0000-000000000002', 'a1111111-1111-1111-1111-111111111111', 'administrador', 'suspendido');

-- ============================================================================
-- Estado
-- ============================================================================

select is(
  (select estado from public.usuarios_organizacion
   where user_id = 'a1000000-0000-0000-0000-000000000001'),
  'activo',
  'la membresía creada con estado explícito conserva activo'
);

select throws_ok(
  $$update public.usuarios_organizacion set estado = 'otro'
    where user_id = 'a1000000-0000-0000-0000-000000000001'$$,
  '23514',
  null,
  'solo se aceptan los estados activo y suspendido'
);

set local role authenticated;

select set_config('request.jwt.claims',
  '{"sub":"a1000000-0000-0000-0000-000000000001","role":"authenticated","email":"activo-estado@example.com"}', true);
select is(private.organizacion_id(), 'a1111111-1111-1111-1111-111111111111'::uuid,
  'el activo resuelve su organización');
select is(private.puede_escribir(), true, 'el administrador activo puede escribir');

select set_config('request.jwt.claims',
  '{"sub":"a1000000-0000-0000-0000-000000000002","role":"authenticated","email":"suspendido-estado@example.com"}', true);
select is(private.organizacion_id(), null::uuid, 'el suspendido no resuelve organización');
select is(private.puede_escribir(), false, 'el suspendido no puede escribir');
select is((select count(*)::int from public.organizaciones), 0,
  'el suspendido no ve la organización');
-- authProvider.login rechaza al suspendido leyendo su propia fila: si una
-- policy futura se la oculta, entraría sin que falle nada.
select is((select estado from public.usuarios_organizacion
  where user_id = 'a1000000-0000-0000-0000-000000000002'), 'suspendido',
  'el suspendido lee su propia fila de usuarios_organizacion');

select is(private.puede_gestionar_membresias('a1111111-1111-1111-1111-111111111111'), false,
  'el suspendido no gestiona membresías');
select is(private.es_administrador_de('a1111111-1111-1111-1111-111111111111'), false,
  'el suspendido no es administrador de la organización');
select is(private.rol_id(), null::text, 'el suspendido no tiene rol efectivo');
select is(private.puede_gestionar_reportes('a1111111-1111-1111-1111-111111111111'), false,
  'el suspendido no gestiona reportes');
select throws_ok(
  $$select public.agregar_miembro('a1000000-0000-0000-0000-000000000001', 'miembro', 'miembro_agregado')$$,
  '42501', null, 'el suspendido no puede agregar miembros');

select set_config('request.jwt.claims',
  '{"sub":"a1000000-0000-0000-0000-000000000001","role":"authenticated","email":"activo-estado@example.com"}', true);
select is(private.puede_gestionar_membresias('a1111111-1111-1111-1111-111111111111')
  and private.es_administrador_de('a1111111-1111-1111-1111-111111111111')
  and private.puede_gestionar_reportes('a1111111-1111-1111-1111-111111111111')
  and private.rol_id() = 'administrador', true,
  'el administrador activo conserva sus privilegios');

-- ============================================================================
-- Bloqueo por intentos (5 fallos / 15 min, por correo)
-- ============================================================================

set local role anon;

select is(public.bloqueo_acceso_hasta('Persona@Example.com'), null::timestamptz,
  'sin fallos no hay bloqueo');

select lives_ok(
  $$select public.registrar_fallo_acceso('persona@example.com') from generate_series(1, 4)$$,
  '4 fallos no bloquean'
);
select is(public.bloqueo_acceso_hasta('persona@example.com'), null::timestamptz,
  'tras 4 fallos sigue sin bloqueo');

select ok(
  public.registrar_fallo_acceso(' PERSONA@example.com ') > now() + interval '14 minutes',
  'el 5.º fallo (correo normalizado) bloquea ~15 minutos'
);

-- Entradas inválidas no crean filas
select is(public.registrar_fallo_acceso(null), null::timestamptz, 'un correo nulo no cuenta');
select is(public.registrar_fallo_acceso(repeat('a', 255) || '@example.com'), null::timestamptz,
  'un correo de más de 254 caracteres no cuenta');

-- anon no alcanza las RPC de contexto de superadmin (endurecimiento)
select throws_ok(
  $$select public.entrar_a_organizacion('a1111111-1111-1111-1111-111111111111')$$,
  '42501', null, 'anon no ejecuta entrar_a_organizacion');
select throws_ok($$select public.salir_de_organizacion()$$,
  '42501', null, 'anon no ejecuta salir_de_organizacion');

-- anon no ejecuta ninguna otra función de public (solo las RPC de acceso)
select is_empty(
  $$select p.oid::regprocedure from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.prokind in ('f', 'p')
      and p.proname not in ('bloqueo_acceso_hasta', 'registrar_fallo_acceso')
      and not exists (select 1 from pg_depend d
        where d.classid = 'pg_proc'::regclass and d.objid = p.oid and d.deptype = 'e')
      and has_function_privilege('anon', p.oid, 'EXECUTE')$$,
  'anon solo ejecuta bloqueo_acceso_hasta y registrar_fallo_acceso en public');

-- La tabla no es accesible directamente
select throws_ok($$select * from public.intentos_acceso$$, '42501', null,
  'anon no lee intentos_acceso');

-- Lo que se cree después nace sin acceso para anon (privilegios por defecto)
reset role;
create function public.zz_funcion_futura() returns int language sql as $$select 1$$;
create table public.zz_tabla_futura (id int);
create sequence public.zz_secuencia_futura;
select ok(not has_function_privilege('anon', 'public.zz_funcion_futura()', 'EXECUTE'),
  'una función nueva en public nace sin EXECUTE para anon');
select ok(not has_table_privilege('anon', 'public.zz_tabla_futura', 'SELECT'),
  'una tabla nueva en public nace sin privilegios para anon');
select ok(not has_sequence_privilege('anon', 'public.zz_secuencia_futura', 'USAGE'),
  'una secuencia nueva en public nace sin privilegios para anon');
create function private.zz_helper_futuro() returns int language sql as $$select 1$$;
select ok(has_function_privilege('authenticated', 'private.zz_helper_futuro()', 'EXECUTE'),
  'un helper nuevo en private sigue ejecutable por authenticated (para usarlo en policies RLS)');
select ok(not has_function_privilege('anon', 'private.zz_helper_futuro()', 'EXECUTE'),
  'un helper nuevo en private nace sin EXECUTE para anon');
set local role anon;

set local role authenticated;
select throws_ok($$select * from public.intentos_acceso$$, '42501', null,
  'authenticated no lee intentos_acceso');

-- limpiar_intentos_acceso no borra un bloqueo vigente
select set_config('request.jwt.claims',
  '{"sub":"a1000000-0000-0000-0000-000000000001","role":"authenticated","email":"persona@example.com"}', true);
select lives_ok($$select public.limpiar_intentos_acceso()$$, 'limpiar no falla');
select ok(public.bloqueo_acceso_hasta('persona@example.com') > now(),
  'limpiar no levanta un bloqueo vigente');

-- Ventana vencida: el siguiente fallo empieza de cero
reset role;
update public.intentos_acceso
  set bloqueado_hasta = now() - interval '1 minute'
  where correo_hash = private.hash_correo_acceso('persona@example.com');
set local role anon;
select is(public.registrar_fallo_acceso('persona@example.com'), null::timestamptz,
  'tras vencer el bloqueo el contador reinicia en 1');

-- Ingreso exitoso (FR-003): limpiar_intentos_acceso borra el contador
reset role;
set local role anon;
select public.registrar_fallo_acceso('limpia@example.com');
select public.registrar_fallo_acceso('limpia@example.com');
select public.registrar_fallo_acceso('limpia@example.com');
reset role;
select is((select fallos from public.intentos_acceso
  where correo_hash = private.hash_correo_acceso('limpia@example.com')), 3,
  'tres fallos dejan el contador en 3');
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"a1000000-0000-0000-0000-000000000001","role":"authenticated","email":"limpia@example.com"}', true);
select public.limpiar_intentos_acceso();
reset role;
select is((select count(*) from public.intentos_acceso
  where correo_hash = private.hash_correo_acceso('limpia@example.com')), 0::bigint,
  'un ingreso exitoso borra el contador');

select * from finish();
rollback;
