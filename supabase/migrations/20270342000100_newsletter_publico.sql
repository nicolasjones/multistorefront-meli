-- MSF-468 (spec 20270328-100000-newsletter-de-la-tienda), Fase 1 · T002: RPC públicas del newsletter (RF-NL-1, RF-NL-3, RF-NL-5; D1, D2, D4).
--
-- Esquemas (Principio VII): solo funciones. `publico.*` es la superficie anónima de la tienda (sin tablas, como el contacto);
-- `private.validar_suscripcion_newsletter` es lógica interna sin acceso de API. Escriben `dominio.newsletter_suscriptores` y
-- `dominio.tienda_envios` (por `private.registrar_envio_tienda`).
--
-- Seguridad: `anon` solo ejecuta las tres funciones `publico` (security definer, search_path vacío). Ninguna devuelve ids, hash,
-- IP ni el estado de la dirección; el `error` es idéntico para host desconocido, tienda apagada, interruptor apagado y bandera
-- apagada. El límite es el del contacto: 5 por hora por visitante HMAC y tienda (`registrar_envio_tienda(…, 'newsletter', clave)`),
-- más 3 confirmaciones por dirección y 24 h. La validación corre ANTES del límite (un correo inválido no consume cupo).
--
-- Aditiva. Reversión (migración posterior):
--   drop function publico.confirmar_newsletter(text, text);
--   drop function publico.suscribirse_newsletter(text, text, boolean, uuid, text);
--   drop function publico.newsletter_por_dominio(text);
--   drop function private.validar_suscripcion_newsletter(text, boolean);
--   drop function private.empresa_newsletter_activa(text);

-- Tope GLOBAL por tienda: máximo de confirmaciones nuevas por hora (cualquier dirección). Frena el abuso con alias de proveedor
-- (`+tag`, puntos de Gmail, catch-all) que el tope por dirección no ve. El exceso queda sin enviar y sin distinguirse hacia afuera.
create or replace function private.tope_confirmaciones_hora_newsletter()
returns integer
language sql
immutable
set search_path = ''
as $$ select 200; $$;

revoke execute on function private.tope_confirmaciones_hora_newsletter() from public, anon, authenticated;

-- Texto de consentimiento vigente (D2). Subir la versión cuando cambie el texto del formulario.
create or replace function private.version_consentimiento_newsletter()
returns text
language sql
immutable
set search_path = ''
as $$ select 'newsletter-v1'; $$;

revoke execute on function private.version_consentimiento_newsletter() from public, anon, authenticated;

-- Empresa de la tienda del host SOLO si la tienda está activa, la bandera `newsletter` está encendida y el interruptor de
-- esa tienda también lo está. Si no, null (el motivo no se distingue hacia afuera).
create or replace function private.empresa_newsletter_activa(p_host text)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select e.id
    from dominio.tiendas t
    join dominio.empresas e on e.id = t.empresa_id and e.organizacion_id = t.organizacion_id
    join dominio.newsletter_configuracion c on c.empresa_id = e.id and c.organizacion_id = e.organizacion_id
   where t.dominio = private.normalizar_host(p_host)
     and e.activa
     and c.activo
     and private.bandera_activa('newsletter');
$$;

revoke execute on function private.empresa_newsletter_activa(text) from public, anon, authenticated;

-- Reglas por campo (espejo de apps/web/src/lib/tiendaNewsletter.ts). Devuelve los campos inválidos.
create or replace function private.validar_suscripcion_newsletter(p_correo text, p_consentimiento boolean)
returns text[]
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_correo text := lower(btrim(coalesce(p_correo, '')));
  v_campos text[] := '{}';
begin
  if v_correo = '' or char_length(v_correo) > 254 or v_correo !~ '^[a-z0-9''+_=&*#$?^{}~-]+(\.[a-z0-9''+_=&*#$?^{}~-]+)*@([a-z0-9]([a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}$'
     or char_length(split_part(v_correo, '@', 1)) > 64 then
    v_campos := array_append(v_campos, 'correo');
  end if;
  if p_consentimiento is distinct from true then
    v_campos := array_append(v_campos, 'consentimiento');
  end if;
  return v_campos;
end;
$$;

revoke execute on function private.validar_suscripcion_newsletter(text, boolean) from public, anon, authenticated;

-- RF-NL-1 · {activo, tienda}. `activo` solo con bandera, interruptor y tienda activos; el resto es `{activo: false}`.
create or replace function publico.newsletter_por_dominio(p_host text)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (select jsonb_build_object('activo', true, 'tienda', e.nombre)
       from dominio.empresas e
      where e.id = private.empresa_newsletter_activa(p_host)),
    jsonb_build_object('activo', false));
$$;

comment on function publico.newsletter_por_dominio(text) is
  'MSF-468 (RF-NL-1): {activo, tienda}; activo solo con la bandera newsletter, el interruptor de la tienda y la tienda activos. Mismo resultado para host desconocido o apagado.';

revoke execute on function publico.newsletter_por_dominio(text) from public, anon;
grant execute on function publico.newsletter_por_dominio(text) to anon, authenticated;

-- RF-NL-3 · suscripción. ok | invalido (campos) | limite (espera_segundos) | error. `ok` es idéntico para dirección nueva,
-- existente, en baja, con la trampa llena o con el tope por dirección superado.
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

    select e.organizacion_id into v_org from dominio.empresas e where e.id = v_empresa;
    -- Un lock por (tienda, dirección): dos pedidos simultáneos dejan una sola fila y un solo correo.
    perform pg_advisory_xact_lock(hashtextextended(v_empresa::text || '|' || v_correo, 1));

    select * into v_fila from dominio.newsletter_suscriptores s
     where s.empresa_id = v_empresa and lower(s.correo) = v_correo;

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
        null; -- tope global por tienda superado: sin enviar y con la misma respuesta.
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
  exception when others then
    -- Rastro solo con sqlstate: sqlerrm puede traer el correo del visitante.
    raise warning 'suscribirse_newsletter falló: %', sqlstate;
    return jsonb_build_object('resultado', 'error');
  end;
  return jsonb_build_object('resultado', 'ok');
end;
$$;

comment on function publico.suscribirse_newsletter(text, text, boolean, uuid, text) is
  'MSF-468 (RF-NL-3, D1, D2, D4): alta pública pendiente de confirmación. La tienda sale del host; ok|invalido|limite|error sin ids, hash ni IP; ok idéntico exista o no la dirección.';

revoke execute on function publico.suscribirse_newsletter(text, text, boolean, uuid, text) from public, anon;
grant execute on function publico.suscribirse_newsletter(text, text, boolean, uuid, text) to anon, authenticated;

-- RF-NL-5 · confirmación con el token del correo. ok | vencido | invalido (| limite con espera_segundos, del mismo
-- límite por visitante). Idempotente: un enlace ya usado responde `ok`. Solo cuenta para el límite si el token tiene forma válida.
create or replace function publico.confirmar_newsletter(p_host text, p_token text)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_empresa uuid := private.empresa_newsletter_activa(p_host);
  v_hash text;
  v_registro jsonb;
  v_fila dominio.newsletter_suscriptores%rowtype;
begin
  if v_empresa is null or p_token is null or p_token !~ '^[0-9a-f]{64}$' then
    return jsonb_build_object('resultado', 'invalido');
  end if;

  v_registro := private.registrar_envio_tienda(v_empresa, 'newsletter', gen_random_uuid());
  if v_registro ->> 'estado' = 'limite' then
    return jsonb_build_object('resultado', 'limite', 'espera_segundos', (v_registro ->> 'espera_segundos')::integer);
  end if;

  v_hash := encode(sha256(convert_to(p_token, 'utf8')), 'hex');
  select * into v_fila from dominio.newsletter_suscriptores s
   where s.empresa_id = v_empresa and s.confirmacion_hash = v_hash
     for update;
  if not found or v_fila.estado = 'baja' then
    return jsonb_build_object('resultado', 'invalido');
  end if;
  if v_fila.estado = 'confirmado' then
    return jsonb_build_object('resultado', 'ok');
  end if;
  if v_fila.confirmacion_vence is null or v_fila.confirmacion_vence <= now() then
    return jsonb_build_object('resultado', 'vencido');
  end if;

  update dominio.newsletter_suscriptores s
     set estado = 'confirmado', confirmado_en = now(), baja_en = null
   where s.id = v_fila.id;
  return jsonb_build_object('resultado', 'ok');
end;
$$;

comment on function publico.confirmar_newsletter(text, text) is
  'MSF-468 (RF-NL-5, D1): confirma la suscripción con el token del correo (solo se compara su SHA-256, y debe ser de la tienda del host). ok|vencido|invalido; idempotente.';

revoke execute on function publico.confirmar_newsletter(text, text) from public, anon;
grant execute on function publico.confirmar_newsletter(text, text) to anon, authenticated;
