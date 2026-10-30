-- F-CLI-12 (MSF-370, épica MSF-155, spec 20261028-100000-correo-masivo-a-clientes): crear la campaña y pedir la prueba.
-- Cubre FR-015 (una campaña con la foto de elegibles, idempotencia por clave, rechazo sin elegibles), FR-014 (la prueba
-- no crea campaña ni cuenta contra el cupo), FR-022 (actividad `campana_correo.crear` sin cuerpo ni correos),
-- permisos (edición exigida, `anon` sin ejecución) y RLS de las tablas nuevas.
-- El fixture corre como postgres (RLS no aplica) y las verificaciones como «authenticated» vía request.jwt.claims.
begin;

select plan(25);

insert into organizaciones (id, nombre) values
  ('11111111-1111-1111-1111-111111111111', 'Organización Uno'),
  ('22222222-2222-2222-2222-222222222222', 'Organización Dos');

insert into auth.users (id, email) values
  ('d1000000-0000-0000-0000-000000000001', 'admin-uno@example.com'),
  ('d1000000-0000-0000-0000-000000000002', 'consulta-uno@example.com'),
  ('d2000000-0000-0000-0000-000000000001', 'admin-dos@example.com');

insert into usuarios_organizacion (user_id, organizacion_id, rol_id) values
  ('d1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'administrador'),
  ('d1000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'consulta'),
  ('d2000000-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', 'administrador');

insert into clientes (organizacion_id, numero, nombre, tipo, correo, acepta_correo_masivo, archivado_en) values
  ('11111111-1111-1111-1111-111111111111', 102, 'Alfa', 'mayorista', 'alfa@example.com', true, null),
  ('11111111-1111-1111-1111-111111111111', 103, 'Beta', 'minorista', 'beta@example.com', true, null),
  ('11111111-1111-1111-1111-111111111111', 105, 'Archivado', 'minorista', 'archivado@example.com', true, now()),
  ('11111111-1111-1111-1111-111111111111', 106, 'Sin correo', 'minorista', null, true, null),
  ('11111111-1111-1111-1111-111111111111', 107, 'No acepta', 'minorista', 'noacepta@example.com', false, null),
  ('22222222-2222-2222-2222-222222222222', 201, 'Ajeno', 'minorista', 'ajeno@example.com', true, null);

create function pg_temp.como(p_user uuid) returns void language plpgsql as $$
begin
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
  set local role authenticated;
end $$;

select pg_temp.como('d1000000-0000-0000-0000-000000000001');

-- ============================================================================
-- FR-015: la campaña
-- ============================================================================

create temp table creada as
  select public.crear_campana_correo('aaaaaaaa-0000-0000-0000-000000000001', '  Ofertas de octubre ', 'Hola, tenemos ofertas.') as id;
grant all on creada to authenticated;

select is((select count(*)::int from dominio.campanas_correo), 1, 'crear_campana_correo crea una campaña');

select results_eq(
  $$select c.nombre from dominio.campana_correo_destinatarios d join public.clientes c on c.id = d.cliente_id order by 1$$,
  $$values ('Alfa'::text), ('Beta'::text)$$,
  'la foto trae solo a los elegibles (no archivados, con correo y con aceptación; ninguno de otra organización)'
);

select is(
  (select array_agg(correo order by correo) from dominio.campana_correo_destinatarios),
  array['alfa@example.com', 'beta@example.com'],
  'la foto guarda el correo usado'
);

select is(
  (select count(*)::int from dominio.campana_correo_destinatarios where estado = 'pendiente'),
  2,
  'los destinatarios nacen pendientes'
);

select is(
  (select asunto from dominio.campanas_correo),
  'Ofertas de octubre',
  'el asunto se guarda sin espacios sobrantes'
);

select is(
  public.crear_campana_correo('aaaaaaaa-0000-0000-0000-000000000001', 'Otro asunto', 'Otro mensaje'),
  (select id from creada),
  'el doble clic (misma clave) devuelve la misma campaña'
);
select is((select count(*)::int from dominio.campanas_correo), 1, 'la misma clave no crea una segunda campaña');
select is((select count(*)::int from dominio.campana_correo_destinatarios), 2, 'la misma clave no duplica destinatarios');

select throws_ok(
  $$select public.crear_campana_correo('aaaaaaaa-0000-0000-0000-000000000002', 'Asunto', 'Mensaje', null, 'texto que no coincide con nadie')$$,
  '22023', null,
  'sin ningún destinatario elegible se rechaza'
);
select is((select count(*)::int from dominio.campanas_correo), 1, 'el rechazo sin elegibles no deja una campaña vacía');

select throws_ok(
  $$select public.crear_campana_correo('aaaaaaaa-0000-0000-0000-000000000003', '', 'Mensaje')$$,
  '22023', null, 'el asunto es obligatorio'
);
select throws_ok(
  $$select public.crear_campana_correo('aaaaaaaa-0000-0000-0000-000000000003', 'Asunto', '   ')$$,
  '22023', null, 'el mensaje es obligatorio'
);
select throws_ok(
  $$select public.crear_campana_correo('aaaaaaaa-0000-0000-0000-000000000003', repeat('a', 201), 'Mensaje')$$,
  '22023', null, 'el asunto admite hasta 200 caracteres'
);
select throws_ok(
  $$select public.crear_campana_correo('aaaaaaaa-0000-0000-0000-000000000003', E'Asunto\nBcc: otro@example.com', 'Mensaje')$$,
  '22023', null, 'el asunto no admite saltos de línea (cabeceras del correo)'
);
select throws_ok(
  $$select public.crear_campana_correo('aaaaaaaa-0000-0000-0000-000000000003', 'Asunto', repeat('a', 10001))$$,
  '22023', null, 'el mensaje admite hasta 10000 caracteres'
);

-- ============================================================================
-- FR-022: actividad sin cuerpo ni correos
-- ============================================================================

select is(
  (select count(*)::int from public.registro_actividad where tipo = 'campana_correo.crear'),
  1,
  'crear la campaña registra actividad (una sola vez, aunque se repita la clave)'
);
select ok(
  not exists (
    select 1 from public.registro_actividad
     where tipo = 'campana_correo.crear' and (detalle like '%@%' or detalle like '%Hola, tenemos ofertas%')
  ),
  'la actividad no lleva el cuerpo del mensaje ni correos'
);

-- ============================================================================
-- FR-014: la prueba
-- ============================================================================

select lives_ok(
  $$select public.solicitar_prueba_correo_masivo('Prueba', 'Mensaje de prueba')$$,
  'pedir una prueba funciona'
);
select is(
  (select correo from dominio.correo_masivo_pruebas),
  'admin-uno@example.com',
  'la prueba va al correo del usuario que redacta'
);
select is(
  (select count(*)::int from dominio.campanas_correo) + (select count(*)::int from dominio.campana_correo_destinatarios),
  3,
  'la prueba no crea campaña ni destinatarios'
);

-- ============================================================================
-- Permisos y RLS
-- ============================================================================

select pg_temp.como('d1000000-0000-0000-0000-000000000002');
select throws_ok(
  $$select public.crear_campana_correo('aaaaaaaa-0000-0000-0000-000000000009', 'Asunto', 'Mensaje')$$,
  '42501', null, 'con acceso de solo lectura la base rechaza crear la campaña'
);
select throws_ok(
  $$select public.solicitar_prueba_correo_masivo('Asunto', 'Mensaje')$$,
  '42501', null, 'con acceso de solo lectura la base rechaza la prueba'
);
select is(
  (select count(*)::int from dominio.campanas_correo),
  1,
  'quien tiene lectura en clientes ve las campañas de su organización'
);

select pg_temp.como('d2000000-0000-0000-0000-000000000001');
select is(
  (select count(*)::int from dominio.campanas_correo) + (select count(*)::int from dominio.campana_correo_destinatarios),
  0,
  'otra organización no ve campañas ni destinatarios (RLS)'
);

reset role;
select ok(
  not has_function_privilege('anon', 'public.crear_campana_correo(uuid, text, text, uuid, text, text, boolean, uuid[])', 'execute')
  and not has_function_privilege('anon', 'public.solicitar_prueba_correo_masivo(text, text)', 'execute')
  and not has_table_privilege('authenticated', 'dominio.campanas_correo', 'insert')
  and not has_table_privilege('authenticated', 'dominio.campana_correo_destinatarios', 'update')
  and not has_column_privilege('authenticated', 'dominio.campana_correo_destinatarios', 'token_hashes', 'select')
  and not has_table_privilege('authenticated', 'dominio.correo_masivo_pruebas', 'select'),
  'anon no ejecuta las RPC; authenticated no escribe las tablas ni lee los hashes de baja ni las pruebas'
);

select * from finish();
rollback;
