-- MSF-470 · T022 (F-ACC-01, FR-003): bloqueo de intentos aplicado en el servidor
-- por el Auth Hook «password verification attempt».
begin;

select plan(29);

insert into auth.users (id, email) values
  ('b1000000-0000-0000-0000-000000000001', 'hook-uno@example.com'),
  ('b1000000-0000-0000-0000-000000000002', 'hook-dos@example.com'),
  ('b1000000-0000-0000-0000-000000000003', 'hook-tres@example.com'),
  ('b1000000-0000-0000-0000-000000000004', 'hook-cuatro@example.com'),
  ('b1000000-0000-0000-0000-000000000005', repeat('a', 250) || '@x.com'),
  ('b1000000-0000-0000-0000-000000000006', 'hook-seis@example.com');

-- Privilegios: solo GoTrue ejecuta el hook
select is(has_function_privilege('supabase_auth_admin',
  'public.verificar_intento_acceso(jsonb)', 'execute'), true,
  'supabase_auth_admin ejecuta el hook');
select is(has_function_privilege('anon',
  'public.verificar_intento_acceso(jsonb)', 'execute'), false,
  'anon no ejecuta el hook');
select is(has_function_privilege('authenticated',
  'public.verificar_intento_acceso(jsonb)', 'execute'), false,
  'authenticated no ejecuta el hook');

-- Contraseña inválida: continúa (GoTrue devuelve su error normal) y cuenta
select is(
  public.verificar_intento_acceso(
    '{"user_id":"b1000000-0000-0000-0000-000000000001","valid":false}'::jsonb) ->> 'decision',
  'continue', 'un fallo no rechaza todavía');
select is((select fallos from public.intentos_acceso
  where correo_hash = private.hash_correo_acceso('hook-uno@example.com')), 1,
  'el hook cuenta el fallo del usuario existente');

-- El cliente reporta el mismo intento justo después: no se cuenta dos veces
select public.registrar_fallo_acceso('hook-uno@example.com');
select is((select fallos from public.intentos_acceso
  where correo_hash = private.hash_correo_acceso('hook-uno@example.com')), 1,
  'registrar_fallo_acceso ignora el intento que el hook ya contó');

-- Un correo que no pasa por el hook sigue contando desde el cliente
select public.registrar_fallo_acceso('inexistente-hook@example.com');
select is((select fallos from public.intentos_acceso
  where correo_hash = private.hash_correo_acceso('inexistente-hook@example.com')), 1,
  'el cliente sigue contando correos inexistentes');

-- 5 fallos directos al hook (llamado directo a /token) bloquean
select public.verificar_intento_acceso(
  '{"user_id":"b1000000-0000-0000-0000-000000000001","valid":false}'::jsonb)
from generate_series(1, 4);
select isnt(public.bloqueo_acceso_hasta('hook-uno@example.com'), null::timestamptz,
  '5 fallos pasando solo por el hook bloquean el correo');

-- Bloqueado: rechaza aunque la contraseña sea correcta
select is(
  public.verificar_intento_acceso(
    '{"user_id":"b1000000-0000-0000-0000-000000000001","valid":true}'::jsonb) ->> 'decision',
  'reject', 'bloqueado rechaza aunque la contraseña sea válida');
select is((select fallos from public.intentos_acceso
  where correo_hash = private.hash_correo_acceso('hook-uno@example.com')), 5,
  'un intento rechazado no reabre ni reinicia el contador');

-- Sin bloqueo: una contraseña válida limpia el contador
select public.verificar_intento_acceso(
  '{"user_id":"b1000000-0000-0000-0000-000000000002","valid":false}'::jsonb);
select is(
  public.verificar_intento_acceso(
    '{"user_id":"b1000000-0000-0000-0000-000000000002","valid":true}'::jsonb) ->> 'decision',
  'continue', 'sin bloqueo y contraseña válida continúa');
select is((select count(*) from public.intentos_acceso
  where correo_hash = private.hash_correo_acceso('hook-dos@example.com')), 0::bigint,
  'una contraseña válida limpia el contador');

-- Purga desde el hook aunque nadie falle: una fila vieja se elimina
insert into public.intentos_acceso (correo_hash, fallos, ultimo_fallo)
values (private.hash_correo_acceso('vieja-hook@example.com'), 1, now() - interval '30 minutes');
select public.verificar_intento_acceso(
  '{"user_id":"b1000000-0000-0000-0000-000000000002","valid":true}'::jsonb);
select is((select count(*) from public.intentos_acceso
  where correo_hash = private.hash_correo_acceso('vieja-hook@example.com')), 0::bigint,
  'el hook purga intentos viejos aunque el ingreso sea exitoso');

-- Usuario desconocido: no hay contador que aplicar
select is(
  public.verificar_intento_acceso(
    '{"user_id":"b1000000-0000-0000-0000-0000000000ff","valid":false}'::jsonb) ->> 'decision',
  'continue', 'un usuario desconocido no rompe el hook');

-- HMAC: el hash ya no es el sha256 sin clave del correo
select isnt(private.hash_correo_acceso('hook-uno@example.com'),
  encode(extensions.digest('hook-uno@example.com', 'sha256'), 'hex'),
  'el hash del correo usa HMAC con secreto, no sha256 sin clave');
select is(private.hash_correo_acceso('  HOOK-Uno@Example.com '),
  private.hash_correo_acceso('hook-uno@example.com'),
  'el hash normaliza mayúsculas y espacios');

-- Bloqueado: un intento inválido se rechaza y no suma fallos
select is(
  public.verificar_intento_acceso(
    '{"user_id":"b1000000-0000-0000-0000-000000000001","valid":false}'::jsonb) ->> 'decision',
  'reject', 'bloqueado rechaza también una contraseña inválida');
select is((select fallos from public.intentos_acceso
  where correo_hash = private.hash_correo_acceso('hook-uno@example.com')), 5,
  'un intento inválido estando bloqueado no incrementa el contador');

-- Bloqueo vencido: ya no rechaza y el conteo reinicia
insert into public.intentos_acceso (correo_hash, fallos, ultimo_fallo, bloqueado_hasta)
values (private.hash_correo_acceso('hook-tres@example.com'), 5,
  now() - interval '1 minute', now() - interval '1 minute');
select is(
  public.verificar_intento_acceso(
    '{"user_id":"b1000000-0000-0000-0000-000000000003","valid":false}'::jsonb) ->> 'decision',
  'continue', 'un bloqueo vencido no rechaza');
select is((select fallos from public.intentos_acceso
  where correo_hash = private.hash_correo_acceso('hook-tres@example.com')), 1,
  'tras un bloqueo vencido el conteo reinicia en 1');

-- Ventana de doble conteo, del otro lado: pasada la ventana (o sin marca) cuenta
select public.verificar_intento_acceso(
  '{"user_id":"b1000000-0000-0000-0000-000000000004","valid":false}'::jsonb);
update public.intentos_acceso set ultimo_fallo_servidor = now() - interval '11 seconds'
where correo_hash = private.hash_correo_acceso('hook-cuatro@example.com');
select public.registrar_fallo_acceso('hook-cuatro@example.com');
select is((select fallos from public.intentos_acceso
  where correo_hash = private.hash_correo_acceso('hook-cuatro@example.com')), 2,
  'registrar_fallo_acceso cuenta si el hook contó hace más de 10 segundos');
update public.intentos_acceso set ultimo_fallo_servidor = null
where correo_hash = private.hash_correo_acceso('hook-cuatro@example.com');
select public.registrar_fallo_acceso('hook-cuatro@example.com');
select is((select fallos from public.intentos_acceso
  where correo_hash = private.hash_correo_acceso('hook-cuatro@example.com')), 3,
  'registrar_fallo_acceso cuenta si el hook nunca contó (marca nula)');

-- Correo de más de 254 caracteres: sin contador, no rompe el hook
select is(
  public.verificar_intento_acceso(
    '{"user_id":"b1000000-0000-0000-0000-000000000005","valid":false}'::jsonb) ->> 'decision',
  'continue', 'un correo de más de 254 caracteres continúa sin contador');

-- limpiar_intentos_acceso sigue funcionando con el hash HMAC
select public.registrar_fallo_acceso('hook-dos@example.com');
select set_config('request.jwt.claims', '{"email":"hook-dos@example.com"}', true);
select public.limpiar_intentos_acceso();
select is((select count(*) from public.intentos_acceso
  where correo_hash = private.hash_correo_acceso('hook-dos@example.com')), 0::bigint,
  'limpiar_intentos_acceso borra el contador con el hash HMAC');

-- El hook ejecutado con el rol real de GoTrue (grants y search_path)
create temp table resultado_hook (decision text);
grant all on resultado_hook to supabase_auth_admin;
set local role supabase_auth_admin;
insert into resultado_hook
select public.verificar_intento_acceso(
  '{"user_id":"b1000000-0000-0000-0000-000000000002","valid":false}'::jsonb) ->> 'decision';
insert into resultado_hook
select public.verificar_intento_acceso(
  '{"user_id":"b1000000-0000-0000-0000-000000000002","valid":true}'::jsonb) ->> 'decision';
reset role;
select is((select count(*) from resultado_hook where decision = 'continue'), 2::bigint,
  'supabase_auth_admin ejecuta el hook con contraseña inválida y válida');

-- El 5.º fallo lo cuenta el hook y el cliente reporta el mismo intento justo
-- después (dentro de los 10 s): debe ver el bloqueo vigente, no null por la ventana.
select public.verificar_intento_acceso(
  '{"user_id":"b1000000-0000-0000-0000-000000000006","valid":false}'::jsonb)
from generate_series(1, 5);
select is((select bloqueado_hasta > now() from public.intentos_acceso
  where correo_hash = private.hash_correo_acceso('hook-seis@example.com')), true,
  'el 5.º fallo contado por el hook bloquea el correo');
select ok(public.registrar_fallo_acceso('hook-seis@example.com') > now(),
  'registrar_fallo_acceso tras el 5.º fallo del hook devuelve el bloqueo vigente (no null por la ventana de 10 s)');

-- Sin el secreto de Vault falla cerrado, no vuelve a un hash sin clave
delete from vault.secrets where name = 'acceso_hmac';
select throws_ok(
  $$select private.hash_correo_acceso('hook-uno@example.com')$$,
  'P0001', 'falta el secreto acceso_hmac en Vault',
  'sin el secreto acceso_hmac el hash falla cerrado');
select throws_ok(
  $$select public.verificar_intento_acceso('{"user_id":"b1000000-0000-0000-0000-000000000001","valid":true}'::jsonb)$$,
  'P0001', 'falta el secreto acceso_hmac en Vault',
  'sin el secreto el hook falla y GoTrue rechaza el ingreso');

select * from finish();
rollback;
