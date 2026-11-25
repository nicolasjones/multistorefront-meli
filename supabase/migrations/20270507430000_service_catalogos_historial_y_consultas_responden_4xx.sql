-- Lote 66 (MSF-654 y MSF-655, octava ola de la convención de códigos de negocio mapeados a 4xx; ver docs/errores-negocio-postgrest.md): las RPC de
-- Service técnico (modelos de equipo, estados de reparación, historial, adjuntos, comprobante y vínculos de garantía) dejan de
-- contestar HTTP 500 cuando el dato no existe (`P0002`) o lo editó otra persona (`40001`). Misma regla que 20270507340000 a
-- 20270507420000: «no existe / no es de tu organización / tienda inaccesible» pasa a `PT404` (HTTP 404) y el conflicto de edición
-- (bloqueo optimista por `updated_at`) a `PT412` (HTTP 412). Mensaje de negocio idéntico.
-- Funciones: actualizar_modelo_equipo, cambiar_estado_modelo_equipo, actualizar_estado_reparacion, cambiar_estado_estado_reparacion,
-- mover_estado_reparacion, historial_reparacion, listar_adjuntos_reparacion, comprobante_de_reparacion y obtener_vinculos_garantia.
--
-- Cada función parte de su definición VIGENTE (indicada sobre ella; ningún barrido posterior la reescribió) y solo cambia el errcode
-- de esos rechazos: mensajes, cuerpo, firma, `security`, `search_path` y grants son los mismos (`create or replace` conserva
-- privilegios y comentario). Ninguna es llamable por `anon` ni la consumen Kestra, workers o Edge Functions (el script de datos de
-- demostración llama a cuatro, sin leer el código de error). Solo `actualizar_modelo_equipo` y `actualizar_estado_reparacion` tienen
-- bloqueo optimista; las demás solo emiten `PT404`. Quedan fuera las que validan con un auxiliar de `private` que sigue con `P0002`
-- (`agregar_item_reparacion`, `quitar_item_reparacion`, `registrar_adjunto_reparacion`, `quitar_adjunto_reparacion`), las que además emiten
-- `55000` y las del flujo de avisos al cliente.
--
-- Además actualiza el `comment on function` de actualizar_modelo_equipo y actualizar_estado_reparacion, que nombraban `40001`.
--
-- Migración aditiva (create or replace). Reversión: volver a aplicar la definición vigente indicada sobre cada función y los comentarios
-- anteriores de actualizar_modelo_equipo (20261020100400) y actualizar_estado_reparacion (20261020100500); en el cuerpo,
-- `errcode = 'PT404'` vuelve a `'P0002'` y `errcode = 'PT412'` a `'40001'`. El cliente acepta los dos códigos.

-- actualizar_modelo_equipo: definición vigente en 20261020100400_modelos_equipo_rpc.sql
create or replace function public.actualizar_modelo_equipo(
  p_id uuid,
  p_actualizado_en timestamptz,
  p_equipo text,
  p_modelo text,
  p_mano_obra_base numeric
)
returns dominio.modelos_equipo
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_actual dominio.modelos_equipo;
  v_fila dominio.modelos_equipo;
begin
  if (select private.organizacion_id()) is null or (select private.nivel_seccion('service_tecnico')) <> 'edicion' then
    raise exception 'Tu rol no puede editar modelos de equipo' using errcode = '42501';
  end if;
  if btrim(coalesce(p_equipo, '')) = '' then
    raise exception 'El equipo es obligatorio' using errcode = '22023';
  end if;
  if btrim(coalesce(p_modelo, '')) = '' then
    raise exception 'El modelo es obligatorio' using errcode = '22023';
  end if;
  if p_mano_obra_base is null or p_mano_obra_base < 0 then
    raise exception 'La mano de obra base no puede ser negativa' using errcode = '22023';
  end if;

  -- Serializa ediciones concurrentes del mismo modelo; RLS acota a la organización.
  select * into v_actual from dominio.modelos_equipo where id = p_id for update;
  if not found then
    raise exception 'El modelo no existe' using errcode = 'PT404';
  end if;
  if p_actualizado_en is null or v_actual.updated_at <> p_actualizado_en then
    raise exception 'El modelo fue modificado por otra persona' using errcode = 'PT412';
  end if;

  update dominio.modelos_equipo
     set equipo = p_equipo, modelo = p_modelo, mano_obra_base = p_mano_obra_base
   where id = p_id
  returning * into v_fila;
  return v_fila;
end;
$$;

-- cambiar_estado_modelo_equipo: definición vigente en 20261020100400_modelos_equipo_rpc.sql
create or replace function public.cambiar_estado_modelo_equipo(p_id uuid, p_activo boolean)
returns dominio.modelos_equipo
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_fila dominio.modelos_equipo;
begin
  if (select private.organizacion_id()) is null or (select private.nivel_seccion('service_tecnico')) <> 'edicion' then
    raise exception 'Tu rol no puede cambiar el estado de los modelos de equipo' using errcode = '42501';
  end if;
  if p_activo is null then
    raise exception 'El estado es obligatorio' using errcode = '22023';
  end if;

  select * into v_fila from dominio.modelos_equipo where id = p_id for update;
  if not found then
    raise exception 'El modelo no existe' using errcode = 'PT404';
  end if;
  if v_fila.activo = p_activo then
    return v_fila;
  end if;

  update dominio.modelos_equipo set activo = p_activo where id = p_id returning * into v_fila;
  return v_fila;
end;
$$;

-- actualizar_estado_reparacion: definición vigente en 20261020100500_estados_reparacion_rpc.sql
create or replace function public.actualizar_estado_reparacion(
  p_id uuid,
  p_actualizado_en timestamptz,
  p_nombre text,
  p_descripcion text,
  p_avisa_cliente boolean
)
returns dominio.estados_reparacion
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_actual dominio.estados_reparacion;
  v_fila dominio.estados_reparacion;
begin
  if (select private.organizacion_id()) is null or (select private.nivel_seccion('service_tecnico')) <> 'edicion' then
    raise exception 'Tu rol no puede editar estados de reparación' using errcode = '42501';
  end if;
  if btrim(coalesce(p_nombre, '')) = '' then
    raise exception 'El nombre del estado es obligatorio' using errcode = '22023';
  end if;
  if length(btrim(p_nombre)) > 80 then
    raise exception 'El nombre del estado admite hasta 80 caracteres' using errcode = '22023';
  end if;
  if length(coalesce(p_descripcion, '')) > 500 then
    raise exception 'La descripción admite hasta 500 caracteres' using errcode = '22023';
  end if;
  if p_avisa_cliente is null then
    raise exception 'Indicá si el estado avisa al cliente' using errcode = '22023';
  end if;

  select * into v_actual from dominio.estados_reparacion where id = p_id for update;
  if not found then
    raise exception 'El estado no existe' using errcode = 'PT404';
  end if;
  if p_actualizado_en is null or v_actual.updated_at <> p_actualizado_en then
    raise exception 'El estado fue modificado por otra persona' using errcode = 'PT412';
  end if;

  update dominio.estados_reparacion
     set nombre = p_nombre, descripcion = coalesce(p_descripcion, ''), avisa_cliente = p_avisa_cliente
   where id = p_id
  returning * into v_fila;
  return v_fila;
end;
$$;

-- cambiar_estado_estado_reparacion: definición vigente en 20261020100500_estados_reparacion_rpc.sql
create or replace function public.cambiar_estado_estado_reparacion(p_id uuid, p_activo boolean)
returns dominio.estados_reparacion
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_fila dominio.estados_reparacion;
begin
  if (select private.organizacion_id()) is null or (select private.nivel_seccion('service_tecnico')) <> 'edicion' then
    raise exception 'Tu rol no puede cambiar el estado de los estados de reparación' using errcode = '42501';
  end if;
  if p_activo is null then
    raise exception 'El estado es obligatorio' using errcode = '22023';
  end if;

  select * into v_fila from dominio.estados_reparacion where id = p_id for update;
  if not found then
    raise exception 'El estado no existe' using errcode = 'PT404';
  end if;
  if v_fila.activo = p_activo then
    return v_fila;
  end if;

  update dominio.estados_reparacion set activo = p_activo where id = p_id returning * into v_fila;
  return v_fila;
end;
$$;

-- mover_estado_reparacion: definición vigente en 20261020100500_estados_reparacion_rpc.sql
create or replace function public.mover_estado_reparacion(p_id uuid, p_direccion text)
returns dominio.estados_reparacion
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_org uuid := (select private.organizacion_id());
  v_actual dominio.estados_reparacion;
  v_vecino dominio.estados_reparacion;
begin
  if v_org is null or (select private.nivel_seccion('service_tecnico')) <> 'edicion' then
    raise exception 'Tu rol no puede reordenar estados de reparación' using errcode = '42501';
  end if;
  if p_direccion is null or p_direccion not in ('subir', 'bajar') then
    raise exception 'La dirección debe ser subir o bajar' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('estados_reparacion:' || v_org::text, 0));

  select * into v_actual from dominio.estados_reparacion where id = p_id for update;
  if not found then
    raise exception 'El estado no existe' using errcode = 'PT404';
  end if;

  if p_direccion = 'subir' then
    select * into v_vecino from dominio.estados_reparacion e
     where e.organizacion_id = v_org and (e.orden, e.id) < (v_actual.orden, v_actual.id)
     order by e.orden desc, e.id desc limit 1 for update;
  else
    select * into v_vecino from dominio.estados_reparacion e
     where e.organizacion_id = v_org and (e.orden, e.id) > (v_actual.orden, v_actual.id)
     order by e.orden asc, e.id asc limit 1 for update;
  end if;
  if not found then
    return v_actual;
  end if;

  -- Intercambio atómico en una sola sentencia.
  update dominio.estados_reparacion
     set orden = case when id = v_actual.id then v_vecino.orden else v_actual.orden end
   where id in (v_actual.id, v_vecino.id);

  select * into v_actual from dominio.estados_reparacion where id = p_id;
  return v_actual;
end;
$$;

-- historial_reparacion: definición vigente en 20261020150000_historial_reparacion_sin_email.sql
create or replace function public.historial_reparacion(p_id uuid)
returns table (
  id uuid,
  tipo text,
  estado_anterior text,
  estado_nuevo text,
  nota text,
  usuario text,
  creado_en timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if (select private.organizacion_id()) is null
     or (select private.nivel_seccion('service_tecnico')) not in ('lectura', 'edicion') then
    raise exception 'Tu rol no puede ver el historial' using errcode = '42501';
  end if;
  if not exists (
    select 1 from dominio.reparaciones r
     where r.id = p_id
       and r.organizacion_id = (select private.organizacion_id())
       and r.empresa_id in (select private.empresas_accesibles())
  ) then
    raise exception 'La reparación no existe' using errcode = 'PT404';
  end if;
  return query
    select h.id, h.tipo, a.nombre, n.nombre, h.nota,
           coalesce(nullif(btrim(concat_ws(' ', p.nombre, p.apellido)), ''), 'Usuario sin nombre'),
           h.creado_en
      from dominio.reparacion_historial h
      left join dominio.estados_reparacion a on a.id = h.estado_anterior_id and a.organizacion_id = h.organizacion_id
      left join dominio.estados_reparacion n on n.id = h.estado_nuevo_id and n.organizacion_id = h.organizacion_id
      left join public.perfiles_usuario p on p.user_id = h.usuario_id
     where h.reparacion_id = p_id
       and h.organizacion_id = (select private.organizacion_id())
     order by h.creado_en desc, h.id desc;
end;
$$;

-- listar_adjuntos_reparacion: definición vigente en 20270219140500_reparacion_adjuntos_listar.sql
create or replace function public.listar_adjuntos_reparacion(p_reparacion uuid)
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
    raise exception 'Tu rol no puede ver los adjuntos de una reparación' using errcode = '42501';
  end if;
  if not exists (
    select 1 from dominio.reparaciones r
     where r.id = p_reparacion
       and r.organizacion_id = v_org
       and r.empresa_id in (select private.empresas_accesibles())
  ) then
    raise exception 'La reparación no existe' using errcode = 'PT404';
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
             'id', a.id,
             'ruta', a.ruta,
             'nombre_original', a.nombre_original,
             'mime', a.mime,
             'bytes', a.bytes,
             'creado_en', a.creado_en,
             'subido_por', coalesce(nullif(btrim(concat_ws(' ', p.nombre, p.apellido)), ''), 'Usuario sin nombre')
           ) order by a.creado_en, a.id)
      from dominio.reparacion_adjuntos a
      left join public.perfiles_usuario p on p.user_id = a.creado_por
     where a.reparacion_id = p_reparacion
       and a.organizacion_id = v_org
  ), '[]'::jsonb);
end;
$$;

-- comprobante_de_reparacion: definición vigente en 20270201200131_comprobante_de_reparacion.sql
create or replace function public.comprobante_de_reparacion(p_reparacion uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_org uuid := (select private.organizacion_id());
  v_rep dominio.reparaciones;
  v_c dominio.comprobantes_venta;
begin
  if v_org is null or (select auth.uid()) is null
     or (select private.nivel_seccion('service_tecnico')) not in ('lectura', 'edicion') then
    raise exception 'Tu rol no puede ver las reparaciones' using errcode = '42501';
  end if;
  select * into v_rep from dominio.reparaciones r where r.id = p_reparacion and r.organizacion_id = v_org;
  if not found
     or not exists (select 1 from private.empresas_accesibles() a(id) where a.id = v_rep.empresa_id) then
    raise exception 'La reparación no existe' using errcode = 'PT404';
  end if;

  select * into v_c
    from dominio.comprobantes_venta c
   where c.organizacion_id = v_org and c.origen_tipo = 'reparacion' and c.origen_id = v_rep.id
     and c.estado <> 'anulada';
  if not found then
    return null;
  end if;
  return jsonb_build_object(
    'id', v_c.id,
    'numero', v_c.numero,
    'tipo', v_c.tipo,
    'estado', v_c.estado,
    'total', v_c.total_con_iva,
    'empresa_id', v_c.empresa_id,
    'empresa', (select e.nombre from dominio.empresas e where e.id = v_c.empresa_id and e.organizacion_id = v_org)
  );
end;
$$;

-- obtener_vinculos_garantia: definición vigente en 20270219150300_reparacion_vinculos_garantia.sql
create or replace function public.obtener_vinculos_garantia(p_reparacion uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_org uuid := (select private.organizacion_id());
  v_rep dominio.reparaciones;
  v_origen jsonb;
  v_reingresos jsonb;
begin
  if v_org is null or (select auth.uid()) is null
     or (select private.nivel_seccion('service_tecnico')) not in ('lectura', 'edicion') then
    raise exception 'Tu rol no puede ver las reparaciones' using errcode = '42501';
  end if;

  select * into v_rep
    from dominio.reparaciones r
   where r.id = p_reparacion and r.organizacion_id = v_org;
  if not found
     or not exists (select 1 from private.empresas_accesibles() a(id) where a.id = v_rep.empresa_id) then
    raise exception 'La reparación no existe' using errcode = 'PT404';
  end if;

  select jsonb_build_object('id', o.id, 'codigo', private.codigo_reparacion(o.numero)) into v_origen
    from dominio.reparaciones o
   where o.id = v_rep.reparacion_origen_id and o.organizacion_id = v_org
     and exists (select 1 from private.empresas_accesibles() a(id) where a.id = o.empresa_id);

  select coalesce(jsonb_agg(
           jsonb_build_object(
             'id', h.id,
             'codigo', private.codigo_reparacion(h.numero),
             'estado', s.nombre,
             'ingreso', h.ingreso_en
           ) order by h.ingreso_en, h.numero, h.id), '[]'::jsonb)
    into v_reingresos
    from dominio.reparaciones h
    join dominio.estados_reparacion s on s.id = h.estado_id and s.organizacion_id = h.organizacion_id
   where h.reparacion_origen_id = p_reparacion
     and h.organizacion_id = v_org
     and exists (select 1 from private.empresas_accesibles() a(id) where a.id = h.empresa_id);

  return jsonb_build_object('origen', v_origen, 'reingresos', v_reingresos);
end;
$$;

comment on function public.actualizar_modelo_equipo(uuid, timestamptz, text, text, numeric) is
  'F-SVC-01: edita un modelo con bloqueo optimista por updated_at (PT412 ante conflicto); solo con edición en Service técnico.';
comment on function public.actualizar_estado_reparacion(uuid, timestamptz, text, text, boolean) is
  'F-SVC-01: edita nombre, descripción y avisa_cliente con bloqueo optimista por updated_at (PT412); solo con edición en Service técnico.';
