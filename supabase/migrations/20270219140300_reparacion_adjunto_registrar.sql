-- F-SVC-20 (MSF-134, épica MSF-124): `registrar_adjunto_reparacion` y su compuerta común.
-- Esquema: sin tablas nuevas (escribe en `dominio.reparacion_adjuntos` solo desde esta RPC; Principio VII).
--
-- SECURITY DEFINER. El cliente sube el archivo al bucket y luego registra la ruta. Exige `edicion` en
-- `service_tecnico`, reparación de una tienda accesible (si no, `P0002`) y NO anulada (`55000`; una
-- entregada sigue admitiendo fotos). La ruta debe colgar de `<organizacion>/<reparacion>/` con extensión
-- JPG/PNG/WebP y el objeto debe existir en Storage; `mime` y `bytes` se validan (`22023` con `hint`).
-- El máximo de 20 se cuenta bajo el `for update` de la reparación (dos cargas simultáneas no lo superan).
-- Registra `reparacion.adjunto_agregado` en la misma transacción.
--
-- Migración aditiva. Reversión (migración posterior):
--   drop function public.registrar_adjunto_reparacion(uuid, text, text, text, integer);
--   drop function private.bloquear_reparacion_para_adjuntos(uuid);

create or replace function private.bloquear_reparacion_para_adjuntos(p_id uuid)
returns dominio.reparaciones
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid := (select private.organizacion_id());
  v_actual dominio.reparaciones;
begin
  if v_org is null or (select auth.uid()) is null
     or (select private.nivel_seccion('service_tecnico')) is distinct from 'edicion' then
    raise exception 'Tu rol no puede modificar los adjuntos de una reparación' using errcode = '42501';
  end if;
  select * into v_actual
    from dominio.reparaciones r
   where r.id = p_id and r.organizacion_id = v_org
   for update;
  if not found
     or not exists (select 1 from private.empresas_accesibles() a(id) where a.id = v_actual.empresa_id) then
    raise exception 'La reparación no existe' using errcode = 'P0002';
  end if;
  if v_actual.anulada_en is not null then
    raise exception 'La reparación está anulada: los adjuntos son de solo lectura' using errcode = '55000';
  end if;
  return v_actual;
end;
$$;

revoke execute on function private.bloquear_reparacion_para_adjuntos(uuid) from public, anon, authenticated;

create or replace function public.registrar_adjunto_reparacion(
  p_reparacion uuid,
  p_ruta text,
  p_nombre text,
  p_mime text,
  p_bytes integer
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actual dominio.reparaciones;
  v_org uuid := (select private.organizacion_id());
  v_nombre text := btrim(coalesce(p_nombre, ''));
  v_prefijo text;
  v_id uuid;
begin
  v_actual := private.bloquear_reparacion_para_adjuntos(p_reparacion);
  v_prefijo := v_org::text || '/' || p_reparacion::text || '/';

  if p_ruta is null or length(p_ruta) > 300 or left(p_ruta, length(v_prefijo)) <> v_prefijo
     or substr(p_ruta, length(v_prefijo) + 1) !~* '^[0-9a-f-]{36}\.(jpe?g|png|webp)$' then
    raise exception 'La ruta del archivo no es válida' using errcode = '22023', hint = 'ruta';
  end if;
  if v_nombre = '' or length(v_nombre) > 200 then
    raise exception 'El nombre del archivo debe tener entre 1 y 200 caracteres' using errcode = '22023', hint = 'nombre';
  end if;
  if p_mime is null or p_mime not in ('image/jpeg', 'image/png', 'image/webp') then
    raise exception 'Solo se admiten imágenes JPG, PNG o WebP' using errcode = '22023', hint = 'mime';
  end if;
  if p_bytes is null or p_bytes < 1 or p_bytes > 5242880 then
    raise exception 'Cada archivo puede pesar hasta 5 MB' using errcode = '22023', hint = 'bytes';
  end if;
  if not exists (select 1 from storage.objects o where o.bucket_id = 'reparacion-adjuntos' and o.name = p_ruta) then
    raise exception 'El archivo no se subió' using errcode = '22023', hint = 'ruta';
  end if;
  if exists (select 1 from dominio.reparacion_adjuntos a where a.ruta = p_ruta) then
    raise exception 'El archivo ya está registrado' using errcode = '22023', hint = 'ruta';
  end if;
  if (select count(*) from dominio.reparacion_adjuntos a where a.reparacion_id = p_reparacion) >= 20 then
    raise exception 'Una reparación admite hasta 20 fotos y adjuntos' using errcode = '22023', hint = 'maximo';
  end if;

  insert into dominio.reparacion_adjuntos (organizacion_id, reparacion_id, ruta, nombre_original, mime, bytes, creado_por)
  values (v_org, p_reparacion, p_ruta, v_nombre, p_mime, p_bytes, (select auth.uid()))
  returning id into v_id;

  perform private.registrar_actividad(
    'reparacion.adjunto_agregado',
    format('Agregó la foto «%s» a la reparación %s', v_nombre, private.codigo_reparacion(v_actual.numero)),
    v_actual.empresa_id
  );

  return jsonb_build_object('id', v_id, 'ruta', p_ruta, 'nombre_original', v_nombre, 'mime', p_mime, 'bytes', p_bytes);
end;
$$;

comment on function public.registrar_adjunto_reparacion(uuid, text, text, text, integer) is
  'F-SVC-20: registra un archivo ya subido al bucket reparacion-adjuntos; edicion, no anulada, máx. 20, actividad en la misma transacción.';

revoke execute on function public.registrar_adjunto_reparacion(uuid, text, text, text, integer) from public, anon;
grant execute on function public.registrar_adjunto_reparacion(uuid, text, text, text, integer) to authenticated;
