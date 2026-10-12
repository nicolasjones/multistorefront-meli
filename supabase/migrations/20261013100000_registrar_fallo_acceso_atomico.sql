-- MSF-150 · F-ACC-01 (FR-003): el conteo de fallos pasa a ser atómico.
-- `select … for update` no bloquea cuando la fila aún no existe, así que dos
-- fallos concurrentes sobre un correo nuevo contaban 1 en vez de 2. Se
-- serializa por correo con un advisory lock de transacción antes del select.
--
-- Aditiva: solo redefine la función (create or replace), sin tocar la tabla.
-- Reversión: volver a la definición de 20261012140200_intentos_acceso.sql.

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
  if p_correo is null or btrim(p_correo) = '' or length(p_correo) > 254 then
    return null;
  end if;

  perform pg_advisory_xact_lock(hashtext(v_hash));

  select * into v_actual from public.intentos_acceso
  where correo_hash = v_hash;

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
