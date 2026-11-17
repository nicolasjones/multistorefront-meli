-- MSF-515 (lote 21) · Exportación CSV de Presupuestos por canal. Seguimiento de MSF-942 (filtro «Canal» del listado, migración 20270507130000).
--
-- `listar_presupuestos` ya filtra por canal con `p_origen` (`panel` / `tienda`, según el VÍNCULO `dominio.presupuestos_tienda`, no por `canal`),
-- pero la exportación CSV usa `private.comprobantes_consulta` y no filtraba. Esta migración propaga el mismo `p_origen text default null` por toda
-- la cadena de exportación para que el archivo coincida con lo que se ve en pantalla:
--   · `private.comprobantes_consulta(..., p_origen)`: el filtro entra en el CTE `base`, ANTES de `count(*) over ()` (así `filas` es el total del canal).
--     Valor desconocido: 22023 (hint `origen`), igual que `listar_presupuestos`.
--   · `private.comprobantes_consulta_sesion(..., p_origen)` y `public.exportar_comprobantes(..., p_origen)` (vía inmediata, hasta 10.000 filas).
--   · `public.solicitar_exportacion_comprobantes`: acepta la clave `origen` en `p_filtros` (validada y guardada en el `detalle`, que el worker
--     lee) y `private.filas_exportacion_comprobantes` la pasa a la consulta (vía diferida). Sin `origen` el `detalle` queda idéntico al de antes,
--     así que la idempotencia por solicitud no cambia.
-- `listar_comprobantes` no cambia: llama a la sesión con nueve argumentos y `p_origen` toma su valor por omisión (null = todos).
--
-- Cuerpos: cada función parte de su definición VIGENTE (comprobantes_consulta: `20270322100600` con `public.clientes` ya pasado a `dominio.clientes` por el barrido de `20270418000401`; el resto: `20261212110000/110100/110200`)
-- más el filtro. Cambian las firmas (parámetro nuevo al final): se quitan las anteriores y se crean las nuevas (con `create or replace` quedaría
-- una sobrecarga y las llamadas por nombre serían ambiguas). Mismos grants que antes: `comprobantes_consulta` sin acceso para anon/authenticated;
-- `comprobantes_consulta_sesion`, `exportar_comprobantes` y `solicitar_exportacion_comprobantes` ejecutables por authenticated (no por anon).
--
-- Esquema (Principio VII): sin tablas. No lee `registro_actividad` (la guardia de `actividad_por_empresa` no cambia).
-- Reversión: recrear las cuatro funciones con los cuerpos de las migraciones citadas y quitar las nuevas
-- (`drop function ... (..., text)`).

drop function if exists private.comprobantes_consulta(uuid, uuid[], text[], text, text, uuid, uuid, uuid, uuid, integer, integer);
drop function if exists private.comprobantes_consulta_sesion(text[], text, text, uuid, uuid, uuid, uuid, integer, integer);
drop function if exists public.exportar_comprobantes(text, text, text, uuid, uuid, uuid, uuid);

CREATE OR REPLACE FUNCTION private.comprobantes_consulta(p_organizacion_id uuid, p_empresas uuid[], p_tipos text[], p_busqueda text, p_estado text, p_pago_id uuid, p_envio_id uuid, p_operador_id uuid, p_empresa_id uuid, p_limite integer, p_desde integer, p_origen text DEFAULT NULL::text)
 RETURNS TABLE(id uuid, numero text, tipo text, empresa_id uuid, empresa text, fecha date, cliente text, operador_id uuid, operador text, estado text, estado_etiqueta text, forma_pago text, envio text, total numeric, filas bigint)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_texto text := btrim(coalesce(p_busqueda, ''));
  v_patron text;
  v_estado text := nullif(btrim(coalesce(p_estado, '')), '');
  v_hoy date := (select private.hoy_argentina());
  v_origen text := nullif(btrim(coalesce(p_origen, '')), '');
begin
  if v_origen is not null and v_origen not in ('panel', 'tienda') then
    raise exception 'El origen % no existe: usá panel o tienda', v_origen using errcode = '22023', hint = 'origen';
  end if;
  if v_estado is not null and v_estado not in
     ('borrador', 'confirmada', 'pendiente', 'aceptado', 'cobrado', 'en_proceso', 'deuda', 'armando', 'incompleto',
      'anulada', 'vencido', 'convertido') then
    raise exception 'El estado % no existe', v_estado using errcode = '22023', hint = 'estado';
  end if;
  if v_estado = 'confirmada' then v_estado := 'pendiente'; end if;
  if v_texto <> '' then
    v_patron := '%' || replace(replace(replace(translate(lower(v_texto), 'áéíóúü', 'aeiouu'), '\', '\\'), '%', '\%'), '_', '\_') || '%';
  end if;

  return query
  with base as (
    select c.id, c.numero, c.numero_entero, c.tipo, c.empresa_id, e.nombre as empresa, c.fecha,
           cl.nombre as cliente, c.operador_id,
           case when exists (select 1 from dominio.presupuestos_tienda pt where pt.comprobante_id = c.id and pt.organizacion_id = c.organizacion_id)
                then 'Tienda online (cliente)'
                else coalesce(nullif(btrim(concat_ws(' ', p.nombre, p.apellido)), ''), 'Usuario sin nombre') end as operador,
           case when c.tipo = 'presupuesto' and c.estado = 'pendiente' and c.valido_hasta is not null
                     and c.valido_hasta < v_hoy then 'vencido' else c.estado end as estado,
           fp.nombre as forma_pago, fe.nombre as envio,
           case when c.tipo = 'nota_credito' then -c.total_con_iva else c.total_con_iva end as total
      from dominio.comprobantes_venta c
      join dominio.empresas e on e.id = c.empresa_id and e.organizacion_id = c.organizacion_id
      join dominio.clientes cl on cl.id = c.cliente_id and cl.organizacion_id = c.organizacion_id
      left join public.perfiles_usuario p on p.user_id = c.operador_id
      left join dominio.formas_pago fp on fp.id = c.forma_pago_id and fp.organizacion_id = c.organizacion_id
      left join dominio.formas_envio fe on fe.id = c.envio_id and fe.organizacion_id = c.organizacion_id
     where c.organizacion_id = p_organizacion_id
       and c.empresa_id = any (p_empresas)
       and c.tipo = any (p_tipos)
       and (p_empresa_id is null or c.empresa_id = p_empresa_id)
       and (p_pago_id is null or c.forma_pago_id = p_pago_id)
       and (p_envio_id is null or c.envio_id = p_envio_id)
       and (p_operador_id is null or c.operador_id = p_operador_id)
       and (v_origen is null
            or (v_origen = 'tienda' and exists (select 1 from dominio.presupuestos_tienda pt where pt.comprobante_id = c.id and pt.organizacion_id = c.organizacion_id))
            or (v_origen = 'panel' and not exists (select 1 from dominio.presupuestos_tienda pt where pt.comprobante_id = c.id and pt.organizacion_id = c.organizacion_id)))
       and (v_patron is null
            or translate(lower(cl.nombre), 'áéíóúü', 'aeiouu') like v_patron
            or lower(c.numero) like v_patron
            or coalesce(c.numero_entero::text, '') like v_patron)
  )
  select b.id, b.numero, b.tipo, b.empresa_id, b.empresa, b.fecha, b.cliente, b.operador_id, b.operador,
         b.estado, private.etiqueta_estado_comprobante(b.estado), b.forma_pago, b.envio, b.total,
         count(*) over () as filas
    from base b
   where v_estado is null or (case when b.estado = 'confirmada' then 'pendiente' else b.estado end) = v_estado
   order by b.fecha desc, b.numero_entero desc nulls last, b.id
   limit p_limite
  offset p_desde;
end;
$function$;

revoke execute on function private.comprobantes_consulta(uuid, uuid[], text[], text, text, uuid, uuid, uuid, uuid, integer, integer, text)
  from public, anon, authenticated;

comment on function private.comprobantes_consulta(uuid, uuid[], text[], text, text, uuid, uuid, uuid, uuid, integer, integer, text) is
  'F-VTA-09: consulta única de comprobantes/presupuestos con filtros (incluye p_origen: null = todos, panel o tienda por el vínculo presupuestos_tienda); la usan listar_comprobantes, exportar_comprobantes y el worker de exportación. Sin grant a authenticated: el llamador resuelve organización y empresas.';

create or replace function private.comprobantes_consulta_sesion(
  p_tipos text[],
  p_busqueda text,
  p_estado text,
  p_pago_id uuid,
  p_envio_id uuid,
  p_operador_id uuid,
  p_empresa_id uuid,
  p_limite integer,
  p_desde integer,
  p_origen text default null
)
returns table (
  id uuid,
  numero text,
  tipo text,
  empresa_id uuid,
  empresa text,
  fecha date,
  cliente text,
  operador_id uuid,
  operador text,
  estado text,
  estado_etiqueta text,
  forma_pago text,
  envio text,
  total numeric,
  filas bigint
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_org uuid := (select private.organizacion_id());
  v_empresas uuid[];
begin
  if v_org is null or (select auth.uid()) is null then
    raise exception 'Necesitás una sesión con organización para ver comprobantes' using errcode = '42501';
  end if;

  select coalesce(array_agg(e.id), '{}') into v_empresas
    from dominio.empresas e
   where e.organizacion_id = v_org
     and (select private.nivel_ventas_en_empresa(e.id)) in ('lectura', 'edicion');

  return query
  select q.id, q.numero, q.tipo, q.empresa_id, q.empresa, q.fecha, q.cliente, q.operador_id, q.operador,
         q.estado, q.estado_etiqueta, q.forma_pago, q.envio, q.total, q.filas
    from private.comprobantes_consulta(
           v_org, v_empresas, p_tipos, p_busqueda, p_estado, p_pago_id, p_envio_id, p_operador_id,
           p_empresa_id, p_limite, p_desde, p_origen
         ) q;
end;
$$;

revoke execute on function private.comprobantes_consulta_sesion(text[], text, text, uuid, uuid, uuid, uuid, integer, integer, text)
  from public, anon;
grant execute on function private.comprobantes_consulta_sesion(text[], text, text, uuid, uuid, uuid, uuid, integer, integer, text)
  to authenticated;

comment on function private.comprobantes_consulta_sesion(text[], text, text, uuid, uuid, uuid, uuid, integer, integer, text) is
  'F-VTA-09: misma consulta del listado con organización y empresas resueltas de la sesión (más p_origen). Puente de las RPC security invoker; no acepta organización ni empresas por argumento.';

create or replace function public.exportar_comprobantes(
  p_tipo text,
  p_busqueda text default null,
  p_estado text default null,
  p_pago_id uuid default null,
  p_envio_id uuid default null,
  p_operador_id uuid default null,
  p_empresa_id uuid default null,
  p_origen text default null
)
returns table (
  id uuid,
  numero text,
  tipo text,
  empresa_id uuid,
  empresa text,
  fecha date,
  cliente text,
  operador text,
  estado text,
  estado_etiqueta text,
  forma_pago text,
  envio text,
  total numeric,
  filas bigint
)
language plpgsql
stable
security invoker
set search_path = ''
as $$
begin
  if p_tipo is null or p_tipo not in ('comprobantes', 'presupuestos') then
    raise exception 'El tipo debe ser comprobantes o presupuestos' using errcode = '22023', hint = 'tipo';
  end if;
  if not (select private.puede_accion('ventas', 'exportar')) then
    raise exception 'No tenés permiso para exportar ventas' using errcode = '42501';
  end if;

  return query
  select q.id, q.numero, q.tipo, q.empresa_id, q.empresa, q.fecha, q.cliente, q.operador, q.estado,
         q.estado_etiqueta, q.forma_pago, q.envio, q.total, q.filas
    from private.comprobantes_consulta_sesion(
           case p_tipo when 'presupuestos' then array['presupuesto'] else array['factura', 'nota_credito'] end,
           p_busqueda, p_estado, p_pago_id, p_envio_id, p_operador_id, p_empresa_id, 10000, 0, p_origen
         ) q;
end;
$$;

revoke execute on function public.exportar_comprobantes(text, text, text, uuid, uuid, uuid, uuid, text) from public, anon;
grant execute on function public.exportar_comprobantes(text, text, text, uuid, uuid, uuid, uuid, text) to authenticated;

comment on function public.exportar_comprobantes(text, text, text, uuid, uuid, uuid, uuid, text) is
  'Exportación de comprobantes o presupuestos con los mismos filtros que el listado (incluye p_origen), hasta 10.000 filas; security invoker, exige private.puede_accion(ventas, exportar) (F-VTA-09, FR-006). filas = total del filtro.';

create or replace function public.solicitar_exportacion_comprobantes(p_tipo text, p_filtros jsonb default '{}'::jsonb)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid := (select private.organizacion_id());
  v_uid uuid := (select auth.uid());
  v_filtros jsonb;
  v_empresas uuid[];
  v_cap record;
  v_detalle jsonb;
  v_existente uuid;
  v_clave text;
begin
  if v_org is null or v_uid is null then
    raise exception 'NO_AUTORIZADO: necesitás una sesión con organización' using errcode = '42501';
  end if;
  if not (select private.puede_accion('ventas', 'exportar')) then
    raise exception 'NO_AUTORIZADO: no tenés permiso para exportar ventas' using errcode = '42501';
  end if;
  if p_tipo is null or p_tipo not in ('comprobantes', 'presupuestos') then
    raise exception 'TIPO_INVALIDO: el tipo debe ser comprobantes o presupuestos' using errcode = '22023';
  end if;
  if p_filtros is null or jsonb_typeof(p_filtros) <> 'object' then
    raise exception 'FILTROS_INVALIDOS: los filtros deben ser un objeto' using errcode = '22023';
  end if;

  -- Solo las claves conocidas, con tipo validado: nada más llega al worker.
  begin
    v_filtros := jsonb_strip_nulls(jsonb_build_object(
      'busqueda', nullif(btrim(p_filtros->>'busqueda'), ''),
      'estado', nullif(btrim(p_filtros->>'estado'), ''),
      'pago_id', (p_filtros->>'pago_id')::uuid,
      'envio_id', (p_filtros->>'envio_id')::uuid,
      'operador_id', (p_filtros->>'operador_id')::uuid,
      'empresa_id', (p_filtros->>'empresa_id')::uuid,
      'origen', nullif(btrim(p_filtros->>'origen'), '')
    ));
  exception when invalid_text_representation then
    raise exception 'FILTROS_INVALIDOS: un identificador de filtro no es válido' using errcode = '22023';
  end;

  select coalesce(array_agg(e.id order by e.id), '{}') into v_empresas
    from dominio.empresas e
   where e.organizacion_id = v_org
     and (select private.nivel_ventas_en_empresa(e.id)) in ('lectura', 'edicion');

  -- Valida el estado con la misma consulta del listado (22023 si no existe); no trae filas.
  perform 1 from private.comprobantes_consulta(
    v_org, v_empresas, array['factura'], null, v_filtros->>'estado', null, null, null, null, 0, 0, v_filtros->>'origen');

  select * into v_cap from private.capacidad_exportacion_comprobantes(v_uid);
  v_clave := v_cap.clave_capacidad;

  v_detalle := jsonb_build_object(
    'tipo', p_tipo,
    'filtros', v_filtros,
    'empresas', to_jsonb(v_empresas),
    'actor', v_uid,
    'archivo_prefijo', v_org::text || '/' || v_uid::text || '/'
  );

  -- Idempotente por solicitud: la misma exportación (mismos filtros) ya en curso devuelve esa ejecución.
  select e.id into v_existente
    from public.ejecuciones_worker e
    join public.capacidades_ejecucion cap on cap.id = e.capacidad_id
   where e.organizacion_id = v_org
     and cap.conexion_id = v_cap.conexion_id and cap.clave = v_clave
     and e.estado = 'en_curso'
     and e.iniciada_en > clock_timestamp() - make_interval(secs => cap.tiempo_max_seg)
     and e.detalle = v_detalle;
  if v_existente is not null then
    return v_existente;
  end if;

  -- Ejecución auditable + orden de despacho; una segunda distinta en curso falla con YA_EN_CURSO.
  return private.iniciar_exportacion_comprobantes(v_cap.conexion_id, v_clave, v_uid, v_detalle);
end;
$$;

revoke execute on function public.solicitar_exportacion_comprobantes(text, jsonb) from public, anon;
grant execute on function public.solicitar_exportacion_comprobantes(text, jsonb) to authenticated;

comment on function public.solicitar_exportacion_comprobantes(text, jsonb) is
  'F-VTA-09 (FR-007): registra la exportación diferida (más de 10.000 filas) como ejecución del worker exportar-comprobantes con los filtros (incluida la clave origen) y las empresas visibles guardados. Exige ventas/exportar; bloquea simultáneas por usuario (YA_EN_CURSO); idempotente con los mismos filtros.';

create or replace function private.filas_exportacion_comprobantes(p_ejecucion_id uuid, p_desde integer, p_limite integer)
returns table (
  numero text, tipo text, empresa text, fecha date, cliente text, operador text, estado_etiqueta text,
  forma_pago text, envio text, total numeric, filas bigint
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_d record;
begin
  select * into v_d from private.datos_exportacion_comprobantes(p_ejecucion_id);
  if p_desde is null or p_desde < 0 or p_limite is null or p_limite < 1 or p_limite > 5000 then
    raise exception 'LOTE_INVALIDO: desde >= 0 y límite entre 1 y 5000' using errcode = '22023';
  end if;

  return query
  select q.numero, q.tipo, q.empresa, q.fecha, q.cliente, q.operador, q.estado_etiqueta,
         q.forma_pago, q.envio, q.total, q.filas
    from private.comprobantes_consulta(
           v_d.organizacion_id, v_d.empresas,
           case v_d.tipo when 'presupuestos' then array['presupuesto'] else array['factura', 'nota_credito'] end,
           v_d.filtros->>'busqueda', v_d.filtros->>'estado',
           (v_d.filtros->>'pago_id')::uuid, (v_d.filtros->>'envio_id')::uuid,
           (v_d.filtros->>'operador_id')::uuid, (v_d.filtros->>'empresa_id')::uuid,
           p_limite, p_desde, v_d.filtros->>'origen'
         ) q;
end;
$$;

revoke execute on function private.filas_exportacion_comprobantes(uuid, integer, integer) from public, anon, authenticated;
grant execute on function private.filas_exportacion_comprobantes(uuid, integer, integer) to workers_orquestacion;
