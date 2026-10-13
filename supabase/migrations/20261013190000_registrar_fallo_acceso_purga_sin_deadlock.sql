-- MSF-150 · F-ACC-01: la purga acotada de registrar_fallo_acceso podía tomar
-- locks en distinto orden que otra llamada concurrente (hashes distintos, sin
-- el advisory lock compartido) y provocar deadlock. El subselect ahora usa
-- for update skip locked: las filas que otra transacción ya está tomando se
-- saltean y se purgan en la siguiente llamada.
--
-- Aditiva: create or replace de la función; los grants se conservan.
-- Reversión: volver a la definición de 20261013180000_intentos_acceso_purga_acotada.sql.

create or replace function public.registrar_fallo_acceso(p_correo text)
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

  -- Purga acotada: filas de otros correos sin actividad en 15 min y sin bloqueo
  -- vigente ya no cuentan; así la tabla no crece sin tope con correos de anon.
  delete from public.intentos_acceso
  where ctid in (
    select ctid from public.intentos_acceso
    where correo_hash <> v_hash
      and ultimo_fallo < now() - interval '15 minutes'
      and (bloqueado_hasta is null or bloqueado_hasta <= now())
    limit 100
    for update skip locked
  );

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
