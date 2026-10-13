-- MSF-150 · F-ACC-01: endurecimiento tras conceder USAGE sobre public a anon.
-- 1) entrar_a_organizacion / salir_de_organizacion quedan sin EXECUTE para
--    public y anon (hoy solo las frena un chequeo interno de superadmin).
-- 2) registrar_fallo_acceso valida la entrada ANTES de calcular el hash, para
--    que un texto enorme enviado por anon no se hashee.
--
-- Aditiva: solo revoca permisos y redefine una función (create or replace).
-- Reversión: grant execute on function public.entrar_a_organizacion(uuid),
-- public.salir_de_organizacion() to public; y volver a la definición de
-- 20261013100000_registrar_fallo_acceso_atomico.sql.

revoke execute on function public.entrar_a_organizacion(uuid) from public, anon;
revoke execute on function public.salir_de_organizacion() from public, anon;
grant execute on function public.entrar_a_organizacion(uuid) to authenticated;
grant execute on function public.salir_de_organizacion() to authenticated;

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
