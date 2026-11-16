-- MSF-233: arreglos de las revisiones independientes (QA y Código/Seguridad).
--
-- 1. rotar_clave_api: la clave nueva hereda el vencimiento de la original y la
--    gracia de 24 h no alarga la vida de la clave anterior (least).
-- 2. api_registrar_llamada: tope de 600 filas/min para llamadas sin clave válida.
-- 3. api_url_destino_valida: «localhost.» con punto final se rechaza.
-- 4. purgar_api_llamadas: las reservas de límite (estado 102) que quedaron
--    colgadas porque la función murió pasan a 500.
-- 5. Índices de paginación por cursor (organizacion_id primero).
--
-- Reversión: volver a las definiciones de 20270224110201, 20270224110202 y
-- 20270224110204 (create or replace) y `drop index` de los tres índices de abajo.

create or replace function public.rotar_clave_api(p_clave_id uuid)
returns table (id uuid, valor text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_clave public.api_claves;
  v_organizacion_id uuid := (select private.organizacion_id());
  v_prefijo text;
  v_token text;
  v_id uuid;
begin
  if v_organizacion_id is null or not (select private.puede_escribir()) then
    raise exception 'Solo un administrador puede rotar claves de API' using errcode = '42501';
  end if;

  -- `public.api_claves.id` va cualificado: el parámetro de salida de la RPC
  -- también se llama `id` y, sin calificar, la referencia sería ambigua.
  select * into v_clave from public.api_claves where public.api_claves.id = p_clave_id;
  if not found then
    raise exception 'La clave no existe' using errcode = 'P0002';
  end if;

  if v_clave.organizacion_id <> v_organizacion_id then
    raise exception 'La clave pertenece a otra organización' using errcode = '42501';
  end if;

  if v_clave.revocada_en is not null then
    raise exception 'La clave está revocada' using errcode = '22023';
  end if;

  -- La gracia de 24 h (D-3) se otorga UNA sola vez y nunca revive una clave
  -- vencida: rotar dos veces la misma clave no extiende la ventana, y rotar
  -- una clave ya vencida entrega la nueva sin resucitar la vieja.
  if (v_clave.vence_en is null or v_clave.vence_en > now()) and v_clave.rotada_en is null then
    -- La gracia nunca alarga la vida de la clave anterior: vence en 24 h o en su
    -- vencimiento original, lo que ocurra primero.
    update public.api_claves
       set vence_en = least(coalesce(public.api_claves.vence_en, 'infinity'::timestamptz), now() + interval '24 hours'),
           rotada_en = now()
     where public.api_claves.id = p_clave_id;
  end if;

  v_prefijo := (select private.api_prefijo_aleatorio());
  v_token := 'msf_' || v_prefijo || '_' || (select private.api_secreto_aleatorio());

  -- La clave nueva hereda el vencimiento de la original si todavía está en el
  -- futuro; si la original ya había vencido, nace sin vencimiento (rotar una
  -- clave vencida es la forma de renovarla).
  insert into public.api_claves (organizacion_id, nombre, prefijo, hash, alcances, limite_por_minuto, vence_en, creada_por)
  values (v_clave.organizacion_id, v_clave.nombre, v_prefijo, extensions.digest(v_token, 'sha256'),
    v_clave.alcances, v_clave.limite_por_minuto,
    case when v_clave.vence_en > now() then v_clave.vence_en end, (select auth.uid()))
  returning api_claves.id into v_id;

  return query select v_id, v_token;
end;
$$;

revoke execute on function public.rotar_clave_api(uuid) from public, anon;
grant execute on function public.rotar_clave_api(uuid) to authenticated;

drop function if exists public.api_registrar_llamada(uuid, uuid, text, text, text, integer, integer, uuid);
create or replace function public.api_registrar_llamada(
  p_clave_id uuid,
  p_organizacion_id uuid,
  p_metodo text,
  p_ruta text,
  p_version text,
  p_estado_http integer,
  p_duracion_ms integer,
  p_reserva_id uuid default null
)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_actualizadas integer := 0;
  v_sin_clave integer;
begin
  if p_reserva_id is not null then
    update public.api_llamadas
       set metodo = btrim(coalesce(p_metodo, 'GET')),
           ruta = btrim(coalesce(p_ruta, '')),
           version = btrim(coalesce(p_version, '')),
           estado_http = coalesce(p_estado_http, 500),
           duracion_ms = p_duracion_ms
     where public.api_llamadas.id = p_reserva_id
       and public.api_llamadas.clave_id is not distinct from p_clave_id;
    get diagnostics v_actualizadas = row_count;
  end if;

  -- Tope de auditoría para llamadas SIN clave válida (token inventado, ruta
  -- inexistente): son las únicas que un tercero puede disparar sin límite, porque
  -- el control de tasa corre después de validar la clave. Se siguen auditando
  -- (FR-008), pero hasta 600 por minuto y por organización (o sin organización):
  -- el exceso no se guarda, así una ráfaga no llena la tabla ni los índices.
  if v_actualizadas = 0 and p_clave_id is null then
    select count(*) into v_sin_clave
      from public.api_llamadas
     where public.api_llamadas.clave_id is null
       and public.api_llamadas.creada_en > now() - interval '1 minute'
       and case
             when p_organizacion_id is null then public.api_llamadas.organizacion_id is null
             else public.api_llamadas.organizacion_id = p_organizacion_id
           end;
    if v_sin_clave >= 600 then
      return;
    end if;
  end if;

  if v_actualizadas = 0 then
    insert into public.api_llamadas (organizacion_id, clave_id, metodo, ruta, version, estado_http, duracion_ms)
    values (p_organizacion_id, p_clave_id, btrim(coalesce(p_metodo, 'GET')),
      btrim(coalesce(p_ruta, '')), btrim(coalesce(p_version, '')),
      coalesce(p_estado_http, 500), p_duracion_ms);
  end if;

  if p_clave_id is not null and coalesce(p_estado_http, 500) <> 401 then
    update public.api_claves
       set ultimo_uso_en = now()
     where public.api_claves.id = p_clave_id;
  end if;
end;
$$;

revoke execute on function public.api_registrar_llamada(uuid, uuid, text, text, text, integer, integer, uuid)
  from public, anon, authenticated;
grant execute on function public.api_registrar_llamada(uuid, uuid, text, text, text, integer, integer, uuid)
  to service_role;

create or replace function private.api_url_destino_valida(p_url text)
returns boolean
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_url text := btrim(coalesce(p_url, ''));
  v_host text;
  v_ip inet;
begin
  if v_url = '' or v_url !~ '^https://' then
    return false;
  end if;

  -- Credenciales en la URL (https://usuario:clave@host/...).
  if v_url ~ '^https://[^/]*@' then
    return false;
  end if;

  v_host := lower(split_part(split_part(v_url, '://', 2), '/', 1));
  v_host := split_part(v_host, ':', 1);
  -- «localhost.» (punto final de nombre absoluto) es el mismo host que «localhost».
  v_host := regexp_replace(v_host, '\.+$', '');

  if v_host = '' then
    return false;
  end if;

  -- Direcciones IPv6 literales: todas se rechazan (loopback, link-local y
  -- ULA no se pueden discriminar con una regla simple).
  if v_host like '[%' then
    return false;
  end if;

  -- Un host solo puede tener letras, dígitos, guiones y puntos: cualquier otra
  -- cosa (espacios, percent-encoding, caracteres de control) no es un destino
  -- válido.
  if v_host !~ '^[a-z0-9.-]+$' then
    return false;
  end if;

  if v_host = 'localhost'
    or v_host like '%.localhost'
    or v_host like '%.local'
    or v_host like '%.internal'
    or v_host = 'metadata.google.internal'
    or v_host like '%.metadata.google.internal' then
    return false;
  end if;

  -- IPv4 literal: solo se acepta el cuádruplo punteado canónico. Las otras
  -- notaciones ('127.1', '0177.0.0.1', '2130706433', '0x7f000001') las
  -- resuelve el sistema a direcciones internas aunque no parezcan una IP:
  -- se rechazan todas (FR-010).
  if v_host ~ '^[0-9.]+$' or v_host ~ '^0[xX]' then
    if v_host !~ '^(25[0-5]|2[0-4][0-9]|1[0-9]{2}|[1-9]?[0-9])(\.(25[0-5]|2[0-4][0-9]|1[0-9]{2}|[1-9]?[0-9])){3}$' then
      return false;
    end if;

    v_ip := v_host::inet;
    if v_ip << '0.0.0.0/8'::inet
      or v_ip << '10.0.0.0/8'::inet
      or v_ip << '127.0.0.0/8'::inet
      or v_ip << '169.254.0.0/16'::inet
      or v_ip << '172.16.0.0/12'::inet
      or v_ip << '192.168.0.0/16'::inet
      or v_ip << '100.64.0.0/10'::inet
      or v_ip << '192.0.0.0/24'::inet
      or v_ip << '198.18.0.0/15'::inet
      or v_ip >= '224.0.0.0/4'::inet then
      return false;
    end if;

    return true;
  end if;

  return true;
end;
$$;

create or replace function private.purgar_api_llamadas(p_retencion_dias integer default 90)
returns integer
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_borradas integer;
begin
  if p_retencion_dias is null or p_retencion_dias < 1 or p_retencion_dias > 3650 then
    raise exception 'RETENCION_INVALIDA' using errcode = '22023';
  end if;

  -- Una reserva de límite (102) que sigue así pasados 5 minutos es una llamada
  -- cuya función murió antes de completarla: se deja como error del servidor.
  update public.api_llamadas
     set estado_http = 500
   where public.api_llamadas.estado_http = 102
     and public.api_llamadas.creada_en < now() - interval '5 minutes';

  delete from public.api_llamadas
   where creada_en < now() - make_interval(days => p_retencion_dias);

  get diagnostics v_borradas = row_count;
  return v_borradas;
end;
$$;

revoke execute on function private.purgar_api_llamadas(integer) from public, anon, authenticated;
grant execute on function private.purgar_api_llamadas(integer) to kestra_orquestacion, service_role;

create index if not exists api_paginacion_productos_idx
  on dominio.productos (organizacion_id, updated_at, id);
create index if not exists api_paginacion_existencias_idx
  on dominio.existencias_deposito (organizacion_id, updated_at, producto_id, deposito_id);
create index if not exists api_paginacion_ventas_idx
  on dominio.comprobantes_venta (organizacion_id, confirmado_en, id);
