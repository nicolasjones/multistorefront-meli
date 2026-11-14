-- MSF-945 (épica MSF-515, Lote 1; hallazgo H-1 de T070 de MSF-176): el visitante de `dominio.tienda_envios` es un HMAC con
-- un secreto del servidor (Vault `visitante_hmac`) y no un sha256 enumerable; la lectura de la tabla exige edición en
-- Empresas y empresa accesible; los hashes viejos se reemplazan por `legado`; el límite por visitante sigue funcionando y
-- ni presupuestos ni consultas guardan IP ni visitante.
begin;

select plan(43);

-- ============================================================================
-- Fixture (como postgres)
-- ============================================================================

insert into organizaciones (id, nombre) values
  ('11111111-1111-1111-1111-111111111111', 'Organización Uno'),
  ('22222222-2222-2222-2222-222222222222', 'Organización Dos');

insert into auth.users (id, email) values
  ('d1000000-0000-0000-0000-000000000001', 'admin-uno@example.com'),
  ('d1000000-0000-0000-0000-000000000002', 'operador-a@example.com'),
  ('d1000000-0000-0000-0000-000000000003', 'lectura-a@example.com'),
  ('d1000000-0000-0000-0000-000000000004', 'ventas-a@example.com'),
  ('d2000000-0000-0000-0000-000000000001', 'admin-dos@example.com');

insert into usuarios_organizacion (user_id, organizacion_id, rol_id, estado) values
  ('d1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'administrador', 'activo'),
  ('d1000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'operador', 'activo'),
  ('d1000000-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111', 'consulta', 'activo'),
  ('d1000000-0000-0000-0000-000000000004', '11111111-1111-1111-1111-111111111111', 'mostrador', 'activo'),
  ('d2000000-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', 'administrador', 'activo');

insert into dominio.empresas (id, organizacion_id, nombre, activa) values
  ('e1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'Tienda A', true),
  ('e1000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'Tienda B', true),
  ('e2000000-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', 'Tienda Dos', true);

-- Las tres personas por empresa están asignadas a la Tienda A (no a la B). Operador: edición en Empresas (permiso
-- ajustado a propósito); consulta: solo lectura en Empresas; mostrador: sin acceso a Empresas.
insert into public.usuarios_empresas (user_id, empresa_id, organizacion_id, rol_id) values
  ('d1000000-0000-0000-0000-000000000002', 'e1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'operador'),
  ('d1000000-0000-0000-0000-000000000003', 'e1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'consulta'),
  ('d1000000-0000-0000-0000-000000000004', 'e1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'mostrador');
insert into public.permisos_rol (organizacion_id, rol_id, seccion, nivel) values
  ('11111111-1111-1111-1111-111111111111', 'operador', 'empresas', 'edicion'),
  ('11111111-1111-1111-1111-111111111111', 'consulta', 'empresas', 'lectura'),
  ('11111111-1111-1111-1111-111111111111', 'mostrador', 'empresas', 'ninguno')
on conflict (organizacion_id, rol_id, seccion) do update set nivel = excluded.nivel;

create function pg_temp.como(p_user uuid) returns void language plpgsql as $$
begin
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
  set local role authenticated;
end;
$$;

-- ============================================================================
-- Secreto y privilegios
-- ============================================================================

select is((select length(decrypted_secret) from vault.decrypted_secrets where name = 'visitante_hmac'), 64,
  'el secreto visitante_hmac existe en Vault (32 bytes aleatorios en hex)');
select isnt((select decrypted_secret from vault.decrypted_secrets where name = 'visitante_hmac'),
            (select decrypted_secret from vault.decrypted_secrets where name = 'acceso_hmac'),
  'el secreto es propio, distinto del de acceso (cada entorno genera el suyo)');
select is(
  has_function_privilege('anon', 'private.hmac_visitante(text)', 'execute')
  or has_function_privilege('authenticated', 'private.hmac_visitante(text)', 'execute')
  or has_function_privilege('anon', 'private.visitante_hash(uuid)', 'execute')
  or has_function_privilege('authenticated', 'private.visitante_hash(uuid)', 'execute')
  or has_function_privilege('anon', 'private.inicializar_visitante_hmac()', 'execute')
  or has_function_privilege('authenticated', 'private.inicializar_visitante_hmac()', 'execute'),
  false, 'ni anon ni authenticated ejecutan el HMAC, el hash del visitante ni la inicialización');
select is(
  (select bool_and(p.prosecdef and p.proconfig = array['search_path=""'])
     from pg_proc p where p.oid in ('private.hmac_visitante(text)'::regprocedure, 'private.inicializar_visitante_hmac()'::regprocedure)),
  true, 'las funciones que tocan Vault son security definer con search_path vacío');

-- ============================================================================
-- El visitante es un HMAC con el secreto del servidor
-- ============================================================================

select set_config('request.headers', '{"x-forwarded-for": "203.0.113.7"}', true);

select is(
  private.visitante_hash('e1000000-0000-0000-0000-000000000001'),
  encode(extensions.hmac('203.0.113.7|e1000000-0000-0000-0000-000000000001',
                         (select decrypted_secret from vault.decrypted_secrets where name = 'visitante_hmac'), 'sha256'), 'hex'),
  'visitante_hash = HMAC-SHA256(ip|empresa) con el secreto de Vault');
select isnt(
  private.visitante_hash('e1000000-0000-0000-0000-000000000001'),
  encode(sha256(convert_to('203.0.113.7|e1000000-0000-0000-0000-000000000001', 'UTF8')), 'hex'),
  'ya no es el sha256 sin clave: enumerar IPv4 no recupera la IP');
select matches(private.visitante_hash('e1000000-0000-0000-0000-000000000001'), '^[0-9a-f]{64}$', 'sigue siendo hex de 64 caracteres');
select is(private.visitante_hash('e1000000-0000-0000-0000-000000000001'), private.visitante_hash('e1000000-0000-0000-0000-000000000001'),
  'es determinista (el límite por visitante depende de eso)');
select isnt(private.visitante_hash('e1000000-0000-0000-0000-000000000001'), private.visitante_hash('e1000000-0000-0000-0000-000000000002'),
  'cambia con la empresa');
select set_config('request.headers', '{"x-forwarded-for": "203.0.113.8"}', true);
select isnt(private.visitante_hash('e1000000-0000-0000-0000-000000000001'),
            encode(extensions.hmac('203.0.113.7|e1000000-0000-0000-0000-000000000001',
                                   (select decrypted_secret from vault.decrypted_secrets where name = 'visitante_hmac'), 'sha256'), 'hex'),
  'cambia con la IP');
select set_config('request.headers', '', true);
select is(
  private.visitante_hash('e1000000-0000-0000-0000-000000000001'),
  private.hmac_visitante('sin-ip|e1000000-0000-0000-0000-000000000001'),
  'sin cabecera: cupo único «sin-ip», también con HMAC');

-- ============================================================================
-- El límite por visitante sigue funcionando
-- ============================================================================

select set_config('request.headers', '{"x-forwarded-for": "203.0.113.50"}', true);
create temp table est (n int primary key, estado text);
insert into est
select n, private.registrar_envio_tienda('e1000000-0000-0000-0000-000000000001', 'presupuesto', ('00000000-0000-0000-0000-0000000000' || lpad(n::text, 2, '0'))::uuid) ->> 'estado'
  from generate_series(1, 6) n;
select is((select string_agg(estado, ',' order by n) from est), 'nuevo,nuevo,nuevo,nuevo,nuevo,limite',
  'el mismo visitante hace 5 envíos por hora y el sexto queda en «limite»');
select is(private.registrar_envio_tienda('e1000000-0000-0000-0000-000000000001', 'presupuesto', '00000000-0000-0000-0000-000000000001') ->> 'estado', 'repetido',
  'repetir la clave sigue siendo idempotente');
select set_config('request.headers', '{"x-forwarded-for": "203.0.113.51"}', true);
select is(private.registrar_envio_tienda('e1000000-0000-0000-0000-000000000001', 'pedido', '00000000-0000-0000-0000-0000000000a1') ->> 'estado', 'nuevo',
  'otro visitante tiene su propio cupo');
select set_config('request.headers', '{"x-forwarded-for": "203.0.113.50"}', true);
select is(private.registrar_envio_tienda('e1000000-0000-0000-0000-000000000002', 'pedido', '00000000-0000-0000-0000-0000000000b1') ->> 'estado', 'nuevo',
  'el mismo visitante en otra empresa tiene otro cupo');
select is(
  (select count(*)::int from dominio.tienda_envios where empresa_id = 'e1000000-0000-0000-0000-000000000001' and visitante = private.visitante_hash('e1000000-0000-0000-0000-000000000001')),
  5, 'se guardaron 5 filas con el HMAC del visitante');
select is((select count(*)::int from dominio.tienda_envios where clave_envio::text like '00000000-0000-0000-0000-0000000000%' and visitante !~ '^[0-9a-f]{64}$'), 0, 'ninguna fila guarda la IP en claro');
select is((select count(*)::int from dominio.tienda_envios where visitante = encode(sha256(convert_to('203.0.113.50|e1000000-0000-0000-0000-000000000001', 'UTF8')), 'hex')), 0,
  'ninguna fila coincide con el sha256 sin clave de la IP');

-- ============================================================================
-- Ligar IP con cuenta de cliente: ninguna otra tabla guarda IP ni visitante
-- ============================================================================

select is(
  (select count(*)::int from information_schema.columns
    where table_schema = 'dominio' and table_name in ('presupuestos_tienda', 'consultas', 'consulta_items', 'cuentas_cliente_tienda')
      and column_name ~ '(^|_)(ip|visitante|hash)(_|$)'),
  0, 'presupuestos_tienda, consultas y las cuentas no guardan IP ni visitante');
select is(
  (select count(*)::int from pg_constraint c
    where c.contype = 'f' and c.conrelid = 'dominio.tienda_envios'::regclass and c.confrelid <> 'dominio.empresas'::regclass and c.confrelid <> 'public.organizaciones'::regclass),
  0, 'tienda_envios no referencia cuentas ni presupuestos: el único dato en común es la clave_envio');

-- ============================================================================
-- Lectura de la tabla: edición en Empresas + empresa accesible
-- ============================================================================

select pg_temp.como('d1000000-0000-0000-0000-000000000001');
select is((select count(*)::int from dominio.tienda_envios where clave_envio::text like '00000000-0000-0000-0000-0000000000%'), 7, 'administrador (edición en Empresas, todas las empresas): ve los envíos de su organización');
reset role;

select pg_temp.como('d1000000-0000-0000-0000-000000000002');
select is((select count(*)::int from dominio.tienda_envios where clave_envio::text like '00000000-0000-0000-0000-0000000000%'), 6, 'operador con edición en Empresas y asignado solo a la Tienda A: ve solo los de la A');
select is((select count(*)::int from dominio.tienda_envios where empresa_id = 'e1000000-0000-0000-0000-000000000002'), 0, 'no ve los de la Tienda B (no la tiene asignada)');
reset role;

select pg_temp.como('d1000000-0000-0000-0000-000000000003');
select is((select count(*)::int from dominio.tienda_envios where clave_envio::text like '00000000-0000-0000-0000-0000000000%'), 0, 'con solo lectura en Empresas no ve nada');
reset role;

select pg_temp.como('d1000000-0000-0000-0000-000000000004');
select is((select count(*)::int from dominio.tienda_envios where clave_envio::text like '00000000-0000-0000-0000-0000000000%'), 0, 'sin acceso a Empresas (aunque tenga Ventas) no ve nada');
reset role;

select pg_temp.como('d2000000-0000-0000-0000-000000000001');
select is((select count(*)::int from dominio.tienda_envios where clave_envio::text like '00000000-0000-0000-0000-0000000000%'), 0, 'otra organización no ve nada');
reset role;

select is(has_table_privilege('anon', 'dominio.tienda_envios', 'select'), false, 'anon sigue sin acceso a la tabla');
select ok(
  exists (select 1 from pg_policies where schemaname = 'dominio' and tablename = 'tienda_envios' and policyname = 'tienda_envios_select'
            and qual like '%nivel_seccion%' and qual like '%empresas%' and qual like '%edicion%' and qual like '%empresas_accesibles%'),
  'la política exige la sección Empresas en edición y la empresa accesible');

-- ============================================================================
-- Falla cerrada sin el secreto
-- ============================================================================

delete from vault.secrets where name = 'visitante_hmac';
select throws_ok($$select private.hmac_visitante('x')$$, 'P0001', 'falta el secreto visitante_hmac en Vault', 'sin secreto el HMAC falla (no vuelve al sha256)');
select throws_ok($$select private.visitante_hash('e1000000-0000-0000-0000-000000000001')$$, 'P0001', 'falta el secreto visitante_hmac en Vault', 'sin secreto no hay visitante: el envío se rechaza');
select throws_ok(
  $$select private.registrar_envio_tienda('e1000000-0000-0000-0000-000000000001', 'formulario', '00000000-0000-0000-0000-0000000000ff')$$,
  'P0001', 'falta el secreto visitante_hmac en Vault', 'sin secreto no se registra ningún envío');

-- ============================================================================
-- Migración de los hashes existentes (inicializar_visitante_hmac)
-- ============================================================================

-- Antes del cambio: filas con sha256 sin clave (64 hex), una con otro formato y una ya marcada.
delete from dominio.tienda_envios;
insert into dominio.tienda_envios (organizacion_id, empresa_id, visitante, clave_envio, origen) values
  ('11111111-1111-1111-1111-111111111111', 'e1000000-0000-0000-0000-000000000001',
   encode(sha256(convert_to('203.0.113.7|e1000000-0000-0000-0000-000000000001', 'UTF8')), 'hex'), '00000000-0000-0000-0000-0000000000c1', 'formulario'),
  ('11111111-1111-1111-1111-111111111111', 'e1000000-0000-0000-0000-000000000001',
   encode(sha256(convert_to('sin-ip|e1000000-0000-0000-0000-000000000001', 'UTF8')), 'hex'), '00000000-0000-0000-0000-0000000000c2', 'pedido'),
  ('11111111-1111-1111-1111-111111111111', 'e1000000-0000-0000-0000-000000000002', 'x', '00000000-0000-0000-0000-0000000000c3', 'whatsapp');
-- El visitante 203.0.113.7 ya agotó su cupo (5 envíos en la última hora) con el hash viejo: con el esquema anterior el sexto sería «limite».
insert into dominio.tienda_envios (organizacion_id, empresa_id, visitante, clave_envio, origen)
select '11111111-1111-1111-1111-111111111111', 'e1000000-0000-0000-0000-000000000001',
       encode(sha256(convert_to('203.0.113.7|e1000000-0000-0000-0000-000000000001', 'UTF8')), 'hex'),
       ('00000000-0000-0000-0000-0000000000d' || n)::uuid, 'formulario'
  from generate_series(1, 4) n;
select is(
  (select count(*)::int from dominio.tienda_envios
    where empresa_id = 'e1000000-0000-0000-0000-000000000001' and creado_en > now() - interval '1 hour'
      and visitante = encode(sha256(convert_to('203.0.113.7|e1000000-0000-0000-0000-000000000001', 'UTF8')), 'hex')),
  5, 'antes de la inicialización el visitante tiene el cupo agotado con el hash sha256 viejo');

select is(private.inicializar_visitante_hmac(), true, 'la primera vez crea el secreto');
select is((select count(*)::int from vault.secrets where name = 'visitante_hmac'), 1, 'el secreto quedó en Vault');
select is((select count(*)::int from dominio.tienda_envios where visitante = 'legado'), 6, 'los seis hashes sha256 viejos se reemplazan por «legado»');
select is((select count(*)::int from dominio.tienda_envios where visitante = encode(sha256(convert_to('203.0.113.7|e1000000-0000-0000-0000-000000000001', 'UTF8')), 'hex')), 0, 'ya no queda ninguna fila con el sha256 de la IP');
select is((select visitante from dominio.tienda_envios where clave_envio = '00000000-0000-0000-0000-0000000000c3'), 'x', 'un visitante con otro formato no se toca');
select is((select count(*)::int from dominio.tienda_envios where clave_envio in ('00000000-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-0000000000c2', '00000000-0000-0000-0000-0000000000d1')), 3,
  'las claves de idempotencia se conservan');

-- Ya con secreto: un HMAC nuevo (64 hex) no se confunde con un hash viejo en una segunda corrida, y el viejo no revive el cupo.
select set_config('request.headers', '{"x-forwarded-for": "203.0.113.7"}', true);
select is(
  (select count(*)::int from dominio.tienda_envios
    where empresa_id = 'e1000000-0000-0000-0000-000000000001' and visitante = private.visitante_hash('e1000000-0000-0000-0000-000000000001')),
  0, 'el HMAC del visitante no tiene ningún envío previo: los 5 del hash viejo ya no cuentan para él');
select is(private.registrar_envio_tienda('e1000000-0000-0000-0000-000000000001', 'formulario', '00000000-0000-0000-0000-0000000000c4') ->> 'estado', 'nuevo',
  'tras la migración el visitante que había agotado su cupo vuelve a tener cupo solo porque su hash viejo pasó a «legado»');
select is(private.inicializar_visitante_hmac(), false, 'repetirla no crea otro secreto');
select is((select count(*)::int from dominio.tienda_envios where visitante = private.visitante_hash('e1000000-0000-0000-0000-000000000001')), 1,
  'repetirla tampoco pisa los HMAC nuevos');
select is((select count(*)::int from vault.secrets where name = 'visitante_hmac'), 1, 'sigue habiendo un único secreto');

select * from finish();
rollback;
