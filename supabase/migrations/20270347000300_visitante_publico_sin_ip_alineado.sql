-- Seguridad retroactiva de #1006: `private.visitante_publico` usaba el marcador «desconocido» cuando falta
-- `x-forwarded-for`, mientras `private.visitante_hash` usa «sin-ip». Se alinea al mismo marcador (falla cerrada, un único
-- cupo). Misma firma, misma entrada y mismos privilegios; solo cambia el literal del caso sin cabecera (los cupos en curso
-- de pedidos sin cabecera se reinician una vez: viven minutos).
--
-- Reversión (migración posterior): recrear la función con la definición de
-- `20270324120000_tienda_visitante_publico_hmac_y_poda_global.sql`.

create or replace function private.visitante_publico(p_host text)
returns text
language sql
stable
set search_path = ''
as $$
  with cadena as (
    select regexp_split_to_array(
             trim((coalesce(nullif(current_setting('request.headers', true), ''), '{}')::jsonb ->> 'x-forwarded-for')),
             '[[:space:]]*,[[:space:]]*') as ips
  )
  select private.hmac_visitante(
           coalesce(
             nullif(ips[greatest(1, coalesce(array_length(ips, 1), 0) - private.saltos_proxy_confiables())], ''),
             'sin-ip')
           || '|' || coalesce(private.normalizar_host(p_host), ''))
  from cadena;
$$;

comment on function private.visitante_publico(text) is
  'F-TDA-15 (D3) / MSF-946: HMAC-SHA256 (secreto de Vault) de la IP del cliente según x-forwarded-for y private.saltos_proxy_confiables() + host; sin cabecera, cupo único «sin-ip» (igual que visitante_hash). Nunca devuelve ni guarda la IP.';

revoke execute on function private.visitante_publico(text) from public, anon, authenticated;
