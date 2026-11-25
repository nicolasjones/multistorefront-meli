-- Lote 57 (MSF-654 y MSF-655, segunda familia de la convención de códigos de negocio mapeados a 4xx): las RPC de
-- despacho, envío y cobros de Ventas dejan de contestar HTTP 500 cuando el dato no existe (`P0002`) o lo editó otra
-- persona (`40001`). Misma regla que 20270507340000: «no existe / no es de tu organización» pasa a `PT404` (HTTP 404) y
-- el conflicto de edición (bloqueo optimista por `updated_at`) a `PT412` (HTTP 412). Mensaje de negocio idéntico.
-- Funciones: cambiar_estado_despacho, registrar_faltantes_despacho, guardar_envio_comprobante, obtener_despacho_comprobante,
-- obtener_envio_comprobante, listar_responsables_despacho, registrar_cobro, revertir_cobro, actualizar_forma_pago,
-- actualizar_cuenta_cobro, cambiar_estado_forma_pago y cambiar_estado_cuenta_cobro.
--
-- Cada función parte de su definición VIGENTE (indicada sobre ella; ninguna fue reescrita in situ por un barrido
-- posterior) y solo cambia el errcode de esos rechazos: mensajes, cuerpo, firma, `security definer`, `search_path` y grants
-- son los mismos (`create or replace` conserva privilegios y comentario). Ninguna es llamable por `anon` ni la consumen
-- Kestra, workers o Edge Functions: solo la web. Quedan fuera `55000`, `P0001` y los códigos de estas funciones que no son
-- «no existe» ni conflicto de edición.
--
-- Migración aditiva (create or replace). Reversión: volver a aplicar la definición vigente indicada sobre cada función
-- (en el cuerpo, `errcode = 'PT404'` vuelve a `'P0002'` y `errcode = 'PT412'` a `'40001'`). El cliente acepta los dos códigos.

-- cambiar_estado_despacho: definición vigente en 20270202202100_despacho_estados_vivos.sql
create or replace function public.cambiar_estado_despacho(
  p_id uuid,
  p_estado text,
  p_responsable_id uuid,
  p_actualizado_en timestamptz
)
returns dominio.comprobantes_venta
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid := (select private.organizacion_id());
  v_actor uuid := (select auth.uid());
  v_destino text := lower(btrim(coalesce(p_estado, '')));
  v_c dominio.comprobantes_venta;
  v_fila dominio.comprobantes_venta;
  v_funcion text;
  v_rol_responsable text;
  v_nombre_responsable text;
begin
  if v_org is null or v_actor is null then
    raise exception 'Necesitás una sesión con organización para despachar' using errcode = '42501';
  end if;
  if v_destino not in ('armando', 'listo_para_despachar', 'entregado') then
    raise exception 'El estado "%" no es un estado de despacho', p_estado using errcode = '22023';
  end if;
  if p_responsable_id is null then
    raise exception 'Elegí quién responde por este paso del despacho' using errcode = '22023';
  end if;

  -- La fila se toma `for update`: dos despachos simultáneos se serializan.
  select * into v_c
    from dominio.comprobantes_venta c
   where c.id = p_id and c.organizacion_id = v_org
   for update;
  if not found or v_c.empresa_id is null then
    raise exception 'El comprobante no existe' using errcode = 'PT404';
  end if;
  if v_c.tipo <> 'factura' then
    raise exception 'Un presupuesto no entra al despacho: solo las facturas se arman, controlan y entregan' using errcode = '22023';
  end if;
  if v_c.estado not in ('confirmada', 'aceptado', 'en_proceso', 'armando', 'incompleto', 'cobrado', 'deuda') then
    raise exception 'Solo las facturas vigentes (no anuladas ni sin confirmar) se despachan' using errcode = '55000';
  end if;
  if v_c.estado_despacho is null then
    raise exception 'Esta factura todavía no tiene estado de despacho' using errcode = '55000';
  end if;

  -- Permisos: la acción `despachar` en la tienda DEL COMPROBANTE (no en la activa). Sin acceso a esa tienda
  -- la persona no puede avanzar su despacho.
  if not (select private.puede_despachar_en_empresa(v_c.empresa_id)) then
    raise exception 'Tu rol no puede despachar comprobantes de esta tienda' using errcode = '42501';
  end if;

  -- Idempotente (FR-003): el estado ya alcanzado devuelve el comprobante sin tocar responsables ni stock.
  if v_c.estado_despacho = v_destino then
    return v_c;
  end if;

  -- Transiciones del Flujo 1.
  if not (
       (v_c.estado_despacho in ('sin_armar', 'incompleto') and v_destino = 'armando')
    or (v_c.estado_despacho = 'armando' and v_destino = 'listo_para_despachar')
    or (v_c.estado_despacho = 'listo_para_despachar' and v_destino = 'entregado')
  ) then
    raise exception 'Una factura % no puede pasar a %',
      private.etiqueta_estado_despacho(v_c.estado_despacho),
      private.etiqueta_estado_despacho(v_destino)
      using errcode = '55000';
  end if;

  -- Bloqueo optimista (FR-003).
  if p_actualizado_en is distinct from v_c.updated_at then
    raise exception 'Alguien modificó este comprobante mientras lo mirabas: recargalo y volvé a intentar' using errcode = 'PT412';
  end if;

  -- Responsable elegible para este paso (FR-004, FR-005, FR-006).
  v_funcion := case v_destino
    when 'armando' then 'armar'
    when 'listo_para_despachar' then 'controlar'
    else 'entregar'
  end;
  v_rol_responsable := (select private.rol_usuario_en_empresa(v_org, p_responsable_id, v_c.empresa_id));
  if v_rol_responsable is null
     or not (select private.responsable_despacho_habilitado(v_org, v_rol_responsable, v_funcion)) then
    raise exception 'Esa persona no puede %s esta factura: elegí a alguien con el rol que corresponde',
      case v_funcion when 'armar' then 'armar' when 'controlar' then 'controlar' else 'entregar' end
      using errcode = '42501';
  end if;
  -- Quien armó no puede controlar, salvo el Administrador (FR-005).
  if v_destino = 'listo_para_despachar'
     and v_c.armo_id is not null
     and v_c.armo_id = p_responsable_id
     and v_rol_responsable <> 'administrador' then
    raise exception 'Quien armó el pedido no puede controlarlo: elegí otra persona' using errcode = '42501';
  end if;

  -- Entregar descuenta las reservas «A pedido» en esta misma transacción (FR-007): si algo falla, no se entrega.
  if v_destino = 'entregado' then
    perform private.descontar_reservas_entrega(v_c.id);
  end if;

  update dominio.comprobantes_venta
     set estado_despacho = v_destino,
         armo_id = case when v_destino = 'armando' then p_responsable_id else armo_id end,
         controlo_id = case when v_destino = 'listo_para_despachar' then p_responsable_id else controlo_id end,
         entrego_id = case when v_destino = 'entregado' then p_responsable_id else entrego_id end,
         entregado_en = case when v_destino = 'entregado' then now() else entregado_en end,
         updated_at = clock_timestamp()
   where id = v_c.id
  returning * into v_fila;

  select coalesce(nullif(btrim(concat_ws(' ', pu.nombre, pu.apellido)), ''), au.email::text)
    into v_nombre_responsable
    from auth.users au
    left join public.perfiles_usuario pu on pu.user_id = au.id
   where au.id = p_responsable_id;

  perform private.registrar_actividad(
    'despacho.estado_cambiado',
    format('Despacho: %s → %s en la factura %s (%s)',
      private.etiqueta_estado_despacho(v_c.estado_despacho),
      private.etiqueta_estado_despacho(v_destino),
      v_fila.numero,
      coalesce(v_nombre_responsable, 'sin nombre')),
    v_fila.empresa_id
  );

  return v_fila;
end;
$$;

-- registrar_faltantes_despacho: definición vigente en 20270202202101_faltantes_envio_estados_vivos.sql
create or replace function public.registrar_faltantes_despacho(
  p_id uuid,
  p_faltantes jsonb,
  p_actualizado_en timestamptz
)
returns dominio.comprobantes_venta
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid := (select private.organizacion_id());
  v_actor uuid := (select auth.uid());
  v_c dominio.comprobantes_venta;
  v_fila dominio.comprobantes_venta;
  v_linea dominio.comprobantes_venta_lineas;
  v_elem jsonb;
  v_texto text;
  v_orden integer;
  v_cantidad integer;
  v_ordenes integer[] := '{}';
  v_detalle text := '';
begin
  if v_org is null or v_actor is null then
    raise exception 'Necesitás una sesión con organización para registrar faltantes' using errcode = '42501';
  end if;

  -- La lista de faltantes: al menos una línea.
  if p_faltantes is null or jsonb_typeof(p_faltantes) <> 'array' or jsonb_array_length(p_faltantes) = 0 then
    raise exception 'Elegí al menos una línea faltante' using errcode = '22023';
  end if;
  -- El mismo tope que las líneas del comprobante: nadie registra 200 faltantes de un pedido.
  if jsonb_array_length(p_faltantes) > 200 then
    raise exception 'Una factura admite hasta 200 líneas' using errcode = '22023';
  end if;

  -- La fila se toma `for update`: dos registros simultáneos se serializan.
  select * into v_c
    from dominio.comprobantes_venta c
   where c.id = p_id and c.organizacion_id = v_org
   for update;
  if not found or v_c.empresa_id is null then
    raise exception 'El comprobante no existe' using errcode = 'PT404';
  end if;
  if v_c.tipo <> 'factura' then
    raise exception 'Solo las facturas registran faltantes' using errcode = '22023';
  end if;
  -- Lista de estados vivos: mantenerla igual a `ESTADOS_DESPACHABLES` (apps/web/src/pages/ventas/comprobante.tsx)
  -- y a `cambiar_estado_despacho`.
  if v_c.estado not in ('confirmada', 'aceptado', 'en_proceso', 'armando', 'incompleto', 'cobrado', 'deuda') then
    raise exception 'Solo las facturas vigentes (no anuladas ni sin confirmar) registran faltantes' using errcode = '55000';
  end if;
  if v_c.estado_despacho is null then
    raise exception 'Esta factura todavía no tiene estado de despacho' using errcode = '55000';
  end if;
  if v_c.estado_despacho not in ('armando', 'incompleto') then
    raise exception 'Los faltantes se registran con la factura en Armando o Incompleto: ahora está en %',
      private.etiqueta_estado_despacho(v_c.estado_despacho)
      using errcode = '55000';
  end if;

  -- Permisos: la acción `despachar` de Ventas en la tienda DEL COMPROBANTE (no en la activa).
  if not (select private.puede_despachar_en_empresa(v_c.empresa_id)) then
    raise exception 'Tu rol no puede registrar faltantes en esta tienda' using errcode = '42501';
  end if;

  -- Bloqueo optimista (FR-041).
  if p_actualizado_en is distinct from v_c.updated_at then
    raise exception 'Alguien modificó este comprobante mientras lo mirabas: recargalo y volvé a intentar' using errcode = 'PT412';
  end if;

  for v_elem in select value from jsonb_array_elements(p_faltantes) loop
    -- La línea del faltante: un entero positivo.
    v_texto := btrim(coalesce(v_elem ->> 'linea_orden', ''));
    if v_texto !~ '^[0-9]{1,7}$' then
      raise exception 'La línea del faltante no es válida' using errcode = '22023';
    end if;
    v_orden := v_texto::integer;
    if v_orden = any (v_ordenes) then
      raise exception 'La línea % está repetida: registrale una sola cantidad' , v_orden using errcode = '22023';
    end if;
    v_ordenes := array_append(v_ordenes, v_orden);

    -- La cantidad faltante: un entero positivo.
    v_texto := btrim(coalesce(v_elem ->> 'cantidad', ''));
    if v_texto !~ '^[0-9]{1,7}$' then
      raise exception 'La cantidad faltante de la línea % tiene que ser un número entero', v_orden using errcode = '22023';
    end if;
    v_cantidad := v_texto::integer;

    -- La línea tiene que ser de esta factura (y de esta organización).
    select * into v_linea
      from dominio.comprobantes_venta_lineas l
     where l.comprobante_id = v_c.id
       and l.organizacion_id = v_org
       and l.orden = v_orden;
    if not found then
      raise exception 'La línea % no es de esta factura', v_orden using errcode = '22023';
    end if;

    -- La cantidad va entre 1 y lo pedido de la línea (FR-041).
    if v_cantidad < 1 or v_cantidad > v_linea.cantidad then
      raise exception 'La cantidad faltante de la línea % tiene que estar entre 1 y %',
        v_orden, v_linea.cantidad
        using errcode = '22023';
    end if;

    -- Un faltante por línea: si ya hay uno abierto, se actualiza con la cantidad nueva (no se duplica).
    insert into dominio.faltantes_venta
      (organizacion_id, empresa_id, comprobante_id, linea_orden, producto_id, deposito_id,
       cantidad_faltante, estado, registrado_por)
    values
      (v_org, v_c.empresa_id, v_c.id, v_orden, v_linea.producto_id, v_linea.deposito_id,
       v_cantidad, 'abierto', v_actor)
    on conflict (comprobante_id, linea_orden) where estado = 'abierto'
    do update
      set cantidad_faltante = excluded.cantidad_faltante,
          registrado_por = excluded.registrado_por;

    v_detalle := v_detalle
      || case when v_detalle = '' then '' else '; ' end
      || format('línea %s: %s unidades', v_orden, v_cantidad);
  end loop;

  -- La factura queda en Incompleto en la misma transacción (todo o nada).
  update dominio.comprobantes_venta
     set estado_despacho = 'incompleto',
         updated_at = clock_timestamp()
   where id = v_c.id
  returning * into v_fila;

  perform private.registrar_actividad(
    'despacho.faltante_registrado',
    format('Faltantes en la factura %s: %s', v_fila.numero, v_detalle),
    v_fila.empresa_id
  );

  return v_fila;
end;
$$;

-- guardar_envio_comprobante: definición vigente en 20270202202101_faltantes_envio_estados_vivos.sql
create or replace function public.guardar_envio_comprobante(
  p_id uuid,
  p_transporte_id uuid,
  p_guia text,
  p_fecha_envio date,
  p_actualizado_en timestamptz
)
returns dominio.comprobantes_venta
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid := (select private.organizacion_id());
  v_actor uuid := (select auth.uid());
  v_c dominio.comprobantes_venta;
  v_fila dominio.comprobantes_venta;
  v_transporte dominio.transportes;
  v_guia text;
  v_fecha date;
  v_detalle text;
begin
  if v_org is null or v_actor is null then
    raise exception 'Necesitás una sesión con organización para registrar el envío' using errcode = '42501';
  end if;

  -- La fila se toma `for update`: dos guardados simultáneos se serializan.
  select * into v_c
    from dominio.comprobantes_venta c
   where c.id = p_id and c.organizacion_id = v_org
   for update;
  if not found or v_c.empresa_id is null then
    raise exception 'El comprobante no existe' using errcode = 'PT404';
  end if;

  -- Solo las facturas: un presupuesto no se despacha.
  if v_c.tipo <> 'factura' then
    raise exception 'Un presupuesto no registra envío: solo las facturas se despachan' using errcode = '22023';
  end if;
  -- Lista de estados vivos: mantenerla igual a `ESTADOS_DESPACHABLES` (apps/web/src/pages/ventas/comprobante.tsx)
  -- y a `cambiar_estado_despacho`.
  if v_c.estado not in ('confirmada', 'aceptado', 'en_proceso', 'armando', 'incompleto', 'cobrado', 'deuda') then
    raise exception 'Solo las facturas vigentes (no anuladas ni sin confirmar) registran el envío' using errcode = '55000';
  end if;
  if v_c.estado_despacho is null then
    raise exception 'Esta factura todavía no tiene estado de despacho' using errcode = '55000';
  end if;
  if v_c.estado_despacho = 'entregado' then
    raise exception 'Esta factura ya fue entregada: no se puede cambiar el envío' using errcode = '55000';
  end if;

  -- Permiso: la acción `despachar` o Ventas en `edicion`, en la empresa DEL COMPROBANTE (no en la activa).
  if not (select private.puede_despachar_en_empresa(v_c.empresa_id))
     and (select private.nivel_ventas_en_empresa(v_c.empresa_id)) <> 'edicion' then
    raise exception 'Tu rol no puede registrar el envío de comprobantes de esta tienda' using errcode = '42501';
  end if;

  -- Guía: texto de hasta 100 caracteres; en blanco = sin guía.
  v_guia := nullif(btrim(coalesce(p_guia, '')), '');
  if v_guia is not null and length(v_guia) > 100 then
    raise exception 'La guía no puede tener más de 100 caracteres' using errcode = '22023', hint = 'guia';
  end if;

  -- Fecha de envío: si no viene, la de hoy (la mercadería sale hoy). Es el día de Argentina
  -- (`private.hoy_argentina`), no el del servidor: el servidor corre en UTC y de noche el día cambiaría
  -- tres horas antes que para el cliente (mismo criterio que el resto de las RPC).
  v_fecha := p_fecha_envio;
  if v_fecha is null and p_transporte_id is not null then
    v_fecha := (select private.hoy_argentina());
  end if;

  -- Idempotente: lo mismo que ya está guardado no se vuelve a escribir (ni `updated_at`, ni actividad).
  if v_c.transporte_id is not distinct from p_transporte_id
     and v_c.guia is not distinct from v_guia
     and v_c.fecha_envio is not distinct from v_fecha then
    return v_c;
  end if;

  -- Bloqueo optimista (FR-021).
  if p_actualizado_en is distinct from v_c.updated_at then
    raise exception 'Alguien modificó este comprobante mientras lo mirabas: recargalo y volvé a intentar' using errcode = 'PT412';
  end if;

  -- Transporte: de la organización, activo y usado en la empresa del comprobante (FR-021).
  if p_transporte_id is not null then
    select * into v_transporte
      from dominio.transportes t
     where t.id = p_transporte_id and t.organizacion_id = v_org;
    if not found then
      raise exception 'El transporte no existe' using errcode = '22023', hint = 'transporte_id';
    end if;
    if not v_transporte.activa then
      raise exception 'El transporte «%» está desactivado: elegí otro', v_transporte.nombre
        using errcode = '22023', hint = 'transporte_id';
    end if;
    if not exists (
      select 1
        from dominio.transportes_empresas te
       where te.transporte_id = v_transporte.id
         and te.empresa_id = v_c.empresa_id
         and te.organizacion_id = v_org
    ) then
      raise exception 'El transporte «%» no se usa en esta tienda: elegí otro', v_transporte.nombre
        using errcode = '22023', hint = 'transporte_id';
    end if;
  end if;

  update dominio.comprobantes_venta
     set transporte_id = p_transporte_id,
         guia = v_guia,
         fecha_envio = v_fecha,
         updated_at = clock_timestamp()
   where id = v_c.id
  returning * into v_fila;

  v_detalle := case
    when v_fila.transporte_id is null and v_fila.guia is null then 'sin transporte ni guía'
    else trim(
      case
        when v_fila.transporte_id is not null then 'transporte ' || coalesce(v_transporte.nombre, '—')
        else 'sin transporte'
      end ||
      case when v_fila.guia is not null then ', guía ' || v_fila.guia else '' end ||
      case when v_fila.fecha_envio is not null then ', fecha ' || to_char(v_fila.fecha_envio, 'DD/MM/YYYY') else '' end
    )
  end;
  perform private.registrar_actividad(
    'despacho.envio_guardado',
    format('Envío: %s en la factura %s', v_detalle, v_fila.numero),
    v_fila.empresa_id
  );

  return v_fila;
end;
$$;

-- obtener_despacho_comprobante: definición vigente en 20270112100700_despacho_permiso_por_empresa.sql
create or replace function public.obtener_despacho_comprobante(p_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_org uuid := (select private.organizacion_id());
  v_c dominio.comprobantes_venta;
begin
  if v_org is null or (select auth.uid()) is null then
    raise exception 'Necesitás una sesión con organización para ver el despacho de un comprobante' using errcode = '42501';
  end if;
  select * into v_c
    from dominio.comprobantes_venta c
   where c.id = p_id and c.organizacion_id = v_org;
  if not found or v_c.empresa_id is null then
    raise exception 'El comprobante no existe' using errcode = 'PT404';
  end if;
  if (select private.nivel_ventas_en_empresa(v_c.empresa_id)) not in ('lectura', 'edicion') then
    raise exception 'Tu rol no puede ver los comprobantes de esta tienda' using errcode = '42501';
  end if;

  return jsonb_build_object(
    'estado_despacho', v_c.estado_despacho,
    'armo_id', v_c.armo_id,
    'armo', (
      select coalesce(nullif(btrim(concat_ws(' ', pu.nombre, pu.apellido)), ''), au.email::text)
        from auth.users au
        left join public.perfiles_usuario pu on pu.user_id = au.id
       where au.id = v_c.armo_id
    ),
    'controlo_id', v_c.controlo_id,
    'controlo', (
      select coalesce(nullif(btrim(concat_ws(' ', pu.nombre, pu.apellido)), ''), au.email::text)
        from auth.users au
        left join public.perfiles_usuario pu on pu.user_id = au.id
       where au.id = v_c.controlo_id
    ),
    'entrego_id', v_c.entrego_id,
    'entrego', (
      select coalesce(nullif(btrim(concat_ws(' ', pu.nombre, pu.apellido)), ''), au.email::text)
        from auth.users au
        left join public.perfiles_usuario pu on pu.user_id = au.id
       where au.id = v_c.entrego_id
    ),
    'entregado_en', v_c.entregado_en,
    'updated_at', v_c.updated_at,
    -- La tarjeta solo ofrece avanzar si la base aceptaría ESTA factura: la acción `despachar` se resuelve en
    -- la empresa del comprobante, no en la empresa activa de la barra superior (Principio VIII, FR-012).
    'puede_despachar', (select private.puede_despachar_en_empresa(v_c.empresa_id))
  );
end;
$$;

-- obtener_envio_comprobante: definición vigente en 20270112140400_envio_leer.sql
create or replace function public.obtener_envio_comprobante(p_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_org uuid := (select private.organizacion_id());
  v_c dominio.comprobantes_venta;
begin
  if v_org is null or (select auth.uid()) is null then
    raise exception 'Necesitás una sesión con organización para ver el envío de un comprobante' using errcode = '42501';
  end if;
  select * into v_c
    from dominio.comprobantes_venta c
   where c.id = p_id and c.organizacion_id = v_org;
  if not found or v_c.empresa_id is null then
    raise exception 'El comprobante no existe' using errcode = 'PT404';
  end if;
  -- El permiso se resuelve en la empresa DEL COMPROBANTE: no en la empresa activa de la barra superior.
  if (select private.nivel_ventas_en_empresa(v_c.empresa_id)) not in ('lectura', 'edicion') then
    raise exception 'Tu rol no puede ver los comprobantes de esta tienda' using errcode = '42501';
  end if;

  return jsonb_build_object(
    'transporte_id', v_c.transporte_id,
    'guia', v_c.guia,
    'fecha_envio', v_c.fecha_envio,
    'updated_at', v_c.updated_at
  );
end;
$$;

-- listar_responsables_despacho: definición vigente en 20270112100400_despacho_responsables.sql
create or replace function public.listar_responsables_despacho(p_empresa_id uuid, p_funcion text)
returns table (user_id uuid, nombre text, rol_id text)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_org uuid := (select private.organizacion_id());
  v_funcion text := lower(btrim(coalesce(p_funcion, '')));
begin
  if v_org is null or (select auth.uid()) is null then
    raise exception 'Necesitás una sesión con organización para ver los responsables del despacho' using errcode = '42501';
  end if;
  if v_funcion not in ('armar', 'controlar', 'entregar') then
    raise exception 'El paso "%" no es un paso del despacho', p_funcion using errcode = '22023';
  end if;
  if not exists (
    select 1 from dominio.empresas e where e.id = p_empresa_id and e.organizacion_id = v_org
  ) then
    raise exception 'La tienda no existe' using errcode = 'PT404';
  end if;
  -- Ver Ventas en la tienda: sin acceso no hay lista de responsables.
  if (select private.nivel_ventas_en_empresa(p_empresa_id)) = 'ninguno' then
    raise exception 'Tu rol no puede ver los responsables de esta tienda' using errcode = '42501';
  end if;

  return query
    select c.user_id,
           coalesce(nullif(btrim(concat_ws(' ', pu.nombre, pu.apellido)), ''), au.email::text),
           c.rol_id
      from (
        -- Administradores de la organización: acceder a todas sus empresas.
        select u.user_id, 'administrador'::text as rol_id
          from public.usuarios_organizacion u
         where u.organizacion_id = v_org and u.estado = 'activo' and u.rol_id = 'administrador'
        union
        -- Miembros con rol en esta empresa.
        select ue.user_id, ue.rol_id
          from public.usuarios_empresas ue
          join public.usuarios_organizacion u
            on u.user_id = ue.user_id and u.organizacion_id = ue.organizacion_id
         where ue.empresa_id = p_empresa_id
           and ue.organizacion_id = v_org
           and u.estado = 'activo'
      ) c
      join auth.users au on au.id = c.user_id
      left join public.perfiles_usuario pu on pu.user_id = c.user_id
     where private.responsable_despacho_habilitado(v_org, c.rol_id, v_funcion)
     order by coalesce(nullif(btrim(concat_ws(' ', pu.nombre, pu.apellido)), ''), au.email::text),
              c.rol_id,
              c.user_id;
end;
$$;

-- registrar_cobro: definición vigente en 20270114100300_registrar_cobro.sql
create or replace function public.registrar_cobro(
  p_comprobante_id uuid,
  p_importe numeric,
  p_forma_pago_id uuid,
  p_cuenta_cobro_id uuid default null,
  p_actualizado_en timestamptz default null
)
returns dominio.cobros_comprobante
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid := (select private.organizacion_id());
  v_actor uuid := (select auth.uid());
  v_c dominio.comprobantes_venta;
  v_forma dominio.formas_pago;
  v_cuenta record;
  v_cobro_id uuid;
  v_cobro dominio.cobros_comprobante;
begin
  if v_org is null or v_actor is null then
    raise exception 'Necesitás una sesión con organización para registrar cobros' using errcode = '42501';
  end if;

  -- ── El importe (FR-003): la base es la autoridad, el `hint` marca el campo ──
  if p_importe is null then
    raise exception 'El importe es obligatorio' using errcode = '22023', hint = 'importe';
  end if;
  if p_importe <= 0 then
    raise exception 'El importe tiene que ser mayor a cero' using errcode = '22023', hint = 'importe';
  end if;
  if round(p_importe, 2) <> p_importe then
    raise exception 'El importe puede tener hasta dos decimales' using errcode = '22023', hint = 'importe';
  end if;
  -- El libro guarda el importe en numeric(14,2): un importe mayor no tiene dónde guardarse y la
  -- base tiraría un error técnico (22003) que la pantalla no sabe explicar. Se rechaza acá, con
  -- el mensaje y el `hint` del campo.
  if p_importe > 999999999999.99 then
    raise exception 'El importe no puede ser mayor a 999999999999.99' using errcode = '22023', hint = 'importe';
  end if;

  if p_forma_pago_id is null then
    raise exception 'La forma de pago es obligatoria' using errcode = '22023', hint = 'forma_pago_id';
  end if;

  -- ── El comprobante, con bloqueo de fila: serializa los cobros simultáneos (FR-003) ──
  select * into v_c
    from dominio.comprobantes_venta c
   where c.id = p_comprobante_id and c.organizacion_id = v_org
     for update;
  if not found then
    raise exception 'El comprobante no existe' using errcode = 'PT404';
  end if;

  -- ── El permiso es el de la empresa del comprobante (FR-002) ─────────────────
  if not (select private.puede_registrar_cobro_en_empresa(v_c.empresa_id)) then
    raise exception 'Tu rol no puede registrar cobros en esta tienda' using errcode = '42501';
  end if;

  -- ── Solo las facturas confirmadas admiten cobros (FR-002) ──────────────────
  if v_c.tipo <> 'factura' then
    raise exception 'Solo las facturas admiten cobros' using errcode = '22023';
  end if;
  if v_c.estado = 'borrador' then
    raise exception 'La factura está en borrador: confirmala antes de registrar cobros' using errcode = '55000';
  end if;
  if v_c.estado = 'anulada' then
    raise exception 'La factura está anulada: no admite cobros' using errcode = '55000';
  end if;

  -- ── La forma de pago: de la misma empresa y activa ────────────────────────
  select * into v_forma
    from dominio.formas_pago f
   where f.id = p_forma_pago_id
     and f.organizacion_id = v_org
     and f.empresa_id = v_c.empresa_id;
  if not found then
    raise exception 'La forma de pago no es de la empresa de la factura' using errcode = '22023', hint = 'forma_pago_id';
  end if;
  if not v_forma.activo then
    raise exception 'La forma de pago % está desactivada', v_forma.nombre using errcode = '22023', hint = 'forma_pago_id';
  end if;

  -- ── La cuenta de cobro: la exige la forma y tiene que estar activa y habilitada (FR-002) ──
  if v_forma.exige_cuenta_cobro and p_cuenta_cobro_id is null then
    raise exception 'La forma de pago % exige una cuenta de cobro', v_forma.nombre using errcode = '22023', hint = 'cuenta_cobro_id';
  end if;
  if p_cuenta_cobro_id is not null then
    select c.* into v_cuenta
      from dominio.cuentas_cobro c
     where c.id = p_cuenta_cobro_id and c.organizacion_id = v_org;
    if not found then
      raise exception 'La cuenta de cobro no existe o no es de tu organización' using errcode = '22023', hint = 'cuenta_cobro_id';
    end if;
    if not v_cuenta.activa then
      raise exception 'La cuenta de cobro % está marcada «No usar»', v_cuenta.nombre using errcode = '22023', hint = 'cuenta_cobro_id';
    end if;
    if not exists (
      select 1 from dominio.cuentas_cobro_empresas ce
       where ce.cuenta_id = p_cuenta_cobro_id
         and ce.empresa_id = v_c.empresa_id
         and ce.organizacion_id = v_org
    ) then
      raise exception 'La cuenta de cobro % no está habilitada en esta tienda', v_cuenta.nombre using errcode = '22023', hint = 'cuenta_cobro_id';
    end if;
  end if;

  -- ── El cobro: lo registra la función interna (FR-003, FR-004, FR-006) ────
  begin
    v_cobro_id := private.registrar_cobro_interno(
      v_c.id, p_importe, v_forma.id, p_cuenta_cobro_id, 'manual', v_actor);
  exception when sqlstate 'P0001' then
    -- El tope (el importe supera el saldo): el mensaje nombra el importe y el saldo (FR-003).
    raise exception '%', sqlerrm using errcode = 'P0001', hint = 'importe';
  end;

  select * into v_cobro from dominio.cobros_comprobante where id = v_cobro_id;
  return v_cobro;
end;
$$;

-- revertir_cobro: definición vigente en 20270507180100_revertir_cobro.sql
create or replace function public.revertir_cobro(p_cobro_id uuid, p_motivo text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid := (select private.organizacion_id());
  v_actor uuid := (select auth.uid());
  v_motivo text := btrim(coalesce(p_motivo, ''));
  v_comprobante_id uuid;
  v_c dominio.comprobantes_venta;
  v_cobro dominio.cobros_comprobante;
  v_saldo record;
  v_nombre text;
  v_nuevo uuid;
begin
  if v_org is null or v_actor is null then
    raise exception 'Necesitás una sesión con organización para revertir cobros' using errcode = '42501';
  end if;
  if not (select private.puede_escribir()) then
    raise exception 'Solo el administrador puede revertir un cobro' using errcode = '42501';
  end if;

  -- El comprobante se toma primero (mismo orden que registrar_cobro_interno); el cobro se lee sin bloqueo para saber cuál.
  select b.comprobante_id into v_comprobante_id
    from dominio.cobros_comprobante b
   where b.id = p_cobro_id and b.organizacion_id = v_org;
  if not found then
    raise exception 'El cobro no existe' using errcode = 'PT404';
  end if;

  select * into v_c from dominio.comprobantes_venta c
   where c.id = v_comprobante_id and c.organizacion_id = v_org for update;
  if not found then
    raise exception 'El cobro no existe' using errcode = 'PT404';
  end if;

  select * into v_cobro from dominio.cobros_comprobante b
   where b.id = p_cobro_id and b.organizacion_id = v_org for update;

  if v_motivo = '' then
    raise exception 'Escribí el motivo de la reversión' using errcode = '22023', hint = 'motivo';
  end if;
  if length(v_motivo) > 300 then
    raise exception 'El motivo de la reversión no puede superar los 300 caracteres' using errcode = '22023', hint = 'motivo';
  end if;
  if v_cobro.origen = 'reversion' then
    raise exception 'Un contra-asiento no se revierte' using errcode = '55000';
  end if;
  if v_cobro.origen = 'contrarreembolso' then
    raise exception 'El cobro de un contrarreembolso se corrige desde el contrarreembolso' using errcode = '55000';
  end if;
  if exists (select 1 from dominio.cobros_comprobante r
              where r.revierte_cobro_id = v_cobro.id and r.organizacion_id = v_org) then
    raise exception 'El cobro ya fue revertido' using errcode = '55000';
  end if;
  if v_cobro.aprobado_por is not null then
    raise exception 'El cobro está conciliado: revertí primero la conciliación' using errcode = '55000';
  end if;
  if v_c.estado in ('borrador', 'anulada') then
    raise exception 'La factura no está en un estado operativo: no admite revertir cobros' using errcode = '55000';
  end if;

  select coalesce(nullif(btrim(concat_ws(' ', pr.nombre, pr.apellido)), ''), u.email::text)
    into v_nombre
    from auth.users u
    left join public.perfiles_usuario pr on pr.user_id = u.id
   where u.id = v_actor;
  if v_nombre is null then
    raise exception 'El usuario que revierte el cobro no existe' using errcode = '22023';
  end if;

  insert into dominio.cobros_comprobante (
    organizacion_id, empresa_id, comprobante_id, importe, forma_pago_id, cuenta_cobro_id,
    origen, registrado_por, registrado_por_nombre, revierte_cobro_id, motivo_reversion
  )
  values (
    v_cobro.organizacion_id, v_cobro.empresa_id, v_cobro.comprobante_id, -v_cobro.importe, v_cobro.forma_pago_id,
    v_cobro.cuenta_cobro_id, 'reversion', v_actor, v_nombre, v_cobro.id, v_motivo
  )
  returning id into v_nuevo;

  select * into v_saldo from private.saldo_comprobante(v_c.id);
  if v_saldo.saldo = 0 then
    perform private.marcar_estado_cobro_comprobante(v_c.id, 'cobrado');
  elsif v_c.estado = 'cobrado' then
    perform private.marcar_estado_cobro_comprobante(v_c.id, 'deuda');
  end if;

  perform private.insertar_actividad(
    v_c.organizacion_id,
    v_actor,
    'comprobante.cobro_revertido',
    format('Revirtió el cobro de ARS %s de la factura %s: %s', v_cobro.importe, v_c.numero, v_motivo),
    v_c.empresa_id
  );
  return v_nuevo;
end;
$$;

-- actualizar_forma_pago: definición vigente en 20261022120000_formas_pago_rpc.sql
create or replace function public.actualizar_forma_pago(
  p_id uuid,
  p_actualizado_en timestamptz,
  p_nombre text,
  p_tipo text,
  p_exige_cuenta_cobro boolean,
  p_genera_deuda boolean,
  p_estado_inicial text,
  p_orden integer,
  p_activo boolean
)
returns dominio.formas_pago
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_actual dominio.formas_pago;
  v_fila dominio.formas_pago;
begin
  if (select private.organizacion_id()) is null
     or not (select private.es_administrador_de((select private.organizacion_id()))) then
    raise exception 'Solo el Administrador puede editar formas de pago' using errcode = '42501';
  end if;

  if btrim(coalesce(p_nombre, '')) = '' then
    raise exception 'Completá el nombre' using errcode = '22023';
  end if;
  if length(btrim(p_nombre)) > 100 then
    raise exception 'El nombre admite hasta 100 caracteres' using errcode = '22023';
  end if;
  if p_tipo is null or p_tipo not in ('efectivo', 'transferencia', 'contrarreembolso', 'tarjeta', 'otro') then
    raise exception 'El tipo de forma de pago no es válido' using errcode = '22023';
  end if;
  if p_estado_inicial is null or p_estado_inicial not in ('pendiente', 'aceptado', 'cobrado', 'deuda') then
    raise exception 'El estado inicial del comprobante no es válido' using errcode = '22023';
  end if;
  if p_exige_cuenta_cobro is null or p_genera_deuda is null or p_activo is null then
    raise exception 'Faltan datos de la forma de pago' using errcode = '22023';
  end if;
  if p_orden is null or p_orden < 0 or p_orden > 9999 then
    raise exception 'El orden debe estar entre 0 y 9999' using errcode = '22023';
  end if;

  -- Serializa ediciones concurrentes; RLS acota a la organización y a las empresas accesibles.
  select * into v_actual from dominio.formas_pago where id = p_id for update;
  if not found then
    raise exception 'La forma de pago no existe' using errcode = 'PT404';
  end if;
  if p_actualizado_en is null or v_actual.updated_at <> p_actualizado_en then
    raise exception 'La forma de pago fue modificada por otra persona' using errcode = 'PT412';
  end if;

  update dominio.formas_pago
     set nombre = p_nombre,
         tipo = p_tipo,
         exige_cuenta_cobro = p_exige_cuenta_cobro,
         genera_deuda = p_genera_deuda,
         estado_inicial = p_estado_inicial,
         orden = p_orden,
         activo = p_activo
   where id = p_id
  returning * into v_fila;
  return v_fila;
end;
$$;

-- actualizar_cuenta_cobro: definición vigente en 20261022120500_cuentas_cobro_rpc.sql
create or replace function public.actualizar_cuenta_cobro(
  p_id uuid,
  p_actualizado_en timestamptz,
  p_nombre text,
  p_titular text,
  p_cuit text,
  p_banco text,
  p_alias text,
  p_cbu text,
  p_tipo text,
  p_moneda text,
  p_orden integer default 0,
  p_activa boolean default true,
  p_notas text default null,
  p_empresa_ids uuid[] default '{}'
)
returns dominio.cuentas_cobro
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_org uuid := (select private.organizacion_id());
  v_actual dominio.cuentas_cobro;
  v_fila dominio.cuentas_cobro;
  v_cambio_empresas boolean;
begin
  if v_org is null or not (select private.es_administrador_de(v_org)) then
    raise exception 'Solo un Administrador puede editar cuentas de cobro' using errcode = '42501';
  end if;
  if btrim(coalesce(p_nombre, '')) = '' then
    raise exception 'El nombre de la cuenta es obligatorio' using errcode = '22023';
  end if;
  if btrim(coalesce(p_titular, '')) = '' then
    raise exception 'El titular es obligatorio' using errcode = '22023';
  end if;
  if btrim(coalesce(p_cuit, '')) = '' then
    raise exception 'El CUIT del titular es obligatorio' using errcode = '22023';
  end if;
  if btrim(coalesce(p_cbu, '')) = '' then
    raise exception 'El CBU / CVU es obligatorio' using errcode = '22023';
  end if;

  -- Serializa ediciones concurrentes de la misma cuenta; RLS acota a la organización.
  select * into v_actual from dominio.cuentas_cobro where id = p_id for update;
  if not found then
    raise exception 'La cuenta de cobro no existe' using errcode = 'PT404';
  end if;
  if p_actualizado_en is null or v_actual.updated_at <> p_actualizado_en then
    raise exception 'La cuenta de cobro fue modificada por otra persona' using errcode = 'PT412';
  end if;

  -- Avisa al disparador de normalización que un cambio solo de empresas también avanza `updated_at`.
  v_cambio_empresas := private.guardar_empresas_cuenta_cobro(p_id, p_empresa_ids);
  if v_cambio_empresas then
    perform set_config('cuentas_cobro.tocar', p_id::text, true);
  end if;

  update dominio.cuentas_cobro
     set nombre = p_nombre,
         titular = p_titular,
         cuit = p_cuit,
         banco = p_banco,
         alias = p_alias,
         cbu = p_cbu,
         tipo = coalesce(p_tipo, tipo),
         moneda = coalesce(p_moneda, moneda),
         orden = coalesce(p_orden, orden),
         activa = coalesce(p_activa, activa),
         notas = p_notas
   where id = p_id
  returning * into v_fila;

  perform set_config('cuentas_cobro.tocar', '', true);
  return v_fila;
end;
$$;

-- cambiar_estado_forma_pago: definición vigente en 20261022120000_formas_pago_rpc.sql
create or replace function public.cambiar_estado_forma_pago(p_id uuid, p_activo boolean)
returns dominio.formas_pago
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_fila dominio.formas_pago;
begin
  if (select private.organizacion_id()) is null
     or not (select private.es_administrador_de((select private.organizacion_id()))) then
    raise exception 'Solo el Administrador puede cambiar el estado de las formas de pago' using errcode = '42501';
  end if;
  if p_activo is null then
    raise exception 'El estado es obligatorio' using errcode = '22023';
  end if;

  select * into v_fila from dominio.formas_pago where id = p_id for update;
  if not found then
    raise exception 'La forma de pago no existe' using errcode = 'PT404';
  end if;
  if v_fila.activo = p_activo then
    return v_fila;
  end if;

  update dominio.formas_pago set activo = p_activo where id = p_id returning * into v_fila;
  return v_fila;
end;
$$;

-- cambiar_estado_cuenta_cobro: definición vigente en 20261022120500_cuentas_cobro_rpc.sql
create or replace function public.cambiar_estado_cuenta_cobro(p_id uuid, p_activa boolean)
returns dominio.cuentas_cobro
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_org uuid := (select private.organizacion_id());
  v_fila dominio.cuentas_cobro;
begin
  if v_org is null or not (select private.es_administrador_de(v_org)) then
    raise exception 'Solo un Administrador puede cambiar el estado de las cuentas de cobro' using errcode = '42501';
  end if;
  if p_activa is null then
    raise exception 'El estado es obligatorio' using errcode = '22023';
  end if;

  select * into v_fila from dominio.cuentas_cobro where id = p_id for update;
  if not found then
    raise exception 'La cuenta de cobro no existe' using errcode = 'PT404';
  end if;
  if v_fila.activa = p_activa then
    return v_fila;
  end if;

  update dominio.cuentas_cobro set activa = p_activa where id = p_id returning * into v_fila;
  return v_fila;
end;
$$;
