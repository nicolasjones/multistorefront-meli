-- F-VTA-21 (MSF-256, épica MSF-213, spec 20261024-100000-ventas-impresion, FR-031, FR-032): registrar una impresión y
-- consultar la última de cada documento.
--
-- Esquemas (Principio VII): solo funciones. Escriben `dominio.comprobante_impresiones` (dominio, 20261211130100) y,
-- por `private.registrar_actividad`, `public.registro_actividad` (plataforma, solo datos).
--
-- Permiso: `ventas` en `lectura` o `edicion` EN LA EMPRESA del documento (imprimir no es una acción hacia afuera; mismo
-- criterio que `solicitar_documento_comprobante`). La reimpresión no pide nada adicional (FR-035).
-- «Primera impresión» = ninguna impresión previa de ese tipo de documento de ese comprobante: si el PDF se regenera
-- (otro `documento_id`), imprimirlo sigue siendo una reimpresión del mismo documento de venta.
--
-- Migración aditiva. Reversión (migración posterior):
--   drop function public.ultimas_impresiones_comprobante(uuid);
--   drop function public.registrar_impresion(uuid);

create or replace function public.registrar_impresion(p_documento_id uuid)
returns dominio.comprobante_impresiones
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid := (select private.organizacion_id());
  v_actor uuid := (select auth.uid());
  v_doc dominio.comprobante_documentos;
  v_numero text;
  v_reimpresion boolean;
  v_imp dominio.comprobante_impresiones;
  v_etiqueta text;
begin
  if v_org is null or v_actor is null then
    raise exception 'Necesitás una sesión con organización para registrar impresiones' using errcode = '42501';
  end if;

  select * into v_doc from dominio.comprobante_documentos d where d.id = p_documento_id and d.organizacion_id = v_org;
  if not found then
    raise exception 'El documento no existe' using errcode = 'P0002';
  end if;
  if (select private.nivel_ventas_en_empresa(v_doc.empresa_id)) not in ('lectura', 'edicion') then
    raise exception 'Tu rol no puede imprimir comprobantes de esta tienda' using errcode = '42501';
  end if;
  if v_doc.estado <> 'generado' then
    raise exception 'El documento todavía no está listo: no se puede marcar como impreso' using errcode = '22023', hint = 'estado';
  end if;

  -- Serializa las impresiones del mismo documento: dos personas a la vez no pueden ser ambas «la primera».
  perform pg_advisory_xact_lock(hashtextextended('comprobante_impresion:' || v_doc.comprobante_id::text || ':' || v_doc.tipo_documento, 0));

  select exists (
    select 1 from dominio.comprobante_impresiones i
    where i.comprobante_id = v_doc.comprobante_id and i.tipo_documento = v_doc.tipo_documento
  ) into v_reimpresion;

  insert into dominio.comprobante_impresiones
    (organizacion_id, empresa_id, comprobante_id, tipo_documento, documento_id, impreso_por, impreso_en, reimpresion)
  values (v_org, v_doc.empresa_id, v_doc.comprobante_id, v_doc.tipo_documento, v_doc.id, v_actor, clock_timestamp(), v_reimpresion)
  returning * into v_imp;

  select c.numero into v_numero from dominio.comprobantes_venta c where c.id = v_doc.comprobante_id;
  v_etiqueta := case v_doc.tipo_documento when 'factura' then 'la factura' when 'remito' then 'el remito' else 'el presupuesto' end;
  perform private.registrar_actividad(
    case when v_reimpresion then 'comprobante.reimpreso' else 'comprobante.impreso' end,
    format('%s %s %s', case when v_reimpresion then 'Reimprimió' else 'Imprimió' end, v_etiqueta, v_numero),
    v_doc.empresa_id
  );
  return v_imp;
end;
$$;

revoke execute on function public.registrar_impresion(uuid) from public, anon;
grant execute on function public.registrar_impresion(uuid) to authenticated;

comment on function public.registrar_impresion(uuid) is
  'F-VTA-21 (FR-031, FR-032): registra la impresión de un documento generado. Exige ventas en lectura en la empresa; rechaza un documento no generado; emite comprobante.impreso la primera vez y comprobante.reimpreso después. Contrato en docs/ventas-impresion.md.';

create or replace function public.ultimas_impresiones_comprobante(p_comprobante_id uuid)
returns setof dominio.comprobante_impresiones
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid := (select private.organizacion_id());
  v_c dominio.comprobantes_venta;
begin
  if v_org is null or (select auth.uid()) is null then
    raise exception 'Necesitás una sesión con organización para ver impresiones' using errcode = '42501';
  end if;
  select * into v_c from dominio.comprobantes_venta c where c.id = p_comprobante_id and c.organizacion_id = v_org;
  if not found or v_c.empresa_id is null then
    raise exception 'El comprobante no existe' using errcode = 'P0002';
  end if;
  if (select private.nivel_ventas_en_empresa(v_c.empresa_id)) not in ('lectura', 'edicion') then
    raise exception 'Tu rol no puede ver impresiones de esta tienda' using errcode = '42501';
  end if;
  return query
    select distinct on (i.tipo_documento) i.*
    from dominio.comprobante_impresiones i
    where i.comprobante_id = v_c.id and i.organizacion_id = v_org
    order by i.tipo_documento, i.impreso_en desc, i.id;
end;
$$;

revoke execute on function public.ultimas_impresiones_comprobante(uuid) from public, anon;
grant execute on function public.ultimas_impresiones_comprobante(uuid) to authenticated;

comment on function public.ultimas_impresiones_comprobante(uuid) is
  'F-VTA-21 (FR-032, FR-033): la última impresión de cada tipo de documento de un comprobante (una fila por tipo). Exige ventas en lectura en la empresa.';
