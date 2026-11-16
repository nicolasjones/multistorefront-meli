-- MSF-468 (spec 20270328-100000-newsletter-de-la-tienda), Fase 5 · T025: envío, cancelación y listado de newsletters.
-- RF-NL-17, RF-NL-18, RF-NL-19, RF-NL-24; D6, D11, D13, D14. Crea la campaña `tipo = 'newsletter'` del motor del correo masivo (MSF-155)
-- con la foto del contenido y de los suscriptores `confirmado`; el reclamo del lote (migración siguiente) es lo que efectivamente envía.
--
-- Esquemas (Principio VII): solo funciones en `public` (RPC del panel); escriben `dominio.newsletters`, `dominio.campanas_correo` y
-- `dominio.campana_correo_destinatarios` (dominio).
--
-- Reglas:
--   * Administrador con acceso a la tienda, bandera `newsletter` encendida y tienda activa (interruptor + dominio): 42501 / 55000 / 22023.
--   * Invariante MSF-967: los destinatarios son SOLO `estado = 'confirmado'` (nunca `<> 'baja'`), tomados con `for share` para que una baja o
--     un borrado simultáneos esperen a que la foto quede escrita (después el reclamo los vuelve a verificar).
--   * Idempotente por `p_clave` (clave de la campaña): el doble clic devuelve la misma campaña; una clave usada por otro newsletter es 22023.
--   * `for update` sobre el newsletter: dos envíos simultáneos se serializan y el segundo ve «ya enviado».
--
-- Aditiva e idempotente. Reversión (migración posterior):
--   drop function public.listar_newsletters(uuid, text, integer, integer), public.cancelar_envio_newsletter(uuid),
--     public.enviar_newsletter(uuid, integer, uuid);  restaurar public.resumen_newsletter(uuid) de 20270420000000;
--   delete from public.tipos_evento_actividad where tipo in ('newsletter.enviar', 'newsletter.cancelar')  -- solo si no quedan eventos

insert into public.tipos_evento_actividad (tipo, sensible, descripcion) values
  ('newsletter.enviar', false, 'Newsletter enviado a los suscriptores confirmados (asunto y cantidad, sin correos)'),
  ('newsletter.cancelar', false, 'Envío de newsletter cancelado (cantidad omitida, sin correos)')
on conflict (tipo) do nothing;

create or replace function public.enviar_newsletter(p_id uuid, p_version integer, p_clave uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_org uuid := (select private.organizacion_id());
  v_n dominio.newsletters%rowtype;
  v_campana uuid;
  v_total integer;
  v_bloques jsonb;
begin
  select * into v_n from dominio.newsletters n where n.id = p_id and n.organizacion_id = v_org for update;
  if not found then
    perform private.exigir_admin_newsletter(null);
    raise exception 'El newsletter no existe' using errcode = 'P0002';
  end if;
  perform private.exigir_admin_newsletter(v_n.empresa_id);
  if p_clave is null then
    raise exception 'Falta la clave del envío' using errcode = '22023', hint = 'clave';
  end if;
  if not private.bandera_activa('newsletter') then
    raise exception 'El newsletter no está habilitado en este entorno' using errcode = '55000';
  end if;

  if v_n.enviada_en is not null then
    -- Reintento del mismo pedido: devuelve la misma campaña. Cualquier otra clave sobre un envío cerrado es un error.
    if exists (select 1 from dominio.campanas_correo c where c.id = v_n.campana_id and c.organizacion_id = v_org and c.clave = p_clave) then
      return jsonb_build_object('campana_id', v_n.campana_id,
        'destinatarios', (select count(*)::int from dominio.campana_correo_destinatarios d where d.campana_id = v_n.campana_id and d.organizacion_id = v_org));
    end if;
    raise exception 'Este newsletter ya se envió' using errcode = '55000';
  end if;
  if p_version is distinct from v_n.version then
    raise exception 'El borrador cambió: recargá para ver la última versión' using errcode = '40001';
  end if;
  if not coalesce((select c.activo from dominio.newsletter_configuracion c where c.empresa_id = v_n.empresa_id and c.organizacion_id = v_org), false) then
    raise exception 'Activá el newsletter de la tienda antes de enviar' using errcode = '22023', hint = 'tienda_apagada';
  end if;
  if not exists (select 1 from dominio.empresas e join dominio.tiendas t on t.empresa_id = e.id and t.organizacion_id = e.organizacion_id
                  where e.id = v_n.empresa_id and e.organizacion_id = v_org and e.activa) then
    raise exception 'La tienda no tiene un dominio activo para armar los enlaces' using errcode = '22023', hint = 'sin_dominio';
  end if;
  if exists (select 1 from dominio.campanas_correo c where c.organizacion_id = v_org and c.clave = p_clave) then
    raise exception 'La clave del envío ya se usó en otra campaña' using errcode = '22023', hint = 'clave';
  end if;

  v_bloques := private.armar_bloques_newsletter(v_n.empresa_id, v_n.incluir_destacados, v_n.incluir_promociones);

  insert into dominio.campanas_correo (organizacion_id, empresa_id, clave, asunto, mensaje, creada_por, tipo, newsletter_id, bloques)
  values (v_org, v_n.empresa_id, p_clave, v_n.asunto, v_n.mensaje, (select auth.uid()), 'newsletter', v_n.id, v_bloques)
  returning id into v_campana;

  -- Foto de los confirmados de ESTA tienda (MSF-967). `for share` hace esperar a una baja o a un borrado simultáneos.
  insert into dominio.campana_correo_destinatarios (organizacion_id, campana_id, suscriptor_id, correo)
  select v_org, v_campana, s.id, s.correo
    from dominio.newsletter_suscriptores s
   where s.organizacion_id = v_org and s.empresa_id = v_n.empresa_id and s.estado = 'confirmado'
   order by s.creado_en, s.id
     for share of s;
  get diagnostics v_total = row_count;
  if v_total = 0 then
    -- Se deshace todo lo escrito arriba (la excepción cancela la función entera).
    raise exception 'Todavía no hay suscriptores confirmados' using errcode = '22023', hint = 'sin_destinatarios';
  end if;

  update dominio.newsletters n
     set contenido_enviado = v_bloques, campana_id = v_campana, enviada_en = now(), version = n.version + 1, actualizada_en = now()
   where n.id = v_n.id;

  perform private.insertar_actividad(v_org, (select auth.uid()), 'newsletter.enviar',
    format('Envió el newsletter «%s» a %s %s', left(v_n.asunto, 120), v_total, case when v_total = 1 then 'suscriptor' else 'suscriptores' end), v_n.empresa_id);
  return jsonb_build_object('campana_id', v_campana, 'destinatarios', v_total);
end;
$$;

-- RF-NL-18 · cancela lo que aún no salió: lo `pendiente` pasa a `omitido` (motivo «Cancelado»). Lo reclamado y en vuelo se cierra solo
-- (un correo que ya salió no se retira). Idempotente.
create or replace function public.cancelar_envio_newsletter(p_id uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_org uuid := (select private.organizacion_id());
  v_n dominio.newsletters%rowtype;
  v_omitidos integer := 0;
begin
  select * into v_n from dominio.newsletters n where n.id = p_id and n.organizacion_id = v_org for update;
  if not found then
    perform private.exigir_admin_newsletter(null);
    raise exception 'El newsletter no existe' using errcode = 'P0002';
  end if;
  perform private.exigir_admin_newsletter(v_n.empresa_id);
  if v_n.enviada_en is null then
    raise exception 'El newsletter todavía no se envió' using errcode = '55000';
  end if;
  if v_n.cancelada_en is not null then
    return jsonb_build_object('cancelados', 0);
  end if;

  update dominio.campana_correo_destinatarios d
     set estado = 'omitido', error = 'Cancelado', reclamado_hasta = null
   where d.campana_id = v_n.campana_id and d.organizacion_id = v_org and d.estado = 'pendiente'
     and (d.reclamado_hasta is null or d.reclamado_hasta < now());
  get diagnostics v_omitidos = row_count;
  update dominio.newsletters n set cancelada_en = now(), actualizada_en = now() where n.id = v_n.id;

  perform private.insertar_actividad(v_org, (select auth.uid()), 'newsletter.cancelar',
    format('Canceló el envío del newsletter «%s» (%s sin enviar)', left(v_n.asunto, 120), v_omitidos), v_n.empresa_id);
  return jsonb_build_object('cancelados', v_omitidos);
end;
$$;

-- RF-NL-19 · borradores y envíos con estado y totales. Filtro de estado opcional; tandas por página (desde 1, tamaño ≤ 100).
create or replace function public.listar_newsletters(
  p_empresa uuid default null,
  p_estado text default null,
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
  v_tamano integer := least(greatest(coalesce(p_tamano, 25), 1), 100);
  v_pagina integer := greatest(coalesce(p_pagina, 1), 1);
begin
  if v_org is null or (select private.nivel_seccion('clientes')) not in ('lectura', 'edicion') then
    raise exception 'Tu rol no puede ver el newsletter' using errcode = '42501';
  end if;
  if p_estado is not null and p_estado not in ('borrador', 'enviando', 'enviada', 'cancelada') then
    raise exception 'El estado no es válido' using errcode = '22023';
  end if;
  if p_empresa is not null and p_empresa not in (select private.empresas_accesibles()) then
    raise exception 'No tenés acceso a esa tienda' using errcode = '42501';
  end if;
  return (
    with base as (
      select n.id, n.nombre_interno, n.empresa_id, e.nombre as tienda, n.asunto, n.version,
             coalesce(n.enviada_en, n.actualizada_en) as fecha,
             t.destinatarios, t.enviados, t.fallidos, t.omitidos, t.pendientes, t.bajas,
             case when n.enviada_en is null then 'borrador'
                  when n.cancelada_en is not null then 'cancelada'
                  when t.pendientes > 0 then 'enviando' else 'enviada' end as estado,
             n.creada_en
        from dominio.newsletters n
        join dominio.empresas e on e.id = n.empresa_id and e.organizacion_id = n.organizacion_id
        cross join lateral (
          select count(d.id)::int as destinatarios,
                 (count(d.id) filter (where d.estado = 'enviado'))::int as enviados,
                 (count(d.id) filter (where d.estado = 'fallido'))::int as fallidos,
                 (count(d.id) filter (where d.estado = 'omitido'))::int as omitidos,
                 (count(d.id) filter (where d.estado = 'pendiente'))::int as pendientes,
                 (count(d.id) filter (where d.baja_en is not null))::int as bajas
            from dominio.campana_correo_destinatarios d
           where d.campana_id = n.campana_id and d.organizacion_id = n.organizacion_id
        ) t
       where n.organizacion_id = v_org
         and n.empresa_id in (select private.empresas_accesibles())
         and (p_empresa is null or n.empresa_id = p_empresa)
    ), filtrada as (
      select * from base where p_estado is null or base.estado = p_estado
    )
    select jsonb_build_object(
      'total', (select count(*) from filtrada),
      'filas', coalesce((
        select jsonb_agg(to_jsonb(x) - 'creada_en' order by x.fecha desc, x.id)
          from (select * from filtrada order by fecha desc, id limit v_tamano offset (v_pagina - 1) * v_tamano) x), '[]'::jsonb)));
end;
$$;

-- RF-NL-11 · el resumen suma los envíos (los `enviada_en` no nulos).
create or replace function public.resumen_newsletter(p_empresa uuid default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_org uuid := (select private.organizacion_id());
begin
  if v_org is null or (select private.nivel_seccion('clientes')) not in ('lectura', 'edicion') then
    raise exception 'Tu rol no puede ver el newsletter' using errcode = '42501';
  end if;
  if p_empresa is not null and p_empresa not in (select private.empresas_accesibles()) then
    raise exception 'No tenés acceso a esa tienda' using errcode = '42501';
  end if;
  return jsonb_build_object(
    'confirmados', (select count(*) from dominio.newsletter_suscriptores s
                     where s.organizacion_id = v_org and s.estado = 'confirmado'
                       and s.empresa_id in (select private.empresas_accesibles())
                       and (p_empresa is null or s.empresa_id = p_empresa)),
    'pendientes', (select count(*) from dominio.newsletter_suscriptores s
                    where s.organizacion_id = v_org and s.estado = 'pendiente'
                      and s.empresa_id in (select private.empresas_accesibles())
                      and (p_empresa is null or s.empresa_id = p_empresa)),
    'bajas', (select count(*) from dominio.newsletter_suscriptores s
               where s.organizacion_id = v_org and s.estado = 'baja'
                 and s.empresa_id in (select private.empresas_accesibles())
                 and (p_empresa is null or s.empresa_id = p_empresa)),
    'envios', (select count(*) from dominio.newsletters n
                where n.organizacion_id = v_org and n.enviada_en is not null
                  and n.empresa_id in (select private.empresas_accesibles())
                  and (p_empresa is null or n.empresa_id = p_empresa)),
    'bandera', private.bandera_activa('newsletter'),
    'tiendas', coalesce((
      select jsonb_agg(jsonb_build_object('empresa_id', e.id, 'tienda', e.nombre, 'activo', coalesce(c.activo, false)) order by e.nombre, e.id)
        from dominio.empresas e
        left join dominio.newsletter_configuracion c on c.empresa_id = e.id and c.organizacion_id = e.organizacion_id
       where e.organizacion_id = v_org and e.activa and e.id in (select private.empresas_accesibles())
         and (p_empresa is null or e.id = p_empresa)), '[]'::jsonb));
end;
$$;

comment on function public.enviar_newsletter(uuid, integer, uuid) is 'MSF-468 (RF-NL-17): crea la campaña newsletter con la foto del contenido y de los confirmados; Administrador; 22023 sin_destinatarios; idempotente por clave.';
comment on function public.cancelar_envio_newsletter(uuid) is 'MSF-468 (RF-NL-18): omite lo pendiente de un envío (motivo Cancelado); Administrador; idempotente.';
comment on function public.listar_newsletters(uuid, text, integer, integer) is 'MSF-468 (RF-NL-19): borradores y envíos con estado y totales; lectura en clientes.';

revoke execute on function public.enviar_newsletter(uuid, integer, uuid) from public, anon;
revoke execute on function public.cancelar_envio_newsletter(uuid) from public, anon;
revoke execute on function public.listar_newsletters(uuid, text, integer, integer) from public, anon;
revoke execute on function public.resumen_newsletter(uuid) from public, anon;
grant execute on function public.enviar_newsletter(uuid, integer, uuid) to authenticated;
grant execute on function public.cancelar_envio_newsletter(uuid) to authenticated;
grant execute on function public.listar_newsletters(uuid, text, integer, integer) to authenticated;
grant execute on function public.resumen_newsletter(uuid) to authenticated;
