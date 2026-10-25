-- F-VTA-19 (MSF-230, épica MSF-213, spec 20261024-100000-ventas-impresion, FR-004, FR-007): funciones que usa
-- el worker `comprobantes-pdf` con su rol `worker_<org>` (miembro de `workers_orquestacion`). El worker no recibe
-- grants sobre las tablas de `dominio`: lee solo por `private.datos_documento_comprobante` y cierra el pedido solo
-- por `private.cerrar_documento_comprobante`, que validan que el documento sea de SU organización y siga pendiente.
--
-- Esquemas (Principio VII): solo funciones en `private`; leen `dominio.*` y `public.ejecuciones_worker`. Ninguna
-- es alcanzable por PostgREST ni ejecutable por `authenticated` (FR-007, FR-016).
--
-- Migración aditiva (solo funciones). Reversión (migración posterior):
--   drop function private.cerrar_documento_comprobante(uuid, text, text);
--   drop function private.datos_documento_comprobante(uuid);
--   drop function private.autorizar_worker_documento(uuid);

-- Autoriza al worker sobre el documento y lo devuelve bloqueado (for update): ningún cierre concurrente se pisa.
create or replace function private.autorizar_worker_documento(p_documento_id uuid)
returns dominio.comprobante_documentos
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_doc dominio.comprobante_documentos;
begin
  -- El dueño de la función (postgres) también puede: en el CI no es superusuario y pgTAP no puede simular el
  -- login del worker con `set session authorization` (mismo criterio que autorizar_worker_importacion).
  if session_user <> current_user
     and (session_user not like 'worker\_%'
          or not pg_catalog.pg_has_role(session_user, 'workers_orquestacion', 'member')) then
    raise exception 'NO_AUTORIZADO: solo un worker accede a los datos de su documento' using errcode = 'P0001';
  end if;

  select * into v_doc from dominio.comprobante_documentos d where d.id = p_documento_id for update;
  if not found then
    raise exception 'DOCUMENTO_DESCONOCIDO: %', p_documento_id using errcode = 'P0001';
  end if;
  -- El worker solo opera sobre la organización de su rol.
  perform private.autorizar_llamante_ciclo(v_doc.organizacion_id);
  return v_doc;
end;
$$;

revoke execute on function private.autorizar_worker_documento(uuid) from public, anon, authenticated;

-- Datos para imprimir: empresa (con logo), cliente, cabecera, líneas y totales. Solo de un pedido pendiente cuya
-- ejecución sigue vigente. Lo no cargado viaja como null y el worker lo omite (FR-007).
create or replace function private.datos_documento_comprobante(p_documento_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_doc dominio.comprobante_documentos;
  v_vigente boolean;
  v_c dominio.comprobantes_venta;
  v_resultado jsonb;
  v_forma_pago text;
  v_envio text;
begin
  v_doc := private.autorizar_worker_documento(p_documento_id);
  if v_doc.estado <> 'pendiente' then
    raise exception 'DOCUMENTO_NO_PENDIENTE: el documento % ya está cerrado', p_documento_id using errcode = 'P0001';
  end if;
  select ev.en_curso into v_vigente from private.estado_ejecucion_vigente(v_doc.ejecucion_id) ev;
  if not coalesce(v_vigente, false) then
    raise exception 'EJECUCION_NO_EN_CURSO: %', v_doc.ejecucion_id using errcode = 'P0001';
  end if;

  select * into v_c from dominio.comprobantes_venta c
  where c.id = v_doc.comprobante_id and c.organizacion_id = v_doc.organizacion_id;
  if not found or v_c.empresa_id is distinct from v_doc.empresa_id then
    raise exception 'CONFIGURACION_INVALIDA: el comprobante del documento % no coincide con su empresa', p_documento_id
      using errcode = 'P0001';
  end if;

  -- Forma de pago y de envío: solo el nombre elegido, si el catálogo de la tienda lo tiene.
  select f.nombre into v_forma_pago from dominio.formas_pago f
  where f.id = v_c.forma_pago_id and f.organizacion_id = v_c.organizacion_id and f.empresa_id = v_c.empresa_id;
  select f.nombre into v_envio from dominio.formas_envio f
  where f.id = v_c.envio_id and f.organizacion_id = v_c.organizacion_id and f.empresa_id = v_c.empresa_id;

  select jsonb_build_object(
    'documento', jsonb_build_object(
      'id', v_doc.id,
      'tipo', v_doc.tipo_documento,
      -- Única ruta que acepta `cerrar_documento_comprobante`: el worker sube exactamente ahí.
      'ruta', v_doc.organizacion_id::text || '/' || v_doc.empresa_id::text || '/' || v_doc.comprobante_id::text
              || '/' || v_doc.id::text || '.pdf'
    ),
    'empresa', jsonb_build_object(
      'nombre', e.nombre,
      'razon_social', nullif(btrim(e.razon_social), ''),
      'cuit', e.cuit,
      'direccion', nullif(btrim(e.direccion), ''),
      'correo', nullif(btrim(e.correo), ''),
      'whatsapp', nullif(btrim(e.whatsapp), ''),
      'logo_ruta', ti.logo_ruta
    ),
    'cliente', jsonb_build_object(
      'nombre', cl.nombre,
      'documento', nullif(btrim(cl.documento), ''),
      'condicion_iva', nullif(btrim(cl.condicion_iva), ''),
      'direccion', nullif(btrim(concat_ws(', ', nullif(cl.direccion, ''), nullif(cl.localidad, ''), nullif(cl.provincia, ''))), '')
    ),
    'comprobante', jsonb_build_object(
      'tipo', v_c.tipo,
      'numero', v_c.numero,
      'estado', v_c.estado,
      'fecha', v_c.fecha,
      'valido_hasta', v_c.valido_hasta,
      'operador', nullif(btrim(concat_ws(' ', p.nombre, p.apellido)), ''),
      'forma_pago', v_forma_pago,
      'envio', v_envio,
      'total_sin_iva', v_c.total_sin_iva,
      'iva', v_c.total_con_iva - v_c.total_sin_iva,
      'total_con_iva', v_c.total_con_iva
    ),
    'lineas', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'orden', l.orden,
          'descripcion', l.descripcion,
          'codigo', nullif(btrim(l.codigo), ''),
          'cantidad', l.cantidad,
          'precio_unitario', l.precio_unitario,
          'subtotal_sin_iva', l.subtotal_sin_iva,
          'deposito', d.nombre
        )
        order by l.orden
      )
      from dominio.comprobantes_venta_lineas l
      join dominio.depositos d on d.id = l.deposito_id and d.organizacion_id = l.organizacion_id
      where l.comprobante_id = v_c.id and l.organizacion_id = v_c.organizacion_id
    ), '[]'::jsonb)
  )
  into v_resultado
  from dominio.empresas e
  join public.clientes cl on cl.id = v_c.cliente_id and cl.organizacion_id = v_c.organizacion_id
  left join dominio.tienda_identidad ti on ti.empresa_id = e.id and ti.organizacion_id = e.organizacion_id
  left join public.perfiles_usuario p on p.user_id = v_c.operador_id
  where e.id = v_c.empresa_id and e.organizacion_id = v_c.organizacion_id;

  return v_resultado;
end;
$$;

comment on function private.datos_documento_comprobante(uuid) is
  'F-VTA-19 (FR-007): datos de un documento pendiente para el worker comprobantes-pdf. Solo workers de la organización dueña; no ejecutable por authenticated.';

revoke execute on function private.datos_documento_comprobante(uuid) from public, anon, authenticated;
grant execute on function private.datos_documento_comprobante(uuid) to workers_orquestacion;

-- Cierra el pedido: `generado` con la ruta del PDF subido, o `fallido` con un motivo sanitizado. Idempotente:
-- un segundo cierre (reintento tras un corte) no cambia nada. También cierra la ejecución del ciclo de workers.
create or replace function private.cerrar_documento_comprobante(p_documento_id uuid, p_ruta text, p_error text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_doc dominio.comprobante_documentos;
  v_error text;
  -- Formas de secreto en texto recuperable (mismo criterio que cerrar_ejecucion_worker).
  c_patron_secreto constant text :=
    '(?i)(api[_-]?key|bearer|session|passwd|password|pwd|secret|token)\s*[:=]\s*\S+'
    || '|eyJ[A-Za-z0-9_-]+\.eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_.-]+'
    || '|://[^/\s:]+:[^/\s@]+@'
    || '|AKIA[0-9A-Z]{16}';
begin
  v_doc := private.autorizar_worker_documento(p_documento_id);
  if v_doc.estado <> 'pendiente' then
    return;
  end if;

  if p_ruta is not null then
    if p_ruta <> v_doc.organizacion_id::text || '/' || v_doc.empresa_id::text || '/' || v_doc.comprobante_id::text
                 || '/' || v_doc.id::text || '.pdf' then
      raise exception 'RUTA_INVALIDA: la ruta no es la del documento %', p_documento_id using errcode = 'P0001';
    end if;
    update dominio.comprobante_documentos d
    set estado = 'generado', ruta = p_ruta, error = null, generado_en = clock_timestamp(), updated_at = clock_timestamp()
    where d.id = v_doc.id;
  else
    v_error := left(coalesce(nullif(btrim(p_error), ''), 'No se pudo generar el documento'), 500);
    if v_error ~ c_patron_secreto then
      v_error := 'No se pudo generar el documento';
    end if;
    update dominio.comprobante_documentos d
    set estado = 'fallido', ruta = null, error = v_error, updated_at = clock_timestamp()
    where d.id = v_doc.id;
  end if;

  update public.ejecuciones_worker e
  set estado = case when p_ruta is not null then 'exitosa' else 'fallida' end,
      finalizada_en = clock_timestamp(),
      motivo_sanitizado = case when p_ruta is not null then null else left(coalesce(v_error, ''), 200) end
  where e.id = v_doc.ejecucion_id and e.estado = 'en_curso';
end;
$$;

comment on function private.cerrar_documento_comprobante(uuid, text, text) is
  'F-VTA-19 (FR-004): cierra el pedido como generado (ruta) o fallido (error sanitizado). Idempotente. Solo workers de la organización dueña; no ejecutable por authenticated.';

revoke execute on function private.cerrar_documento_comprobante(uuid, text, text) from public, anon, authenticated;
grant execute on function private.cerrar_documento_comprobante(uuid, text, text) to workers_orquestacion;
