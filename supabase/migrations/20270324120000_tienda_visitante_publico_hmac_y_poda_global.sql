-- MSF-946 / MSF-947 (seguimientos de MSF-945, épica MSF-515 lote 3)
--
-- MSF-946: `private.visitante_publico` (límite de búsquedas y de pedidos públicos) seguía con sha256(ip|host) sin clave,
--   enumerable igual que lo era `visitante_hash`. Pasa a HMAC con el secreto `visitante_hmac` de Vault (el mismo de
--   MSF-945, `private.hmac_visitante`). Misma firma y misma entrada; solo cambia el algoritmo. Las filas de
--   `limite_pedidos_publicos` viven minutos (se podan a los 10 min), así que el cambio de clave solo reinicia los
--   cupos en curso una vez.
-- MSF-947: la poda de `dominio.tienda_envios` corría solo por empresa al registrar un envío, de modo que las empresas
--   sin tráfico conservaban sus filas. Ahora cada registro poda además, de forma acotada (500 filas), lo vencido de
--   cualquier empresa, apoyado en un índice por `creado_en`.
--
-- Reversión:
--   restaurar private.visitante_publico y private.registrar_envio_tienda desde 20261203110300 y 20261212120700;
--   drop index if exists dominio.tienda_envios_creado_idx;

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
             'desconocido')
           || '|' || coalesce(private.normalizar_host(p_host), ''))
  from cadena;
$$;

comment on function private.visitante_publico(text) is
  'F-TDA-15 (D3) / MSF-946: HMAC-SHA256 (secreto de Vault) de la IP del cliente según x-forwarded-for y private.saltos_proxy_confiables() + host. Nunca devuelve ni guarda la IP.';

revoke execute on function private.visitante_publico(text) from public, anon, authenticated;

create index if not exists tienda_envios_creado_idx on dominio.tienda_envios (creado_en);

create or replace function private.registrar_envio_tienda(p_empresa uuid, p_origen text, p_clave uuid)
returns jsonb
language plpgsql
volatile
set search_path = ''
as $$
declare
  v_org uuid;
  v_visitante text := private.visitante_hash(p_empresa);
  v_cantidad integer;
  v_mas_antiguo timestamptz;
begin
  select e.organizacion_id into v_org from dominio.empresas e where e.id = p_empresa;
  if v_org is null then
    raise exception 'Empresa inexistente' using errcode = 'P0002';
  end if;

  -- Un lock por (empresa, visitante): dos envíos simultáneos no superan el cupo.
  perform pg_advisory_xact_lock(hashtextextended(p_empresa::text || '|' || v_visitante, 0));

  -- Poda de lo viejo (más de 24 h) sin worker ni cron: la de esta empresa y, acotada, la de cualquier otra (MSF-947).
  delete from dominio.tienda_envios
   where empresa_id = p_empresa and creado_en < now() - interval '24 hours';
  delete from dominio.tienda_envios t
   where t.ctid in (
     select v.ctid from dominio.tienda_envios v
      where v.creado_en < now() - interval '24 hours'
      limit 500
      for update skip locked);

  if exists (select 1 from dominio.tienda_envios where empresa_id = p_empresa and clave_envio = p_clave) then
    return jsonb_build_object('estado', 'repetido');
  end if;

  select count(*), min(creado_en) into v_cantidad, v_mas_antiguo
    from dominio.tienda_envios
   where empresa_id = p_empresa and visitante = v_visitante and creado_en > now() - interval '1 hour';

  if v_cantidad >= private.limite_envios_tienda() then
    return jsonb_build_object(
      'estado', 'limite',
      'espera_segundos', greatest(1, ceil(extract(epoch from (v_mas_antiguo + interval '1 hour' - now())))::integer));
  end if;

  insert into dominio.tienda_envios (organizacion_id, empresa_id, visitante, clave_envio, origen)
  values (v_org, p_empresa, v_visitante, p_clave, p_origen);
  return jsonb_build_object('estado', 'nuevo');
end;
$$;

comment on function private.registrar_envio_tienda(uuid, text, uuid) is
  'F-TDA-16 / MSF-947: registra un envío del visitante con lock por (empresa, visitante), poda > 24 h (la de la empresa y hasta 500 filas vencidas de cualquier otra), idempotencia por clave y tope por hora. Sin acceso para roles de API.';

revoke execute on function private.registrar_envio_tienda(uuid, text, uuid) from public, anon, authenticated;
