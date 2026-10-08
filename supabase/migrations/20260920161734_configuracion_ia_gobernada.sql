-- Configuración global de proveedores IA (spec 016, US1).
-- Reversión: revocar las funciones al final de la spec; el catálogo y los
-- perfiles se conservan mientras existan políticas/interacciones que los usen.

insert into public.ia_proveedores (codigo, nombre, adaptador)
values
  ('openai', 'OpenAI', 'openai'),
  ('anthropic', 'Anthropic / Claude', 'anthropic'),
  ('google', 'Google / Gemini', 'gemini'),
  ('xai', 'xAI / Grok', 'openai-compatible'),
  ('deepseek', 'DeepSeek', 'openai-compatible'),
  ('alibaba-qwen', 'Alibaba / Qwen', 'openai-compatible'),
  ('zhipu-glm', 'Zhipu / GLM', 'openai-compatible'),
  ('moonshot-kimi', 'Moonshot / Kimi', 'openai-compatible'),
  ('baidu-ernie', 'Baidu / ERNIE', 'baidu')
on conflict (codigo) do update
set nombre = excluded.nombre,
    adaptador = excluded.adaptador,
    updated_at = clock_timestamp();

create or replace function private.configurar_proveedor_ia(
  p_codigo text,
  p_habilitado boolean,
  p_retencion_verificada_en timestamptz,
  p_retencion_verifica_hasta timestamptz,
  p_evidencia_retencion_url text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not private.is_superadmin() then
    raise exception 'Solo el superadmin puede configurar proveedores IA' using errcode = '42501';
  end if;

  if p_codigo not in ('openai', 'anthropic', 'google', 'xai', 'deepseek', 'alibaba-qwen', 'zhipu-glm', 'moonshot-kimi', 'baidu-ernie') then
    raise exception 'Proveedor IA fuera del catálogo cerrado' using errcode = '22023';
  end if;

  update public.ia_proveedores
  set habilitado = p_habilitado,
      retencion_verificada_en = p_retencion_verificada_en,
      retencion_verifica_hasta = p_retencion_verifica_hasta,
      evidencia_retencion_url = p_evidencia_retencion_url,
      verificado_por = case when p_habilitado then auth.uid() else verificado_por end,
      updated_at = clock_timestamp()
  where codigo = p_codigo;

  if not found then
    raise exception 'Proveedor IA inexistente' using errcode = '22023';
  end if;
end;
$$;

create or replace function private.registrar_modelos_descubiertos_ia(
  p_credencial_id uuid,
  p_modelos jsonb
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not pg_catalog.pg_has_role(session_user, 'workers_orquestacion', 'member') then
    raise exception 'Runtime no autorizado para IA' using errcode = '42501';
  end if;

  if jsonb_typeof(p_modelos) <> 'array' then
    raise exception 'Los modelos descubiertos deben ser un arreglo' using errcode = '22023';
  end if;

  insert into public.ia_modelos_descubiertos (credencial_id, modelo_id, capacidades, activo, descubierto_en)
  select p_credencial_id,
         item->>'modelo_id',
         coalesce(item->'capacidades', '{}'::jsonb),
         true,
         clock_timestamp()
  from jsonb_array_elements(p_modelos) item
  where nullif(item->>'modelo_id', '') is not null
  on conflict (credencial_id, modelo_id) do update
  set capacidades = excluded.capacidades,
      activo = true,
      descubierto_en = excluded.descubierto_en;
end;
$$;

create or replace function private.obtener_clave_credencial_ia(p_credencial_id uuid)
returns table (proveedor_codigo text, adaptador text, clave text)
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
  select proveedor.codigo, proveedor.adaptador, secreto.decrypted_secret
  from public.ia_credenciales_proveedor credencial
  join public.ia_proveedores proveedor on proveedor.id = credencial.proveedor_id
  join vault.decrypted_secrets secreto on secreto.id = credencial.vault_secret_id
  where credencial.id = p_credencial_id and credencial.activa;

  if not found then
    raise exception 'Credencial de IA no disponible' using errcode = '42501';
  end if;
end;
$$;

create or replace function private.crear_perfil_modelo_ia(
  p_credencial_id uuid,
  p_modelo_id text,
  p_nombre text,
  p_activo boolean default true
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  if not private.is_superadmin() then
    raise exception 'Solo el superadmin puede crear perfiles IA' using errcode = '42501';
  end if;

  if not exists (
    select 1 from public.ia_modelos_descubiertos
    where credencial_id = p_credencial_id and modelo_id = p_modelo_id and activo
  ) then
    raise exception 'El modelo no fue descubierto para esta credencial' using errcode = '22023';
  end if;

  insert into public.ia_perfiles_modelo (credencial_id, modelo_id, nombre, activo, configurado_por)
  values (p_credencial_id, p_modelo_id, p_nombre, p_activo, auth.uid())
  on conflict (credencial_id, modelo_id) do update
  set nombre = excluded.nombre,
      activo = excluded.activo,
      configurado_por = excluded.configurado_por,
      updated_at = clock_timestamp()
  returning id into v_id;

  return v_id;
end;
$$;

revoke all on function private.configurar_proveedor_ia(text, boolean, timestamptz, timestamptz, text) from public, anon;
revoke all on function private.crear_perfil_modelo_ia(uuid, text, text, boolean) from public, anon;
revoke all on function private.registrar_modelos_descubiertos_ia(uuid, jsonb) from public, anon, authenticated, kestra_orquestacion;
revoke all on function private.obtener_clave_credencial_ia(uuid) from public, anon, authenticated, kestra_orquestacion;
grant execute on function private.configurar_proveedor_ia(text, boolean, timestamptz, timestamptz, text) to authenticated;
grant execute on function private.crear_perfil_modelo_ia(uuid, text, text, boolean) to authenticated;
grant execute on function private.registrar_modelos_descubiertos_ia(uuid, jsonb) to workers_orquestacion;
grant execute on function private.obtener_clave_credencial_ia(uuid) to workers_orquestacion;
