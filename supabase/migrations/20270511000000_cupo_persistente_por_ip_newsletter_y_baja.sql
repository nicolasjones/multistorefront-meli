-- Lote 95 (MSF-971 y MSF-980): cupo PERSISTENTE por IP hasheada para la suscripción al newsletter y para la baja de correo masivo.
--
-- Qué hay y qué falta (verificado contra el árbol):
--   * MSF-971, alerta del tope global: YA existe (20270507110100, evento de Actividad `newsletter.tope_confirmaciones`, a lo sumo uno por hora y tienda).
--   * MSF-971, cupo separado: el cupo por visitante de `registrar_envio_tienda` es COMPARTIDO con el formulario de contacto, WhatsApp, pedidos y
--     presupuestos (5 por hora entre todos), se poda a las 24 h y no mira la red. Esta migración agrega un cupo PROPIO de la suscripción, con dos ámbitos:
--       - `newsletter-visitante`: 5 intentos por hora, por visitante (HMAC de su IP; en IPv6, de su /64) y tienda. Con el tope compartido de
--         `registrar_envio_tienda` igual (5 por hora) ese cupo NO es alcanzable por `suscribirse_newsletter`: el compartido corta antes, porque cuenta lo mismo y
--         más. Queda como defensa en profundidad por si alguien baja el compartido; se prueba directo sobre `private.consumir_cupo_newsletter`;
--       - `newsletter-red`: 30 intentos por hora, por red (HMAC de la red: /24 en IPv4, /48 en IPv6, canónica con `inet`; una IPv4 mapeada en IPv6 cuenta como
--         IPv4) y tienda. Llenar el tope global de 200 confirmaciones ya no alcanza con unos 40 visitantes sueltos de una misma red: hacen falta redes distintas.
--       - La IP del cliente sale de `x-forwarded-for` menos los saltos de proxy de confianza; con una cadena más corta que los saltos + 1 vale `sin-ip` (cupo
--         compartido que falla cerrado: el primer valor lo puede haber escrito el cliente y elegiría su propio cupo).
--   * MSF-980, rate limit de `baja-correo-masivo`: la función Edge no limitaba nada. Se suma `public.consumir_cupo_baja_correo(ip)` (solo service_role),
--     con 60 pedidos por hora y visitante (ámbito `baja-correo`). La función Edge responde 429 con `Retry-After` y, si la base no responde, 503 (falla cerrada).
--
-- Por qué NO hay CAPTCHA (decisión documentada en docs/newsletter.md): exige un servicio externo (Cloudflare Turnstile, hCaptcha), un secreto por entorno que
-- hoy no existe, una Edge Function intermedia y quitarle la RPC a `anon`; es infraestructura y un cambio de superficie pública. El cupo persistente por IP
-- hasheada cubre el abuso de un solo origen sin dependencias; el abuso distribuido (muchas redes) lo señala la alerta del tope y recién ahí se decide el CAPTCHA.
--
-- Qué se guarda: SOLO el HMAC-SHA256 hex con el secreto `visitante_hmac` de Vault (aleatorio por entorno, nunca en Git: 20270323100200) de
-- `ámbito|tienda|ip` (o del prefijo de red). Nunca la IP, ni la dirección de correo, ni el token. Sin la clave la función falla y el pedido se rechaza.
--
-- Esquemas (Principio VII): `private.cupo_publico_ip` es lógica interna de plataforma sin acceso de API (RLS activado y una política que deniega todo a
-- `anon` y `authenticated`; sin privilegios de tabla para nadie salvo el dueño). `public.consumir_cupo_baja_correo` es el envoltorio RPC (private no está
-- expuesto) y solo lo ejecuta `service_role`.
--
-- Poda: cada consumo borra hasta 200 ventanas anteriores a la hora previa (`for update skip locked`), sin cron ni worker; el límite es siempre por hora.
--
-- `publico.suscribirse_newsletter`: mismo cuerpo que 20270507110100 (mismos bloqueos, mismo orden, mismas respuestas); lo único nuevo es el consumo
-- del cupo DESPUÉS de registrar el envío compartido como nuevo (un reintento con la misma clave no gasta cupo); si se rechaza se deshace ese registro, de
-- modo que no queda una clave de idempotencia (un reintento con la misma clave no responde `ok` sin enviar). La respuesta `limite` depende solo del origen,
-- nunca de la dirección: no enumera suscriptores.
--
-- Orden de despliegue: esta migración ANTES que la función Edge `baja-correo-masivo` de este lote (sin `public.consumir_cupo_baja_correo` responde 503).
--
-- Reaplicable: `create ... if not exists`, `create or replace`, `drop policy if exists`.
--
-- Reversión (migración posterior; pasos reales y en orden). ADVERTENCIA: antes de borrar nada, volver a desplegar la versión ANTERIOR de
-- `baja-correo-masivo` (la de este lote responde 503 sin la función de cupo):
--   1. restaurar el cuerpo de `publico.suscribirse_newsletter` de 20270507110100;
--   2. drop function if exists public.consumir_cupo_baja_correo(text);
--   3. drop function if exists private.consumir_cupo_newsletter(uuid);
--   4. drop function if exists private.consumir_cupo_ip(text, text, integer);
--   5. drop function if exists private.red_de_ip(text), private.visitante_de_ip(text), private.inet_de_ip(text), private.ip_de_cadena(text, integer);
--   6. drop function if exists private.ip_cliente_publica();
--   7. drop function if exists private.limite_newsletter_visitante_hora(), private.limite_newsletter_red_hora(), private.limite_baja_correo_hora();
--   8. drop table if exists private.cupo_publico_ip;  (los contadores solo valen para la hora en curso).

create table if not exists private.cupo_publico_ip (
  ambito text not null,
  clave text not null,
  ventana timestamptz not null,
  usos integer not null,
  primary key (ambito, clave, ventana),
  constraint cupo_publico_ip_ambito_valido check (ambito in ('newsletter-visitante', 'newsletter-red', 'baja-correo')),
  -- HMAC-SHA256 en hexadecimal: nunca una IP.
  constraint cupo_publico_ip_clave_hmac check (clave ~ '^[0-9a-f]{64}$'),
  constraint cupo_publico_ip_usos_positivos check (usos >= 1),
  constraint cupo_publico_ip_ventana_horaria check (ventana = (date_trunc('hour', ventana at time zone 'UTC') at time zone 'UTC'))
);

comment on table private.cupo_publico_ip is
  'Cupo persistente por hora de los pedidos públicos anónimos (suscripción al newsletter y baja de correo masivo), por HMAC de IP o de red. Nunca guarda la IP. Solo lo toca private.consumir_cupo_ip.';

create index if not exists cupo_publico_ip_ventana_idx on private.cupo_publico_ip (ventana);

alter table private.cupo_publico_ip enable row level security;
revoke all on table private.cupo_publico_ip from public, anon, authenticated;

drop policy if exists cupo_publico_ip_denegar_todo on private.cupo_publico_ip;
create policy cupo_publico_ip_denegar_todo on private.cupo_publico_ip
  as permissive for all to anon, authenticated
  using (false) with check (false);

-- Topes: un solo lugar cada uno (se cambian con una migración nueva).
create or replace function private.limite_newsletter_visitante_hora()
returns integer language sql immutable set search_path = '' as $$ select 5; $$;
create or replace function private.limite_newsletter_red_hora()
returns integer language sql immutable set search_path = '' as $$ select 30; $$;
create or replace function private.limite_baja_correo_hora()
returns integer language sql immutable set search_path = '' as $$ select 60; $$;
revoke execute on function private.limite_newsletter_visitante_hora(), private.limite_newsletter_red_hora(), private.limite_baja_correo_hora() from public, anon, authenticated;

-- IP del cliente a partir de una cadena `x-forwarded-for` y los saltos de proxy de confianza: el valor que está `p_saltos` lugares antes del último. Sin valores,
-- o con una cadena MÁS CORTA que `p_saltos + 1` (algún proxy no agregó su IP, así que el primer valor lo puede haber escrito el cliente y elegiría su propio
-- cupo), un valor fijo: `sin-ip`, un cupo compartido que falla cerrado, igual que `consultar-estado-reparacion`. Los valores vacíos de la cadena se descartan.
create or replace function private.ip_de_cadena(p_cadena text, p_saltos integer)
returns text
language sql
immutable
set search_path = ''
as $$
  with cadena as (
    select array_remove(regexp_split_to_array(trim(coalesce(p_cadena, '')), '[[:space:]]*,[[:space:]]*'), '') as ips
  )
  select case
           when coalesce(array_length(ips, 1), 0) < greatest(0, coalesce(p_saltos, 0)) + 1 then 'sin-ip'
           else coalesce(nullif(left(ips[array_length(ips, 1) - greatest(0, coalesce(p_saltos, 0))], 64), ''), 'sin-ip')
         end
    from cadena;
$$;

comment on function private.ip_de_cadena(text, integer) is
  'MSF-971/980: IP del cliente de una cadena x-forwarded-for: el valor que está p_saltos lugares antes del último; con una cadena más corta que p_saltos + 1 o vacía, sin-ip (cupo compartido que falla cerrado).';
revoke execute on function private.ip_de_cadena(text, integer) from public, anon, authenticated;

create or replace function private.ip_cliente_publica()
returns text
language sql
stable
set search_path = ''
as $$
  select private.ip_de_cadena(
    coalesce(nullif(current_setting('request.headers', true), ''), '{}')::jsonb ->> 'x-forwarded-for',
    private.saltos_proxy_confiables());
$$;

comment on function private.ip_cliente_publica() is
  'MSF-971: IP del cliente según x-forwarded-for y private.saltos_proxy_confiables() (private.ip_de_cadena); sin cabecera o con una cadena más corta que los saltos, sin-ip. Solo se usa para calcular un HMAC.';
revoke execute on function private.ip_cliente_publica() from public, anon, authenticated;

-- Dirección canónica con `inet` (no con texto): sin corchetes ni puerto, sin importar mayúsculas ni formas comprimidas, y una IPv4 mapeada en IPv6
-- (::ffff:a.b.c.d) vale como la IPv4. Devuelve nulo si no es una IP (p. ej. `sin-ip`).
create or replace function private.inet_de_ip(p_ip text)
returns inet
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_texto text := btrim(coalesce(p_ip, ''));
  v_inet inet;
  v_v4 text;
begin
  if v_texto ~ '^\[[^]]+\](:[0-9]{1,5})?$' then
    v_texto := substring(v_texto from '^\[([^]]+)\]');
  elsif v_texto ~ '^[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}:[0-9]{1,5}$' then
    v_texto := substring(v_texto from '^([0-9.]+):');
  end if;
  begin
    v_inet := v_texto::inet;
  exception when others then
    return null;
  end;
  -- Una dirección con máscara (a.b.c.d/n) no es la de un cliente.
  if v_inet is null or masklen(v_inet) <> (case family(v_inet) when 4 then 32 else 128 end) then
    return null;
  end if;
  if family(v_inet) = 6 and v_inet <<= '::ffff:0:0/96'::inet then
    v_v4 := substring(host(v_inet) from '([0-9]+\.[0-9]+\.[0-9]+\.[0-9]+)$');
    if v_v4 is not null then
      return v_v4::inet;
    end if;
  end if;
  return v_inet;
end;
$$;

comment on function private.inet_de_ip(text) is
  'MSF-971/980: IP canónica (inet) de un texto: sin corchetes ni puerto, IPv4 mapeada en IPv6 como IPv4; nulo si no es una IP.';
revoke execute on function private.inet_de_ip(text) from public, anon, authenticated;

-- Visitante: la IPv4 exacta o, en IPv6, su /64 (una persona controla todo un /64: rotar direcciones dentro de él no abre cupos nuevos).
create or replace function private.visitante_de_ip(p_ip text)
returns text
language sql
immutable
set search_path = ''
as $$
  select coalesce(
    (select case family(i) when 4 then host(i) else host(network(set_masklen(i, 64))) end from (select private.inet_de_ip(p_ip) as i) x where i is not null),
    p_ip);
$$;

comment on function private.visitante_de_ip(text) is
  'MSF-971/980: identidad de un visitante para el cupo: IPv4 exacta o /64 en IPv6, canónica; lo que no es una IP (sin-ip) se devuelve igual.';
revoke execute on function private.visitante_de_ip(text) from public, anon, authenticated;

-- Red de una IP: /24 en IPv4 y /48 en IPv6, canónica con `inet` (host de la dirección de red); lo que no es una IP se devuelve igual.
create or replace function private.red_de_ip(p_ip text)
returns text
language sql
immutable
set search_path = ''
as $$
  select coalesce(
    (select case family(i) when 4 then host(network(set_masklen(i, 24))) else host(network(set_masklen(i, 48))) end from (select private.inet_de_ip(p_ip) as i) x where i is not null),
    p_ip);
$$;

comment on function private.red_de_ip(text) is
  'MSF-971: red de una IP para el cupo por red del newsletter: /24 en IPv4, /48 en IPv6, canónica con inet (la IPv4 mapeada en IPv6 cuenta como IPv4); lo que no es una IP se devuelve igual.';
revoke execute on function private.red_de_ip(text) from public, anon, authenticated;

-- Consume UN uso de la hora actual de forma atómica (`insert ... on conflict do update ... where usos < p_limite`): dos sesiones simultáneas nunca pasan del tope.
create or replace function private.consumir_cupo_ip(p_ambito text, p_clave text, p_limite integer)
returns table (se_consumio boolean, usos_actuales integer, segundos_hasta_reinicio integer)
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_ventana timestamptz := date_trunc('hour', now() at time zone 'UTC') at time zone 'UTC';
  v_usos integer;
  v_segundos integer;
begin
  if p_limite is null or p_limite < 1 or p_limite > 1000 then
    raise exception 'consumir_cupo_ip: el límite debe ser un entero entre 1 y 1000' using errcode = '22023';
  end if;
  v_segundos := greatest(1, ceil(extract(epoch from (v_ventana + interval '1 hour' - now())))::integer);

  -- Poda acotada de ventanas viejas (sin cron).
  delete from private.cupo_publico_ip c
   where c.ctid in (
     select v.ctid from private.cupo_publico_ip v
      where v.ventana < v_ventana - interval '1 hour'
      limit 200
      for update skip locked);

  insert into private.cupo_publico_ip as c (ambito, clave, ventana, usos)
  values (p_ambito, p_clave, v_ventana, 1)
  on conflict (ambito, clave, ventana) do update set usos = c.usos + 1 where c.usos < p_limite
  returning c.usos into v_usos;

  if v_usos is not null then
    return query select true, v_usos, v_segundos;
    return;
  end if;

  select c.usos into v_usos from private.cupo_publico_ip c where c.ambito = p_ambito and c.clave = p_clave and c.ventana = v_ventana;
  return query select false, coalesce(v_usos, p_limite), v_segundos;
end;
$$;

comment on function private.consumir_cupo_ip(text, text, integer) is
  'MSF-971/980: consume un uso del cupo horario de un ámbito y una clave HMAC (atómico). Devuelve se_consumio, usos_actuales y segundos_hasta_reinicio. Sin acceso de API.';
revoke all on function private.consumir_cupo_ip(text, text, integer) from public, anon, authenticated, service_role;

-- Cupo de la suscripción: por visitante y por red. Primero el visitante: si él ya agotó el suyo no se gasta el de su red.
create or replace function private.consumir_cupo_newsletter(p_empresa uuid)
returns table (se_consumio boolean, segundos_hasta_reinicio integer)
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_ip text := private.ip_cliente_publica();
  v_uso record;
begin
  select * into v_uso from private.consumir_cupo_ip(
    'newsletter-visitante', private.hmac_visitante('newsletter-visitante|' || p_empresa::text || '|' || private.visitante_de_ip(v_ip)), private.limite_newsletter_visitante_hora());
  if not v_uso.se_consumio then
    return query select false, v_uso.segundos_hasta_reinicio;
    return;
  end if;
  select * into v_uso from private.consumir_cupo_ip(
    'newsletter-red', private.hmac_visitante('newsletter-red|' || p_empresa::text || '|' || private.red_de_ip(v_ip)), private.limite_newsletter_red_hora());
  return query select v_uso.se_consumio, v_uso.segundos_hasta_reinicio;
end;
$$;

comment on function private.consumir_cupo_newsletter(uuid) is
  'MSF-971: consume el cupo de suscripción del visitante (5/h) y de su red (30/h) en la tienda. Falla si falta el secreto visitante_hmac. Sin acceso de API.';
revoke all on function private.consumir_cupo_newsletter(uuid) from public, anon, authenticated, service_role;

-- Cupo de la baja de correo masivo (MSF-980): la IP la manda la función Edge (service_role) y acá se convierte en HMAC; no se guarda.
create or replace function public.consumir_cupo_baja_correo(p_ip text)
returns table (se_consumio boolean, segundos_hasta_reinicio integer)
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_ip text := private.visitante_de_ip(coalesce(nullif(left(btrim(coalesce(p_ip, '')), 64), ''), 'sin-ip'));
  v_uso record;
begin
  select * into v_uso from private.consumir_cupo_ip(
    'baja-correo', private.hmac_visitante('baja-correo|' || v_ip), private.limite_baja_correo_hora());
  return query select v_uso.se_consumio, v_uso.segundos_hasta_reinicio;
end;
$$;

comment on function public.consumir_cupo_baja_correo(text) is
  'MSF-980: consume un pedido del cupo horario (60/h) de la baja de correo masivo para esa IP (se guarda solo su HMAC). Solo service_role (función Edge baja-correo-masivo).';
revoke all on function public.consumir_cupo_baja_correo(text) from public, anon, authenticated;
grant execute on function public.consumir_cupo_baja_correo(text) to service_role;

-- RF-NL-3 · suscripción. Cuerpo de 20270507110100 más el cupo propio por visitante y por red (MSF-971). ok | invalido (campos) | limite (espera_segundos) | error.
create or replace function publico.suscribirse_newsletter(
  p_host text,
  p_correo text,
  p_consentimiento boolean,
  p_clave uuid,
  p_trampa text
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_empresa uuid := private.empresa_newsletter_activa(p_host);
  v_org uuid;
  v_correo text := lower(btrim(coalesce(p_correo, '')));
  v_campos text[];
  v_registro jsonb;
  v_fila dominio.newsletter_suscriptores%rowtype;
  v_ventana_vigente boolean;
  v_cupo_global boolean;
  v_descartada boolean := false;
  v_cupo_ip record;
begin
  if v_empresa is null or p_clave is null then
    return jsonb_build_object('resultado', 'error');
  end if;

  -- Campo trampa (honeypot): se responde `ok` sin guardar ni consumir cupo.
  if btrim(coalesce(p_trampa, '')) <> '' then
    return jsonb_build_object('resultado', 'ok');
  end if;

  v_campos := private.validar_suscripcion_newsletter(p_correo, p_consentimiento);
  if cardinality(v_campos) > 0 then
    return jsonb_build_object('resultado', 'invalido', 'campos', to_jsonb(v_campos));
  end if;

  -- Sub-transacción: si algo falla se revierte también el registro del envío (no se gasta cupo).
  begin
    v_registro := private.registrar_envio_tienda(v_empresa, 'newsletter', p_clave);
    if v_registro ->> 'estado' = 'limite' then
      return jsonb_build_object('resultado', 'limite', 'espera_segundos', (v_registro ->> 'espera_segundos')::integer);
    end if;
    if v_registro ->> 'estado' = 'repetido' then
      return jsonb_build_object('resultado', 'ok');
    end if;

    -- Cupo propio de la suscripción (MSF-971): solo cuenta un pedido nuevo (un reintento con la misma clave no gasta). Depende solo del origen (IP
    -- hasheada), nunca de la dirección: no enumera suscriptores. Si se rechaza se deshace el registro compartido que se acaba de insertar, para que un
    -- reintento con la misma clave no responda `ok` sin enviar nada. Sin el secreto de Vault falla cerrado (`error`).
    select * into v_cupo_ip from private.consumir_cupo_newsletter(v_empresa);
    if not v_cupo_ip.se_consumio then
      delete from dominio.tienda_envios t where t.empresa_id = v_empresa and t.clave_envio = p_clave;
      return jsonb_build_object('resultado', 'limite', 'espera_segundos', v_cupo_ip.segundos_hasta_reinicio);
    end if;

    select e.organizacion_id into v_org from dominio.empresas e where e.id = v_empresa;
    -- Un lock por (tienda, dirección): dos pedidos simultáneos dejan una sola fila y un solo correo.
    perform pg_advisory_xact_lock(hashtextextended(v_empresa::text || '|' || v_correo, 1));

    -- Bloqueo de fila: si el flow está reclamando esta fila, se espera su commit y se decide con el hash ya generado (nunca se lo anula a ciegas).
    select * into v_fila from dominio.newsletter_suscriptores s
     where s.empresa_id = v_empresa and lower(s.correo) = v_correo
       for update;

    -- Un lock por tienda justo antes de contar: el tope global no se supera por concurrencia (siempre se toma después del lock por dirección).
    perform pg_advisory_xact_lock(hashtextextended('newsletter_tope|' || v_empresa::text, 2));

    select (select count(*) from dominio.newsletter_suscriptores x
             where x.empresa_id = v_empresa and x.confirmacion_solicitada_en > now() - interval '1 hour')
           < private.tope_confirmaciones_hora_newsletter()
      into v_cupo_global;

    if v_fila.id is null then
      if v_cupo_global then
        insert into dominio.newsletter_suscriptores (
          organizacion_id, empresa_id, correo, estado, origen, version_consentimiento, consentimiento_en,
          confirmacion_solicitada_en, confirmaciones_24h, confirmaciones_desde)
        values (
          v_org, v_empresa, v_correo, 'pendiente', 'formulario', private.version_consentimiento_newsletter(), now(),
          now(), 1, now());
      else
        v_descartada := true;
      end if; -- tope global por tienda superado: no se guarda ni se envía, y la respuesta sigue siendo `ok`.
    elsif v_fila.estado = 'confirmado' then
      null; -- ya confirmada: no se envía otro correo y la respuesta es la misma.
    elsif v_fila.estado = 'pendiente' and v_fila.confirmacion_hash is not null and v_fila.confirmacion_vence > now() then
      null; -- ya hay un enlace vigente: no se emite otro ni se invalida el legítimo (nadie puede anular el enlace de un tercero).
    else
      v_ventana_vigente := v_fila.confirmaciones_desde is not null and v_fila.confirmaciones_desde > now() - interval '24 hours';
      if v_ventana_vigente and v_fila.confirmaciones_24h >= 3 then
        null; -- tope por dirección: el cuarto pedido responde `ok` sin enviar.
      elsif not v_cupo_global then
        v_descartada := true; -- tope global por tienda superado: sin enviar y con la misma respuesta.
      else
        -- Una dirección en `baja` conserva `baja_en` (lista de supresión) hasta que se confirme de nuevo.
        update dominio.newsletter_suscriptores s
           set estado = 'pendiente',
               version_consentimiento = private.version_consentimiento_newsletter(),
               consentimiento_en = now(),
               confirmado_en = null,
               confirmacion_hash = null,
               confirmacion_vence = null,
               confirmacion_solicitada_en = now(),
               confirmacion_reclamada_hasta = null,
               confirmacion_intentos = 0,
               confirmaciones_24h = case when v_ventana_vigente then s.confirmaciones_24h + 1 else 1 end,
               confirmaciones_desde = case when v_ventana_vigente then s.confirmaciones_desde else now() end
         where s.id = v_fila.id;
      end if;
    end if;

    -- Alerta del tope (MSF-971): una alta legítima se acaba de descartar en silencio. Un evento de Actividad sin datos personales, a lo sumo
    -- uno por hora y tienda (dentro del lock por tienda que ya se tomó arriba, así que la comprobación no se pisa por concurrencia).
    if v_descartada then
      perform private.alertar_tope_confirmaciones_newsletter(v_org, v_empresa);
    end if;
  exception when others then
    -- Rastro solo con sqlstate: sqlerrm puede traer el correo del visitante.
    raise warning 'suscribirse_newsletter falló: %', sqlstate;
    return jsonb_build_object('resultado', 'error');
  end;
  return jsonb_build_object('resultado', 'ok');
end;
$$;

comment on function publico.suscribirse_newsletter(text, text, boolean, uuid, text) is
  'MSF-468 (RF-NL-3, D1, D2, D4): alta pública pendiente de confirmación. La tienda sale del host; ok|invalido|limite|error sin ids, hash ni IP; ok idéntico exista o no la dirección. MSF-971: cupo propio por visitante (5/h) y por red (30/h), con la IP hasheada (`limite` con la espera); si el tope global por hora descarta una alta, registra (a lo sumo uno por hora y tienda) el evento de Actividad newsletter.tope_confirmaciones, sin cambiar la respuesta.';

revoke execute on function publico.suscribirse_newsletter(text, text, boolean, uuid, text) from public, anon;
grant execute on function publico.suscribirse_newsletter(text, text, boolean, uuid, text) to anon, authenticated;
