-- MSF-971 (seguimiento de la épica MSF-468, newsletter de la tienda, fases 1-2; plan de deuda técnica MSF-515): alerta al alcanzar el tope
-- global de confirmaciones.
--
-- Defecto: con el tope global (200 confirmaciones nuevas por hora y tienda, `private.tope_confirmaciones_hora_newsletter`) lleno,
-- `publico.suscribirse_newsletter` descarta las altas legítimas en silencio (responde `ok`, el correo de confirmación nunca sale) hasta una hora, y
-- nadie del equipo se entera: quien reúna 200 direcciones agota el cupo de la tienda sin dejar rastro visible.
--
-- Qué hace: cuando una alta (nueva, o el reenvío de una dirección que sí podía recibirlo) se descarta POR el tope global, la función registra un evento de
-- Actividad `newsletter.tope_confirmaciones` (no sensible, sin datos personales: ni dirección, ni IP, ni visitante), a lo sumo UNO por hora y tienda.
-- La respuesta hacia afuera no cambia en nada (`ok` idéntico, sin señal de tope: sin enumeración). Si la alerta fallara, la alta no falla ni cambia de
-- respuesta (el registro de la alerta va en su propio bloque con manejador).
--
-- Fuera de alcance (decisión documentada en docs/newsletter.md, «Seguimientos de seguridad»): el CAPTCHA o cupo por visitante. El cupo por visitante YA existe
-- (5 por hora y visitante HMAC y tienda, `registrar_envio_tienda`) y 40 visitantes a 5 por hora llenan el tope de todos modos: separar el cupo no
-- discrimina a quien reparte las altas entre direcciones IP; hace falta un desafío (CAPTCHA, infraestructura externa) o una decisión de producto sobre el tope.
--
-- Esquemas (Principio VII): sin tablas. `private` es lógica interna sin acceso de API; `publico` sigue sin tablas.
-- Funciones:
--   1. `private.alertar_tope_confirmaciones_newsletter(organizacion, empresa)` -> boolean (true si registró un evento). Sin `execute` para la API.
--   2. `publico.suscribirse_newsletter`: mismo cuerpo que 20270342000100 (mismos bloqueos y mismo orden; mismas respuestas), más el aviso del tope
--      al final del sub-bloque. Mismos grants (`anon` y `authenticated`).
-- El tipo de evento nuevo entra al catálogo (`public.tipos_evento_actividad`, no sensible) y a la etiqueta de la pantalla de Actividad.
--
-- Migración aditiva (`create or replace` + una fila del catálogo con `on conflict do nothing`). Reversión (migración posterior): restaurar el cuerpo de
-- `publico.suscribirse_newsletter` de 20270342000100, `drop function if exists private.alertar_tope_confirmaciones_newsletter(uuid, uuid);` y, si ya no hay eventos de ese
-- tipo que conservar, `delete from public.tipos_evento_actividad where tipo = 'newsletter.tope_confirmaciones'` (el registro de actividad es inalterable: los
-- eventos ya escritos quedan).

insert into public.tipos_evento_actividad (tipo, sensible, descripcion) values
  ('newsletter.tope_confirmaciones', false, 'Se alcanzó el tope de confirmaciones nuevas por hora del newsletter de la tienda (sin datos personales)')
on conflict (tipo) do nothing;

-- Registra el evento del tope, a lo sumo uno por hora y tienda. Quien llama ya tiene tomado el lock `newsletter_tope|<tienda>`, que serializa la
-- comprobación (dos altas simultáneas no emiten dos eventos). La búsqueda usa el índice (organizacion_id, tipo, creado_en).
create or replace function private.alertar_tope_confirmaciones_newsletter(p_organizacion uuid, p_empresa uuid)
returns boolean
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  begin
    if exists (
      select 1 from public.registro_actividad r
       where r.organizacion_id = p_organizacion
         and r.tipo = 'newsletter.tope_confirmaciones'
         and r.empresa_id = p_empresa
         and r.creado_en > now() - interval '1 hour') then
      return false;
    end if;
    perform private.insertar_actividad(
      p_organizacion, null, 'newsletter.tope_confirmaciones',
      'Se alcanzó el tope de confirmaciones nuevas por hora del newsletter: las altas se descartan hasta que pase la hora', p_empresa);
    return true;
  exception when others then
    -- La alerta nunca rompe la alta del visitante. Rastro solo con sqlstate.
    raise warning 'alertar_tope_confirmaciones_newsletter falló: %', sqlstate;
    return false;
  end;
end;
$$;

comment on function private.alertar_tope_confirmaciones_newsletter(uuid, uuid) is
  'MSF-971: registra el evento de Actividad newsletter.tope_confirmaciones (no sensible, sin datos personales) cuando el tope global de confirmaciones por hora descarta una alta; a lo sumo uno por hora y tienda. No falla nunca. Sin acceso de API.';

revoke execute on function private.alertar_tope_confirmaciones_newsletter(uuid, uuid) from public, anon, authenticated, service_role;

-- RF-NL-3 · suscripción. Cuerpo de 20270342000100 más el aviso del tope (MSF-971). ok | invalido (campos) | limite (espera_segundos) | error.
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
  'MSF-468 (RF-NL-3, D1, D2, D4): alta pública pendiente de confirmación. La tienda sale del host; ok|invalido|limite|error sin ids, hash ni IP; ok idéntico exista o no la dirección. MSF-971: si el tope global por hora descarta una alta, registra (a lo sumo uno por hora y tienda) el evento de Actividad newsletter.tope_confirmaciones, sin cambiar la respuesta.';

revoke execute on function publico.suscribirse_newsletter(text, text, boolean, uuid, text) from public, anon;
grant execute on function publico.suscribirse_newsletter(text, text, boolean, uuid, text) to anon, authenticated;
