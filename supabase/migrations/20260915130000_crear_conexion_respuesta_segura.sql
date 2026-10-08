-- La RPC de alta no debe devolver el identificador interno de Vault.
-- Reversión: recrear public.crear_conexion(uuid,text,text) con el contrato
-- anterior (returns public.conexiones) si un consumidor legado lo requiere.

drop function public.crear_conexion(uuid, text, text);

create function public.crear_conexion(
  p_organizacion_id uuid,
  p_sistema_externo text,
  p_credencial text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_vault_id uuid;
  v_conexion public.conexiones;
begin
  if not (select private.es_administrador_de(p_organizacion_id)) then
    raise exception 'No puede gestionar conexiones de esta organización' using errcode = '42501';
  end if;

  if not exists (select 1 from public.organizaciones o where o.id = p_organizacion_id) then
    raise exception 'La organización % no existe', p_organizacion_id using errcode = 'P0002';
  end if;

  v_vault_id := vault.create_secret(p_credencial);

  insert into public.conexiones (organizacion_id, sistema_externo, credencial_vault_id, created_by)
  values (p_organizacion_id, p_sistema_externo, v_vault_id, (select auth.uid()))
  returning * into v_conexion;

  return jsonb_build_object(
    'id', v_conexion.id,
    'organizacion_id', v_conexion.organizacion_id,
    'sistema_externo', v_conexion.sistema_externo,
    'estado', v_conexion.estado,
    'created_by', v_conexion.created_by,
    'created_at', v_conexion.created_at,
    'updated_at', v_conexion.updated_at
  );
end;
$$;

comment on function public.crear_conexion(uuid, text, text) is
  'Crea una conexión cifrando la credencial en Vault. La respuesta JSON solo contiene metadatos públicos de la conexión y nunca credencial_vault_id.';

revoke execute on function public.crear_conexion(uuid, text, text) from public;
grant execute on function public.crear_conexion(uuid, text, text) to authenticated;
