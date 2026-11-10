-- F-VTA-19 (MSF-230, épica MSF-213, spec 20261024-100000-ventas-impresion, FR-001, FR-002, FR-005, FR-013,
-- FR-015, FR-016): RPC de pedido y consulta de documentos imprimibles de un comprobante.
--
-- Esquemas (Principio VII): solo funciones. Escriben `dominio.comprobante_documentos` (dominio) y, para el
-- despacho, las tablas de plataforma `public.capacidades_ejecucion`, `public.ejecuciones_worker` y
-- `public.despachos_ejecucion` (ciclo de workers, spec 016/019). El catálogo `public.sistemas_externos` gana su
-- fila `comprobantes-pdf` (la conexión de cada organización se crea como en docs/historial-ventas.md).
--
-- Despacho: una ejecución `manual` auditable (actor = quien pide) y su orden en la outbox, creadas en la misma
-- transacción que el pedido. A diferencia de la importación del historial (un administrador, una a la vez), imprimir
-- lo hace cualquier persona con `ventas` en `lectura` y varias a la vez: por eso NO se llama a
-- `iniciar_ejecucion_worker` (exige administrador y una sola ejecución activa por capacidad) y la capacidad es una
-- por documento (`generar-documento-venta-<tipo>-<documento>`), que mantiene el prefijo que reclama el flow.
--
-- Migración aditiva. Reversión (migración posterior):
--   drop function public.listar_documentos_comprobante(uuid);
--   drop function public.obtener_documento_comprobante(uuid);
--   drop function public.solicitar_documento_comprobante(uuid, text);
--   drop function private.expirar_documento_pendiente(uuid);
--   delete from public.sistemas_externos where id = 'comprobantes-pdf';   (sin conexiones que lo usen)

insert into public.sistemas_externos (id, descripcion)
values ('comprobantes-pdf', 'Generación de PDF de documentos de venta (factura, remito, presupuesto), sin sistema externo real')
on conflict (id) do nothing;

-- Un pedido pendiente que ya no puede completarse (su orden se agotó, su ejecución se cerró o pasaron diez
-- minutos) pasa a `fallido`: así el índice de pendientes no bloquea para siempre un reintento y la pantalla ve el
-- error en vez de esperar (cierre perezoso, mismo criterio que el timeout de las ejecuciones).
create or replace function private.expirar_documento_pendiente(p_documento_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_doc dominio.comprobante_documentos;
begin
  select * into v_doc from dominio.comprobante_documentos d where d.id = p_documento_id and d.estado = 'pendiente' for update;
  if not found then
    return;
  end if;
  if v_doc.solicitado_en < clock_timestamp() - interval '10 minutes'
     or exists (
       select 1 from public.despachos_ejecucion x
       where x.ejecucion_id = v_doc.ejecucion_id and x.estado in ('agotada', 'cancelada')
     )
     or exists (
       select 1 from public.ejecuciones_worker e
       where e.id = v_doc.ejecucion_id and e.estado <> 'en_curso'
     ) then
    update dominio.comprobante_documentos d
    set estado = 'fallido', ruta = null,
        error = 'El documento tardó demasiado en generarse. Probá de nuevo.',
        updated_at = clock_timestamp()
    where d.id = v_doc.id;
    update public.ejecuciones_worker e
    set estado = 'fallida', finalizada_en = clock_timestamp(), motivo_sanitizado = 'DOCUMENTO_EXPIRADO'
    where e.id = v_doc.ejecucion_id and e.estado = 'en_curso';
  end if;
end;
$$;

revoke execute on function private.expirar_documento_pendiente(uuid) from public, anon, authenticated;

-- ============================================================================
-- public.solicitar_documento_comprobante (FR-001, FR-002, FR-005, FR-015)
-- ============================================================================

create or replace function public.solicitar_documento_comprobante(p_comprobante_id uuid, p_tipo_documento text)
returns dominio.comprobante_documentos
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid := (select private.organizacion_id());
  v_actor uuid := (select auth.uid());
  v_c dominio.comprobantes_venta;
  v_doc dominio.comprobante_documentos;
  v_conexion uuid;
  v_capacidad uuid;
  v_ejecucion uuid;
  v_etiqueta text;
begin
  if v_org is null or v_actor is null then
    raise exception 'Necesitás una sesión con organización para imprimir comprobantes' using errcode = '42501';
  end if;
  if p_tipo_documento is null or p_tipo_documento not in ('factura', 'remito') then
    raise exception 'Elegí si querés imprimir la factura o el remito' using errcode = '22023', hint = 'tipo_documento';
  end if;

  select * into v_c from dominio.comprobantes_venta c where c.id = p_comprobante_id and c.organizacion_id = v_org;
  if not found or v_c.empresa_id is null then
    raise exception 'El comprobante no existe' using errcode = 'P0002';
  end if;
  -- La organización y el solicitante salen de la sesión; el permiso, de la empresa del comprobante (FR-001).
  if (select private.nivel_ventas_en_empresa(v_c.empresa_id)) not in ('lectura', 'edicion') then
    raise exception 'Tu rol no puede imprimir comprobantes de esta tienda' using errcode = '42501';
  end if;
  if v_c.tipo <> 'factura' then
    raise exception 'Solo se imprimen la factura y el remito de una factura' using errcode = '22023', hint = 'tipo_documento';
  end if;
  if v_c.estado <> 'confirmada' then
    raise exception 'La factura tiene que estar confirmada para imprimirla' using errcode = '22023', hint = 'estado';
  end if;

  -- Serializa los pedidos del mismo documento: el doble clic y dos operadores a la vez dan un solo pedido.
  perform pg_advisory_xact_lock(hashtextextended('comprobante_documento:' || p_comprobante_id::text || ':' || p_tipo_documento, 0));

  -- PDF vigente: el comprobante confirmado es inmutable, se reutiliza (FR-005). Si el archivo ya no está en
  -- Storage, el pedido deja de valer y se genera de nuevo.
  select * into v_doc from dominio.comprobante_documentos d
  where d.comprobante_id = v_c.id and d.tipo_documento = p_tipo_documento and d.estado = 'generado'
  order by d.generado_en desc limit 1;
  if found then
    if exists (select 1 from storage.objects o where o.bucket_id = 'comprobantes-documentos' and o.name = v_doc.ruta) then
      return v_doc;
    end if;
    update dominio.comprobante_documentos d
    set estado = 'fallido', ruta = null, error = 'El archivo ya no está disponible', updated_at = clock_timestamp()
    where d.id = v_doc.id;
  end if;

  -- Pedido pendiente: se devuelve el mismo (idempotente) salvo que ya no pueda completarse.
  select * into v_doc from dominio.comprobante_documentos d
  where d.comprobante_id = v_c.id and d.tipo_documento = p_tipo_documento and d.estado = 'pendiente';
  if found then
    perform private.expirar_documento_pendiente(v_doc.id);
    select * into v_doc from dominio.comprobante_documentos d where d.id = v_doc.id;
    if v_doc.estado = 'pendiente' then
      return v_doc;
    end if;
  end if;

  select c.id into v_conexion from public.conexiones c
  where c.organizacion_id = v_org and c.sistema_externo = 'comprobantes-pdf' and c.estado = 'activa'
  order by c.created_at desc limit 1;
  if v_conexion is null then
    raise exception 'La impresión de documentos todavía no está habilitada para tu organización. Pedile a un administrador que la active.'
      using errcode = 'P0001', hint = 'sin_conexion';
  end if;

  insert into dominio.comprobante_documentos (organizacion_id, empresa_id, comprobante_id, tipo_documento, solicitado_por)
  values (v_org, v_c.empresa_id, v_c.id, p_tipo_documento, v_actor)
  returning * into v_doc;

  insert into public.capacidades_ejecucion (organizacion_id, conexion_id, clave, tiempo_max_seg)
  values (v_org, v_conexion, 'generar-documento-venta-' || p_tipo_documento || '-' || v_doc.id::text, 600)
  returning id into v_capacidad;

  insert into public.ejecuciones_worker (organizacion_id, conexion_id, capacidad_id, origen, actor, detalle)
  values (v_org, v_conexion, v_capacidad, 'manual', v_actor,
          jsonb_build_object('documento_id', v_doc.id, 'tipo_documento', p_tipo_documento))
  returning id into v_ejecucion;

  insert into public.despachos_ejecucion (ejecucion_id, organizacion_id) values (v_ejecucion, v_org);

  update dominio.comprobante_documentos d set ejecucion_id = v_ejecucion where d.id = v_doc.id
  returning * into v_doc;

  v_etiqueta := case p_tipo_documento when 'factura' then 'la factura' else 'el remito' end;
  perform private.registrar_actividad(
    'comprobante.documento_solicitado',
    format('Pidió imprimir %s %s', v_etiqueta, v_c.numero),
    v_c.empresa_id
  );
  return v_doc;
end;
$$;

revoke execute on function public.solicitar_documento_comprobante(uuid, text) from public, anon;
grant execute on function public.solicitar_documento_comprobante(uuid, text) to authenticated;

comment on function public.solicitar_documento_comprobante(uuid, text) is
  'F-VTA-19 (FR-001, FR-002, FR-005): pide el PDF de la factura o el remito de un comprobante confirmado. Exige ventas en lectura en la empresa; idempotente (devuelve el generado vigente o el pendiente); si no, crea el pedido y su orden de despacho. Contrato en docs/ventas-impresion.md.';

-- ============================================================================
-- public.obtener_documento_comprobante y public.listar_documentos_comprobante (FR-006)
-- ============================================================================

create or replace function public.obtener_documento_comprobante(p_documento_id uuid)
returns dominio.comprobante_documentos
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid := (select private.organizacion_id());
  v_doc dominio.comprobante_documentos;
begin
  if v_org is null or (select auth.uid()) is null then
    raise exception 'Necesitás una sesión con organización para ver documentos' using errcode = '42501';
  end if;
  select * into v_doc from dominio.comprobante_documentos d where d.id = p_documento_id and d.organizacion_id = v_org;
  if not found then
    raise exception 'El documento no existe' using errcode = 'P0002';
  end if;
  if (select private.nivel_ventas_en_empresa(v_doc.empresa_id)) not in ('lectura', 'edicion') then
    raise exception 'Tu rol no puede ver documentos de esta tienda' using errcode = '42501';
  end if;
  perform private.expirar_documento_pendiente(v_doc.id);
  select * into v_doc from dominio.comprobante_documentos d where d.id = p_documento_id;
  return v_doc;
end;
$$;

revoke execute on function public.obtener_documento_comprobante(uuid) from public, anon;
grant execute on function public.obtener_documento_comprobante(uuid) to authenticated;

comment on function public.obtener_documento_comprobante(uuid) is
  'F-VTA-19 (FR-006): estado (pendiente/generado/fallido) y ruta de un documento; un pendiente que ya no puede completarse pasa a fallido. Exige ventas en lectura en la empresa.';

create or replace function public.listar_documentos_comprobante(p_comprobante_id uuid)
returns setof dominio.comprobante_documentos
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
    raise exception 'Necesitás una sesión con organización para ver documentos' using errcode = '42501';
  end if;
  select * into v_c from dominio.comprobantes_venta c where c.id = p_comprobante_id and c.organizacion_id = v_org;
  if not found or v_c.empresa_id is null then
    raise exception 'El comprobante no existe' using errcode = 'P0002';
  end if;
  if (select private.nivel_ventas_en_empresa(v_c.empresa_id)) not in ('lectura', 'edicion') then
    raise exception 'Tu rol no puede ver documentos de esta tienda' using errcode = '42501';
  end if;
  for v_id in
    select d.id from dominio.comprobante_documentos d
    where d.comprobante_id = v_c.id and d.organizacion_id = v_org and d.estado = 'pendiente'
  loop
    perform private.expirar_documento_pendiente(v_id);
  end loop;
  return query
    select d.* from dominio.comprobante_documentos d
    where d.comprobante_id = v_c.id and d.organizacion_id = v_org
    order by d.solicitado_en desc, d.id;
end;
$$;

revoke execute on function public.listar_documentos_comprobante(uuid) from public, anon;
grant execute on function public.listar_documentos_comprobante(uuid) to authenticated;

comment on function public.listar_documentos_comprobante(uuid) is
  'F-VTA-19: documentos pedidos de un comprobante, del más reciente al más viejo. Exige ventas en lectura en la empresa.';
