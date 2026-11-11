-- F-VTA-24 (épica MSF-145, spec 20261024-130000-ventas-motos, FR-002, FR-003, FR-005, FR-008, FR-009;
-- SC-002 y SC-003): registro y edición de los envíos en moto.
--
-- Cubre: la tabla `dominio.envios_moto` (RLS, sin escritura directa, `anon` sin privilegios, aislamiento
-- entre organizaciones y por empresa); `registrar_envio_moto` (alta válida, mensajero normalizado, cero
-- válido, un envío por comprobante, presupuesto / forma de envío distinta de moto / anulada / sin forma
-- de envío / empresa ajena / mensajero vacío / importes negativos o con más de dos decimales);
-- `actualizar_envio_moto` (edición, conflicto 40001, envío rendido de solo lectura 55000, `rendido` y
-- `rendido_en` intactos); `comprobantes_para_envio_moto` (solo elegibles); `listar_envios_moto`; los
-- permisos (Operador y Administrador escriben; Mostrador, Consulta, sin `ventas` y `anon` no, 42501) y
-- los eventos `envio_moto.registrado` / `envio_moto.actualizado` en `public.registro_actividad`.
--
-- El fixture corre como postgres (RLS no aplica) y las verificaciones como «authenticated» vía
-- request.jwt.claims, igual que PostgREST. Los id usan prefijos hexadecimales: a empresas, b formas de
-- envío, c clientes, d usuarios, f comprobantes.
begin;

select no_plan();

-- ============================================================================
-- Fixture
-- ============================================================================

insert into organizaciones (id, nombre) values
  ('11111111-1111-1111-1111-111111111111', 'Organización Uno'),
  ('22222222-2222-2222-2222-222222222222', 'Organización Dos');

insert into auth.users (id, email) values
  ('d1000000-0000-0000-0000-000000000001', 'admin-uno@example.com'),
  ('d1000000-0000-0000-0000-000000000003', 'mostrador-uno@example.com'),
  ('d1000000-0000-0000-0000-000000000005', 'consulta-uno@example.com'),
  ('d1000000-0000-0000-0000-000000000012', 'operador-a-uno@example.com'),
  ('d1000000-0000-0000-0000-000000000013', 'operador-b-uno@example.com'),
  ('d2000000-0000-0000-0000-000000000001', 'admin-dos@example.com');

insert into usuarios_organizacion (user_id, organizacion_id, rol_id, estado) values
  ('d1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'administrador', 'activo'),
  ('d1000000-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111', 'mostrador', 'activo'),
  ('d1000000-0000-0000-0000-000000000005', '11111111-1111-1111-1111-111111111111', 'consulta', 'activo'),
  ('d1000000-0000-0000-0000-000000000012', '11111111-1111-1111-1111-111111111111', 'operador', 'activo'),
  ('d1000000-0000-0000-0000-000000000013', '11111111-1111-1111-1111-111111111111', 'operador', 'activo'),
  ('d2000000-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', 'administrador', 'activo');

insert into dominio.empresas (id, organizacion_id, nombre) values
  ('a1000000-0000-0000-0000-00000000000a', '11111111-1111-1111-1111-111111111111', 'San Javucho'),
  ('a1000000-0000-0000-0000-00000000000b', '11111111-1111-1111-1111-111111111111', 'Mundo JC'),
  ('a2000000-0000-0000-0000-00000000000c', '22222222-2222-2222-2222-222222222222', 'Empresa Dos');

-- Mostrador, Consulta y el Operador A trabajan en San Javucho; el Operador B, en Mundo JC. El
-- Administrador de la organización llega a todas sus empresas por el rol.
insert into usuarios_empresas (user_id, empresa_id, organizacion_id, rol_id) values
  ('d1000000-0000-0000-0000-000000000003', 'a1000000-0000-0000-0000-00000000000a', '11111111-1111-1111-1111-111111111111', 'mostrador'),
  ('d1000000-0000-0000-0000-000000000005', 'a1000000-0000-0000-0000-00000000000a', '11111111-1111-1111-1111-111111111111', 'consulta'),
  ('d1000000-0000-0000-0000-000000000012', 'a1000000-0000-0000-0000-00000000000a', '11111111-1111-1111-1111-111111111111', 'operador'),
  ('d1000000-0000-0000-0000-000000000013', 'a1000000-0000-0000-0000-00000000000b', '11111111-1111-1111-1111-111111111111', 'operador');

insert into clientes (id, organizacion_id, numero, nombre, tipo) values
  ('c1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 10, 'Cliente Uno', 'minorista'),
  ('c2000000-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', 20, 'Cliente Dos', 'minorista');

-- Formas de envío: «Moto» y «Correo» en San Javucho, «Moto» en Mundo JC y «Moto» de la otra organización.
insert into dominio.formas_envio (id, organizacion_id, empresa_id, nombre, tipo) values
  ('b1000000-0000-0000-0000-00000000000a', '11111111-1111-1111-1111-111111111111', 'a1000000-0000-0000-0000-00000000000a', 'Moto', 'moto'),
  ('b1000000-0000-0000-0000-00000000000b', '11111111-1111-1111-1111-111111111111', 'a1000000-0000-0000-0000-00000000000a', 'Correo', 'correo'),
  ('b1000000-0000-0000-0000-00000000000c', '11111111-1111-1111-1111-111111111111', 'a1000000-0000-0000-0000-00000000000b', 'Moto', 'moto'),
  ('b2000000-0000-0000-0000-00000000000d', '22222222-2222-2222-2222-222222222222', 'a2000000-0000-0000-0000-00000000000c', 'Moto', 'moto');

-- Comprobantes:
--   F1 factura confirmada, moto (San Javucho)          F5 factura anulada, moto (San Javucho)
--   F2 factura en borrador, moto (San Javucho)         F6 factura confirmada, moto (Mundo JC)
--   F3 factura confirmada, correo (San Javucho)        F7 factura de la otra organización, moto
--   F4 presupuesto, moto (San Javucho)                 F8 factura confirmada sin forma de envío
insert into dominio.comprobantes_venta
  (id, organizacion_id, empresa_id, cliente_id, tipo, numero, fecha, estado, total_sin_iva, total_con_iva, confirmado_en, envio_id) values
  ('f1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'a1000000-0000-0000-0000-00000000000a', 'c1000000-0000-0000-0000-000000000001', 'factura', '0001-00000001', '2027-02-01', 'confirmada', 1000, 1000, now(), 'b1000000-0000-0000-0000-00000000000a'),
  ('f1000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'a1000000-0000-0000-0000-00000000000a', 'c1000000-0000-0000-0000-000000000001', 'factura', '0001-00000002', '2027-02-02', 'borrador', 500, 500, null, 'b1000000-0000-0000-0000-00000000000a'),
  ('f1000000-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111', 'a1000000-0000-0000-0000-00000000000a', 'c1000000-0000-0000-0000-000000000001', 'factura', '0001-00000003', '2027-02-03', 'confirmada', 700, 700, now(), 'b1000000-0000-0000-0000-00000000000b'),
  ('f1000000-0000-0000-0000-000000000004', '11111111-1111-1111-1111-111111111111', 'a1000000-0000-0000-0000-00000000000a', 'c1000000-0000-0000-0000-000000000001', 'presupuesto', '0002-00000004', '2027-02-04', 'borrador', 300, 300, null, 'b1000000-0000-0000-0000-00000000000a'),
  ('f1000000-0000-0000-0000-000000000005', '11111111-1111-1111-1111-111111111111', 'a1000000-0000-0000-0000-00000000000a', 'c1000000-0000-0000-0000-000000000001', 'factura', '0001-00000005', '2027-02-05', 'anulada', 300, 300, now(), 'b1000000-0000-0000-0000-00000000000a'),
  ('f1000000-0000-0000-0000-000000000006', '11111111-1111-1111-1111-111111111111', 'a1000000-0000-0000-0000-00000000000b', 'c1000000-0000-0000-0000-000000000001', 'factura', '0001-00000006', '2027-02-06', 'confirmada', 900, 900, now(), 'b1000000-0000-0000-0000-00000000000c'),
  ('f2000000-0000-0000-0000-000000000007', '22222222-2222-2222-2222-222222222222', 'a2000000-0000-0000-0000-00000000000c', 'c2000000-0000-0000-0000-000000000001', 'factura', '0001-00000007', '2027-02-07', 'confirmada', 700, 700, now(), 'b2000000-0000-0000-0000-00000000000d'),
  ('f1000000-0000-0000-0000-000000000008', '11111111-1111-1111-1111-111111111111', 'a1000000-0000-0000-0000-00000000000a', 'c1000000-0000-0000-0000-000000000001', 'factura', '0001-00000008', '2027-02-08', 'confirmada', 200, 200, now(), null);

-- Verifica como «authenticated» (RLS y permisos), igual que PostgREST.
create function pg_temp.como(p_user uuid) returns void language plpgsql as $$
begin
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
  set local role authenticated;
end $$;

-- ============================================================================
-- Esquema, RLS y grants (FR-002)
-- ============================================================================

select ok(
  exists (select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
           where n.nspname = 'dominio' and c.relname = 'envios_moto' and c.relrowsecurity),
  'envios_moto vive en «dominio» y tiene RLS activada'
);
select ok(
  not exists (select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
               where n.nspname = 'public' and c.relname = 'envios_moto'),
  'no existe una copia en «public»'
);
select is(
  (select count(*)::int from pg_policies
    where schemaname = 'dominio' and tablename = 'envios_moto' and cmd <> 'SELECT'),
  0, 'la tabla no tiene políticas de escritura (solo lectura)'
);
select ok(
  not has_table_privilege('anon', 'dominio.envios_moto', 'select')
  and not has_table_privilege('anon', 'dominio.envios_moto', 'insert')
  and not has_table_privilege('authenticated', 'dominio.envios_moto', 'insert')
  and not has_table_privilege('authenticated', 'dominio.envios_moto', 'update')
  and not has_table_privilege('authenticated', 'dominio.envios_moto', 'delete')
  and has_table_privilege('authenticated', 'dominio.envios_moto', 'select'),
  'anon sin privilegios y authenticated solo lectura (sin delete)'
);

-- Las RPC: `anon` no ejecuta ninguna; `authenticated` sí; todas con `search_path` vacío y `security definer`.
select is(
  (select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in ('registrar_envio_moto', 'actualizar_envio_moto', 'comprobantes_para_envio_moto',
                        'listar_envios_moto')
      and has_function_privilege('anon', p.oid, 'execute')),
  0, 'anon no ejecuta las RPC de envíos en moto'
);
select is(
  (select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in ('registrar_envio_moto', 'actualizar_envio_moto', 'comprobantes_para_envio_moto',
                        'listar_envios_moto')
      and has_function_privilege('authenticated', p.oid, 'execute')),
  4, 'authenticated ejecuta las cuatro RPC de envíos en moto'
);
select is(
  (select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in ('registrar_envio_moto', 'actualizar_envio_moto', 'comprobantes_para_envio_moto',
                        'listar_envios_moto')
      and p.prosecdef
      and coalesce(p.proconfig, array[]::text[]) @> array['search_path=""']),
  4, 'las cuatro RPC son security definer con search_path vacío'
);
select is(
  (select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'private'
      and p.proname in ('puede_registrar_envio_moto_en_empresa', 'puede_rendir_envio_moto_en_empresa',
                        'normalizar_mensajero')
      and (has_function_privilege('anon', p.oid, 'execute')
        or has_function_privilege('authenticated', p.oid, 'execute'))),
  0, 'las funciones internas de envíos en moto no las ejecuta ni anon ni authenticated'
);

-- Restricciones de la tabla (FR-002): se prueban como postgres, saltando RLS.
select throws_ok(
  $$insert into dominio.envios_moto (organizacion_id, comprobante_id, mensajero)
    values ('22222222-2222-2222-2222-222222222222', 'f1000000-0000-0000-0000-000000000001', 'X')$$,
  '23503', null, 'la clave foránea compuesta impide un envío de otra organización para un comprobante ajeno'
);
select throws_ok(
  $$insert into dominio.envios_moto (organizacion_id, comprobante_id, mensajero)
    values ('11111111-1111-1111-1111-111111111111', 'f1000000-0000-0000-0000-000000000001', '   ')$$,
  '23514', null, 'la tabla rechaza un mensajero vacío'
);
select throws_ok(
  $$insert into dominio.envios_moto (organizacion_id, comprobante_id, mensajero, costo_envio)
    values ('11111111-1111-1111-1111-111111111111', 'f1000000-0000-0000-0000-000000000001', 'X', -1)$$,
  '23514', null, 'la tabla rechaza un costo negativo'
);
select throws_ok(
  $$insert into dominio.envios_moto (organizacion_id, comprobante_id, mensajero, abono)
    values ('11111111-1111-1111-1111-111111111111', 'f1000000-0000-0000-0000-000000000001', 'X', -1)$$,
  '23514', null, 'la tabla rechaza un abono negativo'
);
select throws_ok(
  $$insert into dominio.envios_moto (organizacion_id, comprobante_id, mensajero, rendido)
    values ('11111111-1111-1111-1111-111111111111', 'f1000000-0000-0000-0000-000000000001', 'X', true)$$,
  '23514', null, 'la tabla rechaza rendido sin rendido_en'
);
select throws_ok(
  $$insert into dominio.envios_moto (organizacion_id, comprobante_id, mensajero, rendido_en)
    values ('11111111-1111-1111-1111-111111111111', 'f1000000-0000-0000-0000-000000000001', 'X', now())$$,
  '23514', null, 'la tabla rechaza rendido_en sin rendido'
);

-- ============================================================================
-- Elegibles para el selector (FR-003)
-- ============================================================================

-- El Operador de San Javucho ve solo las facturas con forma «moto» de su tienda, sin envío y no anuladas.
select pg_temp.como('d1000000-0000-0000-0000-000000000012');
select is(
  (select array_agg(numero order by numero) from public.comprobantes_para_envio_moto()),
  array['0001-00000001', '0001-00000002']::text[],
  'el Operador ve como elegibles solo las facturas moto no anuladas de su tienda (no presupuesto, no correo, no anulada, no sin forma, no otra tienda ni otra organización)'
);
select is(
  (select array_agg(numero) from public.comprobantes_para_envio_moto(null, '00000002')),
  array['0001-00000002']::text[], 'la búsqueda filtra por número'
);
select is(
  (select array_agg(numero) from public.comprobantes_para_envio_moto(null, 'cliente uno')),
  array['0001-00000002', '0001-00000001']::text[], 'la búsqueda también filtra por cliente (más reciente primero)'
);
select is(
  (select count(*)::int from public.comprobantes_para_envio_moto(null, '100%')),
  0, 'los comodines de la búsqueda se toman literalmente'
);
reset role;

-- El Administrador ve también las de Mundo JC, y el filtro de tienda las acota.
select pg_temp.como('d1000000-0000-0000-0000-000000000001');
select is(
  (select array_agg(numero order by numero) from public.comprobantes_para_envio_moto()),
  array['0001-00000001', '0001-00000002', '0001-00000006']::text[],
  'el Administrador ve las elegibles de todas sus tiendas'
);
select is(
  (select array_agg(numero) from public.comprobantes_para_envio_moto('a1000000-0000-0000-0000-00000000000b')),
  array['0001-00000006']::text[], 'el filtro de tienda acota las elegibles'
);
reset role;

-- Quien no puede registrar no ve elegibles (no se ofrece lo que la base rechaza).
select pg_temp.como('d1000000-0000-0000-0000-000000000005');
select is(
  (select count(*)::int from public.comprobantes_para_envio_moto()),
  0, 'Consulta (solo lectura) no tiene comprobantes elegibles'
);
reset role;

-- ============================================================================
-- registrar_envio_moto (FR-003, FR-008, FR-009)
-- ============================================================================

select pg_temp.como('d1000000-0000-0000-0000-000000000012');

select lives_ok(
  $$select public.registrar_envio_moto(
      'f1000000-0000-0000-0000-000000000001', '  Juan    Perez ', '   ', 150.50, 1000, true)$$,
  'el Operador registra el envío de una factura moto elegible'
);

-- Errores de elegibilidad y de datos (FR-003).
select throws_ok(
  $$select public.registrar_envio_moto('f1000000-0000-0000-0000-000000000001', 'Otro')$$,
  '23505', null, 'un comprobante no admite dos envíos'
);
select throws_ok(
  $$select public.registrar_envio_moto('f1000000-0000-0000-0000-000000000004', 'Juan')$$,
  '22023', null, 'un presupuesto no admite un envío en moto'
);
select throws_ok(
  $$select public.registrar_envio_moto('f1000000-0000-0000-0000-000000000003', 'Juan')$$,
  '22023', null, 'una factura con forma de envío distinta de moto se rechaza'
);
select throws_ok(
  $$select public.registrar_envio_moto('f1000000-0000-0000-0000-000000000005', 'Juan')$$,
  '22023', null, 'una factura anulada se rechaza'
);
select throws_ok(
  $$select public.registrar_envio_moto('f1000000-0000-0000-0000-000000000008', 'Juan')$$,
  '22023', null, 'una factura sin forma de envío se rechaza'
);
select throws_ok(
  $$select public.registrar_envio_moto('f1000000-0000-0000-0000-000000000002', '   ')$$,
  '22023', null, 'un mensajero vacío se rechaza'
);
select throws_ok(
  $$select public.registrar_envio_moto('f1000000-0000-0000-0000-000000000002', null)$$,
  '22023', null, 'un mensajero nulo se rechaza'
);
select throws_ok(
  $$select public.registrar_envio_moto('f1000000-0000-0000-0000-000000000002', 'Juan', null, -1, 0)$$,
  '22023', null, 'un costo de envío negativo se rechaza'
);
select throws_ok(
  $$select public.registrar_envio_moto('f1000000-0000-0000-0000-000000000002', 'Juan', null, 0, -1)$$,
  '22023', null, 'un abono negativo se rechaza'
);
select throws_ok(
  $$select public.registrar_envio_moto('f1000000-0000-0000-0000-000000000002', 'Juan', null, 1.005, 0)$$,
  '22023', null, 'un importe con más de dos decimales se rechaza'
);
select throws_ok(
  $$select public.registrar_envio_moto('f1000000-0000-0000-0000-000000000002', 'Juan', null, 0, null)$$,
  '22023', null, 'un abono nulo se rechaza'
);

-- Aislamiento y permisos de empresa: el Operador de San Javucho no registra en Mundo JC ni en otra organización.
select throws_ok(
  $$select public.registrar_envio_moto('f1000000-0000-0000-0000-000000000006', 'Juan')$$,
  '42501', null, 'el Operador de otra tienda no registra un envío en Mundo JC'
);
select throws_ok(
  $$select public.registrar_envio_moto('f2000000-0000-0000-0000-000000000007', 'Juan')$$,
  'P0002', null, 'un comprobante de otra organización no existe para la sesión'
);

-- Cero es válido en costo y abono; el mensajero se compara sin mayúsculas.
select lives_ok(
  $$select public.registrar_envio_moto('f1000000-0000-0000-0000-000000000002', 'JUAN PEREZ', null, 0, 0, false)$$,
  'costo 0 y abono 0 son válidos'
);
reset role;

select is(
  (select mensajero from dominio.envios_moto where comprobante_id = 'f1000000-0000-0000-0000-000000000001'),
  'Juan Perez', 'el mensajero se guarda normalizado (sin espacios sobrantes ni repetidos)'
);
select is(
  (select guia from dominio.envios_moto where comprobante_id = 'f1000000-0000-0000-0000-000000000001'),
  null, 'una guía en blanco se guarda como nula'
);
select is(
  (select costo_envio from dominio.envios_moto where comprobante_id = 'f1000000-0000-0000-0000-000000000001'),
  150.50::numeric, 'el costo de envío queda guardado'
);
select is(
  (select abono from dominio.envios_moto where comprobante_id = 'f1000000-0000-0000-0000-000000000001'),
  1000.00::numeric, 'el abono queda guardado'
);
select ok(
  (select enviado and not rendido and rendido_en is null
     from dominio.envios_moto where comprobante_id = 'f1000000-0000-0000-0000-000000000001'),
  'el alta nunca escribe rendido ni rendido_en'
);
select is(
  (select count(*)::int from dominio.envios_moto
    where organizacion_id = '11111111-1111-1111-1111-111111111111'),
  2, 'solo se registraron los dos envíos válidos (los rechazos no dejan filas)'
);
select is(
  (select count(distinct lower(mensajero))::int from dominio.envios_moto),
  1, 'los dos envíos son del mismo mensajero sin distinguir mayúsculas'
);

-- Eventos (FR-009).
select is(
  (select count(*)::int from public.registro_actividad
    where tipo = 'envio_moto.registrado' and organizacion_id = '11111111-1111-1111-1111-111111111111'),
  2, 'cada alta deja un evento envio_moto.registrado (los rechazos no)'
);
select is(
  (select actor_id from public.registro_actividad
    where tipo = 'envio_moto.registrado' and detalle like '%0001-00000001%'),
  'd1000000-0000-0000-0000-000000000012'::uuid, 'el evento guarda quién registró el envío'
);
select is(
  (select empresa_id from public.registro_actividad
    where tipo = 'envio_moto.registrado' and detalle like '%0001-00000001%'),
  'a1000000-0000-0000-0000-00000000000a'::uuid, 'el evento guarda la tienda del comprobante'
);
select ok(
  (select detalle like '%0001-00000001%' and detalle like '%Juan Perez%'
     from public.registro_actividad
    where tipo = 'envio_moto.registrado' and detalle like '%0001-00000001%'),
  'el evento nombra el comprobante y el mensajero'
);

-- Quien no puede registrar: Mostrador (ventas en edición pero no Operador/Administrador), Consulta, anon.
select pg_temp.como('d1000000-0000-0000-0000-000000000003');
select throws_ok(
  $$select public.registrar_envio_moto('f1000000-0000-0000-0000-000000000002', 'Pedro')$$,
  '42501', null, 'el Mostrador (ventas en edición, otro rol) no registra envíos en moto'
);
reset role;
select pg_temp.como('d1000000-0000-0000-0000-000000000005');
select throws_ok(
  $$select public.registrar_envio_moto('f1000000-0000-0000-0000-000000000002', 'Pedro')$$,
  '42501', null, 'Consulta no registra envíos en moto'
);
reset role;
select pg_temp.como('d1000000-0000-0000-0000-000000000013');
select throws_ok(
  $$select public.registrar_envio_moto('f1000000-0000-0000-0000-000000000002', 'Pedro')$$,
  '42501', null, 'el Operador de Mundo JC no registra en San Javucho'
);
reset role;
select set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);
set local role anon;
select throws_ok(
  $$select public.registrar_envio_moto('f1000000-0000-0000-0000-000000000002', 'Pedro')$$,
  '42501', null, 'anon no registra envíos en moto'
);
reset role;

-- El Administrador sí registra (F6 de Mundo JC) y el evento queda en esa tienda.
select pg_temp.como('d1000000-0000-0000-0000-000000000001');
select lives_ok(
  $$select public.registrar_envio_moto('f1000000-0000-0000-0000-000000000006', 'Marta Gómez', 'G-77', 80, 400, false)$$,
  'el Administrador registra un envío en otra tienda de su organización'
);
reset role;
select is(
  (select empresa_id from public.registro_actividad
    where tipo = 'envio_moto.registrado' and detalle like '%0001-00000006%'),
  'a1000000-0000-0000-0000-00000000000b'::uuid, 'el evento del Administrador guarda la tienda de Mundo JC'
);

-- ============================================================================
-- actualizar_envio_moto (FR-005, FR-008, FR-009)
-- ============================================================================

select pg_temp.como('d1000000-0000-0000-0000-000000000012');

-- Conflicto de versión (bloqueo optimista).
select throws_ok(
  $$select public.actualizar_envio_moto(
      (select id from dominio.envios_moto where comprobante_id = 'f1000000-0000-0000-0000-000000000001'),
      'Juan Perez', null, 150.50, 1000, true,
      (select updated_at - interval '1 second' from dominio.envios_moto
        where comprobante_id = 'f1000000-0000-0000-0000-000000000001'))$$,
  '40001', null, 'una versión vieja del envío da conflicto 40001'
);
select throws_ok(
  $$select public.actualizar_envio_moto(
      (select id from dominio.envios_moto where comprobante_id = 'f1000000-0000-0000-0000-000000000001'),
      'Juan Perez', null, 150.50, 1000, true, null)$$,
  '40001', null, 'sin versión leída también da conflicto 40001'
);

-- Validaciones.
select throws_ok(
  $$select public.actualizar_envio_moto(
      (select id from dominio.envios_moto where comprobante_id = 'f1000000-0000-0000-0000-000000000001'),
      '  ', null, 150.50, 1000, true,
      (select updated_at from dominio.envios_moto where comprobante_id = 'f1000000-0000-0000-0000-000000000001'))$$,
  '22023', null, 'la edición rechaza un mensajero vacío'
);
select throws_ok(
  $$select public.actualizar_envio_moto(
      (select id from dominio.envios_moto where comprobante_id = 'f1000000-0000-0000-0000-000000000001'),
      'Juan Perez', null, -5, 1000, true,
      (select updated_at from dominio.envios_moto where comprobante_id = 'f1000000-0000-0000-0000-000000000001'))$$,
  '22023', null, 'la edición rechaza un costo negativo'
);
select throws_ok(
  $$select public.actualizar_envio_moto('f1999999-0000-0000-0000-000000000099', 'Juan', null, 0, 0, true, now())$$,
  'P0002', null, 'un envío inexistente no se edita'
);

-- Edición válida: cambia mensajero, guía, costo, abono y Enviado.
select lives_ok(
  $$select public.actualizar_envio_moto(
      (select id from dominio.envios_moto where comprobante_id = 'f1000000-0000-0000-0000-000000000001'),
      '  Carlos  López ', ' G-100 ', 200, 1200.25, false,
      (select updated_at from dominio.envios_moto where comprobante_id = 'f1000000-0000-0000-0000-000000000001'))$$,
  'el Operador edita el envío con la versión vigente'
);
reset role;

select is(
  (select mensajero from dominio.envios_moto where comprobante_id = 'f1000000-0000-0000-0000-000000000001'),
  'Carlos López', 'la edición guarda el mensajero normalizado'
);
select is(
  (select guia from dominio.envios_moto where comprobante_id = 'f1000000-0000-0000-0000-000000000001'),
  'G-100', 'la edición guarda la guía sin espacios sobrantes'
);
select ok(
  (select costo_envio = 200 and abono = 1200.25 and not enviado
     from dominio.envios_moto where comprobante_id = 'f1000000-0000-0000-0000-000000000001'),
  'la edición guarda costo, abono y Enviado'
);
select ok(
  (select not rendido and rendido_en is null
     from dominio.envios_moto where comprobante_id = 'f1000000-0000-0000-0000-000000000001'),
  'la edición deja rendido y rendido_en intactos'
);
select is(
  (select count(*)::int from public.registro_actividad
    where tipo = 'envio_moto.actualizado' and organizacion_id = '11111111-1111-1111-1111-111111111111'),
  1, 'la edición deja un evento envio_moto.actualizado (los rechazos no)'
);
select ok(
  (select detalle like '%0001-00000001%' and detalle like '%Carlos López%' and detalle like '%Juan Perez%'
     from public.registro_actividad where tipo = 'envio_moto.actualizado'),
  'el evento nombra el comprobante, el mensajero y el cambio'
);
select is(
  (select actor_id from public.registro_actividad where tipo = 'envio_moto.actualizado'),
  'd1000000-0000-0000-0000-000000000012'::uuid, 'el evento guarda quién editó'
);

-- La versión avanzó: la versión anterior ya no sirve.
select pg_temp.como('d1000000-0000-0000-0000-000000000012');
select lives_ok(
  $$select public.actualizar_envio_moto(
      (select id from dominio.envios_moto where comprobante_id = 'f1000000-0000-0000-0000-000000000001'),
      'Carlos López', 'G-100', 200, 1200.25, true,
      (select updated_at from dominio.envios_moto where comprobante_id = 'f1000000-0000-0000-0000-000000000001'))$$,
  'una segunda edición con la versión nueva (marcar Enviado) funciona'
);
reset role;
select ok(
  (select enviado from dominio.envios_moto where comprobante_id = 'f1000000-0000-0000-0000-000000000001'),
  'el Operador marca el envío como Enviado'
);

-- Permisos de edición.
select pg_temp.como('d1000000-0000-0000-0000-000000000003');
select throws_ok(
  $$select public.actualizar_envio_moto(
      (select id from dominio.envios_moto where comprobante_id = 'f1000000-0000-0000-0000-000000000001'),
      'Otro', null, 0, 0, true, now())$$,
  '42501', null, 'el Mostrador no edita envíos en moto'
);
reset role;
select pg_temp.como('d1000000-0000-0000-0000-000000000005');
select throws_ok(
  $$select public.actualizar_envio_moto(
      (select id from dominio.envios_moto where comprobante_id = 'f1000000-0000-0000-0000-000000000001'),
      'Otro', null, 0, 0, true, now())$$,
  '42501', null, 'Consulta no edita envíos en moto'
);
reset role;
-- El id se guarda como postgres: quien no ve la fila (RLS) no podría resolverlo con un subselect.
select set_config('t.envio_f1',
  (select id::text from dominio.envios_moto where comprobante_id = 'f1000000-0000-0000-0000-000000000001'), true);
select pg_temp.como('d1000000-0000-0000-0000-000000000013');
select throws_ok(
  $$select public.actualizar_envio_moto(current_setting('t.envio_f1')::uuid, 'Otro', null, 0, 0, true, now())$$,
  '42501', null, 'el Operador de otra tienda no edita el envío de San Javucho'
);
reset role;
select pg_temp.como('d2000000-0000-0000-0000-000000000001');
select throws_ok(
  $$select public.actualizar_envio_moto(current_setting('t.envio_f1')::uuid, 'Otro', null, 0, 0, true, now())$$,
  'P0002', null, 'otra organización no ve ni edita el envío'
);
reset role;
select set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);
set local role anon;
select throws_ok(
  $$select public.actualizar_envio_moto('f1999999-0000-0000-0000-000000000099', 'Otro', null, 0, 0, true, now())$$,
  '42501', null, 'anon no edita envíos en moto'
);
reset role;

-- Un envío rendido es de solo lectura (55000). La rendición la hace otra RPC (F-VTA-25); acá se deja el
-- estado como lo dejaría ella, desde el fixture.
update dominio.envios_moto
   set enviado = true, rendido = true, rendido_en = now()
 where comprobante_id = 'f1000000-0000-0000-0000-000000000002';

select pg_temp.como('d1000000-0000-0000-0000-000000000012');
select throws_ok(
  $$select public.actualizar_envio_moto(
      (select id from dominio.envios_moto where comprobante_id = 'f1000000-0000-0000-0000-000000000002'),
      'Nuevo', null, 9, 9, true,
      (select updated_at from dominio.envios_moto where comprobante_id = 'f1000000-0000-0000-0000-000000000002'))$$,
  '55000', null, 'un envío rendido no se edita (solo lectura)'
);
reset role;
select ok(
  (select rendido and rendido_en is not null and mensajero = 'JUAN PEREZ' and abono = 0
     from dominio.envios_moto where comprobante_id = 'f1000000-0000-0000-0000-000000000002'),
  'el intento sobre un envío rendido no cambia nada (rendido y rendido_en intactos)'
);

-- Sin escritura directa: ni siquiera el Administrador toca `rendido` por escrito.
select pg_temp.como('d1000000-0000-0000-0000-000000000001');
select throws_ok(
  $$update dominio.envios_moto set rendido = true, rendido_en = now()$$,
  '42501', null, 'nadie rinde por escrito directo: solo la RPC de rendición'
);
select throws_ok(
  $$insert into dominio.envios_moto (comprobante_id, mensajero)
    values ('f1000000-0000-0000-0000-000000000006', 'Directo')$$,
  '42501', null, 'nadie inserta envíos por escrito directo'
);
select throws_ok(
  $$delete from dominio.envios_moto$$,
  '42501', null, 'no existe el borrado de un envío'
);
reset role;

-- ============================================================================
-- Lectura: listado y RLS (FR-006, FR-007, FR-008)
-- ============================================================================

-- El Operador de San Javucho: dos filas de su tienda, la rendida sin «Editar».
select pg_temp.como('d1000000-0000-0000-0000-000000000012');
select is(
  (select count(*)::int from public.listar_envios_moto()),
  2, 'el Operador lista los envíos de su tienda (no los de Mundo JC)'
);
select is(
  (select max(filas) from public.listar_envios_moto()),
  2::bigint, 'el listado trae el total de filas'
);
select is(
  (select array_agg(comprobante_numero) from public.listar_envios_moto()),
  array['0001-00000002', '0001-00000001']::text[], 'el listado va de más reciente a más antiguo'
);
select ok(
  (select puede_editar from public.listar_envios_moto() where comprobante_numero = '0001-00000001'),
  'el Operador puede editar un envío no rendido'
);
select ok(
  (select not puede_editar from public.listar_envios_moto() where comprobante_numero = '0001-00000002'),
  'un envío rendido no se puede editar'
);
select ok(
  (select not bool_or(puede_rendir) from public.listar_envios_moto()),
  'el Operador no puede rendir'
);
select is(
  (select cliente from public.listar_envios_moto() where comprobante_numero = '0001-00000001'),
  'Cliente Uno', 'el listado trae el cliente'
);
select is(
  (select count(*)::int from dominio.envios_moto),
  2, 'la RLS deja al Operador ver solo los envíos de su tienda'
);
select is(
  (select count(*)::int from public.listar_envios_moto(null, 2, 1)),
  1, 'la paginación en servidor recorta la página'
);
reset role;

-- El Administrador: las tres filas, y puede rendir las enviadas y no rendidas.
select pg_temp.como('d1000000-0000-0000-0000-000000000001');
select is(
  (select count(*)::int from public.listar_envios_moto()),
  3, 'el Administrador lista los envíos de todas sus tiendas'
);
select is(
  (select count(*)::int from public.listar_envios_moto('a1000000-0000-0000-0000-00000000000b')),
  1, 'el filtro de tienda acota el listado'
);
select is(
  (select array_agg(comprobante_numero order by comprobante_numero)
     from public.listar_envios_moto() where puede_rendir),
  array['0001-00000001']::text[], 'puede_rendir solo en lo enviado y no rendido'
);
reset role;

-- Consulta: lee pero no escribe.
select pg_temp.como('d1000000-0000-0000-0000-000000000005');
select is(
  (select count(*)::int from public.listar_envios_moto()),
  2, 'Consulta lista los envíos de su tienda'
);
select ok(
  (select not bool_or(puede_editar) and not bool_or(puede_rendir) from public.listar_envios_moto()),
  'Consulta no puede editar ni rendir'
);
reset role;

-- Aislamiento por empresa y por organización.
select pg_temp.como('d1000000-0000-0000-0000-000000000013');
select is(
  (select array_agg(comprobante_numero) from public.listar_envios_moto()),
  array['0001-00000006']::text[], 'el Operador de Mundo JC solo ve su tienda'
);
select is(
  (select count(*)::int from dominio.envios_moto),
  1, 'la RLS acota por empresa del comprobante'
);
reset role;
select pg_temp.como('d2000000-0000-0000-0000-000000000001');
select is(
  (select count(*)::int from public.listar_envios_moto()),
  0, 'otra organización no lista envíos ajenos'
);
select is(
  (select count(*)::int from dominio.envios_moto),
  0, 'otra organización no lee envíos ajenos'
);
reset role;

select set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);
set local role anon;
select throws_ok(
  $$select count(*) from dominio.envios_moto$$,
  '42501', null, 'anon no lee la tabla'
);
select throws_ok(
  $$select * from public.listar_envios_moto()$$,
  '42501', null, 'anon no lista envíos en moto'
);
reset role;

-- Sin Ventas no hay lectura.
update permisos_rol set nivel = 'ninguno'
 where organizacion_id = '11111111-1111-1111-1111-111111111111' and rol_id = 'consulta' and seccion = 'ventas';
select pg_temp.como('d1000000-0000-0000-0000-000000000005');
select throws_ok(
  $$select * from public.listar_envios_moto()$$,
  '42501', null, 'sin Ventas no se listan los envíos en moto'
);
select throws_ok(
  $$select * from public.comprobantes_para_envio_moto()$$,
  '42501', null, 'sin Ventas no se ofrecen comprobantes elegibles'
);
select is(
  (select count(*)::int from dominio.envios_moto),
  0, 'sin Ventas la RLS no deja leer la tabla'
);
reset role;

select * from finish();

rollback;
