-- MSF-470 · T022 (F-ACC-01, FR-003): el bloqueo de intentos se aplica en el
-- servidor con el Auth Hook «password verification attempt» de Supabase Auth.
-- Hasta ahora lo aplicaba solo el cliente vía RPC, así que un llamado directo a
-- /auth/v1/token lo evitaba. Ahora GoTrue invoca el hook en cada verificación de
-- contraseña de un usuario existente:
--   · correo bloqueado → rechaza siempre con el mismo mensaje de bloqueo, sea la
--     contraseña válida o no: la respuesta no depende de la contraseña, así que el
--     bloqueo frena la fuerza bruta y no delata la correcta;
--   · contraseña inválida sin bloqueo → cuenta el fallo (mismo contador que el
--     cliente);
--   · contraseña válida y sin bloqueo → limpia el contador.
-- Limitación conocida: el hook solo corre para usuarios existentes, y
-- bloqueo_acceso_hasta (anon) responde «bloqueado» solo si hubo fallos contados, así
-- que tras 5 llamados directos a /token esa diferencia revela si un correo existe.
-- Cerrarlo exige un componente aparte (gateway o Edge Function que cuente también
-- los correos inexistentes); ver docs/acceso-ingreso.md.
-- Además:
--   · el hash del correo pasa a HMAC-SHA256 con un secreto de Vault (generado por
--     esta migración, nunca en Git): con la tabla filtrada no se puede confirmar
--     qué correos tienen intentos;
--   · la purga de intentos_acceso corre también desde el hook (en cada intento,
--     válido o no), sin depender de que alguien falle un ingreso.
--
-- Doble conteo: el cliente sigue llamando registrar_fallo_acceso (cubre correos
-- inexistentes, que no pasan por el hook). Para un usuario existente el hook ya
-- contó ese intento: registrar_fallo_acceso lo ignora si el hook contó hace
-- menos de 10 segundos.
--
-- Esquema `public`: plataforma, autenticación (no es una tabla de dominio).
--
-- Aditiva: una columna nullable, funciones nuevas o reemplazadas con la misma
-- firma. Las funciones nuevas usan search_path vacío (todo va calificado). Los
-- contadores existentes (sha256) no se pueden pasar a HMAC (el hash no se
-- revierte): quedan huérfanos y se purgan solos. Efecto conocido: un bloqueo
-- vigente al momento del deploy deja de aplicar y el conteo parte de cero.
-- Reversión (PR posterior): restaurar private.hash_correo_acceso a su definición
-- de 20261012140200, registrar_fallo_acceso a la de 20261013190000, quitar
-- [auth.hook.password_verification_attempt] de config.toml, eliminar
-- public.verificar_intento_acceso, las funciones private.contar_fallo_acceso y
-- private.purgar_intentos_acceso, la columna ultimo_fallo_servidor y el secreto
-- 'acceso_hmac' de Vault.

-- Secreto del HMAC: aleatorio por entorno, guardado en Vault. Vault y pgcrypto
-- vienen habilitados en Supabase (local y Cloud); el create extension es un no-op
-- si ya existen. Si el rol que migra no ve vault.secrets, falla con un mensaje claro
-- en vez de a medias (ver docs/acceso-ingreso.md → rol de migración).
create extension if not exists pgcrypto with schema extensions;

do $$
begin
  if to_regclass('vault.secrets') is null then
    raise exception 'Vault no está habilitado o el rol que migra no lo ve: habilitá la extensión supabase_vault y migrá con el rol postgres';
  end if;
  if not exists (select 1 from vault.secrets where name = 'acceso_hmac') then
    perform vault.create_secret(
      encode(extensions.gen_random_bytes(32), 'hex'),
      'acceso_hmac',
      'Clave HMAC del hash de correo en intentos_acceso (MSF-470)'
    );
  end if;
end;
$$;

alter table public.intentos_acceso
  add column if not exists ultimo_fallo_servidor timestamptz;

-- Costo: cada llamada descifra la clave de Vault (también las RPC abiertas a anon).
-- Es una lectura puntual; no se cachea por transacción para no dejar la clave en un
-- setting de sesión.
-- security definer: lee Vault con los privilegios del dueño. Si el secreto falta
-- falla (cierra), no vuelve al hash sin clave.
create or replace function private.hash_correo_acceso(p_correo text)
returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_clave text;
begin
  select decrypted_secret into v_clave from vault.decrypted_secrets
  where name = 'acceso_hmac';
  if v_clave is null then
    raise exception 'falta el secreto acceso_hmac en Vault';
  end if;
  return encode(
    extensions.hmac(lower(btrim(p_correo)), v_clave, 'sha256'), 'hex');
end;
$$;

-- Purga acotada: filas de otros correos sin actividad en 15 min y sin bloqueo
-- vigente (hasta 100 por llamada; skip locked evita deadlocks entre llamadas).
create or replace function private.purgar_intentos_acceso(p_excepto text)
returns void
language sql
security definer
set search_path = ''
as $$
  delete from public.intentos_acceso
  where ctid in (
    select ctid from public.intentos_acceso
    where correo_hash is distinct from p_excepto
      and ultimo_fallo < now() - interval '15 minutes'
      and (bloqueado_hasta is null or bloqueado_hasta <= now())
    limit 100
    for update skip locked
  );
$$;

-- Conteo de un fallo (compartido por el RPC del cliente y el hook). Recibe el hash
-- ya calculado para no descifrar Vault dos veces por intento.
-- p_servidor = true: lo cuenta el hook y deja marca; false: lo cuenta el cliente
-- y se ignora si el hook ya contó ese mismo intento.
create or replace function private.contar_fallo_acceso(p_hash text, p_servidor boolean)
returns timestamptz
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actual public.intentos_acceso%rowtype;
  v_fallos integer;
  v_hasta timestamptz;
begin
  perform pg_advisory_xact_lock(20261014, hashtext(p_hash));

  perform private.purgar_intentos_acceso(p_hash);

  select * into v_actual from public.intentos_acceso
  where correo_hash = p_hash;

  if found and v_actual.bloqueado_hasta > now() then
    return v_actual.bloqueado_hasta;
  end if;

  -- El hook ya contó este intento (el cliente lo reporta después).
  if found and not p_servidor
     and v_actual.ultimo_fallo_servidor > now() - interval '10 seconds' then
    return null;
  end if;

  if not found
     or v_actual.bloqueado_hasta is not null
     or v_actual.ultimo_fallo < now() - interval '15 minutes' then
    v_fallos := 1;
  else
    v_fallos := v_actual.fallos + 1;
  end if;

  v_hasta := case when v_fallos >= 5 then now() + interval '15 minutes' end;

  insert into public.intentos_acceso
    (correo_hash, fallos, ultimo_fallo, bloqueado_hasta, ultimo_fallo_servidor)
  values
    (p_hash, v_fallos, now(), v_hasta, case when p_servidor then now() end)
  on conflict (correo_hash) do update
    set fallos = excluded.fallos,
        ultimo_fallo = excluded.ultimo_fallo,
        bloqueado_hasta = excluded.bloqueado_hasta,
        ultimo_fallo_servidor = case when p_servidor then now()
          else public.intentos_acceso.ultimo_fallo_servidor end;

  return v_hasta;
end;
$$;

-- RPC del cliente: misma firma y mismos grants (anon, authenticated).
create or replace function public.registrar_fallo_acceso(p_correo text)
returns timestamptz
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_correo is null or btrim(p_correo) = '' or length(p_correo) > 254 then
    return null;
  end if;
  return private.contar_fallo_acceso(private.hash_correo_acceso(p_correo), false);
end;
$$;

-- Auth Hook «password verification attempt». Entrada: {user_id, valid}.
-- Salida: {decision: 'continue' | 'reject', message?}. El mensaje es el mismo del
-- cliente (authProvider), no uno propio. Si algo falla lanza
-- excepción y GoTrue rechaza el ingreso (falla cerrado).
create or replace function public.verificar_intento_acceso(event jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_correo text;
  v_hash text;
  v_bloqueo timestamptz;
begin
  select email into v_correo from auth.users
  where id = (event ->> 'user_id')::uuid;

  -- Sin correo no hay contador que aplicar.
  if v_correo is null or btrim(v_correo) = '' or length(v_correo) > 254 then
    return jsonb_build_object('decision', 'continue');
  end if;

  v_hash := private.hash_correo_acceso(v_correo);

  -- Mismo lock que contar_fallo_acceso, antes de mirar el bloqueo: serializa los
  -- intentos concurrentes del mismo correo (si no, varios llamados en paralelo
  -- leen «no bloqueado» antes de que se confirme el 5.º fallo). Es reentrante
  -- dentro de la transacción.
  perform pg_advisory_xact_lock(20261014, hashtext(v_hash));

  select bloqueado_hasta into v_bloqueo from public.intentos_acceso
  where correo_hash = v_hash and bloqueado_hasta > now();

  -- Bloqueado: se rechaza siempre con el mismo mensaje, sea la contraseña válida o
  -- no. Si una inválida continuara (invalid_credentials) mientras una válida se
  -- rechaza, la diferencia delataría la contraseña correcta y los intentos durante
  -- el bloqueo no tendrían freno. Los intentos rechazados no suman fallos.
  if v_bloqueo is not null then
    return jsonb_build_object(
      'decision', 'reject',
      'message', 'Demasiados intentos. Esperá unos minutos antes de volver a intentar.');
  end if;

  if coalesce((event ->> 'valid')::boolean, false) then
    delete from public.intentos_acceso where correo_hash = v_hash;
    perform private.purgar_intentos_acceso(v_hash);
  else
    perform private.contar_fallo_acceso(v_hash, true);
  end if;

  return jsonb_build_object('decision', 'continue');
end;
$$;

-- Solo GoTrue ejecuta el hook; las funciones private no se exponen a roles de la API.
revoke execute on function private.hash_correo_acceso(text) from public, anon, authenticated;
revoke execute on function private.purgar_intentos_acceso(text) from public, anon, authenticated;
revoke execute on function private.contar_fallo_acceso(text, boolean) from public, anon, authenticated;
revoke execute on function public.verificar_intento_acceso(jsonb) from public, anon, authenticated;
grant usage on schema public to supabase_auth_admin;
grant execute on function public.verificar_intento_acceso(jsonb) to supabase_auth_admin;
