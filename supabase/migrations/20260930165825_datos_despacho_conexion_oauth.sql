-- Resolución de conexión OAuth para flows de Kestra (spec
-- 20260930-153545-conexiones-oauth-nango). Migración aditiva. Reversión:
--   drop function private.datos_despacho_conexion_oauth(uuid, text);
--
-- Encontrado al escribir el primer flow real que consume una conexión OAuth
-- (worker de Google Sheets, producto derivado): un flow de Kestra corre como
-- kestra_orquestacion vía JDBC directo, no por PostgREST — sin GRANT no
-- puede resolver el conexion_id que necesita pasarle al worker por env var.
-- Mismo criterio que private.datos_despacho_conexion (spec 013) para
-- servidores_organizacion/conexiones: un único punto de lectura acotada, sin
-- select directo sobre conexiones_oauth/integraciones_oauth para ese rol.

create or replace function private.datos_despacho_conexion_oauth(
  p_organizacion_id uuid,
  p_clave text
)
returns uuid
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_conexion_id uuid;
begin
  select c.id
  into v_conexion_id
  from public.conexiones_oauth c
  join public.integraciones_oauth i on i.id = c.integracion_id
  where c.organizacion_id = p_organizacion_id
    and i.clave = p_clave
    and c.estado = 'activa';

  if v_conexion_id is null then
    raise exception 'No hay conexión OAuth activa a % para la organización %', p_clave, p_organizacion_id using errcode = 'P0002';
  end if;

  return v_conexion_id;
end;
$$;

comment on function private.datos_despacho_conexion_oauth(uuid, text) is
  'Contrato: specs/20260930-153545-conexiones-oauth-nango/contracts/obtener-token-oauth.md (Paso 1, variante para un flow de Kestra). Único punto por el que un flow despachado como kestra_orquestacion resuelve el conexion_id activo de una organización para una integración, sin select directo sobre conexiones_oauth/integraciones_oauth. No devuelve ningún token ni dato de Nango — eso sigue siendo el Paso 2 del contrato, hecho por el worker con NANGO_SECRET_KEY_*, nunca por este flow.';

revoke execute on function private.datos_despacho_conexion_oauth(uuid, text) from public, authenticated, anon;
grant execute on function private.datos_despacho_conexion_oauth(uuid, text) to kestra_orquestacion;
