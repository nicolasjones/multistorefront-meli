-- F-PRV-01 (MSF-336, épica MSF-205): RPC de alta, edición y estado de proveedor.
-- Esquema: sin tablas nuevas (usa `dominio.proveedores`; Principio VII).
--
-- Las tres son SECURITY INVOKER: rige la RLS del llamador (sección `proveedores` en
-- `edicion`). La organización sale de la sesión (default de la columna), nunca del llamador.
-- `actualizar_proveedor` usa bloqueo optimista: el llamador envía el `updated_at` que leyó;
-- si cambió se rechaza con 40001 y no se pisa nada. `cambiar_estado_proveedor` es idempotente.
--
-- Migración aditiva. Reversión (migración posterior):
--   drop function public.cambiar_estado_proveedor(uuid, boolean);
--   drop function public.actualizar_proveedor(uuid, timestamptz, text, text, text, text, text, text, text);
--   drop function public.crear_proveedor(text, text, text, text, text, text, text);

create or replace function public.crear_proveedor(
  p_razon_social text,
  p_cuit text,
  p_persona_contacto text default null,
  p_correo text default null,
  p_telefono text default null,
  p_direccion text default null,
  p_observaciones text default null
)
returns dominio.proveedores
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_fila dominio.proveedores;
begin
  if (select private.organizacion_id()) is null or (select private.nivel_seccion('proveedores')) <> 'edicion' then
    raise exception 'Tu rol no puede crear proveedores' using errcode = '42501';
  end if;
  if btrim(coalesce(p_razon_social, '')) = '' then
    raise exception 'La razón social es obligatoria' using errcode = '22023';
  end if;
  if btrim(coalesce(p_cuit, '')) = '' then
    raise exception 'El CUIT es obligatorio' using errcode = '22023';
  end if;

  -- El disparador normaliza y valida el CUIT; el índice único rechaza el duplicado (23505).
  insert into dominio.proveedores (razon_social, cuit, persona_contacto, correo, telefono, direccion, observaciones)
  values (p_razon_social, p_cuit, p_persona_contacto, p_correo, p_telefono, p_direccion, p_observaciones)
  returning * into v_fila;
  return v_fila;
end;
$$;

comment on function public.crear_proveedor(text, text, text, text, text, text, text) is
  'F-PRV-01: alta de proveedor con CUIT validado; solo con edición en Proveedores; organización de la sesión.';

revoke execute on function public.crear_proveedor(text, text, text, text, text, text, text) from public, anon;
grant execute on function public.crear_proveedor(text, text, text, text, text, text, text) to authenticated;

create or replace function public.actualizar_proveedor(
  p_id uuid,
  p_actualizado_en timestamptz,
  p_razon_social text,
  p_cuit text,
  p_persona_contacto text default null,
  p_correo text default null,
  p_telefono text default null,
  p_direccion text default null,
  p_observaciones text default null
)
returns dominio.proveedores
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_actual dominio.proveedores;
  v_fila dominio.proveedores;
begin
  if (select private.organizacion_id()) is null or (select private.nivel_seccion('proveedores')) <> 'edicion' then
    raise exception 'Tu rol no puede editar proveedores' using errcode = '42501';
  end if;
  if btrim(coalesce(p_razon_social, '')) = '' then
    raise exception 'La razón social es obligatoria' using errcode = '22023';
  end if;
  if btrim(coalesce(p_cuit, '')) = '' then
    raise exception 'El CUIT es obligatorio' using errcode = '22023';
  end if;

  -- Serializa ediciones concurrentes del mismo proveedor; RLS acota a la organización.
  select * into v_actual from dominio.proveedores where id = p_id for update;
  if not found then
    raise exception 'El proveedor no existe' using errcode = 'P0002';
  end if;
  if p_actualizado_en is null or v_actual.updated_at <> p_actualizado_en then
    raise exception 'El proveedor fue modificado por otra persona' using errcode = '40001';
  end if;

  update dominio.proveedores
     set razon_social = p_razon_social,
         cuit = p_cuit,
         persona_contacto = p_persona_contacto,
         correo = p_correo,
         telefono = p_telefono,
         direccion = p_direccion,
         observaciones = p_observaciones
   where id = p_id
  returning * into v_fila;
  return v_fila;
end;
$$;

comment on function public.actualizar_proveedor(uuid, timestamptz, text, text, text, text, text, text, text) is
  'F-PRV-01: edita un proveedor con bloqueo optimista por updated_at (40001 ante conflicto); solo con edición en Proveedores.';

revoke execute on function public.actualizar_proveedor(uuid, timestamptz, text, text, text, text, text, text, text) from public, anon;
grant execute on function public.actualizar_proveedor(uuid, timestamptz, text, text, text, text, text, text, text) to authenticated;

create or replace function public.cambiar_estado_proveedor(p_id uuid, p_activo boolean)
returns dominio.proveedores
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_fila dominio.proveedores;
begin
  if (select private.organizacion_id()) is null or (select private.nivel_seccion('proveedores')) <> 'edicion' then
    raise exception 'Tu rol no puede cambiar el estado de los proveedores' using errcode = '42501';
  end if;
  if p_activo is null then
    raise exception 'El estado es obligatorio' using errcode = '22023';
  end if;

  select * into v_fila from dominio.proveedores where id = p_id for update;
  if not found then
    raise exception 'El proveedor no existe' using errcode = 'P0002';
  end if;
  if v_fila.activo = p_activo then
    return v_fila;
  end if;

  update dominio.proveedores set activo = p_activo where id = p_id returning * into v_fila;
  return v_fila;
end;
$$;

comment on function public.cambiar_estado_proveedor(uuid, boolean) is
  'F-PRV-01: desactiva o reactiva un proveedor sin tocar sus datos; idempotente; no existe borrado.';

revoke execute on function public.cambiar_estado_proveedor(uuid, boolean) from public, anon;
grant execute on function public.cambiar_estado_proveedor(uuid, boolean) to authenticated;
