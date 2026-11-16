-- MSF-468 (spec 20270328-100000-newsletter-de-la-tienda), Fase 5 · T026: el motor del correo masivo (MSF-155) envía también newsletters.
-- RF-NL-20, RF-NL-21, SC-001, SC-004; D14, D15. Redefine `private.reclamar_lote_correo_masivo` (mismos parámetros y columnas, más `tipo`, `tienda`,
-- `remitente`, `dominio_tienda` y `cuerpo_html` AL FINAL), y los historiales de clientes (`listar_campanas_correo`, `detalle_campana_correo`: solo `tipo = 'clientes'`).
-- `private.cerrar_envio_correo_masivo` no cambia (cierra por id de destinatario o prueba).
--
-- Esquemas (Principio VII): solo funciones. Escriben `dominio.campana_correo_destinatarios` y `dominio.correo_masivo_pruebas`; leen
-- `dominio.newsletter_suscriptores`, `dominio.newsletter_configuracion`, `dominio.empresas` y `dominio.tiendas`.
--
-- Comportamiento (el de los clientes NO cambia: SC-004):
--   * Destinatario suscriptor: antes de enviar se vuelve a verificar con el suscriptor BLOQUEADO (`for share`): debe seguir `confirmado`
--     (MSF-967: nunca `<> 'baja'`), con la tienda activa, su interruptor encendido y la dirección válida; si no, queda `omitido`. Una baja o un
--     borrado simultáneos esperan a este reclamo (orden de bloqueo: suscriptor y luego destinatario, el mismo que usan las bajas).
--   * Con la bandera `newsletter` apagada el flow no envía nada del newsletter (ni pruebas ni campañas) y deja lo pendiente intacto: al
--     reencenderla retoma. El correo a clientes sigue saliendo igual (CA-NL-11).
--   * El cupo diario por organización se COMPARTE con el correo a clientes, en orden de creación de la campaña (D14).
--   * El cuerpo HTML llega armado (`private.cuerpo_html_newsletter`, el mismo de la vista previa) con el enlace de baja propio de cada
--     destinatario en el dominio de la tienda; el remitente lleva el nombre de la tienda saneado (sin comillas, ángulos ni saltos de línea).
--
-- Reversión (migración posterior): `drop function private.reclamar_lote_correo_masivo(integer, integer, integer), private.remitente_newsletter(text)`
-- y recrear el cuerpo de 20270201200122 (más sus grants a `kestra_orquestacion`); restaurar `listar_campanas_correo` y `detalle_campana_correo`
-- de 20270201200123.

create or replace function private.remitente_newsletter(p_nombre text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case when limpio = '' then null else '"' || left(limpio, 80) || '"' end
    from (select btrim(regexp_replace(replace(coalesce(p_nombre, ''), chr(92), ''), '["<>{}[:cntrl:]]', '', 'g')) as limpio) x;
$$;

revoke execute on function private.remitente_newsletter(text) from public, anon, authenticated;

drop function if exists private.reclamar_lote_correo_masivo(integer, integer, integer);

create function private.reclamar_lote_correo_masivo(p_lote integer, p_limite_diario integer, p_vence_seg integer)
returns table (
  destinatario_id uuid, campana_id uuid, correo text, asunto text, mensaje text, token text,
  tipo text, tienda text, remitente text, dominio_tienda text, cuerpo_html text
)
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_fila record;
  v_token text;
  v_correo text;
  v_lote integer := least(greatest(coalesce(p_lote, 50), 1), 500);
  v_limite integer := greatest(coalesce(p_limite_diario, 500), 0);
  v_vence interval := make_interval(secs => least(greatest(coalesce(p_vence_seg, 900), 30), 86400));
  v_hoy timestamptz := date_trunc('day', now());
  v_bandera boolean := private.bandera_activa('newsletter');
  v_ids uuid[];
begin
  perform private.exigir_llamante_kestra();
  -- Un solo reclamador a la vez: el cupo se calcula y se consume sin que dos lotes lo superen.
  perform pg_advisory_xact_lock(hashtextextended('reclamar_lote_correo_masivo', 0));

  -- Pruebas pendientes (o con el reclamo vencido). Las del newsletter llevan la foto y salen con el HTML armado; con la bandera apagada esperan.
  return query
    with tomadas as (
      update dominio.correo_masivo_pruebas p
         set reclamado_hasta = now() + v_vence
       where p.id in (
               select x.id from dominio.correo_masivo_pruebas x
                where x.estado = 'pendiente' and (x.reclamado_hasta is null or x.reclamado_hasta < now())
                  and (x.bloques is null or v_bandera)
                order by x.creada_en, x.id
                limit 20)
      returning p.id, p.correo, p.asunto, p.mensaje, p.bloques, p.empresa_id, p.organizacion_id
    )
    select t.id, null::uuid, t.correo, t.asunto, t.mensaje, null::text,
           case when t.bloques is null then 'clientes' else 'newsletter' end,
           e.nombre, private.remitente_newsletter(e.nombre), ti.dominio,
           case when t.bloques is null then null
                else private.cuerpo_html_newsletter(t.mensaje, t.bloques, e.nombre, 'https://' || coalesce(ti.dominio, 'tienda.ejemplo') || '/newsletter/baja/ejemplo') end
      from tomadas t
      left join dominio.empresas e on e.id = t.empresa_id and e.organizacion_id = t.organizacion_id
      left join dominio.tiendas ti on ti.empresa_id = t.empresa_id and ti.organizacion_id = t.organizacion_id;

  -- Un correo con llaves o `%` (sintaxis de plantilla) no se envía nunca: `to` lo muestra el motor de plantillas de Kestra (defensa en profundidad;
  -- las altas nuevas ya lo rechazan, esto cubre filas anteriores y clientes). Motivo fijo «Correo inválido».
  update dominio.campana_correo_destinatarios d
     set estado = 'omitido', error = 'Correo inválido', reclamado_hasta = null
    from dominio.clientes c
   where c.id = d.cliente_id and d.estado = 'pendiente' and (d.reclamado_hasta is null or d.reclamado_hasta < now())
     and c.correo ~ '[{}%]';
  update dominio.campana_correo_destinatarios d
     set estado = 'omitido', error = 'Correo inválido', reclamado_hasta = null
    from dominio.newsletter_suscriptores s
   where s.id = d.suscriptor_id and d.estado = 'pendiente' and (d.reclamado_hasta is null or d.reclamado_hasta < now())
     and s.correo ~ '[{}%]';

  -- Re-verificación (FR-020) de los clientes pendientes sin reclamo vigente.
  update dominio.campana_correo_destinatarios d
     set estado = 'omitido', error = null, reclamado_hasta = null
    from dominio.clientes c
   where c.id = d.cliente_id
     and d.estado = 'pendiente'
     and (d.reclamado_hasta is null or d.reclamado_hasta < now())
     and (c.archivado_en is not null
          or c.es_consumidor_final
          or not c.acepta_correo_masivo
          or c.correo is null
          or c.correo !~ '^[^\s@,;]+@[^\s@,;]+\.[^\s@,;]+$');

  -- Envío cancelado (RF-NL-18): lo pendiente sin reclamo vigente queda omitido aunque un reclamo vencido (flow cortado) lo hubiera devuelto a la cola.
  update dominio.campana_correo_destinatarios d
     set estado = 'omitido', error = 'Cancelado', reclamado_hasta = null
    from dominio.campanas_correo c
    join dominio.newsletters nl on nl.id = c.newsletter_id and nl.organizacion_id = c.organizacion_id and nl.cancelada_en is not null
   where c.id = d.campana_id and c.organizacion_id = d.organizacion_id and c.tipo = 'newsletter'
     and d.estado = 'pendiente' and (d.reclamado_hasta is null or d.reclamado_hasta < now());

  -- Re-verificación de los suscriptores pendientes (RF-NL-20). Con la bandera apagada no se toca nada.
  if v_bandera then
    update dominio.campana_correo_destinatarios d
       set estado = 'omitido', error = null, reclamado_hasta = null
      from dominio.campanas_correo c
     where c.id = d.campana_id and c.organizacion_id = d.organizacion_id and c.tipo = 'newsletter'
       and d.estado = 'pendiente'
       and (d.reclamado_hasta is null or d.reclamado_hasta < now())
       and not exists (
             select 1
               from dominio.newsletter_suscriptores s
               join dominio.empresas e on e.id = s.empresa_id and e.organizacion_id = s.organizacion_id
               join dominio.tiendas ti on ti.empresa_id = e.id and ti.organizacion_id = e.organizacion_id
               join dominio.newsletter_configuracion cfg on cfg.empresa_id = e.id and cfg.organizacion_id = e.organizacion_id and cfg.activo
              where s.id = d.suscriptor_id and s.organizacion_id = d.organizacion_id and s.empresa_id = c.empresa_id
                and s.estado = 'confirmado' and e.activa);
  end if;

  -- Cupo diario por organización, en orden de campaña y luego de destinatario. Compartido entre clientes y newsletters (D14).
  select coalesce(array_agg(s.id), '{}') into v_ids
    from (
      select x.id, x.creada_en, x.creado_en
        from (
          select d.id, c.creada_en, d.creado_en,
                 row_number() over (partition by d.organizacion_id order by c.creada_en, d.creado_en, d.id) as pos,
                 d.organizacion_id
            from dominio.campana_correo_destinatarios d
            join dominio.campanas_correo c on c.id = d.campana_id and c.organizacion_id = d.organizacion_id
           where d.estado = 'pendiente' and (d.reclamado_hasta is null or d.reclamado_hasta < now())
             and (c.tipo = 'clientes' or v_bandera)
        ) x
        left join lateral (
          select count(*) as n
            from dominio.campana_correo_destinatarios u
           where u.organizacion_id = x.organizacion_id
             and ((u.estado = 'enviado' and u.enviado_en >= v_hoy)
                  or (u.estado = 'pendiente' and u.reclamado_hasta >= now()))
        ) usado on true
       where x.pos <= greatest(v_limite - usado.n, 0)
       order by x.creada_en, x.creado_en, x.id
       limit v_lote
    ) s;

  -- Un destinatario a la vez: cada uno necesita su propio token. Orden de bloqueo: suscriptor y luego destinatario.
  for v_fila in
    select d.id as did, d.campana_id as cid, d.cliente_id as clid, d.suscriptor_id as sid
      from dominio.campana_correo_destinatarios d
     where d.id = any (v_ids)
     order by d.creado_en, d.id
  loop
    v_correo := null;
    if v_fila.sid is not null then
      select s.correo into v_correo
        from dominio.newsletter_suscriptores s
        join dominio.campanas_correo c on c.id = v_fila.cid and c.organizacion_id = s.organizacion_id and c.empresa_id = s.empresa_id
        join dominio.empresas e on e.id = s.empresa_id and e.organizacion_id = s.organizacion_id
        join dominio.tiendas ti on ti.empresa_id = e.id and ti.organizacion_id = e.organizacion_id
        join dominio.newsletter_configuracion cfg on cfg.empresa_id = e.id and cfg.organizacion_id = e.organizacion_id and cfg.activo
       where s.id = v_fila.sid and s.estado = 'confirmado' and e.activa
         and s.correo !~ '[{}%]'
         and not exists (select 1 from dominio.newsletters nl where nl.id = c.newsletter_id and nl.organizacion_id = c.organizacion_id and nl.cancelada_en is not null)
         for share of s;
      if not found then
        update dominio.campana_correo_destinatarios u
           set estado = 'omitido', reclamado_hasta = null,
               error = (select case when nl.cancelada_en is not null then 'Cancelado' end
                          from dominio.campanas_correo c2
                          left join dominio.newsletters nl on nl.id = c2.newsletter_id and nl.organizacion_id = c2.organizacion_id
                         where c2.id = v_fila.cid)
         where u.id = v_fila.did and u.estado = 'pendiente' and (u.reclamado_hasta is null or u.reclamado_hasta < now());
        continue;
      end if;
    end if;

    perform 1 from dominio.campana_correo_destinatarios u
     where u.id = v_fila.did and u.estado = 'pendiente' and (u.reclamado_hasta is null or u.reclamado_hasta < now())
       for update skip locked;
    if not found then
      continue;
    end if;

    -- 244 bits aleatorios; el token en claro solo viaja en esta respuesta.
    v_token := replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '');
    update dominio.campana_correo_destinatarios u
       set reclamado_hasta = now() + v_vence,
           correo = case when v_fila.sid is not null then v_correo
                         else (select btrim(cl.correo) from dominio.clientes cl where cl.id = v_fila.clid) end,
           token_hashes = u.token_hashes || encode(sha256(convert_to(v_token, 'utf8')), 'hex')
     where u.id = v_fila.did
    returning u.correo into correo;
    select c.asunto, c.mensaje, c.tipo into asunto, mensaje, tipo from dominio.campanas_correo c where c.id = v_fila.cid;
    tienda := null; remitente := null; dominio_tienda := null; cuerpo_html := null;
    if tipo = 'newsletter' then
      select e.nombre, t2.dominio into tienda, dominio_tienda
        from dominio.campanas_correo c
        join dominio.empresas e on e.id = c.empresa_id and e.organizacion_id = c.organizacion_id
        join dominio.tiendas t2 on t2.empresa_id = e.id and t2.organizacion_id = e.organizacion_id
       where c.id = v_fila.cid;
      remitente := private.remitente_newsletter(tienda);
      cuerpo_html := private.cuerpo_html_newsletter(
        mensaje, (select c.bloques from dominio.campanas_correo c where c.id = v_fila.cid), tienda,
        'https://' || dominio_tienda || '/newsletter/baja/' || v_token);
    end if;
    destinatario_id := v_fila.did;
    campana_id := v_fila.cid;
    token := v_token;
    return next;
  end loop;
end;
$$;

comment on function private.reclamar_lote_correo_masivo(integer, integer, integer) is
  'F-CLI-12 y MSF-468 (FR-016, FR-018, FR-020, RF-NL-20): reclama un lote de correos (clientes y newsletters) con cupo diario compartido por organización, re-verifica a cada destinatario (omitido si ya no corresponde; el suscriptor debe seguir confirmado) y genera su enlace de baja. Solo kestra_orquestacion.';

revoke execute on function private.reclamar_lote_correo_masivo(integer, integer, integer) from public, anon, authenticated;

do $$
begin
  if exists (select 1 from pg_catalog.pg_roles where rolname = 'kestra_orquestacion') then
    grant usage on schema private to kestra_orquestacion;
    grant execute on function
      private.exigir_llamante_kestra(),
      private.reclamar_lote_correo_masivo(integer, integer, integer)
      to kestra_orquestacion;
  end if;
end
$$;

-- RF-NL-20 · los historiales de clientes no muestran newsletters (mismas firmas que 20270201200123).
-- Totales por campaña. `pendientes` completa la suma: destinatarios = enviados + fallidos + omitidos + pendientes (SC-005).
create or replace function public.listar_campanas_correo(
  p_empresa uuid default null,
  p_pagina integer default 1,
  p_tamano integer default 25
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_org uuid := (select private.organizacion_id());
  v_pagina integer := greatest(coalesce(p_pagina, 1), 1);
  v_tamano integer := least(greatest(coalesce(p_tamano, 25), 1), 100);
  v_total integer;
  v_filas jsonb;
begin
  if v_org is null or (select auth.uid()) is null then
    raise exception 'Necesitás una sesión con organización para ver el historial' using errcode = '42501';
  end if;
  if (select private.nivel_seccion('clientes')) not in ('lectura', 'edicion') then
    raise exception 'Tu rol no puede ver el historial del correo masivo' using errcode = '42501';
  end if;

  select count(*) into v_total
    from dominio.campanas_correo c
   where c.organizacion_id = v_org and c.tipo = 'clientes' and (p_empresa is null or c.empresa_id = p_empresa);

  select coalesce(jsonb_agg(f.fila order by f.creada_en desc, f.id), '[]'::jsonb) into v_filas
    from (
      select pg.creada_en, pg.id,
             jsonb_build_object(
               'id', pg.id,
               'creada_en', pg.creada_en,
               'asunto', pg.asunto,
               'autor', pg.autor,
               'estado', case when pg.pendientes > 0 then 'en_curso' else 'completada' end,
               'destinatarios', pg.destinatarios,
               'enviados', pg.enviados,
               'fallidos', pg.fallidos,
               'omitidos', pg.omitidos,
               'pendientes', pg.pendientes,
               'bajas', pg.bajas) as fila
        from (
          select c.id, c.creada_en, c.asunto,
                 coalesce(nullif(btrim(concat_ws(' ', p.nombre, p.apellido)), ''), 'Usuario sin nombre') as autor,
                 count(d.id) as destinatarios,
                 count(d.id) filter (where d.estado = 'enviado') as enviados,
                 count(d.id) filter (where d.estado = 'fallido') as fallidos,
                 count(d.id) filter (where d.estado = 'omitido') as omitidos,
                 count(d.id) filter (where d.estado = 'pendiente') as pendientes,
                 count(d.id) filter (where d.baja_en is not null) as bajas
            from dominio.campanas_correo c
            left join public.perfiles_usuario p on p.user_id = c.creada_por
            left join dominio.campana_correo_destinatarios d on d.campana_id = c.id and d.organizacion_id = c.organizacion_id
           where c.organizacion_id = v_org and c.tipo = 'clientes' and (p_empresa is null or c.empresa_id = p_empresa)
           group by c.id, c.creada_en, c.asunto, p.nombre, p.apellido
           order by c.creada_en desc, c.id
           limit v_tamano offset (v_pagina - 1) * v_tamano
        ) pg
    ) f;

  return jsonb_build_object('total', v_total, 'filas', v_filas);
end;
$$;

comment on function public.listar_campanas_correo(uuid, integer, integer) is
  'F-CLI-13 (FR-030, FR-032, FR-034, SC-005): campañas de la organización de la sesión (más reciente primero) con estado derivado y totales. Solo lectura; exige lectura o edición en clientes. Contrato: contracts/correo-masivo.md.';

create or replace function public.detalle_campana_correo(
  p_campana uuid,
  p_pagina integer default 1,
  p_tamano integer default 50
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_org uuid := (select private.organizacion_id());
  v_pagina integer := greatest(coalesce(p_pagina, 1), 1);
  v_tamano integer := least(greatest(coalesce(p_tamano, 50), 1), 100);
  v_campana jsonb;
  v_total integer;
  v_destinatarios jsonb;
begin
  if v_org is null or (select auth.uid()) is null then
    raise exception 'Necesitás una sesión con organización para ver el historial' using errcode = '42501';
  end if;
  if (select private.nivel_seccion('clientes')) not in ('lectura', 'edicion') then
    raise exception 'Tu rol no puede ver el historial del correo masivo' using errcode = '42501';
  end if;

  select jsonb_build_object(
           'id', c.id,
           'asunto', c.asunto,
           'mensaje', c.mensaje,
           'estado', case when t.pendientes > 0 then 'en_curso' else 'completada' end,
           'creada_en', c.creada_en,
           'empresa_id', c.empresa_id,
           'autor', coalesce(nullif(btrim(concat_ws(' ', p.nombre, p.apellido)), ''), 'Usuario sin nombre'),
           'destinatarios', t.destinatarios,
           'enviados', t.enviados,
           'fallidos', t.fallidos,
           'omitidos', t.omitidos,
           'pendientes', t.pendientes,
           'bajas', t.bajas)
    into v_campana
    from dominio.campanas_correo c
    left join public.perfiles_usuario p on p.user_id = c.creada_por
    cross join lateral (
      select count(*) as destinatarios,
             count(*) filter (where d.estado = 'enviado') as enviados,
             count(*) filter (where d.estado = 'fallido') as fallidos,
             count(*) filter (where d.estado = 'omitido') as omitidos,
             count(*) filter (where d.estado = 'pendiente') as pendientes,
             count(*) filter (where d.baja_en is not null) as bajas
        from dominio.campana_correo_destinatarios d
       where d.campana_id = c.id and d.organizacion_id = c.organizacion_id
    ) t
   where c.id = p_campana and c.organizacion_id = v_org and c.tipo = 'clientes';
  if v_campana is null then
    raise exception 'La campaña no existe' using errcode = 'P0002';
  end if;

  select count(*) into v_total
    from dominio.campana_correo_destinatarios d
   where d.campana_id = p_campana and d.organizacion_id = v_org;

  select coalesce(jsonb_agg(x.fila order by x.nombre, x.cliente_id), '[]'::jsonb) into v_destinatarios
    from (
      select coalesce(cl.nombre, '(cliente no disponible)') as nombre, d.cliente_id,
             jsonb_build_object(
               'cliente_id', d.cliente_id,
               'nombre', coalesce(cl.nombre, '(cliente no disponible)'),
               'correo', d.correo,
               'estado', d.estado,
               'error', d.error,
               'baja', d.baja_en is not null) as fila
        from dominio.campana_correo_destinatarios d
        left join dominio.clientes cl on cl.id = d.cliente_id and cl.organizacion_id = d.organizacion_id
       where d.campana_id = p_campana and d.organizacion_id = v_org
       order by 1, d.cliente_id
       limit v_tamano offset (v_pagina - 1) * v_tamano
    ) x;

  return jsonb_build_object('campana', v_campana, 'total', v_total, 'destinatarios', v_destinatarios);
end;
$$;

comment on function public.detalle_campana_correo(uuid, integer, integer) is
  'F-CLI-13 (FR-031, FR-033, FR-034): asunto, mensaje, totales y destinatarios (cliente, correo usado, estado, error corto, baja) de una campaña de la organización de la sesión. Solo lectura. Contrato: contracts/correo-masivo.md.';

revoke execute on function public.listar_campanas_correo(uuid, integer, integer) from public, anon;
grant execute on function public.listar_campanas_correo(uuid, integer, integer) to authenticated;
revoke execute on function public.detalle_campana_correo(uuid, integer, integer) from public, anon;
grant execute on function public.detalle_campana_correo(uuid, integer, integer) to authenticated;
