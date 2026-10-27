-- F-VTA-20 (MSF-245, épica MSF-213, spec 20261024-100000-ventas-impresion, FR-021): el pedido de documento
-- acepta el tipo `presupuesto`.
--
-- Esquema (Principio VII): sin tablas nuevas; solo se reemplaza la función `public.solicitar_documento_comprobante`
-- (20261211120300), que escribe `dominio.comprobante_documentos` (dominio) y el despacho de plataforma. La tabla ya
-- admitía el tipo `presupuesto` desde 20261211120100.
--
-- Diferencias con la versión de F-VTA-19: un presupuesto se imprime en estado `pendiente` o `aceptado` (el
-- `vencido` se deriva de `valido_hasta`, FR-021) y su PDF solo se reutiliza si se pidió después de la última
-- modificación del presupuesto (`updated_at`, que las RPC de cabecera y líneas actualizan); si no, se genera uno
-- nuevo. Factura y remito se comportan igual que antes. Mismos `revoke`/`grant`.
--
-- Migración aditiva (reemplaza el cuerpo de una función). Reversión: reaplicar el cuerpo de la función de
-- 20261211120300_documento_rpc.sql en una migración posterior.

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
  if p_tipo_documento is null or p_tipo_documento not in ('factura', 'remito', 'presupuesto') then
    raise exception 'Elegí si querés imprimir la factura, el remito o el presupuesto' using errcode = '22023', hint = 'tipo_documento';
  end if;

  select * into v_c from dominio.comprobantes_venta c where c.id = p_comprobante_id and c.organizacion_id = v_org;
  if not found or v_c.empresa_id is null then
    raise exception 'El comprobante no existe' using errcode = 'P0002';
  end if;
  -- La organización y el solicitante salen de la sesión; el permiso, de la empresa del comprobante (FR-001).
  if (select private.nivel_ventas_en_empresa(v_c.empresa_id)) not in ('lectura', 'edicion') then
    raise exception 'Tu rol no puede imprimir comprobantes de esta tienda' using errcode = '42501';
  end if;
  if p_tipo_documento = 'presupuesto' then
    -- Presupuesto (FR-021): imprimible en cualquier estado visible en Presupuestos. `vencido` se deriva de
    -- `valido_hasta` y no se guarda, así que alcanza con `pendiente` y `aceptado`.
    if v_c.tipo <> 'presupuesto' then
      raise exception 'Solo se imprime el presupuesto de un presupuesto' using errcode = '22023', hint = 'tipo_documento';
    end if;
    if v_c.estado not in ('pendiente', 'aceptado') then
      raise exception 'Este presupuesto ya no se puede imprimir' using errcode = '22023', hint = 'estado';
    end if;
  else
    if v_c.tipo <> 'factura' then
      raise exception 'Solo se imprimen la factura y el remito de una factura' using errcode = '22023', hint = 'tipo_documento';
    end if;
    if v_c.estado <> 'confirmada' then
      raise exception 'La factura tiene que estar confirmada para imprimirla' using errcode = '22023', hint = 'estado';
    end if;
  end if;

  -- Serializa los pedidos del mismo documento: el doble clic y dos operadores a la vez dan un solo pedido.
  perform pg_advisory_xact_lock(hashtextextended('comprobante_documento:' || p_comprobante_id::text || ':' || p_tipo_documento, 0));

  -- PDF vigente: el comprobante confirmado es inmutable, se reutiliza (FR-005). Un presupuesto sí se edita: su PDF
  -- solo vale si se generó después de la última modificación (FR-021). Si el archivo ya no está en Storage, el
  -- pedido deja de valer y se genera de nuevo.
  select * into v_doc from dominio.comprobante_documentos d
  where d.comprobante_id = v_c.id and d.tipo_documento = p_tipo_documento and d.estado = 'generado'
  order by d.generado_en desc limit 1;
  if found and p_tipo_documento = 'presupuesto' and v_doc.solicitado_en < v_c.updated_at then
    -- El PDF viejo no se reutiliza ni se marca fallido: queda como historial de lo que se imprimió.
    v_doc := null;
  end if;
  if v_doc.id is not null then
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

  v_etiqueta := case p_tipo_documento when 'factura' then 'la factura' when 'remito' then 'el remito' else 'el presupuesto' end;
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

revoke execute on function public.solicitar_documento_comprobante(uuid, text) from public, anon;
grant execute on function public.solicitar_documento_comprobante(uuid, text) to authenticated;

comment on function public.solicitar_documento_comprobante(uuid, text) is
  'F-VTA-19/F-VTA-20 (FR-001, FR-002, FR-005, FR-021): pide el PDF de la factura o el remito de un comprobante confirmado, o el del presupuesto (pendiente/aceptado). Exige ventas en lectura en la empresa; idempotente (devuelve el generado vigente o el pendiente); si no, crea el pedido y su orden de despacho. Contrato en docs/ventas-impresion.md.';
