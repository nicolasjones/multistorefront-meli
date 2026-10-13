-- MSF-470 · T022 (F-ACC-01, FR-003): el bloqueo de intentos se aplica en el
-- servidor con el Auth Hook «password verification attempt» de Supabase Auth.
-- Hasta ahora lo aplicaba solo el cliente vía RPC, así que un llamado directo a
-- /auth/v1/token lo evitaba. Ahora GoTrue invoca el hook en cada verificación de
-- contraseña de un usuario existente:
--   · correo bloqueado → rechaza aunque la contraseña sea correcta;
--   · contraseña inválida → cuenta el fallo (mismo contador que el cliente);
--   · contraseña válida y sin bloqueo → limpia el contador.
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
-- Aditiva: una columna nullable, funciones nuevas o reemplazadas con la misma
-- firma. Los contadores existentes (sha256) quedan huérfanos y se purgan solos;
-- como mucho se reinician 15 minutos de conteo.
-- Reversión (PR posterior): restaurar private.hash_correo_acceso a su definición
-- de 20261012140200, registrar_fallo_acceso a la de 20261013190000, quitar
-- [auth.hook.password_verification_attempt] de config.toml, eliminar
-- public.verificar_intento_acceso, las funciones private.contar_fallo_acceso y
-- private.purgar_intentos_acceso, la columna ultimo_fallo_servidor y el secreto
-- 'acceso_hmac' de Vault.

alter table public.intentos_acceso
  add column if not exists ultimo_fallo_servidor timestamptz;

-- Secreto del HMAC: aleatorio por entorno, guardado en Vault.
do $$
begin
  if not exists (select 1 from vault.secrets where name = 'acceso_hmac') then
    perform vault.create_secret(
      encode(extensions.gen_random_bytes(32), 'hex'),
      'acceso_hmac',
      'Clave HMAC del hash de correo en intentos_acceso (MSF-470)'
    );
  end if;
end;
$$;

-- security definer: lee Vault con los privilegios del dueño. Si el secreto falta
-- falla (cierra), no vuelve al hash sin clave.
create or replace function private.hash_correo_acceso(p_correo text)
returns text
language plpgsql
stable
security definer
set search_path = public, extensions, vault
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
set search_path = public
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

-- Conteo de un fallo (compartido por el RPC del cliente y el hook).
-- p_servidor = true: lo cuenta el hook y deja marca; false: lo cuenta el cliente
-- y se ignora si el hook ya contó ese mismo intento.
create or replace function private.contar_fallo_acceso(p_correo text, p_servidor boolean)
returns timestamptz
language plpgsql
security definer
set search_path = public
as $$
declare
  v_hash text;
  v_actual public.intentos_acceso%rowtype;
  v_fallos integer;
  v_hasta timestamptz;
begin
  if p_correo is null or btrim(p_correo) = '' or length(p_correo) > 254 then
    return null;
  end if;

  v_hash := private.hash_correo_acceso(p_correo);

  perform pg_advisory_xact_lock(hashtext(v_hash));

  perform private.purgar_intentos_acceso(v_hash);

  select * into v_actual from public.intentos_acceso
  where correo_hash = v_hash;

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
    (v_hash, v_fallos, now(), v_hasta, case when p_servidor then now() end)
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
set search_path = public
as $$
begin
  return private.contar_fallo_acceso(p_correo, false);
end;
$$;

-- Auth Hook «password verification attempt». Entrada: {user_id, valid}.
-- Salida: {decision: 'continue' | 'reject', message?}. Si algo falla lanza
-- excepción y GoTrue rechaza el ingreso (falla cerrado).
create or replace function public.verificar_intento_acceso(event jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
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

  select bloqueado_hasta into v_bloqueo from public.intentos_acceso
  where correo_hash = v_hash and bloqueado_hasta > now();

  if v_bloqueo is not null then
    return jsonb_build_object(
      'decision', 'reject',
      'message', 'Demasiados intentos. Probá de nuevo más tarde.');
  end if;

  if coalesce((event ->> 'valid')::boolean, false) then
    delete from public.intentos_acceso where correo_hash = v_hash;
    perform private.purgar_intentos_acceso(v_hash);
  else
    perform private.contar_fallo_acceso(v_correo, true);
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
