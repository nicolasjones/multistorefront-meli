-- MSF-150 · F-ACC-01: bloqueo_acceso_hasta valida la entrada ANTES de hashear,
-- igual que registrar_fallo_acceso (20261013110000). La función está abierta a
-- anon; un texto enorme no debe hashearse. Un correo nulo, vacío o de más de
-- 254 caracteres devuelve null (sin bloqueo).
--
-- Aditiva: solo redefine una función (create or replace) con la misma firma,
-- por lo que conserva sus privilegios.
-- Reversión: volver a la definición de 20261012140200_intentos_acceso.sql.

create or replace function public.bloqueo_acceso_hasta(p_correo text)
returns timestamptz
language sql
stable
security definer
set search_path = public
as $$
  select bloqueado_hasta from public.intentos_acceso
  where p_correo is not null
    and btrim(p_correo) <> ''
    and length(p_correo) <= 254
    and correo_hash = private.hash_correo_acceso(p_correo)
    and bloqueado_hasta > now();
$$;
