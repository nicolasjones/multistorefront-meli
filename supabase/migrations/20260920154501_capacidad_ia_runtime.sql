-- Runtime remoto de IA: el worker solo resuelve perfiles aprobados y lee
-- temporalmente una clave. Kestra y authenticated no reciben secretos.

create or replace function private.resolver_politica_ia(p_codigo text)
returns table (
  politica_id uuid,
  contrato_id uuid,
  perfil_principal_id uuid,
  perfil_fallback_id uuid,
  limite_intentos smallint,
  limite_segundos integer
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not pg_catalog.pg_has_role(session_user, 'workers_orquestacion', 'member') then
    raise exception 'Runtime no autorizado para IA' using errcode = '42501';
  end if;

  return query
  select p.id, p.contrato_id, p.perfil_principal_id, p.perfil_fallback_id,
         p.limite_intentos, p.limite_segundos
  from public.ia_politicas p
  join public.ia_perfiles_modelo principal on principal.id = p.perfil_principal_id
  join public.ia_credenciales_proveedor credencial on credencial.id = principal.credencial_id
  join public.ia_proveedores proveedor on proveedor.id = credencial.proveedor_id
  where p.codigo = p_codigo
    and p.estado = 'aprobada'
    and principal.activo and credencial.activa and proveedor.habilitado
    and proveedor.retencion_verifica_hasta > clock_timestamp();
end;
$$;

create or replace function private.obtener_clave_perfil_ia(p_perfil_id uuid)
returns table (proveedor_codigo text, adaptador text, modelo_id text, clave text)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not pg_catalog.pg_has_role(session_user, 'workers_orquestacion', 'member') then
    raise exception 'Runtime no autorizado para IA' using errcode = '42501';
  end if;

  return query
  select proveedor.codigo, proveedor.adaptador, perfil.modelo_id, secreto.decrypted_secret
  from public.ia_perfiles_modelo perfil
  join public.ia_credenciales_proveedor credencial on credencial.id = perfil.credencial_id
  join public.ia_proveedores proveedor on proveedor.id = credencial.proveedor_id
  join vault.decrypted_secrets secreto on secreto.id = credencial.vault_secret_id
  where perfil.id = p_perfil_id
    and perfil.activo and credencial.activa and proveedor.habilitado
    and proveedor.retencion_verifica_hasta > clock_timestamp();

  if not found then
    raise exception 'Perfil de IA no disponible' using errcode = '42501';
  end if;
end;
$$;

revoke all on function private.resolver_politica_ia(text) from public, anon, authenticated, kestra_orquestacion;
revoke all on function private.obtener_clave_perfil_ia(uuid) from public, anon, authenticated, kestra_orquestacion;
grant usage on schema private to workers_orquestacion;
grant execute on function private.resolver_politica_ia(text) to workers_orquestacion;
grant execute on function private.obtener_clave_perfil_ia(uuid) to workers_orquestacion;
