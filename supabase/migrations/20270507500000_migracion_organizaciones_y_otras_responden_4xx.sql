-- Lote 78 (MSF-599, MSF-654 y MSF-655, decimoquinta ola de la convención de códigos de negocio mapeados a 4xx): diecisiete RPC de las
-- cargas de migración y lotes de importación, la vinculación de identificadores externos, el aprovisionamiento de servidores y el
-- acceso de soporte a organizaciones, cuentas web y tiendas de clientes, depósitos de repuestos, umbral de margen, exportación de
-- proveedores, moderación de opiniones, asignaciones de empresas a usuarios y detalle de campañas de correo dejan de contestar HTTP 500
-- cuando rechazan por «no existe» (`P0002`, pasa a `PT404`, HTTP 404) o por conflicto de edición (`40001`, pasa a `PT412`, HTTP 412),
-- con el mismo mensaje de siempre. Qué código emite cada función: ver la fila 15 de la tabla de docs/errores-negocio-postgrest.md.
--
-- Funciones: cerrar_carga_migracion, aplicar_lote_archivo_ingresos, aplicar_lote_clientes, aplicar_lote_proveedores,
-- aplicar_lote_vinculos_proveedor_producto, informe_conciliacion_migracion, vincular_identificador_externo,
-- aprovisionar_servidor_organizacion, entrar_a_organizacion (la de dos argumentos), cambiar_estado_cuenta_cliente,
-- depositos_para_repuesto, guardar_empresas_de_cliente, guardar_umbral_margen_bajo, exportar_proveedores, moderar_opinion,
-- asignar_empresas_usuario y detalle_campana_correo.
--
-- Cada función parte de su definición VIGENTE (la última migración que la define) y solo cambia el errcode: mensajes, cuerpo, firma,
-- `security definer` o `invoker`, `search_path` y grants son los mismos (`create or replace` conserva privilegios; no hay drop, grant
-- ni revoke). Barrido 20270418000401: la definición vigente de `guardar_empresas_de_cliente` (20261018090000) nombra `public.clientes`,
-- que el barrido reescribió en la base como `dominio.clientes`; esta migración parte de esa versión ya barrida (`dominio.clientes`), no
-- de la letra de 20261018090000. Las demás no nombran la tabla. Los comentarios de `guardar_umbral_margen_bajo`, `moderar_opinion` y
-- `exportar_proveedores` nombraban el código viejo y se actualizan.
--
-- Ninguna la consume Kestra, un worker o una Edge Function por código: solo la web (el script de datos de demostración llama a algunas,
-- sin leer el código de error), que acepta el código viejo y el nuevo (`P0002` o `PT404`, `esCodigoDeConflicto`) porque la migración y el
-- despliegue no son simultáneos. `moderar_opinion` conserva el `55000` de bandera apagada.
--
-- Quedan con el código anterior a propósito (detalle en «Queda para próximas olas» de la documentación):
--   (a) las invitaciones (`aceptar_invitacion`, `cancelar_invitacion`, `vincular_invitacion`, `guardar_asignaciones_invitacion`) y las
--       cuentas web de clientes (`vincular_cuenta_cliente`, `cuentas_web_de_cliente`): las consume una Edge Function por código;
--   (b) `iniciar_verificacion_restauracion` (`P0002` y `55006` de respaldos que consume Kestra), el flujo de avisos al cliente y la
--       consulta pública (`avisar_cliente_reparacion`, `avisar_cliente_whatsapp`, `avisos_de_reparacion`, `obtener_enlace_consulta`,
--       `regenerar_enlace_consulta`), los ítems y adjuntos de reparaciones y el newsletter con auxiliares de `private`;
--   (c) `aplicar_actualizacion_precios`, `previsualizar_actualizacion_precios`, `guardar_lista_precios`, `asignar_lista_precios_cliente`,
--       `guardar_promocion_precio`, `guardar_newsletter*`, `enviar_newsletter`, `solicitar_prueba_newsletter`, `moderar_opinion` (solo su
--       `55000`), `preparar_verificacion_tienda` y `registrar_verificacion_dns`: `55000` de bandera apagada o contrato por `detail`;
--   (d) `facturar_presupuesto` y `confirmar_comprobante` (hint `precios_cambiaron`), `reintentar_entrega_api`, `guardar_catalogo_tienda`,
--       `guardar_tienda_identidad`, `marcar_conexion_oauth_invalida`, `proveedores_efectivos_de_cliente`,
--       `elegir_proveedor_capacidad_cliente` y las del esquema `publico`.
--
-- Migración aditiva (create or replace).
--
-- Reversión: volver a aplicar, en una migración nueva, la definición vigente anterior de cada función (en el cuerpo, `PT404` vuelve a
-- `P0002` y `PT412` a `40001`, solo en las líneas que esta migración cambia; en `guardar_empresas_de_cliente`, la tabla sigue siendo
-- `dominio.clientes`) y restaurar los comentarios previos de `guardar_umbral_margen_bajo` (20261130100000), `moderar_opinion`
-- (20270341000200) y `exportar_proveedores` (20270507400000). Definiciones vigentes anteriores (la última migración que cada función
-- define; las migraciones ya aplicadas no se editan):
--   cerrar_carga_migracion: 20261201100000; aplicar_lote_archivo_ingresos: 20261201120000; aplicar_lote_clientes: 20270507180300;
--   aplicar_lote_proveedores y aplicar_lote_vinculos_proveedor_producto: 20261201110000; informe_conciliacion_migracion y
--   vincular_identificador_externo: 20270507180300; aprovisionar_servidor_organizacion: 20260923120000;
--   entrar_a_organizacion(uuid, text): 20270217900002; cambiar_estado_cuenta_cliente: 20261211100100;
--   depositos_para_repuesto: 20270201200108; guardar_empresas_de_cliente: 20261018090000;
--   guardar_umbral_margen_bajo: 20261130100000; exportar_proveedores: 20270507400000; moderar_opinion: 20270341000200;
--   asignar_empresas_usuario: 20261016160100; detalle_campana_correo: 20270420000500.

-- cerrar_carga_migracion
create or replace function public.cerrar_carga_migracion(p_carga uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid := (select private.organizacion_id());
  v_carga public.migracion_cargas;
  v_nuevos integer;
  v_actualizados integer;
  v_errores integer;
  v_estado text;
  v_error text;
begin
  if v_org is null or not (select private.puede_escribir()) then
    raise exception 'Solo un administrador puede migrar datos' using errcode = '42501';
  end if;

  select * into v_carga
    from public.migracion_cargas c
   where c.id = p_carga and c.organizacion_id = v_org
     for update;
  if not found then
    raise exception 'La carga no existe en tu organización' using errcode = 'PT404';
  end if;

  select count(*) filter (where f.estado = 'nueva'),
         count(*) filter (where f.estado = 'actualizada'),
         count(*) filter (where f.estado = 'error')
    into v_nuevos, v_actualizados, v_errores
    from public.migracion_filas f
   where f.carga_id = p_carga;

  if v_nuevos + v_actualizados + v_errores <> v_carga.filas_total then
    v_estado := 'fallida';
    v_error := format(
      'Se registraron %s de %s filas: reintentá para completar lo pendiente',
      v_nuevos + v_actualizados + v_errores, v_carga.filas_total
    );
  else
    v_estado := 'aplicada';
  end if;

  update public.migracion_cargas c
     set estado = v_estado,
         nuevos = v_nuevos,
         actualizados = v_actualizados,
         con_error = v_errores,
         error = v_error,
         cerrada_en = case when v_estado = 'aplicada' then now() else null end
   where c.id = p_carga;

  return jsonb_build_object(
    'carga', p_carga,
    'entidad', v_carga.entidad,
    'archivo', v_carga.archivo,
    'estado', v_estado,
    'error', v_error,
    'filas_total', v_carga.filas_total,
    'nuevos', v_nuevos,
    'actualizados', v_actualizados,
    'con_error', v_errores,
    'errores', coalesce((
      select jsonb_agg(jsonb_build_object('fila', x.fila, 'motivo', x.motivo) order by x.fila)
        from (
          select f.fila, f.motivo
            from public.migracion_filas f
           where f.carga_id = p_carga and f.estado = 'error'
           order by f.fila
           limit 200
        ) as x
    ), '[]'::jsonb)
  );
end;
$$;

-- aplicar_lote_archivo_ingresos
create or replace function public.aplicar_lote_archivo_ingresos(
  p_carga uuid,
  p_lote integer,
  p_filas jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid := (select private.organizacion_id());
  v_carga public.migracion_cargas;
  v_fila jsonb;
  v_num integer;
  v_ext text;
  v_estado text;
  v_motivo text;
  v_resultado text;
  v_nuevos integer := 0;
  v_actualizados integer := 0;
  v_omitidos integer := 0;
  v_errores jsonb := '[]'::jsonb;
begin
  if v_org is null or not (select private.puede_escribir()) then
    raise exception 'Solo un administrador puede migrar datos' using errcode = '42501';
  end if;
  if p_lote is null or p_lote < 0 then
    raise exception 'El número de lote no es válido' using errcode = '22023';
  end if;
  if p_filas is null or jsonb_typeof(p_filas) <> 'array' then
    raise exception 'Las filas deben ser una lista' using errcode = '22023';
  end if;
  if jsonb_array_length(p_filas) > 500 then
    raise exception 'Un lote admite hasta 500 filas' using errcode = '54000';
  end if;

  select * into v_carga
    from public.migracion_cargas c
   where c.id = p_carga and c.organizacion_id = v_org
     for update;
  if not found then
    raise exception 'La carga no existe en tu organización' using errcode = 'PT404';
  end if;
  if v_carga.entidad <> 'ingresos_archivo' then
    raise exception 'La carga no es del archivo de ingresos' using errcode = '22023';
  end if;

  for v_fila in select e.value from jsonb_array_elements(p_filas) as e (value) loop
    if jsonb_typeof(v_fila -> 'fila') is distinct from 'number' or (v_fila ->> 'fila') !~ '^[1-9]\d{0,8}$' then
      raise exception 'Cada fila debe traer su número de fila (entero positivo)' using errcode = '22023';
    end if;
    v_num := (v_fila ->> 'fila')::integer;
    v_ext := nullif(btrim(v_fila ->> 'id_externo'), '');
    v_resultado := null;
    v_motivo := null;

    if exists (
      select 1 from public.migracion_filas f
       where f.carga_id = p_carga and f.fila = v_num and f.estado in ('nueva', 'actualizada')
    ) then
      v_omitidos := v_omitidos + 1;
      continue;
    end if;

    select k.o_estado, k.o_motivo into v_estado, v_motivo
      from private.clasificar_fila_archivo_ingreso(v_org, v_fila) as k;

    -- Mismo identificador dos veces en el archivo: gana la primera fila aplicada (FR-004).
    if v_estado <> 'error' and v_ext is not null and exists (
      select 1 from public.migracion_filas f
       where f.carga_id = p_carga and f.fila < v_num
         and f.identificador_externo = left(v_ext, 200)
         and f.estado in ('nueva', 'actualizada')
    ) then
      v_estado := 'error';
      v_motivo := 'El identificador está repetido en el archivo';
    end if;

    if v_estado <> 'error' then
      insert into dominio.archivo_ingresos_mercaderia (
        organizacion_id, id_externo, fecha, producto, cantidad, proveedor, operador, carga_id
      ) values (
        v_org, v_ext, private.fecha_archivo_ingreso(v_fila ->> 'fecha'), btrim(v_fila ->> 'producto'),
        (btrim(v_fila ->> 'cantidad'))::integer, nullif(btrim(v_fila ->> 'proveedor'), ''),
        nullif(btrim(v_fila ->> 'operador'), ''), p_carga
      )
      on conflict (organizacion_id, id_externo) do update
        set fecha = excluded.fecha,
            producto = excluded.producto,
            cantidad = excluded.cantidad,
            -- Reimportar no borra: un proveedor/operador vacío en el archivo conserva el valor previo.
            proveedor = coalesce(excluded.proveedor, dominio.archivo_ingresos_mercaderia.proveedor),
            operador = coalesce(excluded.operador, dominio.archivo_ingresos_mercaderia.operador),
            carga_id = excluded.carga_id;
      v_resultado := v_estado;
    end if;

    if v_resultado = 'nueva' then
      v_nuevos := v_nuevos + 1;
    elsif v_resultado = 'actualizada' then
      v_actualizados := v_actualizados + 1;
    else
      v_errores := v_errores || jsonb_build_object('fila', v_num, 'motivo', v_motivo);
    end if;

    insert into public.migracion_filas (carga_id, lote, fila, estado, identificador_externo, motivo)
    values (p_carga, p_lote, v_num, coalesce(v_resultado, 'error'), left(v_ext, 200), left(v_motivo, 300))
    on conflict (carga_id, fila) do update
      set lote = excluded.lote,
          estado = excluded.estado,
          identificador_externo = excluded.identificador_externo,
          motivo = excluded.motivo;
  end loop;

  return jsonb_build_object(
    'nuevos', v_nuevos,
    'actualizados', v_actualizados,
    'omitidos', v_omitidos,
    'errores', v_errores
  );
end;
$$;

-- aplicar_lote_clientes
CREATE OR REPLACE FUNCTION public.aplicar_lote_clientes(p_carga uuid, p_lote integer, p_filas jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_org uuid := (select private.organizacion_id());
  v_carga public.migracion_cargas;
  v_fila jsonb;
  v_num integer;
  v_ext text;
  v_estado text;
  v_cliente uuid;
  v_acepta boolean;
  v_motivo text;
  v_resultado text;
  v_nuevos integer := 0;
  v_actualizados integer := 0;
  v_omitidos integer := 0;
  v_errores jsonb := '[]'::jsonb;
begin
  if v_org is null or not (select private.puede_escribir()) then
    raise exception 'Solo un administrador puede migrar datos' using errcode = '42501';
  end if;
  if p_lote is null or p_lote < 0 then
    raise exception 'El número de lote no es válido' using errcode = '22023';
  end if;
  if p_filas is null or jsonb_typeof(p_filas) <> 'array' then
    raise exception 'Las filas deben ser una lista' using errcode = '22023';
  end if;
  if jsonb_array_length(p_filas) > 500 then
    raise exception 'Un lote admite hasta 500 filas' using errcode = '54000';
  end if;

  -- Bloquea la carga: serializa lotes concurrentes de la misma carga.
  select * into v_carga
    from public.migracion_cargas c
   where c.id = p_carga and c.organizacion_id = v_org
     for update;
  if not found then
    raise exception 'La carga no existe en tu organización' using errcode = 'PT404';
  end if;
  if v_carga.entidad <> 'clientes' then
    raise exception 'La carga no es de clientes' using errcode = '22023';
  end if;

  for v_fila in select e.value from jsonb_array_elements(p_filas) as e (value) loop
    if jsonb_typeof(v_fila -> 'fila') is distinct from 'number' then
      raise exception 'Cada fila debe traer su número de fila' using errcode = '22023';
    end if;
    v_num := (v_fila ->> 'fila')::integer;
    v_ext := nullif(btrim(v_fila ->> 'id_externo'), '');
    v_resultado := null;
    v_motivo := null;
    v_acepta := private.parsear_acepta_correo(v_fila ->> 'acepta_correo');

    -- Ya aplicada en un intento anterior de esta carga: no se repite.
    if exists (
      select 1 from public.migracion_filas f
       where f.carga_id = p_carga and f.fila = v_num and f.estado in ('nueva', 'actualizada')
    ) then
      v_omitidos := v_omitidos + 1;
      continue;
    end if;

    begin
      select k.o_estado, k.o_cliente, k.o_motivo
        into v_estado, v_cliente, v_motivo
        from private.clasificar_fila_cliente(v_org, v_fila) as k;

      -- El mismo identificador DOS VECES EN EL ARCHIVO (en cualquier lote): la primera fila
      -- aplicada gana (FR-004). Se compara contra las filas de ESTA carga ya aplicadas
      -- (migracion_filas), no contra datos previos: reimportar un identificador de otra carga
      -- sigue siendo un upsert (FR-005).
      if v_estado <> 'error' and v_ext is not null and exists (
        select 1 from public.migracion_filas f
         where f.carga_id = p_carga and f.fila <> v_num
           and f.identificador_externo = left(v_ext, 200)
           and f.estado in ('nueva', 'actualizada')
           and f.fila < v_num
      ) then
        v_estado := 'error';
        v_motivo := 'El identificador está repetido en el archivo';
      end if;

      if v_estado = 'actualizada' then
        -- Solo se pisan las columnas que el archivo trae con valor: las no mapeadas y las celdas
        -- vacías dejan el dato existente como está (nunca se borra un dato por reimportar).
        update dominio.clientes c set
          nombre = btrim(v_fila ->> 'nombre'),
          documento = coalesce(nullif(btrim(v_fila ->> 'documento'), ''), c.documento),
          correo = coalesce(nullif(btrim(v_fila ->> 'correo'), ''), c.correo),
          telefono = coalesce(nullif(btrim(v_fila ->> 'telefono'), ''), c.telefono),
          celular = coalesce(nullif(btrim(v_fila ->> 'celular'), ''), c.celular),
          direccion = coalesce(nullif(btrim(v_fila ->> 'direccion'), ''), c.direccion),
          codigo_postal = coalesce(nullif(btrim(v_fila ->> 'codigo_postal'), ''), c.codigo_postal),
          localidad = coalesce(nullif(btrim(v_fila ->> 'localidad'), ''), c.localidad),
          provincia = coalesce(nullif(btrim(v_fila ->> 'provincia'), ''), c.provincia),
          expreso_preferido = coalesce(nullif(btrim(v_fila ->> 'expreso_preferido'), ''), c.expreso_preferido),
          condicion_iva = coalesce(nullif(btrim(v_fila ->> 'condicion_iva'), ''), c.condicion_iva),
          acepta_correo_masivo = coalesce(v_acepta, c.acepta_correo_masivo),
          tipo = coalesce(nullif(lower(btrim(v_fila ->> 'tipo')), ''), c.tipo)
        where c.id = v_cliente and c.organizacion_id = v_org;
        if found then
          v_resultado := 'actualizada';
        else
          v_motivo := 'El cliente ya no existe';
        end if;
      elsif v_estado = 'nueva' then
        insert into dominio.clientes (
          organizacion_id, nombre, documento, correo, telefono, celular, direccion,
          codigo_postal, localidad, provincia, expreso_preferido, condicion_iva, tipo, acepta_correo_masivo
        ) values (
          v_org, btrim(v_fila ->> 'nombre'), nullif(btrim(v_fila ->> 'documento'), ''),
          nullif(btrim(v_fila ->> 'correo'), ''), nullif(btrim(v_fila ->> 'telefono'), ''),
          nullif(btrim(v_fila ->> 'celular'), ''), nullif(btrim(v_fila ->> 'direccion'), ''),
          nullif(btrim(v_fila ->> 'codigo_postal'), ''), nullif(btrim(v_fila ->> 'localidad'), ''),
          nullif(btrim(v_fila ->> 'provincia'), ''),
          nullif(btrim(v_fila ->> 'expreso_preferido'), ''),
          nullif(btrim(v_fila ->> 'condicion_iva'), ''),
          coalesce(nullif(lower(btrim(v_fila ->> 'tipo')), ''), 'minorista'),
          coalesce(v_acepta, false)
        ) returning id into v_cliente;

        insert into public.clientes_identificadores_externos (cliente_id, organizacion_id, sistema, identificador_externo)
        values (v_cliente, v_org, 'panel_actual', v_ext);

        -- Como cualquier alta (F-CLI-05): habilitado en todas las tiendas de la organización.
        insert into public.clientes_empresas (cliente_id, empresa_id, organizacion_id)
        select v_cliente, e.id, v_org from dominio.empresas e where e.organizacion_id = v_org
        on conflict do nothing;
        v_resultado := 'nueva';
      end if;
    exception
      when unique_violation then
        v_resultado := null;
        v_motivo := case
          when sqlerrm like '%clientes_org_documento_uq%' then 'Ya existe un cliente con ese DNI/CUIT'
          else 'El identificador ya está en uso'
        end;
      when insufficient_privilege then
        v_resultado := null;
        v_motivo := 'Este cliente no se puede modificar';
    end;

    if v_resultado = 'nueva' then
      v_nuevos := v_nuevos + 1;
    elsif v_resultado = 'actualizada' then
      v_actualizados := v_actualizados + 1;
    else
      v_errores := v_errores || jsonb_build_object('fila', v_num, 'motivo', v_motivo);
    end if;

    insert into public.migracion_filas (carga_id, lote, fila, estado, identificador_externo, motivo)
    values (p_carga, p_lote, v_num, coalesce(v_resultado, 'error'), left(v_ext, 200), left(v_motivo, 300))
    on conflict (carga_id, fila) do update
      set lote = excluded.lote,
          estado = excluded.estado,
          identificador_externo = excluded.identificador_externo,
          motivo = excluded.motivo;
  end loop;

  return jsonb_build_object(
    'nuevos', v_nuevos,
    'actualizados', v_actualizados,
    'omitidos', v_omitidos,
    'errores', v_errores
  );
end;
$function$;

-- aplicar_lote_proveedores
create or replace function public.aplicar_lote_proveedores(
  p_carga uuid,
  p_lote integer,
  p_filas jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid := (select private.organizacion_id());
  v_carga public.migracion_cargas;
  v_fila jsonb;
  v_num integer;
  v_ext text;
  v_estado text;
  v_proveedor uuid;
  v_motivo text;
  v_resultado text;
  v_cuit text;
  v_nuevos integer := 0;
  v_actualizados integer := 0;
  v_omitidos integer := 0;
  v_errores jsonb := '[]'::jsonb;
begin
  if v_org is null or not (select private.puede_escribir()) then
    raise exception 'Solo un administrador puede migrar datos' using errcode = '42501';
  end if;
  if p_lote is null or p_lote < 0 then
    raise exception 'El número de lote no es válido' using errcode = '22023';
  end if;
  if p_filas is null or jsonb_typeof(p_filas) <> 'array' then
    raise exception 'Las filas deben ser una lista' using errcode = '22023';
  end if;
  if jsonb_array_length(p_filas) > 500 then
    raise exception 'Un lote admite hasta 500 filas' using errcode = '54000';
  end if;

  -- Bloquea la carga: serializa lotes concurrentes de la misma carga.
  select * into v_carga
    from public.migracion_cargas c
   where c.id = p_carga and c.organizacion_id = v_org
     for update;
  if not found then
    raise exception 'La carga no existe en tu organización' using errcode = 'PT404';
  end if;
  if v_carga.entidad <> 'proveedores' then
    raise exception 'La carga no es de proveedores' using errcode = '22023';
  end if;

  for v_fila in select e.value from jsonb_array_elements(p_filas) as e (value) loop
    if jsonb_typeof(v_fila -> 'fila') is distinct from 'number' then
      raise exception 'Cada fila debe traer su número de fila' using errcode = '22023';
    end if;
    v_num := (v_fila ->> 'fila')::integer;
    v_ext := nullif(btrim(v_fila ->> 'id_externo'), '');
    v_resultado := null;
    v_motivo := null;

    -- Ya aplicada en un intento anterior de esta carga: no se repite.
    if exists (
      select 1 from public.migracion_filas f
       where f.carga_id = p_carga and f.fila = v_num and f.estado in ('nueva', 'actualizada')
    ) then
      v_omitidos := v_omitidos + 1;
      continue;
    end if;

    begin
      select k.o_estado, k.o_proveedor, k.o_motivo
        into v_estado, v_proveedor, v_motivo
        from private.clasificar_fila_proveedor(v_org, v_fila) as k;

      -- Mismo identificador dos veces en el archivo: la primera fila aplicada gana.
      if v_estado <> 'error' and v_ext is not null and exists (
        select 1 from public.migracion_filas f
         where f.carga_id = p_carga and f.fila < v_num
           and f.identificador_externo = left(v_ext, 200)
           and f.estado in ('nueva', 'actualizada')
      ) then
        v_estado := 'error';
        v_motivo := 'El identificador está repetido en el archivo';
      end if;

      if v_estado <> 'error' then
        v_cuit := regexp_replace(v_fila ->> 'cuit', '[\s.\-]', '', 'g');
      end if;

      if v_estado = 'actualizada' then
        -- Solo se pisan las columnas que el archivo trae con valor: las celdas vacías dejan el dato
        -- existente como está (nunca se borra un dato por reimportar).
        update dominio.proveedores p set
          razon_social = btrim(v_fila ->> 'razon_social'),
          cuit = v_cuit,
          persona_contacto = coalesce(nullif(btrim(v_fila ->> 'persona_contacto'), ''), p.persona_contacto),
          correo = coalesce(nullif(btrim(v_fila ->> 'correo'), ''), p.correo),
          telefono = coalesce(nullif(btrim(v_fila ->> 'telefono'), ''), p.telefono),
          direccion = coalesce(nullif(btrim(v_fila ->> 'direccion'), ''), p.direccion),
          observaciones = coalesce(nullif(btrim(v_fila ->> 'observaciones'), ''), p.observaciones)
        where p.id = v_proveedor and p.organizacion_id = v_org;
        if found then
          v_resultado := 'actualizada';
        else
          v_motivo := 'El proveedor ya no existe';
        end if;
      elsif v_estado = 'nueva' then
        insert into dominio.proveedores (
          organizacion_id, razon_social, cuit, persona_contacto, correo, telefono,
          direccion, observaciones, id_externo
        ) values (
          v_org, btrim(v_fila ->> 'razon_social'), v_cuit,
          nullif(btrim(v_fila ->> 'persona_contacto'), ''), nullif(btrim(v_fila ->> 'correo'), ''),
          nullif(btrim(v_fila ->> 'telefono'), ''), nullif(btrim(v_fila ->> 'direccion'), ''),
          nullif(btrim(v_fila ->> 'observaciones'), ''), v_ext
        );
        v_resultado := 'nueva';
      end if;
    exception
      when unique_violation then
        v_resultado := null;
        v_motivo := case
          when sqlerrm like '%proveedores_org_id_externo_uidx%' then 'El identificador ya está en uso'
          else 'Ya existe un proveedor con ese CUIT'
        end;
      when check_violation or invalid_parameter_value then
        v_resultado := null;
        v_motivo := 'La fila no pasó la validación de proveedores';
      when insufficient_privilege then
        v_resultado := null;
        v_motivo := 'Este proveedor no se puede modificar';
    end;

    if v_resultado = 'nueva' then
      v_nuevos := v_nuevos + 1;
    elsif v_resultado = 'actualizada' then
      v_actualizados := v_actualizados + 1;
    else
      v_errores := v_errores || jsonb_build_object('fila', v_num, 'motivo', v_motivo);
    end if;

    insert into public.migracion_filas (carga_id, lote, fila, estado, identificador_externo, motivo)
    values (p_carga, p_lote, v_num, coalesce(v_resultado, 'error'), left(v_ext, 200), left(v_motivo, 300))
    on conflict (carga_id, fila) do update
      set lote = excluded.lote,
          estado = excluded.estado,
          identificador_externo = excluded.identificador_externo,
          motivo = excluded.motivo;
  end loop;

  return jsonb_build_object(
    'nuevos', v_nuevos,
    'actualizados', v_actualizados,
    'omitidos', v_omitidos,
    'errores', v_errores
  );
end;
$$;

-- aplicar_lote_vinculos_proveedor_producto
create or replace function public.aplicar_lote_vinculos_proveedor_producto(
  p_carga uuid,
  p_lote integer,
  p_filas jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid := (select private.organizacion_id());
  v_carga public.migracion_cargas;
  v_fila jsonb;
  v_num integer;
  v_sku text;
  v_estado text;
  v_producto uuid;
  v_proveedor uuid;
  v_motivo text;
  v_resultado text;
  v_codigo text;
  v_nuevos integer := 0;
  v_actualizados integer := 0;
  v_omitidos integer := 0;
  v_errores jsonb := '[]'::jsonb;
begin
  if v_org is null or not (select private.puede_escribir()) then
    raise exception 'Solo un administrador puede migrar datos' using errcode = '42501';
  end if;
  if p_lote is null or p_lote < 0 then
    raise exception 'El número de lote no es válido' using errcode = '22023';
  end if;
  if p_filas is null or jsonb_typeof(p_filas) <> 'array' then
    raise exception 'Las filas deben ser una lista' using errcode = '22023';
  end if;
  if jsonb_array_length(p_filas) > 500 then
    raise exception 'Un lote admite hasta 500 filas' using errcode = '54000';
  end if;

  select * into v_carga
    from public.migracion_cargas c
   where c.id = p_carga and c.organizacion_id = v_org
     for update;
  if not found then
    raise exception 'La carga no existe en tu organización' using errcode = 'PT404';
  end if;
  if v_carga.entidad <> 'vinculos_proveedor_producto' then
    raise exception 'La carga no es de vínculos proveedor-producto' using errcode = '22023';
  end if;

  for v_fila in select e.value from jsonb_array_elements(p_filas) as e (value) loop
    if jsonb_typeof(v_fila -> 'fila') is distinct from 'number' then
      raise exception 'Cada fila debe traer su número de fila' using errcode = '22023';
    end if;
    v_num := (v_fila ->> 'fila')::integer;
    v_sku := nullif(btrim(v_fila ->> 'sku'), '');
    v_resultado := null;
    v_motivo := null;

    if exists (
      select 1 from public.migracion_filas f
       where f.carga_id = p_carga and f.fila = v_num and f.estado in ('nueva', 'actualizada')
    ) then
      v_omitidos := v_omitidos + 1;
      continue;
    end if;

    begin
      select k.o_estado, k.o_producto, k.o_proveedor, k.o_motivo
        into v_estado, v_producto, v_proveedor, v_motivo
        from private.clasificar_fila_vinculo_proveedor(v_org, v_fila) as k;

      -- Mismo SKU dos veces en el archivo: la primera fila aplicada gana (un producto, un proveedor).
      if v_estado <> 'error' and v_sku is not null and exists (
        select 1 from public.migracion_filas f
         where f.carga_id = p_carga and f.fila < v_num
           and lower(f.identificador_externo) = lower(left(v_sku, 200))
           and f.estado in ('nueva', 'actualizada')
      ) then
        v_estado := 'error';
        v_motivo := 'El SKU está repetido en el archivo';
      end if;

      if v_estado <> 'error' then
        v_codigo := nullif(btrim(v_fila ->> 'codigo_proveedor'), '');
        -- Celda vacía: conserva el código solo si el proveedor no cambia; con otro proveedor el
        -- código anterior ya no corresponde y se limpia.
        update dominio.productos p set
          proveedor_id = v_proveedor,
          codigo_proveedor = coalesce(v_codigo, case when p.proveedor_id = v_proveedor then p.codigo_proveedor end)
        where p.id = v_producto and p.organizacion_id = v_org;
        if found then
          v_resultado := v_estado;
        else
          v_motivo := 'El producto ya no existe';
        end if;
      end if;
    exception
      when check_violation or invalid_parameter_value then
        v_resultado := null;
        v_motivo := 'El proveedor no existe o está desactivado';
      when insufficient_privilege then
        v_resultado := null;
        v_motivo := 'Este producto no se puede modificar';
    end;

    if v_resultado = 'nueva' then
      v_nuevos := v_nuevos + 1;
    elsif v_resultado = 'actualizada' then
      v_actualizados := v_actualizados + 1;
    else
      v_errores := v_errores || jsonb_build_object('fila', v_num, 'motivo', v_motivo);
    end if;

    insert into public.migracion_filas (carga_id, lote, fila, estado, identificador_externo, motivo)
    values (p_carga, p_lote, v_num, coalesce(v_resultado, 'error'), left(v_sku, 200), left(v_motivo, 300))
    on conflict (carga_id, fila) do update
      set lote = excluded.lote,
          estado = excluded.estado,
          identificador_externo = excluded.identificador_externo,
          motivo = excluded.motivo;
  end loop;

  return jsonb_build_object(
    'nuevos', v_nuevos,
    'actualizados', v_actualizados,
    'omitidos', v_omitidos,
    'errores', v_errores
  );
end;
$$;

-- informe_conciliacion_migracion
CREATE OR REPLACE FUNCTION public.informe_conciliacion_migracion(p_carga uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_org uuid := (select private.organizacion_id());
  v_carga public.migracion_cargas;
  v_nuevos integer;
  v_actualizados integer;
  v_errores integer;
  v_registradas integer;
  v_aplicadas integer;
  v_verificadas integer;
  v_diferencia integer;
  v_diferencia_destino integer;
begin
  if v_org is null or not (select private.puede_escribir()) then
    raise exception 'Solo un administrador puede migrar datos' using errcode = '42501';
  end if;

  select * into v_carga
    from public.migracion_cargas c
   where c.id = p_carga and c.organizacion_id = v_org;
  if not found then
    raise exception 'La carga no existe en tu organización' using errcode = 'PT404';
  end if;

  select count(*) filter (where f.estado = 'nueva'),
         count(*) filter (where f.estado = 'actualizada'),
         count(*) filter (where f.estado = 'error')
    into v_nuevos, v_actualizados, v_errores
    from public.migracion_filas f
   where f.carga_id = p_carga;

  v_aplicadas := v_nuevos + v_actualizados;
  v_registradas := v_aplicadas + v_errores;

  -- Verificación contra el destino: cuántas de las filas aplicadas están realmente en la tabla
  -- destino (de esta organización) con su identificador externo. No confía en el contador.
  select count(*)::integer into v_verificadas
    from public.migracion_filas f
   where f.carga_id = p_carga
     and f.estado in ('nueva', 'actualizada')
     and case v_carga.entidad
       when 'clientes' then exists (
         select 1
           from public.clientes_identificadores_externos v
           join dominio.clientes c on c.id = v.cliente_id
          where v.sistema = 'panel_actual'
            and v.organizacion_id = v_org
            and v.identificador_externo = f.identificador_externo
            and c.organizacion_id = v_org)
       when 'proveedores' then exists (
         select 1 from dominio.proveedores p
          where p.organizacion_id = v_org and p.id_externo = f.identificador_externo)
       -- Alcance acotado: verifica que el SKU exista con algún proveedor asignado, no que sea el
       -- proveedor del archivo (un SKU vinculado antes por otro camino cuenta como verificado).
       when 'vinculos_proveedor_producto' then exists (
         select 1 from dominio.productos p
          where p.organizacion_id = v_org
            and lower(p.sku) = lower(f.identificador_externo)
            and p.proveedor_id is not null)
       when 'ingresos_archivo' then exists (
         select 1 from dominio.archivo_ingresos_mercaderia a
          where a.organizacion_id = v_org and a.id_externo = f.identificador_externo)
       else false
     end;

  v_diferencia := v_carga.filas_total - v_registradas;
  v_diferencia_destino := v_aplicadas - v_verificadas;

  return jsonb_build_object(
    'carga', p_carga,
    'entidad', v_carga.entidad,
    'archivo', v_carga.archivo,
    'estado', v_carga.estado,
    'creada_en', v_carga.created_at,
    'cerrada_en', v_carga.cerrada_en,
    'origen', jsonb_build_object('filas', v_carga.filas_total),
    'cargado', jsonb_build_object(
      'nuevos', v_nuevos,
      'actualizados', v_actualizados,
      'con_error', v_errores,
      -- Filas del archivo sin resultado registrado (carga incompleta o interrumpida).
      'omitidos', greatest(v_diferencia, 0)
    ),
    'diferencia', v_diferencia,
    'destino', jsonb_build_object('verificadas', v_verificadas, 'diferencia', v_diferencia_destino),
    'conciliado', (
      v_carga.estado = 'aplicada' and v_diferencia = 0 and v_diferencia_destino = 0
    ),
    'errores', coalesce((
      select jsonb_agg(jsonb_build_object('fila', x.fila, 'motivo', x.motivo) order by x.fila)
        from (
          select f.fila, f.motivo
            from public.migracion_filas f
           where f.carga_id = p_carga and f.estado = 'error'
           order by f.fila
           limit 200
        ) as x
    ), '[]'::jsonb)
  );
end;
$function$;

-- vincular_identificador_externo
CREATE OR REPLACE FUNCTION public.vincular_identificador_externo(p_cliente_id uuid, p_sistema text, p_identificador_externo text)
 RETURNS clientes_identificadores_externos
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_organizacion_id uuid;
  v_vinculo public.clientes_identificadores_externos;
begin
  select c.organizacion_id into v_organizacion_id
  from dominio.clientes c
  where c.id = p_cliente_id;

  if v_organizacion_id is null then
    raise exception 'El cliente % no existe', p_cliente_id using errcode = 'PT404';
  end if;

  if not (select private.es_administrador_de(v_organizacion_id)) then
    raise exception 'No puede gestionar identificadores externos de esta organización' using errcode = '42501';
  end if;

  insert into public.clientes_identificadores_externos (cliente_id, organizacion_id, sistema, identificador_externo)
  values (p_cliente_id, v_organizacion_id, p_sistema, p_identificador_externo)
  on conflict (organizacion_id, sistema, identificador_externo) do nothing
  returning * into v_vinculo;

  if v_vinculo is null then
    select * into v_vinculo
    from public.clientes_identificadores_externos
    where organizacion_id = v_organizacion_id and sistema = p_sistema and identificador_externo = p_identificador_externo;

    if v_vinculo.cliente_id <> p_cliente_id then
      raise exception 'El identificador externo ya está vinculado a otro cliente' using errcode = '23505';
    end if;
  end if;

  return v_vinculo;
end;
$function$;

-- aprovisionar_servidor_organizacion
create or replace function public.aprovisionar_servidor_organizacion(
  p_organizacion_id uuid,
  p_host text,
  p_usuario_ssh text,
  p_credencial_ssh text,
  p_puerto integer default 22
)
returns table (
  id uuid,
  organizacion_id uuid,
  host text,
  puerto_ssh integer,
  usuario_ssh text,
  rol_db text,
  created_at timestamptz,
  password_rol text
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_rol_db text;
  v_password text;
  v_ssh_vault_id uuid;
  v_db_vault_id uuid;
  v_servidor public.servidores_organizacion;
begin
  if not (select private.is_superadmin()) then
    raise exception 'Solo un superadmin puede aprovisionar un servidor de organización' using errcode = '42501';
  end if;

  if not exists (select 1 from public.organizaciones o where o.id = p_organizacion_id) then
    raise exception 'La organización % no existe', p_organizacion_id using errcode = 'PT404';
  end if;

  if exists (select 1 from public.servidores_organizacion s where s.organizacion_id = p_organizacion_id) then
    raise exception 'La organización % ya tiene un servidor aprovisionado', p_organizacion_id using errcode = '23505';
  end if;

  v_rol_db := 'worker_' || replace(p_organizacion_id::text, '-', '');
  v_password := encode(extensions.gen_random_bytes(24), 'base64');

  execute format('create role %I login password %L', v_rol_db, v_password);
  execute format('grant usage on schema private to %I', v_rol_db);
  execute format('grant execute on function private.organizacion_del_rol_actual() to %I', v_rol_db);
  execute format('grant execute on function private.autorizar_llamante_ciclo(uuid) to %I', v_rol_db);
  execute format('grant workers_orquestacion to %I', v_rol_db);
  execute format('grant execute on function public.iniciar_ejecucion_worker(uuid, text, text, uuid, jsonb) to %I', v_rol_db);
  execute format('grant execute on function public.cerrar_ejecucion_worker(uuid, text, text, jsonb, text, text) to %I', v_rol_db);

  v_ssh_vault_id := vault.create_secret(p_credencial_ssh, v_rol_db || '_ssh');
  v_db_vault_id := vault.create_secret(v_password, v_rol_db || '_db');

  insert into public.servidores_organizacion (
    organizacion_id, host, puerto_ssh, usuario_ssh,
    credencial_ssh_vault_id, rol_db, credencial_db_vault_id
  )
  values (
    p_organizacion_id, p_host, coalesce(p_puerto, 22), p_usuario_ssh,
    v_ssh_vault_id, v_rol_db, v_db_vault_id
  )
  returning * into v_servidor;

  return query
    select v_servidor.id, v_servidor.organizacion_id, v_servidor.host, v_servidor.puerto_ssh,
           v_servidor.usuario_ssh, v_servidor.rol_db, v_servidor.created_at, v_password;
end;
$$;

-- entrar_a_organizacion
create or replace function public.entrar_a_organizacion(org_id uuid, p_motivo text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_motivo text := btrim(coalesce(p_motivo, ''));
  v_ahora timestamptz := clock_timestamp();
  v_vence timestamptz := clock_timestamp() + interval '4 hours';
  v_anterior record;
begin
  if not private.is_superadmin() then
    raise exception 'Solo un superadmin puede entrar a una organización' using errcode = '42501';
  end if;

  if v_motivo = '' or length(v_motivo) > 500 then
    raise exception 'El motivo del acceso de soporte es obligatorio (hasta 500 caracteres)' using errcode = '22023';
  end if;

  if not exists (select 1 from public.organizaciones where id = org_id) then
    raise exception 'La organización % no existe', org_id using errcode = 'PT404';
  end if;

  select organizacion_id, vence_en into v_anterior
    from public.superadmin_organizacion_activa
   where user_id = auth.uid()
   for update;

  -- Cierra el acceso anterior (otra organización, o el mismo ya vencido).
  if found and (v_anterior.organizacion_id <> org_id or v_anterior.vence_en <= v_ahora) then
    insert into public.superadmin_entradas (user_id, organizacion_id, entrado_en, accion)
    values (auth.uid(), v_anterior.organizacion_id, v_ahora, 'salida');

    if v_anterior.vence_en <= v_ahora then
      perform private.insertar_actividad(
        v_anterior.organizacion_id, auth.uid(), 'soporte.vencido',
        'El acceso de soporte venció el '
          || to_char(v_anterior.vence_en at time zone 'America/Argentina/Buenos_Aires', 'DD/MM HH24:MI'), null);
    else
      perform private.insertar_actividad(
        v_anterior.organizacion_id, auth.uid(), 'soporte.salida', 'La persona de soporte salió de la organización', null);
    end if;
  end if;

  insert into public.superadmin_organizacion_activa (user_id, organizacion_id, entrado_en, vence_en)
  values (auth.uid(), org_id, v_ahora, v_vence)
  on conflict (user_id) do update
    set organizacion_id = excluded.organizacion_id,
        entrado_en = excluded.entrado_en,
        vence_en = excluded.vence_en;

  insert into public.superadmin_entradas (user_id, organizacion_id, entrado_en, accion, motivo)
  values (auth.uid(), org_id, clock_timestamp(), 'entrada', v_motivo);

  perform private.insertar_actividad(
    org_id, auth.uid(), 'soporte.ingreso',
    'Acceso de soporte hasta '
      || to_char(v_vence at time zone 'America/Argentina/Buenos_Aires', 'DD/MM HH24:MI')
      || '. Motivo: ' || v_motivo, null);
end;
$$;

-- cambiar_estado_cuenta_cliente
create or replace function public.cambiar_estado_cuenta_cliente(p_cliente uuid, p_empresa uuid, p_estado text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid;
  v_actual text;
begin
  v_org := private.exigir_gestion_cuenta_cliente(p_cliente, p_empresa);

  if p_estado is null or p_estado not in ('activa', 'suspendida') then
    raise exception 'Estado inválido' using errcode = '22023';
  end if;

  select cc.estado into v_actual
    from public.cuentas_cliente cc
   where cc.cliente_id = p_cliente and cc.empresa_id = p_empresa
   for update;
  if v_actual is null then
    raise exception 'El cliente no tiene cuenta web en esa tienda' using errcode = 'PT404';
  end if;

  if v_actual = p_estado then
    return;
  end if;

  update public.cuentas_cliente cc
     set estado = p_estado
   where cc.cliente_id = p_cliente and cc.empresa_id = p_empresa;

  perform private.registrar_actividad_cuenta_cliente(
    v_org, (select auth.uid()), p_cliente, p_empresa,
    case p_estado when 'suspendida' then 'suspendida' else 'reactivada' end
  );
end;
$$;

-- depositos_para_repuesto
create or replace function public.depositos_para_repuesto(p_producto_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_org uuid := (select private.organizacion_id());
begin
  if v_org is null or (select auth.uid()) is null
     or (select private.nivel_seccion('service_tecnico')) not in ('lectura', 'edicion') then
    raise exception 'Tu rol no puede consultar los depósitos de Service' using errcode = '42501';
  end if;
  if not exists (select 1 from dominio.productos p where p.id = p_producto_id and p.organizacion_id = v_org) then
    raise exception 'El producto no existe' using errcode = 'PT404';
  end if;

  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'deposito_id', d.id,
      'nombre', d.nombre,
      'por_defecto', d.por_defecto,
      'cantidad', coalesce(x.cantidad, 0),
      'reservado', coalesce(x.reservado, 0),
      'disponible', coalesce(x.cantidad, 0) - coalesce(x.reservado, 0)
    ) order by d.por_defecto desc, lower(d.nombre), d.id)
    from dominio.depositos d
    left join dominio.existencias_deposito x
      on x.deposito_id = d.id and x.producto_id = p_producto_id and x.organizacion_id = d.organizacion_id
    where d.organizacion_id = v_org and d.activo
  ), '[]'::jsonb);
end;
$$;

-- guardar_empresas_de_cliente
create or replace function public.guardar_empresas_de_cliente(p_cliente_id uuid, p_empresa_ids uuid[])
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid := (select private.organizacion_id());
  v_empresas uuid[] := coalesce(p_empresa_ids, '{}'::uuid[]);
  v_total integer;
begin
  if v_org is null or (select private.nivel_seccion('clientes')) <> 'edicion' then
    raise exception 'No tenés permiso para editar las tiendas del cliente' using errcode = '42501';
  end if;

  if not exists (
    select 1 from dominio.clientes c where c.id = p_cliente_id and c.organizacion_id = v_org
  ) then
    raise exception 'El cliente no pertenece a tu organización' using errcode = 'PT404';
  end if;

  -- Sin nulos, sin repetidos y todas las empresas de la organización.
  if exists (
    select 1
      from unnest(v_empresas) as x(empresa_id)
     where empresa_id is null
        or not exists (
          select 1 from dominio.empresas e
          where e.id = empresa_id and e.organizacion_id = v_org
        )
  ) then
    raise exception 'Alguna de las tiendas no pertenece a tu organización' using errcode = '42501';
  end if;

  delete from public.clientes_empresas ce where ce.cliente_id = p_cliente_id;

  insert into public.clientes_empresas (cliente_id, empresa_id, organizacion_id)
  select p_cliente_id, distintas.empresa_id, v_org
    from (select distinct unnest(v_empresas) as empresa_id) as distintas;

  get diagnostics v_total = row_count;
  return v_total;
end;
$$;

-- guardar_umbral_margen_bajo
create or replace function public.guardar_umbral_margen_bajo(
  p_umbral numeric,
  p_updated_at timestamptz default null
)
returns timestamptz
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_organizacion uuid := (select private.organizacion_id());
  v_actual dominio.rentabilidad_config;
  v_fila dominio.rentabilidad_config;
begin
  if v_organizacion is null or (select private.nivel_seccion('rentabilidad')) <> 'edicion' then
    raise exception 'Tu rol no puede editar el umbral de margen' using errcode = '42501';
  end if;
  if p_umbral is null or p_umbral <= 0 or p_umbral > 1 or p_umbral <> round(p_umbral, 4) then
    raise exception 'El umbral debe ser mayor a 0 %% y hasta 100 %%, con hasta 2 decimales' using errcode = '23514';
  end if;

  select * into v_actual from dominio.rentabilidad_config c
   where c.organizacion_id = v_organizacion for update;

  if not found then
    if p_updated_at is not null then
      raise exception 'El umbral fue modificado por otra persona' using errcode = 'PT412';
    end if;
    begin
      insert into dominio.rentabilidad_config (organizacion_id, umbral_margen_bajo)
      values (v_organizacion, p_umbral)
      returning * into v_fila;
    exception when unique_violation then
      raise exception 'El umbral fue modificado por otra persona' using errcode = 'PT412';
    end;
    return v_fila.updated_at;
  end if;

  -- Idempotente: lo pedido ya está guardado.
  if v_actual.umbral_margen_bajo = p_umbral then
    return v_actual.updated_at;
  end if;
  if p_updated_at is null or v_actual.updated_at <> p_updated_at then
    raise exception 'El umbral fue modificado por otra persona' using errcode = 'PT412';
  end if;

  update dominio.rentabilidad_config
     set umbral_margen_bajo = p_umbral
   where organizacion_id = v_organizacion
  returning * into v_fila;
  return v_fila.updated_at;
end;
$$;

-- exportar_proveedores
create or replace function public.exportar_proveedores(
  p_texto text default null,
  p_estado text default 'activos',
  p_empresa_id uuid default null,
  p_despues_de uuid default null,
  p_limite integer default 1000
)
returns table (
  id uuid,
  numero integer,
  razon_social text,
  cuit text,
  compra_para text,
  correo text,
  telefono text,
  activo boolean,
  total bigint
)
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_org uuid := (select private.organizacion_id());
  v_texto text := btrim(coalesce(p_texto, ''));
  v_estado text := coalesce(p_estado, 'activos');
  v_limite integer := least(greatest(coalesce(p_limite, 1000), 1), 1000);
  v_patron text;
  v_patron_cuit text;
  v_total bigint;
  v_cursor text;
  v_filas integer;
  v_filtros text[] := '{}';
  v_tienda text;
begin
  if v_org is null or not (select private.puede_accion('proveedores', 'exportar')) then
    raise exception 'No tenés permiso para exportar proveedores' using errcode = '42501';
  end if;
  if v_estado not in ('activos', 'inactivos', 'todos') then
    raise exception 'Estado no válido: usá activos, inactivos o todos' using errcode = '22023';
  end if;

  -- Misma búsqueda que listar_proveedores (razón social sin mayúsculas ni tildes; CUIT si el texto es numérico).
  if v_texto <> '' then
    v_patron := '%' || replace(replace(replace(translate(lower(v_texto), 'áéíóúü', 'aeiouu'), '\', '\\'), '%', '\%'), '_', '\_') || '%';
    if v_texto ~ '^[0-9][0-9\s.\-]*$' then
      v_patron_cuit := '%' || regexp_replace(v_texto, '[^0-9]', '', 'g') || '%';
    end if;
  end if;

  -- Un cursor de otra organización o inexistente no trunca el archivo en silencio: se rechaza.
  if p_despues_de is not null then
    select lower(p.razon_social) into v_cursor
      from dominio.proveedores p where p.id = p_despues_de and p.organizacion_id = v_org;
    if v_cursor is null then
      raise exception 'El proveedor de referencia de la exportación ya no existe: reintentá' using errcode = 'PT412';
    end if;
  end if;

  -- El tope se valida en cada llamada (un cursor suelto tampoco evita el límite).
  select count(*) into v_total
    from dominio.proveedores p
   where p.organizacion_id = v_org
     and (v_estado = 'todos' or p.activo = (v_estado = 'activos'))
     and (v_patron is null
          or translate(lower(p.razon_social), 'áéíóúü', 'aeiouu') like v_patron
          or (v_patron_cuit is not null and p.cuit like v_patron_cuit))
     and (
       p_empresa_id is null
       or (
         exists (select 1 from dominio.empresas e where e.id = p_empresa_id and e.organizacion_id = v_org)
         and (
           not exists (select 1 from dominio.proveedores_empresas pe where pe.proveedor_id = p.id)
           or exists (select 1 from dominio.proveedores_empresas pf where pf.proveedor_id = p.id and pf.empresa_id = p_empresa_id)
         )
       )
     );
  if v_total > 50000 then
    raise exception 'La exportación supera las 50000 filas: afiná la búsqueda' using errcode = '54000';
  end if;

  return query
  select p.id, p.numero, p.razon_social, p.cuit,
         coalesce(
           (select string_agg(e.nombre, ', ' order by e.nombre)
              from dominio.proveedores_empresas pe
              join dominio.empresas e on e.id = pe.empresa_id
             where pe.proveedor_id = p.id),
           ''
         ) as compra_para,
         p.correo, p.telefono, p.activo, v_total
    from dominio.proveedores p
   where p.organizacion_id = v_org
     and (v_estado = 'todos' or p.activo = (v_estado = 'activos'))
     and (v_patron is null
          or translate(lower(p.razon_social), 'áéíóúü', 'aeiouu') like v_patron
          or (v_patron_cuit is not null and p.cuit like v_patron_cuit))
     and (
       p_empresa_id is null
       or (
         exists (select 1 from dominio.empresas e where e.id = p_empresa_id and e.organizacion_id = v_org)
         and (
           not exists (select 1 from dominio.proveedores_empresas pe where pe.proveedor_id = p.id)
           or exists (select 1 from dominio.proveedores_empresas pf where pf.proveedor_id = p.id and pf.empresa_id = p_empresa_id)
         )
       )
     )
     and (p_despues_de is null or (lower(p.razon_social), p.id) > (v_cursor, p_despues_de))
   order by lower(p.razon_social), p.id
   limit v_limite;

  get diagnostics v_filas = row_count;

  -- Actividad: el primer lote declara el total (con los filtros, sin el texto buscado); los
  -- siguientes dejan su propia constancia. Sin filas no hay evento.
  if v_filas > 0 then
    if p_despues_de is null then
      if v_estado <> 'activos' then v_filtros := v_filtros || ('estado ' || v_estado); end if;
      if p_empresa_id is not null then
        select e.nombre into v_tienda from dominio.empresas e where e.id = p_empresa_id and e.organizacion_id = v_org;
        v_filtros := v_filtros || ('tienda ' || coalesce(v_tienda, 'no disponible'));
      end if;
      if v_texto <> '' then v_filtros := v_filtros || 'con texto'::text; end if;
      perform private.registrar_actividad(
        'proveedores.exportados',
        left(
          format('Exportó %s %s a Excel%s',
            v_total,
            case when v_total = 1 then 'proveedor' else 'proveedores' end,
            case when cardinality(v_filtros) = 0 then '' else ' (filtros: ' || array_to_string(v_filtros, ', ') || ')' end),
          480)
      );
    else
      perform private.registrar_actividad(
        'proveedores.exportados',
        format('Continuó la exportación de proveedores (%s %s)', v_filas, case when v_filas = 1 then 'fila' else 'filas' end)
      );
    end if;
  end if;
end;
$$;

-- moderar_opinion
create or replace function public.moderar_opinion(
  p_id uuid,
  p_decision text,
  p_motivo text default null,
  p_actualizada_en_esperada timestamptz default null
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_org uuid := (select private.organizacion_id());
  v_op dominio.opiniones_producto;
  v_estado_nuevo text;
  v_motivo text := nullif(btrim(coalesce(p_motivo, '')), '');
  v_producto text;
begin
  if v_org is null or not (select private.es_administrador_de(v_org)) then
    raise exception 'Solo un administrador puede moderar opiniones' using errcode = '42501';
  end if;
  if p_decision is null or p_decision not in ('aceptar', 'rechazar') then
    raise exception 'Decisión de moderación inválida' using errcode = '22023';
  end if;
  if p_decision = 'aceptar' and v_motivo is not null then
    raise exception 'El motivo solo se indica al rechazar' using errcode = '22023';
  end if;
  if v_motivo is not null and char_length(v_motivo) > 200 then
    raise exception 'El motivo admite hasta 200 caracteres' using errcode = '22023';
  end if;
  -- Mismas reglas que el comentario (control, marcas de dirección/ancho cero, enlaces): el cliente verá el motivo (fase 3).
  if v_motivo is not null and private.texto_opinion_no_permitido(v_motivo) then
    raise exception 'El motivo tiene caracteres no permitidos (saltos de línea, enlaces o marcas ocultas)' using errcode = '22023';
  end if;
  if p_actualizada_en_esperada is null then
    raise exception 'Falta la fecha de la opinión que viste' using errcode = '22023';
  end if;
  v_estado_nuevo := case p_decision when 'aceptar' then 'aceptada' else 'rechazada' end;

  select * into v_op
  from dominio.opiniones_producto o
  where o.id = p_id and o.organizacion_id = v_org
  for update;
  if not found then
    return jsonb_build_object('estado', 'no_encontrada');
  end if;

  -- Con la bandera apagada solo se reduce exposición (D11).
  if p_decision = 'aceptar' and not (select private.bandera_activa('tienda_opiniones')) then
    raise exception 'Las opiniones están desactivadas: no se pueden aceptar' using errcode = '55000';
  end if;

  -- Idempotente: repetir la decisión ya vigente responde ok sin duplicar el evento. A propósito NO actualiza `motivo_rechazo`:
  -- rechazar de nuevo con otro motivo no cambia el que ya está guardado.
  if v_op.estado = v_estado_nuevo then
    return jsonb_build_object('estado', 'ok', 'opinion', jsonb_build_object('id', v_op.id, 'estado', v_op.estado));
  end if;

  -- Bloqueo optimista: si la fila cambió desde la pantalla del administrador (p. ej. el cliente la editó), no se pisa.
  if v_op.actualizada_en <> p_actualizada_en_esperada then
    raise exception 'conflicto' using errcode = 'PT412';
  end if;

  update dominio.opiniones_producto
  set estado = v_estado_nuevo,
      motivo_rechazo = case when v_estado_nuevo = 'rechazada' then v_motivo else null end,
      moderada_por = (select auth.uid()),
      moderada_en = now(),
      actualizada_en = now()
  where id = v_op.id
  returning * into v_op;

  select left(p.nombre, 150) into v_producto from dominio.productos p
  where p.id = v_op.producto_id and p.organizacion_id = v_op.organizacion_id;

  perform private.registrar_actividad(
    case v_estado_nuevo when 'aceptada' then 'opinion.aceptada' else 'opinion.rechazada' end,
    format('Opinión de %s %s sobre «%s» %s', v_op.puntuacion, case when v_op.puntuacion = 1 then 'estrella' else 'estrellas' end,
      coalesce(v_producto, 'producto'), case v_estado_nuevo when 'aceptada' then 'aceptada' else 'rechazada' end),
    v_op.empresa_id
  );

  return jsonb_build_object('estado', 'ok', 'opinion', jsonb_build_object('id', v_op.id, 'estado', v_op.estado));
end;
$$;

-- asignar_empresas_usuario
create or replace function public.asignar_empresas_usuario(p_target_user_id uuid, p_asignaciones jsonb)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid := (select private.organizacion_id());
  v_rol text;
  v_total integer;
  v_persona text;
begin
  if v_org is null or not (select private.puede_gestionar_membresias(v_org)) then
    raise exception 'No puede gestionar usuarios de esta organización' using errcode = '42501';
  end if;
  if p_target_user_id is null then
    raise exception 'El usuario es obligatorio' using errcode = '22023';
  end if;

  -- Serializa asignaciones del mismo usuario (y su empresa activa) ANTES de leer el rol. El mismo
  -- lock lo toma cambiar_rol_miembro (20261017130000), así una promoción concurrente a
  -- Administrador no deja filas en usuarios_empresas.
  perform pg_advisory_xact_lock(hashtext(p_target_user_id::text));

  select u.rol_id into v_rol
  from public.usuarios_organizacion u
  where u.user_id = p_target_user_id and u.organizacion_id = v_org;
  if not found then
    raise exception 'El usuario no pertenece a la organización' using errcode = 'PT404';
  end if;

  if v_rol = 'administrador' and jsonb_typeof(coalesce(p_asignaciones, 'null'::jsonb)) = 'array'
     and jsonb_array_length(p_asignaciones) > 0 then
    raise exception 'El Administrador accede a todas las empresas: no lleva asignaciones' using errcode = '22023';
  end if;

  v_total := private.aplicar_asignaciones(p_target_user_id, v_org, p_asignaciones);

  select coalesce(nullif(btrim(concat_ws(' ', p.nombre, p.apellido)), ''), 'un usuario') into v_persona
  from (select 1) x
  left join public.perfiles_usuario p on p.user_id = p_target_user_id;

  perform private.registrar_actividad(
    'usuario.empresas_asignadas',
    case when v_total = 0
      then 'Quitó las empresas asignadas a ' || v_persona
      else 'Asignó ' || v_total || (case when v_total = 1 then ' empresa' else ' empresas' end) || ' a ' || v_persona
    end,
    null
  );
  return v_total;
end;
$$;

-- detalle_campana_correo
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
    raise exception 'La campaña no existe' using errcode = 'PT404';
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

comment on function public.guardar_umbral_margen_bajo(numeric, timestamptz) is
  'F-REN-01: guarda el umbral de margen bajo (solo edición en rentabilidad). 42501 sin permiso, 23514 fuera de rango, PT412 conflicto de edición (antes 40001).';

comment on function public.moderar_opinion(uuid, text, text, timestamptz) is
  'MSF-467 (RF-OPI-14): acepta o rechaza una opinión (motivo opcional de hasta 200, sin control ni enlaces, al rechazar). Decisión nula o desconocida: 22023. Solo Administrador (42501); idempotente (repetir la decisión vigente no cambia el motivo guardado); bloqueo optimista (PT412 conflicto, antes 40001); apagada la bandera solo rechaza (55000). Registra el evento en Actividad sin el texto.';

comment on function public.exportar_proveedores(text, text, uuid, uuid, integer) is
  'Exportación del listado de proveedores por lotes (keyset lower(razon_social), id). Exige private.puede_accion(proveedores, exportar); acota a la organización de la sesión; tope de lote 1000 y total 50000 en cada llamada; cursor inexistente => PT412 (antes 40001). Registra proveedores.exportados por llamada con filas. MSF-526.';
