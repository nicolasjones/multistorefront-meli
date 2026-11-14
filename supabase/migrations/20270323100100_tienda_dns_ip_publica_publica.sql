-- MSF-797 (épica contenedora MSF-515, Lote 1), parte (a): `public.tienda_dns_plataforma.ip_publica` solo validaba el
-- FORMATO (`^[0-9]{1,3}(\.[0-9]{1,3}){3}$`): admitía octetos > 255, loopback y redes privadas. Esa IP la lee la Edge Function
-- `verificar-dominio-tienda`, que abre una conexión TLS directo a ella, y es el valor que la tienda le muestra a la
-- clienta como registro A: una IP no pública la apuntaría a una red interna o a nada.
--
-- Esquemas (Principio VII, re-verificado):
--   * `public.tienda_dns_plataforma` (alterada: un CHECK nuevo) -> `public`: configuración de plataforma, sin cambios de esquema.
--   * `private.ip_publica_valida(text)` (función nueva) -> `private`: lógica interna.
--   * `public.obtener_dominio_tienda` y `public.preparar_verificacion_tienda` (funciones reemplazadas, misma firma y grants).
--
-- Rangos rechazados (IPv4 no pública o de uso especial): 0.0.0.0/8, 10.0.0.0/8, 100.64.0.0/10 (CGNAT), 127.0.0.0/8,
-- 169.254.0.0/16, 172.16.0.0/12, 192.0.0.0/24, 192.0.2.0/24 (TEST-NET-1), 192.168.0.0/16, 198.18.0.0/15 (pruebas de
-- rendimiento), 224.0.0.0/4 (multicast) y 240.0.0.0/4 (reservado y broadcast). Cuatro octetos 0–255 sin ceros a la
-- izquierda (`010` se lee como octal en algunos resolvedores).
-- EXCEPCIÓN DECIDIDA: 198.51.100.0/24 (TEST-NET-2) y 203.0.113.0/24 (TEST-NET-3) SÍ se admiten. La migración
-- 20270205110000 siembra `203.0.113.24` como valor de documentación en cada entorno nuevo (local, CI, staging) y los
-- tests (Deno y Vitest) usan 203.0.113.x / 198.51.100.x; rechazarlas rompería el seed y la cola de migraciones. No son
-- enrutables en Internet (RFC 5737), así que una conexión a ellas no llega a ninguna red interna: el riesgo que cierra
-- este CHECK (loopback/privadas) no existe ahí. El equipo técnico debe reemplazarlas por la IP real (docs/tiendas-online.md).
--
-- Robustez de la cola: el CHECK se crea NOT VALID (rige para toda escritura nueva) y luego se intenta validar; si una fila
-- existente de algún entorno ya tiene una IP no pública NO se rompe la cola: queda un aviso (`raise warning`) y la
-- constraint pendiente de validar hasta que el equipo técnico corrija la fila y corra `alter table ... validate constraint`.
-- Entretanto las dos RPC ya dejan de usar una IP no pública (ver abajo). La fila de dev (212.90.120.53) es pública.
--
-- Aditiva e idempotente. Reversión (migración posterior):
--   alter table public.tienda_dns_plataforma drop constraint if exists tienda_dns_plataforma_ip_publica;
--   (reponer las dos RPC con su definición de 20270205110000 y) drop function if exists private.ip_publica_valida(text);

create or replace function private.ip_publica_valida(p_ip text)
returns boolean
language sql
immutable
parallel safe
set search_path = ''
as $$
  select coalesce(
    case
      when p_ip ~ '^((25[0-5]|2[0-4][0-9]|1[0-9]{2}|[1-9]?[0-9])\.){3}(25[0-5]|2[0-4][0-9]|1[0-9]{2}|[1-9]?[0-9])$'
        then not (p_ip::inet <<= any (array[
          '0.0.0.0/8', '10.0.0.0/8', '100.64.0.0/10', '127.0.0.0/8', '169.254.0.0/16', '172.16.0.0/12',
          '192.0.0.0/24', '192.0.2.0/24', '192.168.0.0/16', '198.18.0.0/15', '224.0.0.0/4', '240.0.0.0/4'
        ]::inet[]))
      else false
    end,
    false);
$$;

comment on function private.ip_publica_valida(text) is
  'MSF-797: true si es una IPv4 en notación decimal estricta (4 octetos 0-255, sin ceros a la izquierda) fuera de los rangos no públicos (0/8, 10/8, 100.64/10, 127/8, 169.254/16, 172.16/12, 192.0.0/24, 192.0.2/24, 192.168/16, 198.18/15, 224/4, 240/4). Admite TEST-NET-2 y TEST-NET-3 (valor sembrado y tests).';

revoke execute on function private.ip_publica_valida(text) from public, anon;
grant execute on function private.ip_publica_valida(text) to authenticated;

-- CHECK sobre la configuración (la fila única). NOT VALID rige para todo insert/update desde ya.
alter table public.tienda_dns_plataforma drop constraint if exists tienda_dns_plataforma_ip_publica;
alter table public.tienda_dns_plataforma
  add constraint tienda_dns_plataforma_ip_publica check (private.ip_publica_valida(ip_publica)) not valid;

do $$
begin
  alter table public.tienda_dns_plataforma validate constraint tienda_dns_plataforma_ip_publica;
exception when check_violation then
  raise warning 'tienda_dns_plataforma.ip_publica no es una IPv4 pública: corregila con "update public.tienda_dns_plataforma set ip_publica = ''<IP pública>''" y luego "alter table public.tienda_dns_plataforma validate constraint tienda_dns_plataforma_ip_publica" (MSF-797)';
end;
$$;

comment on constraint tienda_dns_plataforma_ip_publica on public.tienda_dns_plataforma is
  'MSF-797: la IP del registro A debe ser una IPv4 pública (private.ip_publica_valida); se admiten los rangos de documentación TEST-NET-2/3 del seed.';

-- ============================================================================
-- RPC que leen la IP: defensa en profundidad (la fila podría estar pendiente de validar)
-- ============================================================================

-- obtener_dominio_tienda: no muestra un registro A con una IP no pública. Resto idéntico a 20270205110000.
create or replace function public.obtener_dominio_tienda(p_empresa_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_org uuid := private.empresa_de_tienda_editable(p_empresa_id);
  v_t dominio.tiendas;
  v_p public.tienda_dns_plataforma;
  v_objetivo text;
  v_registros jsonb;
  v_nombre_cname text;
begin
  select * into v_t from dominio.tiendas where empresa_id = p_empresa_id and organizacion_id = v_org;
  if not found then
    return jsonb_build_object(
      'dominio_vigente', null, 'dominio_pendiente', null, 'redireccion', null,
      'dominio_verificado', false, 'certificado', 'pendiente', 'ultima_verificacion', null,
      'registros', '[]'::jsonb
    );
  end if;

  select * into v_p from public.tienda_dns_plataforma limit 1;
  v_objetivo := coalesce(v_t.dominio_pendiente, v_t.dominio);
  v_nombre_cname := case
    when v_t.dominio_redireccion is null then null
    when right(v_t.dominio_redireccion, length(v_objetivo) + 1) = '.' || v_objetivo
      then left(v_t.dominio_redireccion, length(v_t.dominio_redireccion) - length(v_objetivo) - 1)
    else v_t.dominio_redireccion
  end;

  select coalesce(jsonb_agg(
           jsonb_build_object(
             'tipo', r.tipo, 'nombre', r.nombre, 'valor', r.valor,
             'estado', coalesce(d.estado, 'pendiente'),
             'encontrado', case when coalesce(d.estado, 'pendiente') = 'incorrecto' then d.valor_encontrado end
           ) order by r.orden),
         '[]'::jsonb)
    into v_registros
    from (
      select 'A'::text as tipo, '@'::text as nombre, v_p.ip_publica as valor, 1 as orden
      where private.ip_publica_valida(v_p.ip_publica)
      union all
      select 'CNAME', v_nombre_cname, v_p.cname_destino, 2
      where v_nombre_cname is not null and v_p.cname_destino is not null
      union all
      select 'TXT', '_verif', v_p.prefijo_txt || '=' || v_t.token_verificacion, 3
      where v_p.prefijo_txt is not null
    ) r
    left join dominio.tienda_registros_dns d on d.empresa_id = p_empresa_id and d.tipo = r.tipo;

  return jsonb_build_object(
    'dominio_vigente', v_t.dominio,
    'dominio_pendiente', v_t.dominio_pendiente,
    'redireccion', v_t.dominio_redireccion,
    'dominio_verificado', v_t.dominio_verificado_at is not null,
    'certificado', v_t.certificado_estado,
    'ultima_verificacion', v_t.ultima_verificacion_at,
    'registros', v_registros
  );
end;
$$;

-- preparar_verificacion_tienda: con una IP no pública responde `plataforma_no_configurada` (22023) y no abre ninguna conexión.
-- Resto idéntico a 20270205110000.
create or replace function public.preparar_verificacion_tienda(p_empresa_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid := private.empresa_de_tienda_editable(p_empresa_id);
  v_t dominio.tiendas;
  v_p public.tienda_dns_plataforma;
begin
  select * into v_t from dominio.tiendas where empresa_id = p_empresa_id and organizacion_id = v_org;
  if not found then
    raise exception 'sin_dominio' using errcode = '22023';
  end if;
  select * into v_p from public.tienda_dns_plataforma limit 1;
  if not found then
    raise exception 'sin_dominio' using errcode = '22023';
  end if;
  -- MSF-797: la Edge Function abre una conexión TLS a esta IP; si la configuración no es una IPv4 pública
  -- (loopback, red privada, etc.) no se verifica nada ni se gasta el límite de 10 s.
  if not private.ip_publica_valida(v_p.ip_publica) then
    raise exception 'plataforma_no_configurada' using errcode = '22023';
  end if;

  -- Atómico: solo uno gana si llegan dos pedidos juntos.
  update dominio.tiendas
     set verificacion_solicitada_at = now(),
         verificacion_solicitada_por = (select auth.uid())
   where empresa_id = p_empresa_id
     and (verificacion_solicitada_at is null or verificacion_solicitada_at <= now() - interval '10 seconds');
  if not found then
    raise exception 'demasiado_pronto' using errcode = '55000';
  end if;

  return jsonb_build_object(
    'dominio', coalesce(v_t.dominio_pendiente, v_t.dominio),
    'redireccion', v_t.dominio_redireccion,
    'token', v_t.token_verificacion,
    'ip_publica', v_p.ip_publica,
    'cname_destino', v_p.cname_destino,
    'prefijo_txt', v_p.prefijo_txt
  );
end;
$$;
