-- MSF-150 · F-ACC-01: bloqueo_acceso_hasta pasa a plpgsql con return temprano.
-- En la versión sql (20261013160000) el guard de longitud vivía en el WHERE y el
-- planner no garantiza el orden de evaluación: el hash podía calcularse igual
-- sobre un texto enorme enviado por anon. Con plpgsql el corte es previo.
--
-- Aditiva: create or replace con la misma firma; conserva sus privilegios.
-- Reversión: volver a la definición de 20261013160000_bloqueo_acceso_acota_correo.sql.

create or replace function public.bloqueo_acceso_hasta(p_correo text)
returns timestamptz
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_hasta timestamptz;
begin
  if p_correo is null or btrim(p_correo) = '' or length(p_correo) > 254 then
    return null;
  end if;

  select bloqueado_hasta into v_hasta from public.intentos_acceso
  where correo_hash = private.hash_correo_acceso(p_correo)
    and bloqueado_hasta > now();

  return v_hasta;
end;
$$;
