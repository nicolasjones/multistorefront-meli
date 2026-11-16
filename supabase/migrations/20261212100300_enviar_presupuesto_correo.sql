-- F-VTA-20 (MSF-245, épica MSF-213, spec 20261024-100000-ventas-impresion, FR-027, FR-029): pedir el envío por
-- correo de un presupuesto y consultar sus envíos.
--
-- Esquemas (Principio VII): solo funciones. Escriben `dominio.comprobante_envios_correo` y
-- `dominio.comprobante_documentos` (dominio, por `solicitar_documento_comprobante`) y, para el despacho, las
-- tablas de plataforma `public.capacidades_ejecucion`, `public.ejecuciones_worker` y `public.despachos_ejecucion`.
--
-- Permiso: `ventas` en `edicion` EN LA EMPRESA del presupuesto (enviar a un tercero es una acción hacia afuera;
-- imprimir, en cambio, alcanza con `lectura`). El destinatario es el correo del cliente; sin correo (incluido
-- Consumidor final) se rechaza con un mensaje claro y no se crea nada. Idempotente: un envío pendiente del mismo
-- presupuesto se devuelve tal cual. El PDF lo pide la propia RPC (reutiliza el vigente o genera uno nuevo).
--
-- Despacho: igual que los documentos, una ejecución `manual` auditable y su orden en la outbox, en la misma
-- transacción. La clave de la capacidad (`enviar-presupuesto-correo-<envío>`) es el prefijo que reclama el flow
-- `comprobantes-correo`.
--
-- Migración aditiva. Reversión (migración posterior):
--   drop function public.listar_envios_correo_presupuesto(uuid);
--   drop function public.enviar_presupuesto_correo(uuid);
--   drop function private.expirar_envio_pendiente(uuid);

-- Un envío pendiente que ya no puede completarse (orden agotada o cancelada, su PDF falló o pasaron quince
-- minutos) pasa a `fallido`, con el mismo cierre y evento que el del flow.
create or replace function private.expirar_envio_pendiente(p_envio_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_envio dominio.comprobante_envios_correo;
  v_motivo text;
begin
  select * into v_envio from dominio.comprobante_envios_correo e where e.id = p_envio_id and e.estado = 'pendiente' for update;
  if not found then
    return;
  end if;
  perform private.expirar_documento_pendiente(v_envio.documento_id);
  if exists (select 1 from dominio.comprobante_documentos d where d.id = v_envio.documento_id and d.estado = 'fallido') then
    v_motivo := 'No se pudo generar el PDF del presupuesto. Probá de nuevo.';
  elsif v_envio.solicitado_en < clock_timestamp() - interval '15 minutes'
     or exists (
       select 1 from public.despachos_ejecucion x
       where x.ejecucion_id = v_envio.ejecucion_id and x.estado in ('agotada', 'cancelada')
     )
     or exists (
       select 1 from public.ejecuciones_worker w
       where w.id = v_envio.ejecucion_id and w.estado <> 'en_curso'
     ) then
    v_motivo := 'El correo tardó demasiado en enviarse. Probá de nuevo.';
  end if;
  if v_motivo is not null then
    perform private.aplicar_cierre_envio_correo(v_envio.id, v_motivo);
  end if;
end;
$$;

revoke execute on function private.expirar_envio_pendiente(uuid) from public, anon, authenticated;

create or replace function public.enviar_presupuesto_correo(p_comprobante_id uuid)
returns dominio.comprobante_envios_correo
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid := (select private.organizacion_id());
  v_actor uuid := (select auth.uid());
  v_c dominio.comprobantes_venta;
  v_correo text;
  v_doc dominio.comprobante_documentos;
  v_envio dominio.comprobante_envios_correo;
  v_conexion uuid;
  v_capacidad uuid;
  v_ejecucion uuid;
begin
  if v_org is null or v_actor is null then
    raise exception 'Necesitás una sesión con organización para enviar presupuestos' using errcode = '42501';
  end if;

  select * into v_c from dominio.comprobantes_venta c where c.id = p_comprobante_id and c.organizacion_id = v_org;
  if not found or v_c.empresa_id is null then
    raise exception 'El presupuesto no existe' using errcode = 'P0002';
  end if;
  -- La organización y el solicitante salen de la sesión; el permiso, de la empresa del presupuesto (FR-027).
  if (select private.nivel_ventas_en_empresa(v_c.empresa_id)) is distinct from 'edicion' then
    raise exception 'Tu rol no puede enviar presupuestos de esta tienda' using errcode = '42501';
  end if;
  if v_c.tipo <> 'presupuesto' then
    raise exception 'Solo se envía por correo un presupuesto' using errcode = '22023', hint = 'tipo';
  end if;
  if v_c.estado not in ('pendiente', 'aceptado') then
    raise exception 'Este presupuesto ya no se puede enviar' using errcode = '22023', hint = 'estado';
  end if;

  select nullif(btrim(cl.correo), '') into v_correo
  from public.clientes cl where cl.id = v_c.cliente_id and cl.organizacion_id = v_org;
  -- Sin correo (incluido Consumidor final) no hay a quién enviar: no se crea nada (FR-027).
  if v_correo is null or v_correo !~ '^[^[:space:]@,;<>]+@[^[:space:]@,;<>]+\.[^[:space:]@,;<>]+$' or length(v_correo) > 320 then
    raise exception 'El cliente no tiene un correo válido cargado. Cargalo en su ficha para enviar el presupuesto.'
      using errcode = '22023', hint = 'sin_correo';
  end if;

  -- Serializa los pedidos del mismo presupuesto: el doble clic y dos operadores a la vez dan un solo envío.
  perform pg_advisory_xact_lock(hashtextextended('comprobante_envio_correo:' || p_comprobante_id::text, 0));

  select * into v_envio from dominio.comprobante_envios_correo e
  where e.comprobante_id = v_c.id and e.estado = 'pendiente';
  if found then
    perform private.expirar_envio_pendiente(v_envio.id);
    select * into v_envio from dominio.comprobante_envios_correo e where e.id = v_envio.id;
    if v_envio.estado = 'pendiente' then
      return v_envio;
    end if;
  end if;

  select c.id into v_conexion from public.conexiones c
  where c.organizacion_id = v_org and c.sistema_externo = 'comprobantes-pdf' and c.estado = 'activa'
  order by c.created_at desc limit 1;
  if v_conexion is null then
    raise exception 'El envío de presupuestos todavía no está habilitado para tu organización. Pedile a un administrador que lo active.'
      using errcode = 'P0001', hint = 'sin_conexion';
  end if;

  -- PDF a adjuntar: el vigente o uno nuevo (FR-021, FR-024). Corre con la misma sesión, así que repite el permiso.
  v_doc := public.solicitar_documento_comprobante(v_c.id, 'presupuesto');

  insert into dominio.comprobante_envios_correo
    (organizacion_id, empresa_id, comprobante_id, documento_id, destinatario, solicitado_por)
  values (v_org, v_c.empresa_id, v_c.id, v_doc.id, v_correo, v_actor)
  returning * into v_envio;

  insert into public.capacidades_ejecucion (organizacion_id, conexion_id, clave, tiempo_max_seg)
  values (v_org, v_conexion, 'enviar-presupuesto-correo-' || v_envio.id::text, 900)
  returning id into v_capacidad;

  insert into public.ejecuciones_worker (organizacion_id, conexion_id, capacidad_id, origen, actor, detalle)
  values (v_org, v_conexion, v_capacidad, 'manual', v_actor,
          jsonb_build_object('envio_id', v_envio.id, 'documento_id', v_doc.id))
  returning id into v_ejecucion;

  insert into public.despachos_ejecucion (ejecucion_id, organizacion_id) values (v_ejecucion, v_org);

  update dominio.comprobante_envios_correo e set ejecucion_id = v_ejecucion where e.id = v_envio.id
  returning * into v_envio;

  return v_envio;
end;
$$;

revoke execute on function public.enviar_presupuesto_correo(uuid) from public, anon;
grant execute on function public.enviar_presupuesto_correo(uuid) to authenticated;

comment on function public.enviar_presupuesto_correo(uuid) is
  'F-VTA-20 (FR-027, FR-029): pide el envío por correo del PDF de un presupuesto a su cliente. Exige ventas en edición en la empresa; rechaza un cliente sin correo; idempotente (devuelve el envío pendiente); si no, crea el envío y su orden de despacho. Contrato en docs/ventas-impresion.md.';

create or replace function public.listar_envios_correo_presupuesto(p_comprobante_id uuid)
returns setof dominio.comprobante_envios_correo
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid := (select private.organizacion_id());
  v_c dominio.comprobantes_venta;
  v_id uuid;
begin
  if v_org is null or (select auth.uid()) is null then
    raise exception 'Necesitás una sesión con organización para ver envíos' using errcode = '42501';
  end if;
  select * into v_c from dominio.comprobantes_venta c where c.id = p_comprobante_id and c.organizacion_id = v_org;
  if not found or v_c.empresa_id is null then
    raise exception 'El presupuesto no existe' using errcode = 'P0002';
  end if;
  if (select private.nivel_ventas_en_empresa(v_c.empresa_id)) not in ('lectura', 'edicion') then
    raise exception 'Tu rol no puede ver envíos de esta tienda' using errcode = '42501';
  end if;
  for v_id in
    select e.id from dominio.comprobante_envios_correo e
    where e.comprobante_id = v_c.id and e.organizacion_id = v_org and e.estado = 'pendiente'
  loop
    perform private.expirar_envio_pendiente(v_id);
  end loop;
  return query
    select e.* from dominio.comprobante_envios_correo e
    where e.comprobante_id = v_c.id and e.organizacion_id = v_org
    order by e.solicitado_en desc, e.id;
end;
$$;

revoke execute on function public.listar_envios_correo_presupuesto(uuid) from public, anon;
grant execute on function public.listar_envios_correo_presupuesto(uuid) to authenticated;

comment on function public.listar_envios_correo_presupuesto(uuid) is
  'F-VTA-20 (FR-026): envíos por correo de un presupuesto, del más reciente al más viejo; un pendiente que ya no puede completarse pasa a fallido. Exige ventas en lectura en la empresa.';
