-- Lote 76 (MSF-599, MSF-654 y MSF-655, decimotercera ola de la convención de códigos de negocio mapeados a 4xx): veintiuna RPC
-- de la tienda online (borrador, publicación y versiones), claves y suscripciones de API, documentos e impresiones de comprobantes,
-- presupuestos por correo, importación de productos y fusión de clientes dejan de contestar HTTP 500 cuando rechazan por «no existe»
-- (`P0002`). Pasan, con el mismo mensaje de siempre, a `PT404` (HTTP 404). Qué código emite cada función: ver la fila 13 de la tabla
-- de docs/errores-negocio-postgrest.md.
--
-- Funciones: guardar_borrador_tienda, obtener_borrador_tienda, descartar_borrador_tienda, publicar_tienda, listar_versiones_tienda,
-- restaurar_version_tienda, vista_previa_tienda, rutas_tienda_sin_referencia, revocar_clave_api, rotar_clave_api,
-- actualizar_suscripcion_api, eliminar_suscripcion_api, rotar_secreto_suscripcion_api, listar_documentos_comprobante,
-- obtener_documento_comprobante, ultimas_impresiones_comprobante, solicitar_documento_comprobante, enviar_presupuesto_correo,
-- listar_envios_correo_presupuesto, obtener_importacion_productos y vista_previa_fusion_clientes.
--
-- Cada función parte de su definición VIGENTE (la de la base con la duodécima ola aplicada, que `pg_get_functiondef` devuelve tal
-- cual: `vista_previa_fusion_clientes` ya apunta a `dominio.clientes` por el barrido 20270418000401) y solo cambia el errcode:
-- mensajes, cuerpo, firma, `security definer`, `search_path` y grants son los mismos (`create or replace` conserva privilegios;
-- no hay drop, grant ni revoke). Un comentario mencionaba el código (el de `obtener_importacion_productos`) y se actualiza.
--
-- Ninguna es llamable por `anon` ni la consume Kestra, un worker o una Edge Function: solo la web, que acepta el código viejo y el
-- nuevo (`P0002` o `PT404`) porque la migración y el despliegue no son simultáneos.
--
-- Quedan con el código anterior a propósito:
--   (a) los `55000` de bandera apagada y el contrato por `detail` de la verificación de dominio de la tienda
--       (`preparar_verificacion_tienda`, `registrar_verificacion_dns`; además las consume una Edge Function);
--   (b) las funciones que consume una Edge Function por código (invitaciones: `cancelar_invitacion`,
--       `guardar_asignaciones_invitacion`, `vincular_invitacion`; clientes: `cuentas_web_de_cliente`, `vincular_cuenta_cliente`);
--   (c) `reintentar_entrega_api`: su único `P0002` mezcla «no existe» y «no está agotada» (estado), así que no es un 404 claro;
--   (d) por tamaño del lote, `guardar_catalogo_tienda`, `listar_catalogo_tienda`, `guardar_tienda_identidad` y `copiar_presupuesto`;
--   (e) el `P0002` del resto de las funciones de `public` fuera de este alcance (integraciones y conexiones OAuth, cargas de
--       migración y lotes de importación, exportación de comprobantes, clientes y proveedores efectivos, costos adicionales,
--       reportes, organizaciones, listas de la tienda, etc.), para próximas olas.
--
-- Migración aditiva (create or replace).
--
-- Reversión: volver a aplicar, en una migración nueva, la definición vigente anterior de cada función (en el cuerpo, `PT404`
-- vuelve a `P0002`, solo en las líneas que esta migración cambia) y restaurar el comentario previo de
-- `obtener_importacion_productos` (`P0002 si no existe`). Definiciones vigentes anteriores (la última migración que cada función
-- define; antes de copiar un cuerpo hay que comprobar que ningún barrido posterior lo reescribió, como el de `public.clientes` a
-- `dominio.clientes`):
--   guardar_borrador_tienda, obtener_borrador_tienda y descartar_borrador_tienda: 20270205110100;
--   publicar_tienda: 20270311100000; listar_versiones_tienda y restaurar_version_tienda: 20270205110200;
--   vista_previa_tienda: 20270306100000; rutas_tienda_sin_referencia: 20270323100300;
--   revocar_clave_api: 20270224110201; rotar_clave_api y eliminar_suscripcion_api: 20270301100000;
--   actualizar_suscripcion_api: 20270224110204; rotar_secreto_suscripcion_api: 20270302110000;
--   listar_documentos_comprobante y obtener_documento_comprobante: 20261211120300;
--   ultimas_impresiones_comprobante: 20261211130200; solicitar_documento_comprobante: 20270507330000;
--   enviar_presupuesto_correo y listar_envios_correo_presupuesto: 20261212100300;
--   obtener_importacion_productos: 20270217200000;
--   vista_previa_fusion_clientes: 20270340000210 (con `public.clientes` reescrito a `dominio.clientes` por 20270418000401).
-- Comentario previo: el de 20270206100003 (obtener_importacion_productos). Las migraciones ya aplicadas no se editan.

-- guardar_borrador_tienda
CREATE OR REPLACE FUNCTION public.guardar_borrador_tienda(p_empresa uuid, p_area text, p_datos jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_org uuid := (select private.organizacion_id());
  v_valor jsonb;
  v_actual dominio.tienda_borrador;
  v_identidad jsonb;
  v_contenido jsonb;
  v_catalogo jsonb;
  v_detalle jsonb;
begin
  if v_org is null or (select private.nivel_seccion('empresas')) <> 'edicion' then
    raise exception 'Tu rol no puede editar la tienda de esta empresa' using errcode = '42501';
  end if;
  if not exists (select 1 from dominio.empresas e where e.id = p_empresa and e.organizacion_id = v_org) then
    raise exception 'La empresa no existe' using errcode = 'PT404';
  end if;
  if p_area is null or p_area not in ('identidad', 'contenido', 'catalogo') then
    raise exception 'El área del borrador no es válida' using errcode = '22023';
  end if;
  if p_datos is null or jsonb_typeof(p_datos) <> 'object' then
    raise exception 'Los datos del borrador tienen un formato inválido' using errcode = '22023';
  end if;

  v_valor := case p_area
    when 'identidad' then private.validar_tienda_identidad(v_org, p_empresa, p_datos)
    when 'contenido' then private.validar_tienda_contenido(p_datos)
    else private.validar_catalogo_tienda(v_org, p_empresa, p_datos->'categorias', p_datos->'productos')
  end;

  perform pg_advisory_xact_lock(hashtextextended('tienda_borrador:' || p_empresa::text, 0));

  select * into v_actual from dominio.tienda_borrador where empresa_id = p_empresa;
  v_identidad := case when p_area = 'identidad' then v_valor else v_actual.identidad end;
  v_contenido := case when p_area = 'contenido' then v_valor else v_actual.contenido end;
  v_catalogo := case when p_area = 'catalogo' then v_valor else v_actual.catalogo end;

  -- Las áreas que no difieren de lo publicado se descartan; sin áreas, no hay borrador.
  v_detalle := private.detalle_cambios_tienda(p_empresa, v_identidad, v_contenido, v_catalogo);
  if not exists (select 1 from jsonb_array_elements(v_detalle) e where e->>'area' = 'identidad') then v_identidad := null; end if;
  if not exists (select 1 from jsonb_array_elements(v_detalle) e where e->>'area' = 'contenido') then v_contenido := null; end if;
  if not exists (select 1 from jsonb_array_elements(v_detalle) e where e->>'area' = 'catalogo') then v_catalogo := null; end if;

  if v_identidad is null and v_contenido is null and v_catalogo is null then
    delete from dominio.tienda_borrador where empresa_id = p_empresa;
    return;
  end if;

  insert into dominio.tienda_borrador as b (empresa_id, organizacion_id, identidad, contenido, catalogo, updated_by, updated_at)
  values (p_empresa, v_org, v_identidad, v_contenido, v_catalogo, (select auth.uid()), now())
  on conflict (empresa_id) do update set
    identidad = excluded.identidad,
    contenido = excluded.contenido,
    catalogo = excluded.catalogo,
    updated_by = excluded.updated_by,
    updated_at = excluded.updated_at;
end;
$function$;

-- obtener_borrador_tienda
CREATE OR REPLACE FUNCTION public.obtener_borrador_tienda(p_empresa uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_org uuid := (select private.organizacion_id());
  v_activa boolean;
  v_b dominio.tienda_borrador;
  v_cambios jsonb;
  v_version jsonb;
begin
  if v_org is null or (select private.nivel_seccion('empresas')) not in ('lectura', 'edicion') then
    raise exception 'Tu rol no puede ver la tienda de esta empresa' using errcode = '42501';
  end if;
  select e.activa into v_activa from dominio.empresas e where e.id = p_empresa and e.organizacion_id = v_org;
  if not found then
    raise exception 'La empresa no existe' using errcode = 'PT404';
  end if;

  select * into v_b from dominio.tienda_borrador where empresa_id = p_empresa;
  v_cambios := private.resumen_cambios_tienda(private.detalle_cambios_tienda(p_empresa, v_b.identidad, v_b.contenido, v_b.catalogo));

  select jsonb_build_object('numero', v.numero, 'publicada_at', v.publicada_at, 'publicada_por', private.nombre_usuario(v.publicada_por))
    into v_version
    from dominio.tienda_versiones v
   where v.empresa_id = p_empresa
   order by v.numero desc
   limit 1;

  return jsonb_build_object(
    'hay_borrador', (v_cambios->>'total')::integer > 0,
    'identidad', v_b.identidad,
    'contenido', v_b.contenido,
    'catalogo', v_b.catalogo,
    'cambios', v_cambios,
    'version_vigente', v_version,
    'en_linea', v_activa,
    'dominio', (select t.dominio from dominio.tiendas t where t.empresa_id = p_empresa)
  );
end;
$function$;

-- descartar_borrador_tienda
CREATE OR REPLACE FUNCTION public.descartar_borrador_tienda(p_empresa uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_org uuid := (select private.organizacion_id());
  v_empresa text;
  v_b dominio.tienda_borrador;
  v_areas text[];
begin
  if v_org is null or (select private.nivel_seccion('empresas')) <> 'edicion' then
    raise exception 'Tu rol no puede editar la tienda de esta empresa' using errcode = '42501';
  end if;
  select e.nombre into v_empresa from dominio.empresas e where e.id = p_empresa and e.organizacion_id = v_org;
  if v_empresa is null then
    raise exception 'La empresa no existe' using errcode = 'PT404';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('tienda_borrador:' || p_empresa::text, 0));

  delete from dominio.tienda_borrador where empresa_id = p_empresa returning * into v_b;
  if v_b.empresa_id is null then
    return; -- idempotente: sin borrador no hay nada que descartar ni auditar
  end if;

  v_areas := array_remove(array[
    case when v_b.identidad is not null then 'identidad visual' end,
    case when v_b.contenido is not null then 'contenido' end,
    case when v_b.catalogo is not null then 'catálogo visible' end
  ], null);
  perform private.insertar_actividad(
    v_org,
    (select auth.uid()),
    'tienda.borrador_descartado',
    format('Descartó los cambios sin publicar de la tienda de «%s» (%s)', v_empresa, private.unir_lista_es(v_areas)),
    p_empresa
  );
end;
$function$;

-- publicar_tienda
CREATE OR REPLACE FUNCTION public.publicar_tienda(p_empresa uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_org uuid := (select private.organizacion_id());
  v_empresa text;
  v_b dominio.tienda_borrador;
  v_cambios jsonb;
  v_cats jsonb;
  v_prods jsonb;
  v_numero integer;
  v_areas text[];
begin
  if v_org is null or (select private.nivel_seccion('empresas')) <> 'edicion' then
    raise exception 'Tu rol no puede publicar la tienda de esta empresa' using errcode = '42501';
  end if;
  select e.nombre into v_empresa from dominio.empresas e where e.id = p_empresa and e.organizacion_id = v_org;
  if v_empresa is null then
    raise exception 'La empresa no existe' using errcode = 'PT404';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('tienda_borrador:' || p_empresa::text, 0));

  select * into v_b from dominio.tienda_borrador where empresa_id = p_empresa;
  if not found then
    return jsonb_build_object('version', null);
  end if;

  v_cambios := private.resumen_cambios_tienda(private.detalle_cambios_tienda(p_empresa, v_b.identidad, v_b.contenido, v_b.catalogo));
  if (v_cambios->>'total')::integer = 0 then
    delete from dominio.tienda_borrador where empresa_id = p_empresa;
    return jsonb_build_object('version', null);
  end if;

  -- Una tienda creada después de la migración no tiene versión 1: se guarda el estado de antes de publicar para
  -- poder volver a él (FR-058).
  if not exists (select 1 from dominio.tienda_versiones v where v.empresa_id = p_empresa) then
    insert into dominio.tienda_versiones (empresa_id, organizacion_id, numero, publicada_at, publicada_por, resumen, cambios, instantanea)
    values (p_empresa, v_org, 1, now(), null, 'Configuración inicial', '[]'::jsonb, private.instantanea_tienda(p_empresa));
  end if;

  if v_b.identidad is not null then
    perform public.guardar_tienda_identidad(
      p_empresa,
      v_b.identidad->>'color_primario', v_b.identidad->>'color_primario_oscuro', v_b.identidad->>'color_acento',
      v_b.identidad->>'color_fondo', v_b.identidad->>'tipografia_titulos', v_b.identidad->>'tipografia_texto',
      v_b.identidad->>'logo_ruta', v_b.identidad->>'banner_ruta', v_b.identidad->>'banner_movil_ruta',
      coalesce(v_b.identidad->>'color_barra', '#222222'),
      coalesce(v_b.identidad->>'estilo_heroe', 'oscuro'),
      coalesce((v_b.identidad->>'titulos_mayusculas')::boolean, true)
    );
  end if;
  if v_b.contenido is not null then
    perform public.guardar_tienda_contenido(
      p_empresa,
      v_b.contenido->>'titulo', v_b.contenido->>'subtitulo', v_b.contenido->>'texto_boton', v_b.contenido->>'boton_destino',
      v_b.contenido->>'bienvenida', v_b.contenido->>'pie', v_b.contenido->>'aviso_ficha', v_b.contenido->>'texto_boton_contacto',
      coalesce(v_b.contenido->>'eslogan', '')
    );
  end if;
  if v_b.catalogo is not null then
    -- Un producto o categoría que desapareció desde que se guardó el borrador se omite (no traba la publicación).
    v_cats := coalesce((
      select jsonb_agg(jsonb_build_object('id', x.id, 'visible', x.visible))
        from jsonb_to_recordset(coalesce(v_b.catalogo->'categorias', '[]'::jsonb)) as x(id uuid, visible boolean)
       where exists (select 1 from dominio.categorias k where k.id = x.id and k.organizacion_id = v_org)
    ), '[]'::jsonb);
    v_prods := coalesce((
      select jsonb_agg(jsonb_build_object('id', x.id, 'visible', x.visible, 'destacado', x.destacado))
        from jsonb_to_recordset(coalesce(v_b.catalogo->'productos', '[]'::jsonb)) as x(id uuid, visible boolean, destacado boolean)
       where exists (
         select 1 from dominio.producto_empresa pe
          where pe.producto_id = x.id and pe.empresa_id = p_empresa and pe.organizacion_id = v_org
       )
    ), '[]'::jsonb);
    perform public.guardar_catalogo_tienda(p_empresa, v_cats, v_prods);
  end if;

  select coalesce(max(v.numero), 0) + 1 into v_numero from dominio.tienda_versiones v where v.empresa_id = p_empresa;
  insert into dominio.tienda_versiones (empresa_id, organizacion_id, numero, publicada_at, publicada_por, resumen, cambios, instantanea)
  values (p_empresa, v_org, v_numero, now(), (select auth.uid()), v_cambios->>'resumen', v_cambios->'detalle', private.instantanea_tienda(p_empresa));

  delete from dominio.tienda_borrador where empresa_id = p_empresa;

  v_areas := array(select e->>'area' from jsonb_array_elements(v_cambios->'detalle') e);
  perform private.insertar_actividad(
    v_org,
    (select auth.uid()),
    'tienda.publicada',
    format('Publicó la versión %s de la tienda de «%s» (%s)', v_numero, v_empresa, private.unir_lista_es(v_areas)),
    p_empresa
  );

  return jsonb_build_object('version', v_numero);
end;
$function$;

-- listar_versiones_tienda
CREATE OR REPLACE FUNCTION public.listar_versiones_tienda(p_empresa uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_org uuid := (select private.organizacion_id());
begin
  if v_org is null or (select private.nivel_seccion('empresas')) not in ('lectura', 'edicion') then
    raise exception 'Tu rol no puede ver las versiones de esta tienda' using errcode = '42501';
  end if;
  if not exists (select 1 from dominio.empresas e where e.id = p_empresa and e.organizacion_id = v_org) then
    raise exception 'La empresa no existe' using errcode = 'PT404';
  end if;

  return coalesce((
    select jsonb_agg(jsonb_build_object(
             'numero', v.numero,
             'publicada_at', v.publicada_at,
             'publicada_por', private.nombre_usuario(v.publicada_por),
             'resumen', v.resumen,
             'vigente', v.numero = (select max(m.numero) from dominio.tienda_versiones m where m.empresa_id = p_empresa)
           ) order by v.numero desc)
      from (
        select t.* from dominio.tienda_versiones t
         where t.empresa_id = p_empresa and t.organizacion_id = v_org
         order by t.numero desc
         limit 100
      ) v
  ), '[]'::jsonb);
end;
$function$;

-- restaurar_version_tienda
CREATE OR REPLACE FUNCTION public.restaurar_version_tienda(p_empresa uuid, p_numero integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_org uuid := (select private.organizacion_id());
  v_empresa text;
  v_vigente integer;
  v_version dominio.tienda_versiones;
  v_identidad jsonb;
  v_contenido jsonb;
  v_catalogo jsonb;
  v_cats jsonb;
  v_prods jsonb;
  v_detalle jsonb;
begin
  if v_org is null or (select private.nivel_seccion('empresas')) <> 'edicion' then
    raise exception 'Tu rol no puede editar la tienda de esta empresa' using errcode = '42501';
  end if;
  select e.nombre into v_empresa from dominio.empresas e where e.id = p_empresa and e.organizacion_id = v_org;
  if v_empresa is null then
    raise exception 'La empresa no existe' using errcode = 'PT404';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('tienda_borrador:' || p_empresa::text, 0));

  select * into v_version from dominio.tienda_versiones v
   where v.empresa_id = p_empresa and v.organizacion_id = v_org and v.numero = p_numero;
  if not found then
    raise exception 'La versión no existe' using errcode = 'PT404';
  end if;
  select max(v.numero) into v_vigente from dominio.tienda_versiones v where v.empresa_id = p_empresa;
  if v_version.numero = v_vigente then
    raise exception 'La versión vigente ya es la que está publicada' using errcode = '22023';
  end if;

  v_identidad := case when jsonb_typeof(v_version.instantanea->'identidad') = 'object' then v_version.instantanea->'identidad' end;
  v_contenido := case when jsonb_typeof(v_version.instantanea->'contenido') = 'object' then v_version.instantanea->'contenido' end;

  -- Categorías: lo de la versión (si todavía existe) + lo vivo que la versión no menciona, vuelto al predeterminado.
  v_cats := coalesce((
    select jsonb_agg(jsonb_build_object('id', x.id, 'visible', x.visible))
      from jsonb_to_recordset(coalesce(v_version.instantanea->'catalogo'->'categorias', '[]'::jsonb)) as x(id uuid, visible boolean)
     where exists (select 1 from dominio.categorias k where k.id = x.id and k.organizacion_id = v_org)
  ), '[]'::jsonb) || coalesce((
    select jsonb_agg(jsonb_build_object('id', ct.categoria_id, 'visible', true))
      from dominio.categorias_tienda ct
     where ct.empresa_id = p_empresa
       and not exists (
         select 1 from jsonb_to_recordset(coalesce(v_version.instantanea->'catalogo'->'categorias', '[]'::jsonb)) as x(id uuid)
          where x.id = ct.categoria_id)
  ), '[]'::jsonb);

  v_prods := coalesce((
    select jsonb_agg(jsonb_build_object('id', x.id, 'visible', x.visible, 'destacado', x.destacado))
      from jsonb_to_recordset(coalesce(v_version.instantanea->'catalogo'->'productos', '[]'::jsonb)) as x(id uuid, visible boolean, destacado boolean)
     where exists (
       select 1 from dominio.producto_empresa pe
        where pe.producto_id = x.id and pe.empresa_id = p_empresa and pe.organizacion_id = v_org
     )
  ), '[]'::jsonb) || coalesce((
    select jsonb_agg(jsonb_build_object('id', pt.producto_id, 'visible', true, 'destacado', false))
      from dominio.productos_tienda pt
     where pt.empresa_id = p_empresa
       and not exists (
         select 1 from jsonb_to_recordset(coalesce(v_version.instantanea->'catalogo'->'productos', '[]'::jsonb)) as x(id uuid)
          where x.id = pt.producto_id)
  ), '[]'::jsonb);

  v_catalogo := jsonb_build_object('categorias', v_cats, 'productos', v_prods);

  -- Las áreas que no difieren de lo publicado se descartan; sin áreas, el borrador queda vacío (se reemplaza).
  v_detalle := private.detalle_cambios_tienda(p_empresa, v_identidad, v_contenido, v_catalogo);
  if not exists (select 1 from jsonb_array_elements(v_detalle) e where e->>'area' = 'identidad') then v_identidad := null; end if;
  if not exists (select 1 from jsonb_array_elements(v_detalle) e where e->>'area' = 'contenido') then v_contenido := null; end if;
  if not exists (select 1 from jsonb_array_elements(v_detalle) e where e->>'area' = 'catalogo') then v_catalogo := null; end if;

  if v_identidad is null and v_contenido is null and v_catalogo is null then
    delete from dominio.tienda_borrador where empresa_id = p_empresa;
  else
    insert into dominio.tienda_borrador as b (empresa_id, organizacion_id, identidad, contenido, catalogo, updated_by, updated_at)
    values (p_empresa, v_org, v_identidad, v_contenido, v_catalogo, (select auth.uid()), now())
    on conflict (empresa_id) do update set
      identidad = excluded.identidad,
      contenido = excluded.contenido,
      catalogo = excluded.catalogo,
      updated_by = excluded.updated_by,
      updated_at = excluded.updated_at;
  end if;

  perform private.insertar_actividad(
    v_org,
    (select auth.uid()),
    'tienda.version_restaurada',
    format('Restauró la versión %s de la tienda de «%s» como borrador', p_numero, v_empresa),
    p_empresa
  );

  return jsonb_build_object('numero', p_numero, 'hay_borrador', jsonb_array_length(v_detalle) > 0);
end;
$function$;

-- vista_previa_tienda
CREATE OR REPLACE FUNCTION public.vista_previa_tienda(p_empresa uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  c_tope constant integer := 8;
  v_org uuid := (select private.organizacion_id());
  v_nombre text;
  v_activa boolean;
  v_b dominio.tienda_borrador;
begin
  if v_org is null or (select private.nivel_seccion('empresas')) <> 'edicion' then
    raise exception 'Tu rol no puede ver la vista previa de esta tienda' using errcode = '42501';
  end if;
  select e.nombre, e.activa into v_nombre, v_activa from dominio.empresas e where e.id = p_empresa and e.organizacion_id = v_org;
  if not found then
    raise exception 'La empresa no existe' using errcode = 'PT404';
  end if;

  select * into v_b from dominio.tienda_borrador where empresa_id = p_empresa;

  return (
    with recursive efectivos as materialized (
      select x.producto_id, x.nombre, x.categoria_id, x.destacado
        from private.catalogo_tienda_efectivo_borrador(p_empresa, v_b.catalogo) x
       where x.efectivo
    ),
    conteo as materialized (
      select e.categoria_id, count(*) as n from efectivos e where e.categoria_id is not null group by e.categoria_id
    ),
    elegidos as (
      select f.* from efectivos f where f.destacado order by lower(f.nombre), f.producto_id limit c_tope
    ),
    bc as (
      select x.id, x.visible
        from jsonb_to_recordset(coalesce(v_b.catalogo->'categorias', '[]'::jsonb)) as x(id uuid, visible boolean)
    ),
    cat as (
      select c.id, c.nombre, c.padre_id, c.posicion
        from dominio.categorias c
        left join dominio.categorias_tienda ct on ct.empresa_id = p_empresa and ct.categoria_id = c.id
        left join dominio.categorias_tienda cp on cp.empresa_id = p_empresa and cp.categoria_id = c.padre_id
        left join bc bcc on bcc.id = c.id
        left join bc bcp on bcp.id = c.padre_id
       where c.organizacion_id = v_org
         and coalesce(bcc.visible, ct.visible, true)
         and coalesce(bcp.visible, cp.visible, true)
    ),
    -- MSF-846: la foto de cada categoría sale como en publico.categorias_por_dominio (20270303400000): la
    -- imagen principal de un producto efectivo de la categoría o de sus subcategorías, en una sola pasada.
    arbol(raiz, id, nivel) as (
      select c.id, c.id, 0 from cat c
      union all
      select a.raiz, c.id, a.nivel + 1 from arbol a join cat c on c.padre_id = a.id where a.nivel < 10
    ),
    total as (
      select a.raiz as id, sum(k.n) as n
        from arbol a join conteo k on k.categoria_id = a.id
       group by a.raiz
    ),
    img_producto as materialized (
      select distinct on (pi.producto_id) pi.producto_id, pi.ruta
        from efectivos e
        join dominio.producto_imagenes pi on pi.producto_id = e.producto_id
       order by pi.producto_id, pi.posicion
    ),
    imagen as materialized (
      select distinct on (a.raiz) a.raiz as id, ip.ruta
        from arbol a
        join efectivos e on e.categoria_id = a.id
        join img_producto ip on ip.producto_id = e.producto_id
       order by a.raiz, lower(e.nombre), e.producto_id
    )
    select jsonb_build_object(
      'empresa_nombre', v_nombre,
      'en_linea', v_activa,
      'identidad', coalesce(v_b.identidad, private.identidad_vivo(p_empresa)),
      'contenido', coalesce(v_b.contenido, private.contenido_vivo(p_empresa)),
      'hay_productos', exists (select 1 from efectivos),
      'categorias', coalesce((
        select jsonb_agg(jsonb_build_object(
                 'id', c.id,
                 'nombre', c.nombre,
                 'padre_id', c.padre_id,
                 'productos', tt.n,
                 'imagen', im.ruta
               ) order by (c.padre_id is not null), c.posicion, c.id)
          from cat c
          join total tt on tt.id = c.id
          left join imagen im on im.id = c.id), '[]'::jsonb),
      'destacados', coalesce((
        select jsonb_agg(jsonb_build_object(
                 'id', g.producto_id,
                 'nombre', g.nombre,
                 'precio', private.precio_final_publico(g.producto_id, p_empresa),
                 'disponible', private.disponible_publico(g.producto_id),
                 'imagen', (select i.ruta from dominio.producto_imagenes i
                             where i.producto_id = g.producto_id order by i.posicion limit 1),
                 'categoria_id', g.categoria_id
               ) order by lower(g.nombre), g.producto_id)
          from elegidos g), '[]'::jsonb)
    )
  );
end;
$function$;

-- rutas_tienda_sin_referencia
CREATE OR REPLACE FUNCTION public.rutas_tienda_sin_referencia(p_empresa uuid, p_rutas text[])
 RETURNS text[]
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_org uuid := (select private.organizacion_id());
  v_prefijo text;
begin
  if v_org is null or (select private.nivel_seccion('empresas')) <> 'edicion' then
    raise exception 'Tu rol no puede editar la tienda de esta empresa' using errcode = '42501';
  end if;
  if not exists (select 1 from dominio.empresas e where e.id = p_empresa and e.organizacion_id = v_org) then
    raise exception 'La empresa no existe' using errcode = 'PT404';
  end if;
  v_prefijo := v_org::text || '/' || p_empresa::text || '/';

  return coalesce((
    select array_agg(distinct r)
      from unnest(coalesce(p_rutas, '{}'::text[])) as r
     where r is not null
       and left(r, length(v_prefijo)) = v_prefijo
       and not private.ruta_identidad_referenciada(r)
  ), '{}'::text[]);
end;
$function$;

-- revocar_clave_api
CREATE OR REPLACE FUNCTION public.revocar_clave_api(p_clave_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_organizacion_id uuid := (select private.organizacion_id());
begin
  if v_organizacion_id is null or not (select private.puede_escribir()) then
    raise exception 'Solo un administrador puede revocar claves de API' using errcode = '42501';
  end if;

  update public.api_claves
     set revocada_en = coalesce(revocada_en, now())
   where public.api_claves.id = p_clave_id
     and organizacion_id = v_organizacion_id;

  if not found then
    raise exception 'La clave no existe' using errcode = 'PT404';
  end if;
end;
$function$;

-- rotar_clave_api
CREATE OR REPLACE FUNCTION public.rotar_clave_api(p_clave_id uuid)
 RETURNS TABLE(id uuid, valor text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_clave public.api_claves;
  v_organizacion_id uuid := (select private.organizacion_id());
  v_prefijo text;
  v_token text;
  v_id uuid;
begin
  if v_organizacion_id is null or not (select private.puede_escribir()) then
    raise exception 'Solo un administrador puede rotar claves de API' using errcode = '42501';
  end if;

  -- `public.api_claves.id` va cualificado: el parámetro de salida de la RPC
  -- también se llama `id` y, sin calificar, la referencia sería ambigua.
  select * into v_clave from public.api_claves where public.api_claves.id = p_clave_id;
  if not found then
    raise exception 'La clave no existe' using errcode = 'PT404';
  end if;

  if v_clave.organizacion_id <> v_organizacion_id then
    raise exception 'La clave pertenece a otra organización' using errcode = '42501';
  end if;

  if v_clave.revocada_en is not null then
    raise exception 'La clave está revocada' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('api_claves:' || v_organizacion_id::text, 0));
  if (select count(*) from public.api_claves k
       where k.organizacion_id = v_organizacion_id
         and k.revocada_en is null
         and (k.vence_en is null or k.vence_en > now())) >= 100 then
    raise exception 'La organización tiene demasiadas claves vigentes: revocá las que no uses antes de rotar'
      using errcode = '54000';
  end if;

  -- La gracia de 24 h (D-3) se otorga UNA sola vez y nunca revive una clave
  -- vencida: rotar dos veces la misma clave no extiende la ventana, y rotar
  -- una clave ya vencida entrega la nueva sin resucitar la vieja.
  if (v_clave.vence_en is null or v_clave.vence_en > now()) and v_clave.rotada_en is null then
    -- La gracia nunca alarga la vida de la clave anterior: vence en 24 h o en su
    -- vencimiento original, lo que ocurra primero.
    update public.api_claves
       set vence_en = least(coalesce(public.api_claves.vence_en, 'infinity'::timestamptz), now() + interval '24 hours'),
           rotada_en = now()
     where public.api_claves.id = p_clave_id;
  end if;

  v_prefijo := (select private.api_prefijo_aleatorio());
  v_token := 'msf_' || v_prefijo || '_' || (select private.api_secreto_aleatorio());

  -- La clave nueva hereda el vencimiento de la original si todavía está en el
  -- futuro; si la original ya había vencido, nace sin vencimiento (rotar una
  -- clave vencida es la forma de renovarla).
  insert into public.api_claves (organizacion_id, nombre, prefijo, hash, alcances, limite_por_minuto, vence_en, creada_por)
  values (v_clave.organizacion_id, v_clave.nombre, v_prefijo, extensions.digest(v_token, 'sha256'),
    v_clave.alcances, v_clave.limite_por_minuto,
    case when v_clave.vence_en > now() then v_clave.vence_en end, (select auth.uid()))
  returning api_claves.id into v_id;

  return query select v_id, v_token;
end;
$function$;

-- actualizar_suscripcion_api
CREATE OR REPLACE FUNCTION public.actualizar_suscripcion_api(p_id uuid, p_activa boolean)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_organizacion_id uuid := (select private.organizacion_id());
begin
  if v_organizacion_id is null or not (select private.puede_escribir()) then
    raise exception 'Solo un administrador puede modificar suscripciones a avisos' using errcode = '42501';
  end if;

  update public.api_suscripciones
     set activa = coalesce(p_activa, false), actualizada_en = now()
   where public.api_suscripciones.id = p_id
     and organizacion_id = v_organizacion_id;

  if not found then
    raise exception 'La suscripción no existe' using errcode = 'PT404';
  end if;
end;
$function$;

-- eliminar_suscripcion_api
CREATE OR REPLACE FUNCTION public.eliminar_suscripcion_api(p_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_organizacion_id uuid := (select private.organizacion_id());
begin
  if v_organizacion_id is null or not (select private.puede_escribir()) then
    raise exception 'Solo un administrador puede eliminar suscripciones a avisos' using errcode = '42501';
  end if;

  -- El trigger api_suscripciones_borrar_secreto borra el secreto de Vault junto con la fila.
  delete from public.api_suscripciones
   where public.api_suscripciones.id = p_id
     and organizacion_id = v_organizacion_id;

  if not found then
    raise exception 'La suscripción no existe' using errcode = 'PT404';
  end if;
end;
$function$;

-- rotar_secreto_suscripcion_api
CREATE OR REPLACE FUNCTION public.rotar_secreto_suscripcion_api(p_id uuid)
 RETURNS TABLE(id uuid, secreto text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_organizacion_id uuid := (select private.organizacion_id());
  v_suscripcion public.api_suscripciones;
  v_secreto text;
  v_vault_nuevo uuid;
begin
  if v_organizacion_id is null or not (select private.puede_escribir()) then
    raise exception 'Solo un administrador puede rotar el secreto de una suscripción' using errcode = '42501';
  end if;

  -- `for update`: dos rotaciones simultáneas de la misma suscripción se serializan.
  select * into v_suscripcion
    from public.api_suscripciones s
   where s.id = p_id and s.organizacion_id = v_organizacion_id
   for update;
  if not found then
    raise exception 'La suscripción no existe' using errcode = 'PT404';
  end if;

  v_secreto := encode(extensions.gen_random_bytes(32), 'hex');
  v_vault_nuevo := vault.create_secret(v_secreto);

  -- Si ya había un secreto anterior en gracia, este rotación lo REEMPLAZA: el de antes deja de valer ya.
  update public.api_suscripciones s
     set secreto_anterior_vault_id = v_suscripcion.secreto_vault_id,
         secreto_anterior_vence_en = now() + interval '24 hours',
         secreto_vault_id = v_vault_nuevo,
         actualizada_en = now()
   where s.id = p_id;

  if v_suscripcion.secreto_anterior_vault_id is not null then
    delete from vault.secrets where vault.secrets.id = v_suscripcion.secreto_anterior_vault_id;
  end if;

  return query select p_id, v_secreto;
end;
$function$;

-- listar_documentos_comprobante
CREATE OR REPLACE FUNCTION public.listar_documentos_comprobante(p_comprobante_id uuid)
 RETURNS SETOF dominio.comprobante_documentos
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
    raise exception 'El comprobante no existe' using errcode = 'PT404';
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
$function$;

-- obtener_documento_comprobante
CREATE OR REPLACE FUNCTION public.obtener_documento_comprobante(p_documento_id uuid)
 RETURNS dominio.comprobante_documentos
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_org uuid := (select private.organizacion_id());
  v_doc dominio.comprobante_documentos;
begin
  if v_org is null or (select auth.uid()) is null then
    raise exception 'Necesitás una sesión con organización para ver documentos' using errcode = '42501';
  end if;
  select * into v_doc from dominio.comprobante_documentos d where d.id = p_documento_id and d.organizacion_id = v_org;
  if not found then
    raise exception 'El documento no existe' using errcode = 'PT404';
  end if;
  if (select private.nivel_ventas_en_empresa(v_doc.empresa_id)) not in ('lectura', 'edicion') then
    raise exception 'Tu rol no puede ver documentos de esta tienda' using errcode = '42501';
  end if;
  perform private.expirar_documento_pendiente(v_doc.id);
  select * into v_doc from dominio.comprobante_documentos d where d.id = p_documento_id;
  return v_doc;
end;
$function$;

-- ultimas_impresiones_comprobante
CREATE OR REPLACE FUNCTION public.ultimas_impresiones_comprobante(p_comprobante_id uuid)
 RETURNS SETOF dominio.comprobante_impresiones
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_org uuid := (select private.organizacion_id());
  v_c dominio.comprobantes_venta;
begin
  if v_org is null or (select auth.uid()) is null then
    raise exception 'Necesitás una sesión con organización para ver impresiones' using errcode = '42501';
  end if;
  select * into v_c from dominio.comprobantes_venta c where c.id = p_comprobante_id and c.organizacion_id = v_org;
  if not found or v_c.empresa_id is null then
    raise exception 'El comprobante no existe' using errcode = 'PT404';
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
$function$;

-- solicitar_documento_comprobante
CREATE OR REPLACE FUNCTION public.solicitar_documento_comprobante(p_comprobante_id uuid, p_tipo_documento text)
 RETURNS dominio.comprobante_documentos
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
    raise exception 'El comprobante no existe' using errcode = 'PT404';
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
    -- Una factura se imprime mientras esté viva: confirmada y todos los estados que le siguen (cobro, armado,
    -- despacho). Quedan fuera el borrador y la anulada. Es el mismo conjunto con el que
    -- despachan, registran faltantes y guardan el envío (20270202202100 y 20270202202101).
    if v_c.estado not in ('confirmada', 'aceptado', 'en_proceso', 'armando', 'incompleto', 'cobrado', 'deuda') then
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
$function$;

-- enviar_presupuesto_correo
CREATE OR REPLACE FUNCTION public.enviar_presupuesto_correo(p_comprobante_id uuid)
 RETURNS dominio.comprobante_envios_correo
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
    raise exception 'El presupuesto no existe' using errcode = 'PT404';
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
  from dominio.clientes cl where cl.id = v_c.cliente_id and cl.organizacion_id = v_org;
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
$function$;

-- listar_envios_correo_presupuesto
CREATE OR REPLACE FUNCTION public.listar_envios_correo_presupuesto(p_comprobante_id uuid)
 RETURNS SETOF dominio.comprobante_envios_correo
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
    raise exception 'El presupuesto no existe' using errcode = 'PT404';
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
$function$;

-- obtener_importacion_productos
CREATE OR REPLACE FUNCTION public.obtener_importacion_productos(p_importacion_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_org uuid := (select private.organizacion_id());
  v_imp dominio.importaciones_productos;
begin
  if v_org is null or (select auth.uid()) is null or not (select private.es_administrador_de(v_org)) then
    raise exception 'NO_AUTORIZADO: solo el Administrador importa productos' using errcode = '42501';
  end if;

  select * into v_imp from dominio.importaciones_productos i
   where i.id = p_importacion_id and i.organizacion_id = v_org;
  if not found then
    raise exception 'La importación no existe' using errcode = 'PT404';
  end if;

  if v_imp.estado in ('en_cola', 'aplicando') then
    perform private.despachar_importacion_siguiente(v_org);
    select * into v_imp from dominio.importaciones_productos where id = p_importacion_id;
  end if;

  return jsonb_build_object(
    'estado', v_imp.estado,
    'total_filas', v_imp.total_filas,
    'importables', v_imp.importables,
    'procesadas', (select count(*) from dominio.importaciones_productos_filas f
                    where f.importacion_id = v_imp.id and f.resultado = 'aplicada'),
    'omitidas', (select count(*) from dominio.importaciones_productos_filas f
                  where f.importacion_id = v_imp.id and f.resultado = 'omitida'),
    -- Omitidas por un error temporal repetido (se pueden volver a importar), distintas de las omitidas por datos.
    'omitidas_temporales', (select count(*) from dominio.importaciones_productos_filas f
                             where f.importacion_id = v_imp.id and f.resultado = 'omitida'
                               and f.motivo_codigo = 'ERROR_TEMPORAL'),
    -- Productos aplicados cuyas imágenes no llegaron a adjuntarse (también en una importación cerrada como fallida).
    'sin_imagenes', (select count(*) from dominio.importaciones_productos_filas f
                      where f.importacion_id = v_imp.id and f.resultado = 'aplicada' and f.imagenes_pendientes),
    'ejecucion_id', v_imp.ejecucion_id,
    'mensaje_fallo', v_imp.mensaje_fallo,
    'errores', coalesce((
      select jsonb_agg(jsonb_build_object('fila', f.fila, 'sku', f.sku, 'mensaje', f.resultado_mensaje, 'codigo', f.motivo_codigo) order by f.fila)
        from dominio.importaciones_productos_filas f
       where f.importacion_id = v_imp.id and f.resultado = 'omitida'
    ), '[]'::jsonb)
  );
end;
$function$;

-- vista_previa_fusion_clientes
CREATE OR REPLACE FUNCTION public.vista_previa_fusion_clientes(p_conservar_id uuid, p_descartar_id uuid)
 RETURNS TABLE(cliente_id uuid, numero integer, nombre text, documentos bigint, cuentas_web_activas bigint, cuentas_web_total bigint, lista_precio_id uuid, lista_nombre text)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_org uuid := (select private.organizacion_id());
begin
  if v_org is null or not (select private.es_administrador_de(v_org)) then
    raise exception 'Solo el Administrador puede fusionar clientes' using errcode = '42501';
  end if;
  if p_conservar_id is null or p_descartar_id is null then
    raise exception 'Elegí los dos clientes a fusionar' using errcode = '22023';
  end if;
  if p_conservar_id = p_descartar_id then
    raise exception 'No se puede fusionar un cliente consigo mismo' using errcode = '22023';
  end if;
  if (select count(*) from dominio.clientes c
       where c.id in (p_conservar_id, p_descartar_id) and c.organizacion_id = v_org) <> 2 then
    raise exception 'Alguno de los clientes no existe' using errcode = 'PT404';
  end if;
  if exists (select 1 from dominio.clientes c
              where c.id in (p_conservar_id, p_descartar_id) and c.archivado_en is not null) then
    raise exception 'Alguno de los clientes ya está archivado' using errcode = '22023';
  end if;

  return query
  select c.id, c.numero, c.nombre,
         (select count(*) from dominio.comprobantes_venta cv
           where cv.cliente_id = c.id and cv.organizacion_id = v_org),
         (select count(*) from public.cuentas_cliente cc
           where cc.cliente_id = c.id and cc.estado = 'activa'),
         (select count(*) from public.cuentas_cliente cc where cc.cliente_id = c.id),
         c.lista_precio_id,
         (select l.nombre from dominio.listas_precios l where l.id = c.lista_precio_id)
    from dominio.clientes c
   where c.id in (p_conservar_id, p_descartar_id) and c.organizacion_id = v_org
   order by (c.id = p_conservar_id) desc;
end;
$function$;

comment on function public.obtener_importacion_productos(uuid) is
  'F-CAT-10 (FR-110/111): estado (en_cola, aplicando, terminada, fallida), contadores y filas omitidas con su motivo. Solo Administrador de la organización de la sesión; PT404 si no existe.';
