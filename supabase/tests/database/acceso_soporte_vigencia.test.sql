-- F-OPS-04 (MSF-300, épica MSF-170): acceso de soporte auditado.
-- Cubre FR-014 (motivo obligatorio, solo superadmin), FR-015 (vigencia: vencido
-- no resuelve organización ni escribe; el contexto existente recibe vencimiento),
-- FR-016 (ingreso/salida/vencimiento en superadmin_entradas y en la actividad) y
-- SC-006. El vencimiento se simula moviendo vence_en respecto de now() (sin fechas
-- absolutas). Fixture como postgres; verificaciones como authenticated/anon.
begin;

select plan(20);

insert into organizaciones (id, nombre) values
  ('11111111-1111-1111-1111-111111111111', 'Organización Uno');

insert into auth.users (id, email) values
  ('a5000000-0000-0000-0000-000000000001', 'soporte@example.com'),
  ('a5000000-0000-0000-0000-000000000002', 'admin-uno@example.com');

insert into superadmins (user_id) values ('a5000000-0000-0000-0000-000000000001');
insert into usuarios_organizacion (user_id, organizacion_id, rol_id) values
  ('a5000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'administrador');

-- Backfill / default: un contexto insertado sin vence_en recibe un vencimiento futuro.
insert into superadmin_organizacion_activa (user_id, organizacion_id)
values ('a5000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111');
select ok(
  (select vence_en > now() from superadmin_organizacion_activa where user_id = 'a5000000-0000-0000-0000-000000000001'),
  'un contexto sin vencimiento explícito recibe uno futuro (FR-015)'
);
delete from superadmin_organizacion_activa;

-- Ninguna función fuera de entrar/salir/cierre automático lee la tabla cruda: todas leen la vista vigente.
select is(
  (select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname in ('public', 'private', 'dominio') and p.prokind = 'f'
      -- exclusiones_exportacion_total solo nombra la tabla como texto (no la lee).
      and p.proname not in ('entrar_a_organizacion', 'salir_de_organizacion', 'cerrar_accesos_soporte_vencidos', 'exclusiones_exportacion_total')
      and p.prosrc ~ 'superadmin_organizacion_activa'),
  0, 'ninguna función lee superadmin_organizacion_activa sin filtrar la vigencia (FR-015)'
);
select ok(
  (select prosrc ~ 'superadmin_contexto_vigente' from pg_proc where oid = 'private.organizacion_id()'::regprocedure),
  'private.organizacion_id() lee el contexto vigente'
);

-- Quien no es superadmin no entra.
select set_config('request.jwt.claims', json_build_object('sub', 'a5000000-0000-0000-0000-000000000002', 'role', 'authenticated')::text, true);
set local role authenticated;
select throws_ok(
  $$select public.entrar_a_organizacion('11111111-1111-1111-1111-111111111111', 'quiero mirar')$$,
  '42501', null, 'un no superadmin no entra a una organización (FR-014)'
);
reset role;

-- anon no ejecuta.
set local role anon;
select throws_ok(
  $$select public.entrar_a_organizacion('11111111-1111-1111-1111-111111111111', 'x')$$,
  '42501', null, 'anon no ejecuta entrar_a_organizacion'
);
select throws_ok($$select public.salir_de_organizacion()$$, '42501', null, 'anon no ejecuta salir_de_organizacion');
reset role;

-- La versión sin motivo ya no existe.
select hasnt_function('public', 'entrar_a_organizacion', array['uuid'], 'no queda la versión sin motivo (FR-014)');

select set_config('request.jwt.claims', json_build_object('sub', 'a5000000-0000-0000-0000-000000000001', 'role', 'authenticated')::text, true);
set local role authenticated;

select throws_ok(
  $$select public.entrar_a_organizacion('11111111-1111-1111-1111-111111111111', null)$$,
  '22023', null, 'sin motivo se rechaza (FR-014, SC-006)'
);
select throws_ok(
  $$select public.entrar_a_organizacion('11111111-1111-1111-1111-111111111111', '   ')$$,
  '22023', null, 'un motivo en blanco se rechaza'
);
select throws_ok(
  $$select public.entrar_a_organizacion('11111111-1111-1111-1111-111111111111', repeat('x', 501))$$,
  '22023', null, 'un motivo de más de 500 caracteres se rechaza'
);

select lives_ok(
  $$select public.entrar_a_organizacion('11111111-1111-1111-1111-111111111111', 'Revisar el reclamo 123')$$,
  'con motivo se concreta el ingreso'
);
select is(
  (select private.organizacion_id()), '11111111-1111-1111-1111-111111111111'::uuid,
  'con el acceso vigente la organización se resuelve'
);
reset role;

select is(
  (select motivo from superadmin_entradas where accion = 'entrada' and user_id = 'a5000000-0000-0000-0000-000000000001'),
  'Revisar el reclamo 123', 'el motivo queda en superadmin_entradas (FR-014)'
);
select ok(
  (select vence_en > now() from superadmin_organizacion_activa where user_id = 'a5000000-0000-0000-0000-000000000001'),
  'el ingreso fija un vencimiento futuro (FR-015)'
);
select is(
  (select count(*)::int from registro_actividad where tipo = 'soporte.ingreso' and organizacion_id = '11111111-1111-1111-1111-111111111111'
     and actor_id = 'a5000000-0000-0000-0000-000000000001' and detalle like '%Revisar el reclamo 123%'),
  1, 'el ingreso queda en la actividad de la organización con quién y por qué (FR-016)'
);

-- Acceso vencido: no resuelve organización, no ve filas, no escribe.
update superadmin_organizacion_activa set vence_en = now() - interval '1 minute'
 where user_id = 'a5000000-0000-0000-0000-000000000001';

set local role authenticated;
select is((select private.organizacion_id()), null::uuid, 'vencido, la organización deja de resolverse (FR-015)');
select is((select count(*)::int from clientes), 0, 'vencido, el superadmin ve 0 filas (SC-006)');
select is((select private.puede_escribir()), false, 'vencido, no puede escribir');
reset role;

-- Salir con el acceso vencido registra soporte.vencido.
set local role authenticated;
select public.salir_de_organizacion();
reset role;

select is(
  (select count(*)::int from registro_actividad where tipo = 'soporte.vencido' and organizacion_id = '11111111-1111-1111-1111-111111111111'),
  1, 'salir con el acceso vencido registra soporte.vencido (FR-016)'
);
select is(
  (select array_agg(accion order by id) from superadmin_entradas where user_id = 'a5000000-0000-0000-0000-000000000001'),
  array['entrada', 'salida'], 'superadmin_entradas guarda la entrada y la salida (FR-016)'
);

select * from finish();
rollback;
