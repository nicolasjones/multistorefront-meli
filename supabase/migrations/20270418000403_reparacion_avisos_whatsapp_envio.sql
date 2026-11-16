-- MSF-952 (S-1 de MSF-118): envío automático del aviso de estado al cliente por WhatsApp, desde el servidor.
--
-- Es el seguimiento «S-1» que la spec `specs/20270323-100000-service-ideas-futuras-v2` dejó trazado (D-1, D-2 y
-- «Seguimientos trazados al implementar»): el aviso deja de ser un «click-to-chat» (wa.me abierto en el navegador)
-- y pasa a ser un aviso que manda el servidor, con los estados `pendiente → enviado/fallido` del mismo modelo.
--
-- Qué cambia:
--   1. `dominio.reparacion_avisos` suma `canal` (`correo` | `whatsapp`) y `clave_envio` (clave de idempotencia del
--      envío). Los avisos de correo quedan `canal = 'correo'` y no cambian de comportamiento.
--   2. `dominio.clientes` suma el consentimiento del cliente a recibir avisos por WhatsApp.
--   3. `public.avisar_cliente_whatsapp` encola el aviso (mismo camino que `public.avisar_cliente_reparacion`).
--   4. `public.avisos_de_reparacion` devuelve también el `canal` (salida aditiva).
--   5. `private.datos_aviso_reparacion`, `private.aplicar_cierre_aviso_reparacion` y
--      `private.expirar_avisos_reparacion` distinguen el canal (texto de actividad y motivo de vencimiento).
--
-- Esquema (Principio VII), verificado objeto por objeto:
--   dominio.reparacion_avisos  `dominio`  (ya es `dominio`): el historial de avisos al cliente de una reparación es
--                                      una entidad de negocio del producto Service. NO se crea una tabla nueva: el
--                                      aviso por WhatsApp es otro canal del mismo hecho (D-2 de la spec).
--   dominio.clientes            `dominio`  (ya es `dominio` tras MSF-505): la ficha del cliente es una entidad
--                                      de negocio del producto; el consentimiento es un dato del cliente.
--   public.conexiones           `public`   (existente): se usa la MISMA conexión `comprobantes-pdf` que ya habilita
--                                      los avisos por correo: sin conexión ni proveedor nuevos (spec 019).
--
-- Seguridad:
--   * `dominio.reparacion_avisos` conserva su RLS (organización, `service_tecnico` y tienda accesible) y NO suma
--     políticas de escritura: el aviso de WhatsApp se escribe solo por `public.avisar_cliente_whatsapp` y lo cierra
--     el flow por `private.cerrar_aviso_reparacion`.
--   * `authenticated` sigue leyendo por columna: se suma `canal` (la pantalla muestra el canal) y NO se suma
--     `clave_envio` (la clave de idempotencia es interna del envío).
--   * `public.avisar_cliente_whatsapp` es `security definer` con `search_path = ''`, valida sección, tienda,
--     anulación, estado, consentimiento y teléfono antes de encolar, y no es ejecutable por `anon`.
--   * La actividad NO lleva el número de teléfono: solo el código de la reparación y el estado avisado.
--   * `private.telefono_whatsapp` normaliza el número con la MISMA regla que `apps/web/src/lib/whatsapp.ts`
--     (`normalizarNumero`): sin número seguro no hay envío (antes que un chat equivocado).
--
-- Migración aditiva. Reversión (migración posterior, en este orden):
--   drop function public.avisar_cliente_whatsapp(uuid, uuid);
--   drop function private.telefono_whatsapp(text, text);
--   drop trigger clientes_consentimiento_whatsapp on dominio.clientes;
--   drop function private.marcar_consentimiento_whatsapp();
--   -- restaurar `public.avisos_de_reparacion` (uuid) de 20270201200135 (sin la columna `canal`);
--   -- restaurar `private.datos_aviso_reparacion` (uuid), `private.aplicar_cierre_aviso_reparacion` (uuid, text) y
--   --   `private.expirar_avisos_reparacion` (uuid) de 20270201200136 (sin el canal);
--   alter table dominio.clientes
--     drop column if exists acepta_whatsapp_en,
--     drop column if exists acepta_whatsapp;
--   drop index if exists dominio.reparacion_avisos_whatsapp_clave_uq;
--   drop index if exists dominio.reparacion_avisos_pendiente_uq;
--   create unique index if not exists reparacion_avisos_pendiente_uq
--     on dominio.reparacion_avisos (reparacion_id, estado_id) where estado_envio = 'pendiente';
--   alter table dominio.reparacion_avisos
--     drop constraint if exists reparacion_avisos_canal_ck,
--     drop column if exists clave_envio,
--     drop column if exists canal;
--   revoke select (canal) on dominio.reparacion_avisos from authenticated;

-- =============================================================================
-- 1. `dominio.reparacion_avisos`: canal y clave de idempotencia del envío.
-- =============================================================================

alter table dominio.reparacion_avisos
  add column if not exists canal text not null default 'correo',
  add column if not exists clave_envio uuid;

alter table dominio.reparacion_avisos
  drop constraint if exists reparacion_avisos_canal_ck;

-- El canal es `correo` o `whatsapp`; un aviso de WhatsApp siempre tiene clave de envío (la que evita que el
-- proveedor mande dos veces el mismo mensaje).
alter table dominio.reparacion_avisos
  add constraint reparacion_avisos_canal_ck check (
    canal in ('correo', 'whatsapp')
    and (canal = 'correo' or clave_envio is not null)
  );

comment on column dominio.reparacion_avisos.canal is
  'Canal del aviso: `correo` (F-SVC-14) o `whatsapp` (MSF-952, envío desde el servidor).';
comment on column dominio.reparacion_avisos.clave_envio is
  'Clave de idempotencia del envío de WhatsApp: la manda al proveedor para que no repita el mensaje.';

-- Un aviso pendiente por (reparación, estado) Y canal: el aviso de WhatsApp no bloquea el de correo ni al revés
-- (el índice anterior era por (reparación, estado) solamente).
drop index if exists dominio.reparacion_avisos_pendiente_uq;
create unique index if not exists reparacion_avisos_pendiente_uq
  on dominio.reparacion_avisos (reparacion_id, estado_id, canal)
  where estado_envio = 'pendiente';

-- Una clave de envío identifica un solo aviso de WhatsApp.
create unique index if not exists reparacion_avisos_whatsapp_clave_uq
  on dominio.reparacion_avisos (reparacion_id, clave_envio)
  where canal = 'whatsapp';

-- `canal` entra en la lectura por columna de `authenticated` (la pantalla muestra el canal del aviso).
-- `clave_envio` NO entra: es interna del envío.
grant select (canal) on dominio.reparacion_avisos to authenticated;

-- =============================================================================
-- 2. `dominio.clientes`: consentimiento del cliente a recibir avisos por WhatsApp.
-- =============================================================================

alter table dominio.clientes
  add column if not exists acepta_whatsapp boolean not null default false,
  add column if not exists acepta_whatsapp_en timestamptz;

comment on column dominio.clientes.acepta_whatsapp is
  'El cliente acepta recibir avisos de sus reparaciones por WhatsApp (MSF-952). Sin este consentimiento no se encola ningún WhatsApp.';
comment on column dominio.clientes.acepta_whatsapp_en is
  'Momento en que el cliente aceptó (o dejó de aceptar) los avisos por WhatsApp. Lo escribe el disparador.';

-- El momento del consentimiento lo maneja la base: el panel solo enciende o apaga el interruptor.
create or replace function private.marcar_consentimiento_whatsapp()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    new.acepta_whatsapp_en := case when new.acepta_whatsapp then now() else null end;
    return new;
  end if;
  if new.acepta_whatsapp is distinct from old.acepta_whatsapp then
    new.acepta_whatsapp_en := case when new.acepta_whatsapp then now() else null end;
  else
    new.acepta_whatsapp_en := old.acepta_whatsapp_en;
  end if;
  return new;
end;
$$;

comment on function private.marcar_consentimiento_whatsapp() is
  'MSF-952: deja la fecha del consentimiento de WhatsApp cuando el interruptor del cliente cambia.';

drop trigger if exists clientes_consentimiento_whatsapp on dominio.clientes;
create trigger clientes_consentimiento_whatsapp
  before insert or update on dominio.clientes
  for each row execute function private.marcar_consentimiento_whatsapp();

revoke execute on function private.marcar_consentimiento_whatsapp() from public, anon, authenticated;

grant insert (acepta_whatsapp) on dominio.clientes to authenticated;
grant update (acepta_whatsapp) on dominio.clientes to authenticated;

-- =============================================================================
-- 3. `private.telefono_whatsapp`: el número del cliente en formato internacional.
--    Misma regla que `normalizarNumero` de `apps/web/src/lib/whatsapp.ts`: solo dígitos, de 8 a 15; un móvil
--    argentino local pasa a `549…`; con `+` o `00` se respeta lo que viene; si no se puede determinar con
--    certeza, no hay número (antes un chat equivocado).
-- =============================================================================

create or replace function private.telefono_whatsapp(p_celular text, p_telefono text)
returns text
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_texto text;
  v_digitos text;
  v_base text;
  v_nacional text;
  v_area integer;
begin
  for v_texto in
    select x from unnest(array[coalesce(p_celular, ''), coalesce(p_telefono, '')]) as x
  loop
    v_digitos := regexp_replace(v_texto, '[^0-9]', '', 'g');
    if length(v_digitos) < 8 then
      continue;
    end if;

    if left(v_texto, 1) = '+' or left(v_digitos, 2) = '00' then
      -- Ya es internacional: se respeta (8 a 15 dígitos).
      v_base := case when left(v_digitos, 2) = '00' and left(v_texto, 1) <> '+' then substr(v_digitos, 3) else v_digitos end;
      if length(v_base) < 8 or length(v_base) > 15 then
        continue;
      end if;
      if left(v_base, 2) = '54' and left(v_base, 3) <> '549' and length(v_base) = 12 then
        return '549' || substr(v_base, 3);
      end if;
      return v_base;
    end if;

    v_base := v_digitos;
    if left(v_base, 2) = '54' then
      -- Argentina con el código de país puesto.
      if left(v_base, 3) = '549' and length(v_base) = 13 then
        return v_base;
      end if;
      if length(v_base) = 12 then
        return '549' || substr(v_base, 3);
      end if;
      continue;
    end if;

    -- Número local argentino: se quita el 0 troncal y el 15 del discado local.
    v_nacional := case when left(v_digitos, 1) = '0' then substr(v_digitos, 2) else v_digitos end;
    if v_nacional ~ '^[1-9][0-9]{9}$' and left(v_nacional, 2) <> '15' then
      return '549' || v_nacional;
    end if;
    if v_nacional ~ '^[1-9][0-9]{11}$' then
      for v_area in 2, 3, 4 loop
        if substr(v_nacional, v_area + 1, 2) = '15' then
          return '549' || substr(v_nacional, 1, v_area) || substr(v_nacional, v_area + 3);
        end if;
      end loop;
    end if;
  end loop;
  return null;
end;
$$;

comment on function private.telefono_whatsapp(text, text) is
  'MSF-952: número del cliente en dígitos internacionales para WhatsApp (celular primero, luego teléfono). Misma regla que `normalizarNumero` del front; null si no hay número seguro.';

revoke execute on function private.telefono_whatsapp(text, text) from public, anon, authenticated;

-- =============================================================================
-- 4. `public.avisos_de_reparacion`: el historial devuelve también el canal (aditivo).
-- =============================================================================

drop function if exists public.avisos_de_reparacion(uuid);

create or replace function public.avisos_de_reparacion(p_reparacion uuid)
returns table (
  id uuid,
  estado_id uuid,
  estado_nombre text,
  destinatario text,
  canal text,
  estado_envio text,
  error text,
  solicitado_en timestamptz,
  enviado_en timestamptz,
  solicitado_por_nombre text
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid := (select private.organizacion_id());
  v_rep dominio.reparaciones;
begin
  if v_org is null or (select auth.uid()) is null
     or (select private.nivel_seccion('service_tecnico')) not in ('lectura', 'edicion') then
    raise exception 'Tu rol no puede ver los avisos de las reparaciones' using errcode = '42501';
  end if;
  select * into v_rep from dominio.reparaciones r where r.id = p_reparacion and r.organizacion_id = v_org;
  if not found
     or not exists (select 1 from private.empresas_accesibles() a(id) where a.id = v_rep.empresa_id) then
    raise exception 'La reparación no existe' using errcode = 'P0002';
  end if;

  perform private.expirar_avisos_reparacion(v_rep.id);

  return query
    select a.id, a.estado_id, a.estado_nombre, a.destinatario, a.canal, a.estado_envio, a.error, a.solicitado_en,
           a.enviado_en, nullif(btrim(concat_ws(' ', p.nombre, p.apellido)), '')
      from dominio.reparacion_avisos a
      left join public.perfiles_usuario p on p.user_id = a.solicitado_por
     where a.reparacion_id = v_rep.id and a.organizacion_id = v_org
     order by a.solicitado_en desc, a.id;
end;
$$;

revoke execute on function public.avisos_de_reparacion(uuid) from public, anon;
grant execute on function public.avisos_de_reparacion(uuid) to authenticated;

comment on function public.avisos_de_reparacion(uuid) is
  'F-SVC-14 + MSF-952: historial de avisos al cliente de una reparación (más reciente primero), con el canal del aviso y el nombre visible de quien lo pidió. Exige service_tecnico en lectura o más y tienda accesible.';

-- =============================================================================
-- 5. `public.avisar_cliente_whatsapp`: encola el aviso de WhatsApp.
--    Mismo camino que `public.avisar_cliente_reparacion` (correo): una transacción que bloquea la reparación,
--    crea el aviso `pendiente` y deja la orden de despacho en la outbox.
-- =============================================================================

create or replace function public.avisar_cliente_whatsapp(p_reparacion uuid, p_estado_id uuid default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid := (select private.organizacion_id());
  v_actor uuid := (select auth.uid());
  v_rep dominio.reparaciones;
  v_estado dominio.estados_reparacion;
  v_cliente dominio.clientes;
  v_telefono text;
  v_aviso dominio.reparacion_avisos;
  v_conexion uuid;
  v_capacidad uuid;
  v_ejecucion uuid;
begin
  if v_org is null or v_actor is null
     or (select private.nivel_seccion('service_tecnico')) <> 'edicion' then
    raise exception 'Tu rol no puede avisar a los clientes de las reparaciones' using errcode = '42501';
  end if;
  if p_reparacion is null then
    raise exception 'Indicá la reparación' using errcode = '22023';
  end if;

  select * into v_rep
    from dominio.reparaciones r
   where r.id = p_reparacion and r.organizacion_id = v_org
   for update;
  if not found
     or not exists (select 1 from private.empresas_accesibles() a(id) where a.id = v_rep.empresa_id) then
    raise exception 'La reparación no existe' using errcode = 'P0002';
  end if;
  if v_rep.anulada_en is not null then
    raise exception 'La reparación está anulada: no se puede avisar al cliente' using errcode = '55000';
  end if;

  select * into v_estado
    from dominio.estados_reparacion s
   where s.id = coalesce(p_estado_id, v_rep.estado_id) and s.organizacion_id = v_org;
  if not found then
    raise exception 'El estado no existe' using errcode = '22023', hint = 'estado_id';
  end if;

  select * into v_cliente
    from dominio.clientes cl
   where cl.id = v_rep.cliente_id and cl.organizacion_id = v_org;
  if not found then
    raise exception 'El cliente no existe' using errcode = 'P0002';
  end if;

  -- Sin consentimiento del cliente no se encola nada (MSF-952).
  if not v_cliente.acepta_whatsapp then
    return jsonb_build_object('resultado', 'sin_consentimiento', 'aviso_id', null);
  end if;

  v_telefono := private.telefono_whatsapp(v_cliente.celular, v_cliente.telefono);
  if v_telefono is null then
    return jsonb_build_object('resultado', 'sin_telefono', 'aviso_id', null);
  end if;

  -- Un pendiente que ya no puede completarse se cierra como fallido; así el botón no queda bloqueado.
  perform private.expirar_avisos_reparacion(v_rep.id);

  select * into v_aviso
    from dominio.reparacion_avisos a
   where a.reparacion_id = v_rep.id and a.estado_id = v_estado.id
     and a.canal = 'whatsapp' and a.estado_envio = 'pendiente';
  if found then
    return jsonb_build_object('resultado', 'encolado', 'aviso_id', v_aviso.id);
  end if;

  -- La conexión es la misma que habilita los avisos por correo: sin conexión ni proveedor nuevos.
  select c.id into v_conexion
    from public.conexiones c
   where c.organizacion_id = v_org and c.sistema_externo = 'comprobantes-pdf' and c.estado = 'activa'
   order by c.created_at desc
   limit 1;
  if v_conexion is null then
    raise exception 'El envío de avisos todavía no está habilitado para tu organización. Pedile a un administrador que lo active.'
      using errcode = 'P0001', hint = 'sin_conexion';
  end if;

  insert into dominio.reparacion_avisos
    (organizacion_id, empresa_id, reparacion_id, estado_id, estado_nombre, destinatario, canal, clave_envio, solicitado_por)
  values (v_org, v_rep.empresa_id, v_rep.id, v_estado.id, v_estado.nombre, v_telefono, 'whatsapp', gen_random_uuid(), v_actor)
  returning * into v_aviso;

  insert into public.capacidades_ejecucion (organizacion_id, conexion_id, clave, tiempo_max_seg)
  values (v_org, v_conexion, 'enviar-aviso-whatsapp-' || v_aviso.id::text, 900)
  returning id into v_capacidad;

  insert into public.ejecuciones_worker (organizacion_id, conexion_id, capacidad_id, origen, actor, detalle)
  values (v_org, v_conexion, v_capacidad, 'manual', v_actor, jsonb_build_object('aviso_id', v_aviso.id))
  returning id into v_ejecucion;

  insert into public.despachos_ejecucion (ejecucion_id, organizacion_id) values (v_ejecucion, v_org);

  update dominio.reparacion_avisos a set ejecucion_id = v_ejecucion where a.id = v_aviso.id;

  -- La actividad NO lleva el número de teléfono: solo el código de la reparación y el estado avisado.
  perform private.registrar_actividad(
    'reparacion.aviso_whatsapp_solicitado',
    format('Pidió avisar al cliente por WhatsApp de la reparación %s (estado «%s»)', private.codigo_reparacion(v_rep.numero), v_estado.nombre),
    v_rep.empresa_id
  );
  return jsonb_build_object('resultado', 'encolado', 'aviso_id', v_aviso.id);
end;
$$;

revoke execute on function public.avisar_cliente_whatsapp(uuid, uuid) from public, anon;
grant execute on function public.avisar_cliente_whatsapp(uuid, uuid) to authenticated;

comment on function public.avisar_cliente_whatsapp(uuid, uuid) is
  'MSF-952: encola el aviso por WhatsApp del estado (por defecto el actual) de una reparación, con su orden de despacho en la misma transacción; sin consentimiento o sin teléfono no encola; idempotente por reparación, estado y canal. Exige service_tecnico en edición y tienda accesible.';

-- =============================================================================
-- 6. Funciones `private` del flow: distinguen el canal (el flujo de correo no cambia).
-- =============================================================================

create or replace function private.datos_aviso_reparacion(p_aviso uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_resultado jsonb;
begin
  perform private.exigir_llamante_kestra();

  select jsonb_build_object(
    'aviso_id', a.id,
    'canal', a.canal,
    'clave_envio', a.clave_envio,
    'estado_envio', a.estado_envio,
    'destinatario', a.destinatario,
    'cliente', regexp_replace(cl.nombre, '[\r\n\t]+', ' ', 'g'),
    'empresa', regexp_replace(coalesce(nullif(btrim(e.razon_social), ''), e.nombre), '[\r\n\t]+', ' ', 'g'),
    'numero', private.codigo_reparacion(r.numero),
    'equipo', regexp_replace(concat_ws(' ', m.equipo, m.modelo), '[\r\n\t]+', ' ', 'g'),
    'estado', regexp_replace(s.nombre, '[\r\n\t]+', ' ', 'g'),
    'descripcion', regexp_replace(s.descripcion, '[\r\n\t]+', ' ', 'g')
  )
  into v_resultado
  from dominio.reparacion_avisos a
  join dominio.reparaciones r on r.id = a.reparacion_id and r.organizacion_id = a.organizacion_id
  join dominio.empresas e on e.id = r.empresa_id and e.organizacion_id = r.organizacion_id
  join dominio.clientes cl on cl.id = r.cliente_id and cl.organizacion_id = r.organizacion_id
  join dominio.modelos_equipo m on m.id = r.modelo_id and m.organizacion_id = r.organizacion_id
  join dominio.estados_reparacion s on s.id = a.estado_id and s.organizacion_id = a.organizacion_id
  where a.id = p_aviso;

  if v_resultado is null then
    raise exception 'AVISO_DESCONOCIDO: %', p_aviso using errcode = 'P0001';
  end if;
  return v_resultado;
end;
$$;

comment on function private.datos_aviso_reparacion(uuid) is
  'F-SVC-14 + MSF-952: datos mínimos para armar el mensaje del aviso (destinatario, cliente, tienda, número R-000N, equipo, estado y su descripción, el canal y la clave de idempotencia). Sin importes ni costos. Solo kestra_orquestacion.';

create or replace function private.aplicar_cierre_aviso_reparacion(p_aviso uuid, p_motivo text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_aviso dominio.reparacion_avisos;
  v_codigo text;
  v_error text;
  -- Formas de secreto en texto recuperable (mismo criterio que cerrar_envio_correo).
  c_patron_secreto constant text :=
    '(?i)(api[_-]?key|bearer|session|passwd|password|pwd|secret|token)\s*[:=]\s*\S+'
    || '|eyJ[A-Za-z0-9_-]+\.eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_.-]+'
    || '|://[^/\s:]+:[^/\s@]+@'
    || '|AKIA[0-9A-Z]{16}';
begin
  select * into v_aviso from dominio.reparacion_avisos a where a.id = p_aviso for update;
  if not found then
    raise exception 'AVISO_DESCONOCIDO: %', p_aviso using errcode = 'P0001';
  end if;
  if v_aviso.estado_envio <> 'pendiente' then
    return;
  end if;

  select private.codigo_reparacion(r.numero) into v_codigo
    from dominio.reparaciones r where r.id = v_aviso.reparacion_id and r.organizacion_id = v_aviso.organizacion_id;

  if p_motivo is null then
    update dominio.reparacion_avisos a
       set estado_envio = 'enviado', error = null, enviado_en = clock_timestamp(), intentos = a.intentos + 1,
           updated_at = clock_timestamp()
     where a.id = v_aviso.id;
    perform private.insertar_actividad(
      v_aviso.organizacion_id, v_aviso.solicitado_por, 'reparacion.aviso_enviado',
      case when v_aviso.canal = 'whatsapp'
           then format('Se envió al cliente por WhatsApp el aviso de la reparación %s (estado «%s»)', v_codigo, v_aviso.estado_nombre)
           else format('Se envió al cliente el aviso de la reparación %s (estado «%s»)', v_codigo, v_aviso.estado_nombre)
      end,
      v_aviso.empresa_id);
  else
    v_error := left(coalesce(nullif(btrim(p_motivo), ''),
      case when v_aviso.canal = 'whatsapp' then 'No se pudo enviar el WhatsApp' else 'No se pudo enviar el correo' end), 500);
    if v_error ~ c_patron_secreto then
      v_error := case when v_aviso.canal = 'whatsapp' then 'No se pudo enviar el WhatsApp' else 'No se pudo enviar el correo' end;
    end if;
    update dominio.reparacion_avisos a
       set estado_envio = 'fallido', error = v_error, enviado_en = null, intentos = a.intentos + 1,
           updated_at = clock_timestamp()
     where a.id = v_aviso.id;
    perform private.insertar_actividad(
      v_aviso.organizacion_id, v_aviso.solicitado_por, 'reparacion.aviso_fallido',
      case when v_aviso.canal = 'whatsapp'
           then format('No se pudo enviar al cliente por WhatsApp el aviso de la reparación %s (estado «%s»)', v_codigo, v_aviso.estado_nombre)
           else format('No se pudo enviar al cliente el aviso de la reparación %s (estado «%s»)', v_codigo, v_aviso.estado_nombre)
      end,
      v_aviso.empresa_id);
  end if;

  update public.ejecuciones_worker x
     set estado = case when p_motivo is null then 'exitosa' else 'fallida' end,
         finalizada_en = clock_timestamp(),
         motivo_sanitizado = case when p_motivo is null then null else left(coalesce(v_error, ''), 200) end
   where x.id = v_aviso.ejecucion_id and x.estado = 'en_curso';
end;
$$;

create or replace function private.expirar_avisos_reparacion(p_reparacion uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_aviso record;
begin
  for v_aviso in
    select a.id, a.canal, a.solicitado_en, a.ejecucion_id
      from dominio.reparacion_avisos a
     where a.reparacion_id = p_reparacion and a.estado_envio = 'pendiente'
     for update
  loop
    if v_aviso.solicitado_en < clock_timestamp() - interval '15 minutes'
       or exists (
         select 1 from public.despachos_ejecucion x
          where x.ejecucion_id = v_aviso.ejecucion_id and x.estado in ('agotada', 'cancelada')
       )
       or exists (
         select 1 from public.ejecuciones_worker w
          where w.id = v_aviso.ejecucion_id and w.estado <> 'en_curso'
       ) then
      perform private.aplicar_cierre_aviso_reparacion(
        v_aviso.id,
        case when v_aviso.canal = 'whatsapp'
             then 'El WhatsApp tardó demasiado en enviarse. Probá de nuevo.'
             else 'El correo tardó demasiado en enviarse. Probá de nuevo.'
        end
      );
    end if;
  end loop;
end;
$$;

-- Los grants de las funciones del flow no cambian: las sigue ejecutando solo `kestra_orquestacion` (si el rol
-- existe en este entorno, que no siempre es el caso).
do $$
begin
  if exists (select 1 from pg_catalog.pg_roles where rolname = 'kestra_orquestacion') then
    grant usage on schema private to kestra_orquestacion;
    grant execute on function
      private.datos_aviso_reparacion(uuid),
      private.cerrar_aviso_reparacion(uuid, text)
      to kestra_orquestacion;
  end if;
end
$$;
