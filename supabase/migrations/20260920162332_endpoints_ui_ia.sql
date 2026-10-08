-- Endpoints expuestos para la UI, sin exponer la schema private ni secretos.

create or replace function public.configurar_proveedor_ia(
  p_codigo text,
  p_habilitado boolean,
  p_retencion_verificada_en timestamptz,
  p_retencion_verifica_hasta timestamptz,
  p_evidencia_retencion_url text
)
returns void
language sql
security definer
set search_path = ''
as $$
  select private.configurar_proveedor_ia(
    p_codigo,
    p_habilitado,
    p_retencion_verificada_en,
    p_retencion_verifica_hasta,
    p_evidencia_retencion_url
  );
$$;

create or replace function public.crear_perfil_modelo_ia(
  p_credencial_id uuid,
  p_modelo_id text,
  p_nombre text,
  p_activo boolean default true
)
returns uuid
language sql
security definer
set search_path = ''
as $$
  select private.crear_perfil_modelo_ia(p_credencial_id, p_modelo_id, p_nombre, p_activo);
$$;

revoke all on function public.configurar_proveedor_ia(text, boolean, timestamptz, timestamptz, text) from public, anon;
revoke all on function public.crear_perfil_modelo_ia(uuid, text, text, boolean) from public, anon;
grant execute on function public.configurar_proveedor_ia(text, boolean, timestamptz, timestamptz, text) to authenticated;
grant execute on function public.crear_perfil_modelo_ia(uuid, text, text, boolean) to authenticated;
