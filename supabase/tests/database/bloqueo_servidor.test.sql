-- MSF-470 · T022 (F-ACC-01, FR-003): bloqueo de intentos aplicado en el servidor
-- por el Auth Hook «password verification attempt».
begin;

select plan(16);

insert into auth.users (id, email) values
  ('b1000000-0000-0000-0000-000000000001', 'hook-uno@example.com'),
  ('b1000000-0000-0000-0000-000000000002', 'hook-dos@example.com');

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

select * from finish();
rollback;
