-- MSF-150 · F-ACC-01: estado de la membresía (FR-004, FR-011) y bloqueo por
-- intentos de ingreso (FR-003).
begin;

select plan(11);

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

select * from finish();
rollback;
