-- MSF-150 · F-ACC-01 (FR-003): bloqueo tras 5 intentos fallidos por correo,
-- 15 minutos. El límite de Supabase Auth ([auth.rate_limit].sign_in_sign_ups)
-- es por IP, no por correo, y no se configura en 5 intentos / 15 min: no alcanza.
--
-- Plataforma/auth → esquema public. El correo se guarda en hash (sha256 del
-- correo normalizado). RLS activo y sin policies ni grants sobre la tabla:
-- solo se accede por las funciones security definer de abajo.
--
-- Riesgo aceptado (FR-003): registrar_fallo_acceso está abierta a anon, así que
-- cualquiera puede bloquear 15 minutos el correo de otra persona (DoS dirigido)
-- o crecer la tabla con correos arbitrarios. Es inherente al bloqueo por correo
-- aplicado desde el cliente; se endurece junto con el Auth Hook / Edge Function
-- anotado en T003 de tasks.md.
--
-- Reversión (PR posterior): eliminar las tres funciones public.* y la tabla.

create table public.intentos_acceso (
  correo_hash text primary key,
  fallos integer not null default 0,
  ultimo_fallo timestamptz not null default now(),
  bloqueado_hasta timestamptz
);

comment on table public.intentos_acceso is
  'Contador de fallos de ingreso por correo (hash). Bloquea 15 min tras 5 fallos (F-ACC-01, FR-003). Solo accesible vía funciones.';

alter table public.intentos_acceso enable row level security;
revoke all on public.intentos_acceso from anon, authenticated;

create or replace function private.hash_correo_acceso(p_correo text)
returns text
language sql
immutable
set search_path = public, extensions
as $$
  select encode(extensions.digest(lower(btrim(p_correo)), 'sha256'), 'hex');
$$;

-- Hasta cuándo está bloqueado el correo (null si no lo está). No distingue
-- correos existentes de inexistentes: aplica igual a cualquier texto.
create or replace function public.bloqueo_acceso_hasta(p_correo text)
returns timestamptz
language sql
stable
security definer
set search_path = public
as $$
  select bloqueado_hasta from public.intentos_acceso
  where correo_hash = private.hash_correo_acceso(p_correo)
    and bloqueado_hasta > now();
$$;

-- Registra un fallo. Una ventana vencida (bloqueo cumplido o 15 min sin
-- fallar) empieza de cero. Devuelve el bloqueo vigente, si lo hay.
create or replace function public.registrar_fallo_acceso(p_correo text)
returns timestamptz
language plpgsql
security definer
set search_path = public
as $$
declare
  v_hash text := private.hash_correo_acceso(p_correo);
  v_actual public.intentos_acceso%rowtype;
  v_fallos integer;
  v_hasta timestamptz;
begin
  -- Entradas acotadas: la función está abierta a anon y no debe crecer la
  -- tabla con basura. Un correo vacío o de más de 254 caracteres no cuenta.
  if p_correo is null or btrim(p_correo) = '' or length(p_correo) > 254 then
    return null;
  end if;

  select * into v_actual from public.intentos_acceso
  where correo_hash = v_hash for update;

  if found and v_actual.bloqueado_hasta > now() then
    return v_actual.bloqueado_hasta;
  end if;

  if not found
     or v_actual.bloqueado_hasta is not null
     or v_actual.ultimo_fallo < now() - interval '15 minutes' then
    v_fallos := 1;
  else
    v_fallos := v_actual.fallos + 1;
  end if;

  v_hasta := case when v_fallos >= 5 then now() + interval '15 minutes' end;

  insert into public.intentos_acceso (correo_hash, fallos, ultimo_fallo, bloqueado_hasta)
  values (v_hash, v_fallos, now(), v_hasta)
  on conflict (correo_hash) do update
    set fallos = excluded.fallos,
        ultimo_fallo = excluded.ultimo_fallo,
        bloqueado_hasta = excluded.bloqueado_hasta;

  return v_hasta;
end;
$$;

-- Limpia el contador del propio usuario autenticado tras un ingreso exitoso.
-- Exige sesión y usa el correo del JWT: nadie puede resetear el contador de
-- otro correo sin conocer su contraseña.
create or replace function public.limpiar_intentos_acceso()
returns void
language sql
security definer
set search_path = public
as $$
  delete from public.intentos_acceso
  where correo_hash = private.hash_correo_acceso(auth.jwt() ->> 'email')
    and (bloqueado_hasta is null or bloqueado_hasta <= now());
$$;

revoke execute on function public.bloqueo_acceso_hasta(text) from public;
revoke execute on function public.registrar_fallo_acceso(text) from public;
revoke execute on function public.limpiar_intentos_acceso() from public;
-- anon llama a estas RPC antes de tener sesión; sin USAGE sobre el esquema el
-- ingreso fallaría cerrado (la fundación solo lo concedió a authenticated).
grant usage on schema public to anon;
grant execute on function public.bloqueo_acceso_hasta(text) to anon, authenticated;
grant execute on function public.registrar_fallo_acceso(text) to anon, authenticated;
grant execute on function public.limpiar_intentos_acceso() to authenticated;
