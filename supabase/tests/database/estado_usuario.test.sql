-- MSF-150 · F-ACC-01: estado de la membresía (FR-004, FR-011) y bloqueo por
-- intentos de ingreso (FR-003).
begin;

select plan(26);

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

-- La tabla no es accesible directamente
select throws_ok($$select * from public.intentos_acceso$$, '42501', null,
  'anon no lee intentos_acceso');

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
